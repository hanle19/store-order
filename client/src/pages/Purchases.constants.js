// Purchases 页面专用常量集中维护。
// 拆分说明：原 Purchases.jsx 文件近 1000 行，移入此处消除顶部样板。

// 订货单状态 → {色, 文本}
export const PURCHASE_STATUS_MAP = {
  pending: { color: 'var(--status-todo)', label: '待进货' },
  ordered: { color: 'var(--status-stock)', label: '已订货' },
  arrived: { color: 'var(--status-done)', label: '已到货' },
  cancelled: { color: 'var(--status-cancel)', label: '已取消' },
};
