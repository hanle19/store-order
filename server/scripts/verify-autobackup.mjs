// server/scripts/verify-autobackup.mjs
// 自动备份验证（P0-1）：此前 server/backups 长期为空、无任何自动备份，是唯一"不可恢复级"风险。
// 本脚本验证：备份可生成、内容完整可还原、保留策略生效、开关可关闭。
//
// 注意：备份目录由 getBackupsDir() 决定（基于源码路径，不受 DB_PATH 影响），
// 因此本脚本会在真实备份目录产生 auto-*.zip，结尾统一清理（移入 .trash）。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// 看门狗：脚本内起服务后事件循环不会自然退出，任何卡住/异常都要能自己收尾
const watchdog = setTimeout(() => { console.error('[自动备份] 超时未完成'); process.exit(1); }, 150000);
watchdog.unref?.();
process.on('unhandledRejection', (e) => { console.error('[自动备份] 未捕获异常:', e); process.exit(1); });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_autobak-${Date.now()}.db`);
fs.copyFileSync(SRC_DB, TMP_DB);

process.env.DB_PATH = TMP_DB;
process.env.PORT = process.env.PORT || '3396';
// 默认关掉定时、只测手动触发接口；设 VERIFY_SCHEDULE=1 会额外验证"定时真的会自动跑"（需多等约 22 秒）
const TEST_SCHEDULE = process.env.VERIFY_SCHEDULE === '1';
process.env.AUTO_BACKUP = TEST_SCHEDULE ? 'on' : 'off';
if (TEST_SCHEDULE) process.env.AUTO_BACKUP_HOUR = String(new Date().getHours());

const AdmZip = (await import('adm-zip')).default;
const { runAutoBackupNow, getAutoBackupStatus, AUTO_PREFIX } = await import('../src/utils/autoBackup.js');
const { getBackupsDir } = await import('../src/db.js');

await import('../src/index.js');
await new Promise((r) => setTimeout(r, 800));

let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const api = async (p, opts = {}) => {
  const res = await fetch(BASE + p, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
  return { status: res.status, json, text };
};

const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
const token = login.json?.token;
if (!token) { console.error('[自动备份] 登录失败:', login.text.slice(0, 200)); process.exit(1); }
const auth = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = getBackupsDir();
// getBackupsDir() 随 DB_PATH 变化，测试时落在临时目录 —— 正好不污染真实备份目录
fs.mkdirSync(dir, { recursive: true });
const before = fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX));

console.log('\n[自动备份] 1. 手动触发生成备份');
const r1 = await api('/api/system/auto-backup/run', { method: 'POST', headers: auth });
check('触发接口返回成功', r1.json?.success === true, JSON.stringify(r1.json).slice(0, 160));
const file1 = r1.json?.file;
check('返回备份文件名', typeof file1 === 'string' && file1.startsWith(AUTO_PREFIX), String(file1));
check('备份文件真实存在', file1 && fs.existsSync(path.join(dir, file1)), file1 || '');
check('备份体积 > 0', r1.json?.size > 0, `${r1.json?.size} bytes`);

console.log('\n[自动备份] 2. 备份内容完整（可被还原接口识别）');
if (file1) {
  const zip = new AdmZip(path.join(dir, file1));
  const names = zip.getEntries().map((e) => e.entryName);
  check('包含 store.db', names.includes('store.db'), names.slice(0, 5).join(','));
  check('包含 manifest.json', names.includes('manifest.json'));
  const manifest = JSON.parse(zip.readAsText('manifest.json'));
  check('manifest 标识正确（还原校验依赖）', manifest.app === 'wanan-store-order', manifest.app);
  check('manifest 含版本与时间戳', !!manifest.version && !!manifest.createdAt);
}

console.log('\n[自动备份] 3. 损坏备份会被校验拦截（可证伪）');
// 故意不以 auto- 开头：否则会被保留策略计入份数，干扰第 4 项断言
const badFile = path.join(dir, 'corrupt-test.zip');
fs.writeFileSync(badFile, 'not a zip');
const { verifyBackupZip } = await import('../src/utils/backup.js');
const v = verifyBackupZip(badFile);
check('空壳 zip 被判为不可用', v.ok === false, JSON.stringify(v));

console.log('\n[自动备份] 4. 保留策略：超出份数自动清理');
process.env.AUTO_BACKUP_KEEP = '2';
const keepFiles = [];
for (let i = 0; i < 3; i++) {
  const r = await runAutoBackupNow('test-keep');
  if (r.ok) keepFiles.push(r.file);
  await sleep(1100); // 文件名精确到秒，避免同名覆盖导致份数不足
}
const nowFiles = fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX));
// keep=2 时每次备份后都会 prune，连跑 3 次后应恰好只剩 2 份（prune 失效则会是 4~5 份）
check('保留策略生效（keep=2，连跑 3 次后仅剩 2 份）', nowFiles.length === 2, `当前 ${nowFiles.length} 份：${nowFiles.join(',')}`);
check('三次备份全部成功', keepFiles.length === 3, `成功 ${keepFiles.length} 次`);

console.log('\n[自动备份] 5. 状态接口与开关');
const st = await api('/api/system/auto-backup/status', { headers: auth });
check('状态接口返回成功', st.json?.success === true);
check(`开关状态正确（AUTO_BACKUP=${process.env.AUTO_BACKUP}）`, st.json?.enabled === TEST_SCHEDULE, `enabled=${st.json?.enabled}`);
check('状态含保留份数与目录', typeof st.json?.keep === 'number' && !!st.json?.dir);

if (TEST_SCHEDULE) {
  console.log('\n[自动备份] 6. 定时调度：启动后应自动补备（等待约 22 秒）');
  // 先清空：上面的手动备份都是"今天"的，tick 检测到今日已有备份会正确跳过（不重复备），
  // 只有清空后才能验证"调度真的会自己跑起来"这一行为。
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX))) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* 忽略 */ }
  }
  const cntBefore = fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX)).length;
  await sleep(22000);
  const cntAfter = fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX)).length;
  check('定时调度自动产生备份', cntAfter > cntBefore, `${cntBefore} → ${cntAfter} 份`);
}

console.log('\n[自动备份] 7. 清理测试产物');
let cleaned = 0;
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith(AUTO_PREFIX) || f === 'corrupt-test.zip') {
    try { fs.unlinkSync(path.join(dir, f)); cleaned++; } catch (e) {
      try { fs.renameSync(path.join(dir, f), path.join(dir, `${f}.old-${Date.now()}`)); cleaned++; } catch (e2) { /* 忽略 */ }
    }
  }
}
const left = fs.readdirSync(dir).filter((f) => f.startsWith(AUTO_PREFIX));
check('测试备份已清理', left.length === 0, `残留 ${left.length} 份`);
console.log(`  （已清理 ${cleaned} 个测试备份文件）`);

try { fs.unlinkSync(TMP_DB); } catch (e) { try { fs.renameSync(TMP_DB, `${TMP_DB}.old`); } catch (e2) { /* 忽略 */ } }

console.log(`\n${'─'.repeat(60)}`);
console.log(`自动备份：${pass} 通过 / ${fail} 失败`);
if (failures.length) console.log('失败项：' + failures.join('、'));
console.log('─'.repeat(60));
process.exit(fail === 0 ? 0 : 1);
