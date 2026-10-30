/**
 * tools/probe-l2-rescue.mjs —— 关2「细梁没反应之后还能不能救」
 *
 * 用途：D32 把悬空量从 26px 收到 21px 后，细梁（t=5）整根滑进沟里、南瓜纹丝不动。
 * 这不算软锁的前提是：**玩家再投一个还能推进关卡**。本脚本验这句话是否成立，
 * 并比较两种补投（另一个圆 vs 大方块）哪个能真的把南瓜弄下去。
 */
import { loadGameEnv, synthLine, synthCircle, synthRect } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

function run({ propX, plan, seconds = 20 }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const L = JSON.parse(JSON.stringify(BASE));
  L.props[0].x = propX;
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L, world: w, bus });
  const spawn = (pts, th) => {
    const geo = classify.analyzeStrokeGroup([{ pts }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: th || 9 });
  };
  spawn(plan[0].pts, plan[0].thickness);
  let end = 'timeout';
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    if (plan[1] && f === plan[1].at) spawn(plan[1].pts, plan[1].thickness);
    if (ev.some((e) => e[0] === 'level:win')) { end = 'win'; break; }
    const fl = ev.find((e) => e[0] === 'level:fail');
    if (fl) { end = 'fail:' + fl[1].reason; break; }
  }
  const p = rt.state.props[rt.state.activeProp];
  const out = `${end} @(${p.position.x.toFixed(0)},${p.position.y.toFixed(0)})`;
  rt.destroy();
  return out;
}

const BEAM5 = synthLine(180, 700, 350, 702, 4, 0.7);
const followUps = [
  ['再投圆 r30 @214', synthCircle(214, 700, 30, 5)],
  ['再投块 90x80 @214', synthRect(214, 700, 90, 80, 6)],
  ['再投块 90x80 @206', synthRect(206, 700, 90, 80, 6)],
];
for (const propX of [190, 193, 195]) {
  console.log(`\n南瓜 x=${propX}（悬空 ${propX + 31 - 200}px）`);
  for (const [name, pts] of followUps) {
    const r = run({ propX, plan: [{ pts: BEAM5, thickness: 5 }, { at: 240, pts }] });
    console.log(`  细梁 → ${name.padEnd(18)} ${r}`);
  }
}
