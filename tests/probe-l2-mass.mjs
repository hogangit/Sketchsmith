/**
 * tests/probe-l2-mass.mjs —— 关2：南瓜质量扫描（判据 2 对判据 7 的分离窗口）
 *
 * 为什么要扫：判据 7 要求"不点变硬必须失败"，但变硬**不改质量**（只改摩擦/弹性/空气阻尼），
 * 所以"硬能压动、软压不动"只能靠**接触时长**来分离：
 *   · 软（restitution 0.32 / friction 0.05）→ 弹开、几乎没有持续压力；
 *   · 硬（restitution 0.02 / friction 0.9）→ 贴在悬空半边上，持续给力矩。
 * 南瓜太轻：软弹一下的冲量就够（实测质量 13.45 时软 5/5 过关，判据 7 挂）。
 * 南瓜太重：硬也压不动（关卡不可过）。
 * 这两条之间的质量窗口就是这个脚本要找的东西。
 *
 * 用法：node tests/probe-l2-mass.mjs
 */
import { loadGameEnv, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;
const MATTER = globalThis.Matter;

const WINDOW = [200, 207, 214, 221, 228];

function shot(mass, abilities) {
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  MATTER.Body.setDensity(pump, mass / (62 * 62));   // 面积 3844，直接按目标质量反算密度
  const res = [];
  for (const x of WINDOW) {
    // 每个落点都要新的世界（一次只能放一个造物才可比）
    res.push([x]);
  }
  rt.destroy();
  return res.length;
}

function trial(mass, abilities, x, seconds = 8) {
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  MATTER.Body.setDensity(pump, mass / (62 * 62));
  const geo = classify.analyzeStrokeGroup([{ pts: synthCircle(x, 700, 30, 5) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
  for (const a of abilities) rt.setAbility(a);
  let end = 'timeout', devMax = 0;
  const p0 = { x: pump.position.x, y: pump.position.y };
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    devMax = Math.max(devMax, Math.hypot(pump.position.x - p0.x, pump.position.y - p0.y));
    if (ev.some((e) => e[0] === 'level:win')) { end = 'win'; break; }
    if (ev.some((e) => e[0] === 'level:fail')) { end = 'fail:' + ev.filter((e) => e[0] === 'level:fail').pop()[1].reason; break; }
  }
  const out = { end, devMax, px: pump.position.x, py: pump.position.y };
  rt.destroy();
  return out;
}

console.log('# 南瓜质量扫描（造物：圆 r30 + 硬 / 不加能力）  每个质量点 5 落点');
console.log('# 目标：硬 ≥4/5 过关，软 0/5');
for (const mass of [13, 20, 26, 32, 40, 50]) {
  const hard = WINDOW.map((x) => trial(mass, ['harden'], x));
  const soft = WINDOW.map((x) => trial(mass, [], x));
  const hw = hard.filter((r) => r.end === 'win').length;
  const sw = soft.filter((r) => r.end === 'win').length;
  console.log(`\n质量 ${mass}  (密度 ${(mass / 3844).toFixed(5)})  硬 ${hw}/5 过关   软 ${sw}/5 过关`);
  console.log('  硬 ' + hard.map((r) => (r.end === 'win' ? 'W' : r.end.replace('fail:', 'F:')).padEnd(12)).join(''));
  console.log('  软 ' + soft.map((r) => (r.end === 'win' ? 'W' : r.end.replace('fail:', 'F:')).padEnd(12)).join(''));
}
