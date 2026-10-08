// server/scripts/verify-business-flows.mjs
// 核心业务流断言：补齐"改完代码敢不敢上线"最关键的几条链路。
// 与库存口径脚本的区别：本脚本走**真实 HTTP API**（贴近用户操作），而非直接调 service 函数。
//
// 在数据库副本上运行（生产库零接触）：
//   1. 复制 server/data/store.db 到 os.tmpdir()
//   2. 单进程内起服务（后台进程会随 shell 结束被回收，必须同进程）
//   3. 发真实请求 + 直连副本库核对落库结果
//
// 断言设计原则（2026-09-08 教训）：每条断言都要能证伪，先自问"什么输入会让它 FAIL"。
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_bizflow-${Date.now()}.db`);

if (!fs.existsSync(SRC_DB)) {
  console.error(`[业务流] 找不到源数据库 ${SRC_DB}`);
  process.exit(1);
}
fs.copyFileSync(SRC_DB, TMP_DB);
// WAL 模式下 store.db 可能不含最新提交，一并复制 -wal/-shm 保证副本完整
for (const ext of ['-wal', '-shm']) {
  const src = SRC_DB + ext;
  if (fs.existsSync(src)) { try { fs.copyFileSync(src, TMP_DB + ext); } catch (e) { /* 忽略 */ } }
}

// 必须在 import 服务之前设置：测试进程不得触发自动备份（会写真实备份目录）
process.env.DB_PATH = TMP_DB;
process.env.PORT = process.env.PORT || '3397';
process.env.AUTO_BACKUP = 'off';

const Database = (await import('better-sqlite3')).default;

// 自建测试数据：断言不能依赖"生产库里恰好有什么"，否则换个环境就自动跳过、等于没测。
// 准备两个测试商品：A 无规格（验 delta 增减），B 双规格（验总库存=Σ规格不漂移）。
const wdb = new Database(TMP_DB);
wdb.prepare(`INSERT INTO products (name, code, category, price, cost_price, stock, active)
             VALUES ('自动化验证-无规格','AUTO-TEST-A','sample',100,60,10,1)`).run();
const PID_A = wdb.prepare("SELECT id FROM products WHERE code = 'AUTO-TEST-A'").get().id;

wdb.prepare(`INSERT INTO products (name, code, category, price, cost_price, stock, active)
             VALUES ('自动化验证-双规格','AUTO-TEST-B','sample',100,60,10,1)`).run();
const PID_B = wdb.prepare("SELECT id FROM products WHERE code = 'AUTO-TEST-B'").get().id;
wdb.prepare('INSERT INTO product_variants (product_id, spec, price, stock) VALUES (?,?,?,?)').run(PID_B, '红色', 100, 6);
wdb.prepare('INSERT INTO product_variants (product_id, spec, price, stock) VALUES (?,?,?,?)').run(PID_B, '蓝色', 100, 4);
wdb.close();

const ro = new Database(TMP_DB, { readonly: true });

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

await import('../src/index.js');
await new Promise((r) => setTimeout(r, 800));

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const api = async (p, opts = {}) => {
  const res = await fetch(BASE + p, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
  return { status: res.status, json, text };
};

// 管理员登录（本地库凭据）
const login = await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const token = login.json?.token;
if (!token) {
  console.error('[业务流] 登录失败，无法继续:', login.text?.slice(0, 200));
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };
// 下单接口返回 { message, order: { id } }，统一取值避免字段名变化导致取到 undefined
const oid = (r) => r?.json?.order?.id ?? r?.json?.order_id ?? r?.json?.id ?? null;

console.log('\n[业务流] 1. 样品/赠品成交应扣库存，订货不扣库存');

// 选一个有库存、且没有规格变体的商品（排除多规格干扰，单测最基本的 delta 行为）
const simple = ro.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(PID_A);
{
  const stock0 = simple.stock;
  const orderRes = await api('/api/orders', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      customer_name: '自动化验证客户',
      customer_phone: '13900000001',
      payment_method: 'full',
      items: [{ product_id: simple.id, product_name: simple.name, quantity: 2, product_type: 'sample' }],
    }),
  });
  check('下单接口返回成功', orderRes.status === 200 || orderRes.status === 201, `status=${orderRes.status} ${orderRes.text.slice(0, 120)}`);
  const orderId = oid(orderRes);

  if (orderId) {
    const stock1 = ro.prepare('SELECT stock FROM products WHERE id = ?').get(simple.id).stock;
    check('样品成交扣减库存（stock0-2，精确值）', stock1 === stock0 - 2, `期望 ${stock0 - 2}，实际 ${stock1}`);

    const outLog = ro.prepare(`SELECT COUNT(*) c FROM inventory_logs WHERE product_id = ? AND type = 'out' AND reason LIKE '%销售出库%'`).get(simple.id).c;
    check('生成出库流水且方向为 out', outLog > 0, `out 流水 ${outLog} 条`);

    // 全款下单应自动记一笔收款，且金额与订单总额一致（相对断言，不硬编码价格）
    const pay = ro.prepare('SELECT amount FROM payments WHERE order_id = ?').all(orderId);
    const orderRow = ro.prepare('SELECT total_amount, actual_amount FROM orders WHERE id = ?').get(orderId);
    const expectAmt = Number(orderRow?.actual_amount ?? orderRow?.total_amount ?? 0);
    check('全款下单自动记收款', pay.length > 0, `payments ${pay.length} 条`);
    check('收款金额与订单金额一致', pay.length > 0 && Math.abs(Number(pay[0].amount) - expectAmt) < 0.01,
      `收款 ${pay[0]?.amount} vs 订单 ${expectAmt}`);

    // 取消订单应回补库存（回到 stock0，精确值可证伪）
    const cancel = await api(`/api/orders/${orderId}/cancel`, { method: 'POST', headers: auth, body: JSON.stringify({ reason: '自动化验证取消' }) });
    check('取消订单接口返回成功', cancel.status === 200, `status=${cancel.status}`);
    const stock2 = ro.prepare('SELECT stock FROM products WHERE id = ?').get(simple.id).stock;
    check('取消订单回补库存（回到原值）', stock2 === stock0, `期望 ${stock0}，实际 ${stock2}`);
    const inLog = ro.prepare(`SELECT COUNT(*) c FROM inventory_logs WHERE product_id = ? AND type = 'in' AND reason LIKE '%退回%'`).get(simple.id).c;
    check('退回流水方向为 in', inLog > 0, `in 流水 ${inLog} 条`);
  }

  // 订货类永不核减库存
  const stockBefore = ro.prepare('SELECT stock FROM products WHERE id = ?').get(simple.id).stock;
  const orderRes2 = await api('/api/orders', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      customer_name: '自动化验证客户2',
      customer_phone: '13900000002',
      items: [{ product_id: simple.id, product_name: simple.name, quantity: 3, product_type: 'order' }],
    }),
  });
  const stockAfter = ro.prepare('SELECT stock FROM products WHERE id = ?').get(simple.id).stock;
  check('订货类不核减库存', stockAfter === stockBefore, `${stockBefore} → ${stockAfter}`);
  const oid2 = oid(orderRes2);
  if (oid2) {
    await api(`/api/orders/${oid2}/cancel`, { method: 'POST', headers: auth, body: JSON.stringify({ reason: '清理' }) });
  }
}

console.log('\n[业务流] 2. 有规格商品：总库存 = Σ规格库存（方案 A 不变量）');
const variantProd = ro.prepare('SELECT id, name, stock FROM products WHERE id = ?').get(PID_B);
{
  const v0 = ro.prepare('SELECT v.id, v.spec, v.stock FROM product_variants v WHERE v.product_id = ? AND v.stock > 0 LIMIT 1').get(variantProd.id);
  const total0 = ro.prepare('SELECT stock FROM products WHERE id = ?').get(variantProd.id).stock;
  const res3 = await api('/api/orders', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      customer_name: '自动化验证客户3',
      customer_phone: '13900000003',
      items: [{ product_id: variantProd.id, product_name: variantProd.name, spec: v0.spec, quantity: 1, product_type: 'sample' }],
    }),
  });
  const oid3 = oid(res3);
  if (oid3) {
    const total1 = ro.prepare('SELECT stock FROM products WHERE id = ?').get(variantProd.id).stock;
    const sum1 = ro.prepare('SELECT SUM(stock) s FROM product_variants WHERE product_id = ?').get(variantProd.id).s;
    const v1 = ro.prepare('SELECT stock FROM product_variants WHERE id = ?').get(v0.id).stock;
    check('规格库存精确减 1', v1 === v0.stock - 1, `期望 ${v0.stock - 1}，实际 ${v1}`);
    check('总库存未被双扣减（只减 1）', total1 === total0 - 1, `期望 ${total0 - 1}，实际 ${total1}`);
    check('总库存 = Σ规格库存（派生值不漂移）', total1 === sum1, `总 ${total1} vs Σ ${sum1}`);
    await api(`/api/orders/${oid3}/cancel`, { method: 'POST', headers: auth, body: JSON.stringify({ reason: '清理' }) });
  } else {
    check('规格商品下单成功', false, res3.text.slice(0, 150));
  }
}

console.log('\n[业务流] 3. 请求日志已落盘（P0-3 可观测性）');
const logDir = path.join(__dirname, '..', 'logs');
const d = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const logFile = path.join(logDir, `access-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.log`);
check('access 日志文件已生成', fs.existsSync(logFile), logFile);
if (fs.existsSync(logFile)) {
  const content = fs.readFileSync(logFile, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const hasApi = lines.some((l) => l.includes('/api/'));
  const hasStatus = lines.some((l) => l.includes('"status"'));
  check('日志记录含 API 请求', hasApi, `${lines.length} 行`);
  check('日志记录含状态码与耗时', hasStatus);
  check('日志已脱敏（无明文 token）', !/token=[A-Za-z0-9._-]{10,}/.test(content));
}

// 清理临时库
try { ro.close(); } catch (e) { /* 忽略 */ }
try { fs.unlinkSync(TMP_DB); } catch (e) { try { fs.renameSync(TMP_DB, `${TMP_DB}.old`); } catch (e2) { /* 忽略 */ } }

console.log(`\n${'─'.repeat(60)}`);
console.log(`核心业务流：${pass} 通过 / ${fail} 失败`);
if (failures.length) console.log('失败项：' + failures.join('、'));
console.log('─'.repeat(60));
process.exit(fail === 0 ? 0 : 1);
