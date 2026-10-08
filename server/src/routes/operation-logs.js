import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET / — 查询操作日志（仅管理员/老板，含金额等敏感信息）
router.get('/', roleMiddleware('admin', 'boss'), (req, res) => {
  try {
    const db = getDb();
    const { target_type, target_id, operator_id, action, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const params = [];

    if (target_type) { conditions.push('target_type = ?'); params.push(target_type); }
    if (target_id) { conditions.push('target_id = ?'); params.push(Number(target_id)); }
    if (operator_id) { conditions.push('operator_id = ?'); params.push(Number(operator_id)); }
    if (action) { conditions.push('action = ?'); params.push(action); }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // 负 LIMIT 在 SQLite 中表示「不限制」，传入 -1 会一次拉全表；同时限制单次最大条数
    const rawLimit = Number(limit);
    const rawOffset = Number(offset);
    const lim = Math.min(200, Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100));
    const off = Math.max(0, Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0);

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM operation_logs ${where}`).get(...params).cnt;
    const data = db.prepare(`SELECT * FROM operation_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, lim, off);

    res.json({ total, limit: lim, offset: off, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /stats — 操作统计
router.get('/stats', roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const { days = 30 } = req.query;
    const stats = db.prepare(`
      SELECT action, COUNT(*) as cnt
      FROM operation_logs
      WHERE created_at >= datetime('now', 'localtime', '-${Number(days)} days')
      GROUP BY action
      ORDER BY cnt DESC
    `).all();
    res.json({ stats, days: Number(days) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
