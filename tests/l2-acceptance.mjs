/**
 * tests/l2-acceptance.mjs —— 关2 重建后的验收（判据 1–7，全部出数字，不出口号）
 *
 * 判据（团队定的门槛）：
 *  1 长条对照组（t=5 / t=20 各 3 次）：南瓜全程 |Δposition| ≤ 2px
 *  2 压/砸悬空半边（窗口内 5 个落点 × 各 2 次）：落进收货口 ≥ 9/10
 *  3 落点 x 分布极差 ≤ 80
 *  4 南瓜静置 3 秒：漂移 ≤ 1px
 *  7 不点「变硬」同落点 5 次：必须不通过
 *  5 「会滚」带/不带各 10 次：成功率下降 ≤ 20%（本关只作预演，但不许有害）
 * 用法：node tests/l2-acceptance.mjs [1|2|3|4|5|7|all]
 */
import { loadGameEnv, synthLine, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;

function run({ strokes, ability, thickness, seconds, stopOnEnd = true, followActor = true }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  const p0 = { x: pump.position.x, y: pump.position.y };
  let maxDev = 0;
  let geo = null;
  if (strokes) {
    geo = classify.analyzeStrokeGroup([{ pts: strokes }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: thickness || 9 });
    if (ability) rt.setAbility(ability);
  }
  const frames = Math.round((seconds || 6) * 60);
  let ended = null;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    maxDev = Math.max(maxDev, Math.hypot(pump.position.x - p0.x, pump.position.y - p0.y));
    const win = events.find((e) => e[0] === 'level:win');
    const los = events.filter((e) => e[0] === 'level:fail').pop();
    if (win) { ended = { kind: 'win', reason: win[1].reason }; break; }
    if (los && stopOnEnd) { ended = { kind: 'fail', reason: lostReason(los[1].reason) }; }
    if (ended && ended.kind === 'fail' && stopOnEnd) break;
  }
  const out = {
    maxDev,
    end: ended ? ended.kind : 'timeout',
    reason: ended ? ended.reason : '-',
    propX: pump.position.x, propY: pump.position.y,
    form: geo ? geo.form : '-',
    spawnX: geo ? geo.centroid.x : '-',
  };
  rt.destroy();
  return out;
}
function lostReason(r) { return r; }

const which = process.argv[2] || 'all';
let fails = 0;
function chk(ok, label, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
}

if (which === 'all' || which === '1') {
  console.log('\n===== 判据 1：长条对照组（梁永远碰不到南瓜）=====');
  for (const t of [5, 20]) {
    for (let i = 0; i < 3; i++) {
      const r = run({ strokes: synthLine(180, 700, 350, 702, 4, 0.7), ability: 'harden', thickness: t, seconds: 5 });
      chk(r.maxDev <= 2, `t=${t} 第${i + 1}次 南瓜位移 ${r.maxDev.toFixed(2)}px`, `落点 x=${r.spawnX.toFixed(0)} 结果 ${r.end}/${r.reason}`);
    }
  }
}

const WINDOW = [[205, 0], [215, 0], [225, 0], [232, 0], [236, 0]];
function knockRuns(ability, times) {
  const out = [];
  for (const [x] of WINDOW) {
    for (let k = 0; k < times; k++) {
      out.push(run({ strokes: synthCircle(x, 700, 16, 4), ability, thickness: 9, seconds: 7, stopOnEnd: false }));
    }
  }
  return out;
}

if (which === 'all' || which === '2') {
  console.log('\n===== 判据 2/3：砸悬空半边（5 落点 × 2 次）=====');
  const rs = knockRuns('harden', 2);
  const wins = rs.filter((r) => r.end === 'win').length;
  const xs = rs.filter((r) => r.end === 'win').map((r) => r.propX);
  const range = xs.length ? Math.max(...xs) - Math.min(...xs) : -1;
  chk(wins >= 9, `落入收货口 ${wins}/${rs.length}（门槛 ≥9）`);
  chk(range <= 80, `落点 x 极差 ${range.toFixed(1)}px（门槛 ≤80）`);
  console.log('    明细：' + rs.map((r) => `${r.spawnX.toFixed(0)}→${r.end === 'win' ? 'WIN@' + r.propX.toFixed(0) : r.reason}`).join('  '));
}

if (which === 'all' || which === '4') {
  console.log('\n===== 判据 4：南瓜静置 3 秒 =====');
  const r = run({ strokes: null, seconds: 3 });
  chk(r.maxDev <= 1, `静置漂移 ${r.maxDev.toFixed(2)}px（门槛 ≤1）`);
}

if (which === 'all' || which === '7') {
  console.log('\n===== 判据 7：不点「变硬」（软造物必须砸不动）=====');
  const rs = knockRuns(null, 1);
  const wins = rs.filter((r) => r.end === 'win').length;
  chk(wins === 0, `软造物 5 次里过关 ${wins} 次（门槛 = 0）`);
  console.log('    明细：' + rs.map((r) => `${r.spawnX.toFixed(0)}→${r.end}/${r.reason}`).join('  '));
}

if (which === 'all' || which === '5') {
  console.log('\n===== 判据 5：「会滚」带/不带各 10 次 =====');
  const noRoll = knockRuns('harden', 2);
  const withRoll = knockRuns(null, 2).map((r) => r);   // 占位：会滚需与变硬同戴，下面单跑
  const rollRuns = [];
  for (const [x] of WINDOW) {
    for (let k = 0; k < 2; k++) {
      const w = world.createPhysicsWorld();
      const events = [];
      const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
      const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
      const geo = classify.analyzeStrokeGroup([{ pts: synthCircle(x, 700, 16, 4) }]);
      rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
      rt.setAbility('harden'); rt.setAbility('roll');
      for (let f = 0; f < 60 * 7; f++) { rt.step(1); if (events.some((e) => e[0] === 'level:win')) break; }
      rollRuns.push({ end: events.some((e) => e[0] === 'level:win') ? 'win' : 'no' });
      rt.destroy();
    }
  }
  const a = noRoll.filter((r) => r.end === 'win').length / noRoll.length;
  const b = rollRuns.filter((r) => r.end === 'win').length / rollRuns.length;
  chk(b >= a - 0.2, `成功率 ${(a * 100).toFixed(0)}% → 带会滚 ${(b * 100).toFixed(0)}%（门槛下降 ≤20%）`);
}

console.log(`\n# 未达标条目：${fails}`);
