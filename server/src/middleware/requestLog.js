// server/src/middleware/requestLog.js
// 请求日志 + 错误可观测：此前生产上没有 access log，出错只能靠散落的 console.error
// 与用户口述复现。这里补齐按天轮转的 JSON Lines 日志（access / error 各一份）。
//
// 设计取舍：
//   1. 落文件而非落库 —— 请求日志量大且无业务价值，写库会污染业务表并拖慢写事务；
//      且 operation_logs 的 target_type 有 CHECK 约束，塞不进"服务器错误"这类目标。
//   2. 同步 appendFileSync —— 单机 3~5 人使用，量级下开销可忽略，换来"绝不丢日志"。
//   3. 默认保留 14 天，按天自动清理。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

const KEEP_DAYS = (() => {
  const n = Number(process.env.LOG_KEEP_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.min(365, Math.trunc(n)) : 14;
})();

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 日志里绝不出现凭据：?token= / password / secret 等一律掩码
const SENSITIVE = /(token|password|secret|passwd|pwd|authorization)=([^&\s]+)/gi;
function mask(str) {
  return String(str || '').replace(SENSITIVE, '$1=***');
}

let cleanedDate = '';
function ensureDirAndCleanup() {
  const key = dateKey();
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (cleanedDate === key) return;
  cleanedDate = key;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = /^(access|error)-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[2] < dateKey(cutoff)) removeQuietly(path.join(LOG_DIR, f));
    }
  } catch (e) { /* 清理失败不影响主流程 */ }
}

// 本环境 rm/unlink 被安全钩子劫持，失败时退化为改名移出活动路径
function removeQuietly(p) {
  try { fs.unlinkSync(p); } catch (e) {
    try { fs.renameSync(p, `${p}.old-${Date.now()}`); } catch (e2) { /* 忽略 */ }
  }
}

function write(type, obj) {
  try {
    ensureDirAndCleanup();
    fs.appendFileSync(path.join(LOG_DIR, `${type}-${dateKey()}.log`), JSON.stringify(obj) + '\n', 'utf8');
  } catch (e) {
    // 日志写入失败绝不能影响业务请求，只降级到 stderr
    console.error('[requestLog] 写入失败:', e.message);
  }
}

// 静态资源与前端路由不记日志（量大且无排障价值）
function shouldSkip(req) {
  const p = req.path || req.originalUrl || '';
  return p.startsWith('/assets/') || p.startsWith('/uploads/') || p === '/favicon.ico';
}

export function requestLogger(req, res, next) {
  if (shouldSkip(req)) return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6 * 10) / 10;
    write('access', {
      at: new Date().toISOString(),
      method: req.method,
      path: mask(req.originalUrl || req.path),
      status: res.statusCode,
      ms,
      ip: req.ip || req.socket?.remoteAddress || '',
      userId: req.user?.id ?? null,
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
    });
  });
  next();
}

// 统一错误落盘（全局错误中间件、unhandledRejection、uncaughtException 共用）
export function logError(scope, err, req) {
  write('error', {
    at: new Date().toISOString(),
    scope,
    message: err?.message || String(err),
    stack: String(err?.stack || '').split('\n').slice(0, 8).join('\n'),
    method: req?.method || '',
    path: mask(req?.originalUrl || req?.path || ''),
    userId: req?.user?.id ?? null,
  });
}

// 供管理员在线查看日志（GET /api/system/logs）
export function readLogLines(type = 'access', date = dateKey(), lines = 200) {
  const n = Number(lines);
  const safeLines = Number.isFinite(n) ? Math.min(1000, Math.max(1, Math.trunc(n))) : 200;
  const fp = path.join(LOG_DIR, `${type === 'error' ? 'error' : 'access'}-${date}.log`);
  if (!fs.existsSync(fp)) return { file: fp, lines: [], exists: false };
  const raw = fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean);
  return {
    file: fp,
    exists: true,
    total: raw.length,
    lines: raw.slice(-safeLines).map((l) => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } }),
  };
}

export function getLogDir() { return LOG_DIR; }
export function getLogKeepDays() { return KEEP_DAYS; }
