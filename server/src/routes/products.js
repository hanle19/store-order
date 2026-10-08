import { Router } from 'express';
import { getDb, getConfigFlag } from '../db.js';
import { adjustStock, recomputeStockTable } from '../stock.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 基准售价：若指定了选中规格(selectedVariant)，以该规格售价为基准；否则变体取最低售价；无变体取 price
function basePriceOf(p, selectedVariant) {
  if (selectedVariant && (Number(selectedVariant.price) || 0) > 0) {
    return Number(selectedVariant.price);
  }
  if (p.variants && p.variants.length) {
    const ps = p.variants.map(v => Number(v.price) || 0).filter(x => x > 0);
    if (ps.length) return Math.min(...ps);
  }
  return Number(p.price) || 0;
}

// 保本价利润率（按售价毛利率，默认 0.4）
export function getBreakEvenMargin(db) {
  try {
    const row = db.prepare("SELECT value FROM system_config WHERE key='break_even_margin'").get();
    const m = row ? Number(row.value) : 0.4;
    return (m > 0 && m < 1) ? m : 0.4;
  } catch { return 0.4; }
}

// 保本价（基础售价）：进价 ÷ (1 − 利润率)，低于此价即亏损
export function computeBreakEven(db, cost) {
  const costN = Number(cost) || 0;
  const margin = getBreakEvenMargin(db);
  return Math.round((costN / (1 - margin)) * 100) / 100;
}

// 券是否适用于某商品（按 scope 精确过滤）：scope=all 通用；product/category 按范围
function couponAppliesTo(c, p) {
  if (c.scope === 'product') {
    const ids = c.scope_ids.split(',').map(s => Number(s.trim())).filter(Boolean);
    return ids.includes(Number(p.id));
  }
  if (c.scope === 'category') {
    const cats = c.scope_ids.split(',').map(s => s.trim()).filter(Boolean);
    return cats.includes(p.category);
  }
  return true;
}

// 命中某渠道的适用券（按 scope 精确过滤），返回券列表
function applicableCoupons(db, p, channel) {
  if (!getConfigFlag(db, 'promo_enabled') || !getConfigFlag(db, 'promo_coupon_enabled')) return [];
  const today = todayStr();
  const rows = db.prepare(
    `SELECT * FROM coupons WHERE status = 1
       AND (channel IS NULL OR channel = '' OR channel = ?)
       AND (start = '' OR start <= ?) AND (end = '' OR end >= ?)`
  ).all(channel, today, today);
  return rows.filter(c => couponAppliesTo(c, p));
}

// 预加载促销上下文：券/套餐一次性查出并按商品建索引，供列表批量计算价格时复用，消除逐商品 N+1
function buildPromoContext(db) {
  const couponEnabled = getConfigFlag(db, 'promo_enabled') && getConfigFlag(db, 'promo_coupon_enabled');
  const bundleEnabled = getConfigFlag(db, 'promo_bundle_enabled');
  const today = todayStr();
  const coupons = couponEnabled
    ? db.prepare(`SELECT * FROM coupons WHERE status = 1 AND (start='' OR start<=?) AND (end='' OR end>=?)`).all(today, today)
    : [];
  const bundles = {};
  const bundleItemsByProduct = {};
  const bundleItemsByBundle = {};
  if (bundleEnabled) {
    const bs = db.prepare(`SELECT * FROM bundles WHERE status = 1 AND (start='' OR start<=?) AND (end='' OR end>=?)`).all(today, today);
    for (const b of bs) {
      const items = db.prepare(
        `SELECT bi.qty, p.price,
           (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.active = 1) AS vmin
         FROM bundle_items bi JOIN products p ON p.id = bi.product_id WHERE bi.bundle_id = ?`
      ).all(b.id);
      bundles[b.id] = b;
      bundleItemsByBundle[b.id] = items;
      for (const it of items) (bundleItemsByProduct[it.product_id] ||= []).push(b.id);
    }
  }
  return { couponEnabled, bundleEnabled, coupons, bundles, bundleItemsByProduct, bundleItemsByBundle };
}

function couponDiscountFor(c, amount) {
  const amt = Number(amount) || 0;
  let d = 0;
  if (c.type === 'full_reduce') { if (amt >= Number(c.threshold)) d = Number(c.value) || 0; }
  else if (c.type === 'instant') d = Number(c.value) || 0;
  else if (c.type === 'discount') { if (!c.threshold || amt >= Number(c.threshold)) d = Math.round(amt * (1 - Number(c.value)) * 100) / 100; }
  return Math.min(d, amt);
}

// 价格分解：基准售价(=零售价) → 适用优惠券 → 适用捆绑套餐 → 顾客到手价
// 统一价格口径：售价(price/变体price)为唯一权威卖价；原价/折扣价字段已废弃删除，所有折扣在订单结算时由促销引擎自动核减。
// opts.excludeCoupon=true 时跳过门店券（用于订单落行：门店券按整单核减，避免单品级重复扣减）
export function getPriceBreakdown(p, db, opts = {}) {
  const today = todayStr();
  const selectedVariant = opts.selectedVariant || null;
  const base = basePriceOf(p, selectedVariant);
  let price = base; // 基准售价 = 零售价（原价/折扣价已废弃）
  // 优惠券（仅零售通用 channel=all）
  let couponDiscount = 0, couponCode = '';
  if (!opts.excludeCoupon) {
    const coupons = opts.promoCtx ? opts.promoCtx.coupons : applicableCoupons(db, p, 'all');
    for (const c of coupons) {
      if (!couponAppliesTo(c, p)) continue;
      const d = couponDiscountFor(c, price);
      if (d > couponDiscount) { couponDiscount = d; couponCode = c.code; }
    }
  }
  const couponPrice = Math.max(0, price - couponDiscount);
  // 套餐折算
  let bundlePrice = price, bundleName = '';
  if (opts.promoCtx ? opts.promoCtx.bundleEnabled : getConfigFlag(db, 'promo_bundle_enabled')) {
    const ctx = opts.promoCtx;
    // 取包含本商品的第一个套餐（与原 LIMIT 1 行为一致）
    const bundleId = ctx
      ? (ctx.bundleItemsByProduct[p.id] || [])[0]
      : (() => { const r = db.prepare(`SELECT bi.bundle_id FROM bundle_items bi JOIN bundles b ON b.id = bi.bundle_id WHERE bi.product_id = ? AND b.status = 1 AND (b.start = '' OR b.start <= ?) AND (b.end = '' OR b.end >= ?) LIMIT 1`).get(p.id, today, today); return r ? r.bundle_id : null; })();
    if (bundleId) {
      const b = ctx ? ctx.bundles[bundleId] : db.prepare('SELECT * FROM bundles WHERE id = ?').get(bundleId);
      const items = ctx ? ctx.bundleItemsByBundle[bundleId] : db.prepare(
        `SELECT bi.qty, p.price,
           (SELECT MIN(v.price) FROM product_variants v WHERE v.product_id = p.id AND v.active = 1) AS vmin
         FROM bundle_items bi JOIN products p ON p.id = bi.product_id WHERE bi.bundle_id = ?`
      ).all(bundleId);
      let sumBase = 0;
      for (const it of items) { const bp = (it.vmin && it.vmin > 0) ? it.vmin : (Number(it.price) || 0); sumBase += bp * (Number(it.qty) || 1); }
      if (sumBase > 0) {
        const bp2 = Math.round(price * (Number(b.combo_price) / sumBase) * 100) / 100;
        if (bp2 < bundlePrice) { bundlePrice = bp2; bundleName = b.name; }
      }
    }
  }
  const finalPrice = Math.max(0, Math.min(couponPrice, bundlePrice));
  // 进价/保本价：选中规格时取规格级，否则取商品级
  const costPrice = selectedVariant ? (Number(selectedVariant.cost_price) || 0) : (Number(p.cost_price) || 0);
  const breakEven = selectedVariant ? (Number(selectedVariant.break_even_price) || 0) : (Number(p.break_even_price) || 0);
  return {
    effective_price: finalPrice,
    base_price: base,
    promo_price: price,
    coupon_price: couponPrice,
    coupon_code: couponCode,
    bundle_price: bundlePrice,
    bundle_name: bundleName,
    final_price: finalPrice,
    break_even_price: breakEven,
    cost_price: costPrice,
  };
}

const router = Router();
router.use(authMiddleware);

// 获取所有商品
router.get('/', (req, res) => {
  const db = getDb();
  const { category, active, brand } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (active !== undefined) { sql += ' AND active = ?'; params.push(active === '1' ? 1 : 0); }
  if (brand) { sql += ' AND brand = ?'; params.push(brand); }
  sql += ' ORDER BY sort_order ASC, id DESC';
  const products = db.prepare(sql).all(...params);
  // 在途（已订未到）：派生自「销售订单中订货类明细且订单尚未签收/完成/取消」的数量之和（全系统唯一口径）
  const transitRows = db.prepare(`
    SELECT oi.product_id AS pid, COALESCE(SUM(oi.quantity), 0) AS c
    FROM order_items oi JOIN orders o ON oi.order_id = o.id
    WHERE oi.product_type = 'order' AND o.status NOT IN ('signed','completed','cancelled')
    GROUP BY oi.product_id
  `).all();
  const transitMap = {};
  for (const r of transitRows) transitMap[r.pid] = r.c;
  // 促销上下文一次性预加载（券/套餐），列表批量计算价格时复用，避免逐商品 N+1
  const promoCtx = buildPromoContext(db);
  // 规格一次性批量取出并按商品分组，避免逐商品 N+1
  const variantRows = db.prepare('SELECT * FROM product_variants WHERE active = 1 ORDER BY sort_order ASC, id ASC').all();
  const variantMap = {};
  for (const v of variantRows) (variantMap[v.product_id] ||= []).push(v);
  // 解析 images JSON + 附带变体 + 价格分解
  for (const p of products) {
    p.in_transit = transitMap[p.id] || 0;
    try { p.images = JSON.parse(p.images || '[]'); } catch { p.images = []; }
    p.variants = variantMap[p.id] || [];
    const bd = getPriceBreakdown(p, db, { promoCtx });
    p.effective_price = bd.effective_price;
    p.price_breakdown = bd;
  }
  res.json(products);
});

// 获取所有品牌列表
router.get('/brands/list', (req, res) => {
  const db = getDb();
  const brands = db.prepare("SELECT DISTINCT brand FROM products WHERE brand != '' AND brand IS NOT NULL AND active = 1 ORDER BY brand").all();
  res.json(brands.map(b => b.brand));
});

// 获取单个商品
router.get('/:id', (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });
  try { product.images = JSON.parse(product.images || '[]'); } catch { product.images = []; }
  product.variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC').all(req.params.id);
  const tr = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity), 0) AS c
    FROM order_items oi JOIN orders o ON oi.order_id = o.id
    WHERE oi.product_id = ? AND oi.product_type = 'order' AND o.status NOT IN ('signed','completed','cancelled')
  `).get(product.id).c;
  product.in_transit = tr;
  const bd = getPriceBreakdown(product, db);
  product.effective_price = bd.effective_price;
  product.price_breakdown = bd;
  res.json(product);
});

// 创建商品（仅管理员/老板）
router.post('/', roleMiddleware('admin', 'boss'), (req, res) => {
  const { name, model, code, category, type, unit, price, cost_price, description, spec, barcode,
    brand, highlight, images, detail_desc, sort_order, stock,
    promo_start, promo_end, active } = req.body;
  if (!name || !category || price === undefined) {
    return res.status(400).json({ error: '请填写商品名称、分类和价格' });
  }
  if (!['sample', 'gift', 'order'].includes(category)) {
    return res.status(400).json({ error: '分类无效' });
  }

  const db = getDb();
  const breakEven = computeBreakEven(db, cost_price);
  const result = db.prepare(`INSERT INTO products (name, model, code, category, type, unit, spec, price, cost_price, description,
    brand, highlight, images, detail_desc, sort_order, stock, promo_start, promo_end, barcode, active, break_even_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      name, model || '', code || null, category, type || '', unit || '件', spec || '', price, cost_price || null, description || null,
      brand || '', highlight || '',
      JSON.stringify(images || []), detail_desc || '', sort_order || 0, stock || 0,
      promo_start || '', promo_end || '', barcode || '', active !== undefined ? (active ? 1 : 0) : 1, breakEven
    );

  // 样品和赠品自动创建库存记录，并同步 stock 到 inventory
  if (category === 'sample' || category === 'gift') {
    db.prepare('INSERT OR IGNORE INTO inventory (product_id, quantity) VALUES (?, ?)').run(result.lastInsertRowid, stock || 0);
    // 如果已存在记录则更新
    db.prepare('UPDATE inventory SET quantity = ?, updated_at = datetime(\'now\',\'localtime\') WHERE product_id = ?').run(stock || 0, result.lastInsertRowid);
  }
  // 同步仓库维度镜像（默认仓）；新品插入后 products.stock 已落库，补一行镜像
  recomputeStockTable(db, result.lastInsertRowid, 0);

  res.json({ id: result.lastInsertRowid, message: '商品添加成功' });
});

// 更新商品（仅管理员/老板）
router.put('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const { name, model, code, category, type, unit, price, cost_price, description, active, spec,
    brand, highlight, images, detail_desc, sort_order, stock,
    promo_start, promo_end, barcode } = req.body;
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (model !== undefined) { fields.push('model = ?'); values.push(model); }
  if (code !== undefined) { fields.push('code = ?'); values.push(code); }
  if (category !== undefined) { fields.push('category = ?'); values.push(category); }
  if (unit !== undefined) { fields.push('unit = ?'); values.push(unit); }
  if (spec !== undefined) { fields.push('spec = ?'); values.push(spec); }
  if (price !== undefined) { fields.push('price = ?'); values.push(price); }
  if (cost_price !== undefined) { fields.push('cost_price = ?'); values.push(cost_price); fields.push('break_even_price = ?'); values.push(computeBreakEven(db, cost_price)); }
  if (description !== undefined) { fields.push('description = ?'); values.push(description); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (brand !== undefined) { fields.push('brand = ?'); values.push(brand); }
  if (highlight !== undefined) { fields.push('highlight = ?'); values.push(highlight); }
  if (images !== undefined) { fields.push('images = ?'); values.push(JSON.stringify(images)); }
  if (detail_desc !== undefined) { fields.push('detail_desc = ?'); values.push(detail_desc); }
  if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
  if (promo_start !== undefined) { fields.push('promo_start = ?'); values.push(promo_start || ''); }
  if (promo_end !== undefined) { fields.push('promo_end = ?'); values.push(promo_end || ''); }
  if (barcode !== undefined) { fields.push('barcode = ?'); values.push(barcode || ''); }
  if (type !== undefined) { fields.push('type = ?'); values.push(type || ''); }
  // stock 不再在此动态字段里设置，改由下方统一经 adjustStock 调整（O22 收口）
  // in_transit 为系统自动计算字段，禁止手动修改

  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

  fields.push('updated_at = datetime(\'now\',\'localtime\')');
  values.push(req.params.id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // 如果修改了 stock，统一经 adjustStock 调整 products.stock 并同步 inventory（样品/赠品），并写入库存日志
  if (stock !== undefined) {
    const delta = (Number(stock) || 0) - product.stock;
    if (delta !== 0) {
      adjustStock(req.params.id, delta, { type: 'adjust', reason: '手动调整库存', operatorId: req.user?.id });
    }
  }

  res.json({ message: '更新成功' });
});

// 删除商品（仅管理员/老板）
router.delete('/:id', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  // 防误删：被订单/送货单/进货单引用时拒绝删除，避免数据不一致
  const refOrder = db.prepare('SELECT COUNT(*) AS c FROM order_items WHERE product_id = ?').get(req.params.id);
  const refDelivery = db.prepare('SELECT COUNT(*) AS c FROM delivery_items WHERE product_id = ?').get(req.params.id);
  const refPurchase = db.prepare('SELECT COUNT(*) AS c FROM purchase_items WHERE product_id = ?').get(req.params.id);
  if ((refOrder && refOrder.c > 0) || (refDelivery && refDelivery.c > 0) || (refPurchase && refPurchase.c > 0)) {
    return res.status(400).json({ error: '该商品已被订单、送货单或进货单引用，无法删除' });
  }

  // 外键已开启：先级联清理所有从属子表（inventory_logs/bundle_items 为纯从属记录），再删主表，避免 FK 约束 500
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM inventory_logs WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM bundle_items WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM inventory WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(req.params.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  });
  tx();
  auditDelete(req, TARGET_TYPES.PRODUCT, product.id, product);
  res.json({ message: '删除成功' });
});

// 一键重算所有商品保本价（改了利润率或存量数据保本价为 0 时调用）
router.post('/recalc-break-even', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const products = db.prepare('SELECT id, cost_price FROM products').all();
  const tx = db.transaction(() => {
    for (const p of products) {
      db.prepare('UPDATE products SET break_even_price = ? WHERE id = ?').run(computeBreakEven(db, p.cost_price), p.id);
    }
  });
  tx();
  res.json({ message: `已重算 ${products.length} 个商品的保本价` });
});

// ===== 变体管理 =====

// 保存商品变体（批量：先删后插）（仅管理员/老板）
router.post('/:id/variants', roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: '商品不存在' });

  const { variants } = req.body;
  if (!Array.isArray(variants)) return res.status(400).json({ error: 'variants 必须是数组' });

  // 校验每条变体
  for (const v of variants) {
    if (!v.spec || v.spec.trim() === '') return res.status(400).json({ error: '规格名称不能为空' });
    if (v.price === undefined || v.price === null || isNaN(Number(v.price))) return res.status(400).json({ error: `${v.spec} 的价格无效` });
  }

  // 先删旧变体再批量插入
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(req.params.id);

  const insert = db.prepare('INSERT INTO product_variants (product_id, spec, price, cost_price, stock, sort_order, active, break_even_price) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  variants.forEach((v, idx) => {
    const vCost = Number(v.cost_price) || 0;
    const vBe = vCost > 0 ? computeBreakEven(db, vCost) : 0;
    insert.run(req.params.id, v.spec.trim(), Number(v.price) || 0, vCost, Number(v.stock) || 0, v.sort_order ?? idx, vBe);
  });

  const saved = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order ASC, id ASC').all(req.params.id);

  // 同步商品级进价与保本价：取各规格最小有效进价作为商品底线（财务最安全，避免漏判亏损）。
  // 仅当顶层进价"由规格驱动"（等于某规格进价）或顶层为空时才回写；若顶层进价不等于任何规格进价（用户在顶层主动录入），则保留不动。
  const costs = saved.map(v => Number(v.cost_price) || 0).filter(c => c > 0);
  const minCost = costs.length ? Math.min(...costs) : 0;
  if (minCost > 0) {
    const topRow = db.prepare('SELECT cost_price FROM products WHERE id = ?').get(req.params.id);
    const topVal = topRow ? Number(topRow.cost_price) || 0 : 0;
    const topDrivenByVariant = costs.includes(topVal); // 顶层值等于某规格进价 => 由规格驱动，可跟随更新
    if (topVal === 0 || topDrivenByVariant) {
      const be = computeBreakEven(db, minCost);
      db.prepare(`UPDATE products SET cost_price = ?, break_even_price = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
        .run(minCost, be, req.params.id);
    }
  }

  res.json({ message: '变体保存成功', variants: saved });
});

export default router;
