/**
 * 深度验证：针对首轮冒烟中「PASS 但缺乏区分度」的三项做可证伪测试
 *   B3  customers 分页钳制是否有真实效果（响应不含 pageSize，改测行数与非正数入参）
 *   E2  配置脱敏是否真的对 sales 掩码（库里无敏感字段，故临时写入一条再还原）
 *   F1  角色数据隔离是否生效（首轮 sales 本人就是全部订单 owner，改用 0 单账号做对照）
 *
 * 用法：cd server && ../nodejs/node.exe scripts/verify-smoke-deep.mjs
 */

process.env.PORT = process.env.PORT || '3398';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'deep-test-secret';
process.env.NODE_ENV = 'test';

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
async function req(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { }
  return { status: res.status, json };
}

async function main() {
  console.log('\n===== 深度验证（可证伪测试） =====\n');
  const Database = (await import('better-sqlite3')).default;
  // 与启动的服务器共用同一数据库：服务器经 DB_PATH 解析，此处保持一致，
  // 否则脚本写入的临时密钥服务器读不到，会误判 E1/E3（配置脱敏）。
  const db = new Database(process.env.DB_PATH || 'data/store.db');

  await import('../src/index.js');
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/ping'); break; } catch { await new Promise(r => setTimeout(r, 150)); }
  }

  const { generateToken } = await import('../src/middleware/auth.js');
  const adminToken = generateToken({ id: 1, username: 'admin', role: 'admin', store_id: 1 });
  // whq(id=4) 在库中 0 单，用作「无数据 sales」对照组
  const whqToken = generateToken({ id: 4, username: 'whq', role: 'sales', store_id: 1 });
  const hlToken = generateToken({ id: 3, username: 'hl', role: 'sales', store_id: 1 });

  // ---------- B3 真·分页钳制 ----------
  console.log('场景B  customers 分页钳制（可证伪）');
  const normal = await req('/api/customers?page=1', { token: adminToken });
  const zero = await req('/api/customers?page=1&pageSize=0', { token: adminToken });
  const neg = await req('/api/customers?page=1&pageSize=-99', { token: adminToken });
  const huge = await req('/api/customers?page=1&pageSize=999999', { token: adminToken });
  const nLen = normal.json?.customers?.length ?? -1;
  check('B1 默认分页返回客户列表', normal.status === 200 && nLen >= 0, `返回 ${nLen} 条`);
  check('B2 pageSize=0 被钳制为正数（仍返回数据，未被 LIMIT 0 截断为空）',
    zero.status === 200 && (zero.json?.customers?.length ?? 0) === nLen && nLen > 0,
    `零值返回 ${zero.json?.customers?.length ?? '?'} 条 vs 默认 ${nLen} 条`);
  check('B3 pageSize 为负数被钳制为正数',
    neg.status === 200 && (neg.json?.customers?.length ?? 0) === nLen,
    `负数返回 ${neg.json?.customers?.length ?? '?'} 条`);
  check('B4 pageSize=999999 不报错且返回受控行数',
    huge.status === 200 && (huge.json?.customers?.length ?? -1) <= 500,
    `返回 ${huge.json?.customers?.length ?? '?'} 条（上限 500）`);

  // ---------- F1 真·角色隔离 ----------
  console.log('\n场景F  角色数据隔离（0 单账号做对照）');
  const asAdmin = await req('/api/orders?page=1&page_size=200', { token: adminToken });
  const asWhq = await req('/api/orders?page=1&page_size=200', { token: whqToken });
  const asHl = await req('/api/orders?page=1&page_size=200', { token: hlToken });
  const aT = asAdmin.json?.total ?? -1;
  const wT = asWhq.json?.total ?? -1;
  const hT = asHl.json?.total ?? -1;
  const dbOwn = db.prepare('SELECT COUNT(*) c FROM orders WHERE salesperson_id = 4').get().c;
  check('F1 admin 可见全部订单', asAdmin.status === 200 && aT >= 0, `admin total=${aT}`);
  check('F2 whq(sales, 库内 0 单) 可见订单数 = 0 —— 隔离生效',
    asWhq.status === 200 && wT === 0, `whq total=${wT}，库中归属其名下 ${dbOwn} 单`);
  check('F3 hl(sales, 库内 6 单) 可见自己全部订单',
    asHl.status === 200 && hT === 6, `hl total=${hT}`);
  check('F4 sales 可见数严格少于等于 admin，且不等于 admin（证明过滤真实作用）',
    wT < aT, `whq=${wT} < admin=${aT}`);

  // ---------- E2 真·配置脱敏 ----------
  console.log('\n场景E  配置脱敏（临时写入敏感项后立即还原）');
  const TEST_KEY = 'wecom_webhook_url';
  const TEST_VAL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=SMOKE-TEST-KEY-123456';
  const before = db.prepare('SELECT value FROM system_config WHERE key = ?').get(TEST_KEY);
  db.prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)').run(TEST_KEY, TEST_VAL);
  console.log(`  [准备] 已临时写入 ${TEST_KEY}（原值：${before ? '存在' : '无'}，验证后还原）`);

  const cfgAdmin = await req('/api/config', { token: adminToken });
  const cfgSales = await req('/api/config', { token: whqToken });
  const aVal = String(cfgAdmin.json?.[TEST_KEY] ?? '');
  const sVal = String(cfgSales.json?.[TEST_KEY] ?? '');
  const sMasked = cfgSales.json?.[TEST_KEY + '_masked'];
  check('E1 admin 读取到敏感项完整值（需能编辑）',
    aVal.includes('SMOKE-TEST-KEY-123456'), `admin 见 ${aVal ? '完整值' : '空/掩码'}`);
  check('E2 sales 读取不到完整值（已脱敏）',
    !sVal.includes('SMOKE-TEST-KEY-123456'), `sales 见：${sVal || '(字段已移除)'}`);
  check('E3 sales 侧提供 _masked 掩码字段且不泄露密钥',
    !!sMasked && !String(sMasked).includes('SMOKE-TEST-KEY-123456'),
    `masked=${sMasked || '(无)'}`);

  // 掩码回写防护
  const putRes = await req('/api/config', {
    method: 'PUT', token: adminToken,
    body: { [TEST_KEY]: String(sMasked || '****123456') },
  });
  const afterPut = db.prepare('SELECT value FROM system_config WHERE key = ?').get(TEST_KEY);
  check('E4 掩码值回写被拒绝（未污染真实配置）',
    afterPut?.value === TEST_VAL,
    `写入掩码后库中仍为原值: ${afterPut?.value === TEST_VAL ? '是' : '否 -> ' + String(afterPut?.value).slice(0, 30)}`);

  // 还原
  if (before) db.prepare('UPDATE system_config SET value = ? WHERE key = ?').run(before.value, TEST_KEY);
  else db.prepare('DELETE FROM system_config WHERE key = ?').run(TEST_KEY);
  const restored = db.prepare('SELECT value FROM system_config WHERE key = ?').get(TEST_KEY);
  const restoredOk = before ? restored?.value === before.value : !restored;
  check('E5 测试后配置已还原', restoredOk, before ? '已恢复原值' : '已删除临时项');

  // ---------- I. 负 LIMIT 防护（本次新发现） ----------
  console.log('\n场景I  负 LIMIT 防护（SQLite 负 LIMIT = 不限制，须钳制）');
  const negKnowledge = await req('/api/knowledge?page=1&page_size=-1', { token: adminToken });
  check('I1 knowledge 列表 page_size=-1 不返回全表',
    negKnowledge.status === 200 && (negKnowledge.json?.list?.length ?? 0) <= 50,
    `返回 ${negKnowledge.json?.list?.length ?? '?'} 条（上限 50）`);

  const negKnowledgeAdmin = await req('/api/knowledge/admin?page=1&page_size=-1', { token: adminToken });
  check('I2 knowledge 管理列表 page_size=-1 不返回全表',
    negKnowledgeAdmin.status === 200 && (negKnowledgeAdmin.json?.list?.length ?? 0) <= 50,
    `返回 ${negKnowledgeAdmin.json?.list?.length ?? '?'} 条`);

  const negInv = await req('/api/inventory?limit=-1', { token: adminToken });
  check('I3 inventory 流水 limit=-1 不返回全表',
    negInv.status === 200 && Array.isArray(negInv.json) ? negInv.json.length <= 500 : negInv.status === 200,
    `返回 ${Array.isArray(negInv.json) ? negInv.json.length + ' 条' : '非数组'}`);

  const negLogs = await req('/api/operation-logs?limit=-1', { token: adminToken });
  check('I4 操作日志 limit=-1 不返回全表',
    negLogs.status === 200 && (negLogs.json?.data?.length ?? 0) <= 200,
    `返回 ${negLogs.json?.data?.length ?? '?'} 条（上限 200）`);

  const negOrders2 = await req('/api/orders?page=1&page_size=-1', { token: adminToken });
  check('I5 orders page_size=-1 走默认值而非全表',
    negOrders2.status === 200 && (negOrders2.json?.data?.length ?? 0) <= 200,
    `page_size=${negOrders2.json?.page_size}, 返回 ${negOrders2.json?.data?.length ?? '?'} 条`);

  // ---------- 汇总 ----------
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`结果：${pass} 通过 / ${fail} 失败（共 ${results.length}）`);
  if (fail) { console.log('\n失败项：'); for (const r of results.filter(x => !x.ok)) console.log(`  - ${r.name}  ${r.detail}`); }
  console.log('='.repeat(50) + '\n');
  db.close();
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('[异常]', e); process.exit(1); });
