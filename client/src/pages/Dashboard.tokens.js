// ============================================================
// Dashboard 设计 token / 常量 / 配色（纯 JS，不含 JSX）
// 集中收敛，避免散落在主文件里多处硬编码导致品牌色改不动
// ============================================================

export const STYLE = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  border: 'var(--color-border)',
  borderLight: 'var(--color-border-light)',
};

export const statusMap = {
  pending:     { text: '待付定金' },
  deposited:   { text: '已付定金' },
  full_paid:   { text: '已付全款' },
  purchasing:  { text: '进货中' },
  ordered:     { text: '已订货' },
  arrived:     { text: '待送货' },
  ready:       { text: '齐货待收' },
  balance_paid:{ text: '已收尾款' },
  delivering:  { text: '配送中' },
  partially_delivered: { text: '分批配送' },
  signed:      { text: '已签收' },
  completed:   { text: '已完成' },
  cancelled:   { text: '已取消' },
};

// 订单状态色：统一收敛到 index.css 的 6 档语义令牌（var(--status-*)），单一来源，禁彩虹色
export const statusColorMap = {
  pending: 'var(--status-todo)',
  deposited: 'var(--status-paid)',
  full_paid: 'var(--status-paid)',
  balance_paid: 'var(--status-paid)',
  purchasing: 'var(--status-stock)',
  ordered: 'var(--status-stock)',
  arrived: 'var(--status-deliver)',
  ready: 'var(--status-deliver)',
  delivering: 'var(--status-deliver)',
  partially_delivered: 'var(--status-deliver)',
  signed: 'var(--status-done)',
  completed: 'var(--status-done)',
  cancelled: 'var(--status-cancel)',
};

export const orderFilters = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待送货', statuses: ['arrived','ready','delivering','partially_delivered'] },
  { key: 'new', label: '新下单', statuses: ['pending','deposited'] },
  { key: 'completed', label: '已完成', statuses: ['signed','completed'] },
];

// 导购完成率 → 状态语义
export const salesTag = (ratio) => {
  if (ratio >= 90) return { color: 'success', text: '已达标' };
  if (ratio >= 50) return { color: 'processing', text: '进行中' };
  if (ratio >= 10) return { color: 'warning', text: '待提升' };
  return { color: 'error', text: '严重滞后' };
};

// 导购进度条配色：统一品牌暖棕同色系渐变，按完成率深浅递进；
// 仅「严重滞后」保留红，作为明确警示，消除蓝/橙/黄彩虹色。
export const SALES_BAR_COLORS = {
  success: '#6F5743',   // 已达标 — 最深
  processing: '#A88C78', // 进行中 — 主色
  warning: '#C4A68F',   // 待提升 — 浅棕
  error: 'var(--color-error)', // 严重滞后 — 红（警示）
};

// 门店目标完成率色带
export const storeProgressColor = (ratio) => {
  if (ratio < 30) return 'var(--color-error)';
  if (ratio < 50) return 'var(--color-warning)';
  return STYLE.primary;
};

export const fmtMoney = (v) => (v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });

export const fmtK = (v) => {
  const n = v || 0;
  return n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();
};

// 经营分析统一品牌暖陶土调色板：有阶差的 5 档（深→浅），品类一眼可辨，取消浑浊彩虹配色
export const ANALYTICS_PALETTE = () => ['#3D2B1F', '#7A432A', '#A05A3C', '#C08A6E', '#E8D9CE'];

// 图表通用样式（统一 tooltip / 坐标轴 / 网格，避免各图重复定义）
export const chartTipStyle = {
  background: 'var(--color-bg-white)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
  fontSize: 12,
  color: 'var(--color-text)',
};
export const chartTipItemStyle = { color: 'var(--color-text)' };
export const chartTipLabelStyle = { color: 'var(--color-text-secondary)' };
export const axisTick = { fontSize: 11, fill: 'var(--color-text-tertiary)' };
export const gridStroke = 'var(--color-border-light)';
