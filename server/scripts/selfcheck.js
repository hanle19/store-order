/**
 * 启动自检：对 server/src 全部 .js 做 `node --check` 语法校验。
 * 防止单个文件语法错误（如字符串引号误用）导致整个后端无法启动。
 * 用法：cd server && ../nodejs/node.exe scripts/selfcheck.js
 * 退出码：0 全部通过；1 存在语法错误。
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

function collect(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = collect(srcDir);
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log(`  OK   ${path.relative(srcDir, f)}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${path.relative(srcDir, f)}`);
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}
console.log('----------------------------------------');
if (failed) {
  console.error(`自检失败：${failed}/${files.length} 个文件存在语法错误，禁止启动。`);
  process.exit(1);
}
console.log(`自检通过：${files.length} 个文件语法全部正确。`);
