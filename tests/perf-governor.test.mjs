/**
 * tests/perf-governor.test.mjs —— PerfGovernor 降级行为（node 侧，不依赖浏览器）
 *
 * README 自陈「性能降级只做了绑定，没有压测证据」。真机帧率测不了（没有真机），
 * 但**降级逻辑本身**完全可以在这里验死：
 *   · 物理 >6ms 连续 30 帧 → 降一级（high→mid→low）
 *   · 帧间隔 p90 >16.7ms 连续 120 帧 → 降一级
 *   · 降到底就停；好帧**不升档**（升档会抖动，这是设计决定，也要验）
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { PerfGovernor, RenderQuality, PERF_DOWNGRADE_FRAMES, PERF_P90_FRAMES } =
  await import(pathToFileURL(path.join(ROOT, 'src/core/perf.js')).href);

function feed(frames) {
  for (const [dt, phys] of frames) PerfGovernor.sample(dt, phys);
}

// ── ① 物理超时降级：恰好 30 帧连续 >6ms → high 降 mid ──
PerfGovernor.init('high');
for (let i = 0; i < PERF_DOWNGRADE_FRAMES - 1; i++) PerfGovernor.sample(16, 8);   // 29 帧：还不到
assert.equal(PerfGovernor.tier, 'high', '29 帧不该降（阈值是连续 30 帧）');
PerfGovernor.sample(16, 8);                                                        // 第 30 帧
assert.equal(PerfGovernor.tier, 'mid', '连续 30 帧物理 >6ms 必须降级，实际 ' + PerfGovernor.tier);
assert.equal(RenderQuality.tier, 'mid', 'RenderQuality 必须跟着降（否则降档没有渲染效果）');

// ── ② 一帧好帧就把计数清零：不连续就不降 ──
PerfGovernor.init('high');
for (let i = 0; i < PERF_DOWNGRADE_FRAMES; i++) {
  PerfGovernor.sample(16, i === 15 ? 2 : 8);   // 中间插一帧好物理
}
assert.equal(PerfGovernor.tier, 'high', '中间有一帧好物理就该重置计数，不许降级');

// ── ③ p90 降级：120 帧全慢 → 降一级 ──
PerfGovernor.init('mid');
for (let i = 0; i < PERF_P90_FRAMES; i++) PerfGovernor.sample(25, 2);   // 帧慢但物理闲
assert.equal(PerfGovernor.tier, 'low', 'p90 连续 120 帧 >16.7ms 必须降级');

// ── ④ 降到底就停，不许降穿 ──
for (let i = 0; i < PERF_P90_FRAMES * 3; i++) PerfGovernor.sample(40, 9);
assert.equal(PerfGovernor.tier, 'low', '已经最低档还继续降（降穿了）');
assert.equal(PerfGovernor.stats.degraded >= 2, true, 'degraded 计数应记录降级次数（诊断用）');

// ── ⑤ 好帧不升档：恢复流畅后停在 low ──
PerfGovernor.init('low');
for (let i = 0; i < PERF_P90_FRAMES * 2; i++) PerfGovernor.sample(8, 1);
assert.equal(PerfGovernor.tier, 'low', '好帧不该升档（升档会抖动，规格写明不自动升）');

// ── ⑥ 档位语义：applyTier 的三档渲染开关必须和规格一致 ──
RenderQuality.applyTier('high');
assert.equal(RenderQuality.shadow, true, 'high 档应有投影');
RenderQuality.applyTier('mid');
assert.equal(RenderQuality.shadow, false, 'mid 档关投影');
assert.equal(RenderQuality.fill, true, 'mid 档保留填充');
RenderQuality.applyTier('low');
assert.equal(RenderQuality.fill, false, 'low 档连填充都要关（静态轮廓兜底）');

console.log('perf-governor：物理30帧降级/好帧清零/p90降级/降到底停/不升档/三档语义 → 6/6 通过');
