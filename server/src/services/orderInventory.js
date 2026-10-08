// server/src/services/orderInventory.js
// 订单库存扣减/退回（从 routes/orders.js 抽取，纯 DB 逻辑，可独立单测）。
// 抽取价值：库存方向与双表同步是历史 bug 高发区（曾出现流水方向反、双扣减），
// 独立后可针对"出库→入库→派生库存不漂移"写精确断言。

import { adjustStock, adjustVariantStock } from '../stock.js';

// 成交出库：所有带 product_id 的明细统一减库存（规格级 + 商品主库存）
// 经 adjustStock / adjustVariantStock 收口，确保 products.stock 与 product_variants.stock 实时一致。
// 前端购物车以 product.id + spec 为唯一键、不传 variant_id，故按 product_id + spec 精确匹配变体。
export function applySaleStockOut(db, item, qty, orderId, operatorId) {
  const pid = item.product_id || item.productId || null;
  if (!pid) return;
  const prod = db.prepare('SELECT id, category, stock FROM products WHERE id = ?').get(pid);
  if (!prod) return;

  // 规格级匹配（精确 + 去空格兜底）
  let variantId = item.variant_id || null;
  if (!variantId && item.spec) {
    const v = db.prepare('SELECT id, stock FROM product_variants WHERE product_id = ? AND spec = ?').get(pid, String(item.spec).trim());
    if (v) variantId = v.id;
  }
  const manageable = prod.category === 'sample' || prod.category === 'gift';

  if (variantId) {
    const v = db.prepare('SELECT stock FROM product_variants WHERE id = ?').get(variantId);
    if (v) {
      if (manageable && v.stock < qty) {
        throw new Error(`商品"${item.product_name || prod.name}"的规格"${item.spec}"库存不足(库存:${v.stock}, 需要:${qty})`);
      }
      adjustVariantStock(variantId, -qty, { type: 'out', reason: '销售出库', orderId, operatorId });
    }
  }

  if (manageable && prod.stock < qty) {
    throw new Error(`商品"${item.product_name || prod.name}"库存不足(库存:${prod.stock}, 需要:${qty})`);
  }
  adjustStock(pid, -qty, { type: 'out', reason: '订单销售出库', orderId, operatorId });
}

// 退回库存（编辑订单旧明细 / 取消订单）：与 applySaleStockOut 反向加回，同样收口双表
export function returnSaleStockIn(db, item, qty, orderId, operatorId) {
  const pid = item.product_id || item.productId || null;
  if (!pid) return;
  // 订货类永不核减库存（与 applySaleStockOut 对称），避免凭空虚增
  if ((item.product_type || 'order') === 'order') return;
  let variantId = item.variant_id || null;
  if (!variantId && item.spec) {
    const v = db.prepare('SELECT id FROM product_variants WHERE product_id = ? AND spec = ?').get(pid, String(item.spec).trim());
    if (v) variantId = v.id;
  }
  if (variantId) adjustVariantStock(variantId, qty, { type: 'in', reason: '订单退回入库', orderId, operatorId });
  adjustStock(pid, qty, { type: 'in', reason: '订单退回入库', orderId, operatorId });
}

// 后台手动建单时常常只填了商品名/规格、未关联 product_id，
// 导致库存核减与价格同步失效。这里按 商品名(+规格) 反查并回填 product_id / variant_id。
export function resolveProductId(db, it) {
  if (it.product_id) return;
  const name = (it.product_name || '').trim();
  if (!name) return;
  const norm = name.replace(/\s+/g, '').toLowerCase();
  // 引擎侧按归一化名精确匹配，避免原实现每次 SELECT * FROM products 全表拉到 JS 再循环
  const row = db.prepare(`SELECT id, name FROM products WHERE LOWER(REPLACE(name, ' ', '')) = ?`).get(norm);
  if (!row) return;
  it.product_id = row.id;
  const spec = (it.spec || '').trim();
  if (spec) {
    const v = db.prepare('SELECT id FROM product_variants WHERE product_id = ? AND spec = ?').get(row.id, spec);
    if (v) it.variant_id = v.id;
  }
}
