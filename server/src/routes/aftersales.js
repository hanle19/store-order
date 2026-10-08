import express from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { adjustStock, adjustVariantStock } from '../stock.js';
import { storeClauseAndParams } from '../utils/storeScope.js';

const router = express.Router();

// XSS 防护：打印页对用户字段做 HTML 转义
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 操作日志（复用 operation_logs 表，created_at 走表默认值）
function logOp(db, target_type, target_id, action, operatorId, operatorName, reason, oldStatus, newStatus, details) {
  db.prepare(`INSERT INTO operation_logs
    (target_type, target_id, action, operator_id, operator_name, reason, old_status, new_status, details)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(target_type, target_id, action, operatorId, operatorName || '', reason || '', oldStatus || '', newStatus || '', JSON.stringify(details || {}));
}

// 某订单明细行已退/换数量（仅统计未取消的退/换单）
function returnedQty(db, orderItemId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(ori.quantity),0) AS qty
    FROM order_return_items ori
    JOIN order_returns r ON r.id = ori.return_id
    WHERE ori.order_item_id = ? AND ori.action IN ('return_in','exchange_out') AND r.status != 'cancelled'
  `).get(orderItemId);
  return row ? Number(row.qty) : 0;
}

// 应用退/换库存（在外部事务内调用，adjustStock 会自动 inline 执行）
function applyReturnStock(db, ret, items, operatorId) {
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty === 0) continue;
    if (it.action === 'return_in' || it.action === 'exchange_out') {
      const reason = ret.type === 'exchange' ? '换货-旧品退库' : '退货回库';
      if (it.variant_id) adjustVariantStock(it.variant_id, qty, { reason, orderId: ret.order_id, operatorId });
      else if (it.product_id) adjustStock(it.product_id, qty, { reason, orderId: ret.order_id, operatorId });
    } else if (it.action === 'exchange_in') {
      if (it.new_variant_id) adjustVariantStock(it.new_variant_id, -qty, { reason: '换货-换出新品', orderId: ret.order_id, operatorId });
      else if (it.new_product_id) adjustStock(it.new_product_id, -qty, { reason: '换货-换出新品', orderId: ret.order_id, operatorId });
    }
  }
}

// 撤销退/换库存（精确反向）
function reverseReturnStock(db, ret, items, operatorId) {
  for (const it of items) {
    const qty = Number(it.quantity) || 0;
    if (qty === 0) continue;
    if (it.action === 'return_in' || it.action === 'exchange_out') {
      const reason = '撤销退/换单-回滚';
      if (it.variant_id) adjustVariantStock(it.variant_id, -qty, { reason, orderId: ret.order_id, operatorId });
      else if (it.product_id) adjustStock(it.product_id, -qty, { reason, orderId: ret.order_id, operatorId });
    } else if (it.action === 'exchange_in') {
      if (it.new_variant_id) adjustVariantStock(it.new_variant_id, qty, { reason: '撤销退/换单-回滚', orderId: ret.order_id, operatorId });
      else if (it.new_product_id) adjustStock(it.new_product_id, qty, { reason: '撤销退/换单-回滚', orderId: ret.order_id, operatorId });
    }
  }
}

// =====================================================
// 退货 / 换货
// =====================================================

// 新建退/换单（管理员）
router.post('/:id/returns', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const orderId = Number(req.params.id);
    const { type, reason = '', refund_amount = 0, diff_amount = 0, note = '', status: bodyStatus, items = [] } = req.body;
    if (!['return', 'exchange'].includes(type)) return res.status(400).json({ error: 'type 必须是 return 或 exchange' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    if (!['signed', 'completed'].includes(order.status)) return res.status(400).json({ error: '仅已签收/已完工的订单可退换' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: '请至少选择一件商品' });

    // 校验 action 与 type 一致，避免脏数据导致库存逻辑错乱
    if (type === 'return') {
      for (const it of items) if (it.action !== 'return_in') throw new Error('退货单明细 action 必须为 return_in');
    } else {
      let hasOut = false;
      for (const it of items) {
        if (it.action === 'exchange_in') {
          if (!it.new_product_id) throw new Error('换货单的「换出新品」必须指定商品');
        } else if (it.action === 'exchange_out') {
          hasOut = true;
        } else {
          throw new Error('换货单明细 action 必须为 exchange_out / exchange_in');
        }
      }
      if (!hasOut) throw new Error('换货单至少需包含一个旧品退库（exchange_out）');
    }

    const result = db.transaction(() => {
      const oiMap = {};
      db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId).forEach(it => { oiMap[it.id] = it; });
      for (const it of items) {
        const qty = Number(it.quantity) || 0;
        if (qty <= 0) throw new Error('退换数量必须大于 0');
        if (it.order_item_id) {
          const oi = oiMap[it.order_item_id];
          if (!oi) throw new Error('关联的订单商品不存在');
          const remaining = (Number(oi.quantity) || 0) - returnedQty(db, it.order_item_id);
          if (qty > remaining) throw new Error(`商品「${oi.product_name}」剩余可退数量为 ${remaining}，超过不可退`);
        }
      }
      const status = bodyStatus || 'completed';
      const retInfo = db.prepare(`INSERT INTO order_returns
        (order_id, type, status, reason, refund_amount, diff_amount, note, operator_id, operator_name, stock_applied, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`)
        .run(orderId, type, status, reason, Number(refund_amount) || 0, Number(diff_amount) || 0, note, req.user.id, req.user.display_name || '', status === 'completed' ? 1 : 0);
      const returnId = retInfo.lastInsertRowid;
      const insItem = db.prepare(`INSERT INTO order_return_items
        (return_id, order_item_id, product_id, variant_id, product_name, product_model, spec, action, quantity, unit_price, cost_price, new_product_id, new_variant_id, new_product_name, new_spec)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const it of items) {
        insItem.run(returnId, it.order_item_id || null, it.product_id || null, it.variant_id || null,
          it.product_name || '', it.product_model || '', it.spec || '', it.action, Number(it.quantity) || 0,
          Number(it.unit_price) || 0, Number(it.cost_price) || 0, it.new_product_id || null, it.new_variant_id || null,
          it.new_product_name || '', it.new_spec || '');
      }
      const ret = db.prepare('SELECT * FROM order_returns WHERE id = ?').get(returnId);
      const retItems = db.prepare('SELECT * FROM order_return_items WHERE return_id = ?').all(returnId);
      if (status === 'completed') {
        applyReturnStock(db, ret, retItems, req.user.id);
        db.prepare("UPDATE order_returns SET completed_at = datetime('now','localtime') WHERE id = ?").run(returnId);
      }
      logOp(db, 'order', orderId, type === 'return' ? 'return' : 'exchange', req.user.id, req.user.display_name || '', reason, order.status, status, { return_id: returnId });
      return { ret, items: retItems };
    })();
    res.json({ message: '退/换单已创建', return: result.ret, items: result.items });
  } catch (e) {
    console.error('[aftersales] create return error:', e);
    res.status(400).json({ error: e.message });
  }
});

// 某订单的退/换单列表 + 明细
router.get('/:id/returns', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const orderId = Number(req.params.id);
    const sc = storeClauseAndParams(req, 'o');
    const returns = db.prepare(`SELECT r.* FROM order_returns r JOIN orders o ON o.id = r.order_id WHERE r.order_id = ? ${sc.clause} ORDER BY r.created_at DESC`).all(orderId, ...sc.params);
    for (const r of returns) r.items = db.prepare('SELECT * FROM order_return_items WHERE return_id = ?').all(r.id);
    res.json({ returns });
  } catch (e) {
    console.error('[aftersales] list returns error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 全局退/换单列表（财务/售后看板）—— 仅管理员/店长可见，避免导购越权查他人订单/客户
router.get('/returns', authMiddleware, roleMiddleware('admin', 'boss'), (req, res) => {
  try {
    const db = getDb();
    const { type, status } = req.query;
    const sc = storeClauseAndParams(req, 'o');
    let sql = `SELECT r.*, o.order_no, o.customer_name FROM order_returns r LEFT JOIN orders o ON o.id = r.order_id WHERE 1=1`;
    const params = [];
    if (type) { sql += ' AND r.type = ?'; params.push(type); }
    if (status) { sql += ' AND r.status = ?'; params.push(status); }
    sql += sc.clause + ' ORDER BY r.created_at DESC';
    const returns = db.prepare(sql).all(...params, ...sc.params);
    res.json({ returns });
  } catch (e) {
    console.error('[aftersales] global returns error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 改退/换单状态（管理员）；completed 应用库存，cancelled(从completed) 精确回滚
router.put('/returns/:rid', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const rid = Number(req.params.rid);
    const { status } = req.body;
    const valid = ['pending', 'processing', 'completed', 'cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: '无效状态' });
    const result = db.transaction(() => {
      const ret = db.prepare('SELECT * FROM order_returns WHERE id = ?').get(rid);
      if (!ret) throw new Error('退/换单不存在');
      if (ret.status === status) return ret;
      const items = db.prepare('SELECT * FROM order_return_items WHERE return_id = ?').all(rid);
      const old = ret.status;
      // 以 stock_applied 为唯一真相：进入完成态且未应用→应用；离开完成态且已应用→精确回滚。
      // 任何中间态反复切换（completed→processing→completed 等）均幂等，杜绝库存重复加减。
      const applied = ret.stock_applied || 0;
      const willFulfill = (status === 'completed');
      if (willFulfill && !applied) {
        applyReturnStock(db, ret, items, req.user.id);
        db.prepare("UPDATE order_returns SET completed_at = datetime('now','localtime'), stock_applied = 1 WHERE id = ?").run(rid);
      } else if (!willFulfill && applied) {
        reverseReturnStock(db, ret, items, req.user.id);
        db.prepare("UPDATE order_returns SET stock_applied = 0 WHERE id = ?").run(rid);
      }
      db.prepare('UPDATE order_returns SET status = ? WHERE id = ?').run(status, rid);
      logOp(db, 'order', ret.order_id, 'return_status', req.user.id, req.user.display_name || '', '', old, status, { return_id: rid });
      return db.prepare('SELECT * FROM order_returns WHERE id = ?').get(rid);
    })();
    res.json({ message: '状态已更新', return: result });
  } catch (e) {
    console.error('[aftersales] update return error:', e);
    res.status(400).json({ error: e.message });
  }
});

// =====================================================
// 售后工单
// =====================================================

// 新建售后工单（管理员）
router.post('/:id/aftersales', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const orderId = Number(req.params.id);
    const { type, priority = 'normal', title = '', description = '', customer_name = '', customer_phone = '', handler = '', cost = 0, cost_type = '', items = [] } = req.body;
    if (!['repair', 'parts', 'complaint', 'other'].includes(type)) return res.status(400).json({ error: '无效售后类型' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: '订单不存在' });
    const result = db.transaction(() => {
      const ins = db.prepare(`INSERT INTO order_aftersales
        (order_id, type, status, priority, title, description, customer_name, customer_phone, handler, cost, cost_type, created_by, created_by_name, created_at)
        VALUES (?,?, 'pending', ?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))`);
      const info = ins.run(orderId, type, priority, title, description, customer_name, customer_phone, handler, Number(cost) || 0, cost_type, req.user.id, req.user.display_name || '');
      const aid = info.lastInsertRowid;
      if (type === 'parts' && Array.isArray(items)) {
        const insItem = db.prepare('INSERT INTO order_aftersales_items (aftersales_id, product_id, variant_id, product_name, spec, quantity) VALUES (?,?,?,?,?,?)');
        for (const it of items) {
          const q = Number(it.quantity) || 0;
          if (q <= 0) continue;
          insItem.run(aid, it.product_id || null, it.variant_id || null, it.product_name || '', it.spec || '', q);
        }
      }
      logOp(db, 'order', orderId, 'aftersales_create', req.user.id, req.user.display_name || '', '', 'pending', 'pending', { aftersales_id: aid, type });
      return db.prepare('SELECT * FROM order_aftersales WHERE id = ?').get(aid);
    })();
    res.json({ message: '售后工单已创建', aftersales: result });
  } catch (e) {
    console.error('[aftersales] create aftersales error:', e);
    res.status(400).json({ error: e.message });
  }
});

// 某订单的售后工单 + 时间线 + 补件明细
router.get('/:id/aftersales', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const orderId = Number(req.params.id);
    const sc = storeClauseAndParams(req, 'o');
    const list = db.prepare(`SELECT a.* FROM order_aftersales a JOIN orders o ON o.id = a.order_id WHERE a.order_id = ? ${sc.clause} ORDER BY a.created_at DESC`).all(orderId, ...sc.params);
    for (const a of list) {
      a.logs = db.prepare('SELECT * FROM order_aftersales_logs WHERE aftersales_id = ? ORDER BY created_at ASC').all(a.id);
      a.items = db.prepare('SELECT * FROM order_aftersales_items WHERE aftersales_id = ?').all(a.id);
    }
    res.json({ aftersales: list });
  } catch (e) {
    console.error('[aftersales] list aftersales error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 全局售后工单列表（待处理看板）—— 仅管理员/店长可见
router.get('/aftersales', authMiddleware, roleMiddleware('admin', 'boss'), (req, res) => {
  try {
    const db = getDb();
    const { type, status } = req.query;
    const sc = storeClauseAndParams(req, 'o');
    let sql = `SELECT a.*, o.order_no, o.customer_name FROM order_aftersales a LEFT JOIN orders o ON o.id = a.order_id WHERE 1=1`;
    const params = [];
    if (type) { sql += ' AND a.type = ?'; params.push(type); }
    if (status) { sql += ' AND a.status = ?'; params.push(status); }
    sql += sc.clause + ' ORDER BY a.created_at DESC';
    const list = db.prepare(sql).all(...params, ...sc.params);
    res.json({ aftersales: list });
  } catch (e) {
    console.error('[aftersales] global aftersales error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 追加售后处理记录（管理员）
router.post('/aftersales/:aid/log', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const aid = Number(req.params.aid);
    const { action = '', note = '' } = req.body;
    const a = db.prepare('SELECT * FROM order_aftersales WHERE id = ?').get(aid);
    if (!a) return res.status(404).json({ error: '工单不存在' });
    db.prepare(`INSERT INTO order_aftersales_logs (aftersales_id, action, note, operator_id, operator_name, created_at)
      VALUES (?,?,?,?,?, datetime('now','localtime'))`)
      .run(aid, action, note, req.user.id, req.user.display_name || '');
    res.json({ message: '已记录' });
  } catch (e) {
    console.error('[aftersales] add log error:', e);
    res.status(500).json({ error: e.message });
  }
});

// 改售后工单状态/费用（管理员）；完成"补件"时自动出库
router.put('/aftersales/:aid', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const aid = Number(req.params.aid);
    const { status, cost, cost_type, handler } = req.body;
    const result = db.transaction(() => {
      const a = db.prepare('SELECT * FROM order_aftersales WHERE id = ?').get(aid);
      if (!a) throw new Error('工单不存在');
      const old = a.status;
      if (status && ['pending', 'processing', 'completed', 'closed'].includes(status)) {
        if (status === 'completed' && old !== 'completed' && a.type === 'parts') {
          for (const it of db.prepare('SELECT * FROM order_aftersales_items WHERE aftersales_id = ?').all(aid)) {
            const q = Number(it.quantity) || 0;
            if (q <= 0) continue;
            if (it.variant_id) adjustVariantStock(it.variant_id, -q, { reason: '售后补件出库', orderId: a.order_id, operatorId: req.user.id });
            else if (it.product_id) adjustStock(it.product_id, -q, { reason: '售后补件出库', orderId: a.order_id, operatorId: req.user.id });
          }
        }
        if (status !== 'completed' && old === 'completed' && a.type === 'parts') {
          for (const it of db.prepare('SELECT * FROM order_aftersales_items WHERE aftersales_id = ?').all(aid)) {
            const q = Number(it.quantity) || 0;
            if (q <= 0) continue;
            if (it.variant_id) adjustVariantStock(it.variant_id, q, { reason: '撤销售后补件回库', orderId: a.order_id, operatorId: req.user.id });
            else if (it.product_id) adjustStock(it.product_id, q, { reason: '撤销售后补件回库', orderId: a.order_id, operatorId: req.user.id });
          }
        }
        if (status === 'completed') {
          db.prepare(`UPDATE order_aftersales SET status=?, completed_at=datetime('now','localtime') WHERE id=?`).run(status, aid);
        } else if (status === 'closed') {
          db.prepare(`UPDATE order_aftersales SET status=?, closed_at=datetime('now','localtime') WHERE id=?`).run(status, aid);
        } else {
          db.prepare('UPDATE order_aftersales SET status=? WHERE id=?').run(status, aid);
        }
        logOp(db, 'order', a.order_id, 'aftersales_status', req.user.id, req.user.display_name || '', '', old, status, { aftersales_id: aid });
      }
      const sets = []; const params = [];
      if (cost !== undefined) { sets.push('cost = ?'); params.push(Number(cost) || 0); }
      if (cost_type !== undefined) { sets.push('cost_type = ?'); params.push(cost_type); }
      if (handler !== undefined) { sets.push('handler = ?'); params.push(handler); }
      if (sets.length) { params.push(aid); db.prepare(`UPDATE order_aftersales SET ${sets.join(', ')} WHERE id = ?`).run(...params); }
      return db.prepare('SELECT * FROM order_aftersales WHERE id = ?').get(aid);
    })();
    res.json({ message: '工单已更新', aftersales: result });
  } catch (e) {
    console.error('[aftersales] update aftersales error:', e);
    res.status(400).json({ error: e.message });
  }
});

// =====================================================
// 打印：退货单 / 换货单（独立 HTML 打印页，复用合同打印机制）
// =====================================================
router.get('/:id/returns/:rid/print', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const orderId = Number(req.params.id);
    const rid = Number(req.params.rid);
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).send('订单不存在');
    const ret = db.prepare('SELECT * FROM order_returns WHERE id = ?').get(rid);
    if (!ret || Number(ret.order_id) !== orderId) return res.status(404).send('退/换单不存在');
    const items = db.prepare('SELECT * FROM order_return_items WHERE return_id = ?').all(rid);
    const configRows = db.prepare('SELECT key, value FROM system_config').all();
    const config = {};
    for (const row of configRows) config[row.key] = row.value;
    const storeName = config.store_name || '我的门店';
    const storeAddress = config.store_address || '';
    const storePhone = config.store_phone || '';

    const esc = escapeHtml;
    const isExchange = ret.type === 'exchange';
    const title = isExchange ? `${storeName} 换货单` : `${storeName} 退货单`;
    const statusLabel = { pending: '待处理', processing: '处理中', completed: '已完成', cancelled: '已取消' }[ret.status] || ret.status;
    const dateStr = (ret.completed_at || ret.created_at || '').replace('T', ' ').slice(0, 19);

    // 退货明细 / 换货旧品、新品分组
    const backItems = items.filter(it => it.action === 'return_in' || it.action === 'exchange_out');
    const newItems = items.filter(it => it.action === 'exchange_in');

    const rowHtml = (name, model, spec, qty, price) => `
      <tr>
        <td>${esc(name)}</td>
        <td>${esc(model)}</td>
        <td>${esc(spec)}</td>
        <td style="text-align:right">${qty}</td>
        <td style="text-align:right">¥${Number(price || 0).toFixed(2)}</td>
        <td style="text-align:right">¥${(Number(price || 0) * Number(qty || 0)).toFixed(2)}</td>
      </tr>`;

    let detailSection = '';
    if (!isExchange) {
      const total = backItems.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
      detailSection = `
        <h3>退货明细</h3>
        <table>
          <thead><tr><th>商品</th><th>型号</th><th>规格</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">小计</th></tr></thead>
          <tbody>${backItems.map(it => rowHtml(it.product_name, it.product_model, it.spec, it.quantity, it.unit_price)).join('')}</tbody>
        </table>
        <div class="total-row"><span>合计退款金额</span><span class="amount">¥${Number(ret.refund_amount || 0).toFixed(2)}</span></div>`;
    } else {
      const oldTotal = backItems.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
      const newTotal = newItems.reduce((s, it) => s + Number(it.unit_price || 0) * Number(it.quantity || 0), 0);
      detailSection = `
        <h3>旧品退库</h3>
        <table>
          <thead><tr><th>商品</th><th>型号</th><th>规格</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">小计</th></tr></thead>
          <tbody>${backItems.map(it => rowHtml(it.product_name, it.product_model, it.spec, it.quantity, it.unit_price)).join('')}</tbody>
        </table>
        <h3>换出新品</h3>
        <table>
          <thead><tr><th>商品</th><th>型号</th><th>规格</th><th style="text-align:right">数量</th><th style="text-align:right">单价</th><th style="text-align:right">小计</th></tr></thead>
          <tbody>${newItems.map(it => rowHtml(it.new_product_name, '', it.new_spec, it.quantity, it.unit_price)).join('')}</tbody>
        </table>
        <div class="total-row"><span>差价（正=客户补，负=退客户）</span><span class="amount">¥${Number(ret.diff_amount || 0).toFixed(2)}</span></div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #222; margin: 0; padding: 24px; }
  .page { max-width: 794px; margin: 0 auto; }
  .header-title { text-align: center; margin-bottom: 8px; }
  .header-title h1 { font-size: 22px; margin: 0 0 6px; }
  .header-line { border-top: 2px solid #333; margin: 0 auto 16px; width: 200px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 13px; margin-bottom: 16px; }
  .meta div { min-width: 30%; }
  h3 { font-size: 15px; margin: 18px 0 8px; border-left: 4px solid #A88C78; padding-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #ddd; padding: 7px 9px; }
  thead th { background: #f5f0ea; }
  .total-row { display: flex; justify-content: space-between; margin-top: 10px; font-size: 15px; font-weight: 600; }
  .total-row .amount { color: #b14a3a; }
  .reason { font-size: 13px; margin-top: 12px; color: #555; }
  .footer { margin-top: 28px; display: flex; justify-content: space-between; font-size: 13px; color: #666; }
  .print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 18px; background: #A88C78; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
  @media print { body { padding: 0; } .print-btn { display: none; } @page { size: A4; margin: 14mm; } }
</style></head>
<body>
<button class="print-btn" onclick="window.print()">打印</button>
<div class="page">
  <div class="header-title"><h1>${esc(title)}</h1><div class="header-line"></div></div>
  <div class="meta">
    <div>单号：${esc(ret.id)}</div>
    <div>原订单号：${esc(order.order_no)}</div>
    <div>客户：${esc(order.customer_name || '')}</div>
    <div>电话：${esc(order.customer_phone || '')}</div>
    <div>状态：${esc(statusLabel)}</div>
    <div>日期：${esc(dateStr)}</div>
    <div>操作人：${esc(ret.operator_name || '')}</div>
  </div>
  ${detailSection}
  ${ret.reason ? `<div class="reason">原因：${esc(ret.reason)}</div>` : ''}
  ${ret.note ? `<div class="reason">备注：${esc(ret.note)}</div>` : ''}
  <div class="footer">
    <div>${esc(storeName)}${storeAddress ? '　' + esc(storeAddress) : ''}</div>
    <div>${storePhone ? '电话：' + esc(storePhone) : ''}</div>
  </div>
</div>
<script>window.onload = function(){ if (window.location.search.indexOf('autoprint') >= 0) window.print(); };</script>
</body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[aftersales] print error:', e);
    res.status(500).send('打印生成失败');
  }
});

export default router;
