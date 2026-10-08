import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { generateToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// 登录失败限流（进程内计数，重启即清空）：同一「用户名 + IP」连续失败达到上限后锁定一段时间，
// 防止口令爆破。内网部署影响极小，公网可达时提供基础防护。
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const loginAttempts = new Map(); // key -> { count, lockUntil }

function attemptKey(username, req) {
  return `${String(username || '').toLowerCase()}|${req.ip || 'unknown'}`;
}

function lockedMinutesLeft(rec) {
  return Math.max(1, Math.ceil((rec.lockUntil - Date.now()) / 60000));
}

// 定期清理过期记录，避免 Map 无界增长
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (!v.lockUntil || v.lockUntil <= now) loginAttempts.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const key = attemptKey(username, req);
  const rec = loginAttempts.get(key);
  if (rec && rec.lockUntil && Date.now() < rec.lockUntil) {
    return res.status(429).json({ error: `密码错误次数过多，请 ${lockedMinutesLeft(rec)} 分钟后再试` });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, role, phone, store_id, password FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    const cur = loginAttempts.get(key) || { count: 0, lockUntil: 0 };
    cur.count += 1;
    if (cur.count >= LOGIN_MAX_ATTEMPTS) {
      cur.lockUntil = Date.now() + LOGIN_LOCK_MS;
      cur.count = 0;
      loginAttempts.set(key, cur);
      return res.status(429).json({ error: '密码错误次数过多，请 10 分钟后再试' });
    }
    loginAttempts.set(key, cur);
    return res.status(401).json({ error: `用户名或密码错误（还可尝试 ${LOGIN_MAX_ATTEMPTS - cur.count} 次）` });
  }
  // 登录成功清空该来源的失败记录
  loginAttempts.delete(key);

  const token = generateToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      phone: user.phone,
      store_id: user.store_id || null
    }
  });
});

router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, role, phone, store_id FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json(user);
});

router.post('/change-password', authMiddleware, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password) {
    return res.status(400).json({ error: '请输入旧密码和新密码' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }

  const db = getDb();
  const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  if (!(await bcrypt.compare(old_password, user.password))) {
    return res.status(400).json({ error: '旧密码错误' });
  }

  const hash = await bcrypt.hash(new_password, 10);
  db.prepare(`UPDATE users SET password = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(hash, req.user.id);
  res.json({ message: '密码修改成功' });
});

export default router;
