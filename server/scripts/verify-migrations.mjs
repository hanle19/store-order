// 版本化迁移验证：老库升级 / 幂等重跑 / 数据不丢 / 索引重建 / 全新库跳过
// 用法：node scripts/verify-migrations.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';

const Database = (await import('better-sqlite3')).default;
const { runMigrations, getSchemaVersion, getLatestVersion } = await import('../src/utils/migrations.js');

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// 老版表结构（v1 基线）：CHECK 只允许 6 类
const OLD_SCHEMA = `CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('order','purchase','delivery','payment','inventory','product')),
      target_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator_id INTEGER,
      operator_name TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      old_status TEXT DEFAULT '',
      new_status TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`;

const NEW_SCHEMA = OLD_SCHEMA.replace(
  /CHECK\(target_type IN \([^)]*\)\)/,
  `CHECK(target_type IN ('order','purchase','delivery','payment','inventory','product','product_name','customer','finance','knowledge','coupon','bundle','daily','delivery_person','user','config','other'))`,
);

function makeDb(schema, version = 0, seed = true) {
  const p = path.join(os.tmpdir(), `_mig-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // operation_logs.operator_id 外键引用 users，测试库必须先建该表
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT)`);
  db.exec(schema);
  if (seed) {
    const ins = db.prepare(`INSERT INTO operation_logs (target_type, target_id, action, operator_name, reason, old_status, new_status, details)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (let i = 1; i <= 5; i++) {
      ins.run('order', i, i % 2 ? 'create' : 'cancel', `操作员${i}`, `原因${i}`, '草稿', '已取消', JSON.stringify({ n: i }));
    }
  }
  if (version > 0) db.pragma(`user_version = ${version}`);
  return { db, path: p };
}

function cleanup(p) {
  try { fs.unlinkSync(p); } catch (e) { /* ignore */ }
  for (const s of ['-wal', '-shm']) { try { fs.unlinkSync(p + s); } catch (e) { /* ignore */ } }
}

const idxNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='operation_logs'").all().map(r => r.name).sort();

try {
  console.log('\n[迁移] 1. 老库（user_version=0，旧 CHECK）升级到 v2');
  const old = makeDb(OLD_SCHEMA, 0);
  const beforeRows = old.db.prepare('SELECT * FROM operation_logs ORDER BY id').all();
  check('起始版本为 0', getSchemaVersion(old.db) === 0, String(getSchemaVersion(old.db)));

  const r1 = runMigrations(old.db);
  check('迁移已执行', r1.applied.length === 1 && r1.applied[0].version === 2, JSON.stringify(r1.applied.map(a => a.version)));
  check('版本升到 v2', getSchemaVersion(old.db) === 2, String(getSchemaVersion(old.db)));
  check('版本达到最新', getSchemaVersion(old.db) === getLatestVersion(), `${getSchemaVersion(old.db)} vs ${getLatestVersion()}`);

  const sql = old.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='operation_logs'").get().sql;
  check('CHECK 已含 other', /'other'/.test(sql));
  check('CHECK 已含 customer', /'customer'/.test(sql));
  check('CHECK 仍是约束（不是被删掉）', /CHECK\s*\(\s*target_type\s+IN/.test(sql));
  check('AUTOINCREMENT 保留', /AUTOINCREMENT/.test(sql));

  const afterRows = old.db.prepare('SELECT * FROM operation_logs ORDER BY id').all();
  check('数据条数不变', afterRows.length === beforeRows.length, `${beforeRows.length} → ${afterRows.length}`);
  check('数据内容完全一致', JSON.stringify(afterRows) === JSON.stringify(beforeRows));
  check('id 未被重置', afterRows[0]?.id === beforeRows[0]?.id && afterRows[4]?.id === 5, `首 id=${afterRows[0]?.id}`);

  const idx = idxNames(old.db);
  check('3 个索引已重建', idx.length === 3, idx.join(','));
  check('target 索引存在', idx.includes('idx_operation_logs_target'));
  check('operator 索引存在', idx.includes('idx_operation_logs_operator'));
  check('time 索引存在', idx.includes('idx_operation_logs_time'));

  console.log('\n[迁移] 2. 新约束真的生效（写入 customer 应成功、写入非法值应失败）');
  let okNew = false;
  try {
    old.db.prepare(`INSERT INTO operation_logs (target_type, target_id, action) VALUES ('customer', 99, 'delete')`).run();
    okNew = true;
  } catch (e) { /* 预期成功 */ }
  check('可写入 customer 类型', okNew);
  let rejected = false;
  try {
    old.db.prepare(`INSERT INTO operation_logs (target_type, target_id, action) VALUES ('not_a_valid_type', 1, 'x')`).run();
  } catch (e) { rejected = true; }
  check('非法 target_type 仍被拒绝（CHECK 未被削弱）', rejected);

  console.log('\n[迁移] 3. 重复执行应幂等（不重复跑、数据不翻倍）');
  const cntBefore = old.db.prepare('SELECT COUNT(*) c FROM operation_logs').get().c;
  const r2 = runMigrations(old.db);
  check('第二次执行无待办迁移', r2.applied.length === 0, JSON.stringify(r2.applied));
  const cntAfter = old.db.prepare('SELECT COUNT(*) c FROM operation_logs').get().c;
  check('数据未翻倍', cntAfter === cntBefore, `${cntBefore} → ${cntAfter}`);
  check('版本仍为 v2', getSchemaVersion(old.db) === 2, String(getSchemaVersion(old.db)));

  // 模拟"重启后再跑一次完整 initDb 流程"：版本已是 v2，重建判定应跳过
  console.log('\n[迁移] 4. 全新库（建表即最新结构）应跳过重建');
  const fresh = makeDb(NEW_SCHEMA, 0);
  const freshBefore = fresh.db.prepare('SELECT COUNT(*) c FROM operation_logs').get().c;
  const r3 = runMigrations(fresh.db);
  check('迁移被标记执行', r3.applied.length === 1, JSON.stringify(r3.applied.map(a => a.version)));
  check('但识别为已生效、未真正重建', r3.applied[0]?.changed === false, String(r3.applied[0]?.changed));
  const freshAfter = fresh.db.prepare('SELECT COUNT(*) c FROM operation_logs').get().c;
  check('数据未丢失', freshAfter === freshBefore, `${freshBefore} → ${freshAfter}`);
  check('版本升到 v2', getSchemaVersion(fresh.db) === 2, String(getSchemaVersion(fresh.db)));

  console.log('\n[迁移] 5. AUTOINCREMENT 序列（重建后继续插入不撞 id）');
  const maxId = old.db.prepare('SELECT MAX(id) m FROM operation_logs').get().m;
  old.db.prepare(`INSERT INTO operation_logs (target_type, target_id, action) VALUES ('order', 777, 'reopen')`).run();
  const newId = old.db.prepare("SELECT id FROM operation_logs WHERE action='reopen' AND target_id=777").get().id;
  check('新 id 大于重建前最大 id', newId > maxId, `max=${maxId} → new=${newId}`);

  cleanup(old.path);
  cleanup(fresh.path);
} catch (e) {
  fail++;
  failures.push(`异常：${e.message}`);
  console.error('  ❌ 运行异常:', e.message, '\n', e.stack?.split('\n').slice(0, 4).join('\n'));
}

console.log(`\n${'='.repeat(48)}`);
console.log(`版本化迁移：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：', failures.join(' | ')); process.exit(1); }
process.exit(0);
