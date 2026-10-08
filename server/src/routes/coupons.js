import { Router } from 'express';
import { getDb, getConfigFlag } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 校验券是否可用，并返回可减额。供开单核销（orders 路由也会复用，防前端造假）。
export function verifyCoupon(db, code, orderAmount, productIds = [], channel = '') {
  // 抖音等平台渠道券独立于门店促销总开关：门店仅做核减记录，不被门店促销开关卡住
  if (channel !== 'douyin') {
    if (!getConfigFlag(db, 'promo_enabled')) return { valid: false, msg: '促销功能未开启' };
    if (!getConfigFlag(db, 'promo_coupon_enabled')) return { valid: false, msg: '优惠券功能未开启' };
  }
  const c = db.prepare('SELECT * FROM coupons WHERE code = ?').get(code);
  if (!c) return { valid: false, msg: '券码不存在' };
  if (c.status !== 1) return { valid: false, msg: '该券已停用' };
  const today = localToday();
  if (c.start && today < c.start) return { valid: false, msg: '尚未到使用时间' };
  if (c.end && today > c.end) return { valid: false, msg: '券已过期' };
  if (c.total_qty > 0 && c.used_qty >= c.total_qty) return { valid: false, msg: '券已被领完' };

  // 适用范围校验
  if (c.scope === 'category' && productIds.length) {
    const cats = c.scope_ids.split(',').map(s => s.trim()).filter(Boolean);
    if (cats.length) {
      const ph = productIds.map(() => '?').join(',');
      const ch = cats.map(() => '?').join(',');
      const r = db.prepare(`SELECT COUNT(*) c FROM products WHERE id IN (${ph}) AND category IN (${ch})`).get(...productIds, ...cats);
      if (!r || r.c === 0) return { valid: false, msg: '当前商品不适用此券' };
    }
  }
  if (c.scope === 'product' && productIds.length) {
    const ids = c.scope_ids.split(',').map(s => Number(s.trim())).filter(Boolean);
    if (!productIds.some(pid => ids.includes(Number(pid)))) return { valid: false, msg: '当前商品不适用此券' };
  }

  const amt = Number(orderAmount) || 0;
  let discount = 0;
  if (c.type === 'full_reduce') {
    if (amt < Number(c.threshold)) return { valid: false, msg: `满${c.threshold}元可用` };
    discount = Number(c.value) || 0;
  } else if (c.type === 'instant') {
    discount = Number(c.value) || 0;
  } else if (c.type === 'discount') {
    if (c.threshold > 0 && amt < Number(c.threshold)) return { valid: false, msg: `满${c.threshold}元可用` };
    discount = Math.round(amt * (1 - Number(c.value)) * 100) / 100;
  }
  discount = Math.min(discount, amt);
  return { valid: true, discount_amount: discount, type: c.type, value: c.value };
}

function genCode(db) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 10; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) s += chars[Math.floor(Math.random() * chars.length)];
    if (!db.prepare('SELECT code FROM coupons WHERE code = ?').get(s)) return s;
  }
  return 'CP' + Date.now().toString().slice(-8);
}

// 列表（管理端）
router.get('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const list = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  res.json(list);
});

// 创建
router.post('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const { type, threshold, value, scope, scope_ids, start, end, total_qty, code, channel } = req.body;
  if (!['full_reduce', 'discount', 'instant'].includes(type)) {
    return res.status(400).json({ error: '券类型无效' });
  }
  if (value === undefined || value === null || isNaN(Number(value))) {
    return res.status(400).json({ error: '面值/折扣无效' });
  }
  const db = getDb();
  const finalCode = (code && String(code).trim()) ? String(code).trim().toUpperCase() : genCode(db);
  if (db.prepare('SELECT code FROM coupons WHERE code = ?').get(finalCode)) {
    return res.status(400).json({ error: '券码已存在，请换一个' });
  }
  db.prepare(`INSERT INTO coupons (code, type, threshold, value, scope, scope_ids, start, end, total_qty, status, channel)
    VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(
    finalCode, type, Number(threshold) || 0, Number(value), scope || 'all', scope_ids || '', start || '', end || '', Number(total_qty) || 0, channel || 'all'
  );
  res.json({ code: finalCode, message: '创建成功' });
});

// 更新
router.put('/:code', roleMiddleware('admin', 'boss'), (req, res) => {
  const { type, threshold, value, scope, scope_ids, start, end, total_qty, status, channel } = req.body;
  const db = getDb();
  if (!db.prepare('SELECT code FROM coupons WHERE code = ?').get(req.params.code)) {
    return res.status(404).json({ error: '券不存在' });
  }
  const fields = [], vals = [];
  if (type !== undefined) { fields.push('type = ?'); vals.push(type); }
  if (threshold !== undefined) { fields.push('threshold = ?'); vals.push(Number(threshold) || 0); }
  if (value !== undefined) { fields.push('value = ?'); vals.push(Number(value)); }
  if (scope !== undefined) { fields.push('scope = ?'); vals.push(scope); }
  if (scope_ids !== undefined) { fields.push('scope_ids = ?'); vals.push(scope_ids); }
  if (start !== undefined) { fields.push('start = ?'); vals.push(start || ''); }
  if (end !== undefined) { fields.push('end = ?'); vals.push(end || ''); }
  if (total_qty !== undefined) { fields.push('total_qty = ?'); vals.push(Number(total_qty) || 0); }
  if (status !== undefined) { fields.push('status = ?'); vals.push(status ? 1 : 0); }
  if (channel !== undefined) { fields.push('channel = ?'); vals.push(channel || 'all'); }
  if (!fields.length) return res.status(400).json({ error: '没有需要更新的字段' });
  vals.push(req.params.code);
  db.prepare(`UPDATE coupons SET ${fields.join(', ')} WHERE code = ?`).run(...vals);
  res.json({ message: '更新成功' });
});

// 删除
router.delete('/:code', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const coupon = db.prepare('SELECT rowid AS id, * FROM coupons WHERE code = ?').get(req.params.code);
  db.prepare('DELETE FROM coupon_usages WHERE coupon_code = ?').run(req.params.code);
  db.prepare('DELETE FROM coupons WHERE code = ?').run(req.params.code);
  if (coupon) auditDelete(req, TARGET_TYPES.COUPON, coupon.id, coupon);
  res.json({ message: '删除成功' });
});

// 核销校验（开单时调用，不写记录，仅返回可减额）
router.post('/verify', (req, res) => {
  const { code, order_amount, product_ids, channel } = req.body;
  if (!code) return res.status(400).json({ valid: false, msg: '请输入券码' });
  const db = getDb();
  const r = verifyCoupon(db, String(code).trim().toUpperCase(), order_amount, product_ids || [], channel || '');
  if (!r.valid) return res.json({ valid: false, msg: r.msg });
  res.json({ valid: true, discount_amount: r.discount_amount, type: r.type });
});

// 自动选取某渠道最优券（如抖音券），供结账自动核销。
// 不写 used_qty（落单时由 orders 路由统一处理），仅返回可减额。
function calcDiscount(c, amount) {
  const amt = Number(amount) || 0;
  let d = 0;
  if (c.type === 'full_reduce') { if (amt >= Number(c.threshold)) d = Number(c.value) || 0; }
  else if (c.type === 'instant') d = Number(c.value) || 0;
  else if (c.type === 'discount') { if (!c.threshold || amt >= Number(c.threshold)) d = Math.round(amt * (1 - Number(c.value)) * 100) / 100; }
  return Math.min(d, amt);
}
router.post('/auto', (req, res) => {
  const { channel, order_amount, product_ids } = req.body;
  if (!channel) return res.status(400).json({ valid: false, msg: '缺少渠道' });
  const db = getDb();
  // 抖音渠道券独立于门店促销总开关
  if (channel !== 'douyin' && (!getConfigFlag(db, 'promo_enabled') || !getConfigFlag(db, 'promo_coupon_enabled'))) {
    return res.json({ valid: false, msg: '促销/优惠券未开启' });
  }
  const today = localToday();
  const ids = (product_ids || []).map(Number).filter(Boolean);
  const rows = db.prepare(
    `SELECT * FROM coupons WHERE status = 1 AND channel = ? AND (start = '' OR start <= ?) AND (end = '' OR end >= ?)`
  ).all(channel, today, today);
  let best = null;
  for (const c of rows) {
    if (c.scope === 'product') {
      const cid = c.scope_ids.split(',').map(s => Number(s.trim())).filter(Boolean);
      if (!ids.some(id => cid.includes(id))) continue;
    } else if (c.scope === 'category') {
      const cats = c.scope_ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const prodCats = db.prepare(`SELECT DISTINCT category FROM products WHERE id IN (${ph})`).all(...ids).map(r => r.category);
        if (!cats.some(cat => prodCats.includes(cat))) continue;
      }
    }
    const d = calcDiscount(c, Number(order_amount) || 0);
    if (!best || d > best.discount_amount) best = { code: c.code, discount_amount: d, type: c.type };
  }
  if (!best || best.discount_amount <= 0) return res.json({ valid: false, msg: '暂无可用券' });
  res.json({ valid: true, ...best });
});

export default router;
