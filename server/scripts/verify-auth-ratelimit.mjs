// 登录限流集成验证（在数据库副本上跑，生产库零接触）
// 目的：证明「限流生效」的同时「正确密码仍能登录」——后者若被改坏会把所有人锁在系统外。
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';

const src = 'data/store.db';
const tmp = path.join(os.tmpdir(), `_auth-rl-test-${Date.now()}.db`);
fs.copyFileSync(src, tmp);
process.env.DB_PATH = tmp;

const { default: authRouter } = await import('../src/routes/auth.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}/api/auth`;

async function login(username, password) {
  const r = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  let body = {};
  try { body = await r.json(); } catch { /* 忽略非 JSON 响应 */ }
  return { status: r.status, body };
}

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

try {
  // 0) 先确认正确密码可登录（基线：限流不能误伤正常用户）
  console.log('场景0  正确密码登录（限流不应拦截）');
  const ok = await login('admin', 'admin123');
  check('正确密码返回 200 且带 token', ok.status === 200 && !!ok.body.token, `实际 status=${ok.status} body=${JSON.stringify(ok.body)}`);

  // 1) 连续错误密码：前 4 次应 401 并提示剩余次数，第 5 次应 429 锁定
  console.log('\n场景1  连续 5 次错误密码');
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await login('admin', `wrong-${i}`);
    codes.push(r.status);
  }
  console.log('  状态码序列: ' + codes.join(', '));
  check('前 4 次为 401（未锁定，仅提示剩余次数）', codes.slice(0, 4).every(c => c === 401), `实际 ${codes.slice(0, 4)}`);
  check('第 5 次为 429（触发锁定）', codes[4] === 429, `实际 ${codes[4]}`);

  // 2) 锁定期间即使密码正确也应被拒（这正是限流的目的）
  console.log('\n场景2  锁定期间用正确密码登录（应被拒）');
  const during = await login('admin', 'admin123');
  check('锁定期间正确密码返回 429', during.status === 429, `实际 ${during.status} ${JSON.stringify(during.body)}`);

  // 3) 换个用户名不应被连坐（证明锁定粒度是「用户名 + IP」而非全局）
  console.log('\n场景3  另一个账号不应被连坐');
  const other = await login('boss', 'wrong-password');
  check('其他账号仍返回 401 而非 429（未被连坐）', other.status === 401, `实际 ${other.status}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
} finally {
  server.close();
  try { fs.unlinkSync(tmp); } catch { /* 清理失败不影响结果 */ }
  try {
    for (const ext of ['-wal', '-shm']) { if (fs.existsSync(tmp + ext)) fs.unlinkSync(tmp + ext); }
  } catch { /* 忽略 */ }
  console.log('[清理] 临时测试库已删除');
  process.exit(fail > 0 ? 1 : 0);
}
