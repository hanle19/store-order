import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import { auditFromReq, TARGET_TYPES } from '../utils/audit.js';

const router = Router();

// 获取所有用户（管理员/老板可看）
router.get('/', authMiddleware, roleMiddleware('admin', 'boss'), (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, display_name, role, phone, store_id, active, created_at FROM users ORDER BY id').all();
  res.json(users);
});

// 创建用户
router.post('/', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  const { username, password, display_name, role, phone, store_id } = req.body;
  if (!username || !password || !display_name || !role) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  if (!['admin', 'boss', 'sales'].includes(role)) {
    return res.status(400).json({ error: '角色无效' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const hash = await bcrypt.hash(password, 10);
  const sid = store_id ? Number(store_id) : null;
  db.prepare(`INSERT INTO users (username, password, display_name, role, phone, store_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(username, hash, display_name, role, phone || null, sid);
  res.json({ message: '用户创建成功' });
});

// 更新用户
router.put('/:id', authMiddleware, roleMiddleware('admin'), (req, res) => {
  const { display_name, role, phone, active, store_id } = req.body;
  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const fields = [];
  const values = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); values.push(display_name); }
  if (role !== undefined) { fields.push('role = ?'); values.push(role); }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
  if (store_id !== undefined) { fields.push('store_id = ?'); values.push(store_id ? Number(store_id) : null); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }

  if (fields.length === 0) return res.status(400).json({ error: '没有需要更新的字段' });

  fields.push("updated_at = datetime('now','localtime')");
  values.push(req.params.id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  res.json({ message: '更新成功' });
});

// 重置密码
router.post('/:id/reset-password', authMiddleware, roleMiddleware('admin'), async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const hash = await bcrypt.hash('123456', 10);
  db.prepare("UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(hash, req.params.id);
  res.json({ message: '密码已重置为 123456' });
});

// 删除用户（软删除：设置 active=0，保留历史数据）
router.delete('/:id', authMiddleware, roleMiddleware('admin'), (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // 不允许删除自己
  if (user.id === req.user.id) {
    return res.status(400).json({ error: '不能删除自己的账号' });
  }

  db.prepare("UPDATE users SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(userId);
  auditFromReq(req, {
    targetType: TARGET_TYPES.USER, targetId: userId, action: 'delete',
    oldStatus: 'active', newStatus: 'deactivated', details: { before: user },
  });
  res.json({ message: `用户「${user.username}」已删除（历史数据已保留）` });
});

// 获取导购列表（下单时选择）
router.get('/salespersons', authMiddleware, (req, res) => {
  const db = getDb();
  const users = db.prepare("SELECT id, display_name, phone FROM users WHERE active = 1 AND role IN ('sales','admin','boss') ORDER BY id").all();
  res.json(users);
});

export default router;
