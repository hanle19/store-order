// server/src/utils/autoBackup.js
// 自动定时备份：系统当前唯一「不可恢复级风险」是没有任何自动备份（server/backups 长期为空），
// 本模块补齐「启动补备 + 每日定时 + 保留 N 份 + 备份后校验」四件事。
//
// 环境变量（均可选）：
//   AUTO_BACKUP=off        关闭自动备份
//   AUTO_BACKUP_HOUR=3     每天在该小时后首次检查时执行（0-23，默认 3 点）
//   AUTO_BACKUP_KEEP=30    最多保留的自动备份份数（默认 30）
import fs from 'fs';
import path from 'path';
import { createBackupZip, safeRemove, listBackupFiles, verifyBackupZip } from './backup.js';
import { getBackupsDir } from '../db.js';

export const AUTO_PREFIX = 'auto-';

let timer = null;
let running = false;
let lastResult = null;

const pad = (n) => String(n).padStart(2, '0');

// 本地日期 YYYY-MM-DD（与文件名一致，避免 UTC/本地跨日导致"今日是否已备"误判）
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localStamp(d = new Date()) {
  return `${todayKey(d)}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function cfg() {
  return {
    enabled: process.env.AUTO_BACKUP !== 'off',
    hour: clampInt(process.env.AUTO_BACKUP_HOUR, 3, 0, 23),
    keep: clampInt(process.env.AUTO_BACKUP_KEEP, 30, 1, 365),
  };
}

// 删除超出保留份数的旧备份（用 safeRemove 移入 .trash，避开删除钩子）
function prune(keep) {
  const files = listBackupFiles(AUTO_PREFIX); // 已按名字倒序（名字含日期时间，等价于时间倒序）
  const removed = [];
  for (const f of files.slice(keep)) {
    safeRemove(path.join(getBackupsDir(), f.name));
    removed.push(f.name);
  }
  return removed;
}

// 立即执行一次自动备份（手动触发与定时触发共用）
export async function runAutoBackupNow(reason = 'manual') {
  if (running) return { ok: false, skipped: true, reason: '上次备份尚未结束' };
  running = true;
  const dir = getBackupsDir();
  let dest = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const name = `${AUTO_PREFIX}${localStamp()}.zip`;
    dest = path.join(dir, name);
    const info = await createBackupZip(dest);

    // 备份后校验：结构不完整就作废，避免留下"看起来有备份、实际不可用"的文件
    const v = verifyBackupZip(dest);
    if (!v.ok) {
      safeRemove(dest);
      throw new Error(`备份校验未通过：${v.reason}`);
    }

    const removed = prune(cfg().keep);
    lastResult = {
      ok: true, file: name, path: dest, size: info.bytes,
      uploads: info.uploadCount, at: new Date().toISOString(), reason, removed,
    };
    console.log(`[自动备份] 完成 ${name}（${(info.bytes / 1024).toFixed(0)} KB，含 ${info.uploadCount} 个附件）`);
    return lastResult;
  } catch (e) {
    lastResult = { ok: false, error: e.message, at: new Date().toISOString(), reason };
    console.error('[自动备份] 失败:', e.message);
    if (dest) safeRemove(dest);
    return lastResult;
  } finally {
    running = false;
  }
}

// 启动定时备份。用"每 30 分钟检查一次 + 当日已备则跳过"代替 cron：
// 无第三方依赖、跨天自动生效、进程重启也不会漏备（重启后会补备）。
export function startAutoBackup() {
  const { enabled, hour, keep } = cfg();
  if (!enabled) {
    console.log('[自动备份] 已关闭（AUTO_BACKUP=off）');
    return null;
  }

  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== hour) return;
    if (listBackupFiles(AUTO_PREFIX).some((f) => f.name.startsWith(`${AUTO_PREFIX}${todayKey(now)}`))) return;
    await runAutoBackupNow('scheduled');
  };

  // 启动 20 秒后先检查一次：若今日尚无备份则立即补备（覆盖"只在白天开机"的场景）
  const bootTimer = setTimeout(tick, 20 * 1000);
  bootTimer.unref?.();
  timer = setInterval(tick, 30 * 60 * 1000);
  timer.unref?.();

  console.log(`[自动备份] 已启用：每天 ${pad(hour)}:00 后执行，最多保留 ${keep} 份`);
  return timer;
}

export function stopAutoBackup() {
  if (timer) { clearInterval(timer); timer = null; }
}

export function getAutoBackupStatus() {
  const { enabled, hour, keep } = cfg();
  const files = listBackupFiles(AUTO_PREFIX);
  return {
    enabled, hour, keep,
    count: files.length,
    latest: files[0] || null,
    lastResult,
    dir: getBackupsDir(),
  };
}
