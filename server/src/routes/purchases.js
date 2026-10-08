import { Router } from 'express';
import { getDb } from '../db.js';
import { adjustStock } from '../stock.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { storeClauseAndParams, appendStoreFilter, resolveWriteStoreId } from '../utils/storeScope.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

// 按 product_id / name+model+spec 匹配关联的订货订单项（单品到货与整单到货共用，消除重复）
function findMatchingOrderItem(db, po, item) {
  if (item.product_id) {
    return db.prepare(`
      SELECT * FROM order_items
      WHERE order_id = ? AND product_id = ? AND product_type = 'order'
        AND (product_model = ? OR (? IS NULL AND product_model IS NULL))
        AND (spec = ? OR (? IS NULL AND spec IS NULL))
    `).get(po.order_id, item.product_id, item.model, item.model, item.spec, item.spec);
  }
  return db.prepare(`
    SELECT * FROM order_items
    WHERE order_id = ? AND product_type = 'order'
      AND product_name = ?
      AND (product_model = ? OR (? IS NULL AND product_model IS NULL))
      AND (spec = ? OR (? IS NULL AND spec IS NULL))
  `).get(po.order_id, item.product_name, item.model, item.model, item.spec, item.spec);
}

// 进货单/订货单的进货单价同步到关联订单项（财务核算利润以 order_items.cost_price 为准）。
// 不再写入商品进价（products.cost_price），避免与商品管理口径冲突。
function syncOrderItemCost(db, po, item) {
  if (!po.order_id || !(Number(item.unit_price) > 0)) return;
  const oi = findMatchingOrderItem(db, po, item);
  if (oi) {
    db.prepare('UPDATE order_items SET cost_price = ? WHERE id = ?').run(item.unit_price, oi.id);
  }
}

// 重新评估关联订单的齐货状态（按订单项 item_status 判断），单品到货与整单到货共用，消除重复
function reassessOrderArrival(db, orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || ['cancelled', 'completed'].includes(order.status)) return;
  const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const orderTypeItems = orderItems.filter(oi => oi.product_type === 'order');
  const allOrderItemsArrived = orderTypeItems.length > 0
    && orderTypeItems.every(oi => oi.item_status === 'arrived');
  const someArrived = orderTypeItems.some(oi => oi.item_status === 'arrived');
  let targetStatus = order.status;
  if (allOrderItemsArrived) {
    if (order.payment_method === 'full' || order.balance_amount <= 0 || order.tail_payment_status === 'paid') {
      targetStatus = 'balance_paid';
    } else {
      targetStatus = 'ready';
    }
  } else if (someArrived) {
    targetStatus = 'arrived';
  } else {
    targetStatus = 'purchasing';
  }
  if (targetStatus !== order.status) {
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(targetStatus, orderId);
  }
}

function generatePoNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `PO${y}${m}${d}${h}${mi}${s}`;
}

// 进货单列表（仅管理员/老板，含供应商与成本价）
router.get('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const { status, purchase_type, order_id } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (status) { where += ' AND po.status = ?'; params.push(status); }
  if (purchase_type) { where += ' AND po.purchase_type = ?'; params.push(purchase_type); }
  if (order_id) { where += ' AND po.order_id = ?'; params.push(order_id); }

  where = appendStoreFilter(where, params, 'po', req);

  const orders = db.prepare(`
    SELECT po.*, u.display_name as operator_name, o.order_no,
           o.customer_name AS order_customer, o.status AS order_status,
           (SELECT COALESCE(SUM(quantity),0) FROM purchase_items pi WHERE pi.purchase_id = po.id) AS total_qty,
           (SELECT COALESCE(SUM(quantity),0) FROM purchase_items pi WHERE pi.purchase_id = po.id AND pi.arrived = 1) AS arrived_qty
    FROM purchase_orders po
    LEFT JOIN users u ON po.operator_id = u.id
    LEFT JOIN orders o ON po.order_id = o.id
    ${where}
    ORDER BY po.id DESC
  `).all(...params);
  res.json(orders);
});

// 进货单详情（仅管理员/老板）
router.get('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const sc = storeClauseAndParams(req, 'po');
  const po = db.prepare(`
    SELECT po.*, u.display_name as operator_name, o.order_no
    FROM purchase_orders po
    LEFT JOIN users u ON po.operator_id = u.id
    LEFT JOIN orders o ON po.order_id = o.id
    WHERE po.id = ? ${sc.clause}
  `).get(req.params.id, ...sc.params);
  if (!po) return res.status(404).json({ error: '进货单不存在' });

  const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id);
  res.json({ ...po, items });
});

// 创建进货单
router.post('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const { supplier, items, note, arrival_warehouse, order_id, purchase_type, payment_voucher } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: '请添加进货商品' });

  const db = getDb();
  const poNo = generatePoNo();
  const poStoreId = order_id
    ? (db.prepare('SELECT store_id FROM orders WHERE id = ?').get(order_id)?.store_id || 1)
    : resolveWriteStoreId(req);
  let totalAmount = 0;
  const pt = purchase_type || (order_id ? 'order' : 'restock');

  const validItems = [];
  for (const item of items) {
    if (!item.product_name || !item.quantity || item.quantity <= 0) continue;
    const totalPrice = (item.unit_price || 0) * item.quantity;
    totalAmount += totalPrice;
    validItems.push({ ...item, total_price: totalPrice });
  }

  if (validItems.length === 0) return res.status(400).json({ error: '请添加有效商品' });

  const result = db.transaction(() => {
    const r = db.prepare(`INSERT INTO purchase_orders
      (po_no, supplier, total_amount, note, operator_id, order_id, arrival_warehouse, purchase_type, payment_voucher, store_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(poNo, supplier || null, totalAmount, note || null, req.user.id, pt === 'order' ? (order_id || null) : null, arrival_warehouse || '', pt, payment_voucher || '', poStoreId);

    const po = { order_id: pt === 'order' ? (order_id || null) : null };
    for (const item of validItems) {
      db.prepare(`INSERT INTO purchase_items
        (purchase_id, product_id, product_name, brand, model, spec, quantity, unit_price, total_price, note, remain_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(r.lastInsertRowid, item.product_id || null, item.product_name,
          item.brand || '', item.model || '', item.spec || '',
          item.quantity, item.unit_price || 0, item.total_price, item.note || '', item.quantity);

      // 同步进货单价到关联订单项（财务核算利润口径），不再写入商品进价
      syncOrderItemCost(db, po, item);
    }
    return r;
  })();

  res.json({ id: result.lastInsertRowid, po_no: poNo, message: '进货单创建成功', purchase_type: pt });
});

// 编辑进货单
router.put('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '进货单不存在' });
  if (po.status === 'arrived' && req.user.role !== 'admin') return res.status(400).json({ error: '已到货的进货单不能编辑' });

  const { supplier, note, arrival_warehouse, items, payment_voucher } = req.body;

  let totalAmount = 0;
  const validItems = [];
  if (items && items.length > 0) {
    for (const item of items) {
      if (!item.product_name || !item.quantity || item.quantity <= 0) continue;
      const totalPrice = (item.unit_price || 0) * item.quantity;
      totalAmount += totalPrice;
      validItems.push({ ...item, total_price: totalPrice });
    }
  }

  if (items && items.length > 0 && validItems.length === 0) {
    return res.status(400).json({ error: '请添加有效商品' });
  }

  db.transaction(() => {
    // 更新主表
    const fields = [
      'updated_at = datetime(\'now\',\'localtime\')'
    ];
    const values = [];
    if (supplier !== undefined) { fields.push('supplier = ?'); values.push(supplier); }
    if (note !== undefined) { fields.push('note = ?'); values.push(note); }
    if (arrival_warehouse !== undefined) { fields.push('arrival_warehouse = ?'); values.push(arrival_warehouse); }
    if (payment_voucher !== undefined) { fields.push('payment_voucher = ?'); values.push(payment_voucher); }
    if (validItems.length > 0) { fields.push('total_amount = ?'); values.push(totalAmount); }

    db.prepare(`UPDATE purchase_orders SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, po.id);

    // 更新明细：先删后插
    if (validItems.length > 0) {
      db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(po.id);
      for (const item of validItems) {
        db.prepare(`INSERT INTO purchase_items
          (purchase_id, product_id, product_name, brand, model, spec, quantity, unit_price, total_price, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(po.id, item.product_id || null, item.product_name,
            item.brand || '', item.model || '', item.spec || '',
            item.quantity, item.unit_price || 0, item.total_price, item.note || '');

        // 同步进货单价到关联订单项（财务核算利润口径），不再写入商品进价
        syncOrderItemCost(db, po, item);
      }
    }
  })();

  const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(po.id);
  res.json({ message: '进货单已更新', purchase: updated });
});

// 进货单明细项逐条到货
router.post('/:id/items/:itemId/arrive', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '进货单不存在' });
  if (po.status === 'cancelled') return res.status(400).json({ error: '进货单已取消' });

  const item = db.prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: '进货项不存在' });
  if (item.arrived) return res.status(400).json({ error: '该商品已到货' });

  const { warehouse, arrival_voucher } = req.body;
  if (!warehouse) return res.status(400).json({ error: '请选择到货仓库' });

  // 标记该项为已到货
  db.prepare(`UPDATE purchase_items SET arrived = 1, arrived_warehouse = ?, arrival_voucher = ? WHERE id = ?`)
    .run(warehouse, arrival_voucher || '', item.id);

  // 同步更新关联的订单项状态
  if (po.order_id) {
    const orderItem = findMatchingOrderItem(db, po, item);
    if (orderItem) {
      db.prepare(`UPDATE order_items SET item_status = 'arrived', warehouse = ?
        WHERE id = ?`).run(warehouse, orderItem.id);
    }
  }

  // 样品补货：到货后直接增补样品库存
  if (po.purchase_type === 'restock' && item.product_id) {
    adjustStock(item.product_id, item.quantity, { type: 'in', reason: '样品补货到仓' });
  }

  // 检查该进货单是否所有项目都已到货
  const allItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id);
  const allArrived = allItems.every(i => i.arrived === 1);

  if (allArrived) {
    db.prepare(`UPDATE purchase_orders SET status = 'arrived', updated_at = datetime('now','localtime') WHERE id = ?`).run(po.id);
  }

  // 重新评估关联订单的齐货状态（按订单项 item_status 判断，而非进货单维度）
  if (po.order_id) reassessOrderArrival(db, po.order_id);

  res.json({
    message: allArrived ? '所有商品已到货' : `商品已到货 (${allItems.filter(i => i.arrived).length}/${allItems.length})`,
    all_arrived: allArrived,
  });
});

// 进货单到货（整单）- 保留兼容
router.post('/:id/arrive', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '进货单不存在' });
  if (!['pending', 'ordered'].includes(po.status)) {
    return res.status(400).json({ error: '当前状态不能操作到货' });
  }

  const warehouse = po.arrival_warehouse || '';
  const { arrival_voucher } = req.body;

  db.transaction(() => {
    // 标记进货单已到货
    db.prepare(`UPDATE purchase_orders SET status = 'arrived', updated_at = datetime('now','localtime') WHERE id = ?`).run(po.id);

    // 标记所有进货项到货，并级联回写关联订单项（修复 M2：整单到货不推进订单状态）
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id);
    for (const item of items) {
      db.prepare(`UPDATE purchase_items SET arrived = 1, arrived_warehouse = ?, arrival_voucher = ? WHERE id = ?`)
        .run(warehouse || item.arrived_warehouse || '', arrival_voucher || '', item.id);

      // 样品补货类进货单：整单到货时同步增补样品/可用库存（与单品到货逻辑保持一致，修复库存漏加）
      if (po.purchase_type === 'restock' && item.product_id) {
        adjustStock(item.product_id, item.quantity, { type: 'in', reason: '样品补货到仓（整单到货）' });
      }

      // 回写关联的订单项状态（仅当该订单项已分配满，避免部分分配误标全到）
      if (po.order_id) {
        const orderItem = findMatchingOrderItem(db, po, item);
        if (orderItem && orderItem.allocated >= orderItem.quantity) {
          db.prepare(`UPDATE order_items SET item_status = 'arrived', warehouse = ?
            WHERE id = ?`).run(warehouse || item.arrived_warehouse || '', orderItem.id);
        }
      }
    }

    // 重新评估关联订单的齐货状态（与单品到货逻辑一致）
    if (po.order_id) reassessOrderArrival(db, po.order_id);
  })();

  // 检查是否有订货商品需要分配到订单
  const itemsAfter = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id);
  const unallocated = itemsAfter.filter(i => i.allocated < i.quantity);

  res.json({
    message: '进货单已到货',
    items: itemsAfter,
    unallocated_count: unallocated.length,
    hint: unallocated.length > 0 ? '还有商品需要分配到订单' : null
  });
});

// 分配进货商品到订单
router.post('/:id/allocate', roleMiddleware('admin', 'boss'), (req, res) => {
  const { allocations } = req.body;
  if (!allocations || allocations.length === 0) return res.status(400).json({ error: '请选择分配方案' });

  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '进货单不存在' });

  db.transaction(() => {
    for (const alloc of allocations) {
      const { purchase_item_id, order_item_id, quantity } = alloc;
      if (!purchase_item_id || !order_item_id || !quantity || quantity <= 0) continue;

      // 检查进货项剩余可分配数量
      const pi = db.prepare('SELECT * FROM purchase_items WHERE id = ?').get(purchase_item_id);
      if (!pi) throw new Error(`进货项 ${purchase_item_id} 不存在`);
      const remaining = pi.quantity - pi.allocated;
      if (remaining < quantity) throw new Error(`进货项 "${pi.product_name}" 可分配数量不足`);

      // 检查订单项剩余待分配
      const oi = db.prepare('SELECT * FROM order_items WHERE id = ?').get(order_item_id);
      if (!oi) throw new Error(`订单项 ${order_item_id} 不存在`);
      if (oi.product_type !== 'order') throw new Error(`订单项 "${oi.product_name}" 不是订货商品`);
      const need = oi.quantity - oi.allocated;
      if (need < quantity) throw new Error(`订单项 "${oi.product_name}" 待分配数量不足`);

      // 创建分配记录
      db.prepare('INSERT INTO allocations (purchase_item_id, order_item_id, quantity, operator_id) VALUES (?, ?, ?, ?)')
        .run(purchase_item_id, order_item_id, quantity, req.user.id);

      // 更新进货项已分配数量
      db.prepare('UPDATE purchase_items SET allocated = allocated + ? WHERE id = ?').run(quantity, purchase_item_id);

      // 更新订单项已分配数量
      db.prepare('UPDATE order_items SET allocated = allocated + ? WHERE id = ?').run(quantity, order_item_id);
    }
  })();

  res.json({ message: '分配成功' });
});

// 删除进货单（仅管理员/老板）
router.delete('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id);
  if (!po) return res.status(404).json({ error: '进货单不存在' });
  if (po.status === 'arrived' && req.user.role !== 'admin') return res.status(400).json({ error: '已到货的进货单不能删除' });

  db.transaction(() => {
    const items = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(po.id);
    // 撤销这些进货项产生的分配，并回滚对应订单项的已分配数量，
    // 避免外键冲突导致 500，同时防止订单项 allocated 残留脏数据
    if (items.length) {
      const itemIds = items.map(i => i.id);
      const placeholders = itemIds.map(() => '?').join(',');
      const allocs = db.prepare(`SELECT order_item_id, quantity FROM allocations WHERE purchase_item_id IN (${placeholders})`).all(...itemIds);
      for (const a of allocs) {
        if (a.order_item_id) {
          db.prepare('UPDATE order_items SET allocated = MAX(0, allocated - ?) WHERE id = ?').run(a.quantity, a.order_item_id);
        }
      }
      db.prepare(`DELETE FROM allocations WHERE purchase_item_id IN (${placeholders})`).run(...itemIds);
    }
    // 样品补货类：若该进货项已到货，删除时回滚曾增补的样品库存，避免库存虚高
    if (po.purchase_type === 'restock') {
      for (const item of items) {
        if (item.arrived && item.product_id) {
          adjustStock(item.product_id, item.quantity, { type: 'out', reason: '删除样品补货单回滚' });
        }
      }
    }
    db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(po.id);
    db.prepare('DELETE FROM purchase_orders WHERE id = ?').run(po.id);
  })();
  auditDelete(req, TARGET_TYPES.PURCHASE, po.id, po);
  res.json({ message: '进货单已删除' });
});

// 获取待分配的订单项（用于进货分配时选择）
router.get('/pending-allocations/orders', (req, res) => {
  const db = getDb();
  const sc = storeClauseAndParams(req, 'o');
  const items = db.prepare(`
    SELECT oi.*, o.order_no, o.customer_name, o.status as order_status
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.product_type = 'order' AND oi.allocated < oi.quantity
      AND o.status IN ('deposited', 'purchasing', 'arrived') ${sc.clause}
    ORDER BY o.id DESC
  `).all(...sc.params);
  res.json(items);
});

export default router;
