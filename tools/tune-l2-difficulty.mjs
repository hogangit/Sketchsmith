/**
 * tools/tune-l2-difficulty.mjs —— 关2 难度重标定扫描
 *
 * 背景：用户反馈"第2关很容易过"。实测南瓜在 x=195（悬空 26px）时 **20 次投掷 19 次过关**。
 *
 * 已证伪的路线：把南瓜挪回岸上（完全平放）—— 造物垂直下落对平放箱体无水平推力，
 *   质量 13.45 与 6 都是 **0/4 全失败**（与关卡文档 0/25 结论一致）。
 *
 * 本脚本扫「悬空量 × 南瓜质量」，并且**用冒烟里的标准梁形状**（196,700→312,704）
 * 判断 D23 的梁解法是否仍然成立 —— 早先用另一根梁得出"梁 timeout"是形状差异，不算数。
 */
import { loadGameEnv, synthCircle, synthRect, synthLine } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime } = env;
const BASE = env.levels.l2.LEVEL_CH1_02;
const MATTER = globalThis.Matter;

function run({ propX, mass, pts, abilities = [], seconds = 10 }) {
  const L = JSON.parse(JSON.stringify(BASE));
  L.props[0].x = propX;
  const w = world.createPhysicsWorld();
  const ev = [];
  const bus = { emit: (e, p) => ev.push([e, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L, world: w, bus });
  const pump = w.allBodies().find((b) => b.label === 'prop');
  if (mass) MATTER.Body.setDensity(pump, mass / (62 * 62));
  const geo = classify.analyzeStrokeGroup([{ pts }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
  for (const a of abilities) rt.setAbility(a);
  let end = 'timeout';
  for (let f = 0; f < 60 * seconds; f++) {
    rt.step(1);
    if (ev.some((e) => e[0] === 'level:win')) { end = 'win'; break; }
    const fl = ev.find((e) => e[0] === 'level:fail');
    if (fl) { end = 'fail:' + fl[1].reason; break; }
  }
  const res = { end, px: +pump.position.x.toFixed(0) };
  rt.destroy();
  return res;
}

const drops = [
  ['x198', synthCircle(198, 40, 26), []],
  ['x206', synthCircle(206, 40, 26), []],
  ['x214', synthCircle(214, 40, 26), []],
  ['x222', synthCircle(222, 40, 26), []],
  ['块90', synthRect(206, 40, 90, 80), []],
];
// 冒烟里的标准解法：梁 + 变硬
const BEAM = synthLine(196, 700, 312, 704, 4, 0.7);
const tiny = (s) => (s === 'win' ? 'W' : s === 'timeout' ? '·' : 'F');

const configs = [
  { label: 'x195 (悬26) 13.45 ← 现状', propX: 195, mass: 13.45 },
  { label: 'x193 (悬24) 13.45', propX: 193, mass: 13.45 },
  { label: 'x190 (悬21) 13.45', propX: 190, mass: 13.45 },
  { label: 'x187 (悬17) 13.45', propX: 187, mass: 13.45 },
  { label: 'x195 (悬26) 质量20', propX: 195, mass: 20 },
  { label: 'x190 (悬21) 质量20', propX: 190, mass: 20 },
];

console.log('投掷落点：' + drops.map((d) => d[0]).join(' ') + '   W=过 ·=没反应 F=判失败');
for (const c of configs) {
  const rows = drops.map(([n, pts, ab]) => tiny(run({ propX: c.propX, mass: c.mass, pts, abilities: ab }).end));
  const wins = rows.filter((r) => r === 'W').length;
  const b = run({ propX: c.propX, mass: c.mass, pts: BEAM, abilities: ['harden'] });
  console.log(`${c.label.padEnd(24)} ${rows.join('  ')}  → ${wins}/${drops.length}   梁+硬=${b.end}`);
}
