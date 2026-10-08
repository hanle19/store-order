/**
 * 校正 inventory_logs 中因方向判定写反而记错的 type 字段
 *
 * 背景：server/src/stock.js:92 adjustVariantStock 原逻辑为 (qty < 0 ? 'in' : 'out')，
 *       与 :54 adjustStock 的 (qty < 0 ? 'out' : 'in') 相反。凡调用方未显式传 type
 *       的记录（aftersales.js 六处），type 与 change_amount 符号相反。
 *
 * 正确语义：change_amount > 0 => 'in'（入库）；change_amount < 0 => 'out'（出库）
 * 命中条件：variant_id > 0（走 adjustVariantStock）且 type ∈ ('in','out') 且方向与符号相反
 *
 * 安全：默认 dry-run 只读；加 --apply 才写库，且写前自动备份（db.backup，WAL 安全）
 *
 * 用法：cd server && ../nodejs/node.exe scripts/fix-inventory-log-type.mjs [--apply]
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'store.db');
const apply = process.argv.includes('--apply');

const BAD_SQL = `
  SELECT id, product_id, variant_id, change_amount, after_quantity, type, reason, created_at
  FROM inventory_logs
  WHERE variant_id IS NOT NULL
    AND variant_id > 0
    AND type IN ('in','out')
    AND ((change_amount > 0 AND type = 'out') OR (change_amount < 0 AND type = 'in'))
  ORDER BY id
`;

const db = new Database(DB_PATH, { readonly: !apply });
const rows = db.prepare(BAD_SQL).all();

// 诊断信息：便于判断「命中 0 条」是真实无脏数据，还是查询条件过窄
const total = db.prepare(`SELECT COUNT(*) n FROM inventory_logs`).get().n;
const withVariant = db.prepare(`SELECT COUNT(*) n FROM inventory_logs WHERE variant_id IS NOT NULL AND variant_id > 0`).get().n;
const typeDist = db.prepare(`SELECT type, COUNT(*) n FROM inventory_logs GROUP BY type ORDER BY n DESC`).all();
console.log(`[诊断] inventory_logs 总记录 ${total} 条；其中带规格(variant_id>0) ${withVariant} 条`);
console.log(`[诊断] type 分布：${typeDist.map((t) => `${t.type ?? 'NULL'}=${t.n}`).join('  ')}`);

console.log(`\n[扫描] 命中方向记反的流水记录：${rows.length} 条`);
if (rows.length) {
  console.log('\n样例（最多 15 条）：');
  console.table(rows.slice(0, 15).map((r) => ({
    id: r.id,
    product_id: r.product_id,
    variant_id: r.variant_id,
    change_amount: r.change_amount,
    现type: r.type,
    应type: r.change_amount > 0 ? 'in' : 'out',
    reason: r.reason,
    created_at: r.created_at,
  })));
}

if (!apply) {
  console.log('\n[dry-run] 未修改任何数据。确认无误后加 --apply 执行校正。');
  db.close();
  process.exit(0);
}

if (!rows.length) {
  console.log('\n无需校正。');
  db.close();
  process.exit(0);
}

// 写库前备份（WAL 安全）
const bak = `${DB_PATH}.bak-fixlogtype-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
await db.backup(bak);
console.log(`\n[备份] ${bak}`);

const upd = db.prepare(`UPDATE inventory_logs SET type = ? WHERE id = ?`);
const fix = db.transaction((list) => {
  for (const r of list) upd.run(r.change_amount > 0 ? 'in' : 'out', r.id);
});
fix(rows);

const left = db.prepare(BAD_SQL).all().length;
console.log(`[校正] 已修正 ${rows.length} 条，剩余异常 ${left} 条`);
db.close();
