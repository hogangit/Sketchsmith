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

// 受控测试：板预置在地面静止（模拟“已落地”），让 walker 走上去，验证怕痒向上弹
const M = globalThis.Matter;
console.__tickleApply = true;
globalThis.__TICKLE_NOOP = (process.env.NOOP === '1');
function controlled(boardX, boardW) {
  budget.BodyBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const rt = runtime.createLevelRuntime({ level: L4, world: w, bus: { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } } });
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(boardX, 700, boardX + boardW, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  rt.setAbility('harden'); rt.setAbility('tickle');
  // 预置到地面静止（覆盖掉落）
  const c = rt.state.activeCreature;
  for (const b of c.bodies) {
    M.Body.setPosition(b, { x: b.position.x, y: 424 + (b.position.y - c.bodies[0].position.y) });
    M.Body.setVelocity(b, { x: 0, y: 0 });
    M.Body.setAngularVelocity(b, 0);
  }
  let peakY = 999, ended = null, launchFrame = -1;
  let prevX = 60, prevY = 416, prevVx = 0, prevVy = 0, nanF = -1;
  for (let f = 0; f < 60 * 14; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a) {
      const x = a.body.position.x, y = a.body.position.y, vx = a.body.velocity.x, vy = a.body.velocity.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) { nanF = f; break; }
      if (f >= 80 && f <= 160 && f % 4 === 0) console.log(`    f${f}: walk=(${x.toFixed(0)},${y.toFixed(0)}) v=(${vx.toFixed(1)},${vy.toFixed(1)})`);
      peakY = Math.min(peakY, y); if (launchFrame < 0 && y < 380) launchFrame = f;
      prevX = x; prevY = y; prevVx = vx; prevVy = vy;
    }
    if (events.find((e) => e[0] === 'level:win')) { ended = 'win'; break; }
    const fl = events.find((e) => e[0] === 'level:fail');
    if (fl && ended == null) ended = 'fail:' + fl[1].reason;
  }
  const a = rt.state.actor;
  console.log(`  boardCx=${boardX + boardW / 2}: peakY=${peakY.toFixed(0)} launchFrame=${launchFrame} nanF=${nanF} end=${ended} prevBeforeNaN=(${prevX.toFixed(0)},${prevY.toFixed(0)})v(${prevVx.toFixed(1)},${prevVy.toFixed(1)})`);
  rt.destroy();
}

console.log('== 受控：板预置地面静止，walker 走上板 ==');
controlled(206, 50);
