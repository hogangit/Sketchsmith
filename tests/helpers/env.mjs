/**
 * tests/helpers/env.mjs —— 在 node 里把 vendor 的 UMD 库装到 globalThis，
 * 然后动态 import src 模块（src 里 `const MATTER = Matter` 在模块求值时就要能看到全局）。
 *
 * 这样 core / stroke / physics / level 四层可以在没有 DOM 的情况下整关跑物理。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

function loadUMD(relFile) {
  const file = path.join(ROOT, relFile);
  const sandbox = { module: { exports: {} }, exports: {}, window: {}, self: {}, console };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: relFile });
  return sandbox.module.exports.Matter || sandbox.module.exports || sandbox.rough;
}

export async function loadGameEnv() {
  if (!globalThis.Matter) {
    const matterNs = loadUMD('vendor/matter.min.js');
    globalThis.Matter = matterNs.Matter || matterNs;
    const decompNs = loadUMD('vendor/decomp.min.js');
    globalThis.decomp = decompNs.decomp || decompNs;
    const roughNs = loadUMD('vendor/rough.umd.js');
    globalThis.rough = roughNs.rough || roughNs;
  }
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const [geometry, simplify, classify, materials, budget, nanGuard, world, bodyFactory,
    registry, compose, combos, schema, runtime, l1, l2, l3] = await Promise.all([
    imp('src/stroke/geometry.js'),
    imp('src/stroke/simplify.js'),
    imp('src/stroke/classify.js'),
    imp('src/physics/materials.js'),
    imp('src/physics/budget.js'),
    imp('src/physics/nan-guard.js'),
    imp('src/physics/world.js'),
    imp('src/physics/body-factory.js'),
    imp('src/abilities/registry.js'),
    imp('src/abilities/compose.js'),
    imp('src/abilities/combos.js'),
    imp('src/level/schema.js'),
    imp('src/level/runtime.js'),
    imp('src/level/levels/ch1-01.js'),
    imp('src/level/levels/ch1-02.js'),
    imp('src/level/levels/ch1-03.js'),
  ]);
  return {
    geometry, simplify, classify, materials, budget, nanGuard, world, bodyFactory,
    registry, compose, combos, schema, runtime, levels: { l1, l2, l3 },
  };
}

/** 造一条“人手画的”直线（带轻微抖动，不完美水平） */
export function synthLine(x1, y1, x2, y2, step, jitter) {
  const pts = [];
  const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / (step || 4)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({
      x: x1 + (x2 - x1) * t + (Math.sin(i * 1.7) * (jitter || 0.8)),
      y: y1 + (y2 - y1) * t + (Math.cos(i * 2.3) * (jitter || 0.8)),
    });
  }
  return pts;
}

/** 造一个“人手画的”扁长方形闭合圈（左右上下四条边都带抖动，首尾留缺口） */
export function synthRect(cx, cy, w, h, gapPx) {
  const hw = w / 2, hh = h / 2;
  const corners = [
    [cx - hw + (gapPx || 5), cy - hh], [cx + hw, cy - hh],
    [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh + (gapPx || 5)],
  ];
  const pts = [];
  for (let i = 1; i < corners.length; i++) {
    const [x1, y1] = corners[i - 1];
    const [x2, y2] = corners[i];
    const n = Math.max(3, Math.round(Math.hypot(x2 - x1, y2 - y1) / 5));
    const last = i === corners.length - 1;
    for (let k = 0; k < n + (last ? 1 : 0); k++) {
      const t = k / n;
      pts.push({
        x: x1 + (x2 - x1) * t + Math.sin((i * 7 + k) * 1.3) * 0.7,
        y: y1 + (y2 - y1) * t + Math.cos((i * 5 + k) * 1.9) * 0.7,
      });
    }
  }
  return pts;
}

/** 造一个“人手画的”圆（首尾不相接，留 6px 缺口 → 交给闭合检测判闭合） */
export function synthCircle(cx, cy, r, gapPx) {
  const pts = [];
  const gap = (gapPx || 0) / r;
  const total = Math.PI * 2 - gap;
  const n = Math.max(24, Math.round((r * total) / 4));
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * total - Math.PI * 0.25;
    const rr = r * (1 + Math.sin(i * 1.9) * 0.012);
    pts.push({ x: cx + Math.cos(t) * rr, y: cy + Math.sin(t) * rr });
  }
  return pts;
}
