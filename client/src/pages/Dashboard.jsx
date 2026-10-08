import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Table, Tag, Select, Space, Progress, Grid, Button, Alert, Modal, message, Badge, Card } from 'antd';
import {
  ShoppingCartOutlined, DollarOutlined, InboxOutlined, CheckCircleOutlined,
  CrownOutlined, PlusOutlined, DatabaseOutlined, CustomerServiceOutlined, CalendarOutlined,
  DownloadOutlined, ShareAltOutlined, CarOutlined, RightOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
import api from '../api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import AnimatedNumber from '../components/AnimatedNumber';
import { useAuth } from '../context/AuthContext';
import { useBrand } from '../context/BrandContext';
import { useStore } from '../context/StoreContext';
import {
  STYLE, salesTag, SALES_BAR_COLORS, storeProgressColor, fmtMoney, fmtK, orderFilters, statusMap,
} from './Dashboard.tokens';
import { YoY, InsightChip, MobileOrderList, orderColumns } from './Dashboard.ui';
import * as XLSX from 'xlsx';
import EmptyState from '../components/EmptyState';
import { formatMoneyInt } from '../utils/format';

const { useBreakpoint } = Grid;

// 核心卡片下方四个快捷操作入口
const quickActions = [
  { label: '前台下单', desc: '新建顾客订单', icon: <PlusOutlined />, to: '/shop', color: STYLE.primary },
  { label: '库存查询', desc: '查看现货库存', icon: <DatabaseOutlined />, to: '/inventory', color: STYLE.primary },
  { label: '客户回访', desc: '客户跟进管理', icon: <CustomerServiceOutlined />, to: '/customers', color: STYLE.warning },
  { label: '预约登记', desc: '登记到店预约', icon: <CalendarOutlined />, to: '/customers', color: STYLE.primary },
];

export default function Dashboard() {
  const [overview, setOverview] = useState({ total_orders: 0, total_revenue: 0, purchasing: 0, completed: 0, follow_up: 0 });
  const [store, setStore] = useState({ target_amount: 0, revenue: 0, ratio: 0 });
  const [salesData, setSalesData] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [finance, setFinance] = useState(null);
  const [brief, setBrief] = useState(null);
  const [financeBrief, setFinanceBrief] = useState(null);
  const [yoy, setYoy] = useState(null);
  const [alerts, setAlerts] = useState({ zero_sales: 0, overdue_delivery: 0, low_stock: 0, ready_to_ship: 0 });
  const [readyToShipList, setReadyToShipList] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [ops, setOps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [orderFilter, setOrderFilter] = useState('all');
  const [briefImg, setBriefImg] = useState(null);
  const [briefModalOpen, setBriefModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const briefRef = useRef(null);
  const reqRef = useRef(0);
  const abortRef = useRef(null);
  const navigate = useNavigate();
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const { user } = useAuth();
  const { brand } = useBrand();
  const PRIMARY = brand?.primary_color || STYLE.primary;
  const userRole = user?.role || 'sales';
  const canViewFinance = userRole === 'admin' || userRole === 'boss';
  const { storeId, getStoreParam } = useStore();

  // 数据加载：Promise.allSettled 并行互不阻塞；AbortController 取消过期请求（快速切年月不连发）
  const loadData = useCallback(async () => {
    const myId = ++reqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const sid = getStoreParam();
      const bp = { year, month };
      if (sid) bp.store_id = sid;
      const reqs = [api.get('/dashboard', { params: bp, signal: controller.signal })];
      if (canViewFinance) reqs.push(api.get('/finance/monthly-summary', { params: bp, signal: controller.signal }));
      reqs.push(api.get('/analytics', { params: bp, signal: controller.signal }));
      reqs.push(api.get('/customers/operations/summary', { signal: controller.signal }));
      const results = await Promise.allSettled(reqs);
      if (myId !== reqRef.current) return; // 已有更新的请求，丢弃本次结果
      const ok = (i) => (results[i] && results[i].status === 'fulfilled' ? results[i].value : null);
      const isCancel = (err) => err && (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || err.message?.includes('aborted'));
      const dashboardRes = results[0];
      if (dashboardRes.status === 'rejected') {
        const status = dashboardRes.reason?.response?.status;
        if (status === 401 || isCancel(dashboardRes.reason)) { return; }
        setError(true); message.error('数据加载失败，请稍后重试'); return;
      }
      const d = dashboardRes.value.data;
      if (!d) { setError(true); message.error('数据加载失败，请稍后重试'); return; }
      setOverview(d.overview || { total_orders: 0, total_revenue: 0, purchasing: 0, completed: 0, follow_up: 0 });
      setStore(d.store || { target_amount: 0, revenue: 0, ratio: 0 });
      setSalesData(d.sales || []);
      setRecentOrders(d.recent_orders || []);
      setBrief(d.brief || null);
      setFinanceBrief(d.finance_brief || null);
      setYoy(d.yoy || null);
      setAlerts(d.alerts || { zero_sales: 0, overdue_delivery: 0, low_stock: 0, ready_to_ship: 0 });
      setReadyToShipList(d.ready_to_ship_list || []);
      const fIdx = canViewFinance ? 1 : -1;
      setFinance(fIdx >= 0 ? ok(fIdx)?.data : null);
      const aIdx = canViewFinance ? 2 : 1;
      setAnalytics(ok(aIdx)?.data || null);
      const oIdx = canViewFinance ? 3 : 2;
      setOps(ok(oIdx)?.data || null);
    } catch (err) {
      if (myId !== reqRef.current) return;
      setError(true);
      message.error('数据加载失败，请稍后重试');
    } finally {
      if (myId === reqRef.current) setLoading(false);
    }
  }, [year, month, canViewFinance, storeId]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const overviewCards = [
    { title: '总订单', value: overview.total_orders, raw: overview.total_orders, icon: <ShoppingCartOutlined />, suffix: '单', sub: '本月全部订单', color: STYLE.text, yoy: yoy?.orders?.pct },
    { title: '总收款', value: fmtMoney(overview.total_revenue), raw: overview.total_revenue, icon: <DollarOutlined />, prefix: '¥', format: fmtMoney, sub: '本月已收金额', color: STYLE.text, yoy: yoy?.revenue?.pct },
    { title: '待跟进订单', value: overview.follow_up || 0, raw: overview.follow_up || 0, icon: <InboxOutlined />, suffix: '单', sub: '待收款+待配送+备货中', color: STYLE.warning },
    { title: '已完成', value: overview.completed, raw: overview.completed, icon: <CheckCircleOutlined />, suffix: '单', sub: '本月完成订单', color: STYLE.text },
  ];

  const filteredOrders = useMemo(() => {
    const f = orderFilters.find(x => x.key === orderFilter);
    if (!f || f.key === 'all') return recentOrders;
    return recentOrders.filter(r => f.statuses.includes(r.status));
  }, [recentOrders, orderFilter]);

  const alertTotal = (alerts.zero_sales || 0) + (alerts.overdue_delivery || 0) + (alerts.low_stock || 0);

  const monthOptions = [];
  for (let m = 1; m <= 12; m++) monthOptions.push({ label: `${m}月`, value: m });
  const yearOptions = [];
  const cy = new Date().getFullYear();
  for (let y = cy - 2; y <= cy + 1; y++) yearOptions.push({ label: `${y}年`, value: y });

  const applyMonth = (offset) => {
    const d = new Date(year, month - 1 + offset, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth() + 1;

  const gap = isMobile ? 8 : 16;

  const navLinkProps = (to) => ({
    role: 'link',
    tabIndex: 0,
    onClick: () => navigate(to),
    onKeyDown: (e) => { if (e.key === 'Enter') navigate(to); },
  });

  const handleExport = () => {
    const wb = XLSX.utils.book_new();
    const period = `${year}年${month}月`;
    const sheet = (name, rows) => {
      const ws = XLSX.utils.aoa_to_sheet([
        [`${brand.site_name || '门店系统'} · 经营月报`, period],
        [],
        ...rows,
      ]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };

    const ov = [['指标', '数值']];
    ov.push(['总订单(本月)', overview.total_orders]);
    ov.push(['总收款(本月)', overview.total_revenue]);
    ov.push(['待跟进订单', overview.follow_up]);
    ov.push(['已完成', overview.completed]);
    ov.push(['门店目标', store.target_amount]);
    ov.push(['门店已完成', store.revenue]);
    ov.push(['完成率', `${store.ratio}%`]);
    if (financeBrief) {
      ov.push(['销售收入', financeBrief.revenue]);
      ov.push(['货物成本', financeBrief.goods_cost]);
      ov.push(['其他成本', financeBrief.other_costs]);
      ov.push(['净利润', financeBrief.profit]);
      ov.push(['净利率', `${financeBrief.profit_margin?.toFixed(1)}%`]);
    }
    if (analytics?.grossProfit?.current) {
      const g = analytics.grossProfit.current;
      ov.push(['本月毛利', g.profit]);
      ov.push(['本月毛利率', `${g.margin}%`]);
      ov.push(['本月货物成本', g.cost]);
    }
    if (yoy) {
      ov.push(['收款同比', yoy.revenue?.pct != null ? `${yoy.revenue.pct}%` : '无同期数据']);
      ov.push(['订单同比', yoy.orders?.pct != null ? `${yoy.orders.pct}%` : '无同期数据']);
    }
    sheet('概览', ov);

    const sr = [['导购', '目标', '成交', '完成率', '单数']];
    salesData.forEach(s => sr.push([s.display_name, s.target_amount, s.completed_amount, `${s.ratio}%`, s.order_count]));
    sheet('导购业绩', sr);

    if (analytics?.category?.length) {
      const cr = [['品类', '金额', '订单数']];
      analytics.category.forEach(c => cr.push([c.label, c.amount, c.orders]));
      sheet('品类占比', cr);
    }

    if (analytics?.productRank?.length) {
      const pr = [['排名', '商品', '品类', '销量', '销售额', '毛利']];
      analytics.productRank.forEach(p => pr.push([p.rank, p.name, p.catLabel, p.qty, p.amount, p.profit]));
      sheet('商品畅销榜', pr);
    }

    if (analytics?.grossProfit?.monthly?.length) {
      const mr = [['月份', '销售额', '货物成本', '毛利', '毛利率']];
      analytics.grossProfit.monthly.forEach(m => mr.push([m.month, m.amount, m.cost, m.profit, `${m.margin}%`]));
      sheet('毛利趋势', mr);
    }

    const or = [['订单号', '客户', '导购', '金额', '状态', '计划送货']];
    recentOrders.forEach(o => or.push([
      o.order_no, o.customer_name, o.salesperson_name,
      (o.actual_amount ?? o.total_amount ?? 0), statusMap[o.status]?.text || o.status, o.delivery_date || '',
    ]));
    sheet('订单明细', or);

    XLSX.writeFile(wb, `经营月报_${year}年${month}月.xlsx`);
    message.success('报表已导出为 Excel');
  };

  const handleGenerateBrief = async () => {
    if (!briefRef.current) return;
    setGenerating(true);
    try {
      const dataUrl = await toPng(briefRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: '#ffffff' });
      setBriefImg(dataUrl);
      setBriefModalOpen(true);
    } catch (e) {
      console.error(e);
      message.error('生成简报图片失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadBrief = () => {
    if (!briefImg) return;
    const a = document.createElement('a');
    a.href = briefImg;
    a.download = `${brand.site_name || '门店系统'}_${year}年${month}月经营简报.png`;
    a.click();
  };

  const handleShareBrief = async () => {
    if (!briefImg) return;
    try {
      const res = await fetch(briefImg);
      const blob = await res.blob();
      const file = new File([blob], `简报_${year}年${month}月.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: '经营简报', text: `${year}年${month}月 经营简报` });
      } else {
        handleDownloadBrief();
      }
    } catch (e) {
      // 用户取消分享，静默处理
    }
  };

  return (
    <div style={{ padding: isMobile ? '12px 12px 24px' : '0 0 24px' }}>
      <PageHeader title="工作台" />
      {error && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: gap }}
          message="数据加载失败"
          description={<Button danger onClick={() => loadData()}>点击重试</Button>}
        />
      )}

      {/* 顶部筛选栏： pill/tab 风格 */}
      <div className="dash-filter-bar" style={{ marginBottom: gap }}>
        <div className="dash-filter-group">
          <Select value={year} onChange={setYear} options={yearOptions} className="dash-filter-select" />
          <Select value={month} onChange={setMonth} options={monthOptions} className="dash-filter-select" />
        </div>
        <div className="dash-filter-group">
          <Button className="dash-filter-btn" onClick={() => applyMonth(-1)}>上月</Button>
          <Button className={`dash-filter-btn ${isCurrentMonth ? 'active' : ''}`} onClick={() => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth() + 1); }}>本月</Button>
        </div>
        {canViewFinance && (
          <div className="dash-filter-actions">
            <Button className="dash-filter-btn" icon={<DownloadOutlined />} onClick={handleExport}>导出报表</Button>
            <Button className="dash-filter-btn primary" icon={<ShareAltOutlined />} loading={generating} onClick={handleGenerateBrief}>生成简报</Button>
          </div>
        )}
      </div>

      {/* 状态提示条 */}
      {alertTotal > 0 ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: gap }}
          message={
            <Space wrap size={[10, 4]}>
              <span>本月需关注：</span>
              {canViewFinance && alerts.zero_sales > 0 && (
                <a {...navLinkProps('/dashboard')} style={{ color: 'var(--color-warning)', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                  {alerts.zero_sales} 名导购业绩为 0
                </a>
              )}
              {alerts.overdue_delivery > 0 && (
                <a {...navLinkProps('/orders')} style={{ color: 'var(--color-warning)', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                  {alerts.overdue_delivery} 笔订单超期未送
                </a>
              )}
              {canViewFinance && alerts.low_stock > 0 && (
                <a {...navLinkProps('/inventory')} style={{ color: 'var(--color-warning)', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline' }}>
                  {alerts.low_stock} 款商品库存偏低
                </a>
              )}
            </Space>
          }
        />
      ) : (
        <div className="dash-status-ok" style={{ marginBottom: gap }}>
          <CheckCircleOutlined />
          <span>本月运营指标正常，暂无异常提醒</span>
        </div>
      )}

      {/* 齐货待送货提醒 */}
      {(alerts.ready_to_ship || 0) > 0 && (
        <Card
          size="small"
          className="dash-ready-ship-card"
          style={{ marginBottom: gap, borderRadius: 10, borderColor: 'var(--color-success)', background: 'var(--color-success-bg)' }}
          title={
            <Space>
              <CarOutlined style={{ color: 'var(--color-success)' }} />
              <span style={{ fontWeight: 700 }}>齐货待送货（{alerts.ready_to_ship}）</span>
              <Tag color="green" style={{ margin: 0 }}>货物已齐 · 可直接触发送货</Tag>
            </Space>
          }
          extra={<a onClick={() => navigate('/purchases')} style={{ fontSize: 12 }}>去订货管理 →</a>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {readyToShipList.slice(0, 6).map(o => (
              <div
                key={o.id}
                onClick={() => navigate(`/orders/${o.id}`)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <div className="w-xs">
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>
                    {o.order_no}
                    <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}> · {o.customer_name || '-'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    齐货时间 {o.updated_at ? o.updated_at.slice(0, 10) : '-'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="money" style={{ fontWeight: 600 }}>{formatMoneyInt(o.actual_amount)}</span>
                  <Tag color={o.status === 'balance_paid' ? 'green' : 'cyan'} style={{ margin: 0 }}>
                    {o.status === 'balance_paid' ? '已付尾款' : '待付尾款'}
                  </Tag>
                  <RightOutlined style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 数据概览 hero 带（4 指标合一面板，分隔线分开） */}
      <div className="dash-hero" style={{ marginBottom: gap }}>
        {overviewCards.map((card, idx) => (
          <StatCard
            key={idx}
            hero
            title={card.title}
            value={card.value}
            raw={card.raw}
            prefix={card.prefix}
            suffix={card.suffix}
            sub={card.sub}
            icon={card.icon}
            color={card.color || PRIMARY}
            format={card.format}
            trend={card.yoy !== undefined && card.yoy !== null ? <YoY pct={card.yoy} /> : null}
            loading={loading}
            isMobile={isMobile}
          />
        ))}
      </div>

      {/* 快捷入口带 */}
      <div className="dash-quick-band" style={{ marginBottom: gap }}>
        {quickActions.map(q => (
          <div key={q.label} className="dash-quick-card" onClick={() => navigate(q.to)}>
            <span className="dash-quick-icon" style={{ color: q.color }}>{q.icon}</span>
            <div className="dash-quick-text">
              <div className="dash-quick-label">{q.label}</div>
              <div className="dash-quick-desc">{q.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 本月经营概览（淡陶土底纹带） */}
      {canViewFinance && finance && (
        <div style={{ marginBottom: gap }}>
          <div className="dash-section-header">
            <div className="dash-section-title">
              <CrownOutlined style={{ fontSize: 16, color: PRIMARY }} />
              <span>{year}年{month}月 经营概览</span>
            </div>
            <span className="dash-section-link" onClick={() => navigate('/finance')}>财务详情 →</span>
          </div>
          <div className="dash-finance-band">
            <div className="dash-metric-tile">
              <div className="dash-metric-label">门店目标完成率</div>
              <div className="dash-metric-value" style={{ color: storeProgressColor(store.ratio || 0) }}>
                <AnimatedNumber value={store.ratio || 0} format={v => `${Math.round(v)}`} suffix="%" />
              </div>
              <Progress percent={Math.min(store.ratio || 0, 100)} strokeColor={storeProgressColor(store.ratio || 0)}
                trailColor="var(--color-border)" strokeWidth={6} showInfo={false} style={{ marginTop: 6 }} />
              <div className="dash-metric-sub">已完成 ¥{fmtK(store.revenue)} / 目标 ¥{fmtK(store.target_amount)}</div>
            </div>
            <div className="dash-metric-tile">
              <div className="dash-metric-label">净利率</div>
              <div className="dash-metric-value" style={{ color: (finance.profit_margin || 0) >= 0 ? STYLE.success : 'var(--color-warning)' }}>
                <AnimatedNumber value={finance.profit_margin || 0} format={v => v.toFixed(1)} suffix="%" />
              </div>
              <div className="dash-metric-sub" style={{ color: (finance.profit || 0) >= 0 ? STYLE.success : 'var(--color-warning)' }}>
                {(finance.profit || 0) >= 0 ? '净利润' : '本月亏损'} ¥{fmtK(finance.profit)}
              </div>
            </div>
            <div className="dash-metric-tile">
              <div className="dash-metric-label">销售收入</div>
              <div className="dash-metric-value" style={{ color: PRIMARY }}>
                <AnimatedNumber value={finance.revenue || 0} format={fmtK} prefix="¥" />
              </div>
              <div className="dash-metric-sub">货物成本 ¥{fmtK(finance.goods_cost)}</div>
            </div>
            <div className="dash-metric-tile">
              <div className="dash-metric-label">货物成本</div>
              <div className="dash-metric-value" style={{ color: STYLE.text }}>
                <AnimatedNumber value={finance.goods_cost || 0} format={fmtK} prefix="¥" />
              </div>
              <div className="dash-metric-sub">其他成本 ¥{fmtK(finance.other_costs_total)}</div>
            </div>
          </div>
        </div>
      )}

      {/* 导购任务 */}
      <div className="dash-sales-panel" style={{ marginBottom: gap }}>
        <div className="dash-section-header">
          <div className="dash-section-title">{year}年{month}月 {canViewFinance ? '导购任务完成情况' : '我的业绩完成情况'}</div>
        </div>
        {salesData.length > 0 ? (
          <div>
            <div className="dash-sales-head">
              <div style={{ width: isMobile ? 64 : 88, flexShrink: 0 }}>导购</div>
              <div style={{ flex: 1, minWidth: 8 }}>完成进度</div>
              <div style={{ width: isMobile ? 104 : 124, flexShrink: 0, textAlign: 'right' }}>成交 / 目标</div>
            </div>
            {salesData.map((s) => {
              const tag = salesTag(s.ratio);
              const zero = s.completed_amount === 0;
              return (
                <div
                  key={s.user_id}
                  className="dash-sales-row"
                  onClick={() => navigate(`/orders?salesperson_id=${s.user_id}`)}
                >
                  <div style={{ width: isMobile ? 64 : 88, flexShrink: 0, minWidth: 8 }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: STYLE.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.display_name}</div>
                    <Tag color={tag.color} style={{ marginTop: 3, fontSize: 12, lineHeight: '15px', padding: '0 5px', marginRight: 0 }}>{tag.text} {s.ratio}%</Tag>
                  </div>
                  <div style={{ flex: 1, minWidth: 8, paddingRight: 4 }}>
                    <Progress percent={Math.min(s.ratio, 100)} strokeColor={SALES_BAR_COLORS[tag.color] || PRIMARY} trailColor={STYLE.borderLight} strokeWidth={6} showInfo={false} />
                  </div>
                  <div style={{ width: isMobile ? 104 : 124, flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: zero ? 'var(--color-error)' : STYLE.text }}>
                      ¥{fmtK(s.completed_amount)}
                      <span style={{ fontSize: 12, fontWeight: 400, color: STYLE.textTertiary }}> / {fmtK(s.target_amount)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: STYLE.textTertiary }}>{s.order_count} 单</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="暂无导购数据" description="本月暂无导购任务数据" />
        )}
      </div>

      {/* 经营分析图表已移出首页，数据仍经 /analytics 接口支撑导出报表 */}

      {/* 最近订单 */}
      <Card
        size="small"
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>最近订单</span>
            <Space size={4} wrap>
              {orderFilters.map(f => (
                <Tag
                  key={f.key}
                  color={orderFilter === f.key ? STYLE.primary : undefined}
                  style={{ cursor: 'pointer', marginRight: 0 }}
                  onClick={() => setOrderFilter(f.key)}
                >{f.label}</Tag>
              ))}
            </Space>
          </div>
        }
        bodyStyle={{ padding: isMobile ? 12 : 16 }}
      >
        {isMobile ? (
          <MobileOrderList orders={filteredOrders} onOpen={(id) => navigate(`/orders/${id}`)} />
        ) : (
          <Table
            dataSource={filteredOrders}
            columns={orderColumns}
            rowKey="id" loading={loading} size="small" pagination={false}
            onRow={(r) => ({ onClick: () => navigate(`/orders/${r.id}`), style: { cursor: 'pointer' } })}
          />
        )}
      </Card>

      {/* 经营简报海报 */}
      <div style={{ position: 'absolute', left: -99999, top: 0, pointerEvents: 'none' }}>
        <div ref={briefRef} style={{
          width: 360, padding: 24, background: '#ffffff', color: '#222222',
          fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif', boxSizing: 'border-box',
        }}>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--color-primary)' }}>{brand.store_name || '我的门店'}</div>
            <div style={{ fontSize: 16, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{year}年{month}月 · 经营简报</div>
          </div>
          <div style={{ background: 'var(--color-primary-light)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>门店目标完成率</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--color-primary)' }}>{store.ratio}%</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>已完成 ¥{fmtK(store.revenue)} / 目标 ¥{fmtK(store.target_amount)}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>本月订单</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{overview.total_orders}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>本月收款</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>¥{fmtK(overview.total_revenue)}</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>净利率</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{financeBrief?.profit_margin?.toFixed(1)}%</div>
            </div>
          </div>
          {yoy && yoy.revenue?.pct != null && (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 14, textAlign: 'center' }}>
              收款同比 {yoy.revenue.pct >= 0 ? '▲' : '▼'} {Math.abs(yoy.revenue.pct)}%
            </div>
          )}
          <div style={{ borderTop: '1px solid #eeeeee', paddingTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            业绩贡献：{brief?.top_salesperson}　|　滞后导购：{brief?.lagging_count} 名
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: '#bbbbbb', textAlign: 'center' }}>{`${brand.store_name || '我的门店'}${brand.store_address ? ' · ' + brand.store_address : ''}`}</div>
        </div>
      </div>

      <Modal
        open={briefModalOpen}
        title={`${year}年${month}月 经营简报`}
        footer={[
          <Button key="dl" icon={<DownloadOutlined />} onClick={handleDownloadBrief}>保存图片</Button>,
          <Button key="share" type="primary" icon={<ShareAltOutlined />} onClick={handleShareBrief}>分享</Button>,
          <Button key="close" onClick={() => setBriefModalOpen(false)}>关闭</Button>,
        ]}
        onCancel={() => setBriefModalOpen(false)}
        className="modal-sm"
        bodyStyle={{ textAlign: 'center' }}
      >
        {briefImg && <img src={briefImg} style={{ width: '100%', borderRadius: 8 }} alt="经营简报" />}
      </Modal>
    </div>
  );
}
