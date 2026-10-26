/**
 * tools/build.mjs —— 一条命令产出单文件（tech-baseline-v1 第 2 节 B1/B2/B3）
 *
 *   node tools/build.mjs            # 完整构建 → dist/game.html + 根 index.html
 *   node tools/build.mjs --check    # 只跑断言，不写文件
 *   node tools/build.mjs --no-esbuild  # 强制走兜底拼接路径（用于验证 K6）
 *
 * 能力探测（风险 K6）：装了 esbuild 就用它压缩 src/main.js；没装就用自己的拼接器
 * （tools/bundle-fallback.mjs）把 ESM 源码顺序展开。**没网、没 npm、没法装依赖也能出包。**
 * vendor/ 里 4 个库是已构建的 IIFE/UMD 快照，两条路径都只是字符串拼接，不依赖构建工具。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { bundleFallback } from './bundle-fallback.mjs';
import { assertSingleFile, MAX_BYTES } from './check-single-file.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const P = (...s) => path.join(ROOT, ...s);

const VENDOR_ORDER = [
  ['matter-js 0.20.0', 'vendor/matter.min.js'],
  ['poly-decomp 0.3.0', 'vendor/decomp.min.js'],
  ['roughjs 4.6.6', 'vendor/rough.umd.js'],
  ['perfect-freehand 1.2.3', 'vendor/perfect-freehand.umd.js'],
];

const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\n[build] 失败：${msg}\n`); process.exit(1); };

/** 探测 esbuild：只看本仓库 node_modules / 全局解析结果，装不上就返回 null */
async function probeEsbuild() {
  try {
    const require = createRequire(pathToFileURL(path.join(ROOT, 'noop.js')));
    const entry = require.resolve('esbuild');
    const mod = await import(pathToFileURL(entry).href);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

/** 内联进 <script> 的文本必须切断 </script>，否则提前闭合 */
const guard = (s) => s.replace(/<\/script/gi, '<\\/script');

function inlineScript(code) {
  return `<script>\n${guard(code)}\n</script>`;
}

async function buildApp(useEsbuild) {
  const entry = P('src/main.js');
  if (useEsbuild) {
    const args = {
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      target: 'es2019',
      minify: true,
      write: false,
      legalComments: 'none',
      charset: 'utf8',
      logLevel: 'silent',
    };
    const out = await useEsbuild.build(args);
    return { code: out.outputFiles[0].text, mode: 'esbuild(min)' };
  }
  const r = bundleFallback(entry);
  return { code: r.code, mode: `fallback-concat(${r.order.length} modules, 未压缩)` };
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const forceFallback = argv.includes('--no-esbuild');

  fs.mkdirSync(P('dist'), { recursive: true });

  if (checkOnly) {
    const f = fs.existsSync(P('dist/game.html')) ? P('dist/game.html') : P('index.html');
    if (!fs.existsSync(f)) fail('没有可检查的产物，先跑 node tools/build.mjs');
    report(f);
    return;
  }

  const esbuild = forceFallback ? null : await probeEsbuild();
  log(`[build] 打包器：${esbuild ? 'esbuild（已探测到）' : '兜底拼接器（未探测到 esbuild，K6 降级路径）'}`);

  // ---- B1 厂商库：已构建的 IIFE/UMD 快照，按序拼接 ----
  const vendorParts = [];
  for (const [label, rel] of VENDOR_ORDER) {
    const abs = P(rel);
    if (!fs.existsSync(abs)) fail(`缺少 vendor 文件 ${rel}（见 README「离线重建」）`);
    const src = fs.readFileSync(abs, 'utf8');
    vendorParts.push(`/* ==== ${label} ==== */\n${src}`);
  }
  const vendorCode = vendorParts.join('\n;\n');
  fs.writeFileSync(P('dist/_vendor.js'), vendorCode);

  // ---- B2 应用 ----
  const app = await buildApp(esbuild);
  fs.writeFileSync(P('dist/_app.js'), app.code);

  // ---- B3 模板注入（函数式 replace，避免 $& 语义吞掉代码里的 $）----
  const template = fs.readFileSync(P('template/index.html'), 'utf8');
  const licenses = fs.readFileSync(P('vendor/LICENSES.txt'), 'utf8');
  const licBlock = `<script type="text/plain" id="licenses">\n${guard(licenses)}\n</script>`;

  const slots = { '<!--__VENDOR__-->': inlineScript(vendorCode), '<!--__APP__-->': inlineScript(app.code), '<!--__LICENSES__-->': licBlock };
  let html = template;
  for (const [slot, payload] of Object.entries(slots)) {
    if (!html.includes(slot)) fail(`模板缺少占位符 ${slot}`);
    html = html.replace(slot, () => payload);
  }

  fs.writeFileSync(P('dist/game.html'), html);

  const r = report(P('dist/game.html'));
  if (!r.ok) fail('断言未通过，未生成根 index.html（P7 门禁）');

  fs.copyFileSync(P('dist/game.html'), P('index.html'));
  log(`[build] 产物：dist/game.html (${r.bytes} B)`)
  log(`[build] 发布副本：index.html (${fs.statSync(P('index.html')).size} B)`)
  log(`[build] 应用打包方式：${app.mode}`);
}

function report(file) {
  const r = assertSingleFile(file);
  log(`\n[build] 断言 ${path.relative(ROOT, file)}  ${r.bytes} B / 上限 ${MAX_BYTES} B`);
  for (const c of r.checks) log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  —  ${c.detail}`);
  return r;
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
