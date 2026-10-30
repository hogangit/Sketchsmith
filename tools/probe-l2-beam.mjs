/**
 * tools/probe-l2-beam.mjs —— 关2「梁」在 D32 新几何下怎么画才过
 *
 * 冒烟里的关2 标准解法（(182,700)→(356,704) + 变硬）在悬空 21px 下不再过关。
 * 本脚本扫梁的起止 x 与笔画粗细，找出仍然稳定的画法，供 smoke 用例更新。
 */
import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

function run(x1, x2, thickness) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: JSON.parse(JSON.stringify(BASE)), world: w, bus });
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(x1, 700, x2, 704, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness });
  rt.setAbility('harden');
  let end = 'timeout';
  for (let f = 0; f < 60 * 20; f++) {
    rt.step(1);
    if (ev.some((e) => e[0] === 'level:win')) { end = 'win'; break; }
    const fl = ev.find((e) => e[0] === 'level:fail');
    if (fl) { end = 'fail:' + fl[1].reason; break; }
  }
  const p = rt.state.props[rt.state.activeProp];
  const out = `${end}@${p.position.x.toFixed(0)}`;
  rt.destroy();
  return out;
}

console.log('梁的起止 x × 笔画粗细（终点 y 固定 704）');
for (const [x1, x2] of [[182, 356], [182, 340], [196, 340], [200, 336], [206, 300], [190, 260]]) {
  const row = [5, 9, 14, 20].map((t) => `t${t}:${run(x1, x2, t)}`);
  console.log(`  ${String(x1).padStart(3)}→${String(x2).padStart(3)}  ${row.join('  ')}`);
}
