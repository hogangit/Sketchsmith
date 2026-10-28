import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';
import { LEVEL_CH1_04 } from '../src/level/levels/ch1-04.js';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
console.__tickleApply = false; // 关掉调试刷屏

const TICKLE_BOARD_CX = process.argv[2] ? Number(process.argv[2]) : null;
const TRIALS = TICKLE_BOARD_CX != null ? [TICKLE_BOARD_CX] : [150, 170, 190, 210, 230];

function trial(boardCx) {
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_04, world: w, bus });
  // 先走 4 帧让小人与世界起步
  for (let f = 0; f < 4; f++) rt.step(1);
  // 自然掉落板：水平长条，中心落点 = boardCx
  const half = 35;
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(boardCx - half, 700, boardCx + half, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  rt.setAbility('harden'); rt.setAbility('tickle');

  let peakY = 999, win = false, fail = null, maxX = 0, peakFrame = -1;
  const trace = [];
  for (let f = 0; f < 60 * 16; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a && a.body) {
      const x = a.body.position.x, y = a.body.position.y, vx = a.body.velocity.x, vy = a.body.velocity.y;
      maxX = Math.max(maxX, x);
      if (y < peakY) { peakY = y; peakFrame = f; }
      if (f % 25 === 0) trace.push(`f${f}: (${x.toFixed(0)},${y.toFixed(0)}) v(${vx.toFixed(1)},${vy.toFixed(1)})`);
    }
    if (events.find((e) => e[0] === 'level:win')) { win = true; break; }
    const fl = events.find((e) => e[0] === 'level:fail');
    if (fl && fail == null) { fail = fl[1].reason; break; }
  }
  console.log(`\n=== boardCx=${boardCx} (宽70) form=${geo.form} ===`);
  console.log(`  peakY=${peakY.toFixed(0)} @f${peakFrame} maxX=${maxX.toFixed(0)} win=${win} fail=${fail}`);
  console.log('  ' + trace.join(' | '));
  rt.destroy();
}

for (const cx of TRIALS) trial(cx);
