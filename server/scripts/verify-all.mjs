// server/scripts/verify-all.mjs
// 回归测试网总入口：一条命令跑完全部验证套件，改完代码用它兜底。
//   cd server && npm run verify
// 顺序执行（非并行）——各套件都要起服务/占端口，并行会抢端口。
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: '登录限流', file: 'verify-auth-ratelimit.mjs' },
  { name: '聚合缓存', file: 'verify-aggcache.mjs' },
  { name: '库存口径同步', file: 'verify-variant-stock-sync.mjs' },
  { name: '自动备份', file: 'verify-autobackup.mjs' },
  { name: '核心业务流', file: 'verify-business-flows.mjs' },
  { name: '端到端冒烟', file: 'verify-smoke-e2e.mjs' },
  { name: '深度可证伪', file: 'verify-smoke-deep.mjs' },
  { name: '管理接口契约', file: 'verify-admin-api-contract.mjs' },
  { name: '版本化迁移', file: 'verify-migrations.mjs' },
  { name: '审计覆盖', file: 'verify-audit.mjs' },
  { name: '服务层单测', file: 'verify-services.mjs' },
  { name: '送货权限与状态机', file: 'verify-delivery-auth.mjs' },
];

// 从套件输出中提取 "X / Y" 或 "X/Y" 形式的通过数（不同脚本格式不一，做宽松匹配）
function extractCounts(out) {
  const m = /(\d+)\s*\/\s*(\d+)/g;
  let last = null;
  let mm;
  while ((mm = m.exec(out)) !== null) last = mm;
  return last ? { pass: Number(last[1]), total: Number(last[2]) } : null;
}

const results = [];
let failed = 0;
const startedAt = Date.now();

for (const s of SUITES) {
  const fp = path.join(__dirname, s.file);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [fp], { encoding: 'utf8', env: process.env });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = r.status === 0;
  const c = extractCounts(out);
  const ms = Date.now() - t0;
  results.push({ ...s, ok, ms, counts: c });

  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`\n${ok ? '✅' : '❌'} [${tag}] ${s.name}  (${(ms / 1000).toFixed(1)}s${c ? `, ${c.pass}/${c.total}` : ''})`);
  if (!ok) {
    failed++;
    // 失败时打印最后 25 行，够定位又不会淹没控制台
    const tail = out.trim().split('\n').slice(-25).join('\n');
    console.log('─'.repeat(60));
    console.log(tail);
    console.log('─'.repeat(60));
  }
}

const totalMs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n${'═'.repeat(60)}`);
console.log(`回归汇总：${results.length - failed}/${results.length} 套件通过（耗时 ${totalMs}s）`);
for (const r of results) {
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(14, '　')} ${(r.ms / 1000).toFixed(1)}s${r.counts ? `  ${r.counts.pass}/${r.counts.total}` : ''}`);
}
console.log('═'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
