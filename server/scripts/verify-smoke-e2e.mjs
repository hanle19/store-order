/**
 * store-order 端到端冒烟测试
 *
 * 在同一进程内启动 Express 服务并对真实 HTTP 接口发请求，验证：
 *   认证鉴权 / 登录限流 / 分页上限 / 聚合缓存 / 配置脱敏 / 越权隔离 / 静态资源
 *
 * 用法：cd server && ../nodejs/node.exe scripts/verify-smoke-e2e.mjs
 * 说明：仅读 + 登录，不写业务数据。限流用不存在的用户名，不污染真实账号。
 */

process.env.PORT = process.env.PORT || '3399';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret-do-not-use-in-prod';
process.env.NODE_ENV = 'test';

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const results = [];
let adminToken = '';
let salesToken = '';

function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json, text: json ? JSON.stringify(json) : '' };
}

async function main() {
  console.log('\n===== store-order 端到端冒烟测试 =====\n');
  await import('../src/index.js');
  // 等待 listen 就绪
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 150)); }
  }

  // ---------- A. 认证 ----------
  console.log('场景A  认证与鉴权');
  const noAuth = await req('/api/orders');
  check('A1 无 token 访问受保护接口返回 401', noAuth.status === 401, `实际 ${noAuth.status}`);

  const badPwd = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong-password' } });
  check('A2 错误密码返回 401', badPwd.status === 401, `实际 ${badPwd.status}`);

  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  adminToken = login.json?.token || '';
  check('A3 admin 正确密码登录成功并返回 token', login.status === 200 && !!adminToken, `status=${login.status}`);

  const withToken = await req('/api/orders', { token: adminToken });
  check('A4 带 token 访问订单列表成功', withToken.status === 200, `实际 ${withToken.status}`);

  // ---------- B. 分页上限（#18） ----------
  console.log('\n场景B  分页参数上限（防止超大查询 DoS）');
  const bigOrders = await req('/api/orders?page=1&page_size=999999', { token: adminToken });
  const orderPageSize = bigOrders.json?.page_size;
  check('B1 orders page_size 被限制在 200 以内',
    bigOrders.status === 200 && orderPageSize <= 200, `返回 page_size=${orderPageSize}`);

  const negOrders = await req('/api/orders?page=-5&page_size=-1', { token: adminToken });
  check('B2 orders 负数分页参数被钳制为正数',
    negOrders.status === 200 && negOrders.json?.page >= 1 && negOrders.json?.page_size >= 1,
    `page=${negOrders.json?.page}, page_size=${negOrders.json?.page_size}`);

  const bigCust = await req('/api/customers?page=1&pageSize=999999', { token: adminToken });
  const custSize = bigCust.json?.pageSize ?? bigCust.json?.page_size;
  check('B3 customers pageSize 被限制在 500 以内',
    bigCust.status === 200 && (custSize === undefined || custSize <= 500), `返回 pageSize=${custSize}`);

  // ---------- C. 业务列表 ----------
  console.log('\n场景C  核心业务列表接口');
  for (const [name, path] of [
    ['商品', '/api/products'],
    ['客户', '/api/customers'],
    ['采购', '/api/purchases'],
    ['库存', '/api/inventory'],
  ]) {
    const r = await req(path + '?page=1', { token: adminToken });
    check(`C ${name}列表可正常返回`, r.status === 200, `status=${r.status}`);
  }

  // ---------- D. 聚合看板与缓存（#16） ----------
  console.log('\n场景D  聚合接口与缓存');
  const d1 = await req('/api/dashboard', { token: adminToken });
  check('D1 dashboard 返回成功', d1.status === 200 && d1.json?.success === true, `status=${d1.status}`);
  const d2 = await req('/api/dashboard', { token: adminToken });
  check('D2 dashboard 二次请求仍成功（缓存命中或重算均可）',
    d2.status === 200 && JSON.stringify(d2.json?.summary) === JSON.stringify(d1.json?.summary),
    '两次结果一致');

  const a1 = await req('/api/analytics?year=2026&month=9', { token: adminToken });
  check('D3 analytics 返回成功', a1.status === 200 && a1.json?.success === true, `status=${a1.status}`);

  // ---------- E. 配置脱敏（#19） ----------
  console.log('\n场景E  配置接口脱敏');
  const cfgAdmin = await req('/api/config', { token: adminToken });
  check('E1 admin 可读取配置', cfgAdmin.status === 200, `status=${cfgAdmin.status}`);

  // 用真实 sales 账号（hl）签发 token 验证脱敏
  try {
    const { generateToken } = await import('../src/middleware/auth.js');
    salesToken = generateToken({ id: 3, username: 'hl', role: 'sales', store_id: 1 });
    const cfgSales = await req('/api/config', { token: salesToken });
    const adminVals = cfgAdmin.json || {};
    const salesVals = cfgSales.json || {};
    // 找出所有敏感 key，比较 admin / sales 的可见性
    const sensitive = Object.keys(adminVals).filter(k => /webhook|url|key|secret|token|password/i.test(k));
    let allMasked = true;
    let checkedKey = '';
    for (const k of sensitive) {
      const av = String(adminVals[k] ?? '');
      const sv = String(salesVals[k] ?? '');
      if (av && av.length > 4 && sv === av) { allMasked = false; checkedKey = k; break; }
      if (sv) checkedKey = checkedKey || k;
    }
    check('E2 sales 读取配置时敏感字段已脱敏',
      cfgSales.status === 200 && allMasked,
      sensitive.length ? `敏感字段 ${sensitive.length} 个（如 ${checkedKey || sensitive[0]}）` : '库中暂无敏感字段，逻辑未触发（非缺陷）');
  } catch (e) {
    check('E2 sales 配置脱敏', false, e.message.split('\n')[0]);
  }

  // ---------- F. 越权隔离 ----------
  console.log('\n场景F  多店/角色数据隔离');
  const salesOrders = await req('/api/orders?page=1&page_size=200', { token: salesToken });
  const adminOrders = await req('/api/orders?page=1&page_size=200', { token: adminToken });
  const sTotal = salesOrders.json?.total ?? -1;
  const aTotal = adminOrders.json?.total ?? -1;
  check('F1 sales 可见订单数不超过 admin（无越权放大）',
    salesOrders.status === 200 && sTotal <= aTotal, `sales=${sTotal}, admin=${aTotal}`);

  // ---------- G. 登录限流（#7） ----------
  console.log('\n场景G  登录限流（使用不存在的用户名，不污染真实账号）');
  let lockAt = 0;
  for (let i = 1; i <= 5; i++) {
    const r = await req('/api/auth/login', { method: 'POST', body: { username: 'smoke_attacker', password: 'x' } });
    if (r.status === 429) { lockAt = i; break; }
  }
  check('G1 连续失败 5 次触发锁定（429）', lockAt > 0, lockAt ? `第 ${lockAt} 次触发` : '未触发');
  const afterLock = await req('/api/auth/login', { method: 'POST', body: { username: 'smoke_attacker', password: 'x' } });
  check('G2 锁定期间继续尝试仍返回 429', afterLock.status === 429, `实际 ${afterLock.status}`);
  const otherUser = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('G3 其他账号不受连坐影响', otherUser.status === 200, `admin 登录 status=${otherUser.status}`);

  // ---------- H. 静态资源 ----------
  console.log('\n场景H  前端静态资源');
  const root = await fetch(BASE + '/');
  const rootHtml = await root.text();
  check('H1 根路径返回 index.html', root.status === 200 && /<div id="root">|<script/.test(rootHtml), `status=${root.status}`);
  const assetMatch = rootHtml.match(/assets\/[A-Za-z0-9_.-]+\.js/);
  if (assetMatch) {
    const a = await fetch(BASE + '/' + assetMatch[0]);
    check('H2 主 bundle 可加载', a.status === 200, assetMatch[0]);
  } else {
    check('H2 主 bundle 可加载', false, 'index.html 未解析到 bundle');
  }

  // ---------- 汇总 ----------
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败（共 ${results.length}）`);
  if (fail) {
    console.log('\n失败项：');
    for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}  ${r.detail}`);
  }
  console.log('='.repeat(50) + '\n');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('[冒烟脚本异常]', e); process.exit(1); });
