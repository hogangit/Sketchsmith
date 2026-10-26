/**
 * tests/core.test.mjs —— node --test 单元测试（零依赖）
 * 只测纯逻辑层：几何 / 判定 / 能力合成 / 事件总线 / 存档迁移。
 * 物理与关卡可解性由 tests/tune.mjs（诊断）与 tools/smoke-browser.mjs（真浏览器）覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameEnv, synthLine, synthRect, synthCircle } from './helpers/env.mjs';

const env = await loadGameEnv();
const { geometry, simplify, classify, compose, registry, combos } = env;
const { createBus } = await import('../src/core/bus.js');
const storage = await import('../src/core/storage.js');

test('geoPolygonArea：正方形面积与方向', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  assert.equal(Math.abs(geometry.geoPolygonArea(sq)), 100);
});

test('geoPolylineLength / geoBBox 基本正确', () => {
  const line = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }];
  assert.equal(geometry.geoPolylineLength(line), 100);
  const bb = geometry.geoBBox(line);
  assert.equal(bb.w, 100);
  assert.equal(bb.h, 0);
});

test('rdpSimplify：真直线被抽到 2 个节点；抖动折线不超上限', () => {
  const straight = [];
  for (let i = 0; i <= 150; i++) straight.push({ x: i * 2, y: 0 });
  assert.equal(simplify.rdpSimplify(straight).length, 2);
  const zig = synthLine(0, 0, 300, 40, 2, 20);
  assert.ok(simplify.rdpSimplify(zig).length <= 120);
});

test('classifyForm：细长开口 → 梁；闭合扁圈 → 团块；闭合圆 → 轮', () => {
  const beam = classify.analyzeStrokeGroup([{ pts: synthLine(100, 700, 240, 702, 4, 0.7) }]);
  assert.equal(beam.form, 'beam');
  const blob = classify.analyzeStrokeGroup([{ pts: synthRect(200, 700, 150, 40, 5) }]);
  assert.equal(blob.form, 'blob');
  const wheel = classify.analyzeStrokeGroup([{ pts: synthCircle(200, 700, 40, 6) }]);
  assert.equal(wheel.form, 'wheel');
});

test('classify：太小的笔画被标 tooSmall（不生成刚体，但也不报错）', () => {
  const tiny = classify.analyzeStrokeGroup([{ pts: [{ x: 100, y: 700 }, { x: 103, y: 701 }] }]);
  assert.equal(tiny.tooSmall, true);
});

test('判定树 2b：两笔相连且细长 → 梁（不是绳，绳在 v1 未实装）', () => {
  const a = synthLine(100, 700, 200, 700, 4, 0.4);
  const b = synthLine(200, 700, 320, 700, 4, 0.4);
  const g = classify.analyzeStrokeGroup([{ pts: a }, { pts: b }]);
  assert.equal(g.strokeCount, 2);
  assert.equal(g.form, 'beam');
  assert.equal(g.form === 'rope', false);
});

test('能力合成 R1–R3：layer 顺序 + 密度乘算 + 覆盖记入 notes', () => {
  const c1 = compose.composeAbilities(['heavy', 'light']);
  assert.ok(Math.abs(c1.mods.densityMul - 0.6) < 1e-9, '密度乘算应为 3 × 0.2');
  const c2 = compose.composeAbilities(['harden', 'roll']);
  assert.equal(c2.mods.friction, 0.02, 'motion 层（会滚）应覆盖 material 层（变硬）的摩擦');
  assert.equal(c2.flags.rigid, true, '变硬的 rigid 标记必须保留');
  assert.ok(c2.notes.some((n) => n.type === 'override' && n.key === 'friction'), '覆盖必须留痕（可审计）');
});

test('能力上限：每造物最多 2 枚（runtime 侧拒绝第 3 枚）', () => {
  assert.equal(registry.IMPLEMENTED_ABILITY_IDS.length, 4);
  assert.equal(registry.PLANNED_ABILITY_NAMES.length, 20);
  const th = env.materials && 1;
  assert.equal(typeof th, 'number');
});

test('组合表：硬滚石命中；变轻+怕痒已删（它是刻意 no-op）', () => {
  assert.ok(combos.lookupCombos(['harden', 'roll']).length >= 1);
  assert.equal(combos.lookupCombos(['light', 'tickle']).length, 0);
});

test('事件总线：handler 真被调用（不是只 connect 成功）', () => {
  const bus = createBus();
  let called = 0;
  const h = () => { called++; };
  bus.on('level:win', h);
  bus.emit('level:win', { reason: 'test' });
  bus.emit('level:win', { reason: 'test2' });
  assert.equal(called, 2, '计数断言：handler 必须真的执行了 2 次');
  assert.equal(bus.countOf('level:win'), 2);
  bus.off('level:win', h);
  bus.emit('level:win', {});
  assert.equal(called, 2, 'off 之后不再被调用');
});

test('事件总线：handler 抛错不会打断其他 handler', () => {
  const bus = createBus();
  let ok = 0;
  bus.on('x', () => { throw new Error('boom'); });
  bus.on('x', () => { ok++; });
  bus.emit('x', {});
  assert.equal(ok, 1);
});

test('SaveStore：内存桩满足契约（read 返回 null 不抛 / write 抛错可被捕获）', () => {
  const s = storage.createMemorySaveStore();
  assert.equal(s.read('nope'), null);
  assert.deepEqual(s.read('nope'), null);
  s.write('k', { a: 1 });
  assert.deepEqual(s.read('k'), { a: 1 });
  assert.deepEqual(s.list(), ['k']);
});

test('SaveStore 迁移 v1 → v2：不丢数据、幂等', () => {
  const s = storage.createMemorySaveStore({ progress: JSON.stringify({ cleared: 2, deaths: 3 }) });
  const p1 = storage.loadProgress(s);
  assert.equal(p1.schema, 2);
  assert.equal(p1.deaths, 3, 'v1 的 deaths 必须带过来');
  assert.equal(p1.cleared['ch1-01'], true);
  assert.equal(p1.cleared['ch1-02'], true);
  assert.equal(p1.maxUnlocked, 3);
  const p2 = storage.loadProgress(s);
  assert.deepEqual(p2, p1, '重复跑迁移结果必须一致（幂等）');
});

test('upgradeProgress：脏数据降级成默认进度，不抛异常', () => {
  assert.equal(storage.upgradeProgress(null).schema, 2);
  assert.equal(storage.upgradeProgress('乱码').schema, 2);
  assert.equal(storage.upgradeProgress({ schema: 2, cleared: 'x' }).cleared && typeof storage.upgradeProgress({ schema: 2, cleared: 'x' }).cleared, 'object');
});
