import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget, materials } = env;
const M = globalThis.Matter;
const TICKLE_K = materials.MATERIALS.TICKLE_K;

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
rt.setAbility('tickle');   // 仅 tickle（软梁），但结论应与 harden+tickle 同帧 NaN
const c = rt.state.activeCreature;
for (const b of c.bodies) {
  M.Body.setPosition(b, { x: b.position.x, y: 424 + (b.position.y - c.bodies[0].position.y) });
  M.Body.setVelocity(b, { x: 0, y: 0 });
  M.Body.setAngularVelocity(b, 0);
}

function myFlushTickles() {
  const pairs = (w.engine.pairs && w.engine.pairs.collisionActive) || [];
  const tickleIds = new Set(c.bodies.map((b) => b.id));
  const out = [];
  for (const pair of pairs) {
    if (!pair.isActive) continue;
    const a = pair.bodyA, b = pair.bodyB;
    const ta = tickleIds.has(a.id), tb = tickleIds.has(b.id);
    let tickleBody = null, other = null;
    if (ta && !tb) { tickleBody = a; other = b; }
    else if (tb && !ta) { tickleBody = b; other = a; }
    if (!tickleBody || !other || other.isStatic) continue;
    out.push({ tickleBody, other, pair });
  }
  return out;
}

for (let f = 0; f < 160; f++) {
  rt.step(1);
  const a = rt.state.actor;
  const hits = myFlushTickles();
  if (hits.length) {
    for (const h of hits) {
      const ob = h.other;
      const dx0 = ob.position.x - h.tickleBody.position.x;
      const dy0 = ob.position.y - h.tickleBody.position.y;
      const len = Math.hypot(dx0, dy0) || 1;
      const nx = dx0 / len, ny = dy0 / len;
      console.log(`f${f} TICKLE: tickleBody=(${h.tickleBody.position.x.toFixed(1)},${h.tickleBody.position.y.toFixed(1)}) other=${ob.label}(${ob.position.x.toFixed(1)},${ob.position.y.toFixed(1)})`);
      console.log(`   other.velocity=(${ob.velocity.x},${ob.velocity.y}) other.deltaTime=${ob.deltaTime} other.positionPrev=(${ob.positionPrev.x.toFixed(1)},${ob.positionPrev.y.toFixed(1)})`);
      const vx = ob.velocity.x + nx * TICKLE_K;
      const vy = ob.velocity.y + ny * TICKLE_K;
      M.Body.setVelocity(ob, { x: vx, y: vy });
      console.log(`   -> setVelocity(${vx.toFixed(2)},${vy.toFixed(2)})  => posPrev=(${ob.positionPrev.x.toFixed(1)},${ob.positionPrev.y.toFixed(1)}) vel=(${ob.velocity.x},${ob.velocity.y})`);
      // 下一步看 walker 是否变 NaN
    }
  }
  const chk = (b) => (!Number.isFinite(b.position.x) || !Number.isFinite(b.velocity.y)) ? `NaN@${b.label}` : null;
  const bad = [a.body, ...c.bodies].map(chk).filter(Boolean);
  if (bad.length) { console.log(`   >>> ${bad.join(',')} AFTER step f${f}`); break; }
}
console.log('done');
rt.destroy();
