// 门店管理（v5.0 Phase 1）
// 仅 admin/boss 可增删改；列表对所有登录用户开放（销售员也要看到门店名用于展示）。
import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 列表（含负责人姓名、启用状态）
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.*, u.display_name AS manager_name
    FROM stores s
    LEFT JOIN users u ON s.manager_id = u.id
    ORDER BY s.is_active DESC, s.id
  `).all();
  res.json({ success: true, stores: rows });
});

// 分店业绩对比 + 汇总（Phase 1 #272-A，仅 admin/boss）
// 按月汇总各门店：订单数 / 实收金额 / 利润(实收-货品成本) / 月度目标 / 达成率，并返回 total 汇总
router.get('/comparison', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);
  const ms = String(month).padStart(2, '0');
  const monthStart = `${year}-${ms}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  const stores = db.prepare('SELECT id, name FROM stores ORDER BY is_active DESC, id').all();

  // 复用 dashboard 口径；日期参数在前，store_id 在后（better-sqlite3 占位符顺序铁律）
  const qOrderCount = db.prepare(
    `SELECT COUNT(*) c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' AND o.store_id = ?`
  );
  const qRevenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) v
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' AND o.store_id = ?
  `);
  const qGoodsCost = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0) v
    FROM order_items oi JOIN orders o ON oi.order_id = o.id LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' AND o.store_id = ?
  `);
  const qTarget = db.prepare(
    `SELECT COALESCE(target_amount, 0) v FROM monthly_targets WHERE year = ? AND month = ? AND store_id = ? AND user_id IS NULL`
  );

  const rows = stores.map(s => {
    const order_count = qOrderCount.get(monthStart, nextMonth, s.id).c;
    const revenue = qRevenue.get(monthStart, nextMonth, s.id).v;
    const goods_cost = qGoodsCost.get(monthStart, nextMonth, s.id).v;
    const target_amount = qTarget.get(year, month, s.id).v;
    const profit = revenue - goods_cost;
    const ratio = target_amount > 0 ? Math.round(revenue / target_amount * 100) : 0;
    return {
      store_id: s.id,
      store_name: s.name,
      order_count,
      revenue,
      goods_cost,
      profit,
      target_amount,
      ratio,
    };
  });

  const total = {
    order_count: rows.reduce((a, r) => a + r.order_count, 0),
    revenue: rows.reduce((a, r) => a + r.revenue, 0),
    goods_cost: rows.reduce((a, r) => a + r.goods_cost, 0),
    profit: rows.reduce((a, r) => a + r.profit, 0),
    target_amount: rows.reduce((a, r) => a + r.target_amount, 0),
    ratio: 0,
  };
  total.ratio = total.target_amount > 0 ? Math.round(total.revenue / total.target_amount * 100) : 0;

  res.json({ success: true, year, month, stores: rows, total });
});

// 新增门店
router.post('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const { name, code, address, phone, manager_id } = req.body || {};
  const storeName = (name || '').trim();
  if (!storeName) return res.status(400).json({ success: false, error: '门店名称不能为空' });
  const info = db.prepare(`
    INSERT INTO stores (name, code, address, phone, manager_id, is_active, created_at, updated_at)
    VALUES (?,?,?,?,?,1, datetime('now','localtime'), datetime('now','localtime'))
  `).run(storeName, (code || '').trim(), address || '', phone || '', manager_id ? Number(manager_id) : null);
  const row = db.prepare(
    'SELECT s.*, u.display_name AS manager_name FROM stores s LEFT JOIN users u ON s.manager_id = u.id WHERE s.id = ?'
  ).get(info.lastInsertRowid);
  res.json({ success: true, store: row });
});

// 编辑门店
router.put('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { name, code, address, phone, manager_id } = req.body || {};
  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(id);
  if (!store) return res.status(404).json({ success: false, error: '门店不存在' });

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push((name || '').trim()); }
  if (code !== undefined) { fields.push('code = ?'); values.push((code || '').trim()); }
  if (address !== undefined) { fields.push('address = ?'); values.push(address || ''); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone || ''); }
  if (manager_id !== undefined) { fields.push('manager_id = ?'); values.push(manager_id ? Number(manager_id) : null); }
  if (!fields.length) return res.status(400).json({ success: false, error: '没有需要更新的字段' });
  fields.push("updated_at = datetime('now','localtime')");
  values.push(id);
  db.prepare(`UPDATE stores SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare(
    'SELECT s.*, u.display_name AS manager_name FROM stores s LEFT JOIN users u ON s.manager_id = u.id WHERE s.id = ?'
  ).get(id);
  res.json({ success: true, store: row });
});

// 启停切换：禁止停用最后一个启用中的门店
router.post('/:id/toggle', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const store = db.prepare('SELECT id, is_active FROM stores WHERE id = ?').get(id);
  if (!store) return res.status(404).json({ success: false, error: '门店不存在' });
  const next = store.is_active ? 0 : 1;
  if (next === 0) {
    const activeCount = db.prepare('SELECT COUNT(*) AS c FROM stores WHERE is_active = 1').get().c;
    if (activeCount <= 1) return res.status(400).json({ success: false, error: '至少需保留一个启用中的门店' });
  }
  db.prepare("UPDATE stores SET is_active = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(next, id);
  const row = db.prepare(
    'SELECT s.*, u.display_name AS manager_name FROM stores s LEFT JOIN users u ON s.manager_id = u.id WHERE s.id = ?'
  ).get(id);
  res.json({ success: true, store: row });
});

export default router;
