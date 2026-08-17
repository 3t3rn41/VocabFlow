/**
 * VocabFlow 桌面端构建脚本
 *
 * 执行流程：
 *   1. tsc -b && vite build          — 前端构建
 *   2. server: build:bundle           — 后端 esbuild 打包为 CJS bundle
 *   3. 复制 sql-wasm.wasm 到 dist    — 供 Tauri 打包为资源
 *
 * 用法：node scripts/build-desktop.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, cwd = ROOT) {
  console.log(`[build:desktop] > ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function copyFile(src, dest) {
  console.log(`[build:desktop] copy ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
  fs.copyFileSync(src, dest);
}

/* ---- 1. 前端构建 ---- */
run('npm run build');

/* ---- 2. 后端 bundle 打包 ---- */
run('npm run build:bundle', path.join(ROOT, 'server'));

/* ---- 3. 复制 sql-wasm.wasm ---- */
// sql.js 可能在根目录或 server 子项目的 node_modules 中
const wasmCandidates = [
  path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  path.join(ROOT, 'server', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
];
const wasmSrc = wasmCandidates.find((p) => fs.existsSync(p));
if (!wasmSrc) {
  console.error('[build:desktop] 找不到 sql-wasm.wasm，尝试过的路径:');
  wasmCandidates.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}
const wasmDest = path.join(ROOT, 'server', 'dist', 'sql-wasm.wasm');
const distDir = path.join(ROOT, 'dist');
const wasmDistDest = path.join(distDir, 'sql-wasm.wasm');

// 复制到 server/dist（Tauri resources 引用路径）
copyFile(wasmSrc, wasmDest);

// 复制到 dist（前端静态资源）
if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
copyFile(wasmSrc, wasmDistDest);

console.log('[build:desktop] 完成 ✓');
