/**
 * 验证「方案 A」：有规格商品的 products.stock = Σ(product_variants.stock)（派生值）
 *
 * 在数据库副本（系统临时目录）上运行，绝不动生产库。
 * 重点验证两个风险点：
 *   1. 改规格库存后，商品总库存自动跟随（手动调样品规格场景）
 *   2. 订单流程「adjustVariantStock + adjustStock」双写不会造成双扣减
 *
 * 用法：cd server && ../nodejs/node.exe scripts/verify-variant-stock-sync.mjs
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'data', 'store.db');
const TEST = path.join(os.tmpdir(), `_stock-sync-test-${Date.now()}.db`);

const src = new Database(SRC, { readonly: true });
await src.backup(TEST);
src.close();
console.log(`[准备] 已复制测试副本 → ${TEST}\n`);

process.env.DB_PATH = TEST;
const { getDb } = await import('../src/db.js');
const { adjustStock, adjustVariantStock } = await import('../src/stock.js');
const db = getDb();

let failed = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}：实际 ${actual}，期望 ${expected}`);
};

const PID = 17;
const snap = () => {
  const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(PID);
  const vs = db.prepare('SELECT id, spec, stock FROM product_variants WHERE product_id = ? ORDER BY id').all(PID);
  return { total: p.stock, sum: vs.reduce((a, v) => a + v.stock, 0), vs };
};

const s0 = snap();
console.log(`[初始] products.stock=${s0.total} | ${s0.vs.map((v) => `${v.spec || 'spec'}(id${v.id})=${v.stock}`).join('  ')} | Σ规格=${s0.sum}\n`);

const VID = s0.vs[0].id;

console.log('场景1  订单销售出库（adjustVariantStock -1 后再 adjustStock -1，双写路径）');
console.log('  风险点：若两处都按 delta 增减，总数会被扣 2 次');
adjustVariantStock(VID, -1, { type: 'out', reason: '测试-销售出库', orderId: null });
adjustStock(PID, -1, { type: 'out', reason: '测试-订单销售出库', orderId: null });
const s1 = snap();
console.log(`  结果 products.stock=${s1.total} | Σ规格=${s1.sum}`);
check('总数等于 Σ规格', s1.total, s1.sum);
check('总数只减 1（未双扣减）', s1.total, s0.total - 1);

console.log('\n场景2  手动给样品规格入库 +5（仅 adjustVariantStock，无伴随 adjustStock）');
adjustVariantStock(VID, 5, { type: 'in', reason: '测试-变体手动入库' });
const s2 = snap();
console.log(`  结果 products.stock=${s2.total} | Σ规格=${s2.sum}`);
check('总数等于 Σ规格', s2.total, s2.sum);
check('总数自动跟随 +5', s2.total, s1.total + 5);

console.log('\n场景3  无规格商品走 adjustStock（应独立维护，行为与改动前一致）');
let noVarId = null;
try {
  const r = db.prepare("INSERT INTO products (name, code, stock, category, price) VALUES ('测试无规格商品','TEST-NV',10,'sample',0)").run();
  noVarId = r.lastInsertRowid;
} catch (e) {
  console.log(`  （无法插入测试商品：${e.message}）`);
}
if (noVarId) {
  const before = db.prepare('SELECT stock FROM products WHERE id = ?').get(noVarId).stock;
  const after = adjustStock(noVarId, 3, { type: 'in', reason: '测试-无规格入库' });
  console.log(`  结果 ${before} → ${after}`);
  check('无规格商品按 delta 正常增减', after, before + 3);
}

console.log(`\n${failed === 0 ? '全部通过' : `失败 ${failed} 项`}`);
db.close();
try { fs.unlinkSync(TEST); console.log('[清理] 临时测试库已删除'); } catch (e) { console.log(`[清理] 临时库残留：${TEST}`); }
process.exit(failed === 0 ? 0 : 1);
