import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { storeClauseAndParams, resolveWriteStoreId } from '../utils/storeScope.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);
// 财务模块仅管理员和老板可访问，导购无权限
router.use(roleMiddleware('admin', 'boss'));

// 计算月份边界
function monthBounds(year, month) {
  const y = parseInt(year);
  const m = parseInt(month);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { y, m, monthStart, nextMonth };
}

// 退/换与售后的财务净影响（仅统计已完成的退/换单，按退/换单创建月归属）
// 返回：revenueAdj（实收冲减：退货退 refund；换货 = 新品售价 - 旧品原售价）
//       goodsCostAdj（货物成本：退货/换货旧品回冲成本；换货新品加成本）
//       aftersalesCost（售后成本：已完成/已关闭工单的 cost 合计）
// req 可选：传入时按当前用户可访问门店隔离（多店场景）；不传则跨店汇总（兼容旧调用）
function financeAdjustment(db, start, end, req) {
  const sc = req ? storeClauseAndParams(req, 'o') : { clause: '', params: [] };
  const sp = sc.params;
  const p = [start, end];
  // 主查询与 5 个子查询各含 1 处 ${sc.clause}，store 参数需重复 6 次以保证占位符对齐
  const args = [];
  for (let i = 0; i < 5; i++) { args.push(...p, ...sp); }
  args.push(start, end, ...sp);

  const row = db.prepare(`
    SELECT
      (COALESCE(SUM(CASE WHEN r.type='return' THEN r.refund_amount ELSE 0 END), 0)
        - COALESCE((SELECT SUM(ori.unit_price * ori.quantity)
                     FROM order_return_items ori JOIN order_returns rr ON rr.id = ori.return_id JOIN orders o ON o.id = rr.order_id
                     WHERE rr.type='exchange' AND ori.action='exchange_out' AND rr.status='completed'
                       AND rr.created_at >= ? AND rr.created_at < ? ${sc.clause}), 0)
        + COALESCE((SELECT SUM(ori.unit_price * ori.quantity)
                     FROM order_return_items ori JOIN order_returns rr ON rr.id = ori.return_id JOIN orders o ON o.id = rr.order_id
                     WHERE rr.type='exchange' AND ori.action='exchange_in' AND rr.status='completed'
                       AND rr.created_at >= ? AND rr.created_at < ? ${sc.clause}), 0)
      ) AS revenue_adj,
      (- COALESCE((SELECT SUM(ori.cost_price * ori.quantity)
                     FROM order_return_items ori JOIN order_returns rr ON rr.id = ori.return_id JOIN orders o ON o.id = rr.order_id
                     WHERE rr.type='return' AND ori.action='return_in' AND rr.status='completed'
                       AND rr.created_at >= ? AND rr.created_at < ? ${sc.clause}), 0)
        - COALESCE((SELECT SUM(ori.cost_price * ori.quantity)
                     FROM order_return_items ori JOIN order_returns rr ON rr.id = ori.return_id JOIN orders o ON o.id = rr.order_id
                     WHERE rr.type='exchange' AND ori.action='exchange_out' AND rr.status='completed'
                       AND rr.created_at >= ? AND rr.created_at < ? ${sc.clause}), 0)
        + COALESCE((SELECT SUM(ori.cost_price * ori.quantity)
                     FROM order_return_items ori JOIN order_returns rr ON rr.id = ori.return_id JOIN orders o ON o.id = rr.order_id
                     WHERE rr.type='exchange' AND ori.action='exchange_in' AND rr.status='completed'
                       AND rr.created_at >= ? AND rr.created_at < ? ${sc.clause}), 0)
      ) AS goods_cost_adj
    FROM order_returns r JOIN orders o ON o.id = r.order_id
    WHERE r.status='completed' AND r.created_at >= ? AND r.created_at < ? ${sc.clause}
  `).get(...args);

  // 售后成本独立查询：主查询依赖 order_returns 行，若周期内无任何 completed 退/换单，
  // 整行缺失会导致 aftersales_cost 被错误计为 0（漏算），故拆出独立子查询，避免受主表行影响。
  // order_aftersales 可能无 order_id（独立售后），用 LEFT JOIN 并保留未关联记录可见。
  const asStoreCond = sp.length ? `(o.store_id IN (${sp.join(',')}) OR o.id IS NULL)` : `o.id IS NULL`;
  const asRow = db.prepare(`
    SELECT COALESCE(SUM(a.cost), 0) AS v
    FROM order_aftersales a
    LEFT JOIN orders o ON o.id = a.order_id
    WHERE a.status IN ('completed','closed') AND a.created_at >= ? AND a.created_at < ?
      AND ${asStoreCond}
  `).get(start, end);

  return {
    revenueAdj: parseFloat((row && row.revenue_adj || 0).toFixed(2)),
    goodsCostAdj: parseFloat((row && row.goods_cost_adj || 0).toFixed(2)),
    aftersalesCost: parseFloat((Number(asRow && asRow.v) || 0).toFixed(2)),
  };
}

// 月度财务汇总
router.get('/monthly-summary', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: '请提供 year 和 month 参数' });
  }

  const { y, m, monthStart, nextMonth } = monthBounds(year, month);

  const sc = storeClauseAndParams(req, 'o');
  const scPo = storeClauseAndParams(req, 'purchase_orders');
  const scOc = storeClauseAndParams(req, 'oc');

  // 1. 销售收入（实收金额）：当月非取消订单对应的付款流水之和
  const salesData = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id
                WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ? ${sc.clause}), 0) as revenue,
      (SELECT COUNT(*) FROM orders o WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ? ${sc.clause}) as order_count
  `).get(monthStart, nextMonth, ...sc.params, monthStart, nextMonth, ...sc.params);

  // 2. 货物成本 + 亏损额：当月非取消订单中各商品的 cost_price/保本价快照 × quantity
  const costData = db.prepare(`
    SELECT
      COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as goods_cost,
      COALESCE(SUM(CASE WHEN oi.final_price < oi.break_even_price THEN (oi.break_even_price - oi.final_price) * oi.quantity ELSE 0 END), 0) as loss_amount
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.status != 'cancelled'
      AND o.created_at >= ? AND o.created_at < ? ${sc.clause}
  `).get(monthStart, nextMonth, ...sc.params);

  // 3. 其他成本：当月手动输入的成本
  const otherCostsData = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM other_costs oc
    WHERE year = ? AND month = ? ${scOc.clause}
  `).get(y, m, ...scOc.params);

  const otherCostsList = db.prepare(`
    SELECT * FROM other_costs oc WHERE year = ? AND month = ? ${scOc.clause} ORDER BY created_at DESC
  `).all(y, m, ...scOc.params);

  // 4. 采购进货发生额（按采购单创建月归属，账面口径）
  const purchaseData = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as purchase_expense
    FROM purchase_orders
    WHERE status != 'cancelled'
      AND created_at >= ? AND created_at < ? ${scPo.clause}
  `).get(monthStart, nextMonth, ...scPo.params);

  // 5. 月度销售目标（全店，含各导购目标汇总）
  const targetData = db.prepare(`
    SELECT COALESCE(SUM(target_amount), 0) as target_amount
    FROM monthly_targets
    WHERE year = ? AND month = ?
  `).get(y, m);

  // 6. 退/换与售后净影响（仅统计已完成退/换单，按退/换单创建月归属）
  const adj = financeAdjustment(db, monthStart, nextMonth, req);

  // 7. 利润计算（实收冲减退款；货物成本回冲退货商品成本；售后成本单列）
  const revenue = (salesData.revenue || 0) + adj.revenueAdj;
  const goodsCost = (costData.goods_cost || 0) + adj.goodsCostAdj;
  const otherCostsTotal = otherCostsData.total || 0;
  const aftersalesCost = adj.aftersalesCost;
  const totalCost = goodsCost + otherCostsTotal + aftersalesCost;
  const profit = revenue - totalCost;
  const profitMargin = revenue > 0 ? (profit / revenue * 100) : 0;
  const targetAmount = targetData.target_amount || 0;
  const targetAchievement = targetAmount > 0 ? (revenue / targetAmount * 100) : null;

  res.json({
    year: y,
    month: m,
    revenue: parseFloat(revenue.toFixed(2)),
    order_count: salesData.order_count || 0,
    goods_cost: parseFloat(goodsCost.toFixed(2)),
    loss_amount: parseFloat((costData.loss_amount || 0).toFixed(2)),
    other_costs_total: parseFloat(otherCostsTotal.toFixed(2)),
    aftersales_cost: parseFloat(aftersalesCost.toFixed(2)),
    return_exchange_revenue_impact: parseFloat(adj.revenueAdj.toFixed(2)),
    other_costs_count: otherCostsData.count || 0,
    total_cost: parseFloat(totalCost.toFixed(2)),
    profit: parseFloat(profit.toFixed(2)),
    profit_margin: parseFloat(profitMargin.toFixed(2)),
    purchase_expense: parseFloat((purchaseData.purchase_expense || 0).toFixed(2)),
    target_amount: parseFloat(targetAmount.toFixed(2)),
    target_achievement: targetAchievement === null ? null : parseFloat(targetAchievement.toFixed(2)),
    other_costs: otherCostsList,
  });
});

// 现金流看板（独立于利润表的收付实现制视角）
// 退换/售后对账明细（按月）：退货退款、换货差价、售后费用逐单列出，供财务对账
// 只读聚合现有 order_returns / order_aftersales 数据，不写 payments，不改既有口径
router.get('/aftersales-ledger', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: '请提供 year 和 month 参数' });
  const { monthStart, nextMonth } = monthBounds(year, month);
  const p = [monthStart, nextMonth];
  const sc = storeClauseAndParams(req, 'o');
  // 售后工单可能无 order_id（独立售后），保留未关联记录可见
  const asStoreCond = sc.params.length ? `(o.store_id IN (${sc.params.join(',')}) OR o.id IS NULL)` : `o.id IS NULL`;

  const returns = db.prepare(`
    SELECT r.id, r.order_id, r.type, r.reason, r.refund_amount, r.diff_amount,
           r.operator_name, r.created_at, r.completed_at, o.order_no, o.customer_name
    FROM order_returns r JOIN orders o ON o.id = r.order_id
    WHERE r.status='completed' AND r.created_at >= ? AND r.created_at < ? ${sc.clause}
    ORDER BY r.created_at DESC
  `).all(...p, ...sc.params);

  const returnItems = db.prepare(`
    SELECT ri.return_id, ri.action, ri.product_name, ri.spec, ri.quantity, ri.unit_price, ri.cost_price,
           ri.new_product_name, ri.new_spec
    FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id JOIN orders o ON o.id = r.order_id
    WHERE r.status='completed' AND r.created_at >= ? AND r.created_at < ? ${sc.clause}
  `).all(...p, ...sc.params);
  const itemsByReturn = {};
  for (const it of returnItems) (itemsByReturn[it.return_id] ||= []).push(it);

  const aftersales = db.prepare(`
    SELECT a.id, a.order_id, a.type, a.title, a.cost, a.cost_type,
           a.customer_name, a.created_by_name, a.created_at, a.closed_at, o.order_no
    FROM order_aftersales a LEFT JOIN orders o ON o.id = a.order_id
    WHERE a.status IN ('completed','closed') AND a.created_at >= ? AND a.created_at < ?
      AND ${asStoreCond}
    ORDER BY a.created_at DESC
  `).all(...p);

  res.json({
    period: { start: monthStart, end: nextMonth },
    returns: returns.map(r => ({ ...r, items: itemsByReturn[r.id] || [] })),
    aftersales,
  });
});

router.get('/cashflow', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: '请提供 year 和 month 参数' });
  }

  const { y, m, monthStart, nextMonth } = monthBounds(year, month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const sc = storeClauseAndParams(req, 'o');
  const scPo = storeClauseAndParams(req, 'purchase_orders');
  const scOc = storeClauseAndParams(req, 'oc');

  // 本期实收（按付款实际时间）
  const collected = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) as v FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? ${sc.clause}
  `).get(monthStart, nextMonth, ...sc.params).v || 0;

  // 本期进货发生额（按采购单创建时间）
  const purchaseExpense = db.prepare(`
    SELECT COALESCE(SUM(total_amount), 0) as v FROM purchase_orders
    WHERE status != 'cancelled' AND created_at >= ? AND created_at < ? ${scPo.clause}
  `).get(monthStart, nextMonth, ...scPo.params).v || 0;

  // 本期其他支出
  const otherExpense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as v FROM other_costs oc WHERE year = ? AND month = ? ${scOc.clause}
  `).get(y, m, ...scOc.params).v || 0;

  const netCashflow = collected - purchaseExpense - otherExpense;

  // 每日现金流趋势
  const dailyCollected = db.prepare(`
    SELECT CAST(strftime('%d', p.created_at) AS INTEGER) as day, COALESCE(SUM(p.amount),0) as v
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.created_at >= ? AND p.created_at < ? ${sc.clause} GROUP BY day
  `).all(monthStart, nextMonth, ...sc.params);
  const dailyPurchase = db.prepare(`
    SELECT CAST(strftime('%d', created_at) AS INTEGER) as day, COALESCE(SUM(total_amount),0) as v
    FROM purchase_orders WHERE status != 'cancelled' AND created_at >= ? AND created_at < ? ${scPo.clause} GROUP BY day
  `).all(monthStart, nextMonth, ...scPo.params);
  const dailyOther = db.prepare(`
    SELECT CAST(strftime('%d', created_at) AS INTEGER) as day, COALESCE(SUM(amount),0) as v
    FROM other_costs oc WHERE year = ? AND month = ? ${scOc.clause} GROUP BY day
  `).all(y, m, ...scOc.params);

  const dayMap = {};
  for (let d = 1; d <= daysInMonth; d++) {
    dayMap[d] = { day: d, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, collected: 0, purchase_expense: 0, other_cost: 0, net: 0 };
  }
  for (const r of dailyCollected) if (dayMap[r.day]) dayMap[r.day].collected = parseFloat(r.v.toFixed(2));
  for (const r of dailyPurchase) if (dayMap[r.day]) dayMap[r.day].purchase_expense = parseFloat(r.v.toFixed(2));
  for (const r of dailyOther) if (dayMap[r.day]) dayMap[r.day].other_cost = parseFloat(r.v.toFixed(2));
  const daily = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const it = dayMap[d];
    it.net = parseFloat((it.collected - it.purchase_expense - it.other_cost).toFixed(2));
    daily.push(it);
  }

  res.json({
    year: y,
    month: m,
    collected: parseFloat(collected.toFixed(2)),
    purchase_expense: parseFloat(purchaseExpense.toFixed(2)),
    other_cost: parseFloat(otherExpense.toFixed(2)),
    net_cashflow: parseFloat(netCashflow.toFixed(2)),
    daily,
  });
});

// 其他成本按类别结构（饼图）
router.get('/cost-breakdown', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  if (!year || !month) {
    return res.status(400).json({ error: '请提供 year 和 month 参数' });
  }
  const y = parseInt(year);
  const m = parseInt(month);
  const scOc = storeClauseAndParams(req, 'oc');
  const rows = db.prepare(`
    SELECT category, COALESCE(SUM(amount),0) as total, COUNT(*) as count
    FROM other_costs oc WHERE year = ? AND month = ? ${scOc.clause} GROUP BY category
  `).all(y, m, ...scOc.params);
  const total = rows.reduce((s, r) => s + r.total, 0);
  res.json({
    year: y, month: m,
    total: parseFloat(total.toFixed(2)),
    items: rows.map(r => ({
      category: r.category,
      total: parseFloat(r.total.toFixed(2)),
      count: r.count,
      ratio: total > 0 ? parseFloat((r.total / total * 100).toFixed(2)) : 0,
    })),
  });
});

// 年度财务汇总（按月趋势）
router.get('/yearly-summary', (req, res) => {
  const db = getDb();
  const { year } = req.query;
  if (!year) {
    return res.status(400).json({ error: '请提供 year 参数' });
  }
  const y = parseInt(year);
  const yearStart = `${y}-01-01`;
  const yearEnd = `${y + 1}-01-01`;

  const sc = storeClauseAndParams(req, 'o');
  const scPo = storeClauseAndParams(req, 'purchase_orders');
  const scOc = storeClauseAndParams(req, 'oc');
  const ocCond = scOc.params.length ? ` AND oc.store_id IN (${scOc.params.join(',')})` : '';
  const months = db.prepare(`
    WITH m AS (
      SELECT 1 as mn UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6
      UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10 UNION SELECT 11 UNION SELECT 12
    )
    SELECT
      m.mn as month,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id=p.order_id
                WHERE o.status!='cancelled' ${sc.clause}
                  AND CAST(strftime('%Y',o.created_at) AS INTEGER)=?
                  AND CAST(strftime('%m',o.created_at) AS INTEGER)=m.mn),0) as revenue,
      COALESCE((SELECT SUM(oi.quantity*COALESCE(oi.cost_price,0))
                FROM order_items oi JOIN orders o ON oi.order_id=o.id
                WHERE o.status!='cancelled' ${sc.clause}
                  AND CAST(strftime('%Y',o.created_at) AS INTEGER)=?
                  AND CAST(strftime('%m',o.created_at) AS INTEGER)=m.mn),0) as goods_cost,
      COALESCE((SELECT SUM(amount) FROM other_costs oc WHERE year=? AND month=m.mn${ocCond}),0) as other_cost,
      COALESCE((SELECT SUM(total_amount) FROM purchase_orders
                WHERE status!='cancelled' ${scPo.clause}
                  AND CAST(strftime('%Y',created_at) AS INTEGER)=?
                  AND CAST(strftime('%m',created_at) AS INTEGER)=m.mn),0) as purchase_expense
    FROM m
    ORDER BY m.mn
  `).all(...sc.params, y, ...sc.params, y, y, ...scOc.params, ...scPo.params, y);

  const result = months.map(r => {
    const mm = r.month;
    const ms = `${y}-${String(mm).padStart(2, '0')}-01`;
    const nm = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`;
    const adj = financeAdjustment(db, ms, nm, req);
    const revenue = parseFloat(r.revenue || 0) + adj.revenueAdj;
    const goodsCost = parseFloat(r.goods_cost || 0) + adj.goodsCostAdj;
    const otherCost = parseFloat(r.other_cost || 0) + adj.aftersalesCost;
    const purchaseExpense = parseFloat(r.purchase_expense || 0);
    const totalCost = goodsCost + otherCost;
    const profit = revenue - totalCost;
    return {
      month: mm,
      label: `${mm}月`,
      revenue: parseFloat(revenue.toFixed(2)),
      goods_cost: parseFloat(goodsCost.toFixed(2)),
      other_cost: parseFloat(otherCost.toFixed(2)),
      aftersales_cost: parseFloat(adj.aftersalesCost.toFixed(2)),
      purchase_expense: parseFloat(purchaseExpense.toFixed(2)),
      profit: parseFloat(profit.toFixed(2)),
      profit_margin: revenue > 0 ? parseFloat((profit / revenue * 100).toFixed(2)) : 0,
    };
  });

  const totals = result.reduce((acc, r) => {
    acc.revenue += r.revenue; acc.goods_cost += r.goods_cost;
    acc.other_cost += r.other_cost; acc.purchase_expense += r.purchase_expense;
    acc.profit += r.profit; acc.aftersales_cost += (r.aftersales_cost || 0); return acc;
  }, { revenue: 0, goods_cost: 0, other_cost: 0, purchase_expense: 0, profit: 0, aftersales_cost: 0 });

  res.json({ year: y, months: result, totals: {
    revenue: parseFloat(totals.revenue.toFixed(2)),
    goods_cost: parseFloat(totals.goods_cost.toFixed(2)),
    other_cost: parseFloat(totals.other_cost.toFixed(2)),
    aftersales_cost: parseFloat(totals.aftersales_cost.toFixed(2)),
    purchase_expense: parseFloat(totals.purchase_expense.toFixed(2)),
    profit: parseFloat(totals.profit.toFixed(2)),
    profit_margin: totals.revenue > 0 ? parseFloat((totals.profit / totals.revenue * 100).toFixed(2)) : 0,
  }});
});

// 应收账款 / 欠款管理
router.get('/receivables', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  const sc = storeClauseAndParams(req, 'o');

  let where = "WHERE o.status != 'cancelled'";
  const params = [];
  if (year && month) {
    const { monthStart, nextMonth } = monthBounds(year, month);
    where += ' AND o.created_at >= ? AND o.created_at < ?';
    params.push(monthStart, nextMonth);
  }

  where += sc.clause;
  const orders = db.prepare(`
    SELECT
      o.id, o.order_no, o.customer_name, o.status, o.total_amount, o.created_at,
      COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id = o.id), 0) as paid
    FROM orders o
    ${where}
  `).all(...params, ...sc.params);

  const OVERDUE_DAYS = 30;
  const list = [];
  let totalReceivable = 0;
  let overdueAmount = 0;
  let overdueCount = 0;

  for (const o of orders) {
    const total = parseFloat(o.total_amount) || 0;
    const paid = parseFloat(o.paid) || 0;
    const receivable = parseFloat((total - paid).toFixed(2));
    if (receivable <= 0.01) continue;
    const created = new Date(o.created_at.replace(' ', 'T'));
    const days = Math.floor((Date.now() - created.getTime()) / 86400000);
    const overdue = days > OVERDUE_DAYS;
    if (overdue) { overdueAmount += receivable; overdueCount += 1; }
    totalReceivable += receivable;
    list.push({
      id: o.id,
      order_no: o.order_no,
      customer_name: o.customer_name,
      status: o.status,
      total_amount: parseFloat(total.toFixed(2)),
      paid: parseFloat(paid.toFixed(2)),
      receivable: parseFloat(receivable.toFixed(2)),
      created_at: o.created_at,
      days_since: days,
      overdue,
    });
  }

  list.sort((a, b) => b.receivable - a.receivable);

  res.json({
    summary: {
      total_receivable: parseFloat(totalReceivable.toFixed(2)),
      overdue_amount: parseFloat(overdueAmount.toFixed(2)),
      overdue_count: overdueCount,
      count: list.length,
    },
    list,
  });
});

// 每日利润趋势（实时图表用）
router.get('/daily-trend', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: '请提供 year 和 month 参数' });
  }

  const { y, m, monthStart, nextMonth } = monthBounds(year, month);
  const daysInMonth = new Date(y, m, 0).getDate();
  const sc = storeClauseAndParams(req, 'o');
  const scOc = storeClauseAndParams(req, 'oc');

  // 每日销售和成本（实收金额：按付款流水聚合，避免与 order_items 联表导致的重复计算）
  const dailyData = db.prepare(`
    WITH order_rev AS (
      SELECT o.id, o.created_at,
        COALESCE((SELECT SUM(amount) FROM payments p WHERE p.order_id = o.id), 0) as rev
      FROM orders o
      WHERE o.status != 'cancelled' AND o.created_at >= ? AND o.created_at < ? ${sc.clause}
    ),
    order_cost AS (
      SELECT oi.order_id,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as cost
      FROM order_items oi
      GROUP BY oi.order_id
    )
    SELECT
      CAST(strftime('%d', orv.created_at) AS INTEGER) as day,
      COALESCE(SUM(orv.rev), 0) as revenue,
      COALESCE(SUM(oc.cost), 0) as goods_cost,
      COUNT(DISTINCT orv.id) as order_count
    FROM order_rev orv
    LEFT JOIN order_cost oc ON oc.order_id = orv.id
    GROUP BY CAST(strftime('%d', orv.created_at) AS INTEGER)
    ORDER BY day
  `).all(monthStart, nextMonth, ...sc.params);

  // 每日其他成本（按日分摊显示为录入日）
  const dailyOtherCosts = db.prepare(`
    SELECT
      CAST(strftime('%d', created_at) AS INTEGER) as day,
      COALESCE(SUM(amount), 0) as amount
    FROM other_costs oc
    WHERE year = ? AND month = ? ${scOc.clause}
    GROUP BY CAST(strftime('%d', created_at) AS INTEGER)
  `).all(y, m, ...scOc.params);

  // 合并数据
  const dayMap = {};
  for (let d = 1; d <= daysInMonth; d++) {
    dayMap[d] = { day: d, date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, revenue: 0, goods_cost: 0, other_cost: 0, profit: 0, order_count: 0 };
  }
  for (const row of dailyData) {
    if (dayMap[row.day]) {
      dayMap[row.day].revenue = parseFloat(row.revenue.toFixed(2));
      dayMap[row.day].goods_cost = parseFloat(row.goods_cost.toFixed(2));
      dayMap[row.day].order_count = row.order_count;
    }
  }
  for (const row of dailyOtherCosts) {
    if (dayMap[row.day]) {
      dayMap[row.day].other_cost = parseFloat(row.amount.toFixed(2));
    }
  }

  // 计算每日利润和累计利润
  let cumulativeRevenue = 0;
  let cumulativeCost = 0;
  const result = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const item = dayMap[d];
    const dd = String(d).padStart(2, '0');
    const dayStart = `${y}-${String(m).padStart(2, '0')}-${dd}`;
    const dayEnd = d === daysInMonth ? nextMonth.slice(0, 10) : `${y}-${String(m).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`;
    const adj = financeAdjustment(db, dayStart, dayEnd, req);
    item.revenue = parseFloat((item.revenue + adj.revenueAdj).toFixed(2));
    item.goods_cost = parseFloat((item.goods_cost + adj.goodsCostAdj).toFixed(2));
    item.other_cost = parseFloat((item.other_cost + adj.aftersalesCost).toFixed(2));
    item.aftersales_cost = parseFloat(adj.aftersalesCost.toFixed(2));
    const dayProfit = item.revenue - item.goods_cost - item.other_cost;
    cumulativeRevenue += item.revenue;
    cumulativeCost += item.goods_cost + item.other_cost;
    result.push({
      ...item,
      profit: parseFloat(dayProfit.toFixed(2)),
      cumulative_revenue: parseFloat(cumulativeRevenue.toFixed(2)),
      cumulative_cost: parseFloat(cumulativeCost.toFixed(2)),
      cumulative_profit: parseFloat((cumulativeRevenue - cumulativeCost).toFixed(2)),
      profit_margin: item.revenue > 0 ? parseFloat((dayProfit / item.revenue * 100).toFixed(2)) : 0,
    });
  }

  res.json(result);
});

// 其他成本 CRUD
router.get('/other-costs', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  const scOc = storeClauseAndParams(req, 'oc');
  let sql = 'SELECT * FROM other_costs oc WHERE 1=1';
  const params = [];
  if (year && month) {
    sql += ' AND year = ? AND month = ?';
    params.push(parseInt(year), parseInt(month));
  }
  sql += scOc.clause;
  sql += ' ORDER BY created_at DESC';
  res.json(db.prepare(sql).all(...params, ...scOc.params));
});

router.post('/other-costs', (req, res) => {
  const db = getDb();
  const { year, month, name, amount, category, note } = req.body;

  if (!year || !month || !name || amount === undefined) {
    return res.status(400).json({ error: '请提供 year, month, name, amount' });
  }

  const result = db.prepare(`
    INSERT INTO other_costs (year, month, name, amount, category, note, store_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    parseInt(year), parseInt(month), name, parseFloat(amount),
    category || 'other', note || '', resolveWriteStoreId(req)
  );

  res.json({ id: result.lastInsertRowid, message: '创建成功' });
});

router.put('/other-costs/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { name, amount, category, note } = req.body;

  const existing = db.prepare('SELECT * FROM other_costs WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '记录不存在' });

  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (amount !== undefined) { fields.push('amount = ?'); values.push(parseFloat(amount)); }
  if (category !== undefined) { fields.push('category = ?'); values.push(category); }
  if (note !== undefined) { fields.push('note = ?'); values.push(note); }
  fields.push("updated_at = datetime('now','localtime')");

  if (fields.length > 1) {
    db.prepare(`UPDATE other_costs SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }

  res.json({ message: '更新成功' });
});

router.delete('/other-costs/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const row = db.prepare('SELECT * FROM other_costs WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM other_costs WHERE id = ?').run(id);
  auditDelete(req, TARGET_TYPES.FINANCE, id, row);
  res.json({ message: '删除成功' });
});

// 订单利润明细（当月每个订单的利润）
router.get('/order-profits', (req, res) => {
  const db = getDb();
  const { year, month } = req.query;

  if (!year || !month) {
    return res.status(400).json({ error: '请提供 year 和 month 参数' });
  }

  const { y, m, monthStart, nextMonth } = monthBounds(year, month);
  const sc = storeClauseAndParams(req, 'o');

  const orders = db.prepare(`
    SELECT
      o.id, o.order_no, o.customer_name, o.status,
      (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.order_id = o.id) as revenue,
      o.created_at,
      (SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0)
       FROM order_items oi
       WHERE oi.order_id = o.id) as goods_cost
    FROM orders o
    WHERE o.status != 'cancelled'
      AND o.created_at >= ? AND o.created_at < ? ${sc.clause}
    ORDER BY o.created_at DESC
  `).all(monthStart, nextMonth, ...sc.params);

  const result = orders.map(o => {
    const revenue = parseFloat(o.revenue) || 0;
    const goodsCost = parseFloat(o.goods_cost) || 0;
    const profit = revenue - goodsCost;
    return {
      ...o,
      revenue: parseFloat(revenue.toFixed(2)),
      goods_cost: parseFloat(goodsCost.toFixed(2)),
      profit: parseFloat(profit.toFixed(2)),
      profit_margin: revenue > 0 ? parseFloat((profit / revenue * 100).toFixed(2)) : 0,
    };
  });

  res.json(result);
});

export default router;
