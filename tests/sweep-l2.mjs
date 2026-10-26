/**
 * tests/sweep-l2.mjs —— 关2 落位扫描（**只测量，不改关卡**）
 *
 * 目的：D22 定的落位（重心 195、悬空 26px）在判据 1（长条对照组，梁碰不到南瓜）上失败。
 * 这个脚本把南瓜重心 x 当自变量，把三条判据当因变量扫一遍，找出"三者同时成立"的那段区间。
 *
 * 为什么必须扫而不是推：
 *   · 梁是从 spawnY=84 **自由落体**下来的，它的左端扫过哪一段 x 只在实测里才准；
 *   · 南瓜悬空多少才"立得住"是摩擦+重心的耦合结果，解析算不准（阈值实测量到 ~29px）。
 *
 * 判据（团队口径，阈值不许在这里放宽）：
 *   1 梁 t=5 / t=20 各 3 次：南瓜全程 |Δposition| ≤ 2px
 *   4 南瓜静置 3 秒：漂移 ≤ 1px
 *   2 砸右半边：落点窗口内 ≥9/10 进收货口（收货口 205..285，不随南瓜移动）
 *
 * 用法：node tests/sweep-l2.mjs
 */
import { loadGameEnv, synthLine, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;

/** 克隆一个只改南瓜落位（和随之而来的高亮/示意线）的关卡 */
function makeLevel(cx) {
  const L = JSON.parse(JSON.stringify(BASE));
  L.props[0].x = cx;
  const half = L.props[0].w / 2;
  L.hints.highlight = [{ x: Math.min(199, cx + half * 0.5), y: 300, r: 22 }];
  return L;
}

function run(level, { strokes, ability, thickness, seconds, stopOnEnd = true }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  const p0 = { x: pump.position.x, y: pump.position.y };
  let maxDev = 0, dev5 = 0, dev20 = 0;
  if (strokes) {
    const geo = classify.analyzeStrokeGroup([{ pts: strokes }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: thickness || 9 });
    if (ability) rt.setAbility(ability);
  }
  const frames = Math.round((seconds || 6) * 60);
  let ended = null;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    const d = Math.hypot(pump.position.x - p0.x, pump.position.y - p0.y);
    maxDev = Math.max(maxDev, d);
    if (f + 1 === 5 * 60) dev5 = d;
    if (f + 1 === 20 * 60) dev20 = d;
    const win = events.find((e) => e[0] === 'level:win');
    const los = events.filter((e) => e[0] === 'level:fail').pop();
    if (win) { ended = { kind: 'win', reason: win[1].reason }; break; }
    if (los && stopOnEnd) { ended = { kind: 'fail', reason: los[1].reason }; break; }
  }
  // 造物静止后的 x 足迹（用来解释梁到底扫到了哪里）
  const cb = rt.creatures.length ? rt.creatures[0].bodies : [];
  let lo = Infinity, hi = -Infinity;
  for (const b of cb) {
    for (const v of b.vertices) { lo = Math.min(lo, v.x); hi = Math.max(hi, v.x); }
  }
  const out = {
    maxDev, dev5, dev20,
    end: ended ? ended.kind : 'timeout',
    reason: ended ? ended.reason : '-',
    propX: pump.position.x, propY: pump.position.y,
    beamLo: cb.length ? lo : NaN, beamHi: cb.length ? hi : NaN,
  };
  rt.destroy();
  return out;
}

const CX = [140, 148, 156, 164, 172, 180, 188, 195];
const KNOCK = [138, 146, 154, 162, 170, 178, 186, 194, 202];

console.log('# 关2 落位扫描 —— 南瓜重心 x ⇒ 判据 1 / 4 / 2');
console.log('# 收货口固定 205..285（不随南瓜移动）；台沿 x=200');
console.log('');

for (const cx of CX) {
  const L = makeLevel(cx);
  const half = L.props[0].w / 2;
  const overhang = Math.max(0, cx + half - 200);
  console.log(`\n===== 重心 x=${cx}  南瓜 ${(cx - half).toFixed(0)}..${(cx + half).toFixed(0)}  悬空 ${overhang.toFixed(0)}px =====`);

  // 判据 4：静置 3 秒
  const still = run(L, { strokes: null, seconds: 3 });
  console.log(`  判据4 静置3s 漂移 ${still.maxDev.toFixed(2)}px  ${still.maxDev <= 1 ? 'PASS' : 'FAIL'}`);

  // 判据 1：长条对照组
  let j1 = true;
  for (const t of [5, 20]) {
    const devs = [];
    for (let i = 0; i < 3; i++) {
      const r = run(L, { strokes: synthLine(180, 700, 350, 702, 4, 0.7), ability: 'harden', thickness: t, seconds: 20 });
      devs.push(r.maxDev);
      if (i === 0) console.log(`      梁 t=${t}: 静止足迹 x ${r.beamLo.toFixed(0)}..${r.beamHi.toFixed(0)}  t5=${r.dev5.toFixed(2)} t20=${r.dev20.toFixed(2)}`);
    }
    const worst = Math.max(...devs);
    if (worst > 2) j1 = false;
    console.log(`  判据1 t=${t}: 三次最大位移 ${devs.map((d) => d.toFixed(2)).join(' / ')}px  ${worst <= 2 ? 'PASS' : 'FAIL'}`);
  }

  // 判据 2：砸（用能覆盖南瓜右半边的落点网格）
  const hits = [];
  for (const kx of KNOCK) {
    const r = run(L, { strokes: synthCircle(kx, 700, 16, 4), ability: 'harden', thickness: 9, seconds: 8, stopOnEnd: false });
    hits.push({ kx, ...r });
  }
  const wins = hits.filter((h) => h.end === 'win');
  const wx = wins.map((h) => h.propX);
  const range = wx.length ? Math.max(...wx) - Math.min(...wx) : -1;
  console.log(`  判据2/3 砸 9 个落点：进收货口 ${wins.length}/9  落点x范围 ${wx.length ? wx.map((x) => x.toFixed(0)).join(',') : '-'}  极差 ${range.toFixed(0)}px`);
  console.log('      明细 ' + hits.map((h) => `${h.kx}→${h.end === 'win' ? 'W' + h.propX.toFixed(0) : h.reason}`).join(' '));
  console.log(`  ⇒ ${j1 && still.maxDev <= 1 && wins.length >= 9 ? '本条落位可用' : '本条落位不可用'}`);
}
