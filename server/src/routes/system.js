// server/src/routes/system.js
// 系统级维护接口（仅管理员）：
//   POST /api/system/reset   一键恢复出厂设置（清空前自动备份数据库到磁盘）
//   POST /api/system/backup  一键备份（打包数据库 + 全部上传图片/视频为 zip 下载）
//   POST /api/system/restore 一键恢复（上传备份 zip，原子还原数据库与上传目录，恢复前自动预备份）
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { getDb, closeDb, resetToFactory, DB_PATH, getUploadsDir, getBackupsDir } from '../db.js';
import { authMiddleware, roleMiddleware } from '../middleware/auth.js';
import * as aggCache from '../utils/aggCache.js';
import { createBackupZip, safeRemove, ts, listBackupFiles, verifyBackupZip } from '../utils/backup.js';
import { runAutoBackupNow, getAutoBackupStatus } from '../utils/autoBackup.js';
import { readLogLines, getLogDir, getLogKeepDays } from '../middleware/requestLog.js';

const router = Router();
router.use(authMiddleware);
router.use(roleMiddleware('admin'));

// ============ 一键备份（下载 zip） ============
router.post('/backup', async (req, res) => {
  try {
    const backupsDir = getBackupsDir();
    fs.mkdirSync(backupsDir, { recursive: true });
    const tmpZip = path.join(backupsDir, `backup-${ts()}.zip`);
    await createBackupZip(tmpZip);
    const fname = `wanan-backup-${ts()}.zip`;
    res.download(tmpZip, fname, (err) => {
      // 下载完成后清理临时文件（用安全移动，避开删除钩子）
      safeRemove(tmpZip);
      if (err && !res.headersSent) {
        console.error('[backup] 发送失败:', err);
      }
    });
  } catch (e) {
    console.error('[backup] 生成失败:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// ============ 一键恢复（上传 zip 还原） ============
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const d = path.join(getBackupsDir(), 'restore-tmp');
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}.zip`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 最大 1GB
  fileFilter: (req, file, cb) => {
    if (/\.zip$/i.test(file.originalname)) cb(null, true);
    else cb(new Error('仅支持 .zip 备份文件'));
  },
});

router.post('/restore', restoreUpload.single('backup'), async (req, res) => {
  const tmpZip = req.file?.path;
  try {
    if (!tmpZip) {
      return res.status(400).json({ success: false, error: '请上传备份文件(.zip)' });
    }

    // 1) 校验备份文件
    const zip = new AdmZip(tmpZip);
    const entries = zip.getEntries();
    const dbEntry = entries.find((e) => e.entryName === 'store.db');
    const manifestEntry = entries.find((e) => e.entryName === 'manifest.json');
    let manifest = null;
    if (manifestEntry) {
      try { manifest = JSON.parse(manifestEntry.getData().toString('utf8')); } catch (e) { /* 忽略 */ }
    }
    if (!dbEntry) {
      return res.status(400).json({ success: false, error: '备份文件缺少 store.db，不是有效的系统备份' });
    }
    if (!manifest || manifest.app !== 'wanan-store-order') {
      return res.status(400).json({ success: false, error: '备份文件标识无效，可能不是本系统的备份' });
    }

    const db = getDb();
    const dbPath = db.name || DB_PATH;
    const uploadDir = getUploadsDir();

    // 2) 恢复前自动备份当前数据（保险）
    const prePath = path.join(getBackupsDir(), `pre-restore-${ts()}.zip`);
    await createBackupZip(prePath);

    // 3) 关闭数据库连接，准备替换文件
    closeDb();
    // 数据库即将被整体替换，聚合缓存里的旧结果必须丢弃（否则会短暂返回还原前的数据）
    aggCache.clear();

    // 4) 解包到临时位置
    const dbTmp = `${dbPath}.restore-tmp`;
    const upTmp = `${uploadDir}.restore-tmp`;
    safeRemove(dbTmp);
    safeRemove(upTmp);
    fs.writeFileSync(dbTmp, dbEntry.getData());
    fs.mkdirSync(upTmp, { recursive: true });
    for (const e of entries) {
      if (e.isDirectory) continue; // adm-zip 0.5.x: isDirectory 是布尔属性
      if (e.entryName.startsWith('uploads/')) {
        const raw = e.entryName.slice('uploads/'.length);
        if (!raw) continue;
        // 防 zip-slip：规范化路径，拒绝绝对路径/盘符与任何逃出目标目录的条目
        const rel = path.normalize(raw).replace(/^([/\\]|\.\.[/\\])+/, '');
        if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) continue;
        const out = path.join(upTmp, rel);
        const outResolved = path.resolve(out);
        const upResolved = path.resolve(upTmp);
        if (outResolved !== upResolved && !outResolved.startsWith(upResolved + path.sep)) continue;
        fs.mkdirSync(path.dirname(outResolved), { recursive: true });
        fs.writeFileSync(outResolved, e.getData());
      }
    }

    // 5) 校验恢复出的数据库可正常打开
    let test = null;
    try {
      const Database = (await import('better-sqlite3')).default;
      test = new Database(dbTmp, { readonly: true });
      const r = test.prepare('PRAGMA integrity_check').get();
      if (r && r.integrity_check && r.integrity_check !== 'ok') {
        throw new Error(`数据库完整性校验未通过: ${r.integrity_check}`);
      }
      const cnt = test.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'").get().c;
      if (cnt < 5) throw new Error('恢复出的数据库表过少，可能已损坏');
    } finally {
      if (test) { try { test.close(); } catch (e) { /* 忽略 */ } }
    }

    // 6) 原子替换（先移除旧的 WAL/SHM，再 rename 主库与上传目录）
    const dbOld = `${dbPath}.pre`;
    const upOld = `${uploadDir}.pre`;
    safeRemove(dbOld);
    safeRemove(upOld);
    safeRemove(`${dbPath}-wal`);
    safeRemove(`${dbPath}-shm`);
    fs.renameSync(dbPath, dbOld);
    fs.renameSync(dbTmp, dbPath);
    if (fs.existsSync(uploadDir)) fs.renameSync(uploadDir, upOld);
    fs.renameSync(upTmp, uploadDir);
    // 把被替换掉的旧文件移出活动路径（不删除，避开安全删除钩子）
    safeRemove(dbOld);
    safeRemove(upOld);

    // 7) 重新打开数据库
    getDb();

    // 8) 清理上传的临时 zip（安全移动）
    safeRemove(tmpZip);

    res.json({
      success: true,
      preRestorePath: prePath,
      message: '数据已成功恢复，恢复前的系统数据已自动备份，请重新登录以载入新数据。',
    });
  } catch (e) {
    console.error('[restore] 失败:', e);
    if (tmpZip) safeRemove(tmpZip);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
});

// ============ 自动备份管理 ============
// GET /api/system/auto-backup/status — 查看自动备份开关、保留策略与最近一次结果
router.get('/auto-backup/status', (req, res) => {
  try {
    res.json({ success: true, ...getAutoBackupStatus() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/system/auto-backup/run — 立即执行一次自动备份（不影响后续定时计划）
router.post('/auto-backup/run', async (req, res) => {
  try {
    const r = await runAutoBackupNow('manual');
    res.json({ success: r.ok, ...r });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/system/backups — 列出备份目录中的备份文件（自动 + 手动预备份）
router.get('/backups', (req, res) => {
  try {
    const files = listBackupFiles();
    res.json({ success: true, total: files.length, data: files, dir: getBackupsDir() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/system/logs — 在线查看请求/错误日志（仅管理员），免登服务器即可排障
//   参数：type=access|error（默认 access）、date=YYYY-MM-DD（默认今天）、lines=1..1000（默认 200）
router.get('/logs', (req, res) => {
  try {
    const { type = 'access', date, lines } = req.query;
    const result = readLogLines(type === 'error' ? 'error' : 'access', date, lines);
    res.json({ success: true, type: type === 'error' ? 'error' : 'access', dir: getLogDir(), keepDays: getLogKeepDays(), ...result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============ 一键恢复出厂设置 ============
router.post('/reset', (req, res) => {
  try {
    const db = getDb();
    const dbFile = db.name || DB_PATH;

    // 1) 合并 WAL，确保备份包含最新尚未落盘的数据
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (e) { /* 忽略 */ }

    // 2) 自动备份当前数据库到 data/backups/
    const backupDir = getBackupsDir();
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `reset-backup-${ts()}.db`);
    fs.copyFileSync(dbFile, backupFile);

    // 3) 执行重置（清空业务数据 + 重置配置 + 仅保留默认 admin）
    resetToFactory(db);
    // 业务数据已清空，聚合缓存必须丢弃
    aggCache.clear();

    res.json({
      success: true,
      backupPath: backupFile,
      message: '系统已恢复出厂设置，仅保留默认管理员 admin/admin123。重置前数据库已自动备份。',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

export default router;
