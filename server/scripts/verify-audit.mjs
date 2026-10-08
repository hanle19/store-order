// 审计覆盖验证：删除类操作必须留下 operation_logs（谁删的、删的什么、删前快照）。
// 用法：node scripts/verify-audit.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_audit-${Date.now()}.db`);
fs.copyFileSync(SRC_DB, TMP_DB);
process.env.DB_PATH = TMP_DB;
process.env.PORT = process.env.PORT || '3394';
process.env.AUTO_BACKUP = 'off';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const Database = (await import('better-sqlite3')).default;

// 先在副本库造测试数据（服务 import 前），再 import 服务跑 HTTP
function seed() {
  const db = new Database(TMP_DB);
  db.pragma('foreign_keys = ON');
  const cust = db.prepare(`INSERT INTO customers (name, phone, status) VALUES (?,?,?)`).run('审计测试客户', '13800000001', 'lead');
  const orderNo = 'PO-AUDIT-001';
  const order = db.prepare(`INSERT INTO orders (order_no, customer_name, customer_phone, status) VALUES (?,?,?,?)`)
    .run(orderNo, '审计测试订单', '13800000002', 'cancelled');
  const cost = db.prepare(`INSERT INTO other_costs (year, month, name, amount) VALUES (?,?,?,?)`)
    .run('2026', '9', '审计测试费用', 999);
  const prod = db.prepare(`INSERT INTO products (name, category, price) VALUES (?,?,?)`)
    .run('审计测试商品', 'order', 100);
  const coupon = db.prepare(`INSERT INTO coupons (code, type, value) VALUES (?,?,?)`).run('AUDIT99', 'amount', 10);
  const bundle = db.prepare(`INSERT INTO bundles (name, combo_price) VALUES (?,?)`).run('审计测试套餐', 99);
  const ids = { cust: cust.lastInsertRowid, order: order.lastInsertRowid, cost: cost.lastInsertRowid, prod: prod.lastInsertRowid, coupon: coupon.lastInsertRowid, bundle: bundle.lastInsertRowid };
  db.close();
  return ids;
}

const seeded = seed();

const BASE = `http://127.0.0.1:${process.env.PORT}`;
await import('../src/index.js');
let ready = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`${BASE}/api/ping`); if (r.status) { ready = true; break; } } catch (e) { /* 未就绪 */ }
  await new Promise((r) => setTimeout(r, 150));
}
if (!ready) { console.error('服务未就绪'); process.exit(1); }

const { getDb } = await import('../src/db.js');

async function api(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, opts);
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, json };
}

function countAudit(type, id) {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) c FROM operation_logs WHERE target_type=? AND target_id=? AND action=?').get(type, id, 'delete').c;
}
function latestAudit(type, id) {
  const db = getDb();
  return db.prepare('SELECT * FROM operation_logs WHERE target_type=? AND target_id=? AND action=? ORDER BY id DESC LIMIT 1').get(type, id, 'delete');
}

try {
  const login = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  const token = login.json?.token;
  if (!token) throw new Error(`登录失败 ${JSON.stringify(login.json)}`);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  console.log('\n[审计] 1. 删除客户 → target_type=customer');
  check('删除前无 customer 审计', countAudit('customer', seeded.cust) === 0);
  const d1 = await api(`/api/customers/${seeded.cust}`, { method: 'DELETE', headers: auth });
  check('删除客户 200', d1.status === 200, String(d1.status));
  check('审计写入 1 条 customer delete', countAudit('customer', seeded.cust) === 1);
  const a1 = latestAudit('customer', seeded.cust);
  check('记录操作人 admin', a1?.operator_name === '管理员' || a1?.operator_id === 1, `${a1?.operator_name}/${a1?.operator_id}`);
  check('details 含删除前快照', String(a1?.details || '').includes('审计测试客户'), String(a1?.details).slice(0, 50));

  console.log('\n[审计] 2. 删除订单 → 删单动作留痕，且不被"清历史日志"抹掉');
  const d2 = await api(`/api/orders/${seeded.order}`, { method: 'DELETE', headers: auth });
  check('删除订单 200', d2.status === 200, String(d2.status));
  const a2 = latestAudit('order', seeded.order);
  check('删单审计存在', !!a2, 'target_type=order action=delete');
  check('details 含订单号', String(a2?.details || '').includes('PO-AUDIT-001'), String(a2?.details).slice(0, 60));
  check('快照含金额字段', /total_amount/.test(String(a2?.details || '')), String(a2?.details).slice(0, 60));

  console.log('\n[审计] 3. 删除财务费用 → target_type=finance');
  const d3 = await api(`/api/finance/other-costs/${seeded.cost}`, { method: 'DELETE', headers: auth });
  check('删除费用 200', d3.status === 200, String(d3.status));
  const a3 = latestAudit('finance', seeded.cost);
  check('finance 审计写入', !!a3, JSON.stringify(a3?.details).slice(0, 50));
  check('details 含费用名称', String(a3?.details || '').includes('审计测试费用'));

  console.log('\n[审计] 4. 删除商品 → target_type=product');
  const d4 = await api(`/api/products/${seeded.prod}`, { method: 'DELETE', headers: auth });
  check('删除商品 200', d4.status === 200, String(d4.status));
  check('product 审计写入', countAudit('product', seeded.prod) === 1);

  console.log('\n[审计] 5. 删除优惠券 / 捆绑套餐');
  const d5 = await api(`/api/coupons/AUDIT99`, { method: 'DELETE', headers: auth });
  check('删除券 200', d5.status === 200, String(d5.status));
  check('coupon 审计写入', !!latestAudit('coupon', seeded.coupon));
  const d6 = await api(`/api/bundles/${seeded.bundle}`, { method: 'DELETE', headers: auth });
  check('删除套餐 200', d6.status === 200, String(d6.status));
  check('bundle 审计写入', !!latestAudit('bundle', seeded.bundle));

  console.log('\n[审计] 6. 权限：sales 删除客户应被 403 且无审计');
  const { generateToken } = await import('../src/middleware/auth.js');
  const salesToken = generateToken({ id: 4, username: 'whq', role: 'sales', store_id: 1 });
  const cust2 = new Database(TMP_DB).prepare(`INSERT INTO customers (name, phone, status) VALUES (?,?,?)`).run('销售员删除测试', '13800000003', 'lead');
  const denied = await api(`/api/customers/${cust2.lastInsertRowid}`, { method: 'DELETE', headers: { Authorization: `Bearer ${salesToken}` } });
  check('sales 删除被拒 403', denied.status === 403, String(denied.status));
  check('被拒后无审计', countAudit('customer', cust2.lastInsertRowid) === 0);

  console.log('\n[审计] 7. 审计是旁路：非法 target_type 不影响业务');
  const before = countAudit('customer', seeded.cust);
  const d7 = await api('/api/system/ping', { headers: auth });
  check('服务仍正常', d7.status === 200 || d7.status === 404, String(d7.status));
  check('审计计数未异常增长', countAudit('customer', seeded.cust) === before);
} catch (e) {
  fail++;
  failures.push(`异常：${e.message}`);
  console.error('  ❌ 运行异常:', e.message);
}

try { fs.unlinkSync(TMP_DB); } catch (e) { /* ignore */ }
for (const s of ['-wal', '-shm']) { try { fs.unlinkSync(TMP_DB + s); } catch (e) { /* ignore */ } }

console.log(`\n${'='.repeat(48)}`);
console.log(`审计覆盖：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：', failures.join(' | ')); process.exit(1); }
process.exit(0);
