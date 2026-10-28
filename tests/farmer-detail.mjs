/**
 * tests/farmer-detail.mjs —— 农夫「活」感 F1–F4 的笔迹级验收（art-polish 第五章）
 *
 * 为什么要在 node 里用假 ctx 测：drawFarmer 是纯绘制函数，不依赖 DOM/Canvas。
 * 四个细节都是「改几根线的位置」，肉眼在 40px 高的火柴人上几乎不可辨，
 * 但**笔迹集合**的差异是确定的、可断言的——这才是能进 CI 的证据。
 *
 * 判据：
 *  ① 五个状态都能画完，且坐标全部有限（无 NaN / Infinity）
 *  ② F3 跳跃：与常态相比腿/臂笔迹变了，且帽顶 y 上抬 1px
 *  ③ F1 挠头：出现挠头弧（arc 数增加），且跳跃时不挠头（F3 优先）
 *  ④ F2 看向造物：眼睛 x 偏移 0.6px，且能朝左
 *  ⑤ F4 帽檐风动：笔迹数增加；不起风的关卡（无 wind 标记）不触发
 */
import assert from 'node:assert/strict';
import { drawFarmer } from '../src/render/handdrawn.js';

/** 记录型假 ctx：把每个路径命令的坐标摊平成一条字符串序列 */
function fakeCtx() {
  const path = [];
  let current = null;
  const push = (op, ...nums) => {
    for (const n of nums) {
      if (typeof n === 'number' && !Number.isFinite(n)) {
        throw new Error(`非法坐标：${op}(${nums.join(',')})`);
      }
    }
    path.push(op + '(' + nums.map((n) => (typeof n === 'number' ? n.toFixed(2) : n)).join(',') + ')');
  };
  return {
    path,
    _p: () => current,
    save() { push('save'); },
    restore() { push('restore'); },
    translate(x, y) { push('translate', x, y); },
    scale(x, y) { push('scale', x, y); },
    beginPath() { current = []; push('beginPath'); },
    moveTo(x, y) { push('moveTo', x, y); },
    lineTo(x, y) { push('lineTo', x, y); },
    arc(x, y, r, a0, a1) { push('arc', x, y, r, a0, a1); },
    ellipse(x, y, rx, ry, rot, a0, a1) { push('ellipse', x, y, rx, ry, rot, a0, a1); },
    closePath() { push('closePath'); },
    fill() { push('fill'); },
    stroke() { push('stroke'); },
    set lineWidth(v) { if (!Number.isFinite(v)) throw new Error('lineWidth 非法'); },
    set strokeStyle(v) { if (v == null) throw new Error('strokeStyle 非法'); },
    set fillStyle(v) { if (v == null) throw new Error('fillStyle 非法'); },
    set lineCap(v) { /* noop */ },
    set lineJoin(v) { /* noop */ },
  };
}

function draw(opts) {
  const ctx = fakeCtx();
  drawFarmer(ctx, 100, 300, opts);
  return ctx.path;
}

const BASE = { face: 1, phase: 0 };
const base = draw(BASE);
const jump = draw({ ...BASE, jump: true, t: 1.0 });
const idle = draw({ ...BASE, idle: true, t: 1.0 });
const look = draw({ ...BASE, look: true });
const windy = draw({ ...BASE, windy: true, t: 1.0 });

// ── ① 五个状态都能画完，坐标全部有限 ────────────────────────────────────────
// （fakeCtx 里出现非有限数会直接抛，此处再做一层显式确认）
for (const [name, p] of [['常态', base], ['F3跳跃', jump], ['F1挠头', idle], ['F2注视', look], ['F4风动', windy]]) {
  assert.ok(p.length > 10, `${name} 笔迹过少（${p.length}）——农夫没画出来`);
  assert.ok(!p.some((s) => /NaN|Infinity/.test(s)), `${name} 出现非法坐标`);
}
console.log(`① 五态均可绘制且坐标有限：常态 ${base.length} 笔 / 跳跃 ${jump.length} / 挠头 ${idle.length} / 注视 ${look.length} / 风动 ${windy.length}`);

// ── ② F3 跳跃姿势：腿收拢 + 臂上举 + 帽上抬 1px ─────────────────────────────
const legIdx = (p) => p.findIndex((s) => s.startsWith('lineTo') && s.includes(',13.00)'));
assert.ok(legIdx(base) >= 0, '常态应有落地的腿（y=13）');
assert.equal(legIdx(jump), -1, 'F3 跳跃时腿应收拢上抬，不应还有 y=13 的落地点');
const upArm = jump.some((s) => /^lineTo\(-?\d+\.\d+,-8\.\d+\)/.test(s));
assert.ok(upArm, 'F3 跳跃时双臂应上举到 y≈-8 区');
// 帽顶上抬 1px：常态 arc(0.60,-11.10,…)，跳跃 arc(0.60,-12.10,…)
const hatY = (p) => {
  const i = p.findIndex((s) => s.startsWith('arc(0.60,-11.1') || s.startsWith('arc(0.60,-12.1'));
  return i < 0 ? null : Number(p[i].slice(4).split(',')[1]);
};
assert.equal(hatY(base), -11.10, '常态帽顶 y 应为 -11.10');
assert.equal(hatY(jump), -12.10, 'F3 跳跃帽顶应上抬 1px（-11.10 → -12.10）');
console.log('② F3 跳跃：腿收拢（无 y=13 落点）+ 双臂上举至 y≈-8 + 帽顶上抬 1px ✔');

// ── ③ F1 挠头：出现挠头弧；且跳跃时不挠头（F1 让位 F3） ──────────────────────
const arcCount = (p) => p.filter((s) => s.startsWith('arc(')).length;
assert.ok(arcCount(idle) > arcCount(base), `F1 挠头应多出肘部小弧：base=${arcCount(base)} idle=${arcCount(idle)}`);
assert.ok(
  idle.some((s) => s.startsWith('lineTo(-4.60,-9.00)')),
  'F1 挠头的手臂应经过头侧 (-4.6,-9)',
);
assert.equal(arcCount(draw({ ...BASE, idle: true, jump: true, t: 1.0 })), arcCount(jump),
  '跳跃时不应同时挠头（F3 优先）');
console.log(`③ F1 挠头：肘部小弧 ${arcCount(idle) - arcCount(base)} 段，手臂过头侧；跳跃时让位 F3 ✔`);

// ── ④ F2 看向造物：眼睛偏移 0.6px，且能朝左（face=-1） ───────────────────────
const eyeX = (p) => {
  const i = p.findIndex((s) => s.startsWith('arc(2.30,') || s.startsWith('arc(2.90,'));
  return i < 0 ? null : Number(p[i].slice(4).split(',')[0]);
};
assert.equal(eyeX(base), 2.30, '常态眼睛 x 应为 2.30');
assert.equal(eyeX(look), 2.90, 'F2 注视时眼睛应额外偏 0.6px（2.30 → 2.90）');
// face=-1 时整体镜像：scale 的第一参数应为负
const left = draw({ ...BASE, face: -1, look: true });
assert.ok(left.some((s) => s.startsWith('scale(-1')), 'F2 朝左时应对 x 轴镜像');
console.log('④ F2 看向造物：眼睛偏移 0.6px，face=-1 时镜像朝左 ✔');

// ── ⑤ F4 帽檐风动：笔迹增加；不起风时不触发 ─────────────────────────────────
assert.ok(windy.length > base.length, `F4 风动应多出帽檐抖动笔迹：base=${base.length} windy=${windy.length}`);
assert.equal(draw({ ...BASE, windy: false, t: 1.0 }).length, base.length, 'windy=false 应与常态完全一致');
// 帽檐微倾：ellipse(x,y,rx,ry,rot,a0,a1) 的第 5 个参数（索引 4）不再恒为 0。
// 注意别抓到地面投影的 ellipse（rx=10）——按帽檐的 rx/ry = 8.40/2.50 精确定位。
const brimRot = (p) => {
  const i = p.findIndex((s) => s.startsWith('ellipse(') && s.includes('8.40,2.50'));
  return i < 0 ? null : Number(p[i].split(',')[4]);
};
assert.equal(brimRot(base), 0, '常态帽檐不应倾斜');
assert.notEqual(brimRot(windy), 0, 'F4 风动时帽檐应有微倾');
console.log(`⑤ F4 帽檐风动：多出 ${windy.length - base.length} 笔（帽檐微倾+外侧两点抖），windy=false 时完全等同常态 ✔`);

console.log('\nF1–F4 全部通过：农夫仍是墨色火柴人（无新增填充块）。');
