import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const M = globalThis.Matter;

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

function runScenario(label, abilities) {
  budget.BodyBudget.reset();
  const w = world.createPhysicsWorld();
  const rt = runtime.createLevelRuntime({ level: L4, world: w, bus: { emit() {}, on() {}, countOf() { return 0; } } });
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(206, 700, 256, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  for (const ab of abilities) rt.setAbility(ab);
  const c = rt.state.activeCreature;
  for (const b of c.bodies) {
    M.Body.setPosition(b, { x: b.position.x, y: 424 + (b.position.y - c.bodies[0].position.y) });
    M.Body.setVelocity(b, { x: 0, y: 0 });
    M.Body.setAngularVelocity(b, 0);
  }
  let nanF = -1, nanBody = null, nanPos = null, nanVel = null;
  let boardTrail = [];
  for (let f = 0; f < 60 * 14; f++) {
    rt.step(1);
    // 检测所有动态刚体（含 walker + 造物）是否 NaN
    const dyn = w.dynamicBodies();
    for (const b of dyn) {
      if (!Number.isFinite(b.position.x) || !Number.isFinite(b.position.y) ||
          !Number.isFinite(b.velocity.x) || !Number.isFinite(b.velocity.y)) {
        nanF = f; nanBody = b.label; nanPos = { x: b.position.x, y: b.position.y };
        nanVel = { x: b.velocity.x, y: b.velocity.y }; break;
      }
    }
    if (nanF >= 0) break;
    if (f % 20 === 0) {
      const a = rt.state.actor;
      const bd = c.bodies[0];
      boardTrail.push(`f${f}: walk=(${a.body.position.x.toFixed(0)},${a.body.position.y.toFixed(0)}) boardY=${bd.position.y.toFixed(1)}`);
    }
  }
  const a = rt.state.actor;
  console.log(`\n[${label}] abilities=${abilities.join('+')}`);
  for (const t of boardTrail) console.log('   ' + t);
  if (nanF >= 0) console.log(`   >>> NaN @ f${nanF} body=${nanBody} pos=${JSON.stringify(nanPos)} vel=${JSON.stringify(nanVel)}`);
  else console.log(`   >>> OK 60s 无 NaN (walk end=(${a.body.position.x.toFixed(0)},${a.body.position.y.toFixed(0)}))`);
  rt.destroy();
}

console.log('=== 隔离实验：哪个刚体先 NaN ===');
runScenario('A 仅 harden（无 tickle）', ['harden']);
runScenario('B harden+tickle', ['harden', 'tickle']);
runScenario('C 仅 tickle（软梁）', ['tickle']);
runScenario('D 空能力（软梁默认）', []);
