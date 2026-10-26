/**
 * tests/probe-l2-shelter.mjs —— 候选结构：给南瓜平台侧加一片"岩檐"（静态），
 * 让竖直下落的梁只砸在岩檐上，只有悬空那半边露在天上。
 *
 * 不改进关卡数据，只在内存里变异关卡对象做对比实验。
 * 用法：node tests/probe-l2-shelter.mjs
 */
import { loadGameEnv, synthLine, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

function variant(shelter) {
  const L = JSON.parse(JSON.stringify(BASE));
  if (shelter) L.terrain.push({ x: 148, y: 228, w: 96, h: 12, mat: 'ground' });  // 100..196, y 222..234
  return L;
}

function run(L, pts, abilities, thickness = 9, seconds = 12) {
  const w = world.createPhysicsWorld();
  const ev = [];
  const rt = runtime.createLevelRuntime({ level: L, world: w, bus: { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } } });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  const p0 = { x: pump.position.x, y: pump.position.y };
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness });
  for (const a of abilities) rt.setAbility(a);
  let maxDev = 0, end = 'timeout';
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    maxDev = Math.max(maxDev, Math.hypot(pump.position.x - p0.x, pump.position.y - p0.y));
    if (ev.some((e) => e[0] === 'level:win')) { end = 'WIN'; break; }
    if (ev.some((e) => e[0] === 'level:fail')) { end = 'fail'; break; }
  }
  const out = { end, maxDev, px: pump.position.x, py: pump.position.y };
  rt.destroy();
  return out;
}

for (const shelter of [false, true]) {
  const L = variant(shelter);
  console.log(`\n===== ${shelter ? '有岩檐' : '无岩檐（现状）'} =====`);
  for (const t of [5, 20]) {
    const r = run(L, synthLine(180, 700, 350, 702, 4, 0.7), ['harden'], t, 14);
    console.log(`  梁 t=${t}: 南瓜位移 ${r.maxDev.toFixed(2)}px  ${r.end}  结果落点 (${r.px.toFixed(0)},${r.py.toFixed(0)})`);
  }
  for (const [name, ab] of [['硬', ['harden']], ['软（无能力）', []]]) {
    const rs = [200, 207, 214, 221, 228].map((x) => run(L, synthCircle(x, 700, 30, 5), ab, 9, 10));
    console.log(`  压悬空半边·${name}: ${rs.filter((r) => r.end === 'WIN').length}/5 过关  ` +
      rs.map((r) => `${r.end}@${r.px.toFixed(0)},${r.py.toFixed(0)}`).join(' '));
  }
  const still = run(L, synthLine(100, 700, 120, 702, 4, 0.7), [], 9, 0.2);
  console.log(`  （静置另测）`);
}
