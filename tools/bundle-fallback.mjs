/**
 * tools/bundle-fallback.mjs
 * 无 esbuild 时的兜底打包器（风险 K6 的落地方案）。
 *
 * 它**不是**通用打包器，只支持本项目源码遵守的 4 条纪律（构建时强制校验，违反即报错退出）：
 *   D1 只用 `import { a, b } from './相对路径.js';` 单行静态导入；不写 import * as / 默认导入 / 动态 import()
 *   D2 只导出具名声明：`export function|const|let|var|class|async function NAME`
 *   D3 所有模块顶层声明的名字**全仓唯一**（含非导出的顶层 const/function），因为拼接后共享一个作用域
 *   D4 依赖图必须是 DAG（无循环依赖）
 *
 * 输出：`(function(){"use strict"; /* 各模块按拓扑序展开 *\/ })();`
 * 体积比 esbuild 路径大（不压缩），但仍满足单文件 < 600KB 硬门禁。
 */
import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /^[ \t]*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?[ \t]*\r?$/gm;
const EXPORT_PREFIX_RE = /^export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/gm;
const TOP_LEVEL_DECL_RE = /^(?:async\s+function|function|class|const|let|var)\s+([A-Za-z0-9_$]+)/;

/** 读取一个模块：返回 { file, deps, declaredTopLevel, exported, code } */
function readModule(absFile) {
  const raw = fs.readFileSync(absFile, 'utf8');
  if (/\bimport\s*\(/.test(raw)) throw new Error(`[D1] 出现动态 import()：${absFile}`);
  if (/^\s*import\s+\*/m.test(raw)) throw new Error(`[D1] 出现 import * as：${absFile}`);
  if (/^\s*import\s+(?!\{)[A-Za-z_$]/m.test(raw)) throw new Error(`[D1] 出现默认导入：${absFile}`);
  if (/^\s*export\s+(?:default|\{|\*)/m.test(raw)) throw new Error(`[D2] 出现 export default / export {} / export *：${absFile}`);

  const deps = [];
  let code = raw.replace(IMPORT_RE, (_m, names, spec) => {
    deps.push({ spec, names: names.split(',').map((s) => s.trim()).filter(Boolean) });
    return '';
  });

  // 收集导出名（先收集，再剥 export 前缀——否则前缀已被剥掉就认不出了）
  const exported = [];
  const expRe = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = expRe.exec(code))) exported.push(m[1]);

  code = code.replace(EXPORT_PREFIX_RE, '');

  // 收集所有顶层声明名（用于全仓唯一性校验）
  const declaredTopLevel = [];
  for (const line of code.split('\n')) {
    if (!line || /^\s/.test(line)) continue;
    const dm = TOP_LEVEL_DECL_RE.exec(line);
    if (dm) declaredTopLevel.push(dm[1]);
  }

  return { file: absFile, deps, declaredTopLevel, exported, code: code.replace(/\/\/#[ \t]*sourceMappingURL=.*/g, '') };
}

/**
 * @param {string} entryAbs 入口文件绝对路径
 * @returns {{code:string, order:string[], bytes:number}}
 */
export function bundleFallback(entryAbs) {
  const modules = new Map(); // absFile -> module
  const visiting = new Set();

  function visit(absFile) {
    if (modules.has(absFile)) return;
    if (visiting.has(absFile)) throw new Error(`[D4] 循环依赖：${absFile}`);
    visiting.add(absFile);
    const mod = readModule(absFile);
    modules.set(absFile, mod);
    for (const dep of mod.deps) {
      const depAbs = path.resolve(path.dirname(absFile), dep.spec);
      if (!fs.existsSync(depAbs)) throw new Error(`导入目标不存在：${dep.spec}（来自 ${absFile}）`);
      visit(depAbs);
    }
    visiting.delete(absFile);
  }
  visit(entryAbs);

  // 拓扑序：依赖在前
  const order = [];
  const done = new Set();
  function emit(absFile) {
    if (done.has(absFile)) return;
    done.add(absFile);
    const mod = modules.get(absFile);
    for (const dep of mod.deps) emit(path.resolve(path.dirname(absFile), dep.spec));
    order.push(absFile);
  }
  emit(entryAbs);

  // D3：全仓顶层名唯一
  const seen = new Map();
  for (const absFile of order) {
    const mod = modules.get(absFile);
    for (const name of mod.declaredTopLevel) {
      if (seen.has(name)) {
        throw new Error(`[D3] 顶层名重复：${name}\n  第一次：${seen.get(name)}\n  第二次：${absFile}`);
      }
      seen.set(name, absFile);
    }
  }

  const body = order
    .map((absFile) => `/* ${path.relative(path.dirname(path.dirname(entryAbs)), absFile).replace(/\\/g, '/')} */\n${modules.get(absFile).code.trim()}`)
    .join('\n;\n');

  const code = `(function(){"use strict";\n${body}\n})();\n`;
  return { code, order, bytes: Buffer.byteLength(code, 'utf8'), topLevelNames: [...seen.keys()] };
}
