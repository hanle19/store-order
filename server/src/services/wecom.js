// server/src/services/wecom.js
// 企业微信（WeCom）群机器人 Webhook 推送服务：用 Node22 自带 fetch 调企业微信接口（零新依赖）。
//
// 采用「群机器人」方式推送：
//   - 无需 corpid / secret / agentid，无需可信IP、无需可信域名、无需公网
//   - 服务器纯出站 POST 一个 webhook 地址即可，最适合局域网部署
//   - 消息发到指定群（群成员可见），闭店日报推到“晚安家居日报”群即可
//
// 设计原则：推送失败只记录日志、绝不抛异常阻断主业务流程（闭店提交 / 长图生成）。

import { getDb } from '../db.js';

// 读取企业微信配置（存于 system_config 表）：仅 webhook 地址
function getWecomConfig(db) {
  const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('wecom_webhook_url');
  return { wecom_webhook_url: row ? (row.value || '') : '' };
}

// 本地日期 YYYY-MM-DD（与 daily / customers 模块保持一致）
function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 给定日期，返回当天起始 与 次日起始（用于 >= dayStart AND < nextDay 查询，避免漏掉尾秒）
function dayRange(dateStr) {
  const day = dateStr || localDate();
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  const nextDay = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { dayStart: `${day} 00:00:00`, nextDay: `${nextDay} 00:00:00` };
}

const fmtMoney = (n) => '¥ ' + (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
const fmtNum = (n) => (Number(n) || 0).toLocaleString('zh-CN');
const pct = (cur, total) => (total > 0 ? Math.round((cur / total) * 100) : 0);

// 群机器人常见 errcode → 中文友好提示
function friendlyErr(errcode, errmsg = '') {
  const map = {
    93000: '｜原因：Webhook 地址无效或 key 错误。请检查企业微信「群机器人」复制的地址是否完整（必须含 ?key= 这一段）。',
    45009: '｜接口调用频率超限（群机器人每日限额），请稍后再试。',
  };
  if (map[errcode]) return map[errcode];
  return errmsg ? `｜${errmsg}` : '';
}

const getStoreName = (db) => {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'store_name'").get();
  return row ? row.value : '我的门店';
};
const getWEEK = (dateStr) => {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const [y, m, d] = dateStr.split('-').map(Number);
  return names[new Date(y, m - 1, d).getDay()];
};

/* ============ 发送 markdown 消息（群机器人 Webhook） ============ */
async function sendMarkdown(db, content) {
  const cfg = getWecomConfig(db);
  const url = (cfg.wecom_webhook_url || '').trim();
  if (!url) {
    const e = new Error('企业微信未配置（缺少 webhook 地址）');
    e.code = 'NO_CONFIG';
    throw e;
  }
  const body = {
    msgtype: 'markdown',
    markdown: { content },
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  data.hint = friendlyErr(data.errcode, data.errmsg);
  return data;
}

/* ============ 汇总全店当日闭店经营数据 ============ */
function buildClosingReportData(db, reportDate) {
  const day = reportDate || localDate();
  const { dayStart, nextDay } = dayRange(day);
  const today = localDate();

  // 1) 当日订单与成交
  const orderStats = db.prepare(`
    SELECT
      COUNT(*) AS order_count,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0) AS order_amount
    FROM orders
    WHERE created_at >= ? AND created_at < ?
  `).get(dayStart, nextDay);
  const followUp = db.prepare(`
    SELECT COUNT(*) AS c FROM orders
    WHERE status IN ('pending','deposited','purchasing','ordered','arrived','ready')
      AND status != 'cancelled'
  `).get().c;

  // 2) 客户跟进待办（今日 + 逾期）
  const reminders = db.prepare(`
    SELECT c.id, c.name, c.phone, c.intention_product, c.next_followup_date, c.status,
           u.display_name AS owner_name
    FROM customers c
    LEFT JOIN users u ON c.owner_id = u.id
    WHERE c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost')
    ORDER BY c.next_followup_date ASC
  `).all(day);
  const overdue = reminders.filter(r => r.next_followup_date < day);
  const dueToday = reminders.filter(r => r.next_followup_date === day);

  // 3) 销售日报汇总（按 report_date 聚合全店）
  const dailySum = db.prepare(`
    SELECT COALESCE(SUM(reception_count),0) AS rec,
           COALESCE(SUM(deal_count),0) AS deals,
           COALESCE(SUM(deal_amount),0) AS amt,
           COALESCE(SUM(wechat_count),0) AS wx
    FROM daily_reports WHERE report_date = ?
  `).get(day);
  const dailyPer = db.prepare(`
    SELECT u.display_name, dr.reception_count, dr.deal_count, dr.deal_amount, dr.wechat_count
    FROM daily_reports dr
    JOIN users u ON dr.salesperson_id = u.id
    WHERE dr.report_date = ?
    ORDER BY dr.deal_amount DESC
  `).all(day);

  // 4) 异常提醒 + 月度目标进度
  const monthStart = `${day.slice(0, 7)}-01`;
  const [yy, mm] = day.slice(0, 7).split('-').map(Number);
  const nx = mm === 12 ? `${yy + 1}-01-01` : `${day.slice(0, 5)}${String(mm + 1).padStart(2, '0')}-01`;
  const overdueDelivery = db.prepare(`
    SELECT COUNT(*) AS c FROM orders
    WHERE delivery_date IS NOT NULL AND delivery_date < ?
      AND status NOT IN ('signed','completed','cancelled')
  `).get(today).c;
  const lowStockThresholdRow = db.prepare("SELECT value FROM system_config WHERE key = 'low_stock_threshold'").get();
  const lowStockThreshold = lowStockThresholdRow ? (Number(lowStockThresholdRow.value) || 5) : 5;
  const lowStock = db.prepare(`
    SELECT COUNT(*) AS c FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.active = 1 AND COALESCE(i.quantity, p.stock) <= ?
  `).get(lowStockThreshold).c;
  const storeTarget = db.prepare(
    'SELECT target_amount FROM monthly_targets WHERE year = ? AND month = ? AND user_id IS NULL'
  ).get(yy, mm);
  const storeRevenue = db.prepare(`
    SELECT COALESCE(SUM(p.amount), 0) AS v
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled'
  `).get(monthStart, nx).v;
  const storeTargetAmount = storeTarget?.target_amount || 0;

  // 导购月度进度
  const salesTargets = db.prepare(`
    SELECT u.id, u.display_name, COALESCE(t.target_amount,0) AS target_amount
    FROM users u
    LEFT JOIN monthly_targets t ON t.user_id = u.id AND t.year = ? AND t.month = ?
    WHERE u.role = 'sales' AND u.active = 1
    ORDER BY u.display_name
  `).all(yy, mm);
  const salesActuals = db.prepare(`
    SELECT o.salesperson_id, COALESCE(SUM(o.total_amount),0) AS completed_amount
    FROM orders o
    WHERE o.created_at >= ? AND o.created_at < ? AND o.status != 'cancelled' AND o.salesperson_id IS NOT NULL
    GROUP BY o.salesperson_id
  `).all(monthStart, nx);
  const actualMap = {};
  salesActuals.forEach(a => { actualMap[a.salesperson_id] = a.completed_amount; });
  const salesProgress = salesTargets.map(s => ({
    name: s.display_name,
    target: s.target_amount,
    completed: actualMap[s.id] || 0,
    ratio: pct(actualMap[s.id] || 0, s.target_amount),
  })).sort((a, b) => b.ratio - a.ratio);
  const lagging = salesProgress.filter(s => s.target > 0 && s.ratio < 50).length;
  const top = salesProgress[0];

  return {
    reportDate: day,
    storeName: getStoreName(db),
    week: getWEEK(day),
    orders: {
      count: orderStats.order_count,
      amount: orderStats.order_amount,
      followUp,
    },
    customers: {
      today: dueToday.length,
      overdue: overdue.length,
      list: [...overdue, ...dueToday].slice(0, 8),
    },
    daily: {
      reception: dailySum.rec,
      deals: dailySum.deals,
      amount: dailySum.amt,
      wechat: dailySum.wx,
      per: dailyPer,
    },
    alerts: {
      overdueDelivery,
      lowStock,
      storeTargetAmount,
      storeRevenue,
      storeRatio: pct(storeRevenue, storeTargetAmount),
      lagging,
      top: top ? top.name : '-',
    },
  };
}

/* ============ 发送图片消息（群机器人 Webhook image 类型） ============ */
// base64：不含 data: 前缀的纯 base64 字符串
async function sendImage(db, base64) {
  const cfg = getWecomConfig(db);
  const url = (cfg.wecom_webhook_url || '').trim();
  if (!url) {
    const e = new Error('企业微信未配置（缺少 webhook 地址）');
    e.code = 'NO_CONFIG';
    throw e;
  }
  // 计算 md5（群机器人 image 类型必填）
  const crypto = await import('crypto');
  const buf = Buffer.from(base64, 'base64');
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  const body = { msgtype: 'image', image: { base64, md5 } };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  data.hint = friendlyErr(data.errcode, data.errmsg);
  return data;
}

/* ============ 生成 markdown 推送内容 ============ */
function buildClosingReportMarkdown(data) {
  const lines = [];
  lines.push(`# 🌙 ${data.storeName} · 闭店日报`);
  lines.push(`> <font color="comment">${data.reportDate} ${data.week}</font>`);
  lines.push('');

  // 一、订单与成交
  lines.push(`## 一、今日订单与成交`);
  lines.push(`- 新增订单：**${fmtNum(data.orders.count)} 单**`);
  lines.push(`- 订单成交额：**${fmtMoney(data.orders.amount)}**`);
  lines.push(`- 待跟进订单（待收款/待配送）：**${fmtNum(data.orders.followUp)} 单**`);
  lines.push('');

  // 二、客户跟进待办
  lines.push(`## 二、客户跟进待办`);
  lines.push(`- 今日待跟进：**${fmtNum(data.customers.today)}** ｜ 逾期：**${fmtNum(data.customers.overdue)}**`);
  if (data.customers.list.length) {
    data.customers.list.forEach(c => {
      const tag = c.next_followup_date < data.reportDate ? '逾期' : '今日';
      const phone = (c.phone || '').slice(0, 11);
      const intent = c.intention_product || '—';
      const owner = c.owner_name ? `（${c.owner_name}）` : '';
      lines.push(`> ${tag} ${c.name || '—'}${owner} ${phone} ${intent} 下次 ${c.next_followup_date}`);
    });
  } else {
    lines.push(`> 暂无需跟进客户`);
  }
  lines.push('');

  // 三、销售日报汇总
  lines.push(`## 三、销售日报汇总`);
  lines.push(`- 总接待：**${fmtNum(data.daily.reception)} 组** ｜ 成交：**${fmtNum(data.daily.deals)} 单** ｜ 成交金额：**${fmtMoney(data.daily.amount)}** ｜ 加微信：**${fmtNum(data.daily.wechat)}**`);
  if (data.daily.per.length) {
    data.daily.per.forEach(s => {
      lines.push(`> ${s.display_name}：接待${fmtNum(s.reception_count)}/成交${fmtNum(s.deal_count)}/${fmtMoney(s.deal_amount)}`);
    });
  }
  lines.push('');

  // 四、异常提醒 & 月度目标
  lines.push(`## 四、异常提醒 & 月度目标`);
  lines.push(`- 逾期未送货：**${fmtNum(data.alerts.overdueDelivery)} 单** ｜ 低库存：**${fmtNum(data.alerts.lowStock)} 款**`);
  if (data.alerts.storeTargetAmount > 0) {
    lines.push(`- 门店月度目标：**${fmtMoney(data.alerts.storeRevenue)} / ${fmtMoney(data.alerts.storeTargetAmount)}（${data.alerts.storeRatio}%）**`);
  } else {
    lines.push(`- 门店月度目标：未设置（本月营收 ${fmtMoney(data.alerts.storeRevenue)}）`);
  }
  if (data.alerts.top !== '-') {
    lines.push(`> 业绩第一：${data.alerts.top} ｜ 滞后导购：${fmtNum(data.alerts.lagging)} 人`);
  }
  lines.push('');
  lines.push(`> 📌 本日报由门店系统于闭店提交时自动推送`);

  return lines.join('\n');
}

/* ============ 对外：生成并推送闭店日报 ============ */
// pushClosingReport(db, { reportDate, submitterName, force })
//  - 默认按天去重（同一天已推送则跳过，不重复打扰管理员）
//  - force=true 时强制重推（管理员手动“重推今日”）
// 返回 { pushed, skipped, reason, response }
async function pushClosingReport(db, { reportDate, submitterName, force = false } = {}) {
  const day = reportDate || localDate();
  // 去重：记录最后推送日期
  if (!force) {
    const row = db.prepare("SELECT value FROM system_config WHERE key = 'wecom_last_closing_push'").get();
    if (row && row.value === day) {
      return { pushed: false, skipped: true, reason: '今日已推送，按天去重', response: null };
    }
  }
  const data = buildClosingReportData(db, day);
  const content = buildClosingReportMarkdown(data);
  const resp = await sendMarkdown(db, content);
  if (resp && resp.errcode === 0) {
    db.prepare(`INSERT INTO system_config (key, value, updated_at) VALUES ('wecom_last_closing_push', ?, datetime('now','localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(day);
    return { pushed: true, skipped: false, reason: null, response: resp };
  }
  return { pushed: false, skipped: false, reason: `推送返回错误: ${resp?.errcode} ${resp?.errmsg}`, response: resp };
}

export default {
  getWecomConfig,
  sendMarkdown,
  sendImage,
  buildClosingReportData,
  buildClosingReportMarkdown,
  pushClosingReport,
};
