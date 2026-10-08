import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { resolveWriteStoreId } from '../utils/storeScope.js';
import wecomService from '../services/wecom.js';
import { auditDelete, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

/* ============ 工具函数 ============ */

function resolveSalespersonId(req, requested) {
  if (req.user.role === 'sales') return req.user.id;
  return requested ? parseInt(requested) : req.user.id;
}

function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const num = (v, d = 0) => {
  const n = Number(v);
  return (isNaN(n) || n < 0) ? d : n;
};

const str = (v) => (v || '').toString().trim();

function getStoreName(db) {
  const row = db.prepare("SELECT value FROM system_config WHERE key = 'store_name'").get();
  return row ? row.value : '我的门店';
}

function getMonthlyTarget(db, userId, year, month) {
  const row = db.prepare(
    'SELECT target_amount FROM monthly_targets WHERE year = ? AND month = ? AND user_id = ?'
  ).get(year, month, userId);
  return row ? (row.target_amount || 0) : 0;
}

// 只统计 submitted 状态的日报累计
function monthRange(ym) {
  const [yy, mm] = ym.split('-').map(Number);
  const start = `${yy}-${String(mm).padStart(2, '0')}-01`;
  const end = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
  return [start, end];
}

function getMonthAccumulated(db, userId, ym) {
  const [monthStart, nextMonth] = monthRange(ym);
  const row = db.prepare(`
    SELECT COALESCE(SUM(deal_amount), 0) AS s, COALESCE(SUM(deal_count), 0) AS c
    FROM daily_reports
    WHERE salesperson_id = ? AND status = 'submitted' AND report_date >= ? AND report_date < ?
  `).get(userId, monthStart, nextMonth);
  return { amount: row ? row.s : 0, count: row ? row.c : 0 };
}

function getSalesName(db, userId) {
  const row = db.prepare('SELECT display_name FROM users WHERE id = ?').get(userId);
  return row ? row.display_name : '未知';
}

// 从客资表聚合计算当日汇总指标（用于闭店提交时写入 reports）
function aggregateFromCustomers(db, spId, date) {
  const all = db.prepare(
    'SELECT * FROM daily_customers WHERE salesperson_id = ? AND report_date = ?'
  ).all(spId, date);
  const total = all.length;
  const deals = all.filter(c => c.is_deal === 1);
  return {
    reception_count: total,
    deal_count: deals.length,
    deal_amount: deals.reduce((s, c) => s + (c.deal_amount || 0), 0),
    phone_count: all.filter(c => c.phone && c.phone.trim()).length,
    wechat_count: all.filter(c => c.is_wechat === 1).length,
  };
}

/* ============ 日报主表（今日工作 + 汇总） ============ */

router.get('/report', (req, res) => {
  try {
    const db = getDb();
    const spId = resolveSalespersonId(req, req.query.salesperson_id);
    const date = req.query.report_date || todayStr();
    const report = db.prepare(
      'SELECT * FROM daily_reports WHERE salesperson_id = ? AND report_date = ?'
    ).get(spId, date) || null;
    const customers = db.prepare(
      'SELECT * FROM daily_customers WHERE salesperson_id = ? AND report_date = ? ORDER BY id ASC'
    ).all(spId, date);
    const fieldConfig = db.prepare(
      'SELECT * FROM daily_field_config WHERE is_enabled = 1 ORDER BY sort_order'
    ).all();
    res.json({
      success: true,
      report,
      customers,
      field_config: fieldConfig,
      report_date: date,
      salesperson_id: spId,
      salesperson_name: getSalesName(db, spId),
      store_name: getStoreName(db),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/report', (req, res) => {
  try {
    const db = getDb();
    const spId = resolveSalespersonId(req, req.body.salesperson_id);
    const date = req.body.report_date || todayStr();
    // 检查是否已提交锁定
    const existing = db.prepare(
      'SELECT id, status FROM daily_reports WHERE salesperson_id = ? AND report_date = ?'
    ).get(spId, date);
    if (existing && existing.status === 'submitted') {
      return res.status(400).json({ error: '当日日报已闭店提交，不可再修改。如需调整请联系店长。' });
    }

    // 今日工作字段
    const post_moments = num(req.body.post_moments);
    const post_douyin = num(req.body.post_douyin);
    const live_stream = num(req.body.live_stream);
    const follow_up = num(req.body.follow_up);
    const work_issue = str(req.body.work_issue);
    const tomorrow_plan = str(req.body.tomorrow_plan);

    db.prepare(`
      INSERT INTO daily_reports
        (salesperson_id, report_date, status,
         post_moments, post_douyin, live_stream, follow_up,
         work_issue, tomorrow_plan, store_id,
         updated_at)
      VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
      ON CONFLICT(salesperson_id, report_date) DO UPDATE SET
        post_moments = excluded.post_moments,
        post_douyin = excluded.post_douyin,
        live_stream = excluded.live_stream,
        follow_up = excluded.follow_up,
        work_issue = excluded.work_issue,
        tomorrow_plan = excluded.tomorrow_plan,
        store_id = excluded.store_id,
        updated_at = datetime('now','localtime')
    `).run(spId, date, post_moments, post_douyin, live_stream, follow_up, work_issue, tomorrow_plan, resolveWriteStoreId(req));

    const report = db.prepare(
      'SELECT * FROM daily_reports WHERE salesperson_id = ? AND report_date = ?'
    ).get(spId, date);
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 闭店提交：自动从客资聚合写入汇总字段，然后 draft → submitted
router.post('/report/:id/submit', async (req, res) => {
  try {
    const db = getDb();
    const reportId = parseInt(req.params.id);
    const report = db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(reportId);
    if (!report) return res.status(404).json({ error: '日报不存在' });

    if (req.user.role === 'sales' && report.salesperson_id !== req.user.id) {
      return res.status(403).json({ error: '无权提交他人日报' });
    }
    if (report.status === 'submitted') {
      return res.json({ success: true, already: true, report });
    }

    // 从客资聚合计算汇总指标
    const agg = aggregateFromCustomers(db, report.salesperson_id, report.report_date);

    db.prepare(`
      UPDATE daily_reports SET
        status = 'submitted',
        reception_count = ?,
        deal_count = ?,
        deal_amount = ?,
        phone_count = ?,
        wechat_count = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(agg.reception_count, agg.deal_count, agg.deal_amount, agg.phone_count, agg.wechat_count, reportId);

    const updated = db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(reportId);

    // 闭店推送：仅管理员/店长（非导购）提交时，自动把全店当日经营日报推送到企业微信
    let wecom = { pushed: false, skipped: false };
    if (req.user.role !== 'sales') {
      try {
        const result = await wecomService.pushClosingReport(db, {
          reportDate: report.report_date,
          submitterName: req.user.display_name || req.user.username,
        });
        wecom = { pushed: !!result.pushed, skipped: !!result.skipped };
      } catch (we) {
        // 推送失败绝不阻断闭店流程，仅记录日志
        console.error('[wecom] 闭店推送失败（不影响闭店提交）:', we.message);
      }
    }

    res.json({ success: true, report: updated, wecom });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 退回重填：仅管理员/店长可将已提交日报改回 draft（解锁编辑）
router.post('/report/:id/unsubmit', (req, res) => {
  try {
    if (req.user.role === 'sales') {
      return res.status(403).json({ error: '仅管理员/店长可退回日报' });
    }
    const db = getDb();
    const reportId = parseInt(req.params.id);
    const report = db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(reportId);
    if (!report) return res.status(404).json({ error: '日报不存在' });
    if (report.status !== 'submitted') {
      return res.status(400).json({ error: '该日报未提交，无需退回' });
    }
    db.prepare(`
      UPDATE daily_reports SET
        status = 'draft',
        reception_count = 0, deal_count = 0, deal_amount = 0, phone_count = 0, wechat_count = 0,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(reportId);
    const updated = db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(reportId);
    res.json({ success: true, report: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/customers', (req, res) => {
  try {
    const db = getDb();
    const clauses = [];
    const params = [];
    // 销售强制只看自己；管理员/店长：选了具体导购才过滤，选“全部”(空)则看所有人
    if (req.user.role === 'sales') {
      clauses.push('salesperson_id = ?');
      params.push(req.user.id);
    } else if (req.query.salesperson_id && String(req.query.salesperson_id).trim()) {
      clauses.push('salesperson_id = ?');
      params.push(parseInt(req.query.salesperson_id));
    }
    // 日期：不传(空)时返回全部历史客资；传了则按日期筛选
    if (req.query.report_date && String(req.query.report_date).trim()) {
      clauses.push('report_date = ?');
      params.push(String(req.query.report_date).trim());
    }
    if (req.query.is_deal !== undefined && req.query.is_deal !== '') {
      clauses.push('is_deal = ?');
      params.push(parseInt(req.query.is_deal));
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT * FROM daily_customers ${where} ORDER BY id DESC`
    ).all(...params);
    res.json({ success: true, customers: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/customers', (req, res) => {
  try {
    const db = getDb();
    const spId = resolveSalespersonId(req, req.body.salesperson_id);
    const date = req.body.report_date || todayStr();

    const customer_name = str(req.body.customer_name);
    const customer_desc = str(req.body.customer_desc);
    const source = str(req.body.source);
    const phone = str(req.body.phone);
    const is_wechat = req.body.is_wechat ? 1 : 0;
    const is_douyin_comment = req.body.is_douyin_comment ? 1 : 0;
    const intention_product = str(req.body.intention_product);
    const is_deal = req.body.is_deal === true || req.body.is_deal === '是' || req.body.is_deal === 1 ? 1 : 0;
    const deal_amount = is_deal ? num(req.body.deal_amount) : 0;
    const not_deal_reason = is_deal ? '' : str(req.body.not_deal_reason);
    const note = str(req.body.note);

    const info = db.prepare(`
      INSERT INTO daily_customers
        (salesperson_id, report_date, customer_name, customer_desc, source,
         phone, is_wechat, is_douyin_comment, intention_product,
         is_deal, deal_amount, not_deal_reason, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(spId, date, customer_name, customer_desc, source, phone,
           is_wechat, is_douyin_comment, intention_product,
           is_deal, deal_amount, not_deal_reason, note);
    const row = db.prepare('SELECT * FROM daily_customers WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, customer: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/customers/:id', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM daily_customers WHERE id = ?').get(parseInt(req.params.id));
    if (!row) return res.status(404).json({ error: '客资记录不存在' });
    if (req.user.role === 'sales' && row.salesperson_id !== req.user.id) {
      return res.status(403).json({ error: '无权删除他人客资' });
    }
    db.prepare('DELETE FROM daily_customers WHERE id = ?').run(row.id);
    auditDelete(req, TARGET_TYPES.DAILY, row.id, row);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 编辑客资（按 id 更新，owner 或 admin/boss 可改）
router.put('/customers/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = db.prepare('SELECT * FROM daily_customers WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: '客资记录不存在' });
    if (req.user.role === 'sales' && row.salesperson_id !== req.user.id) {
      return res.status(403).json({ error: '无权编辑他人客资' });
    }
    const customer_name = str(req.body.customer_name);
    const customer_desc = str(req.body.customer_desc);
    const source = str(req.body.source);
    const phone = str(req.body.phone);
    const is_wechat = req.body.is_wechat ? 1 : 0;
    const is_douyin_comment = req.body.is_douyin_comment ? 1 : 0;
    const intention_product = str(req.body.intention_product);
    const is_deal = req.body.is_deal === true || req.body.is_deal === '是' || req.body.is_deal === 1 ? 1 : 0;
    const deal_amount = is_deal ? num(req.body.deal_amount) : 0;
    const not_deal_reason = is_deal ? '' : str(req.body.not_deal_reason);
    db.prepare(`
      UPDATE daily_customers SET
        customer_name = ?, customer_desc = ?, source = ?, phone = ?,
        is_wechat = ?, is_douyin_comment = ?, intention_product = ?,
        is_deal = ?, deal_amount = ?, not_deal_reason = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(customer_name, customer_desc, source, phone, is_wechat, is_douyin_comment,
           intention_product, is_deal, deal_amount, not_deal_reason, id);
    const updated = db.prepare('SELECT * FROM daily_customers WHERE id = ?').get(id);
    res.json({ success: true, customer: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ 字段自定义（仅 admin） ============ */

router.get('/field-config', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM daily_field_config ORDER BY scope, sort_order'
    ).all();
    res.json({ success: true, config: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/field-config', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    const upd = db.prepare(`
      UPDATE daily_field_config
      SET field_label = ?, is_enabled = ?, sort_order = ?, updated_at = datetime('now','localtime')
      WHERE id = ?
    `);
    const tx = db.transaction((list) => {
      for (const u of list) {
        if (u && u.id) {
          upd.run(
            (u.field_label || '').toString(),
            u.is_enabled ? 1 : 0,
            parseInt(u.sort_order) || 0,
            parseInt(u.id)
          );
        }
      }
    });
    tx(updates);
    res.json({ success: true, message: '字段配置已保存' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ 统计看板 ============ */

router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    let salesList = db.prepare(
      "SELECT id, display_name FROM users WHERE role = 'sales' AND active = 1 ORDER BY display_name"
    ).all();

    if (req.user.role === 'sales') {
      salesList = salesList.filter(u => u.id === req.user.id);
    }

    const per = salesList.map(u => {
      const target = getMonthlyTarget(db, u.id, year, month);
      const acc = getMonthAccumulated(db, u.id, ym);
      const customerCount = db.prepare(
        'SELECT COUNT(*) AS c FROM daily_customers WHERE salesperson_id = ? AND report_date >= ? AND report_date < ?'
      ).get(u.id, ...monthRange(ym)).c;
      return {
        user_id: u.id,
        display_name: u.display_name,
        target_amount: target,
        completed_amount: acc.amount,
        completed_count: acc.count,
        customer_count: customerCount,
        ratio: target > 0 ? Math.min(1, acc.amount / target) : 0,
      };
    });

    let store = null;
    if (req.user.role !== 'sales') {
      const targetTotal = per.reduce((s, r) => s + r.target_amount, 0);
      const completedTotal = per.reduce((s, r) => s + r.completed_amount, 0);
      store = {
        target_amount: targetTotal,
        completed_amount: completedTotal,
        remaining: Math.max(0, targetTotal - completedTotal),
        ratio: targetTotal > 0 ? Math.min(1, completedTotal / targetTotal) : 0,
      };
    }

    // 各导购今日日报提交状态（用于老板/店长看板"谁交了谁没交"）
    const submittedMap = {};
    if (req.user.role !== 'sales') {
      const today = todayStr();
      const todayReports = db.prepare(
        "SELECT salesperson_id, status FROM daily_reports WHERE report_date = ?"
      ).all(today);
      todayReports.forEach(r => { submittedMap[r.salesperson_id] = (r.status === 'submitted'); });
    }

    // 当月每日累计业绩趋势（用于看板趋势线）：基于已提交日报的 deal_amount 按日累加
    const { dayStart: monthStart, nextDay: nextMonth } = (() => {
      const [yy, mm] = ym.split('-').map(Number);
      const start = `${yy}-${String(mm).padStart(2, '0')}-01`;
      const end = mm === 12 ? `${yy + 1}-01-01` : `${yy}-${String(mm + 1).padStart(2, '0')}-01`;
      return { dayStart: start, nextDay: end };
    })();
    const dailySeries = db.prepare(`
      SELECT report_date AS d, COALESCE(SUM(deal_amount),0) AS amt, COALESCE(SUM(deal_count),0) AS cnt
      FROM daily_reports
      WHERE status = 'submitted' AND report_date >= ? AND report_date < ?
      GROUP BY report_date ORDER BY report_date ASC
    `).all(monthStart, nextMonth);
    // 转成{date, amount}序列
    const trend = dailySeries.map(r => ({ date: r.d, amount: r.amt, count: r.cnt }));

    res.json({ success: true, year, month, per_salesperson: per, store, submitted_map: submittedMap, trend });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 客户来源分布（当前筛选条件下聚合），用于看板来源饼图
router.get('/customer-source', (req, res) => {
  try {
    const db = getDb();
    const clauses = [];
    const params = [];
    if (req.user.role === 'sales') {
      clauses.push('salesperson_id = ?');
      params.push(req.user.id);
    } else if (req.query.salesperson_id && String(req.query.salesperson_id).trim()) {
      clauses.push('salesperson_id = ?');
      params.push(parseInt(req.query.salesperson_id));
    }
    if (req.query.report_date && String(req.query.report_date).trim()) {
      clauses.push('report_date = ?');
      params.push(String(req.query.report_date).trim());
    }
    if (req.query.year && req.query.month) {
      const ym = `${req.query.year}-${String(parseInt(req.query.month)).padStart(2, '0')}`;
      const [start, end] = monthRange(ym);
      clauses.push('report_date >= ? AND report_date < ?');
      params.push(start, end);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT COALESCE(source, '未填') AS source, COUNT(*) AS c,
              SUM(CASE WHEN is_deal = 1 THEN 1 ELSE 0 END) AS deals,
              COALESCE(SUM(CASE WHEN is_deal = 1 THEN deal_amount ELSE 0 END),0) AS amount
       FROM daily_customers ${where} GROUP BY source ORDER BY c DESC`
    ).all(...params);
    res.json({ success: true, sources: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 客资明细导出 CSV
router.get('/customers/export', (req, res) => {
  try {
    const db = getDb();
    const clauses = [];
    const params = [];
    if (req.user.role === 'sales') {
      clauses.push('salesperson_id = ?');
      params.push(req.user.id);
    } else if (req.query.salesperson_id && String(req.query.salesperson_id).trim()) {
      clauses.push('salesperson_id = ?');
      params.push(parseInt(req.query.salesperson_id));
    }
    if (req.query.report_date && String(req.query.report_date).trim()) {
      clauses.push('report_date = ?');
      params.push(String(req.query.report_date).trim());
    }
    if (req.query.is_deal !== undefined && req.query.is_deal !== '') {
      clauses.push('is_deal = ?');
      params.push(parseInt(req.query.is_deal));
    }
    if (req.query.year && req.query.month) {
      const ym = `${req.query.year}-${String(parseInt(req.query.month)).padStart(2, '0')}`;
      const [start, end] = monthRange(ym);
      clauses.push('report_date >= ? AND report_date < ?');
      params.push(start, end);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(
      `SELECT c.*, u.display_name AS salesperson_name
       FROM daily_customers c LEFT JOIN users u ON u.id = c.salesperson_id
       ${where} ORDER BY c.report_date DESC, c.id ASC`
    ).all(...params);

    const headers = ['日期', '导购', '客户情况', '客户名称', '来源', '电话', '意向产品',
      '是否成交', '成交金额', '未成交原因', '微信', '抖音', '录入时间'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
      lines.push([
        r.report_date, r.salesperson_name || '', r.customer_desc || '', r.customer_name || '',
        r.source || '', r.phone || '', r.intention_product || '',
        r.is_deal === 1 ? '是' : '否', r.is_deal === 1 ? (r.deal_amount || 0) : '',
        r.not_deal_reason || '', r.is_wechat === 1 ? '是' : '否',
        r.is_douyin_comment === 1 ? '是' : '否', r.updated_at || '',
      ].map(esc).join(','));
    });
    // BOM 让 Excel 正确识别 UTF-8
    const csv = '\uFEFF' + lines.join('\r\n');
    const fname = `客资明细_${todayStr()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // 中文文件名需 RFC5987 编码，否则 Node setHeader 抛 Invalid character
    res.setHeader('Content-Disposition', `attachment; filename="daily_customers_${todayStr()}.csv"; filename*=UTF-8''${encodeURIComponent(fname)}`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 历史已提交日报列表（按日/按人快速回顾）
router.get('/history', (req, res) => {
  try {
    const db = getDb();
    // admin/boss 不传 salesperson_id 时查全部已提交日报；否则按 resolveSalespersonId 规则
    let rows;
    if (req.user.role !== 'sales' && !req.query.salesperson_id) {
      rows = db.prepare(`
        SELECT id, salesperson_id, report_date, status,
               reception_count, deal_count, deal_amount, wechat_count, updated_at
        FROM daily_reports
        WHERE status = 'submitted'
        ORDER BY report_date DESC LIMIT 90
      `).all();
    } else {
      const spId = resolveSalespersonId(req, req.query.salesperson_id);
      rows = db.prepare(`
        SELECT id, salesperson_id, report_date, status,
               reception_count, deal_count, deal_amount, wechat_count, updated_at
        FROM daily_reports
        WHERE salesperson_id = ? AND status = 'submitted'
        ORDER BY report_date DESC LIMIT 90
      `).all(spId);
    }
    res.json({ success: true, reports: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ============ 长图数据 ============ */

router.get('/long-image-data', (req, res) => {
  try {
    const db = getDb();
    const spId = resolveSalespersonId(req, req.query.salesperson_id);
    const date = req.query.report_date || todayStr();
    const year = parseInt(date.slice(0, 4)) || new Date().getFullYear();
    const month = parseInt(date.slice(5, 7)) || (new Date().getMonth() + 1);
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    const report = db.prepare(
      'SELECT * FROM daily_reports WHERE salesperson_id = ? AND report_date = ?'
    ).get(spId, date) || null;

    // 客户明细（按序号排列）
    const customers = db.prepare(
      'SELECT * FROM daily_customers WHERE salesperson_id = ? AND report_date = ? ORDER BY id ASC'
    ).all(spId, date);

    const fieldConfig = db.prepare(
      'SELECT * FROM daily_field_config WHERE is_enabled = 1 ORDER BY sort_order'
    ).all();

    // 本月业绩（用于长图中的月度进度）
    const target = getMonthlyTarget(db, spId, year, month);
    const acc = getMonthAccumulated(db, spId, ym);
    const monthStats = {
      target_amount: target,
      accumulated: acc.amount,
      remaining: Math.max(0, target - acc.amount),
      ratio: target > 0 ? Math.min(1, acc.amount / target) : 0,
    };

    // 按成交/未成交分组
    const dealCustomers = customers.filter(c => c.is_deal === 1);
    const noDealCustomers = customers.filter(c => c.is_deal !== 1);

    // 今日汇总（优先用已提交的聚合值，否则实时算）
    let summary = {
      reception_count: customers.length,
      deal_count: dealCustomers.length,
      deal_amount: dealCustomers.reduce((s, c) => s + (c.deal_amount || 0), 0),
      phone_count: customers.filter(c => c.phone && c.phone.trim()).length,
      wechat_count: customers.filter(c => c.is_wechat === 1).length,
    };
    if (report && report.status === 'submitted') {
      summary = {
        reception_count: report.reception_count,
        deal_count: report.deal_count,
        deal_amount: report.deal_amount,
        phone_count: report.phone_count,
        wechat_count: report.wechat_count,
      };
    }

    res.json({
      success: true,
      store_name: getStoreName(db),
      salesperson_name: getSalesName(db, spId),
      report_date: date,
      report,
      field_config: fieldConfig,
      month_stats: monthStats,
      customers,              // 全部客户（用于列表）
      deal_customers: dealCustomers,
      no_deal_customers: noDealCustomers,
      summary,                // 今日汇总 6 指标
      customer_total: customers.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
