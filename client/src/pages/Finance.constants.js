// Finance 页面专用常量集中维护。
// 拆分说明：原 Finance.jsx 文件超 1100 行，移入此处消除顶部样板代码，
// 本文件只放纯常量、不导入任何运行时副作用，零行为变更。

export const FINANCE_THEME = {
  primary: 'var(--color-primary)',
  success: '#6B8E7E',
  danger: '#C67878',
  warning: '#D4B886',
  info: '#7A9EB0',
  bg: 'var(--fin-bg)',
  sidebar: 'var(--fin-sidebar)',
  border: 'var(--fin-border)',
  text: 'var(--fin-text)',
  textLight: 'var(--fin-text-light)',
  cardShadow: 'var(--fin-card-shadow)',
  radius: 12,
  tintPrimary: 'var(--fin-tint-primary)',
  tintWarning: 'var(--fin-tint-warning)',
  tintInfo: 'var(--fin-tint-info)',
  tintSuccessBg: 'var(--fin-tint-success)',
  tintDangerBg: 'var(--fin-tint-danger)',
  tintCash: 'var(--fin-tint-cash)',
};

// 订单状态 → {色, 文本}
export const FINANCE_STATUS_MAP = {
  pending:      { color: 'var(--status-todo)',     text: '待付定金' },
  deposited:    { color: 'var(--status-paid)',     text: '已付定金' },
  full_paid:    { color: 'var(--status-paid)',     text: '已付全款' },
  purchasing:   { color: 'var(--status-stock)',    text: '进货中' },
  arrived:      { color: 'var(--status-deliver)',  text: '待送货' },
  balance_paid: { color: 'var(--status-paid)',     text: '已收尾款' },
  delivered:    { color: 'var(--status-done)',     text: '已送货' },
  completed:    { color: 'var(--status-done)',     text: '已完成' },
  cancelled:    { color: 'var(--status-cancel)',   text: '已取消' },
};

// 成本类别 → {名称, 色}
export const FINANCE_COST_CATEGORY_MAP = {
  rent:     { label: '房租', color: '#C67878' },
  salary:   { label: '工资', color: '#D4B886' },
  utility:  { label: '水电', color: '#7A9EB0' },
  material: { label: '物料', color: 'var(--color-primary)' },
  other:    { label: '其他', color: '#888888' },
};
