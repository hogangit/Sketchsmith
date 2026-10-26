/**
 * tests/l2-passable.mjs —— 关2 是不是**真的能过**（先证明能过，再谈判据）
 *
 * 用法：node tests/l2-passable.mjs
 * 对每个落位（南瓜重心 x）× 每种造物，各丢一次，报 WIN / 失败原因 / 南瓜落点。
 */
import { loadGameEnv, synthCircle, synthRect, synthLine } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

function level(cx) {
  const L = JSON.parse(JSON.stringify(BASE));
  L.props[0].x = cx;
  return L;
}

function attempt(L, pts, abilities, thickness = 9, seconds = 9) {
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness });
  for (const a of abilities) rt.setAbility(a);
  let end = 'timeout';
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    const win = ev.find((e) => e[0] === 'level:win');
    const los = ev.filter((e) => e[0] === 'level:fail').pop();
    if (win) { end = 'WIN'; break; }
    if (los) { end = 'fail:' + los[1].reason; break; }
  }
  const out = { end, form: geo.form, spawnX: geo.centroid.x, px: pump.position.x, py: pump.position.y };
  rt.destroy();
  return out;
}

const KITS = [
  ['圆r26+硬', (x) => synthCircle(x, 700, 26, 5), ['harden']],
  ['圆r34+硬', (x) => synthCircle(x, 700, 34, 6), ['harden']],
  ['块90x80+硬', (x) => synthRect(x, 700, 90, 80, 6), ['harden']],
  ['块90x80+硬+滚', (x) => synthRect(x, 700, 90, 80, 6), ['harden', 'roll']],
  ['长条梁+硬', () => synthLine(180, 700, 350, 702, 4, 0.7), ['harden']],
];

for (const cx of [165, 180, 195]) {
  const L = level(cx);
  console.log(`\n===== 南瓜重心 x=${cx}（${cx - 31}..${cx + 31}，悬空 ${Math.max(0, cx + 31 - 200)}px）=====`);
  for (const [name, mk, ab] of KITS) {
    const xs = name.startsWith('长条') ? [0] : [cx - 20, cx - 6, cx + 8, cx + 22, cx + 36];
    const line = [];
    for (const x of xs) {
      const r = attempt(L, mk(x), ab);
      line.push(`x${r.spawnX.toFixed(0)}→${r.end}${r.end === 'WIN' ? '' : `(南瓜${r.px.toFixed(0)},${r.py.toFixed(0)})`}`);
    }
    console.log(`  ${name.padEnd(14)} ${line.join('  ')}`);
  }
}
