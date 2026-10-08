// Orders 页面订单状态 → {色, 文案, 背景}
export const ORDER_STATUS_MAP = {
  pending:             { color: 'var(--status-todo)',     label: '待付定金',   bg: '#fafafa' },
  deposited:           { color: 'var(--status-paid)',     label: '已付定金',   bg: '#e6f4ff' },
  full_paid:           { color: 'var(--status-paid)',     label: '已付全款',   bg: '#f6ffed' },
  purchasing:          { color: 'var(--status-stock)',    label: '订货中',     bg: '#fff7e6' },
  ordered:             { color: 'var(--status-stock)',    label: '已订货',     bg: '#fffbe6' },
  arrived:             { color: 'var(--status-deliver)',  label: '部分到货',   bg: '#e6fffb' },
  ready:               { color: 'var(--status-deliver)',  label: '齐货待收',   bg: '#e6fffb' },
  balance_paid:        { color: 'var(--status-paid)',     label: '尾款结清',   bg: '#f0f5ff' },
  special_released:    { color: 'var(--status-done)',     label: '视同结清',   bg: '#e8f5e9' },
  delivering:          { color: 'var(--status-deliver)',  label: '配送中',     bg: '#e6fffb' },
  partially_delivered: { color: 'var(--status-deliver)',  label: '分批配送',   bg: '#e6fffb' },
  signed:              { color: 'var(--status-done)',     label: '已签收',     bg: '#e8f5e9' },
  completed:           { color: 'var(--status-done)',     label: '已完成',     bg: '#e8f5e9' },
  cancelled:           { color: 'var(--status-cancel)',   label: '已取消',     bg: '#fff1f0' },
};
