// ============================================================
// 经营分析 · 图表组件集（统一设计语言）
// - 全部复用 Dashboard.tokens 的 chartTipStyle / axisTick / gridStroke / ANALYTICS_PALETTE
// - 颜色一律走 CSS 变量或陶土 palette，禁止散落裸 hex（颜色门禁约束）
// - 统一 tooltip / 坐标轴 / 网格，取消彩虹配色，保证与工作台 v4 视觉一致
// ============================================================
import {
  ComposedChart, Area, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { STYLE, ANALYTICS_PALETTE, chartTipStyle, axisTick, gridStroke, fmtMoney, fmtK } from './Dashboard.tokens';

const PALETTE = ANALYTICS_PALETTE();
const PRIMARY = STYLE.primary;

const moneyTip = (v) => `¥${fmtMoney(v)}`;

// ---------- 1. 销售走势（月度视图=按日，年度视图=按月，含同比虚线） ----------
export function SalesTrendChart({ daily, monthly, dailyLyy, monthlyLyy, view, isMobile }) {
  const isYear = view === 'year';
  const base = isYear ? (monthly || []) : (daily || []);
  const lyy = isYear ? (monthlyLyy || []) : (dailyLyy || []);
  const merged = base.map((b, i) => ({
    name: isYear ? b.month : b.day,
    收款: b.revenue || 0,
    订单: b.orders || 0,
    同比: lyy[i]?.revenueLyy ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={isMobile ? 240 : 300}>
      <ComposedChart data={merged} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.28} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: gridStroke }}
          interval={isYear ? 0 : 'preserveStartEnd'} minTickGap={16} />
        <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={fmtK} />
        <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false} width={32} />
        <Tooltip contentStyle={chartTipStyle}
          formatter={(v, n) => (n === '订单' ? `${v} 单` : moneyTip(v))} />
        <Area yAxisId="left" type="monotone" dataKey="收款" stroke={PRIMARY} strokeWidth={2} fill="url(#trendFill)" />
        <Bar yAxisId="right" dataKey="订单" fill={PALETTE[3]} barSize={isMobile ? 10 : 14} radius={[3, 3, 0, 0]} />
        <Line yAxisId="left" type="monotone" dataKey="同比" stroke={PALETTE[4]} strokeWidth={1.5} strokeDasharray="5 4" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------- 2. 品类占比（环形 + 自定义图例） ----------
export function CategoryPieChart({ category, isMobile }) {
  const total = (category || []).reduce((s, c) => s + (c.amount || 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: 16, height: '100%' }}>
      <div style={{ width: 200, height: 200, position: 'relative', flexShrink: 0 }}>
        <ResponsiveContainer>
          <PieChart>
            <Pie data={category} dataKey="amount" nameKey="label" innerRadius="58%" outerRadius="82%"
              paddingAngle={2} stroke="var(--color-bg-white)" strokeWidth={2}>
              {category.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={chartTipStyle} formatter={moneyTip} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>总成交</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)' }}>{fmtK(total)}</div>
        </div>
      </div>
      <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {category.map((c, i) => {
          const pct = total > 0 ? Math.round((c.amount / total) * 100) : 0;
          return (
            <div key={c.key || c.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], flexShrink: 0 }} />
              <span style={{ color: 'var(--color-text)', minWidth: 56 }}>{c.label}</span>
              <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>{fmtMoney(c.amount)}</span>
              <span style={{ color: 'var(--color-text-tertiary)', width: 40, textAlign: 'right' }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- 3a. 客单价（月度视图：大数字） ----------
export function AovStat({ current }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
      <div style={{ fontSize: 34, fontWeight: 700, color: PRIMARY }}>¥{fmtMoney(current || 0)}</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
        本月平均每单成交金额（总收款 ÷ 订单数）
      </div>
    </div>
  );
}

// ---------- 3b. 客单价（年度视图：近 12 月折线） ----------
export function AovTrend({ series, isMobile }) {
  return (
    <ResponsiveContainer width="100%" height={isMobile ? 220 : 260}>
      <ComposedChart data={series || []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: gridStroke }} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={fmtK} />
        <Tooltip contentStyle={chartTipStyle} formatter={moneyTip} />
        <Line type="monotone" dataKey="aov" name="客单价" stroke={PRIMARY} strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------- 4. 导购金额排行（条形 + 目标达成刻度） ----------
export function SalesRankChart({ salesRank }) {
  const list = salesRank || [];
  const max = Math.max(...list.map((s) => s.completed_amount || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center', height: '100%' }}>
      {list.map((s, i) => {
        const pct = Math.round((s.completed_amount / max) * 100);
        const targetPct = s.target_amount > 0 ? Math.min(100, Math.round((s.completed_amount / s.target_amount) * 100)) : null;
        return (
          <div key={s.user_id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>{s.display_name}</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                {fmtMoney(s.completed_amount)}
                {s.target_amount > 0 ? ` / 目标 ${fmtMoney(s.target_amount)}` : ''}
              </span>
            </div>
            <div style={{ position: 'relative', height: 10, borderRadius: 5, background: 'var(--color-border-light)' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 5, background: PALETTE[i % PALETTE.length] }} />
              {targetPct !== null && (
                <div style={{ position: 'absolute', top: -3, bottom: -3, left: `${targetPct}%`, width: 2, background: 'var(--color-text)', borderRadius: 1 }} />
              )}
            </div>
            {s.target_amount > 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>目标达成 {targetPct}%</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- 5. 客户阶段分布（SVG 梯形漏斗，重命名自原转化漏斗） ----------
export function StageFunnel({ funnel }) {
  const W = 300, stageH = 46, gap = 12, top = 6;
  const list = funnel || [];
  const max = Math.max(...list.map((f) => f.count || 0), 1);
  const maxW = 250;
  const cx = W / 2;
  const widths = list.map((f) => (f.count > 0 ? Math.max((f.count / max) * maxW, 30) : 8));
  const bands = list.map((f, i) => ({ ...f, y: top + i * (stageH + gap), w: widths[i], color: PALETTE[i % PALETTE.length] }));
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <svg viewBox={`0 0 ${W} ${top + list.length * (stageH + gap)}`} width="100%" style={{ maxWidth: 340 }}>
        {bands.slice(0, -1).map((b, i) => {
          const nb = bands[i + 1];
          const y1 = b.y + stageH, y2 = nb.y;
          const w1 = b.w / 2, w2 = nb.w / 2;
          return <polygon key={`c${i}`} points={`${cx - w1},${y1} ${cx + w1},${y1} ${cx + w2},${y2} ${cx - w2},${y2}`} fill={b.color} opacity={0.16} />;
        })}
        {bands.map((b) => (
          <g key={b.stage}>
            <rect x={cx - b.w / 2} y={b.y} width={b.w} height={stageH} rx={6} fill={b.color} />
            <text x={cx} y={b.y + stageH / 2 - 3} textAnchor="middle" fontSize="12" fill="#fff" fontWeight={600}>{b.stage}</text>
            <text x={cx} y={b.y + stageH / 2 + 13} textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.85)">{b.count} 人</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------- 6a. 毛利分析（月度视图：三指标 + 毛利率） ----------
export function GrossProfitStat({ current }) {
  const c = current || { amount: 0, cost: 0, profit: 0, margin: 0 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center', height: '100%' }}>
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <div><div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>成交金额</div><div style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(c.amount)}</div></div>
        <div><div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>成本</div><div style={{ fontSize: 20, fontWeight: 600 }}>{fmtMoney(c.cost)}</div></div>
        <div><div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>毛利</div><div style={{ fontSize: 20, fontWeight: 600, color: PRIMARY }}>{fmtMoney(c.profit)}</div></div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
        毛利率 <b style={{ color: c.margin >= 0 ? 'var(--color-success)' : 'var(--color-error)', fontSize: 18, marginLeft: 4 }}>{c.margin}%</b>
      </div>
    </div>
  );
}

// ---------- 6b. 毛利分析（年度视图：12 月毛利柱 + 毛利率线） ----------
export function GrossProfitYear({ monthly, isMobile }) {
  return (
    <ResponsiveContainer width="100%" height={isMobile ? 240 : 300}>
      <ComposedChart data={monthly || []} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={gridStroke} vertical={false} />
        <XAxis dataKey="month" tick={axisTick} tickLine={false} axisLine={{ stroke: gridStroke }} />
        <YAxis yAxisId="left" tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={fmtK} />
        <YAxis yAxisId="right" orientation="right" tick={axisTick} tickLine={false} axisLine={false} width={32} tickFormatter={(v) => `${v}%`} />
        <Tooltip contentStyle={chartTipStyle} formatter={(v, n) => (n === '毛利率' ? `${v}%` : moneyTip(v))} />
        <Bar yAxisId="left" dataKey="profit" name="毛利" fill={PALETTE[2]} radius={[3, 3, 0, 0]} barSize={isMobile ? 12 : 16} />
        <Line yAxisId="right" type="monotone" dataKey="margin" name="毛利率" stroke={PRIMARY} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ---------- 7. 商品畅销榜（带进度条排名列表） ----------
export function ProductRankChart({ productRank }) {
  const list = productRank || [];
  const max = Math.max(...list.map((p) => p.amount || 0), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', overflowY: 'auto' }}>
      {list.map((p) => {
        const pct = Math.round((p.amount / max) * 100);
        return (
          <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 22, height: 22, flexShrink: 0, borderRadius: '50%',
              background: p.rank <= 3 ? PRIMARY : 'var(--color-border-light)',
              color: p.rank <= 3 ? '#fff' : 'var(--color-text-tertiary)',
              fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{p.rank}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 8 }}>{fmtMoney(p.amount)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--color-border-light)', marginTop: 4 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: PALETTE[2] }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>销量 {p.qty} · 毛利 {fmtMoney(p.profit)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
