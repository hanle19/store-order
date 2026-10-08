// 前端「系统维护」页（AutoBackupCard / SystemLogsCard）依赖的 4 个管理接口契约验证。
// 目的：防止后端改字段名导致前端静默渲染 undefined（这类 bug 前端不会报错，只会显示空白）。
//
// 用法：node scripts/verify-admin-api-contract.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DB = path.join(__dirname, '..', 'data', 'store.db');
const TMP_DB = path.join(os.tmpdir(), `_adminapi-${Date.now()}.db`);
fs.copyFileSync(SRC_DB, TMP_DB);

process.env.DB_PATH = TMP_DB;
process.env.PORT = process.env.PORT || '3395';
process.env.AUTO_BACKUP = 'off';

let pass = 0;
let fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const BASE = `http://127.0.0.1:${process.env.PORT}`;
process.env.NODE_ENV = 'test';

// index.js 自行 app.listen（读 PORT 环境变量），这里只负责等它就绪
await import('../src/index.js');
let ready = false;
for (let i = 0; i < 40; i++) {
  try { const r = await fetch(`${BASE}/api/ping`); if (r.status) { ready = true; break; } } catch (e) { /* 尚未就绪 */ }
  await new Promise((r) => setTimeout(r, 150));
}
if (!ready) { console.error('服务未就绪，终止'); process.exit(1); }

async function api(p, opts = {}) {
  const res = await fetch(`${BASE}${p}`, opts);
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, json };
}

try {
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const token = login.json?.token;
  if (!token) throw new Error(`登录失败：${JSON.stringify(login.json)}`);
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  console.log('\n[契约] 1. GET /api/system/auto-backup/status（AutoBackupCard）');
  const st = await api('/api/system/auto-backup/status', { headers: auth });
  check('HTTP 200', st.status === 200, String(st.status));
  check('success=true', st.json?.success === true);
  for (const f of ['enabled', 'hour', 'keep', 'count', 'latest', 'dir']) {
    check(`字段存在：${f}`, Object.prototype.hasOwnProperty.call(st.json || {}, f), String(st.json?.[f]));
  }
  check('enabled 为布尔', typeof st.json?.enabled === 'boolean');
  check('hour 为 0-23 整数', Number.isInteger(st.json?.hour) && st.json.hour >= 0 && st.json.hour <= 23, String(st.json?.hour));
  check('latest 为 null 或对象', st.json?.latest === null || typeof st.json.latest === 'object');
  if (st.json?.latest) {
    for (const f of ['name', 'size', 'createdAt']) {
      check(`latest.${f} 存在`, Object.prototype.hasOwnProperty.call(st.json.latest, f));
    }
  }

  console.log('\n[契约] 2. GET /api/system/backups（备份清单表格）');
  const bk = await api('/api/system/backups', { headers: auth });
  check('HTTP 200', bk.status === 200, String(bk.status));
  check('data 为数组', Array.isArray(bk.json?.data), String(bk.json?.total));
  check('total 与 data 长度一致', bk.json?.total === (bk.json?.data || []).length, `${bk.json?.total} vs ${(bk.json?.data || []).length}`);
  if ((bk.json?.data || []).length > 0) {
    const row = bk.json.data[0];
    for (const f of ['name', 'size', 'createdAt']) {
      check(`清单字段存在：${f}`, Object.prototype.hasOwnProperty.call(row, f));
    }
  } else {
    console.log('  ⚠️ 备份目录为空，跳过清单字段断言（不影响契约）');
  }

  console.log('\n[契约] 3. POST /api/system/auto-backup/run（立即备份）');
  const run = await api('/api/system/auto-backup/run', { method: 'POST', headers: auth });
  check('HTTP 200', run.status === 200, String(run.status));
  check('返回 ok=true', run.json?.ok === true, run.json?.error || run.json?.file || '');
  check('返回文件名 file', typeof run.json?.file === 'string' && run.json.file.length > 0, String(run.json?.file));
  check('返回字节数 size', Number.isFinite(Number(run.json?.size)) && Number(run.json.size) > 0, String(run.json?.size));

  const bk2 = await api('/api/system/backups', { headers: auth });
  check('备份后清单条数增加', (bk2.json?.data || []).length > (bk.json?.data || []).length,
    `${(bk.json?.data || []).length} → ${(bk2.json?.data || []).length}`);
  const fresh = (bk2.json?.data || []).find((f) => f.name === run.json?.file);
  check('新备份出现在清单中', !!fresh);
  check('新备份有 createdAt', !!fresh?.createdAt && !Number.isNaN(new Date(fresh.createdAt).getTime()), String(fresh?.createdAt));

  console.log('\n[契约] 4. GET /api/system/logs（SystemLogsCard）');
  // 先制造一条访问日志（上面的请求本身就是 GET，status 200）
  const lg = await api('/api/system/logs?type=access&lines=50', { headers: auth });
  check('HTTP 200', lg.status === 200, String(lg.status));
  check('success=true', lg.json?.success === true);
  for (const f of ['type', 'dir', 'keepDays', 'exists', 'total', 'lines']) {
    check(`字段存在：${f}`, Object.prototype.hasOwnProperty.call(lg.json || {}, f), String(Array.isArray(lg.json?.[f]) ? `array(${lg.json[f].length})` : lg.json?.[f]));
  }
  check('lines 为数组', Array.isArray(lg.json?.lines));
  if ((lg.json?.lines || []).length > 0) {
    const l = lg.json.lines[0];
    for (const f of ['at', 'method', 'path', 'status', 'ms']) {
      check(`访问日志字段存在：${f}`, Object.prototype.hasOwnProperty.call(l, f));
    }
    check('日志已掩码（不含 token= 明文值）', !/token=(?!\*\*\*)/i.test(String(l.path)), String(l.path).slice(0, 60));
  } else {
    console.log('  ⚠️ 当日无访问日志，跳过字段断言');
  }

  const lgErr = await api('/api/system/logs?type=error&lines=10', { headers: auth });
  check('错误日志接口可用', lgErr.status === 200 && Array.isArray(lgErr.json?.lines), String(lgErr.status));

  // 可证伪断言：负 lines 会被钳到下限 1，若返回多条说明未钳制（可能返回全量日志）
  const lgBad = await api('/api/system/logs?type=access&lines=-1', { headers: auth });
  check('负 lines 被钳到 1 条（不是返回全量）',
    lgBad.status === 200 && (lgBad.json?.lines || []).length === 1,
    `返回 ${(lgBad.json?.lines || []).length} 条，当日共 ${lgBad.json?.total} 条`);

  // 可证伪断言：必须真的写入明文 token 再验证掩码，否则任何路径都能"通过"
  const PLAIN = 'PLAINTOKEN-9f3a2b';
  await api(`/api/system/ping-mask-probe?token=${PLAIN}`, { headers: auth }).catch(() => {});
  const lgMask = await api('/api/system/logs?type=access&lines=200', { headers: auth });
  const probe = (lgMask.json?.lines || []).find((l) => String(l.path).includes('ping-mask-probe'));
  check('探针请求已写入日志', !!probe, probe ? String(probe.path) : '未找到（掩码断言无意义）');
  if (probe) {
    check('明文 token 已被掩码', !String(probe.path).includes(PLAIN), String(probe.path));
    check('掩码形式为 token=***', /token=\*\*\*/i.test(String(probe.path)), String(probe.path));
  }

  console.log('\n[契约] 5. 权限：非管理员不得访问');
  const { generateToken } = await import('../src/middleware/auth.js');
  const salesToken = generateToken({ id: 4, username: 'whq', role: 'sales', store_id: 1 });
  const a2 = { Authorization: `Bearer ${salesToken}` };
  const denied = await api('/api/system/auto-backup/status', { headers: a2 });
  check('sales 访问备份状态被拒', denied.status === 403, String(denied.status));
  const denied2 = await api('/api/system/logs', { headers: a2 });
  check('sales 访问日志被拒', denied2.status === 403, String(denied2.status));
  const denied3 = await api('/api/system/auto-backup/run', { method: 'POST', headers: { ...a2, 'Content-Type': 'application/json' } });
  check('sales 触发备份被拒', denied3.status === 403, String(denied3.status));
} catch (e) {
  fail++;
  failures.push(`异常：${e.message}`);
  console.error('  ❌ 运行异常:', e.message);
} finally {
  try { fs.unlinkSync(TMP_DB); } catch (e) { /* 忽略 */ }
  for (const suffix of ['-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* 忽略 */ }
  }
}

console.log(`\n${'='.repeat(48)}`);
console.log(`管理接口契约：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('失败项：', failures.join(' | ')); process.exit(1); }
process.exit(0);
