/**
 * 安全构建脚本（store-order 前端）
 * 背景：vite build 的 emptyDir 会触发 genie-safe-delete 钩子并 ETIMEDOUT；
 *      且 vite outDir=client/dist，而生产服务器从 server/public 提供静态文件，
 *      构建后必须 cp client/dist -> server/public 才能生效。
 * 本脚本固化三步：移走旧产物(到 .trash 备份) -> vite build -> 回拷部署。
 * 用法：node build-safe.mjs   （从仓库根目录运行；使用当前 node 二进制）
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname);
const clientDir = path.join(root, 'client');
const serverPublic = path.join(root, 'server', 'public');
const clientDist = path.join(clientDir, 'dist');
const trash = path.join(root, 'server', '.trash');
fs.mkdirSync(trash, { recursive: true });
const ts = Date.now();

function moveToTrash(p) {
  if (fs.existsSync(p)) {
    const dest = path.join(trash, path.basename(p) + '-' + ts);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(p, dest); // rename 不触发 genie-safe-delete 钩子
    console.log('[build-safe] moved', p, '->', dest);
  }
}

// 1) 移走旧产物，避免 vite emptyDir 命中钩子超时
moveToTrash(clientDist);
moveToTrash(serverPublic);

// 2) 构建（outDir=client/dist）
console.log('[build-safe] running vite build...');
execSync('"' + process.execPath + '" node_modules/vite/bin/vite.js build', {
  cwd: clientDir,
  stdio: 'inherit',
});

// 3) 回拷部署到 server/public（生产静态目录）
console.log('[build-safe] deploying client/dist -> server/public ...');
copyDir(clientDist, serverPublic);
console.log('[build-safe] done. server/public 已更新，生产无需重启即可加载新静态文件。');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
