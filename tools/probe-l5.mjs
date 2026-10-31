/**
 * tools/probe-l5.mjs —— 关5 弹射窗口标定探针（node 侧整关跑物理，不开浏览器）
 *
 * 目的：找出「弹射板画在哪 → 小人能越过鱼潭、落到对岸墙顶(x378..430, 顶 y170)」，
 * 并打印小人真实弹道（非按公式猜）。同时验证「单根横板必败」。
 *
 * 用法：node tools/probe-l5.mjs
 */
import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';
import { LEVEL_CH1_05 } from '../src/level/levels/ch1-05.js';

const env = await loadGameEnv();
const { classify, world, runtime } = env;

/** 跑一次；trace=true 时打印小人轨迹 */
function runTrial({ cx, halfW = 25, abilities = ['harden', 'tickle'], thickness = 12, maxSec = 6, trace = false }) {
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_05, world: w, bus });
  for (let f = 0; f < 4; f++) rt.step(1);
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(cx - halfW, 700, cx + halfW, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness });
  for (const a of abilities) rt.setAbility(a);
  let peakY = 999, win = false, fail = null;
  const path = [];
  for (let f = 0; f < 60 * maxSec; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a && a.body) {
      peakY = Math.min(peakY, a.body.position.y);
      if (trace && f % 4 === 0) path.push(`(${a.body.position.x.toFixed(0)},${a.body.position.y.toFixed(0)})`);
    }
    if (events.find((e) => e[0] === 'level:win')) { win = true; break; }
    const fl = events.find((e) => e[0] === 'level:fail');
    if (fl && fail == null) fail = fl[1].reason;
  }
  rt.destroy();
  return { win, fail, peakY: peakY === 999 ? null : Math.round(peakY), path };
}

console.log('=== 关5 弹射板窗口扫描（板中心 cx，宽 50）===');
for (const cx of [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230]) {
  const r = runTrial({ cx, trace: cx === 150 || cx === 190 || cx === 210 });
  console.log(`cx=${cx}: ${r.win ? '过' : '败'}  peak=${r.peakY}  fail=${r.fail || '-'}`);
  if (r.path.length) console.log('    path ' + r.path.join(' '));
}

console.log('\n=== 单根横板反例（harden only，宽 210，中心 255）===');
const bad = runTrial({ cx: 255, halfW: 105, abilities: ['harden'], trace: true });
console.log(`单根横板: ${bad.win ? '过（缺陷未修）' : '败（正确）'}  peak=${bad.peakY}  fail=${bad.fail || '-'}`);
console.log('    path ' + bad.path.join(' '));
