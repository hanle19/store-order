import { useState, useEffect } from 'react';
import { Card, Table, Progress, Select, Space, Row, Col, Tag, Spin, message } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import dayjs from 'dayjs';

const STYLE = {
  primary: 'var(--color-primary)',
  text: 'var(--color-text)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  border: 'var(--color-border)',
  borderLight: 'var(--color-border-light)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
};

// 品牌色板（与系统主色 #A88C78 协调）
const CHART = {
  primary: 'var(--color-primary)',   // 主色 棕
  target: '#E3DDD6',                 // 浅棕（对照目标）
  success: 'var(--color-success)',   // 成交 绿
  neutral: '#C9BBAE',                // 未成交 灰棕
  series: ['#A88C78', '#8AA678', '#C9A66B', '#7E9CB8', '#B58DA6', '#9CB08A'],
};

const fmt = (v) => (v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });

const boardColumns = [
  { title: '导购', dataIndex: 'display_name', render: t => <span style={{ fontWeight: 500 }}>{t}</span> },
  { title: '月度目标', dataIndex: 'target_amount', align: 'right', render: v => `¥${fmt(v)}` },
  { title: '已提交业绩', dataIndex: 'completed_amount', align: 'right', render: v => `¥${fmt(v)}` },
  {
    title: '完成率', dataIndex: 'ratio', width: 160,
    render: (v) => <Progress percent={Math.round((v || 0) * 100)} strokeColor="var(--color-primary)" />,
  },
  { title: '客资数', dataIndex: 'customer_count', width: 80, align: 'center' },
];

export default function DailyBoard({ stats, onStatsChange, statsLoading }) {
  const { user } = useAuth();
  const role = user?.role || 'sales';
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);

  // 源分布 / 趋势（按当前年月 + 导购筛选）
  const [sources, setSources] = useState([]);
  const [trend, setTrend] = useState([]);
  const [extraLoading, setExtraLoading] = useState(false);

  const data = stats || null;

  // 老板/店长额外拉取：来源分布、趋势、待提交状态
  useEffect(() => {
    if (role === 'sales') return;
    let alive = true;
    setExtraLoading(true);
    Promise.allSettled([
      api.get('/daily/customer-source', { params: { year, month } }),
      api.get('/daily/stats', { params: { year, month } }),
    ]).then(([sRes, tRes]) => {
      if (!alive) return;
      if (sRes.status === 'fulfilled' && sRes.value.data.success) setSources(sRes.value.data.sources || []);
      if (tRes.status === 'fulfilled' && tRes.value.data.success) setTrend(tRes.value.data.trend || []);
    }).catch((err) => { console.error('加载来源/趋势失败', err); message.error('加载客户来源/趋势失败'); }).finally(() => { if (alive) setExtraLoading(false); });
    return () => { alive = false; };
  }, [year, month, role]);

  if (!data) return <div style={{ padding: 24, textAlign: 'center', color: STYLE.textTertiary }}>加载中…</div>;

  const per = data.per_salesperson || [];
  const store = data.store;
  const chartData = per.map(p => ({ name: p.display_name, 目标: p.target_amount, 已完成: p.completed_amount }));

  const yearOps = []; const cy = dayjs().year();
  for (let y = cy - 2; y <= cy + 1; y++) yearOps.push({ label: `${y}年`, value: y });
  const monthOps = [];
  for (let m = 1; m <= 12; m++) monthOps.push({ label: `${m}月`, value: m });

  const metricCard = (title, value, sub, extra) => (
    <Col xs={24} sm={8}>
      <div className="card-metric">
        <div className="metric-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 0, flexWrap: 'wrap', gap: 4 }}>
          <span>{title}</span>
          {extra && <span>{extra}</span>}
        </div>
        <div className="metric-value">{value}</div>
        {sub && <div className="metric-label" style={{ marginTop: 4 }}>{sub}</div>}
      </div>
    </Col>
  );

  // 待提交提醒（老板/店长）：今天谁交了谁没交
  const submittedMap = data.submitted_map || {};
  const notSubmitted = per.filter(p => !submittedMap[p.user_id]);

  // 转化率饼图：用来源分布聚合的成交/未成交
  const totalDeal = sources.reduce((s, x) => s + (x.deals || 0), 0);
  const totalCust = sources.reduce((s, x) => s + (x.c || 0), 0);
  const noDeal = Math.max(0, totalCust - totalDeal);
  const convPie = [
    { name: '成交', value: totalDeal, key: 'deal' },
    { name: '未成交', value: noDeal, key: 'nodeal' },
  ].filter(d => d.value > 0);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>数据看板</h2>
        <Space>
          <Select value={year} onChange={(y) => { setYear(y); onStatsChange && onStatsChange(y, month); }} options={yearOps} className="w-xs" />
          <Select value={month} onChange={(m) => { setMonth(m); onStatsChange && onStatsChange(year, m); }} options={monthOps} className="w-xs" />
        </Space>
      </div>

      {store && (
        <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 16 }}>
          {metricCard('全店完成金额', `¥${fmt(store.completed_amount)}`)}
          {metricCard('全店剩余金额', `¥${fmt(store.remaining)}`)}
          {metricCard('全店目标金额', `¥${fmt(store.target_amount)}`, null, `完成率 ${Math.round((store.ratio || 0) * 100)}%`)}
        </Row>
      )}

      {/* 待提交提醒（老板/店长） */}
      {role !== 'sales' && (
        <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }} title="今日提交状态">
          {notSubmitted.length === 0 ? (
            <Tag color="success">今日全部导购已提交日报 ✓</Tag>
          ) : (
            <Space wrap>
              <span style={{ color: STYLE.textSecondary }}>未提交：</span>
              {notSubmitted.map(p => <Tag key={p.user_id} color="warning">{p.display_name}</Tag>)}
            </Space>
          )}
        </Card>
      )}

      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }} title="各导购目标 vs 已完成">
        <div style={{ height: Math.max(240, per.length * 64) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }} />
              <Tooltip cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
              <Bar dataKey="目标" fill={CHART.target} radius={[4, 4, 0, 0]} />
              <Bar dataKey="已完成" fill={CHART.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 当月每日累计业绩趋势线 */}
      <Card size="small" style={{ marginBottom: 16, borderRadius: 10 }}
        title="当月每日累计成交金额" loading={extraLoading}>
        {trend.length === 0 ? (
          <div style={{ color: STYLE.textTertiary, padding: 24, textAlign: 'center' }}>本月暂无已提交日报数据</div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }} />
                <YAxis tick={{ fontSize: 12, fill: 'var(--color-text-secondary)' }} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }}
                  formatter={(v) => `¥${fmt(v)}`} />
                <Line type="monotone" dataKey="amount" name="累计成交金额" stroke={CHART.primary} strokeWidth={2.5}
                  dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* 成交转化率饼图 */}
        <Col xs={24} md={12}>
          <Card size="small" style={{ borderRadius: 10, height: '100%' }} title="成交转化率" loading={extraLoading}>
            {convPie.length === 0 ? (
              <div style={{ color: STYLE.textTertiary, padding: 24, textAlign: 'center' }}>暂无客资数据</div>
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={convPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85}
                      paddingAngle={2} label={(d) => `${d.name} ${((d.value / (totalDeal + noDeal)) * 100).toFixed(0)}%`}>
                      {convPie.map((d) => (
                        <Cell key={d.key} fill={d.key === 'deal' ? CHART.success : CHART.neutral} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            <div style={{ textAlign: 'center', fontSize: 'var(--font-size-sm)', color: STYLE.textSecondary, marginTop: 4 }}>
              本月客资 {totalCust} 组，成交率 {totalCust > 0 ? Math.round((totalDeal / totalCust) * 100) : 0}%
            </div>
          </Card>
        </Col>

        {/* 客户来源分布 */}
        <Col xs={24} md={12}>
          <Card size="small" style={{ borderRadius: 10, height: '100%' }} title="客户来源分布" loading={extraLoading}>
            {sources.length === 0 ? (
              <div style={{ color: STYLE.textTertiary, padding: 24, textAlign: 'center' }}>暂无来源数据</div>
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sources} dataKey="c" nameKey="source" cx="50%" cy="50%" outerRadius={85}
                      paddingAngle={2} label={(d) => d.source}>
                      {sources.map((s, i) => (
                        <Cell key={s.source} fill={CHART.series[i % CHART.series.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" style={{ borderRadius: 10 }} title={role === 'sales' ? '我的业绩明细' : '导购业绩明细'}>
        <Table
          rowKey="user_id" dataSource={per} pagination={false} size="small" loading={statsLoading}
          columns={boardColumns}
        />
      </Card>
    </div>
  );
}
