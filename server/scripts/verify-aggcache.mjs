// 聚合缓存验证（在数据库副本上跑，生产库零接触）
// 三个必测点：命中、写后自动失效、不同维度 key 不串数据
import fs from 'fs';
import os from 'os';
import path from 'path';

const src = 'data/store.db';
const tmp = path.join(os.tmpdir(), `_aggcache-test-${Date.now()}.db`);
fs.copyFileSync(src, tmp);
process.env.DB_PATH = tmp;

const { getDb } = await import('../src/db.js');
const aggCache = await import('../src/utils/aggCache.js');

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

try {
  const db = getDb();
  const kA = 'dash|admin|1|all|2026|9';
  const kB = 'dash|sales|7|all|2026|9'; // 不同角色+用户，必须拿到不同结果

  console.log('场景1  缓存命中');
  aggCache.set(db, kA, { who: 'admin' });
  const hitA = aggCache.get(db, kA);
  check('同一 key 命中且值正确', !!hitA && hitA.value.who === 'admin', `实际 ${JSON.stringify(hitA)}`);

  console.log('\n场景2  不同维度 key 互不干扰（防串数据）');
  aggCache.set(db, kB, { who: 'sales7' });
  const afterB = aggCache.get(db, kA);
  check('写入 B 后 A 仍读到自己的值', !!afterB && afterB.value.who === 'admin', `实际 ${JSON.stringify(afterB)}`);
  const hitB = aggCache.get(db, kB);
  check('B 读到自己的值', !!hitB && hitB.value.who === 'sales7', `实际 ${JSON.stringify(hitB)}`);

  console.log('\n场景3  写操作后自动失效（核心：不能让用户看到陈旧数据）');
  const before = aggCache.get(db, kA);
  check('写入前 A 仍命中', !!before);
  // 造一条新订单，指纹应改变
  db.prepare(`INSERT INTO orders (order_no, customer_name, status, total_amount, created_at, updated_at)
    VALUES (?,?,?,?,datetime('now','localtime'),datetime('now','localtime'))`)
    .run('TEST-CACHE-001', '缓存测试', 'pending', 1);
  const afterWrite = aggCache.get(db, kA);
  check('新增订单后缓存自动失效', afterWrite === undefined, `实际仍命中 ${JSON.stringify(afterWrite)}`);

  console.log('\n场景4  失效后重新写入并可再次命中');
  aggCache.set(db, kA, { who: 'admin2' });
  const reHit = aggCache.get(db, kA);
  check('重新写入后命中新值', !!reHit && reHit.value.who === 'admin2', `实际 ${JSON.stringify(reHit)}`);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
} finally {
  try { fs.unlinkSync(tmp); } catch { /* 忽略 */ }
  for (const ext of ['-wal', '-shm']) { try { if (fs.existsSync(tmp + ext)) fs.unlinkSync(tmp + ext); } catch { /* 忽略 */ } }
  console.log('[清理] 临时测试库已删除');
  process.exit(fail > 0 ? 1 : 0);
}
