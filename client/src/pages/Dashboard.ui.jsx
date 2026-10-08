// ============================================================
// Dashboard 展示型小组件（含 JSX）
// 同比角标 / 智能洞察标签 / 移动端订单卡片列表 / 桌面订单列定义
// ============================================================
import React from 'react';
import { Tag, Empty } from 'antd';
import { STYLE, statusMap, statusColorMap, fmtMoney, fmtK, orderFilters } from './Dashboard.tokens';

// 同比角标：绿色上升 / 红色下降（null 表示去年同期无数据，不展示）
export const YoY = ({ pct }) => {
  if (pct === null || pct === undefined) return null;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 11, color: up ? 'var(--color-success)' : 'var(--color-error)', marginLeft: 6, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {up ? '▲' : '▼'} 同比 {Math.abs(pct)}%
    </span>
  );
};

// 智能洞察标签：用语义色一眼传达重点，可点击项带手型 + 键盘可达
export const InsightChip = ({ tone = 'neutral', onClick, children }) => {
  const map = {
    brand:   { bg: 'var(--color-primary-light)', color: STYLE.primary },
    neutral: { bg: 'var(--color-bg-subtle)', color: STYLE.textSecondary },
    success: { bg: 'var(--color-success-bg)', color: 'var(--color-success)' },
    warning: { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)' },
    danger:  { bg: 'var(--color-error-bg)', color: 'var(--color-error)' },
  };
  const c = map[tone] || map.neutral;
  const interactive = !!onClick;
  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-label={typeof children === 'string' ? children : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
        padding: '4px 10px', borderRadius: 999, background: c.bg, color: c.color,
        cursor: interactive ? 'pointer' : 'default', border: '1px solid transparent',
        transition: 'filter .15s',
      }}
      onMouseEnter={interactive ? (e) => (e.currentTarget.style.filter = 'brightness(0.97)') : undefined}
      onMouseLeave={interactive ? (e) => (e.currentTarget.style.filter = 'none') : undefined}
    >{children}</span>
  );
};

// 桌面端最近订单表格列
export const orderColumns = [
  {
    title: '订单号', dataIndex: 'order_no', width: 128,
    render: v => <span style={{ color: STYLE.textSecondary, fontFamily: 'monospace' }}>{v}</span>,
  },
  { title: '客户', dataIndex: 'customer_name', width: 80, ellipsis: true },
  { title: '归属导购', dataIndex: 'salesperson_name', width: 80, ellipsis: true },
  {
    title: '计划送货日期', dataIndex: 'delivery_date', width: 112,
    render: v => <span style={{ color: STYLE.textTertiary, fontSize: 12 }}>{v || '待定'}</span>,
  },
  {
    title: '金额', dataIndex: 'actual_amount', width: 104, align: 'right',
    render: (v, r) => {
      const amt = r.actual_amount ?? r.total_amount ?? 0;
      const big = amt >= 10000;
      return <span style={{ fontWeight: big ? 800 : 700, fontSize: 15, color: big ? STYLE.primary : STYLE.text }}>¥{fmtMoney(amt)}</span>;
    },
  },
  {
    title: '状态', dataIndex: 'status', width: 88,
    render: s => <Tag key={s} className="status-tag-pop" color={statusColorMap[s] || 'default'}>{statusMap[s]?.text || s}</Tag>,
  },
];

// 移动端最近订单：改为每单一张紧凑卡片（避免横向挤压的表格）
export const MobileOrderList = ({ orders, onOpen }) => {
  if (!orders || !orders.length) return <Empty description="暂无订单" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  return (
    <div>
      {orders.map((o) => {
        const amt = o.actual_amount ?? o.total_amount ?? 0;
        const big = amt >= 10000;
        return (
          <div
            key={o.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(o.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpen(o.id); }}
            style={{ padding: '10px 2px', borderBottom: '1px solid var(--color-border-light)', cursor: 'pointer', outline: 'none' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div  className="w-xs">
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: STYLE.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.customer_name}</div>
                <div style={{ fontSize: 11, color: STYLE.textTertiary, fontFamily: 'monospace' }}>{o.order_no}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: big ? 800 : 700, fontSize: 15, color: big ? STYLE.primary : STYLE.text }}>¥{fmtMoney(amt)}</div>
                <Tag key={o.status} className="status-tag-pop" color={statusColorMap[o.status] || 'default'} style={{ marginTop: 2, marginRight: 0,  fontSize: 11 }}>{statusMap[o.status]?.text || o.status}</Tag>
              </div>
            </div>
            {o.delivery_date && (
              <div style={{ fontSize: 11, color: STYLE.textTertiary, marginTop: 2 }}>计划送货 {o.delivery_date}</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
