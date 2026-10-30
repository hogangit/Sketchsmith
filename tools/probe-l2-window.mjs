/**
 * tools/probe-l2-window.mjs —— 找一个「变硬 / 变硬+会滚」都能过的落点窗口
 *
 * 判据 5 要求贴不贴「会滚」都必须能过关（能力是奖励，不该变成惩罚）。
 * 但会滚会让南瓜多滚一段，右端容易冲过头卡在右侧石头。本脚本逐点扫 200..222，
 * 给出两种能力的胜负表，用来看**两者共同可过区间**在哪。
 */
import { loadGameEnv, synthCircle } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

function run(x, abilities) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: JSON.parse(JSON.stringify(BASE)), world: w, bus });
  const geo = classify.analyzeStrokeGroup([{ pts: synthCircle(x, 700, 30, 5) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
  for (const a of abilities) rt.setAbility(a);
  let end = 'timeout';
  for (let f = 0; f < 600; f++) {
    rt.step(1);
    if (ev.some((e) => e[0] === 'level:win')) { end = 'W'; break; }
    const fl = ev.find((e) => e[0] === 'level:fail');
    if (fl) { end = 'F:' + fl[1].reason.replace('prop-', ''); break; }
  }
  rt.destroy();
  return end;
}

console.log('落点  变硬      变硬+会滚');
for (let x = 200; x <= 224; x += 2) {
  const a = run(x, ['harden']);
  const b = run(x, ['harden', 'roll']);
  console.log(`  ${String(x).padEnd(4)} ${a.padEnd(10)} ${b}`);
}
