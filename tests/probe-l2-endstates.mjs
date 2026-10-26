/**
 * tests/probe-l2-endstates.mjs —— 关2 四个终态的**可达性**实测
 *
 * 为什么单独测：四种终态各有一句台词。**如果某种终态在实际物理里根本到不了，
 * 那句台词就是死的**（和 `ch1_stamp` 同一个病：不报错、不出声、永远不出现）。
 * 所以这里不问"能不能触发"，问"哪些真的会出现、大概什么条件下出现"。
 *
 * 用法：node tests/probe-l2-endstates.mjs
 */
import { loadGameEnv, synthCircle, synthRect, synthLine } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;

function run(drops, abilities, seconds = 16) {
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const active = () => rt.state.props[rt.state.activeProp];
  const drop = (d) => {
    const geo = classify.analyzeStrokeGroup([{ pts: d.pts }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: d.thickness || 9 });
    for (const a of abilities) rt.setAbility(a);
  };
  drop(drops[0]);
  let first = null;
  for (let f = 0; f < 60 * seconds; f++) {
    if (drops[1] && f === drops[1].at) drop(drops[1]);
    rt.step(1);
    const los = events.filter((e) => e[0] === 'level:fail');
    if (los.length && !first) { first = los[0][1]; break; }
    if (events.some((e) => e[0] === 'level:win')) { first = { reason: 'WIN' }; break; }
  }
  const p = active();
  const out = { reason: first ? first.reason : 'none', px: p.position.x, py: p.position.y, right: p.bounds.max.x };
  rt.destroy();
  return out;
}

const tally = {};
const note = (label, r) => {
  tally[r.reason] = (tally[r.reason] || 0) + 1;
  console.log(`  ${label.padEnd(34)} → ${r.reason.padEnd(22)} 南瓜 (${r.px.toFixed(0)},${r.py.toFixed(0)}) 右缘 ${r.right.toFixed(0)}`);
};

console.log('# 四终态可达性（每行都是一次真实物理运行）\n');

console.log('— 撞悬空半边（预期：WIN）');
for (const x of [200, 214, 228]) note(`圆 r30 @${x}`, run([{ pts: synthCircle(x, 700, 30, 5) }], ['harden']));

console.log('\n— 撞靠岸半边 / 砸空（预期：不判 or 碎）');
for (const x of [150, 166, 180, 194]) note(`圆 r30 @${x}`, run([{ pts: synthCircle(x, 700, 30, 5) }], ['harden']));

console.log('\n— 从右上方（x>226）落下来，撞南瓜右脸（预期：把南瓜往左推 → 岸台面）');
for (const x of [230, 238, 246, 256]) note(`圆 r30 @${x}`, run([{ pts: synthCircle(x, 700, 30, 5) }], ['harden']));
for (const x of [230, 240, 250]) note(`块 60x60 @${x}`, run([{ pts: synthRect(x, 700, 60, 60, 5) }], ['harden']));

console.log('\n— 先往沟里丢一块，再把南瓜撞下去（预期：造物顶面）');
for (const bx of [250, 265, 280]) {
  note(`沟里块 90x80 @${bx}，再撞 214`, run([
    { pts: synthRect(bx, 700, 90, 80, 6) },
    { at: 240, pts: synthCircle(214, 700, 30, 5) },
  ], ['harden']));
}

console.log('\n— 小圆轻推（预期：卡沟壁或不判）');
for (const r of [12, 14, 16]) for (const x of [203, 208]) note(`圆 r${r} @${x}`, run([{ pts: synthCircle(x, 700, r, 4) }], ['harden']));

console.log('\n— 梁（预期：WIN，第三条真解）');
for (const t of [5, 20]) note(`梁 t=${t}`, run([{ pts: synthLine(180, 700, 350, 702, 4, 0.7), thickness: t }], ['harden'], 20));

console.log('\n# 终态统计：');
for (const k of Object.keys(tally)) console.log(`  ${k.padEnd(24)} ${tally[k]} 次`);
const never = ['prop-back-on-bank', 'prop-on-creature', 'prop-wedged'].filter((k) => !tally[k]);
console.log(never.length ? `\n  ⚠️  本轮从未出现：${never.join(' / ')}（对应台词是死的，要么找到触发条件，要么上报删台词）`
  : '\n  三个"不可推进"终态都实测出现过。');
