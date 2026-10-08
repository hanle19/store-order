// 前台下单页共享常量与工具函数 —— 供 ProductCard / ProductDetailModal / CheckoutView 复用
export const C = {
  primary: 'var(--color-primary)',
  primaryLight: '#C4A88E',
  primaryDark: '#8B6F5A',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  bg: 'var(--color-bg)',
  cardBg: 'var(--color-bg-white)',
  border: 'var(--color-border)',
  text: 'var(--color-text)',
  textLight: 'var(--color-text-tertiary)',
  radius: 16,
  radiusSm: 12,
  shadow: '0 2px 12px rgba(120,90,60,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  shadowHover: '0 18px 40px rgba(120,90,60,0.14), 0 6px 16px rgba(0,0,0,0.06)',
};

export const categoryLabels = { sample: '样品', gift: '赠品', order: '订货' };
// 标签专用深色版：浅色 #D4B886 直接配白字对比度不足，这里压暗保证可读性
export const categoryTagColors = { sample: '#8B6F5A', gift: '#4F7A68', order: '#B07C3F' };

// 统一暖陶土占位渐变 — 高级莫兰迪质感，所有无图商品视觉一致
export const PLACEHOLDER_GRADIENT = 'linear-gradient(135deg, #EDE6DC 0%, #E0D4C6 30%, #D8CBB8 60%, #E0D6CC 100%)';
export const PLACEHOLDER_LETTER_COLOR = '#A68B6B';

// 细腻纹理叠加（用伪元素或内嵌 svg 实现微图案感）
export const PLACEHOLDER_PATTERN = `
  radial-gradient(circle at 20% 80%, rgba(168,139,107,0.06) 0%, transparent 50%),
  radial-gradient(circle at 80% 20%, rgba(168,139,107,0.05) 0%, transparent 50%),
  linear-gradient(135deg, #EDE6DC 0%, #E0D4C6 30%, #D8CBB8 60%, #E0D6CC 100%)
`;

export function getGradientForName() {
  return [PLACEHOLDER_PATTERN || PLACEHOLDER_GRADIENT, PLACEHOLDER_LETTER_COLOR];
}

export const paymentOptions = [
  { value: 'deposit', label: '定金' },
  { value: 'full', label: '全款' },
  { value: 'cash', label: '现金' },
  { value: 'wechat', label: '微信支付' },
  { value: 'alipay', label: '支付宝' },
  { value: 'card', label: '银行卡' },
  { value: 'transfer', label: '银行转账' },
];

export const displayPrice = (p) => (p.price || 0);
// 变体价格范围
export const variantPriceRange = (p) => {
  if (!p.variants || p.variants.length === 0) return null;
  const prices = p.variants.map(v => v.price).filter(Boolean).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  if (prices.length === 1) return { min: prices[0], max: prices[0] };
  return { min: prices[0], max: prices[prices.length - 1] };
};
// 原价/折扣价字段已废弃删除，前台不再展示划线价
export const hasDiscount = () => false;

// 购物车单行展示单价：手动改价 > 选中规格价 > 商品零售价
export const itemDisplayPrice = (item) => {
  if (item.unit_price_override !== undefined) return item.unit_price_override;
  if (item.variant_price !== undefined && item.variant_price !== null) return item.variant_price;
  return displayPrice(item.product);
};
