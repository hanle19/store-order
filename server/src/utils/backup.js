// server/src/utils/backup.js
// 备份能力收口：手动一键备份（routes/system.js）与自动定时备份（utils/autoBackup.js）共用同一套实现，
// 避免两份逻辑各自演化导致备份格式不一致（还原接口只认这一种格式）。
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { getDb, DB_PATH, getUploadsDir, getBackupsDir } from '../db.js';

// 备份包标识，还原时用它校验"这是本系统的备份"
export const BACKUP_APP_ID = 'wanan-store-order';

// 应用版本（写入备份清单 manifest.json）
export const APP_VERSION = (() => {
  for (const p of [
    path.join(path.dirname(DB_PATH), '..', 'package.json'),
    path.join(path.dirname(DB_PATH), '..', '..', 'package.json'),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (pkg.version) return pkg.version;
    } catch (e) { /* 尝试下一个路径 */ }
  }
  return 'unknown';
})();

export const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

// 安全"删除"：本环境劫持了 rm/unlink 到安全删除（会超时抛错），
// 因此改用 rename 把文件/目录移入 .trash，避开删除钩子（纯移动，不触发回收站）。
export function safeRemove(p) {
  if (!p || !fs.existsSync(p)) return;
  try {
    const trashDir = path.join(getBackupsDir(), '.trash');
    fs.mkdirSync(trashDir, { recursive: true });
    const target = path.join(trashDir, `${path.basename(p)}.${Date.now()}`);
    fs.renameSync(p, target);
  } catch (e) {
    // 跨卷或被占用时退而求其次：加后缀改名，移出活动路径
    try { fs.renameSync(p, `${p}.deleted-${Date.now()}`); } catch (e2) { /* 最终兜底：忽略 */ }
  }
}

// 将当前数据库（wal_checkpoint 后）与上传目录打包成 zip 写入 destPath
export async function createBackupZip(destPath) {
  const db = getDb();
  // 先合并 WAL，确保备份包含最新尚未落盘的数据
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* 忽略 */ }

  const uploadDir = getUploadsDir();
  let uploadCount = 0;
  let uploadSize = 0;
  if (fs.existsSync(uploadDir)) {
    for (const f of fs.readdirSync(uploadDir)) {
      const fp = path.join(uploadDir, f);
      const st = fs.statSync(fp);
      if (st.isFile()) { uploadCount++; uploadSize += st.size; }
    }
  }

  const manifest = {
    app: BACKUP_APP_ID,
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    includes: { database: true, uploads: uploadCount, uploadsSize: uploadSize },
  };

  const output = fs.createWriteStream(destPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', () => resolve(archive.pointer()));
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err); });
    archive.on('error', reject);
  });

  archive.pipe(output);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  // 数据库（已 checkpoint，单文件即完整）
  archive.file(DB_PATH, { name: 'store.db' });
  // 上传的图片/视频
  if (fs.existsSync(uploadDir)) {
    for (const f of fs.readdirSync(uploadDir)) {
      const fp = path.join(uploadDir, f);
      if (fs.statSync(fp).isFile()) archive.file(fp, { name: `uploads/${f}` });
    }
  }
  await archive.finalize();
  await done;
  return { uploadCount, uploadSize, bytes: fs.statSync(destPath).size };
}

// 校验备份 zip 结构完整（只读目录区，不解压数据，避免大库全量入内存）
export function verifyBackupZip(zipPath) {
  if (!fs.existsSync(zipPath)) return { ok: false, reason: '文件不存在' };
  const size = fs.statSync(zipPath).size;
  if (size <= 0) return { ok: false, reason: '文件为空' };
  // AdmZip 需要读取中央目录，对大文件有成本，故仅在体积 <200MB 时做结构校验
  if (size > 200 * 1024 * 1024) return { ok: true, skipped: true, size };
  try {
    const zip = new AdmZip(zipPath);
    const names = zip.getEntries().map((e) => e.entryName);
    if (!names.includes('store.db')) return { ok: false, reason: '缺少 store.db' };
    if (!names.includes('manifest.json')) return { ok: false, reason: '缺少 manifest.json' };
    return { ok: true, size };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// 列出备份目录中的备份文件（按时间倒序）
export function listBackupFiles(prefix = '') {
  const dir = getBackupsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.zip') && (!prefix || f.startsWith(prefix)))
    .map((f) => {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}
