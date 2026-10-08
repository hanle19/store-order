import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { appendStoreFilter, resolveWriteStoreId } from '../utils/storeScope.js';
import wecom from '../services/wecom.js';
import { auditDelete, auditFromReq, TARGET_TYPES } from '../utils/audit.js';

const router = Router();
router.use(authMiddleware);

// CSV 导入：内存暂存，5MB 上限
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// 简易 CSV 解析（支持带引号字段、字段内逗号、双引号转义 ""）
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* 忽略 */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => (c || '').trim() !== ''));
}

// 中文/英文表头 → 字段映射
const IMPORT_HEADER_MAP = {
  '姓名': 'name', 'name': 'name',
  '电话': 'phone', 'phone': 'phone', '手机号': 'phone',
  '性别': 'gender', 'gender': 'gender',
  '生日': 'birthday', 'birthday': 'birthday',
  '来源': 'source', 'source': 'source',
  '意向产品': 'intention_product', 'intention_product': 'intention_product', '意向': 'intention_product',
  '预算': 'budget', 'budget': 'budget',
  '地址': 'address', 'address': 'address', '住址': 'address',
  '等级': 'level', 'level': 'level',
  '状态': 'status', 'status': 'status',
  '备注': 'note', 'note': 'note',
};

/* ============ 工具函数 ============ */

// 本地日期 YYYY-MM-DD（与 daily 模块保持一致）
function localToday() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v, d = 0) => {
  const n = Number(v);
  return (isNaN(n) || n < 0) ? d : n;
};

// 读取 system_config 单项配置，带类型兜底（缺配置不报错）
function getCfg(key, def) {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    if (!row) return def;
    const v = row.value;
    if (typeof def === 'number') {
      const n = Number(v);
      return Number.isFinite(n) ? n : def;
    }
    if (typeof def === 'boolean') return v === '1' || v === 'true';
    return v;
  } catch (e) { return def; }
}

// 在某个日期基础上加 N 天，返回 YYYY-MM-DD（本地日期）
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 距下一次生日（含今年/明年）的天数；非闰年 02-29 会自动落到 03-01（JS Date 容错）
function daysToNextMD(mdStr, todayDate) {
  const [bm, bd] = mdStr.split('-').map(Number);
  const y = todayDate.getFullYear();
  let next = new Date(y, bm - 1, bd);
  let diff = Math.round((next - todayDate) / 86400000);
  if (diff < 0) {
    next = new Date(y + 1, bm - 1, bd);
    diff = Math.round((next - todayDate) / 86400000);
  }
  return diff;
}

// 归属导购解析：导购只能看自己；经理/管理员可指定
function resolveOwnerId(req, requested) {
  if (req.user.role === 'sales') return req.user.id;
  return requested ? parseInt(requested) : null; // null = 全部
}

// 客户状态 / 等级 / 来源 字典（前端展示用）
const STATUS_LABEL = { new: '新客', following: '跟进中', intention: '意向', deal: '已成交', lost: '已流失' };
const LEVEL_LABEL = { A: 'A', B: 'B', C: 'C' };
const SOURCE_LABEL = { '自然进店': '自然进店', '老客户介绍': '老客户介绍', '线上客户': '线上客户', '其它': '其它' };

/* ============ 列表 ============ */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const role = req.user.role;
    const {
      search = '', source = '', status = '', level = '',
      owner_id = '', reminder = '', page = 1, pageSize = 20,
      budget_min = '', budget_max = '', no_wechat = '', no_douyin = '',
      birthday_month = '', no_followup_days = '',
    } = req.query;
    // 分页参数钳制：避免传入超大 pageSize 一次性拉全表导致服务被打垮，同时拦截非法值
    const pageNum = Math.max(1, parseInt(page) || 1);
    const rawSize = parseInt(pageSize);
    const pageSizeCapped = Math.min(200, Math.max(1, Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20));

    const clauses = [];
    const params = [];

    // 权限：导购只看自己的
    if (role === 'sales') {
      clauses.push('c.owner_id = ?');
      params.push(req.user.id);
    } else if (owner_id) {
      clauses.push('c.owner_id = ?');
      params.push(parseInt(owner_id));
    }

    if (search) {
      clauses.push('(c.name LIKE ? OR c.phone LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (source) { clauses.push('c.source = ?'); params.push(source); }
    if (status) { clauses.push('c.status = ?'); params.push(status); }
    if (level) { clauses.push('c.level = ?'); params.push(level); }
    if (budget_min) { clauses.push('c.budget >= ?'); params.push(num(budget_min)); }
    if (budget_max) { clauses.push('c.budget <= ?'); params.push(num(budget_max)); }
    if (no_wechat === '1') { clauses.push('c.is_wechat = 0'); }
    if (no_douyin === '1') { clauses.push('c.is_douyin = 0'); }
    if (birthday_month) { clauses.push('c.birthday LIKE ?'); params.push(`%-${String(birthday_month).padStart(2, '0')}-%`); }
    if (no_followup_days) {
      clauses.push(`(c.last_followup_date = '' OR c.last_followup_date IS NULL OR julianday('now','localtime') - julianday(c.last_followup_date) >= ?)`);
      params.push(num(no_followup_days));
    }

    // 提醒筛选：有下次跟进日期 且 <= 今天 且 未成交/未流失
    if (reminder === '1') {
      clauses.push("c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost')");
      params.push(localToday());
    }

    let where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // 门店隔离（Phase 1）：sales 仅本店；admin/boss 受 ?store_id 限定
    where = appendStoreFilter(where, params, 'c', req);
    const total = db.prepare(`SELECT COUNT(*) AS c FROM customers c ${where}`).get(...params).c;

    const offset = (pageNum - 1) * pageSizeCapped;
    const rows = db.prepare(`
      SELECT c.*, u.display_name AS owner_name
      FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      ${where}
      ORDER BY
        CASE WHEN c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost') THEN 0 ELSE 1 END,
        c.next_followup_date ASC,
        c.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, localToday(), pageSizeCapped, offset);

    res.json({ success: true, customers: rows, total });
  } catch (e) {
    console.error('[customers] list error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 今日 / 逾期提醒 ============ */
router.get('/reminders/today', (req, res) => {
  try {
    const db = getDb();
    const role = req.user.role;
    const today = localToday();
    const ownerClause = role === 'sales' ? 'AND c.owner_id = ?' : '';
    const ownerParam = role === 'sales' ? [req.user.id] : [];
    const rows = db.prepare(`
      SELECT c.*, u.display_name AS owner_name
      FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost')
        ${ownerClause}
      ORDER BY c.next_followup_date ASC
    `).all(today, ...ownerParam);
    res.json({ success: true, reminders: rows, today });
  } catch (e) {
    console.error('[customers] reminders error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 运营自动化汇总（R0~R4） ============ */
router.get('/operations/summary', (req, res) => {
  try {
    const db = getDb();
    const role = req.user.role;
    const today = localToday();
    const todayDate = new Date(today + 'T00:00:00');
    const ownerClause = role === 'sales' ? 'AND c.owner_id = ?' : '';
    const ownerParam = role === 'sales' ? [req.user.id] : [];

    // R0 今日 / 逾期（复用现有 reminders 口径，排除 deal/lost）
    const allReminders = db.prepare(`
      SELECT c.*, u.display_name AS owner_name
      FROM customers c LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost')
        ${ownerClause}
      ORDER BY c.next_followup_date ASC
    `).all(today, ...ownerParam);
    const overdue = allReminders.filter(r => r.next_followup_date < today);
    const todayList = allReminders.filter(r => r.next_followup_date === today);

    // R1 沉睡预警：未成交/未流失 且 最近跟进为空或距今≥阈值天
    const dormantDays = getCfg('dormant_days', 60);
    const dormant = db.prepare(`
      SELECT c.*, u.display_name AS owner_name,
        CAST(julianday('now','localtime') - julianday(c.last_followup_date) AS INT) AS days_since
      FROM customers c LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status IN ('new','following','intention')
        AND (c.last_followup_date = '' OR c.last_followup_date IS NULL
             OR julianday('now','localtime') - julianday(c.last_followup_date) >= ?)
        ${ownerClause}
      ORDER BY days_since DESC
    `).all(dormantDays, ...ownerParam);

    // R2 生日提醒（Node 端计算，跨年回绕 + 02-29 兜底）
    const birthdayWindow = getCfg('birthday_remind_days', 7);
    const bdRows = db.prepare(`
      SELECT c.*, u.display_name AS owner_name FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.birthday <> '' AND c.birthday IS NOT NULL ${ownerClause}
    `).all(...ownerParam);
    const birthday = [];
    for (const c of bdRows) {
      const diff = daysToNextMD(c.birthday.slice(0, 10), todayDate);
      if (diff >= 0 && diff <= birthdayWindow) birthday.push({ ...c, days_left: diff });
    }
    birthday.sort((a, b) => a.days_left - b.days_left);

    // R3 节日提醒（配置驱动，公历月日；农历节日初值为 2026 公历，跨年管理员在设置更新）
    const holidayWindow = birthdayWindow;
    let holidays = [];
    try { holidays = JSON.parse(getCfg('holidays_json', '[]')); } catch (e) { holidays = []; }
    const holiday = [];
    for (const h of holidays) {
      if (!h || !h.month || !h.day) continue;
      const md = `${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`;
      const diff = daysToNextMD(md, todayDate);
      if (diff >= 0 && diff <= holidayWindow) holiday.push({ name: h.name, month: h.month, day: h.day, days_left: diff });
    }
    holiday.sort((a, b) => a.days_left - b.days_left);

    // R4 成交后待回访：status=deal 且 下次跟进日期 <= 今天+窗口（独立维度，不污染 R0）
    const dealWindow = getCfg('after_deal_followup_days', 7);
    const dealCallback = db.prepare(`
      SELECT c.*, u.display_name AS owner_name
      FROM customers c LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status = 'deal'
        AND c.next_followup_date <> '' AND c.next_followup_date <= date('now','localtime', ?)
        ${ownerClause}
      ORDER BY c.next_followup_date ASC
    `).all(`+${dealWindow} days`, ...ownerParam);

    // R5 流失客户（用于流失挽回）
    const lost = db.prepare(`
      SELECT c.*, u.display_name AS owner_name,
        CAST(julianday('now','localtime') - julianday(c.lost_at) AS INT) AS days_lost
      FROM customers c LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status = 'lost' ${ownerClause}
      ORDER BY c.lost_at DESC
    `).all(...ownerParam);

    const counts = {
      today: todayList.length,
      overdue: overdue.length,
      dormant: dormant.length,
      birthday: birthday.length,
      holiday: holiday.length,
      deal_callback: dealCallback.length,
      lost: lost.length,
      total: allReminders.length + dormant.length + birthday.length + holiday.length + dealCallback.length + lost.length,
    };

    res.json({
      success: true,
      today: todayList,
      overdue,
      dormant,
      birthday,
      holiday,
      deal_callback: dealCallback,
      lost,
      counts,
      config: {
        dormant_days: dormantDays,
        birthday_remind_days: birthdayWindow,
        after_deal_followup_days: dealWindow,
      },
    });
  } catch (e) {
    console.error('[customers] operations summary error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 查重（建档/编辑时实时提示） ============ */
router.get('/check-duplicate', (req, res) => {
  try {
    const db = getDb();
    const { phone = '', name = '', exclude_id = '' } = req.query;
    const exId = exclude_id ? parseInt(exclude_id) : 0;
    let match = null;
    if (phone) {
      match = db.prepare('SELECT id, name, phone, status, owner_id FROM customers WHERE phone = ? AND id <> ?').get(phone, exId);
    }
    if (!match && name) {
      match = db.prepare("SELECT id, name, phone, status, owner_id FROM customers WHERE name = ? AND phone = '' AND id <> ?").get(name, exId);
    }
    res.json({ success: true, exists: !!match, customer: match });
  } catch (e) { console.error('[customers] check-duplicate error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 数据看板统计 ============ */
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const role = req.user.role;
    const ownerClause = role === 'sales' ? 'AND c.owner_id = ?' : '';
    const ownerParam = role === 'sales' ? [req.user.id] : [];

    const statusDist = db.prepare(`SELECT status, COUNT(*) AS c FROM customers c WHERE 1=1 ${ownerClause} GROUP BY status`).all(...ownerParam);
    const sourceDist = db.prepare(`SELECT source, COUNT(*) AS c FROM customers c WHERE source <> '' ${ownerClause} GROUP BY source`).all(...ownerParam);
    const levelDist = db.prepare(`SELECT level, COUNT(*) AS c FROM customers c WHERE 1=1 ${ownerClause} GROUP BY level`).all(...ownerParam);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE 1=1 ${ownerClause}`).get(...ownerParam).c;
    const dealCount = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE status='deal' ${ownerClause}`).get(...ownerParam).c;
    const intentionCount = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE status='intention' ${ownerClause}`).get(...ownerParam).c;
    const lostCount = db.prepare(`SELECT COUNT(*) AS c FROM customers c WHERE status='lost' ${ownerClause}`).get(...ownerParam).c;

    const monthRows = db.prepare(`
      SELECT strftime('%Y-%m', created_at) AS ym, COUNT(*) AS c
      FROM customers c WHERE 1=1 ${ownerClause}
      GROUP BY ym ORDER BY ym DESC LIMIT 6
    `).all(...ownerParam);

    let bySales = [];
    if (role !== 'sales') {
      bySales = db.prepare(`
        SELECT u.display_name AS name,
          COUNT(c.id) AS total,
          SUM(CASE WHEN c.status='deal' THEN 1 ELSE 0 END) AS deals
        FROM users u
        LEFT JOIN customers c ON c.owner_id = u.id AND u.role IN ('sales','boss')
        WHERE u.role IN ('sales','boss')
        GROUP BY u.id ORDER BY total DESC
      `).all();
    }

    res.json({
      success: true,
      status_dist: statusDist, source_dist: sourceDist, level_dist: levelDist,
      total, deal_count: dealCount, intention_count: intentionCount, lost_count: lostCount,
      month_trend: monthRows.reverse(), by_sales: bySales,
    });
  } catch (e) { console.error('[customers] stats error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 批量导入（CSV） ============ */
router.post('/import', importUpload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请上传 CSV 文件' });
    const db = getDb();
    const role = req.user.role;
    const text = req.file.buffer.toString('utf-8').replace(/^﻿/, '');
    const rows = parseCsv(text);
    if (rows.length < 2) return res.json({ success: true, imported: 0, skipped: 0, errors: [], message: '无有效数据' });
    const header = rows[0].map(h => (IMPORT_HEADER_MAP[(h || '').trim()] || (h || '').trim()));
    let imported = 0, skipped = 0;
    const errors = [];
    const insert = db.prepare(`INSERT INTO customers
      (name, phone, gender, birthday, source, intention_product, budget, address, level, status, note, owner_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime'))`);
    const tx = db.transaction(() => {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const obj = {};
        header.forEach((key, idx) => { if (key) obj[key] = (r[idx] || '').trim(); });
        const name = obj.name || '';
        const phone = obj.phone || '';
        if (!name && !phone) { skipped++; continue; }
        // 去重：同电话或同姓名(无电话)已存在则跳过
        const dup = phone
          ? db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone)
          : db.prepare("SELECT id FROM customers WHERE name = ? AND phone = ''").get(name);
        if (dup) { skipped++; continue; }
        const ownerId = role === 'sales' ? req.user.id : null;
        try {
          insert.run(name, phone, obj.gender || '', obj.birthday || '', obj.source || '', obj.intention_product || '',
            num(obj.budget), obj.address || '', obj.level || 'C', obj.status || 'new', obj.note || '', ownerId);
          imported++;
        } catch (e) { errors.push(`第${i + 1}行：${e.message}`); }
      }
    });
    tx();
    res.json({ success: true, imported, skipped, errors, message: `成功导入 ${imported} 条，跳过 ${skipped} 条` });
  } catch (e) { console.error('[customers] import error', e); res.status(500).json({ success: false, error: '导入失败：' + e.message }); }
});

/* ============ 批量分配/移交（管理员/店长） ============ */
router.post('/reassign', roleMiddleware('admin', 'boss'), (req, res) => {
  try {
    const db = getDb();
    const { ids = [], owner_id } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: '请选择客户' });
    const oid = parseInt(owner_id);
    if (!oid || !db.prepare('SELECT id FROM users WHERE id = ?').get(oid)) return res.status(400).json({ success: false, error: '目标导购无效' });
    const placeholders = ids.map(() => '?').join(',');
    const info = db.prepare(`UPDATE customers SET owner_id = ?, updated_at = datetime('now','localtime') WHERE id IN (${placeholders})`).run(oid, ...ids.map(id => parseInt(id)));
    res.json({ success: true, updated: info.changes, message: `已分配给 ${info.changes} 位客户` });
  } catch (e) { console.error('[customers] reassign error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 推送跟进待办到企业微信（管理员/店长） ============ */
router.post('/push-reminders', roleMiddleware('admin', 'boss'), async (req, res) => {
  try {
    const db = getDb();
    const today = localToday();
    const reminders = db.prepare(`
      SELECT c.*, u.display_name AS owner_name FROM customers c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.next_followup_date <> '' AND c.next_followup_date <= ? AND c.status NOT IN ('deal','lost')
      ORDER BY c.next_followup_date ASC
    `).all(today);
    const overdue = reminders.filter(r => r.next_followup_date < today);
    const dueToday = reminders.filter(r => r.next_followup_date === today);
    const cfg = wecom.getWecomConfig(db);
    if (!cfg.wecom_webhook_url) {
      return res.json({ success: true, pushed: false, reason: '企业微信未配置' });
    }
    const storeRow = db.prepare("SELECT value FROM system_config WHERE key='store_name'").get();
    const storeName = storeRow ? storeRow.value : '我的门店';
    const lines = [];
    lines.push(`# 📞 ${storeName} · 客户跟进待办`);
    lines.push(`> <font color="comment">${today}</font>`);
    lines.push('');
    lines.push(`## 今日待跟进：**${dueToday.length}** ｜ 逾期：**${overdue.length}**`);
    [...overdue, ...dueToday].slice(0, 20).forEach(c => {
      const tag = c.next_followup_date < today ? '逾期' : '今日';
      lines.push(`> ${tag} ${c.name || '-'}${c.owner_name ? '（' + c.owner_name + '）' : ''} ${c.phone || ''} 下次 ${c.next_followup_date}`);
    });
    if (!reminders.length) lines.push('> 暂无需跟进客户');
    const resp = await wecom.sendMarkdown(db, lines.join('\n'));
    res.json({ success: true, pushed: !!(resp && resp.errcode === 0), reason: resp?.hint || '', response: resp });
  } catch (e) { console.error('[customers] push-reminders error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 新建客户 ============ */
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const name = str(b.name);
    const phone = str(b.phone);
    if (!name && !phone) {
      return res.status(400).json({ success: false, error: '客户姓名或电话至少填写一项' });
    }
    const ownerId = resolveOwnerId(req, b.owner_id);
    const info = db.prepare(`
      INSERT INTO customers
        (name, phone, gender, birthday, source, intention_product, budget, address,
         level, status, is_wechat, is_douyin, owner_id, note, avatar, store_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(
      name, phone, str(b.gender), str(b.birthday), str(b.source), str(b.intention_product),
      num(b.budget), str(b.address), str(b.level) || 'C', str(b.status) || 'new',
      b.is_wechat ? 1 : 0, b.is_douyin ? 1 : 0, ownerId, str(b.note), str(b.avatar), resolveWriteStoreId(req)
    );
    const row = db.prepare('SELECT c.*, u.display_name AS owner_name FROM customers c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = ?').get(info.lastInsertRowid);
    res.json({ success: true, customer: row });
  } catch (e) {
    console.error('[customers] create error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 日报客资自动归档（upsert 到主档 + 写跟进记录） ============ */
// 由 DailyReport 录入客资后调用：同一电话自动关联主档，否则新建；并追加一条当日跟进记录
router.post('/link-daily', (req, res) => {
  try {
    const db = getDb();
    const b = req.body || {};
    const salespersonId = resolveOwnerId(req, b.salesperson_id);
    const reportDate = str(b.report_date) || localToday();
    const phone = str(b.phone);
    const name = str(b.customer_name);
    const isDeal = b.is_deal ? 1 : 0;

    let customerId = null;
    let created = 0;

    if (phone) {
      const exist = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
      if (exist) {
        customerId = exist.id;
        // 仅补充空白字段，不覆盖已有信息
        db.prepare(`
          UPDATE customers SET
            name = CASE WHEN name = '' THEN ? ELSE name END,
            source = CASE WHEN source = '' THEN ? ELSE source END,
            intention_product = CASE WHEN intention_product = '' THEN ? ELSE intention_product END,
            is_wechat = CASE WHEN is_wechat = 0 THEN ? ELSE is_wechat END,
            is_douyin = CASE WHEN is_douyin = 0 THEN ? ELSE is_douyin END,
            status = CASE WHEN status = 'new' THEN 'following' ELSE status END,
            last_followup_date = ?,
            updated_at = datetime('now','localtime')
          WHERE id = ?
        `).run(
          name, str(b.source), str(b.intention_product),
          b.is_wechat ? 1 : 0, b.is_douyin ? 1 : 0,
          reportDate, exist.id
        );
      }
    }

    if (!customerId) {
      const info = db.prepare(`
        INSERT INTO customers
          (name, phone, source, intention_product, is_wechat, is_douyin, owner_id, status, last_followup_date, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?, 'new', ?, datetime('now','localtime'), datetime('now','localtime'))
      `).run(
        name, phone, str(b.source), str(b.intention_product),
        b.is_wechat ? 1 : 0, b.is_douyin ? 1 : 0, salespersonId, reportDate
      );
      customerId = info.lastInsertRowid;
      created = 1;
    }

    // 追加一条当日跟进记录
    const method = b.is_wechat ? '微信' : '到店';
    let content = str(b.customer_desc);
    if (isDeal) content += (content ? '；' : '') + `成交，金额 ¥${num(b.deal_amount)}`;
    else if (str(b.not_deal_reason)) content += (content ? '；' : '') + `未成交：${str(b.not_deal_reason)}`;
    const result = isDeal ? '成交' : '继续跟进';
    db.prepare(`
      INSERT INTO customer_followups
        (customer_id, salesperson_id, followup_date, method, content, result, created_at, updated_at)
      VALUES (?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(customerId, salespersonId, reportDate, method, content, result);

    // R4 成交后自动回访（日报归档成交时同步）：置成交状态 + 自动设下次回访日期
    if (isDeal) {
      const nxt = addDays(reportDate, getCfg('after_deal_followup_days', 7));
      db.prepare(`UPDATE customers SET status = 'deal',
        next_followup_date = CASE WHEN next_followup_date = '' OR next_followup_date IS NULL THEN ? ELSE next_followup_date END,
        updated_at = datetime('now','localtime') WHERE id = ?`).run(nxt, customerId);
    }

    res.json({ success: true, customer_id: customerId, created });
  } catch (e) {
    console.error('[customers] link-daily error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* 字典接口（前端下拉用）—— 必须放在 /:id 之前，避免被参数路由拦截 */
router.get('/meta/dicts', (req, res) => {
  res.json({
    success: true,
    status_label: STATUS_LABEL,
    level_label: LEVEL_LABEL,
    source_label: SOURCE_LABEL,
  });
});

/* ============ 详情（含跟进历史） ============ */
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const row = db.prepare('SELECT c.*, u.display_name AS owner_name FROM customers c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = ?').get(id);
    if (!row) return res.status(404).json({ success: false, error: '客户不存在' });
    // 权限：导购只能看自己的
    if (req.user.role === 'sales' && row.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权访问' });
    }
    const followups = db.prepare('SELECT f.*, u.display_name AS salesperson_name FROM customer_followups f LEFT JOIN users u ON f.salesperson_id = u.id WHERE f.customer_id = ? ORDER BY f.followup_date DESC, f.id DESC').all(id);
    res.json({ success: true, customer: row, followups });
  } catch (e) {
    console.error('[customers] detail error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 关联订单（客户视角看订单） ============ */
const ORDER_STATUS_LABEL = {
  completed: '已完成', cancelled: '已取消', signed: '已签收', pending: '待付定金',
  deposited: '已付定金', full_paid: '已付全款', purchasing: '订货中', ordered: '已订货',
  arrived: '部分到货', ready: '齐货待收', balance_paid: '尾款结清', special_released: '视同结清',
  delivering: '配送中', partially_delivered: '分批配送',
};
router.get('/:id/orders', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && customer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权访问' });
    }
    const orders = db.prepare(`
      SELECT o.id, o.order_no, o.customer_name, o.customer_phone, o.total_amount, o.actual_amount,
             o.status, o.created_at, o.delivery_date, u.display_name AS salesperson_name
      FROM orders o
      LEFT JOIN users u ON o.salesperson_id = u.id
      WHERE o.customer_id = ? OR (o.customer_id IS NULL AND (o.customer_phone = ? OR o.customer_name = ?))
      ORDER BY o.created_at DESC
    `).all(id, customer.phone || ' ', customer.name || ' ');
    res.json({ success: true, orders: orders.map(o => ({ ...o, status_label: ORDER_STATUS_LABEL[o.status] || o.status })) });
  } catch (e) { console.error('[customers] orders error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 快捷状态推进（标记意向/成交/流失/重新激活） ============ */
router.post('/:id/advance', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && exist.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权操作' });
    }
    const { status } = req.body || {};
    const allowed = ['new', 'following', 'intention', 'deal', 'lost'];
    if (!allowed.includes(status)) return res.status(400).json({ success: false, error: '非法状态' });
    const lostAt = status === 'lost' ? localToday() : '';
    db.prepare(`UPDATE customers SET status = ?, lost_at = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(status, lostAt, id);
    const row = db.prepare('SELECT c.*, u.display_name AS owner_name FROM customers c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = ?').get(id);
    res.json({ success: true, customer: row });
  } catch (e) { console.error('[customers] advance error', e); res.status(500).json({ success: false, error: '服务器错误' }); }
});

/* ============ 更新客户 ============ */
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && exist.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权修改' });
    }
    const b = req.body || {};
    // 经理可改归属；导购不可改归属
    const ownerId = req.user.role === 'sales' ? exist.owner_id : (b.owner_id != null ? parseInt(b.owner_id) : exist.owner_id);
    db.prepare(`
      UPDATE customers SET
        name = ?, phone = ?, gender = ?, birthday = ?, source = ?, intention_product = ?,
        budget = ?, address = ?, level = ?, status = ?, is_wechat = ?, is_douyin = ?,
        owner_id = ?, note = ?, avatar = COALESCE(NULLIF(?, ''), avatar), updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      str(b.name), str(b.phone), str(b.gender), str(b.birthday), str(b.source), str(b.intention_product),
      num(b.budget), str(b.address), str(b.level) || exist.level, str(b.status) || exist.status,
      b.is_wechat ? 1 : 0, b.is_douyin ? 1 : 0, ownerId, str(b.note), str(b.avatar) || '', id
    );
    const row = db.prepare('SELECT c.*, u.display_name AS owner_name FROM customers c LEFT JOIN users u ON c.owner_id = u.id WHERE c.id = ?').get(id);
    res.json({ success: true, customer: row });
  } catch (e) {
    console.error('[customers] update error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 删除客户（级联跟进记录） ============ */
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && exist.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权删除' });
    }
    db.prepare('DELETE FROM customer_followups WHERE customer_id = ?').run(id);
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    auditDelete(req, TARGET_TYPES.CUSTOMER, id, exist);
    res.json({ success: true });
  } catch (e) {
    console.error('[customers] delete error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 添加跟进记录 ============ */
router.post('/:id/followups', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && customer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权操作' });
    }
    const b = req.body || {};
    const followupDate = str(b.followup_date) || localToday();
    let nextDate = str(b.next_followup_date);
    // R4 成交后自动回访：成交且未手动设定下次跟进时，自动设为 N 天后
    if (str(b.result) === '成交' && !nextDate) {
      nextDate = addDays(followupDate, getCfg('after_deal_followup_days', 7));
    }
    const info = db.prepare(`
      INSERT INTO customer_followups
        (customer_id, salesperson_id, followup_date, method, content, next_followup_date, result, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(id, req.user.id, followupDate, str(b.method), str(b.content), nextDate, str(b.result));

    // 同步客户主档：最近跟进时间 + 下次跟进时间 + 状态
    db.prepare(`
      UPDATE customers SET
        last_followup_date = ?,
        next_followup_date = ?,
        status = CASE WHEN ? = '成交' THEN 'deal' WHEN ? = '放弃' THEN 'lost' ELSE (CASE WHEN status = 'new' THEN 'following' ELSE status END) END,
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(followupDate, nextDate, str(b.result), str(b.result), id);

    const row = db.prepare('SELECT * FROM customer_followups WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, followup: row });
  } catch (e) {
    console.error('[customers] add followup error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

/* ============ 删除跟进记录 ============ */
router.delete('/:id/followups/:fid', (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const fid = parseInt(req.params.fid);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!customer) return res.status(404).json({ success: false, error: '客户不存在' });
    if (req.user.role === 'sales' && customer.owner_id !== req.user.id) {
      return res.status(403).json({ success: false, error: '无权操作' });
    }
    const followup = db.prepare('SELECT * FROM customer_followups WHERE id = ? AND customer_id = ?').get(fid, id);
    db.prepare('DELETE FROM customer_followups WHERE id = ? AND customer_id = ?').run(fid, id);
    auditFromReq(req, {
      targetType: TARGET_TYPES.CUSTOMER, targetId: id, action: 'delete_followup',
      details: { followup_id: fid, before: followup },
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[customers] delete followup error', e);
    res.status(500).json({ success: false, error: '服务器错误' });
  }
});

export default router;
