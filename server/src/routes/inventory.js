import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { adjustStock, adjustVariantStock } from '../stock.js';
import { storeClauseAndParams } from '../utils/storeScope.js';

const router = Router();
router.use(authMiddleware);

// 读取安全库存阈值（默认 5）
function getThreshold(db) {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'low_stock_threshold'").get();
  const v = row ? Number(row.value) : 5;
  return Number.isFinite(v) && v > 0 ? v : 5;
}

// 统一库存视图：所有上架商品（订货类只读 + 样品/赠品可手动出入库）
// 零破坏双轨制：订货类库存以 products.stock 为准（由开单/订货自动驱动），样品/赠品以 inventory 同步。
router.get('/all', (req, res) => {
  const db = getDb();
  const threshold = getThreshold(db);
  const products = db.prepare(`
    SELECT id, name, code, category, price, cost_price, unit, brand, model, spec, active, barcode, stock
    FROM products WHERE active = 1 ORDER BY category, name
  `).all();

  // 在途（已订未到）：派生自销售订单中「订货类」明细，且订单尚未签收/完成/取消的数量之和（单条 GROUP BY，避免逐商品 N+1）
  const transitRows = db.prepare(`
    SELECT oi.product_id AS pid, COALESCE(SUM(oi.quantity), 0) AS c
    FROM order_items oi JOIN orders o ON oi.order_id = o.id
    WHERE oi.product_type = 'order' AND o.status NOT IN ('signed','completed','cancelled')
    GROUP BY oi.product_id
  `).all();
  const transitMap = {};
  for (const r of transitRows) transitMap[r.pid] = r.c;

  // 规格一次性批量取出并按商品分组，避免逐商品 N+1
  const variantRows = db.prepare(
    'SELECT id, product_id, spec, price, cost_price, stock, active FROM product_variants WHERE active = 1 ORDER BY sort_order, id'
  ).all();
  const variantMap = {};
  for (const v of variantRows) {
    (variantMap[v.product_id] ||= []).push({ ...v, is_low: v.stock <= threshold });
  }

  const out = products.map(p => {
    const isManageable = p.category === 'sample' || p.category === 'gift';
    const variants = variantMap[p.id] || [];
    const inTransit = transitMap[p.id] || 0;

    return {
      ...p,
      is_manageable: isManageable,
      is_low: p.stock <= threshold,
      in_transit: inTransit,
      variants,
      threshold,
    };
  });

  res.json(out);
});

// 获取库存列表（含商品信息，仅样品/赠品；保留向后兼容）
router.get('/', (req, res) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT i.*, p.name, p.code, p.category, p.price, p.unit
    FROM inventory i JOIN products p ON i.product_id = p.id
    WHERE p.active = 1
    ORDER BY p.category, p.name
  `).all();
  res.json(items);
});

// 入库（仅管理员/老板，限样品/赠品）
router.post('/in', roleMiddleware('admin', 'boss'), (req, res) => {
  const { product_id, quantity, reason } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '参数无效' });
  }

  const db = getDb();
  const product = db.prepare("SELECT id FROM products WHERE id = ? AND category IN ('sample','gift')").get(product_id);
  if (!product) return res.status(400).json({ error: '该商品不是样品或赠品，无法管理库存' });

  const after = adjustStock(product_id, quantity, { reason: reason || '手动入库', operatorId: req.user.id, type: 'in' });
  res.json({ message: '入库成功', after_quantity: after });
});

// 出库（仅管理员/老板，限样品/赠品）
router.post('/out', roleMiddleware('admin', 'boss'), (req, res) => {
  const { product_id, quantity, reason } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '参数无效' });
  }

  const db = getDb();
  const inv = db.prepare('SELECT quantity FROM inventory WHERE product_id = ?').get(product_id);
  if (!inv || inv.quantity < quantity) {
    return res.status(400).json({ error: '库存不足' });
  }

  const after = adjustStock(product_id, -quantity, { reason: reason || '手动出库', operatorId: req.user.id, type: 'out' });
  res.json({ message: '出库成功', after_quantity: after });
});

// 变体入库（仅管理员/老板，限样品/赠品）
router.post('/variant/in', roleMiddleware('admin', 'boss'), (req, res) => {
  const { variant_id, quantity, reason } = req.body;
  if (!variant_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '参数无效' });
  }
  const db = getDb();
  const v = db.prepare('SELECT pv.id, p.category FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?').get(variant_id);
  if (!v || (v.category !== 'sample' && v.category !== 'gift')) {
    return res.status(400).json({ error: '该规格不属于样品或赠品，无法管理库存' });
  }
  const after = adjustVariantStock(variant_id, quantity, { reason: reason || '变体手动入库', operatorId: req.user.id, type: 'in' });
  res.json({ message: '入库成功', after_quantity: after });
});

// 变体出库（仅管理员/老板，限样品/赠品）
router.post('/variant/out', roleMiddleware('admin', 'boss'), (req, res) => {
  const { variant_id, quantity, reason } = req.body;
  if (!variant_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '参数无效' });
  }
  const db = getDb();
  const v = db.prepare('SELECT pv.id, pv.stock, p.category FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?').get(variant_id);
  if (!v) return res.status(400).json({ error: '规格不存在' });
  if (v.category !== 'sample' && v.category !== 'gift') {
    return res.status(400).json({ error: '该规格不属于样品或赠品，无法管理库存' });
  }
  if (v.stock < quantity) return res.status(400).json({ error: '该规格库存不足' });
  const after = adjustVariantStock(variant_id, -quantity, { reason: reason || '变体手动出库', operatorId: req.user.id, type: 'out' });
  res.json({ message: '出库成功', after_quantity: after });
});

// 盘点修正（限样品/赠品）：输入实际数，系统算差异并记"盘点修正"日志
router.post('/adjust', roleMiddleware('admin', 'boss'), (req, res) => {
  const { product_id, actual_quantity } = req.body;
  const actual = Number(actual_quantity);
  if (!product_id || !Number.isFinite(actual) || actual < 0) {
    return res.status(400).json({ error: '参数无效' });
  }
  const db = getDb();
  const p = db.prepare('SELECT id, stock, category FROM products WHERE id = ?').get(product_id);
  if (!p) return res.status(400).json({ error: '商品不存在' });
  if (p.category !== 'sample' && p.category !== 'gift') {
    return res.status(400).json({ error: '订货类商品库存由开单/订货自动驱动，不支持盘点修正' });
  }
  const diff = actual - p.stock;
  const after = adjustStock(product_id, diff, { reason: '盘点修正', operatorId: req.user.id, type: diff >= 0 ? 'in' : 'out' });
  res.json({ message: '盘点已更新', before: p.stock, after_quantity: after, diff });
});

// 变体盘点修正（限样品/赠品）
router.post('/variant/adjust', roleMiddleware('admin', 'boss'), (req, res) => {
  const { variant_id, actual_quantity } = req.body;
  const actual = Number(actual_quantity);
  if (!variant_id || !Number.isFinite(actual) || actual < 0) {
    return res.status(400).json({ error: '参数无效' });
  }
  const db = getDb();
  const v = db.prepare('SELECT pv.id, pv.stock, p.category FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = ?').get(variant_id);
  if (!v) return res.status(400).json({ error: '规格不存在' });
  if (v.category !== 'sample' && v.category !== 'gift') {
    return res.status(400).json({ error: '订货类规格不支持盘点修正' });
  }
  const diff = actual - v.stock;
  const after = adjustVariantStock(variant_id, diff, { reason: '盘点修正', operatorId: req.user.id, type: diff >= 0 ? 'in' : 'out' });
  res.json({ message: '盘点已更新', before: v.stock, after_quantity: after, diff });
});

// 库存变动记录
router.get('/logs', (req, res) => {
  const db = getDb();
  const { product_id, limit } = req.query;
  const sc = storeClauseAndParams(req, 'l');
  let sql = `SELECT l.*, p.name as product_name, u.display_name as operator_name
    FROM inventory_logs l
    JOIN products p ON l.product_id = p.id
    LEFT JOIN users u ON l.operator_id = u.id
    WHERE 1=1`;
  const params = [];
  if (product_id) { sql += ' AND l.product_id = ?'; params.push(product_id); }
  sql += sc.clause;
  sql += ' ORDER BY l.id DESC';
  // 负 LIMIT 在 SQLite 中表示「不限制」，传入 -1 会一次拉全表，必须钳制上下限。
  // 缺省/非法时回落到默认上限 200，确保任何情况下都带 LIMIT，避免无限制全表拉取。
  const rawLimit = parseInt(limit);
  const effLimit = (Number.isFinite(rawLimit) && rawLimit > 0) ? Math.min(rawLimit, 500) : 200;
  sql += ' LIMIT ?';
  params.push(effLimit);

  const logs = db.prepare(sql).all(...params, ...sc.params);
  res.json(logs);
});

export default router;
