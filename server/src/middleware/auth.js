import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 密钥持久化文件：server/.jwt_secret（首次运行自动生成，已加入 .gitignore）
const SECRET_FILE = path.join(__dirname, '..', '..', '.jwt_secret');

function loadJwtSecret() {
  // 1) 生产/部署优先使用环境变量（最安全，建议在飞牛 NAS 的 docker-compose 中显式配置 JWT_SECRET）
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim()) {
    return process.env.JWT_SECRET.trim();
  }
  // 2) 读取首次运行时持久化的随机密钥，避免进程重启后所有用户被强制登出
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved) return saved;
    }
  } catch (e) {
    // 读取失败则走下面的生成逻辑
  }
  // 3) 未配置且无持久化文件：生成高强度随机密钥并落盘（权限 600），
  //    彻底移除源码中硬编码的公开默认值，避免 token 被伪造
  const generated = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
    console.warn('[auth] 未检测到 JWT_SECRET，已自动生成随机密钥并保存到 server/.jwt_secret。'
      + '建议在生产环境通过 JWT_SECRET 环境变量显式指定，并将其纳入备份。');
  } catch (e) {
    console.warn('[auth] 无法写入密钥文件，本次将使用临时随机密钥（进程重启后失效）。请检查 server 目录写权限或配置 JWT_SECRET 环境变量。');
    return generated;
  }
  return generated;
}

const JWT_SECRET = loadJwtSecret();

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name, store_id: user.store_id || null },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export function authMiddleware(req, res, next) {
  // 支持 Bearer token（Header）。token 查询参数仅允许用于只读 GET 请求
  // （合同 / 送货单等新窗口打印场景无法设置 Header），变更类接口一律要求 Header，
  // 避免 token 经 URL 泄露到浏览器历史 / 服务器日志 / Referer 后被滥用。
  const header = req.headers.authorization;
  let token = null;

  if (header && header.startsWith('Bearer ')) {
    token = header.split(' ')[1];
  } else if (req.method === 'GET' && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: '请先登录' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

export function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '没有权限执行此操作' });
    }
    next();
  };
}
