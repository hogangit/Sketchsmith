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

budget.BodyBudget.reset();
const w = world.createPhysicsWorld();
const rt = runtime.createLevelRuntime({ level: L4, world: w, bus: { emit() {}, on() {}, countOf() { return 0; } } });
const geo = classify.analyzeStrokeGroup([{ pts: synthLine(206, 700, 256, 702, 4, 0.7) }]);
rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
rt.setAbility('tickle');
const c = rt.state.activeCreature;
for (const b of c.bodies) {
  M.Body.setPosition(b, { x: b.position.x, y: 424 + (b.position.y - c.bodies[0].position.y) });
  M.Body.setVelocity(b, { x: 0, y: 0 });
  M.Body.setAngularVelocity(b, 0);
}

for (let f = 0; f < 130; f++) {
  const a = rt.state.actor;
  const beforeW = a ? { x: a.body.position.x, y: a.body.position.y, vx: a.body.velocity.x, vy: a.body.velocity.y, dt: a.body.deltaTime } : null;
  rt.step(1);
  const a2 = rt.state.actor;
  if (f >= 108 && f <= 124 && a2) {
    const pairs = (w.engine.pairs && w.engine.pairs.collisionActive) || [];
    const pinfo = pairs.map((p) => `${p.bodyA.label}/${p.bodyB.label}`).join(',');
    console.log(`f${f}: walk=(${a2.body.position.x.toFixed(1)},${a2.body.position.y.toFixed(1)}) v=(${a2.body.velocity.x.toFixed(2)},${a2.body.velocity.y.toFixed(2)}) posPrev=(${a2.body.positionPrev.x.toFixed(1)},${a2.body.positionPrev.y.toFixed(1)}) dt=${a2.body.deltaTime}`);
    console.log(`     board=(${c.bodies[0].position.x.toFixed(1)},${c.bodies[0].position.y.toFixed(1)}) v=(${c.bodies[0].velocity.x.toFixed(2)},${c.bodies[0].velocity.y.toFixed(2)}) pairs=[${pinfo}]`);
    if (!Number.isFinite(a2.body.position.x) || !Number.isFinite(a2.body.velocity.x)) { console.log('   >>> WALKER NaN'); break; }
  }
}
rt.destroy();
