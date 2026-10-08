import { useState, useEffect, useCallback, useRef } from 'react';
import { Grid, Select, Segmented, message } from 'antd';
import { BarChartOutlined } from '@ant-design/icons';
import api from '../api';
import PageHeader from '../components/PageHeader';
import AnimatedNumber from '../components/AnimatedNumber';
import EmptyState from '../components/EmptyState';
import { useBrand } from '../context/BrandContext';
import { useStore } from '../context/StoreContext';
import { STYLE, fmtMoney } from './Dashboard.tokens';
import {
  SalesTrendChart, CategoryPieChart, AovStat, AovTrend,
  SalesRankChart, StageFunnel, GrossProfitStat, GrossProfitYear, ProductRankChart,
} from './Analytics.charts';
import './Analytics.css';

const { useBreakpoint: useBS } = Grid;

// 统一图表卡片外壳
function Card({ title, hint, full, children }) {
  return (
    <section className={`analytics-card ${full ? 'analytics-card--full' : ''}`}>
      <div className="analytics-card__head">
        <div className="analytics-card__title">{title}</div>
        {hint && <div className="analytics-card__hint">{hint}</div>}
      </div>
      <div className="analytics-card__body">{children}</div>
    </section>
  );
}

const scopeLabel = (year, month) => `${year}年${month}月`;

export default function Analytics() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [view, setView] = useState('month'); // month=本月 / year=本年
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const screens = useBS();
  const isMobile = !screens.md;
  const { brand } = useBrand();
  const { getStoreParam } = useStore();
  const reqRef = useRef(0);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    const myId = ++reqRef.current;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const params = { year, month };
      const sid = getStoreParam();
      if (sid) params.store_id = sid;
      const res = await api.get('/analytics', { params, signal: controller.signal });
      if (myId !== reqRef.current) return; // 已有更新请求，丢弃
      setData(res.data);
    } catch (e) {
      if (myId !== reqRef.current) return;
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
      setError(true);
      message.error('经营分析数据加载失败');
    } finally {
      if (myId === reqRef.current) setLoading(false);
    }
  }, [year, month, getStoreParam]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  // KPI（取自所选月份）
  const daily = data?.trend?.daily || [];
  const monthRevenue = daily.reduce((s, d) => s + (d.revenue || 0), 0);
  const monthOrders = daily.reduce((s, d) => s + (d.orders || 0), 0);
  const aov = data?.aov?.current || 0;
  const margin = data?.grossProfit?.current?.margin || 0;

  const kpis = [
    { label: '本月收款', value: monthRevenue, prefix: '¥', format: fmtMoney, sub: '所选月已收金额' },
    { label: '订单数', value: monthOrders, suffix: '单', sub: '所选月订单' },
    { label: '客单价', value: aov, prefix: '¥', format: fmtMoney, sub: '总收款 ÷ 订单数' },
    { label: '毛利率', value: margin, suffix: '%', sub: '毛利 ÷ 成交金额' },
  ];

  const yearOptions = [year - 2, year - 1, year, year + 1].map((y) => ({ value: y, label: `${y}年` }));
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` }));
  const scope = scopeLabel(year, month);

  const renderBody = (el, placeholder) => (el ? el : <div className="analytics-empty"><EmptyState title={placeholder} description={error ? '请稍后重试' : '正在加载经营分析数据'} /></div>);

  return (
    <div className="analytics-page">
      <PageHeader
        title="经营分析"
        subtitle="销售、商品、人员、客户的全面数据视角（仅管理员 / 老板可见）"
        icon={<BarChartOutlined style={{ color: 'var(--color-primary)' }} />}
      />

      <div className="analytics-toolbar">
        <Select value={year} options={yearOptions} onChange={setYear} style={{ width: 100 }} />
        <Select value={month} options={monthOptions} onChange={setMonth} style={{ width: 92 }} />
        <div className="analytics-toolbar__spacer" />
        <Segmented
          value={view}
          onChange={setView}
          options={[{ label: '本月', value: 'month' }, { label: '本年', value: 'year' }]}
        />
      </div>

      {/* KPI 概览条 */}
      <div className="analytics-kpi-row">
        {kpis.map((k) => (
          <div className="analytics-kpi" key={k.label}>
            <div className="analytics-kpi__label">{k.label}</div>
            <div className="analytics-kpi__value">
              {data ? (
                <AnimatedNumber value={k.value} format={k.format} prefix={k.prefix} suffix={k.suffix} />
              ) : (k.prefix || '') + '—'}
            </div>
            <div className="analytics-kpi__sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 图表网格 */}
      {!data ? (
        <div className="analytics-empty">
          <EmptyState title={error ? '加载失败' : '加载中…'} description={error ? '请稍后重试' : '正在加载经营分析数据'} />
        </div>
      ) : (
        <div className="analytics-grid">
          <Card title="销售走势" full hint={view === 'month' ? '按日 · 含去年同期' : '按月的全年走势'} >
            <SalesTrendChart
              daily={data.trend.daily} monthly={data.trend.monthly}
              dailyLyy={data.trend.dailyLyy} monthlyLyy={data.trend.monthlyLyy}
              view={view} isMobile={isMobile}
            />
          </Card>

          <Card title="品类占比" hint={scope}>
            {renderBody(data.category?.length ? <CategoryPieChart category={data.category} isMobile={isMobile} /> : null, '暂无品类数据')}
          </Card>

          <Card title="客单价" hint={view === 'month' ? scope : '近 12 月'}>
            {view === 'month'
              ? <AovStat current={aov} />
              : <AovTrend series={data.aov.series} isMobile={isMobile} />}
          </Card>

          <Card title="毛利分析" full hint={view === 'month' ? scope : '近 12 月'}>
            {view === 'month'
              ? <GrossProfitStat current={data.grossProfit.current} />
              : <GrossProfitYear monthly={data.grossProfit.monthly} isMobile={isMobile} />}
          </Card>

          <Card title="导购金额排行" hint={scope}>
            {renderBody(data.salesRank?.length ? <SalesRankChart salesRank={data.salesRank} /> : null, '暂无导购数据')}
          </Card>

          <Card title="商品畅销榜" hint={scope}>
            {renderBody(data.productRank?.length ? <ProductRankChart productRank={data.productRank} /> : null, '暂无商品数据')}
          </Card>

          <Card title="客户阶段分布" full hint={`${scope} · 累计客户→已跟进→意向→已成交`}>
            {renderBody(data.funnel?.length ? <StageFunnel funnel={data.funnel} /> : null, '暂无客户数据')}
          </Card>
        </div>
      )}
    </div>
  );
}
