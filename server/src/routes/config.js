import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// GET /api/config/public — 公开接口（无需登录），返回站点名称等公开配置
router.get('/public', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get('site_name');
    res.json({ site_name: row?.value || '门店系统' });
  } catch (e) {
    res.json({ site_name: '门店系统' });
  }
});

// 所有配置接口需要登录
router.use(authMiddleware);

// 敏感配置识别：key 名含这些词的配置视为凭据类，非管理员只返回掩码
// （库中当前 19 项均为业务配置、无凭据，此处为将来新增密钥类配置提供自动保护）
const SENSITIVE_KEY_RE = /(key|secret|token|password|passwd|webhook)/i;

function maskValue(v) {
  const s = String(v ?? '');
  if (!s) return '';
  return s.length <= 6 ? '****' : `****${s.slice(-6)}`;
}

// GET /api/config — 获取所有配置（所有登录用户可读；凭据类配置仅管理员可见明文）
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM system_config').all();
    const isAdmin = req.user?.role === 'admin';
    const config = {};
    for (const row of rows) {
      if (SENSITIVE_KEY_RE.test(row.key) && !isAdmin) {
        // 非管理员：不返回明文，仅给掩码占位（供界面展示"已配置"）
        config[row.key] = '';
        config[`${row.key}_masked`] = maskValue(row.value);
        continue;
      }
      config[row.key] = row.value;
    }
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/config — 更新配置（仅管理员）
router.put('/', (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可修改系统配置' });
    }
    const db = getDb();
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: '请求参数无效' });
    }
    // 库房列表单独校验并规范化（在事务外完成，校验失败直接返回，避免污染事务）
    let warehousesValue;
    if (updates.warehouses !== undefined) {
      let arr;
      try { arr = JSON.parse(updates.warehouses); } catch {
        return res.status(400).json({ error: '库房配置格式错误（应为 JSON 数组）' });
      }
      if (!Array.isArray(arr)) {
        return res.status(400).json({ error: '库房配置必须是数组' });
      }
      const clean = [];
      for (const x of arr) {
        const s = String(x == null ? '' : x).trim();
        if (s && !clean.includes(s)) clean.push(s);
      }
      warehousesValue = JSON.stringify(clean);
    }

    const stmt = db.prepare('INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, datetime(\'now\',\'localtime\')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'warehouses') {
          stmt.run('warehouses', warehousesValue);
          continue;
        }
        // 防掩码回写：非管理员界面拿到的是 `****` 占位值，不得写回数据库
        if (typeof value === 'string' && /^\*+/.test(value)) continue;
        if (typeof value === 'string') {
          stmt.run(key, value);
        }
      }
    });
    tx();
    res.json({ message: '配置已更新' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
