/**
 * tools/probe-l2-landing.mjs —— 关2 过关时南瓜**实际落在哪**
 *
 * 用途：判断「收紧收货口」是否可行。若所有 WIN 都落在 205–235 这一带，
 * 把窗口收到 225–265 就会把绝大多数通关判死（不是变难，是变成过不去）。
 * 输出每次的最终 x/y、是否静止、以及离窗口中心的偏差。
 */
import { loadGameEnv, synthCircle, synthRect, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const L0 = env.levels.l2.LEVEL_CH1_02;

function attempt(pts, abilities, thickness = 9, seconds = 9) {
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: JSON.parse(JSON.stringify(L0)), world: w, bus });
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness });
  for (const a of abilities) rt.setAbility(a);
  let end = 'timeout';
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    const w2 = ev.find((e) => e[0] === 'level:win');
    if (w2) { end = 'WIN'; break; }
    const fl = ev.find((e) => e[0] === 'level:fail');
    if (fl) { end = 'fail:' + fl[1].reason; break; }
  }
  const p = w.allBodies().find((b) => b.label === 'prop');
  return { end, x: p ? +p.position.x.toFixed(1) : null, y: p ? +p.position.y.toFixed(1) : null };
}

const cases = [
  ['圆r26', synthCircle(203, 40, 26), []],
  ['圆r26左', synthCircle(189, 40, 26), []],
  ['圆r34', synthCircle(203, 40, 34), []],
  ['块90x80', synthRect(203, 40, 90, 80), []],
  ['块90x80滚', synthRect(203, 40, 90, 80), ['roll']],
  ['梁', synthLine(150, 60, 300, 60), []],
];
console.log('关2 过关时南瓜落点（收货口 x 205–285，判定 y>=400）');
console.log('落点 x 越靠中间（245），越能安全收紧到 225–265');
for (const [name, pts, ab] of cases) {
  const r = attempt(pts, ab);
  const dev = r.x == null ? '-' : (r.x - 245).toFixed(0);
  console.log(`  ${name.padEnd(12)} ${r.end.padEnd(8)} 南瓜 x=${r.x} y=${r.y}  距窗口中心 ${dev}`);
}
