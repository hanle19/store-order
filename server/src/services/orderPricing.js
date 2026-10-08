// server/src/services/orderPricing.js
// 订单计价与金额快照（从 routes/orders.js 抽取，纯逻辑、零 HTTP 依赖，可独立单测）。
// 抽取价值：此前这些函数埋在 2474 行的 orders.js 里，只能靠点前端走完整流程间接验证；
// 现在可直接对"给定商品 + 手动成交价 → 到手价/进价/保本价"写单元断言。

import { getConfigFlag } from '../db.js';
import { verifyCoupon } from '../routes/coupons.js';
import { getPriceBreakdown } from '../routes/products.js';

// 逐商品计价快照：返回单品到手价(核减后,不含整单门店券)、进价快照、保本价快照
// 门店券按整单核减（excludeCoupon），避免单品级重复扣减；套餐/无门槛折扣已计入到手价。
export function buildItemPricing(db, it) {
  const pid = it.product_id || null;
  const manualUnit = Number(it.unit_price);
  const hasManual = manualUnit && !isNaN(manualUnit) && manualUnit >= 0;
  let finalPrice;
  let costPrice = 0;
  let breakEven = 0;
  if (pid) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(pid);
    if (p) {
      // 实时读取该商品当前有效规格，确保新增/改价规格立即生效（不依赖任何前端缓存）
      const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC').all(pid);
      // 命中订单所选具体规格（按 spec 名称精确匹配，忽略大小写与首尾空格）
      const spec = (it.spec || '').trim();
      const selectedVariant = (spec && variants.length)
        ? variants.find(v => (v.spec || '').trim().toLowerCase() === spec.toLowerCase()) || null
        : null;
      const bd = getPriceBreakdown(p, db, { excludeCoupon: true, selectedVariant });
      // 进价/保本价始终取规格维度（命中规格取规格级，否则取商品级），保证利润核算准确
      costPrice = bd.cost_price;
      breakEven = bd.break_even_price;
      // 单价：以前端传入的 unit_price 为准（含用户在结账/编辑时手动输入的成交价）；
      // 仅当未传入有效单价时，才回退到规格/商品的权威售价（修复"手动成交价未传入合同"）
      finalPrice = hasManual ? manualUnit : bd.final_price;
    }
  } else {
    finalPrice = hasManual ? manualUnit : 0;
  }
  // 显式 final_price 兜底（极少见，保留向后兼容）
  if (it.final_price !== undefined && it.final_price !== null && it.final_price !== '') {
    const manual = Number(it.final_price);
    if (!isNaN(manual) && manual >= 0) finalPrice = manual;
  }
  return { finalPrice, costPrice, breakEven };
}

// 统一订单金额计算（治本：核销与计价咬合）
// itemsBase = Σ(逐商品到手价 × 数量)；门店券 couponDiscount 始终核减（门店让利，整单级）；
// 外部/平台券是否核减取决于系统开关 external_coupon_reduce
export function calcAutoActual(db, { itemsBase, discount, couponDiscount, externalCouponAmount }) {
  const extReduce = getConfigFlag(db, 'external_coupon_reduce');
  const ext = extReduce ? (Number(externalCouponAmount) || 0) : 0;
  return Math.max(0, (Number(itemsBase) || 0) - (Number(discount) || 0) - (Number(couponDiscount) || 0) - ext);
}

// 券核销对账：处理 used_qty 增减，避免编辑订单时重复计数
// newCode 为空表示移除券；existing* 为订单原券信息（用于判断是否变化、回收 used_qty）
// 返回 { code, discount, promo }
export function reconcileCoupon(db, { newCode, orderAmount, productIds, existingCode, existingDiscount }) {
  let code = '';
  let discount = 0;
  let promo = 0;
  const c = String(newCode || '').trim().toUpperCase();
  const existing = String(existingCode || '').trim().toUpperCase();
  if (c) {
    if (c === existing) {
      // 券码未变：沿用原减额，不动 used_qty（防止编辑重复消耗）
      code = c;
      discount = Number(existingDiscount) || 0;
      promo = discount > 0 ? 1 : 0;
    } else {
      const vr = verifyCoupon(db, c, orderAmount, productIds);
      if (vr.valid) {
        code = c;
        discount = vr.discount_amount;
        promo = 1;
        if (existing) db.prepare('UPDATE coupons SET used_qty = used_qty - 1 WHERE code = ?').run(existing);
        db.prepare('UPDATE coupons SET used_qty = used_qty + 1 WHERE code = ?').run(c);
      } else if (existing) {
        // 新券无效但旧券存在：保留旧券减额，used_qty 维持（仍视为核销中）
        code = existing;
        discount = Number(existingDiscount) || 0;
        promo = discount > 0 ? 1 : 0;
      }
    }
  } else if (existing) {
    // 券被移除：释放 used_qty
    db.prepare('UPDATE coupons SET used_qty = used_qty - 1 WHERE code = ?').run(existing);
  }
  return { code, discount, promo };
}
