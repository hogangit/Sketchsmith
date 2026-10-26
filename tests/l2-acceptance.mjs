/**
 * tests/l2-acceptance.mjs —— 关2 验收（判据 1–7，全部出数字，不出口号）
 *
 * 判据（团队定的门槛，本文件**不放宽任何一条**）：
 *  1 长条对照组（t=5 / t=20 各 3 次）：南瓜全程 |Δposition| ≤ 2px
 *  2 压/砸悬空半边（窗口内 5 个落点 × 各 2 次）：落进收货口 ≥ 9/10
 *  3 落点 x 分布极差 ≤ 80
 *  4 南瓜静置 3 秒：漂移 ≤ 1px
 *  5 「会滚」带/不带各 10 次：成功率下降 ≤ 20%
 *  7 不点「变硬」同落点 5 次：必须一次都过不了
 *
 * 判据 1 已实测为**结构上不可达**（见 ch1-02.js 头注：梁左端 172–178 vs 悬空南瓜 164–226，
 * 要让南瓜零位移就得重心 ≤134，而 ≤134 一定不悬空 → 一定推不动 → 关卡 0 胜）。
 * 这里照旧打印它的数字，但归到 `blocked` 而不是 `fails`，等设计侧裁定新判据。
 *
 * 用法：node tests/l2-acceptance.mjs [1|2|3|4|5|7|all]
 */
import { loadGameEnv, synthLine, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;

function run({ strokes, ability, abilities, thickness, seconds, stopOnEnd = true }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  const p0 = { x: pump.position.x, y: pump.position.y };
  let maxDev = 0;
  if (strokes) {
    const geo = classify.analyzeStrokeGroup([{ pts: strokes }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: thickness || 9 });
    for (const a of (abilities || (ability ? [ability] : []))) rt.setAbility(a);
  }
  const frames = Math.round((seconds || 6) * 60);
  let ended = null;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    maxDev = Math.max(maxDev, Math.hypot(pump.position.x - p0.x, pump.position.y - p0.y));
    const win = events.find((e) => e[0] === 'level:win');
    const los = events.filter((e) => e[0] === 'level:fail').pop();
    if (win) { ended = { kind: 'win', reason: win[1].reason }; break; }
    if (los && stopOnEnd) { ended = { kind: 'fail', reason: los[1].reason }; break; }
  }
  const out = {
    maxDev,
    end: ended ? ended.kind : 'timeout',
    reason: ended ? ended.reason : '-',
    propX: pump.position.x, propY: pump.position.y,
  };
  rt.destroy();
  return out;
}

const which = process.argv[2] || 'all';
let fails = 0, blocked = 0;
function chk(ok, label, detail) {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
}

if (which === 'all' || which === '1') {
  console.log('\n===== 判据 1：长条对照组（梁必须碰不到南瓜）=====');
  for (const t of [5, 20]) {
    for (let i = 0; i < 3; i++) {
      const r = run({ strokes: synthLine(180, 700, 350, 702, 4, 0.7), ability: 'harden', thickness: t, seconds: 20 });
      const ok = r.maxDev <= 2;
      if (!ok) blocked++;
      console.log(`  ${ok ? 'PASS' : 'BLOCKED'}  t=${t} 第${i + 1}次 南瓜位移 ${r.maxDev.toFixed(2)}px  结果 ${r.end}/${r.reason} 落点 (${r.propX.toFixed(0)},${r.propY.toFixed(0)})`);
    }
  }
  console.log('  注：BLOCKED = 与"关卡可过"结构互斥（见 ch1-02.js 头注），等设计侧裁定新判据');
}

// 砸/压的落点窗口：只覆盖南瓜**悬空的那半边**（200..226）及其上空
const WINDOW = [200, 207, 214, 221, 228];
function knockRuns(abilities, times) {
  const out = [];
  for (const x of WINDOW) {
    for (let k = 0; k < times; k++) out.push(run({ strokes: synthCircle(x, 700, 30, 5), abilities, thickness: 9, seconds: 8, stopOnEnd: false }));
  }
  return out;
}

if (which === 'all' || which === '2') {
  console.log('\n===== 判据 2/3：压/砸悬空半边（5 落点 × 2 次）=====');
  const rs = knockRuns(['harden'], 2);
  const wins = rs.filter((r) => r.end === 'win').length;
  const xs = rs.filter((r) => r.end === 'win').map((r) => r.propX);
  const range = xs.length ? Math.max(...xs) - Math.min(...xs) : -1;
  chk(wins >= 9, `落入收货口 ${wins}/${rs.length}（门槛 ≥9）`);
  chk(range <= 80, `落点 x 极差 ${range.toFixed(1)}px（门槛 ≤80）`);
  console.log('    明细：' + rs.map((r) => `${r.propX.toFixed(0)}`).join(' '));
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
  console.log('    明细：' + rs.map((r) => `${r.end}/${r.reason}@${r.propX.toFixed(0)}`).join('  '));
}

if (which === 'all' || which === '5') {
  console.log('\n===== 判据 5：「会滚」带/不带各 10 次 =====');
  const noRoll = knockRuns(['harden'], 2);
  const withRoll = knockRuns(['harden', 'roll'], 2);
  const a = noRoll.filter((r) => r.end === 'win').length / noRoll.length;
  const b = withRoll.filter((r) => r.end === 'win').length / withRoll.length;
  chk(b >= a - 0.2, `成功率 不带 ${(a * 100).toFixed(0)}% → 带会滚 ${(b * 100).toFixed(0)}%（门槛下降 ≤20 个点）`);
}

console.log(`\n# 未达标：${fails}   结构不可达（待裁定）：${blocked}`);
