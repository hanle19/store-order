// 验证 delivery.js 回退签收的权限与状态机修复（全域检查发现：rollback 原无角色限制）
// 可证伪断言：
//   1. sales 调 rollback → 403（原漏洞：任何登录用户都能回退已签收送货单）
//   2. admin 调 rollback → 成功，status 变 dispatched
//   3. 非 signed 状态再 rollback → 400（原漏洞：任何状态都能被改回 dispatched）
//   4. rollback 落 operation_logs（action=rollback_sign）
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_verify-delivery-${Date.now()}.db`);
fs.copyFileSync(SRC_DB, TMP_DB);

process.env.DB_PATH = TMP_DB;
process.env.PORT = process.env.PORT || '3395';
process.env.AUTO_BACKUP = 'off';

const { default: Database } = await import('better-sqlite3');
const { generateToken } = await import('../src/middleware/auth.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — ${detail}`); }
}

// 起服务（index.js 自行 listen，脚本内 await import 后轮询就绪）
await import('../src/index.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
async function waitReady() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch (e) { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
const ready = await waitReady();
check('服务就绪', ready);

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, opts);
  let json = null;
  try { json = await r.json(); } catch (e) { /* 非 JSON */ }
  return { status: r.status, json };
}

// 直接操作副本库自建测试数据（不依赖生产库形态）
const db = new Database(TMP_DB);
const oid = db.prepare(`INSERT INTO orders (order_no, customer_name, store_id) VALUES (?, ?, 1)`)
  .run('DELV-AUTH-TEST', '审计测试客户').lastInsertRowid;
const oiid = db.prepare(`INSERT INTO order_items (order_id, product_name, quantity, item_status) VALUES (?, '测试商品', 1, 'delivered')`)
  .run(oid).lastInsertRowid;
const did = db.prepare(`INSERT INTO delivery_orders (order_id, batch_no, delivery_type, status, signature_status, operator_id, store_id) VALUES (?, 'B001', 'full', 'dispatched', 'unsigned', 1, 1)`)
  .run(oid).lastInsertRowid;
db.prepare(`INSERT INTO delivery_items (delivery_id, order_item_id, product_name) VALUES (?, ?, '测试商品')`).run(did, oiid);
db.close();

const adminToken = generateToken({ id: 1, username: 'admin', role: 'admin', store_id: null });
const salesToken = generateToken({ id: 3, username: 'hl', role: 'sales', store_id: 1 });
const adminAuth = { Authorization: `Bearer ${adminToken}` };
const salesAuth = { Authorization: `Bearer ${salesToken}` };

console.log('\n[delivery] 0. sales 调 sign 签收应成功（验证别名修复 + sales 可签收）');
const r0 = await api(`/api/delivery/${did}/sign`, { method: 'POST', headers: salesAuth });
check('sales sign → 200', r0.status === 200, `实际 ${r0.status} ${JSON.stringify(r0.json)}`);
const after0 = db2get(`SELECT status, signature_status FROM delivery_orders WHERE id=${did}`);
check('状态变 signed', after0?.status === 'signed' && after0?.signature_status === 'signed', JSON.stringify(after0));

console.log('\n[delivery] 1. sales 调 rollback 应被拒（403）');
const r1 = await api(`/api/delivery/${did}/rollback`, { method: 'POST', headers: salesAuth });
check('sales rollback → 403', r1.status === 403, `实际 ${r1.status}`);

console.log('\n[delivery] 2. admin 调 rollback 应成功');
const r2 = await api(`/api/delivery/${did}/rollback`, { method: 'POST', headers: adminAuth });
check('admin rollback → 200', r2.status === 200, `实际 ${r2.status} ${JSON.stringify(r2.json)}`);
const after2 = db2get(`SELECT status, signature_status FROM delivery_orders WHERE id=${did}`);
check('状态回退到 dispatched', after2?.status === 'dispatched' && after2?.signature_status === 'unsigned', JSON.stringify(after2));

console.log('\n[delivery] 3. 非 signed 状态再 rollback 应被拒（400）');
const r3 = await api(`/api/delivery/${did}/rollback`, { method: 'POST', headers: adminAuth });
check('重复 rollback → 400', r3.status === 400, `实际 ${r3.status}`);

console.log('\n[delivery] 4. sign/rollback 落审计');
const logs = db2all(`SELECT action, target_type, operator_name, old_status, new_status FROM operation_logs WHERE target_type='delivery' AND target_id=${did} ORDER BY id ASC`);
check('存在 sign 审计', logs.some((l) => l.action === 'sign' && l.new_status === 'signed'), JSON.stringify(logs));
check('存在 rollback_sign 审计', logs.some((l) => l.action === 'rollback_sign' && l.old_status === 'signed' && l.new_status === 'dispatched'),
  JSON.stringify(logs));

function db2get(sql) {
  const d = new Database(TMP_DB, { readonly: true });
  const r = d.prepare(sql).get();
  d.close();
  return r;
}
function db2all(sql) {
  const d = new Database(TMP_DB, { readonly: true });
  const r = d.prepare(sql).all();
  d.close();
  return r;
}

console.log(`\n[delivery] 结果：${pass} 通过 / ${fail} 失败`);
try { fs.unlinkSync(TMP_DB); } catch (e) { /* 忽略 */ }
process.exit(fail > 0 ? 1 : 0);
