import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { storeClauseAndParams } from '../utils/storeScope.js';
import * as aggCache from '../utils/aggCache.js';

const router = Router();
// 工作台首页：所有登录角色均可访问。角色分层在 handler 内按 req.user 处理：
// - admin/boss：看全店（受 ?store_id 限定，未传则全部）
// - sales：仅看本人相关数据（我的待跟进 / 我的齐货待送 / 我的业绩 / 我的订单）
router.use(authMiddleware);

// 工作台统计数据（含月度任务完成情况）
router.get('/', (req, res) => {
  const db = getDb();
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const month = parseInt(req.query.month) || (now.getMonth() + 1);

  // 聚合缓存：key 必须含「角色 + 用户 + 门店 + 年月」四个维度，
  // 少一个就会串数据（如销售员 A 看到 B 的业绩）。指纹负责写后自动失效。
  const cacheKey = ['dash', req.user.role, req.user.id, req.query.store_id || 'all', year, month].join('|');
  const hit = aggCache.get(db, cacheKey);
  if (hit) {
    res.json(hit.value);
    return;
  }

  const isSales = req.user.role === 'sales';
  const salesId = req.user.id;
  // 销售员维度收窄：所有订单类查询追加 salesperson 过滤
  const salesClause = isSales ? ' AND o.salesperson_id = ?' : '';
  const salesParams = isSales ? [salesId] : [];

  // 门店隔离（Phase 1）：admin/boss 受 ?store_id 限定，未传则看全部；sales 强制自身店
  const sc = storeClauseAndParams(req, 'o');
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  // ----- 基础概览（本月） -----
  const totalOrders = db.prepare(
    `SELECT COUNT(*) as c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}${salesClause}`
  ).get(monthStart, nextMonth, ...sc.params, ...salesParams).c;

  const totalRevenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) as v
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}${salesClause}
  `).get(monthStart, nextMonth, ...sc.params, ...salesParams).v;

  const purchasing = db.prepare(
    `SELECT COUNT(*) as c FROM orders o WHERE o.status = 'purchasing' ${sc.clause}${salesClause}`
  ).get(...sc.params, ...salesParams).c;

  const completed = db.prepare(
    `SELECT COUNT(*) as c FROM orders o WHERE o.status = 'completed' ${sc.clause}${salesClause}`
  ).get(...sc.params, ...salesParams).c;

  // 待跟进订单：待收款 + 待配送 + 备货中
  const followUp = db.prepare(`
    SELECT COUNT(*) as c FROM orders o
    WHERE o.status IN ('pending','deposited','purchasing','ordered','arrived','ready')
      AND o.status != 'cancelled' ${sc.clause}${salesClause}
  `).get(...sc.params, ...salesParams).c;

  // ----- 门店月度任务（按当前门店作用域求和，多店模式下为所选门店目标合计） -----
  const storeTarget = db.prepare(
    `SELECT COALESCE(SUM(target_amount), 0) as v FROM monthly_targets WHERE year = ? AND month = ? AND user_id IS NULL AND store_id IN (${sc.params.map(() => '?').join(',')})`
  ).get(year, month, ...sc.params);

  // 本月门店总成交额（所有非取消订单的本月支付金额）
  const storeRevenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) as v
    FROM payments p
    JOIN orders o ON o.id = p.order_id
    WHERE o.created_at >= ? AND o.created_at < ?
      AND o.status != 'cancelled' ${sc.clause}
  `).get(monthStart, nextMonth, ...sc.params).v;

  // ----- 导购任务完成情况 -----
  // 每个导购的本月目标（按门店作用域过滤，仅显示当前所选门店的导购）
  const salesTargets = db.prepare(`
    SELECT u.id as user_id, u.display_name,
      COALESCE(t.target_amount, 0) as target_amount
    FROM users u
    LEFT JOIN monthly_targets t ON t.user_id = u.id AND t.year = ? AND t.month = ?
    WHERE u.role = 'sales' AND u.active = 1
      AND u.store_id IN (${sc.params.map(() => '?').join(',')})
      ${isSales ? 'AND u.id = ?' : ''}
    ORDER BY u.display_name
  `).all(...(isSales ? [year, month, ...sc.params, salesId] : [year, month, ...sc.params]));

  // 每个导购的本月实际成交额
  const salesActuals = db.prepare(`
    SELECT o.salesperson_id,
      COALESCE(SUM(o.total_amount), 0) as completed_amount,
      COUNT(DISTINCT o.id) as order_count
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ?
      AND o.status != 'cancelled'
      AND o.salesperson_id IS NOT NULL ${sc.clause}${salesClause}
    GROUP BY o.salesperson_id
  `).all(monthStart, nextMonth, ...sc.params, ...salesParams);

  // 合并数据
  const actualMap = {};
  salesActuals.forEach(a => { actualMap[a.salesperson_id] = a; });

  const salesData = salesTargets.map(s => ({
    user_id: s.user_id,
    display_name: s.display_name,
    target_amount: s.target_amount,
    completed_amount: actualMap[s.user_id]?.completed_amount || 0,
    order_count: actualMap[s.user_id]?.order_count || 0,
    ratio: s.target_amount > 0
      ? Math.round((actualMap[s.user_id]?.completed_amount || 0) / s.target_amount * 100)
      : 0
  })).sort((a, b) => b.ratio - a.ratio);

  const storeTargetAmount = storeTarget?.v || 0;
  const storeRatio = storeTargetAmount > 0
    ? Math.round(storeRevenue / storeTargetAmount * 100)
    : 0;

  // ----- 经营利润（仅 admin/boss 透出；销售员不计算全店成本，避免越权感知与无谓查询） -----
  let goodsCost = 0, otherCosts = 0, profit = 0, profitMargin = 0;
  if (!isSales) {
    goodsCost = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0) as v
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    `).get(monthStart, nextMonth, ...sc.params).v;

    otherCosts = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM other_costs
      WHERE year = ? AND month = ?
    `).get(year, month).v;

    profit = storeRevenue - goodsCost - otherCosts;
    profitMargin = storeRevenue > 0 ? (profit / storeRevenue * 100) : 0;
  }

  // 业绩第一名与严重滞后人数（完成率<50%视为滞后）
  const sortedSales = [...salesData].sort((a, b) => b.completed_amount - a.completed_amount);
  const topSalesperson = sortedSales[0]?.display_name || '-';
  const laggingCount = salesData.filter(s => s.target_amount > 0 && s.ratio < 50).length;

  // ----- 同比数据（与去年同期对比，仅 admin/boss 计算透出） -----
  const nowDate = new Date();
  const todayStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;

  // ----- 异常提醒 -----
  // 销售员不关心全店导购 0 业绩 / 全店低库存，置 0 避免噪音与越权感知
  const zeroSales = isSales ? 0 : salesData.filter(s => s.completed_amount === 0).length;

  const overdueDelivery = db.prepare(`
    SELECT COUNT(*) as c FROM orders o
    WHERE o.delivery_date IS NOT NULL AND o.delivery_date < ?
      AND o.status NOT IN ('signed','completed','cancelled') ${sc.clause}${salesClause}
  `).get(todayStr, ...sc.params, ...salesParams).c;

  const thresholdRow = db.prepare("SELECT value FROM system_config WHERE key = 'low_stock_threshold'").get();
  const lowStockThreshold = thresholdRow ? (Number(thresholdRow.value) || 5) : 5;
  const lowStock = isSales ? 0 : db.prepare(`
    SELECT COUNT(*) as c FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.active = 1 AND COALESCE(i.quantity, p.stock) <= ?
  `).get(lowStockThreshold).c;

  // ----- 齐货待送货提醒（销售单已齐货，可直接触发送货） -----
  const readyToShip = db.prepare(`
    SELECT id, order_no, customer_name, status, actual_amount, updated_at
    FROM orders o
    WHERE o.status IN ('ready','balance_paid') ${sc.clause}${salesClause}
    ORDER BY o.updated_at DESC
    LIMIT 12
  `).all(...sc.params, ...salesParams);

  const readyToShipCount = db.prepare(`
    SELECT COUNT(*) as c FROM orders o
    WHERE o.status IN ('ready','balance_paid') ${sc.clause}${salesClause}
  `).get(...sc.params, ...salesParams).c;

  const alerts = {
    zero_sales: zeroSales,
    overdue_delivery: overdueDelivery,
    low_stock: lowStock,
    ready_to_ship: readyToShipCount,
  };

  // ----- 最近订单 -----
  const recentOrders = db.prepare(`
    SELECT o.*, u.display_name as salesperson_name
    FROM orders o
    LEFT JOIN users u ON o.salesperson_id = u.id
    WHERE 1=1 ${sc.clause}${salesClause}
    ORDER BY o.created_at DESC
    LIMIT 8
  `).all(...sc.params, ...salesParams);

  // 同比仅在 admin/boss 透出；销售员 KPI 不显示全店同比
  let yoy = null;
  if (!isSales) {
    const lyMonthStart = `${year - 1}-${String(month).padStart(2, '0')}-01`;
    const lyNextMonth = month === 12 ? `${year}-01-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}-01`;

    const lyRevenue = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) as v
      FROM payments p
      JOIN orders o ON o.id = p.order_id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    `).get(lyMonthStart, lyNextMonth, ...sc.params).v;

    const lyOrders = db.prepare(
      `SELECT COUNT(*) as c FROM orders o WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}`
    ).get(lyMonthStart, lyNextMonth, ...sc.params).c;

    const lyGoodsCost = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0) as v
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' ${sc.clause}
    `).get(lyMonthStart, lyNextMonth, ...sc.params).v;

    const lyOtherCosts = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as v FROM other_costs WHERE year = ? AND month = ?"
    ).get(year - 1, month).v;

    const lyProfit = lyRevenue - lyGoodsCost - lyOtherCosts;

    const yoyPct = (cur, last) => last > 0 ? Math.round((cur - last) / last * 100) : null;

    yoy = {
      revenue: { current: storeRevenue, last: lyRevenue, pct: yoyPct(storeRevenue, lyRevenue) },
      orders: { current: totalOrders, last: lyOrders, pct: yoyPct(totalOrders, lyOrders) },
      profit: { current: profit, last: lyProfit, pct: yoyPct(profit, lyProfit) },
    };
  }

  const payload = {
    success: true,
    year,
    month,
    overview: {
      total_orders: totalOrders,
      total_revenue: totalRevenue,
      purchasing,
      completed,
      follow_up: followUp
    },
    // 财务与门店汇总仅 admin/boss 透出，销售员返回空防止越权感知
    store: isSales ? { target_amount: 0, revenue: 0, ratio: 0 } : {
      target_amount: storeTargetAmount,
      revenue: storeRevenue,
      ratio: storeRatio
    },
    finance_brief: isSales ? null : {
      revenue: storeRevenue,
      goods_cost: goodsCost,
      other_costs: otherCosts,
      profit,
      profit_margin: profitMargin
    },
    brief: isSales ? null : {
      top_salesperson: topSalesperson,
      lagging_count: laggingCount,
      profit_margin: profitMargin
    },
    yoy,
    alerts,
    ready_to_ship_list: readyToShip,
    sales: salesData,
    recent_orders: recentOrders
  };
  aggCache.set(db, cacheKey, payload);
  res.json(payload);
});

export default router;
