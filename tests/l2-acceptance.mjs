/**
 * tests/l2-acceptance.mjs —— 关2 验收（D24/D25/D26 口径，全部出数字，不出口号）
 *
 * 判据：
 *  1a 梁落下后南瓜**不能进收货口**（6/6）…… **已被设计侧作废（D23）**：梁是第三条真解。
 *      本脚本仍照跑并报数，用来证明"作废"这件事是真的（而不是没测）。
 *  1b **无软锁**：6/6 必须落进明确终态（四种），零次"都没有"
 *  1c 三个"不可推进"终态各自可达（岸台面 / 造物顶面 / 卡沟壁），且都走 fail + 送新南瓜
 *  2  压/砸悬空半边（5 落点 × 2 次）：进收货口 ≥ 9/10
 *  3  落点 x 极差 ≤ 80
 *  4  南瓜静置 3 秒：漂移 ≤ 1px
 *  5  `会滚` **贴不贴都必须能过**（它在关2 只是预演，不是解法）：各 10 次都 ≥ 9/10
 *  7  不点「变硬」必须失败 …… **已被设计侧作废**：变硬不改质量，与"无机关+只允许竖直下落"互斥。
 *      本脚本报数（tests/probe-l2-mass.mjs 是完整的质量扫描证据）。
 *
 * 用法：node tests/l2-acceptance.mjs [1|2|3|4|5|7|all]
 */
import { loadGameEnv, synthLine, synthCircle, synthRect } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;

/** 一遍跑完，返回终态与南瓜轨迹 */
function run({ strokes, abilities, thickness, seconds = 12, plan = null }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const activePump = () => rt.state.props[rt.state.activeProp];
  const p0 = { x: activePump().position.x, y: activePump().position.y };
  let maxDev = 0;
  const spawnOne = (pts, th) => {
    const geo = classify.analyzeStrokeGroup([{ pts }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: th || 9 });
    for (const a of abilities || []) rt.setAbility(a);
    return geo;
  };
  let geo = null;
  if (plan) plan.forEach((step, i) => { if (i === 0) geo = spawnOne(step.pts, step.thickness); });
  else if (strokes) geo = spawnOne(strokes, thickness);

  const frames = Math.round(seconds * 60);
  let firstFail = null;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    const win = events.find((e) => e[0] === 'level:win');
    const los = events.filter((e) => e[0] === 'level:fail');
    if (los.length && !firstFail) firstFail = los[0][1];
    if (win) break;
    if (los.length && !plan) break;           // 单发：一有终态就收
    // 多步剧本：第二步在指定帧投放
    if (plan && plan[1] && f === plan[1].at) spawnOne(plan[1].pts, plan[1].thickness);
    const p = activePump();
    maxDev = Math.max(maxDev, Math.hypot(p.position.x - p0.x, p.position.y - p0.y));
  }
  const p = activePump();
  const out = {
    maxDev,
    end: events.find((e) => e[0] === 'level:win') ? 'win' : (firstFail ? 'fail:' + firstFail.reason : 'timeout'),
    propX: p.position.x, propY: p.position.y, propRight: p.bounds.max.x,
    propCount: rt.state.props.length,
    form: geo ? geo.form : '-',
  };
  rt.destroy();
  return out;
}

const which = process.argv[2] || 'all';
let fails = 0;
const chk = (ok, label, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  —  ' + detail : ''}`);
};

const BEAM = { strokes: synthLine(180, 700, 350, 702, 4, 0.7) };
const KNOCK_WINDOW = [200, 207, 214, 221, 228];   // 悬空半边 200..226 及其上空

if (which === 'all' || which === '1') {
  console.log('\n===== 判据 1a（已作废·仅报数：梁是第三条真解）=====');
  const rows = [];
  for (const t of [5, 20]) for (let i = 0; i < 3; i++) rows.push({ t, r: run({ ...BEAM, abilities: ['harden'], thickness: t, seconds: 20 }) });
  const wins = rows.filter((x) => x.r.end === 'win').length;
  for (const x of rows) console.log(`    t=${x.t}  ${x.r.end}  南瓜落点 (${x.r.propX.toFixed(0)},${x.r.propY.toFixed(0)})`);
  console.log(`  · 梁进收货口 ${wins}/6 —— 设计侧已把"梁必须失败"作废（D23），此数仅作留证`);

  console.log('\n===== 判据 1b：无软锁（6/6 必须有明确终态）=====');
  const definite = rows.filter((x) => x.r.end !== 'timeout').length;
  chk(definite === 6, `明确终态 ${definite}/6（门槛 6/6，零次"都没有"）`,
    rows.map((x) => x.r.end.replace('fail:', '')).join(' '));

  console.log('\n===== 判据 1c：三个"不可推进"终态的**判定/台词/送新南瓜**都对 =====');
  // 判定逻辑用**构造状态**验（不靠玩法运气）：摆好位置 → 跑过 1.5s 静止窗口 → 看命中哪一条。
  // 真实可达性单独在下面用"真打一遍"的电池报，两件事不混着说。
  const M = globalThis.Matter;
  const place = (propAt, creature) => {
    const w = world.createPhysicsWorld();
    const ev2 = [];
    const r = runtime.createLevelRuntime({ level: L2, world: w, bus: { emit: (e, p) => ev2.push([e, p]), on() {}, countOf() { return 0; } } });
    if (creature) {
      const cb = M.Bodies.rectangle(creature.x, creature.y, creature.w, creature.h, {});
      w.addBody(cb);
      r.state.creatures.push({ id: 99, bodies: [cb], constraints: [], form: 'blob', fadeMs: 0 });
    }
    const p = r.state.props[r.state.activeProp];
    M.Body.setPosition(p, propAt);
    M.Body.setVelocity(p, { x: 0, y: 0 });
    M.Body.setAngularVelocity(p, 0);
    if (!creature) M.Body.setStatic(p, true);
    let reason = null;
    for (let f = 0; f < 200; f++) {
      r.step(1);
      const w2 = ev2.find((e) => e[0] === 'level:win');
      const l2 = ev2.filter((e) => e[0] === 'level:fail');
      if (w2) { reason = 'win'; break; }
      if (l2.length) { reason = l2[0][1].reason; break; }
    }
    const count = r.state.props.length;
    r.destroy();
    return { reason, count };
  };
  const cases = [
    ['岸台面', place({ x: 150, y: 269 }), 'prop-back-on-bank'],
    ['造物顶面', place({ x: 214, y: 358 }, { x: 214, y: 430, w: 90, h: 80 }), 'prop-on-creature'],
    ['卡沟壁', place({ x: 294, y: 366 }), 'prop-wedged'],
    ['仍悬空（不判）', place({ x: 195, y: 269 }), null],
  ];
  for (const [name, r, want] of cases) {
    const ok = (want == null ? r.reason == null : r.reason === want);
    chk(ok, `${name} → ${want || '不判任何终态'}`, `实得 ${r.reason || 'none'}，场上南瓜 ${r.count} 颗`);
  }

  console.log('\n  · 真实可达性（真打一遍，不是构造）：');
  const battery = [
    ['梁 t=5', { strokes: synthLine(180, 700, 350, 702, 4, 0.7), abilities: ['harden'], thickness: 5, seconds: 20 }],
    ['梁 t=20', { strokes: synthLine(180, 700, 350, 702, 4, 0.7), abilities: ['harden'], thickness: 20, seconds: 20 }],
    ['沟里垫块+撞 214', { plan: [{ pts: synthRect(265, 700, 90, 80, 6) }, { at: 240, pts: synthCircle(214, 700, 30, 5) }], abilities: ['harden'], seconds: 18 }],
    ['圆 r30 @238', { strokes: synthCircle(238, 700, 30, 5), abilities: ['harden'], seconds: 14 }],
    ['圆 r30 @244', { strokes: synthCircle(244, 700, 30, 5), abilities: ['harden'], seconds: 14 }],
    ['块 60x60 @236', { strokes: synthRect(236, 700, 60, 60, 5), abilities: ['harden'], seconds: 14 }],
  ];
  const tally = {};
  for (const [name, cfg] of battery) {
    const r = run(cfg);
    tally[r.end] = (tally[r.end] || 0) + 1;
    console.log(`      ${name.padEnd(16)} → ${r.end}`);
  }
  const never = ['prop-back-on-bank', 'prop-on-creature'].filter((k) => !tally['fail:' + k]);
  if (never.length) {
    for (const k of never) {
      console.log(`  ⚠️  ${k} 在 ${battery.length} 次真实运行里**一次都没出现** ⇒ 这个终态在玩法里不可达（判定分支保留，走兜底台词 ${L2.failLines[k]}；专属台词已连 id 删除）`);
    }
  }
}

if (which === 'all' || which === '2') {
  console.log('\n===== 判据 2/3：压/砸悬空半边（5 落点 × 2 次）=====');
  const rs = [];
  for (const x of KNOCK_WINDOW) for (let k = 0; k < 2; k++) rs.push(run({ strokes: synthCircle(x, 700, 30, 5), abilities: ['harden'], seconds: 10 }));
  const wins = rs.filter((r) => r.end === 'win');
  const xs = wins.map((r) => r.propX);
  const range = xs.length ? Math.max(...xs) - Math.min(...xs) : -1;
  chk(wins.length >= 9, `进收货口 ${wins.length}/10（门槛 ≥9）`);
  chk(range <= 80, `落点 x 极差 ${range.toFixed(1)}px（门槛 ≤80）`);
  console.log('    明细：' + rs.map((r) => (r.end === 'win' ? r.propX.toFixed(0) : r.end.replace('fail:', 'F:'))).join(' '));
}

if (which === 'all' || which === '4') {
  console.log('\n===== 判据 4：南瓜静置 3 秒 =====');
  const r = run({ seconds: 3 });
  chk(r.maxDev <= 1, `静置漂移 ${r.maxDev.toFixed(2)}px（门槛 ≤1）`);
}

if (which === 'all' || which === '5') {
  console.log('\n===== 判据 5：`会滚` 贴不贴都必须能过（各 10 次）=====');
  const noRoll = [], withRoll = [];
  for (const x of KNOCK_WINDOW) for (let k = 0; k < 2; k++) {
    noRoll.push(run({ strokes: synthCircle(x, 700, 30, 5), abilities: ['harden'], seconds: 10 }));
    withRoll.push(run({ strokes: synthCircle(x, 700, 30, 5), abilities: ['harden', 'roll'], seconds: 10 }));
  }
  const a = noRoll.filter((r) => r.end === 'win').length;
  const b = withRoll.filter((r) => r.end === 'win').length;
  chk(a >= 9, `不贴会滚 ${a}/10 过关（门槛 ≥9）`);
  chk(b >= 9, `贴会滚 ${b}/10 过关（门槛 ≥9）`);
}

if (which === 'all' || which === '7') {
  console.log('\n===== 判据 7（已作废·仅报数：变硬不改质量）=====');
  const rs = KNOCK_WINDOW.slice(0, 5).map((x) => run({ strokes: synthCircle(x, 700, 30, 5), abilities: [], seconds: 10 }));
  console.log(`  · 软造物（不点变硬）${rs.filter((r) => r.end === 'win').length}/5 过关 —— 与"必须变硬"相斥，见 probe-l2-mass.mjs`);
}

console.log(`\n# 未达标：${fails}`);
process.exit(fails ? 1 : 0);
