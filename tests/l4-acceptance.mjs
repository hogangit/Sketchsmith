/**
 * tests/l4-acceptance.mjs —— 关4《上不去的高台》验收台架（规格 1.8 判据① + 配对教学 + D15）
 *
 * 判据：
 *  ① 弹射主解：窗口内 10 个放置点 ≥8 过关；弹起最高点 y ≤ 280（≈越 136px）
 *  ② 配对负对照：只点「变硬」不点「怕痒」→ 板不弹，不过关（能力层不为空）
 *  ③ D15 恒定：板厚 6 与 24（面积差大），「板顶之上的弹起高度」差 ≤5%
 *     —— 注意：比较的是**弹起幅度**（板顶→最高点），不是世界坐标绝对峰值。
 *        薄板与厚板的绝对峰值差 ≈ 板厚本身（厚板本来就垫得更高，这是几何必然、非抽奖）；
 *        D15 要的是「画粗画细弹一样高」= 弹起幅度恒定，由固定 vy 保证。
 *
 * 运行：node tests/l4-acceptance.mjs
 */
import assert from 'node:assert/strict';
import { loadGameEnv, synthLine } from './helpers/env.mjs';
import { LEVEL_CH1_04 } from '../src/level/levels/ch1-04.js';
import { TICKLE_ACTOR_VY } from '../src/physics/materials.js';

const env = await loadGameEnv();
const { classify, world, runtime } = env;

/** 跑一次：板落在 boardCx（宽70），贴 abilities，跑满时限，返回结果 */
function runTrial(boardCx, abilities, thickness = 12, maxSec = 16) {
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_04, world: w, bus });
  for (let f = 0; f < 4; f++) rt.step(1);
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(boardCx - 35, 700, boardCx + 35, 702, 4, 0.7) }]);
  const creature = rt.spawnCreature({ form: geo.form, geo, thickness });
  for (const a of abilities) rt.setAbility(a);
  let peakY = 999, win = false, fail = null;
  for (let f = 0; f < 60 * maxSec; f++) {
    rt.step(1);
    const a = rt.state.actor;
    if (a && a.body) peakY = Math.min(peakY, a.body.position.y);
    if (events.find((e) => e[0] === 'level:win')) { win = true; break; }
    const fl = events.find((e) => e[0] === 'level:fail');
    if (fl && fail == null) fail = fl[1].reason;
  }
  // 板已在地面落稳：此刻读 creature.bodies 的 bounds.min.y 才是真实板顶
  // （刚 spawn 时板还在 y≈84 的出生点，读它会拿到 80 这种错误值）
  let boardTopY = null;
  if (creature && creature.bodies && creature.bodies.length) {
    const tops = creature.bodies.map((b) => (b.bounds ? b.bounds.min.y : Infinity));
    const m = Math.min(...tops);
    boardTopY = Number.isFinite(m) ? Math.round(m) : null;
  }
  rt.destroy();
  return { win, fail, peakY: peakY === 999 ? null : Math.round(peakY), boardTopY };
}

// ── 判据①：窗口内 10 个放置点 ≥8 过关 + 最高点 ≤280 ──────────────────────────
const WINDOW = [100, 110, 120, 130, 140, 150, 155, 115, 125, 145];
let wins = 0;
const detail = [];
for (const cx of WINDOW) {
  const r = runTrial(cx, ['harden', 'tickle']);
  detail.push(`${cx}:${r.win ? '过' : '败'}(peak${r.peakY})`);
  if (r.win) wins++;
  assert.ok(r.win ? r.peakY <= 280 : true, `boardCx=${cx} 过关但 peakY=${r.peakY} > 280，弹射过高`);
}
console.log(`判据① 弹射主解：${wins}/10 过关（门槛≥8）—— ${detail.join(' ')}`);
assert.ok(wins >= 8, `弹射主解 ${wins}/10 < 8：可绘制窗口失守，见 decisions.md D27`);

// ── 判据②：配对负对照——只点变硬，板不弹，不过关 ─────────────────────────────
const noTickle = runTrial(142, ['harden'], 12, 10);
console.log(`判据② 配对负对照：只变硬 → win=${noTickle.win}（应为 false）`);
assert.equal(noTickle.win, false, '只点「变硬」竟过关——配对教学失效，能力层为空');

// ── 判据③：D15 恒定——板厚 6 vs 24，板顶之上的弹起高度差 ≤5%（非绝对世界峰值）──
const thin = runTrial(142, ['harden', 'tickle'], 6);
const thick = runTrial(142, ['harden', 'tickle'], 24);
assert.ok(thin.win && thick.win, `板厚变体未双过：thin win=${thin.win} thick win=${thick.win}`);
assert.ok(thin.boardTopY != null && thick.boardTopY != null, '未取到板顶坐标，D15 判据不可信');
const thinRise = thin.boardTopY - thin.peakY;   // 板顶→最高点 的弹起幅度
const thickRise = thick.boardTopY - thick.peakY;
const diff = Math.abs(thinRise - thickRise) / Math.max(thinRise, thickRise);
console.log(`判据③ D15 恒定：板厚6 板顶${thin.boardTopY}→峰${thin.peakY} 弹起${thinRise}px / 板厚24 板顶${thick.boardTopY}→峰${thick.peakY} 弹起${thickRise}px，差 ${(diff * 100).toFixed(1)}%（门槛≤5%）`);
assert.ok(diff <= 0.05, `板厚差导致弹起幅度差 ${(diff * 100).toFixed(1)}% > 5%——D15 恒定被破坏`);

console.log('\nl4-acceptance：全部通过 ✔');
