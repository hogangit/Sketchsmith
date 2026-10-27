import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;

const L4 = {
  id: 'ch1-04', chapter: 4, title: '上不去的高台', spawnY: 84,
  terrain: [
    { x: 120, y: 471, w: 240, h: 82 },
    { x: 330, y: 370, w: 180, h: 140 },
    { x: 250, y: 296, w: 34, h: 8, mat: 'ground' },
  ],
  actors: [{ kind: 'walker', x: 60, y: 416, targetX: 340, label: '小人' }],
  props: [], goal: { type: 'reachActor', x: 340, maxY: 320 }, resetActorIfBelowY: 620,
};

// 单次详细轨迹：tickle 软梁，逐帧打印板与 actor 位置
function detail(abilities, tag) {
  budget.BodyBudget.reset();
  const w = world.createPhysicsWorld();
  const rt = runtime.createLevelRuntime({ level: L4, world: w, bus: { emit() {}, on() {}, countOf() { return 0; } } });
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(206, 700, 246, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  for (const a of abilities) rt.setAbility(a);
  console.log(`\n== ${tag} == nBodies=${rt.state.activeCreature.bodies.length} composeHooks=${rt.state.activeCreature.composed.hooks.length} flags=`, JSON.stringify(rt.state.activeCreature.composed.flags));
  let nanFrame = -1;
  for (let f = 0; f < 60 * 3; f++) {
    rt.step(1);
    const c = rt.state.activeCreature;
    const b = c.bodies[0];
    const a = rt.state.actor;
    const bx = b.position.x, by = b.position.y;
    if (!Number.isFinite(bx) || !Number.isFinite(by)) { nanFrame = f; break; }
    if (f % 15 === 0) console.log(`  f${f}: board=(${bx.toFixed(1)},${by.toFixed(1)}) actor=(${a.body.position.x.toFixed(1)},${a.body.position.y.toFixed(1)})`);
  }
  console.log(`  -> nanFrame=${nanFrame}`);
  rt.destroy();
}

detail(['tickle'], 'tickle(软)');
detail(['harden', 'tickle'], 'harden+tickle(硬)');
detail(['harden'], 'harden(硬,对照)');
