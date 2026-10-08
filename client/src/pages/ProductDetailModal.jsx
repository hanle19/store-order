import React, { memo, useState } from 'react';
import { Modal, Button, Carousel } from 'antd';
import {
  ShoppingCartOutlined, CloseOutlined, LeftOutlined, StarOutlined, FireOutlined,
} from '@ant-design/icons';
import {
  categoryLabels, categoryTagColors, C, getGradientForName,
  displayPrice,
} from './Shop.constants';
import { QtyStepper } from './ProductCard';

function ProductDetailModalBase({ product, qty, setQty, isDesktop, onClose, onAdd, onBuy }) {
  if (!product) return null;
  const imgs = product.images || [];
  const hasVariants = (product.variants && product.variants.length > 0);
  // 选中的变体索引
  const [selectedVIdx, setSelectedVIdx] = useState(0);
  const activeVariant = hasVariants ? product.variants[selectedVIdx] : null;
  const price = activeVariant ? activeVariant.price : displayPrice(product);
  const outOfStock = activeVariant ? (activeVariant.stock <= 0) : (product.stock !== undefined && product.stock <= 0);
  // 真实可用库存：变体商品取选中变体库存，否则取商品顶层库存
  const effectiveStock = activeVariant ? activeVariant.stock : product.stock;
  const lowStock = effectiveStock !== undefined && effectiveStock > 0 && effectiveStock <= 5;
  const [grad, gradColor] = getGradientForName(product.name);
  const initial = (product.name || '商').charAt(0).toUpperCase();

  return (
    <Modal
      open={!!product}
      onCancel={onClose}
      closeIcon={isDesktop ? <CloseOutlined /> : null}
      footer={null}
      className="modal-lg"
      style={isDesktop ? { top: 40 } : { top: 0, maxWidth: '100vw', padding: 0 }}
      styles={{
        body: { padding: 0 },
        content: isDesktop
          ? { borderRadius: 'var(--radius-lg)', overflow: 'hidden' }
          : { borderRadius: 0, height: '100vh', maxHeight: '100vh', overflow: 'auto' },
      }}
      title={isDesktop ? null : (
        <div className="modal-mobile-title">
          <button type="button" className="modal-mobile-back" aria-label="返回商品列表" onClick={onClose}>
            <LeftOutlined />
          </button>
          <span>商品详情</span>
        </div>
      )}
    >
      <div className="detail-flex">
        {/* 左：图片 */}
        <div className="detail-img-col">
          {imgs.length > 0 ? (
            <Carousel dots={{ className: 'carousel-dots' }} autoplay={imgs.length > 1} infinite={imgs.length > 1}>
              {imgs.map((url, i) => (
                <div key={i}>
                  <div className="detail-img-ratio">
                    <img src={url} alt={`${product.name}-${i + 1}`} />
                  </div>
                </div>
              ))}
            </Carousel>
          ) : (
            <div className="detail-img-ratio detail-placeholder-lg" style={{ background: grad }}>
              <span className="detail-placeholder-letter" style={{ color: gradColor, fontSize: 72 }}>{initial}</span>
            </div>
          )}
          {imgs.length > 1 && (
            <div className="detail-img-count">1/{imgs.length}</div>
          )}
        </div>

        {/* 右：信息 */}
        <div className="detail-info-col">
          <div className="detail-price-row">
            <span className="detail-price">¥{price.toLocaleString()}</span>
          </div>

          <div className="detail-name">{product.name}</div>

          <div className="detail-tags">
            {product.brand && <span className="detail-tag detail-tag-brand">{product.brand}</span>}
            <span className="detail-tag detail-tag-cat" style={{
              borderColor: (categoryTagColors[product.category] || C.border) + 'AA',
              color: categoryTagColors[product.category] || C.text,
              background: (categoryTagColors[product.category] || C.textLight) + '14'
            }}>{categoryLabels[product.category]}</span>
            {product.model && <span className="detail-tag">{product.model}</span>}
          </div>

          {/* 规格变体选择器 */}
          {hasVariants && (
            <div style={{ marginTop: 14 }}>
              <div className="spec-selector-title">选择规格</div>
              <div className="spec-selector">
                {product.variants.map((v, idx) => (
                  <div
                    key={v.id || idx}
                    className={`spec-option ${selectedVIdx === idx ? 'active' : ''}`}
                    onClick={() => setSelectedVIdx(idx)}
                  >
                    <span>{v.spec}</span>
                    <span className="spec-price">¥{Number(v.price).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {product.highlight && (
            <div className="detail-highlight-box">
              <div className="detail-highlight-title"><StarOutlined /> 商品亮点</div>
              <div className="detail-highlight-text">{product.highlight}</div>
            </div>
          )}

          <div className="detail-spec-grid">
            {product.code && <div className="detail-spec-item"><span className="spec-label">编码：</span>{product.code}</div>}
            <div className="detail-spec-item"><span className="spec-label">单位：</span>{product.unit || '件'}</div>
            {product.spec && <div className="detail-spec-item"><span className="spec-label">规格：</span>{product.spec}</div>}
            {product.model && <div className="detail-spec-item"><span className="spec-label">型号：</span>{product.model}</div>}
            <div className="detail-spec-item">
              <span className="spec-label">库存：</span>
              {outOfStock ? (
                <span className="spec-out">缺货</span>
              ) : lowStock ? (
                <span className="spec-low">仅剩 {effectiveStock} {product.unit || '件'}</span>
              ) : (
                <span className="spec-ok">{effectiveStock} {product.unit || '件'}</span>
              )}
            </div>
          </div>

          {product.detail_desc && (
            <div className="detail-desc-block">
              <div className="detail-desc-title">商品详情</div>
              <div className="detail-desc-text">{product.detail_desc}</div>
            </div>
          )}

          <div className="detail-action-area">
            <div className="detail-qty-row">
              <span className="detail-qty-label">数量</span>
              <QtyStepper value={qty} onChange={setQty} disabled={outOfStock} />
              {!outOfStock && effectiveStock !== undefined && (
                <span className={`detail-stock-hint${lowStock ? ' low' : ''}`}>
                  <FireOutlined style={{ color: lowStock ? C.warning : C.textLight }} />
                  {lowStock ? `仅剩 ${effectiveStock} 件` : `库存 ${effectiveStock} ${product.unit || '件'}`}
                </span>
              )}
            </div>
            <div className="detail-btn-row">
              <Button onClick={() => onAdd(product, qty, activeVariant?.spec || product.spec || '', activeVariant?.price)} disabled={outOfStock} block className="detail-btn-add">
                <ShoppingCartOutlined /> 加入购物车
              </Button>
              <Button type="primary" onClick={() => onBuy(product, qty, activeVariant?.spec || product.spec || '', activeVariant?.price)} disabled={outOfStock} block className="detail-btn-buy">
                立即购买
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export const ProductDetailModal = memo(ProductDetailModalBase);
