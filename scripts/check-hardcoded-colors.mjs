#!/usr/bin/env node
/**
 * 防复发自检脚本 — 扫描前端源码中新引入的硬编码十六进制色值
 *
 * 用法：
 *   node scripts/check-hardcoded-colors.mjs          # 扫描全部
 *   node scripts/check-hardcoded-colors.mjs --fix    # 仅打印不修改（默认）
 *
 * 规则：
 *   1. CSS 文件（index.css / ui.css / table.css）：允许在 :root / [data-theme] 令牌定义中使用 #hex；
 *      令牌定义行之外出现的 #hex（且未被 var() 包裹）视为违规。
 *   2. JSX/JS 文件：任何 #hex 字面量视为违规（应改用 var(--token) 或常量引用）。
 *   3. 白名单：注释中的 #hex、url(data:...) 中的片段不扫描。
 *
 * 退出码：0 = 无违规；1 = 发现违规（CI 可拦截）
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientSrc = join(__dirname, '..', 'client', 'src');

const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const CSS_TOKEN_DEF = /^\s*--[\w-]+\s*:/;  // 令牌定义行特征

let violations = 0;
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else {
      const ext = extname(name);
      if (['.css', '.jsx', '.js', '.mjs'].includes(ext)) files.push(full);
    }
  }
}

walk(clientSrc);

for (const file of files) {
  const lines = readFileSync(file, 'utf-8').split('\n');
  const isCSS = extname(file) === '.css';
  const isInTokenBlock = [];  // 栈：追踪是否在 :root / [data-theme] 块内

  lines.forEach((line, i) => {
    const ln = i + 1;
    // 跳过注释行
    if (line.trim().startsWith('//') || line.trim().startsWith('/*')) return;
    // 跳过 data:url
    if (line.includes('data:image') || line.includes('data:application')) return;

    // CSS：追踪令牌定义块
    if (isCSS) {
      if (line.includes('{')) isInTokenBlock.push(line.includes(':root') || line.includes('data-theme'));
      if (line.includes('}')) isInTokenBlock.pop();
    }

    let match;
    HEX_RE.lastIndex = 0;
    while ((match = HEX_RE.exec(line)) !== null) {
      const hex = match[0];
      const col = match.index;

      // CSS 令牌定义行：允许
      if (isCSS && CSS_TOKEN_DEF.test(line)) continue;
      // CSS 在 :root / [data-theme] 块内的属性行：允许（令牌赋值）
      if (isCSS && isInTokenBlock.includes(true)) continue;
      // 已知安全白名单：#fff / #000 用于 antd 覆盖中的 color: #fff !important
      if (hex === '#fff' || hex === '#ffffff' || hex === '#000' || hex === '#000000') continue;

      violations++;
      const rel = file.replace(clientSrc + '/', '');
      console.log(`  [VIOLATION] ${rel}:${ln}:${col}  ${hex}  <- ${line.trim().slice(0, 80)}`);
    }
  });
}

if (violations === 0) {
  console.log('OK: no hardcoded hex colors found in client/src.');
  process.exit(0);
} else {
  console.log(`\nFAIL: ${violations} hardcoded hex color(s) found.`);
  console.log('Rule: use var(--token) from index.css :root instead of inline #hex.');
  console.log('Run: node scripts/check-hardcoded-colors.mjs');
  process.exit(1);
}
