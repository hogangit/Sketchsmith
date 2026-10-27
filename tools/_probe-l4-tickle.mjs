import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;

const L4 = {
  id: 'ch1-04', chapter: 4, title: '上不去的高台',
  spawnY: 84,
  terrain: [
    { x: 120, y: 471, w: 240, h: 82 },
    { x: 330, y: 370, w: 180, h: 140 },
    { x: 250, y: 296, w: 34, h: 8, mat: 'ground' },
  ],
  actors: [{ kind: 'walker', x: 60, y: 416, targetX: 340, label: '小人' }],
  props: [],
  goal: { type: 'reachActor', x: 340, maxY: 320 },
  resetActorIfBelowY: 620,
};

function runOnce(abilities, boardX, boardX2) {
  budget.BodyBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L4, world: w, bus });
  const bx2 = boardX2 == null ? boardX + 60 : boardX2;
  const pts = synthLine(boardX, 700, bx2, 702, 4, 0.7);
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  for (const a of abilities) rt.setAbility(a);
  let peakY = 999;
  let ended = null;
  const frames = 60 * 14;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a) peakY = Math.min(peakY, a.body.position.y);
    if (events.find((e) => e[0] === 'level:win')) { ended = 'win'; break; }
    const fl = events.find((e) => e[0] === 'level:fail');
    if (fl && ended == null) ended = 'fail:' + fl[1].reason;
  }
  const a = rt.state.actor;
  rt.destroy();
  return { peakY, ended, ax: a ? a.body.position.x : null, ay: a ? a.body.position.y : null };
}

console.log('== 怕痒弹射：harden+tickle 板居中到小人卡墙点 x≈226 ==');
for (const [bx, ex] of [[196, 256], [206, 246], [216, 256], [200, 260]]) {
  let wins = 0; const peaks = [];
  for (let i = 0; i < 10; i++) {
    const r = runOnce(['harden', 'tickle'], bx);
    if (r.ended === 'win') wins++;
    peaks.push(Number.isFinite(r.peakY) ? r.peakY : 999);
  }
  const pk = Math.min(...peaks);
  console.log(`  board[${bx}..${ex}]: wins ${wins}/10  peakMinY=${pk.toFixed(0)}  peaks=[${peaks.map((p) => p.toFixed(0)).join(',')}]`);
}

// 单跑一次打印轨迹，确认无 NaN
console.log('\n== 单跑轨迹（板 206..246）==');
{
  budget.BodyBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L4, world: w, bus });
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(206, 700, 246, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  rt.setAbility('harden'); rt.setAbility('tickle');
  const traj = [];
  for (let f = 0; f < 60 * 8; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a && f % 20 === 0) traj.push(`f${f}:(${a.body.position.x.toFixed(0)},${a.body.position.y.toFixed(0)})`);
    if (events.find((e) => e[0] === 'level:win')) { traj.push('WIN'); break; }
  }
  console.log('  ' + traj.join(' '));
  rt.destroy();
}

