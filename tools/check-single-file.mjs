/**
 * tools/check-single-file.mjs
 * 单文件产物的强制断言（tech-baseline-v1 第 2 节 / 第 4 节 P7·P8 / 第 11 节 L1·L2·L5）。
 * 任一条不通过 → exit 1，不许发布。
 *
 * 用法：
 *   node tools/check-single-file.mjs            # 检查 dist/game.html（不存在则回退 index.html）
 *   node tools/check-single-file.mjs <file>     # 检查指定文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** 硬门禁：单文件体积上限（字节，未压缩） */
export const MAX_BYTES = 600000;

/** 架构违规红线 L5 要求「已绑定降级」的契约函数名必须真实存在 */
const CONTRACT_NAMES = [
  'PerfGovernor', 'sample', 'setTier',
  'RenderQuality', 'setFill', 'setShadow',
  'setSubSteps', 'BodyBudget', 'trySpawn', 'setMax',
  'StrokeBudget', 'skipIntro', 'NaNGuard', 'sweep',
];

/** 去掉许可声明块与 /*! *\/ 版权横幅后再查外链——这两处允许出现 URL（MIT 声明义务） */
export function stripAllowedUrls(html) {
  let out = html.replace(/<script[^>]*id="licenses"[^>]*>[\s\S]*?<\/script>/g, '');
  out = out.replace(/\/\*![\s\S]*?\*\//g, '');
  // XML 命名空间是**标识符**不是地址（rough.js 里 SVG 命名空间常量），永远不会被请求，予以放行。
  out = out.replace(/https?:\/\/www\.w3\.org\/[^\s"'<>]*/g, '');
  return out;
}

/**
 * @param {string} filePath
 * @returns {{ok:boolean, checks:Array<{name:string, ok:boolean, detail:string}>, bytes:number}}
 */
export function assertSingleFile(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const bytes = Buffer.byteLength(html, 'utf8');
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('P7 体积 ≤ 600,000 B', bytes <= MAX_BYTES, `${bytes} B（上限 ${MAX_BYTES}）`);

  const noSrc = (html.match(/<script[^>]*\ssrc\s*=/gi) || []).length;
  const noLink = (html.match(/<link\b/gi) || []).length;
  const noAttr = (html.match(/\s(?:src|href)\s*=\s*["']/gi) || []).length;
  add('单文件自足：无外部 <script src>', noSrc === 0, `命中 ${noSrc}`);
  add('单文件自足：无 <link>', noLink === 0, `命中 ${noLink}`);
  add('P8 零外链：无 src=/href= 属性', noAttr === 0, `命中 ${noAttr}`);

  const stripped = stripAllowedUrls(html);
  const url = (stripped.match(/https?:\/\//g) || []).length;
  const fet = (stripped.match(/\bfetch\s*\(/g) || []).length;
  const xhr = (stripped.match(/XMLHttpRequest/g) || []).length;
  const dyn = (stripped.match(/\bimport\s*\(/g) || []).length;
  add('P8 零外链：无 http(s):// 字面量（许可块除外）', url === 0, `命中 ${url}`);
  add('P8 零外链：无 fetch(', fet === 0, `命中 ${fet}`);
  add('P8 零外链：无 XMLHttpRequest', xhr === 0, `命中 ${xhr}`);
  add('零外链：无动态 import()', dyn === 0, `命中 ${dyn}`);

  const sm = (html.match(/sourceMappingURL/g) || []).length;
  add('无 sourcemap 引用', sm === 0, `命中 ${sm}`);

  const licMatch = html.match(/<script[^>]*id="licenses"[^>]*>([\s\S]*?)<\/script>/);
  const lic = licMatch ? licMatch[1] : '';
  const libNames = ['matter-js', 'poly-decomp', 'roughjs', 'perfect-freehand'];
  const licOk = !!lic && /MIT/i.test(lic) && /Permission is hereby granted/i.test(lic) && libNames.every((n) => lic.includes(n));
  add('含 MIT 版权块（4 个库 + 许可正文）', licOk, licOk ? `${lic.length} 字符` : '缺失或不完整');

  const leak = ['build.mjs', 'bundle-fallback', '.test.', 'node:test'].filter((s) => html.includes(s));
  add('L2 生成器/测试未被打进产物', leak.length === 0, leak.length ? `命中 ${leak.join(',')}` : '干净');

  const missing = CONTRACT_NAMES.filter((n) => !html.includes(n));
  add('L5 降级契约函数名齐全', missing.length === 0, missing.length ? `缺 ${missing.join(',')}` : `${CONTRACT_NAMES.length} 个名字齐全`);

  return { ok: checks.every((c) => c.ok), checks, bytes };
}

function main() {
  const arg = process.argv[2];
  const candidates = arg ? [arg] : [path.join(ROOT, 'dist', 'game.html'), path.join(ROOT, 'index.html')];
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    console.error('[check-single-file] 找不到产物，先跑 node tools/build.mjs');
    process.exit(1);
  }
  const { ok, checks, bytes } = assertSingleFile(filePath);
  console.log(`\n[check-single-file] ${path.relative(ROOT, filePath)}  ${bytes} B`);
  for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  —  ${c.detail}`);
  console.log(ok ? '  => 全部通过\n' : '  => 有断言失败，不许发布\n');
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
