import { Router } from 'express';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditFromReq, TARGET_TYPES } from '../utils/audit.js';

const router = Router();

// 获取全部配送师傅（所有登录用户可读）
router.get('/', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const persons = db.prepare(
      `SELECT * FROM delivery_persons WHERE active = 1 ORDER BY id DESC`
    ).all();
    res.json({ data: persons });
  } catch (e) {
    console.error('[delivery-persons] GET / error:', e.message);
    res.status(500).json({ error: '加载配送师傅失败' });
  }
});

// 添加配送师傅（admin 专属）
router.post('/', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const { name, phone, note } = req.body;
    if (!name) return res.status(400).json({ error: '师傅姓名不能为空' });

    const db = getDb();
    const result = db.prepare(
      `INSERT INTO delivery_persons (name, phone, note) VALUES (?, ?, ?)`
    ).run(name.trim(), (phone || '').trim(), (note || '').trim());

    const person = db.prepare(`SELECT * FROM delivery_persons WHERE id = ?`).get(result.lastInsertRowid);
    res.json({ data: person, message: '添加成功' });
  } catch (e) {
    console.error('[delivery-persons] POST / error:', e.message);
    res.status(500).json({ error: '添加配送师傅失败' });
  }
});

// 编辑配送师傅（admin 专属）
router.put('/:id', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const { name, phone, note } = req.body;
    if (!name) return res.status(400).json({ error: '师傅姓名不能为空' });

    const db = getDb();
    const existing = db.prepare(`SELECT * FROM delivery_persons WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: '配送师傅不存在' });

    db.prepare(
      `UPDATE delivery_persons SET name = ?, phone = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(name.trim(), (phone || '').trim(), (note || '').trim(), req.params.id);

    const updated = db.prepare(`SELECT * FROM delivery_persons WHERE id = ?`).get(req.params.id);
    res.json({ data: updated, message: '更新成功' });
  } catch (e) {
    console.error('[delivery-persons] PUT error:', e.message);
    res.status(500).json({ error: '更新配送师傅失败' });
  }
});

// 删除配送师傅 — 软删除（admin 专属）
router.delete('/:id', authMiddleware, roleMiddleware('admin'), (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM delivery_persons WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: '配送师傅不存在' });

    db.prepare(`UPDATE delivery_persons SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(req.params.id);

    auditFromReq(req, {
      targetType: TARGET_TYPES.DELIVERY_PERSON, targetId: existing.id, action: 'delete',
      oldStatus: 'active', newStatus: 'deactivated', details: { before: existing },
    });
    res.json({ message: '已删除' });
  } catch (e) {
    console.error('[delivery-persons] DELETE error:', e.message);
    res.status(500).json({ error: '删除配送师傅失败' });
  }
});

export default router;
