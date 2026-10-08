import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { storeClauseAndParams } from '../utils/storeScope.js';
import * as aggCache from '../utils/aggCache.js';

// 经营分析驾驶舱 · 只读分析接口（纯增量，不改动现有 dashboard 接口与任何表结构）
// 权限：仅 admin / boss（与工作台 Dashboard 一致）
// 门店隔离：所有订单/客户类指标按当前用户门店范围过滤；admin/boss 选"全部"时看全部门店（零回归）
const router = Router();
router.use(authMiddleware, roleMiddleware('admin', 'boss'));

router.get('/', (req, res) => {
  const db = getDb();
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);

  // 聚合缓存：key 含「角色 + 用户 + 门店 + 年月」（本接口仅 admin/boss，仍保留用户维度以防将来放开）
  const cacheKey = ['analytics', req.user.role, req.user.id, req.query.store_id || 'all', year, month].join('|');
  const hit = aggCache.get(db, cacheKey);
  if (hit) {
    res.json(hit.value);
    return;
  }

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const yearStart = `${year}-01-01`;
  const nextYear = `${year + 1}-01-01`;

  // 门店隔离子句：o=订单/支付，c=客户，t=月度目标
  const sc = storeClauseAndParams(req, 'o');
  const scC = storeClauseAndParams(req, 'c');
  const scT = storeClauseAndParams(req, 't');

  // ---------- 1. 销售走势：当月每日（现金流 vs 签单） ----------
  const dailyRev = db.prepare(`
    SELECT substr(p.created_at,1,10) AS d, COALESCE(SUM(p.amount),0) AS rev
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY d
  `).all(monthStart, nextMonth, ...sc.params);

  const dailyOrders = db.prepare(`
    SELECT substr(o.created_at,1,10) AS d, COUNT(*) AS cnt
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY d
  `).all(monthStart, nextMonth, ...sc.params);

  const revMap = {}, ordMap = {};
  dailyRev.forEach(r => { revMap[r.d] = r.rev; });
  dailyOrders.forEach(r => { ordMap[r.d] = r.cnt; });

  const daysInMonth = new Date(year, month, 0).getDate();
  const daily = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    daily.push({
      day: `${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      revenue: revMap[ds] || 0,
      orders: ordMap[ds] || 0,
    });
  }

  // ---------- 1b. 销售走势：当年每月（年度视图） ----------
  const monthlyRev = db.prepare(`
    SELECT substr(p.created_at,1,7) AS m, COALESCE(SUM(p.amount),0) AS rev
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY m
  `).all(yearStart, nextYear, ...sc.params);

  const monthlyOrders = db.prepare(`
    SELECT substr(o.created_at,1,7) AS m, COUNT(*) AS cnt
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY m
  `).all(yearStart, nextYear, ...sc.params);

  const mRevMap = {}, mOrdMap = {};
  monthlyRev.forEach(r => { mRevMap[r.m] = r.rev; });
  monthlyOrders.forEach(r => { mOrdMap[r.m] = r.cnt; });

  const monthly = [];
  for (let m = 1; m <= 12; m++) {
    const ms = `${year}-${String(m).padStart(2, '0')}`;
    monthly.push({
      month: `${m}月`,
      revenue: mRevMap[ms] || 0,
      orders: mOrdMap[ms] || 0,
    });
  }

  // ---------- 1c. 去年同期（走势图虚线对比，复用同口径） ----------
  const lyMonthStart = `${year - 1}-${String(month).padStart(2, '0')}-01`;
  const lyNextMonth = month === 12 ? `${year}-01-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}-01`;
  const lyYearStart = `${year - 1}-01-01`;
  const lyNextYear = `${year}-01-01`;

  const lyDailyRev = db.prepare(`
    SELECT substr(p.created_at,1,10) AS d, COALESCE(SUM(p.amount),0) AS rev
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY d
  `).all(lyMonthStart, lyNextMonth, ...sc.params);

  const lyDailyOrd = db.prepare(`
    SELECT substr(o.created_at,1,10) AS d, COUNT(*) AS cnt
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY d
  `).all(lyMonthStart, lyNextMonth, ...sc.params);

  const lyRevMap = {}, lyOrdMap = {};
  lyDailyRev.forEach(r => { lyRevMap[r.d] = r.rev; });
  lyDailyOrd.forEach(r => { lyOrdMap[r.d] = r.cnt; });

  const dailyLyy = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year - 1}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    dailyLyy.push({
      day: `${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      revenueLyy: lyRevMap[ds] || 0,
      ordersLyy: lyOrdMap[ds] || 0,
    });
  }

  const lyMonthlyRev = db.prepare(`
    SELECT substr(p.created_at,1,7) AS m, COALESCE(SUM(p.amount),0) AS rev
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY m
  `).all(lyYearStart, lyNextYear, ...sc.params);

  const lyMonthlyOrd = db.prepare(`
    SELECT substr(o.created_at,1,7) AS m, COUNT(*) AS cnt
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY m
  `).all(lyYearStart, lyNextYear, ...sc.params);

  const lyMRevMap = {}, lyMOrdMap = {};
  lyMonthlyRev.forEach(r => { lyMRevMap[r.m] = r.rev; });
  lyMonthlyOrd.forEach(r => { lyMOrdMap[r.m] = r.cnt; });

  const monthlyLyy = [];
  for (let m = 1; m <= 12; m++) {
    const ms = `${year - 1}-${String(m).padStart(2, '0')}`;
    monthlyLyy.push({
      month: `${m}月`,
      revenueLyy: lyMRevMap[ms] || 0,
      ordersLyy: lyMOrdMap[ms] || 0,
    });
  }

  // ---------- 2. 品类占比（环形图） ----------
  const catRows = db.prepare(`
    SELECT COALESCE(p.category, oi.product_type) AS cat,
           COALESCE(SUM(oi.total_price), 0) AS amount,
           COUNT(DISTINCT oi.order_id) AS orders
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY cat
  `).all(monthStart, nextMonth, ...sc.params);

  const catLabel = { order: '正价商品', sample: '样品', gift: '赠品' };
  const category = catRows.map(r => ({
    key: r.cat,
    label: catLabel[r.cat] || r.cat,
    amount: r.amount,
    orders: r.orders,
  }));

  // ---------- 3. 客单价（当月 + 近12月趋势） ----------
  const monthRevenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS v
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
  `).get(monthStart, nextMonth, ...sc.params).v;

  const monthOrders = db.prepare(
    `SELECT COUNT(*) AS c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}`
  ).get(monthStart, nextMonth, ...sc.params).c;

  const aovCurrent = monthOrders > 0 ? Math.round(monthRevenue / monthOrders) : 0;
  const aovSeries = monthly.map(m => ({
    month: m.month,
    aov: m.orders > 0 ? Math.round(m.revenue / m.orders) : 0,
  }));

  // ---------- 4. 导购金额排行榜（按成交金额降序） ----------
  const salesTargets = db.prepare(`
    SELECT u.id AS user_id, u.display_name, COALESCE(t.target_amount, 0) AS target_amount
    FROM users u
    LEFT JOIN monthly_targets t ON t.user_id = u.id AND t.year = ? AND t.month = ? ${scT.clause}
    WHERE u.role = 'sales' AND u.active = 1
    ORDER BY u.display_name
  `).all(year, month, ...scT.params);

  const salesActuals = db.prepare(`
    SELECT o.salesperson_id,
           COALESCE(SUM(o.total_amount), 0) AS completed_amount,
           COUNT(DISTINCT o.id) AS order_count
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ?
      AND o.status != 'cancelled' AND o.salesperson_id IS NOT NULL ${sc.clause}
    GROUP BY o.salesperson_id
  `).all(monthStart, nextMonth, ...sc.params);

  const actualMap = {};
  salesActuals.forEach(a => { actualMap[a.salesperson_id] = a; });

  const salesRank = salesTargets.map(s => ({
    user_id: s.user_id,
    display_name: s.display_name,
    target_amount: s.target_amount,
    completed_amount: actualMap[s.user_id]?.completed_amount || 0,
    order_count: actualMap[s.user_id]?.order_count || 0,
  })).sort((a, b) => b.completed_amount - a.completed_amount);

  // ---------- 5. 客户转化漏斗（嵌套累计，单调递减才有意义） ----------
  // 客户表只存"当前状态"无历史，故用嵌套集合近似转化路径：
  // 累计客户(全部) → 已跟进(非新客) → 意向客户(意向+成交) → 已成交
  const custTotal = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE 1=1 ${scC.clause}`).get(...scC.params).c;
  const custFollowed = db.prepare(
    `SELECT COUNT(*) AS c FROM customers c WHERE c.status IN ('following','intention','deal') ${scC.clause}`
  ).get(...scC.params).c;
  const custIntention = db.prepare(
    `SELECT COUNT(*) AS c FROM customers c WHERE c.status IN ('intention','deal') ${scC.clause}`
  ).get(...scC.params).c;
  const custDeal = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE c.status = 'deal' ${scC.clause}`).get(...scC.params).c;
  const funnel = [
    { stage: '累计客户', count: custTotal },
    { stage: '已跟进', count: custFollowed },
    { stage: '意向客户', count: custIntention },
    { stage: '已成交', count: custDeal },
  ];

  // ---------- 6. 毛利分析（与品类占比口径一致：所有未取消订单明细；已取消不计） ----------
  // 毛利 = 成交金额 - 进货成本（order_items.cost_price 快照）；毛利率 = 毛利 / 成交金额
  const gpMonthly = db.prepare(`
    SELECT substr(o.created_at,1,7) AS m,
           COALESCE(SUM(oi.total_price), 0) AS amount,
           COALESCE(SUM(oi.cost_price * oi.quantity), 0) AS cost
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'
      ${sc.clause}
    GROUP BY m
  `).all(yearStart, nextYear, ...sc.params);

  const gpCat = db.prepare(`
    SELECT COALESCE(p.category, oi.product_type) AS cat,
           COALESCE(SUM(oi.total_price), 0) AS amount,
           COALESCE(SUM(oi.cost_price * oi.quantity), 0) AS cost
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'
      ${sc.clause}
    GROUP BY cat
  `).all(monthStart, nextMonth, ...sc.params);

  const gpMRevMap = {}, gpMCostMap = {};
  gpMonthly.forEach(r => { gpMRevMap[r.m] = r.amount; gpMCostMap[r.m] = r.cost; });

  const grossProfitMonthly = [];
  for (let m = 1; m <= 12; m++) {
    const ms = `${year}-${String(m).padStart(2, '0')}`;
    const amount = gpMRevMap[ms] || 0;
    const cost = gpMCostMap[ms] || 0;
    const profit = amount - cost;
    grossProfitMonthly.push({
      month: `${m}月`,
      amount,
      cost,
      profit,
      margin: amount > 0 ? Math.round((profit / amount) * 1000) / 10 : 0,
    });
  }

  const gpCur = gpMonthly.find(r => r.m === `${year}-${String(month).padStart(2, '0')}`) || { amount: 0, cost: 0 };
  const grossProfitCurrent = {
    amount: gpCur.amount,
    cost: gpCur.cost,
    profit: gpCur.amount - gpCur.cost,
    margin: gpCur.amount > 0 ? Math.round(((gpCur.amount - gpCur.cost) / gpCur.amount) * 1000) / 10 : 0,
  };

  const grossProfitCategory = gpCat.map(r => ({
    key: r.cat,
    label: catLabel[r.cat] || r.cat,
    amount: r.amount,
    cost: r.cost,
    profit: r.amount - r.cost,
    margin: r.amount > 0 ? Math.round(((r.amount - r.cost) / r.amount) * 1000) / 10 : 0,
  })).sort((a, b) => b.profit - a.profit);

  // ---------- 7. 商品畅销榜（按成交金额降序，含销量/毛利） ----------
  const productRows = db.prepare(`
    SELECT oi.product_id,
           COALESCE(p.name, oi.product_name) AS name,
           COALESCE(p.category, oi.product_type) AS cat,
           COALESCE(SUM(oi.quantity), 0) AS qty,
           COALESCE(SUM(oi.total_price), 0) AS amount,
           COALESCE(SUM(oi.cost_price * oi.quantity), 0) AS cost
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    LEFT JOIN products p ON oi.product_id = p.id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    GROUP BY oi.product_id, name, cat
    ORDER BY amount DESC
    LIMIT 20
  `).all(monthStart, nextMonth, ...sc.params);

  const productRank = productRows.map((r, i) => ({
    rank: i + 1,
    product_id: r.product_id,
    name: r.name,
    cat: r.cat,
    catLabel: catLabel[r.cat] || r.cat,
    qty: r.qty,
    amount: r.amount,
    cost: r.cost,
    profit: r.amount - r.cost,
  }));

  const payload = {
    success: true,
    year,
    month,
    trend: { daily, monthly, dailyLyy, monthlyLyy },
    category,
    aov: { current: aovCurrent,  series: aovSeries },
    salesRank,
    funnel,
    grossProfit: { current: grossProfitCurrent, category: grossProfitCategory,  monthly: grossProfitMonthly },
    productRank,
  };
  aggCache.set(db, cacheKey, payload);
  res.json(payload);
});

export default router;
