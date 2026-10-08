// server/src/utils/migrations.js
// 版本化 schema 迁移（PRAGMA user_version）
//
// 为什么需要它：initDb 靠 `CREATE TABLE IF NOT EXISTS` + `addColumn()` 幂等补列，
// 这套写法只能"加列"，做不了三类事：
//   1. 改约束（如 operation_logs.target_type 的 CHECK 允许值）
//   2. 重建表（SQLite 改列类型/约束的唯一办法）
//   3. 数据订正（把历史脏数据按新规则刷一遍）
// 而且没有版本号时，出问题只能靠猜"这个库到底跑到哪一步了"。
//
// 设计取舍：
//   1. **不替换 initDb**：initDb 继续负责建最新结构与补列兜底；迁移层只做它做不到的事。两者互补。
//   2. **每个迁移必须自检幂等**：全新库建表时结构已是最新的，仍会走一遍迁移，
//      所以迁移开头要先判断"是否已生效"，是则 return false 跳过。
//   3. **失败即中止启动**：迁移失败会 ROLLBACK 并抛错，绝不允许"半新半旧"的结构继续跑。
//   4. **老库基线**：user_version=0 的老库先置为 BASELINE_VERSION，再执行更高版本迁移。
//
// 新增迁移的正确姿势：
//   在 MIGRATIONS 里追加 { version: 当前最大+1, name, up(db) }，不要修改已发布的迁移。

export const BASELINE_VERSION = 1;

// 标准 12 步重建表（SQLite 官方推荐做法）。
// 注意点：
//   - foreign_keys 必须在事务**外**开关（事务内该 pragma 是 no-op），否则 DROP TABLE 会触发外键级联。
//   - DROP TABLE 会连带删掉该表的索引与 sqlite_sequence 行，故 afterSql 必须重建索引、afterSql 之后补 sequence。
//   - 采用 INSERT INTO ... SELECT 保 id，避免 id 变化破坏外部引用。
export function rebuildTable(db, { table, newSchemaSql, columns, afterSql = '' }) {
  const tmp = `${table}__mig_tmp`;
  const fkOn = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  if (fkOn) db.pragma('foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(`DROP TABLE IF EXISTS ${tmp}`);
    db.exec(newSchemaSql);
    db.exec(`INSERT INTO ${tmp} (${columns}) SELECT ${columns} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
    if (afterSql) db.exec(afterSql);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (e2) { /* 已回滚则忽略 */ }
    throw new Error(`重建表 ${table} 失败：${e.message}`);
  } finally {
    if (fkOn) db.pragma('foreign_keys = ON');
  }
}

// AUTOINCREMENT 表重建后 sqlite_sequence 行会丢失，需按当前最大 id 补回，否则新插入可能撞 id
export function restoreAutoIncrementSeq(db, table) {
  try {
    db.exec(`
      INSERT INTO sqlite_sequence (name, seq)
      SELECT '${table}', COALESCE(MAX(id), 0) FROM ${table}
      WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = '${table}');
      UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM ${table}) WHERE name = '${table}';
    `);
  } catch (e) {
    // 非 AUTOINCREMENT 表没有 sqlite_sequence 记录，忽略即可
  }
}

const MIGRATIONS = [
  {
    version: 2,
    name: 'operation_logs 扩展 target_type 允许值（审计覆盖到客户/用户/财务等实体）',
    up(db) {
      const meta = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='operation_logs'").get();
      if (!meta) return false;
      // 幂等自检：新版 CHECK 含 'other'，已存在则无需重建
      if (/'other'/.test(meta.sql)) return false;

      rebuildTable(db, {
        table: 'operation_logs',
        columns: 'id, target_type, target_id, action, operator_id, operator_name, reason, old_status, new_status, details, created_at',
        newSchemaSql: `CREATE TABLE operation_logs__mig_tmp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN (
        'order','purchase','delivery','payment','inventory','product','product_name',
        'customer','finance','knowledge','coupon','bundle','daily',
        'delivery_person','user','config','other'
      )),
      target_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator_id INTEGER REFERENCES users(id),
      operator_name TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      old_status TEXT DEFAULT '',
      new_status TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`,
        afterSql: `
      CREATE INDEX idx_operation_logs_target ON operation_logs(target_type, target_id);
      CREATE INDEX idx_operation_logs_operator ON operation_logs(operator_id);
      CREATE INDEX idx_operation_logs_time ON operation_logs(created_at);
    `,
      });
      restoreAutoIncrementSeq(db, 'operation_logs');
      return true;
    },
  },
];

export function getSchemaVersion(db) {
  return Number(db.pragma('user_version', { simple: true })) || 0;
}

export function getLatestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : BASELINE_VERSION;
}

// 执行待办迁移。返回 { from, to, applied: [{version,name}] }
export function runMigrations(db) {
  let current = getSchemaVersion(db);
  const from = current;

  // 老库（从未设过版本号）→ 先落到基线；其结构已由 initDb 保证为"当时的最新"
  if (current < BASELINE_VERSION) {
    db.pragma(`user_version = ${BASELINE_VERSION}`);
    current = BASELINE_VERSION;
  }

  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  const applied = [];

  for (const m of pending) {
    let changed = false;
    try {
      changed = m.up(db);
    } catch (e) {
      // 迁移失败 = 结构未知，直接中止启动，避免带着半新半旧的结构继续跑
      console.error(`[DB] 迁移 v${m.version} 失败，已回滚：${e.message}`);
      throw e;
    }
    db.pragma(`user_version = ${m.version}`);
    applied.push({ version: m.version, name: m.name, changed: changed !== false });
    console.log(`[DB] 迁移 v${m.version} 完成${changed === false ? '（已生效，跳过）' : ''}：${m.name}`);
  }

  if (applied.length) {
    console.log(`[DB] schema 版本：v${from} → v${getSchemaVersion(db)}`);
  }
  return { from, to: getSchemaVersion(db), applied };
}
