/**
 * 关键路径冒烟（需后端已启动）：登录 → 商品 → 订单 → 库存 → 财务 → 退换/售后看板。
 * 用法：cd server && ../nodejs/node.exe scripts/smoke.js [baseURL]
 * 退出码：0 全绿；1 存在失败项。
 */
const BASE = process.argv[2] || 'http://localhost:3333';

let passed = 0, failed = 0;
const results = [];
async function check(name, fn) {
  try {
    await fn();
    passed++; results.push(`  PASS ${name}`);
  } catch (e) {
    failed++; results.push(`  FAIL ${name} — ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML 等 */ }
  return { status: res.status, json, text };
}

let token = '';
const now = new Date();

await check('登录 admin', async () => {
  const r = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert(r.status === 200 && r.json && r.json.token, `HTTP ${r.status}`);
  token = r.json.token;
});
await check('商品列表', async () => {
  const r = await api('/products', { token });
  assert(r.status === 200, `HTTP ${r.status}`);
});
await check('订单列表', async () => {
  const r = await api('/orders', { token });
  assert(r.status === 200, `HTTP ${r.status}`);
});
await check('库存总览', async () => {
  const r = await api('/inventory/all', { token });
  assert(r.status === 200, `HTTP ${r.status}`);
});
await check('财务月报（含 aftersales_cost）', async () => {
  const r = await api(`/finance/monthly-summary?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { token });
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(r.json && typeof r.json.aftersales_cost === 'number', '缺 aftersales_cost 字段');
});
await check('财务对账明细（aftersales-ledger）', async () => {
  const r = await api(`/finance/aftersales-ledger?year=${now.getFullYear()}&month=${now.getMonth() + 1}`, { token });
  assert(r.status === 200, `HTTP ${r.status}`);
  assert(r.json && Array.isArray(r.json.returns) && Array.isArray(r.json.aftersales), '返回结构缺 returns/aftersales 数组');
});
await check('全局退换看板（admin 可见）', async () => {
  const r = await api('/orders/returns', { token });
  assert(r.status === 200, `HTTP ${r.status}`);
});
await check('全局售后看板（admin 可见）', async () => {
  const r = await api('/orders/aftersales', { token });
  assert(r.status === 200, `HTTP ${r.status}`);
});
await check('未授权拦截', async () => {
  const r = await api('/orders');
  assert(r.status === 401, `应 401，实际 HTTP ${r.status}`);
});

console.log('========================================');
console.log(` 冒烟结果：${passed} 通过 / ${failed} 失败（${BASE}）`);
console.log('========================================');
results.forEach(r => console.log(r));
process.exit(failed ? 1 : 0);
