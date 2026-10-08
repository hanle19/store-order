import React, { memo } from 'react';
import { PlusOutlined, MinusOutlined } from '@ant-design/icons';
import {
  categoryLabels, categoryTagColors, C, getGradientForName,
  displayPrice, variantPriceRange,
} from './Shop.constants';

// ============ 数量步进器 ============
function QtyStepperBase({ value, onChange, min = 1, disabled = false }) {
  const dec = () => { if (!disabled) onChange(Math.max(min, (value || min) - 1)); };
  const inc = () => { if (!disabled) onChange((value || min) + 1); };
  return (
    <div className={`qty-stepper${disabled ? ' disabled' : ''}`}>
      <button type="button" className="qty-btn qty-dec" onClick={dec} disabled={disabled} aria-label="减少数量">
        <MinusOutlined />
      </button>
      <span className="qty-val" aria-live="polite">{value}</span>
      <button type="button" className="qty-btn qty-inc" onClick={inc} disabled={disabled} aria-label="增加数量">
        <PlusOutlined />
      </button>
    </div>
  );
}

// ============ 商品卡片 ============
function ProductCardBase({ product, qtyInCart, isDesktop, onAdd, onOpen, index }) {
  const imgs = product.images || [];
  const vRange = variantPriceRange(product);
  const price = vRange ? vRange.min : displayPrice(product);
  const hasVariants = (product.variants && product.variants.length > 0);
  const variant = [product.model, product.spec].filter(Boolean).join(' · ') || '';
  const outOfStock = product.stock !== undefined && product.stock <= 0;
  const lowStock = product.stock !== undefined && product.stock > 0 && product.stock <= 5;
  const [grad, gradColor] = getGradientForName(product.name);
  const initial = (product.name || '商').charAt(0).toUpperCase();

  const open = () => onOpen(product);
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  };

  return (
    <div
      className="ec-card"
      style={{ animationDelay: `${(index % 8) * 60}ms` }}
      role="button"
      tabIndex={0}
      aria-label={`${product.name}${product.brand ? '，' + product.brand : ''}${variant ? '，' + variant : ''}`}
      onClick={open}
      onKeyDown={handleKeyDown}
    >
      {/* 图片区 */}
      <div className="ec-thumb">
        {imgs.length > 0 ? (
          <img src={imgs[0]} alt={product.name} loading="lazy" decoding="async" />
        ) : (
          <div className="ec-placeholder" style={{ background: grad }}>
            <span className="ec-placeholder-letter" style={{ color: gradColor }}>{initial}</span>
          </div>
        )}

        {/* 标签组 — 左上角 */}
        <div className="ec-tags">
          <span className="ec-tag ec-tag-cat" style={{ background: categoryTagColors[product.category] || C.primary }}>
            {categoryLabels[product.category] || '商品'}
          </span>
        </div>

        {/* 已售罄 — 改为优雅角标，不再黑罩全卡 */}
        {outOfStock && (
          <div className="ec-sold-out-badge">
            <span>已售罄</span>
          </div>
        )}

        {/* 库存紧张 */}
        {lowStock && !outOfStock && (
          <div className="ec-low-stock">仅剩{product.stock}件</div>
        )}

        {/* 购物车数量角标 */}
        {qtyInCart > 0 && (
          <div className="ec-qty-badge">{qtyInCart}</div>
        )}
      </div>

      {/* 信息区 */}
      <div className="ec-body">
        {product.brand && <div className="ec-brand">{product.brand}</div>}
        <div className="ec-name">{product.name}</div>
        {variant && <div className="ec-variant">{variant}</div>}
        {product.highlight && <div className="ec-highlight">{product.highlight}</div>}

        <div className="ec-foot">
          <div className="ec-price-row">
            {hasVariants && vRange ? (
              <span className="ec-price">¥{vRange.min.toLocaleString()}~{vRange.max.toLocaleString()}</span>
            ) : (
              <span className="ec-price">¥{price.toLocaleString()}</span>
            )}
          </div>
          <button type="button" className={`ec-addbtn ${outOfStock ? 'disabled' : ''}`}
            disabled={outOfStock}
            onClick={(e) => { e.stopPropagation(); onAdd(product); }}>
            {outOfStock ? '缺货' : isDesktop ? '加入购物车' : '+'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const QtyStepper = memo(QtyStepperBase);
export const ProductCard = memo(ProductCardBase);
