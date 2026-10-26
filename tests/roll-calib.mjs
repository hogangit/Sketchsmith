/**
 * tests/roll-calib.mjs —— `会滚` 的**口径标定**（只在 8° 台架上，关2 里不出现"滚"字）
 *
 * 团队口径：不许用单次数字定阈值。要 median / p90，并且必须带 **negative control**
 * （`friction = 0` 那一版被否决的实现必须在这套口径下 FAIL）。
 *
 * 三组，各 9 次（9 次之间只变"手画的圆"本身：半径 ±2、抖动、缺口，不变物理参数）：
 *   A 基线（不加能力）        B `会滚`（frictionAir ×0.25）        C 已否决的 friction = 0
 *
 * 判定：
 *   · C 必须 FAIL：它**不转**（打滑不是滚），p90 自转角 < 0.2 rad；
 *   · 区分力：若 median(B) 没有超过 p90(A)，则"位移"这条口径**没有区分力、阈值作废**（照实打印，不硬凑）。
 *
 * 用法：node tests/roll-calib.mjs
 */
import { loadGameEnv, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const M = globalThis.Matter;
const { classify, world, bodyFactory } = env;

const N = 9;
const RAMP_ANGLE = 0.1396;   // 8°

function bench(strokes, mods, seconds = 3) {
  const w = world.createPhysicsWorld();
  const r = M.Bodies.rectangle(215, 260, 460, 16, { isStatic: true, angle: RAMP_ANGLE });
  r.friction = 0.9; r.frictionStatic = 1.0; r.restitution = 0;
  w.addBody(r);
  const geo = classify.analyzeStrokeGroup([{ pts: strokes }]);
  const built = bodyFactory.buildCreatureBody({
    form: geo.form, geo, thickness: 9, spawn: { x: 215, y: 700 }, mods, flags: {},
  });
  for (const b of built.bodies) w.addBody(b);
  const bodies = built.bodies.filter((b) => !b.isStatic);
  const cx = bodies.reduce((s, b) => s + b.position.x, 0) / bodies.length;
  const cy = bodies.reduce((s, b) => s + b.position.y, 0) / bodies.length;
  const faceY = 260 + (60 - 215) * Math.tan(RAMP_ANGLE) - 30;
  for (const b of bodies) M.Body.translate(b, { x: 60 - cx, y: faceY - cy });
  const x0 = bodies[0].position.x;
  for (let f = 0; f < Math.round(seconds * 60); f++) w.step();
  const out = { dist: bodies[0].position.x - x0, ang: Math.abs(bodies[0].angle) };
  w.clear();
  return out;
}

/** 9 个"手画的圆"：只改画法，不改物理 */
function shapes() {
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push(synthCircle(215, 700, 24 + (i % 5), 4 + (i % 3)));
  }
  return out;
}

function stats(vals) {
  const s = vals.slice().sort((a, b) => a - b);
  const q = (p) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return { min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

const SH = shapes();
const GROUPS = [
  ['A 基线', {}, false],
  ['B 会滚', { frictionAirMul: 0.25 }, false],
  ['C friction=0（已否决）', { friction: 0, frictionStatic: 0 }, true],
];

console.log(`# 8° 台架 · 3 秒 · 每组 ${N} 次（只变画法，不变物理）\n`);
const res = {};
for (const [name, mods] of GROUPS) {
  const rows = SH.map((s) => bench(s, mods));
  res[name] = {
    dist: stats(rows.map((r) => r.dist)),
    ang: stats(rows.map((r) => r.ang)),
  };
  const d = res[name].dist, a = res[name].ang;
  console.log(`${name.padEnd(24)} 位移 min ${d.min.toFixed(0)} / median ${d.median.toFixed(0)} / p90 ${d.p90.toFixed(0)} / max ${d.max.toFixed(0)} px`);
  console.log(`${''.padEnd(24)} 自转 min ${a.min.toFixed(2)} / median ${a.median.toFixed(2)} / p90 ${a.p90.toFixed(2)} / max ${a.max.toFixed(2)} rad`);
}

const A = res['A 基线'], B = res['B 会滚'], C = res['C friction=0（已否决）'];
let bad = 0;
function chk(ok, label, detail) {
  if (!ok) bad++;
  console.log(`\n  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
}

chk(C.ang.p90 < 0.2, 'negative control：friction=0 在这套口径下 FAIL（不转 = 打滑不是滚）',
  `p90 自转 ${C.ang.p90.toFixed(3)} rad（会滚是 ${B.ang.median.toFixed(2)}）`);

const sep = B.dist.median > A.dist.p90;
if (sep) {
  chk(true, '区分力：median(会滚) > p90(基线)',
    `${B.dist.median.toFixed(0)} > ${A.dist.p90.toFixed(0)} px`);
  chk(B.dist.median / A.dist.median >= 1.2, '倍率（median）：会滚 ≥ 1.2× 基线',
    `${(B.dist.median / A.dist.median).toFixed(2)}×`);
} else {
  console.log(`\n  ⚠️  口径无区分力：median(会滚) ${B.dist.median.toFixed(0)} 没有超过 p90(基线) ${A.dist.p90.toFixed(0)} px`);
  console.log('     ⇒ 按团队口径，"位移"这条阈值作废，不能拿它当门禁（本次**不硬凑**）。');
}

console.log(`\n# 不通过条目：${bad}`);
process.exit(bad ? 1 : 0);
