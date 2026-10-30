import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';
const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;
function run(pts, label) {
  budget.BodyBudget.reset(); budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld(); const ev = [];
  const bus = { emit: (e,p)=>ev.push([e,p]), on(){}, countOf(){return 0;} };
  const rt = runtime.createLevelRuntime({ level: JSON.parse(JSON.stringify(BASE)), world: w, bus });
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
  rt.setAbility('harden');
  let end='timeout';
  for (let f=0;f<60*20;f++){ rt.step(1); if(ev.some(e=>e[0]==='level:win')){end='win';break;} const fl=ev.find(e=>e[0]==='level:fail'); if(fl){end='fail:'+fl[1].reason;break;} }
  const p = rt.state.props[rt.state.activeProp];
  console.log(`${label.padEnd(28)} ${geo.form.padEnd(6)} points=${pts.length}  → ${end}@${p.position.x.toFixed(0)}`);
  rt.destroy();
}
// 冒烟里 spawnFromStrokes 走的是 61 点、无抖动的直线
const dense = []; for (let i=0;i<=60;i++){ const t=i/60; dense.push({x:206+(300-206)*t, y:700+(704-700)*t}); }
run(dense, '61点直线 206→300（冒烟路径）');
run(synthLine(206,700,300,704,4,0.7), 'synthLine 206→300（探针路径）');
run(synthLine(206,700,310,704,4,0.7), 'synthLine 206→310');
run(synthLine(208,700,306,704,4,0.0), 'synthLine 208→306 无抖动');
