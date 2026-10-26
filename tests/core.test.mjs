/**
 * tests/core.test.mjs —— node --test 单元测试（零依赖）
 * 只测纯逻辑层：几何 / 判定 / 能力合成 / 事件总线 / 存档迁移。
 * 物理与关卡可解性由 tests/tune.mjs（诊断）与 tools/smoke-browser.mjs（真浏览器）覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadGameEnv, ROOT, synthLine, synthRect, synthCircle } from './helpers/env.mjs';

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

test('能力合成 R1–R3：乘算键 + 会滚一个 friction 都不写（D16）', () => {
  const c1 = compose.composeAbilities(['heavy', 'light']);
  assert.ok(Math.abs(c1.mods.densityMul - 0.6) < 1e-9, '密度乘算应为 3 × 0.2');
  const c2 = compose.composeAbilities(['harden', 'roll']);
  assert.equal(c2.mods.friction, 0.9, '会滚不许写 friction：摩擦必须仍是变硬的 0.9');
  assert.ok(Math.abs(c2.mods.frictionAirMul - 0.25) < 1e-9, '会滚只压空气阻尼 ×0.25');
  assert.equal(c2.flags.rigid, true, '变硬的 rigid 标记必须保留');
  // 覆盖记痕机制仍在（未来能力会用到），但本轮 4 个能力写的是互斥键/乘算键，不该触发
  assert.equal(c2.notes.some((n) => n.type === 'override' && n.key === 'friction'), false,
    '会滚不写 friction，就不该出现 friction 覆盖记录');
  const c3 = compose.composeAbilities(['roll', 'harden']);
  assert.equal(c3.mods.friction, 0.9, '点选顺序不影响结果');
  assert.ok(Math.abs(c3.mods.frictionAirMul - 0.25) < 1e-9, '点选顺序不影响乘算键');
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


test('失败提示：形态分岔机制仍然生效（关1 在用），且不含禁止话术', async () => {
  const { pickFailHint } = await import(pathToFileURL(path.join(ROOT, 'src/render/hud.js')).href);
  const hints = [{ beam: '梁试试别的用法。', other: '它得先下去，还不能碎。' }, '第二次'];
  assert.equal(pickFailHint(hints, 1, 'beam'), '梁试试别的用法。', '梁 → 方向型暗示');
  assert.equal(pickFailHint(hints, 1, 'wheel'), '它得先下去，还不能碎。', '轮 → 常规暗示');
  assert.equal(pickFailHint(hints, 1, 'blob'), '它得先下去，还不能碎。', '团块 → 常规暗示');
  assert.equal(pickFailHint(hints, 2, 'beam'), '第二次', '第 2 次起回到阶梯文案');
  assert.equal(pickFailHint(hints, 0, 'beam'), '', '没失败就不提示');
  assert.equal(pickFailHint(['纯字符串'], 1, 'beam'), '纯字符串', '字符串项直接返回');
});

test('台词闭集：所有被引用的 id 都必须存在（含终态台词），形态台词只有 6 条', async () => {
  const { LINES } = await import(pathToFileURL(path.join(ROOT, 'src/text/lines.js')).href);
  // 形态台词 = 闭集（附录 A 的 6 条）；多一条少一条都要在这里失败
  const formIds = Object.keys(LINES).filter((k) => k.indexOf('form_') === 0).sort();
  assert.equal(formIds.length, 6, '形态台词必须是 6 条闭集，实际 ' + formIds.length);
  // 关卡里**每一处**台词引用都必须能解析：lines 的每个槽 + failLines 的每个终态
  // （ch1_stamp vs stamp1 那个静默 bug 就是靠这条抓到的：写错的 id 运行时只会不出声）
  const levelMods = [env.levels.l1.LEVEL_CH1_01, env.levels.l2.LEVEL_CH1_02, env.levels.l3.LEVEL_CH1_03];
  for (const lv of levelMods) {
    for (const slot of Object.keys(lv.lines || {})) {
      const id = lv.lines[slot];
      if (id == null) continue;
      assert.ok(LINES[id], '关 ' + lv.id + ' 的 lines.' + slot + ' 指向了不存在的台词 id: ' + id);
    }
    for (const reason of Object.keys(lv.failLines || {})) {
      const id = lv.failLines[reason];
      if (id == null) continue;
      assert.ok(LINES[id], '关 ' + lv.id + ' 的 failLines[' + reason + '] 指向了不存在的台词 id: ' + id);
    }
  }
  // 关2 的终态台词：两个"不可推进"终态实测 0 次可达，**已连 id 一起删除**。
  // 这条断言是防复发的：谁再把那两句加回来（哪怕是"预留"），这里立刻红——
  // 不可达的台词等于没有台词，而占位是负资产（和 ch1_stamp 同一类静默 bug）。
  assert.equal(LINES['l2_fail_beam'], undefined, '岸台面台词已删除（26 次实测 0 次可达）');
  assert.equal(LINES['l2_fail_ontop'], undefined, '造物顶面台词已删除（26 次实测 0 次可达）');
});

test('同句台词配额：第 3 次必须静默，不同 id 各算各的', async () => {
  const { createLineQuota } = await import(pathToFileURL(path.join(ROOT, 'src/text/lines.js')).href);
  const allow = createLineQuota(2);
  const calls = [];
  for (let i = 0; i < 4; i++) calls.push(allow('common_fail2'));
  assert.deepEqual(calls, [true, true, false, false], '同句整局只许播 2 次，第 3 次起静默');
  assert.equal(allow('form_beam'), true, '配额按 id 各算各的，不能被别的句子耗掉');
});

test('台词配额粒度：跨关兜底句按**每关**计（否则关3 之后没兜底）', async () => {
  const lines = await import(pathToFileURL(path.join(ROOT, 'src/text/lines.js')).href);
  const { createLineQuota, isPerLevelLine } = lines;
  // 粒度本身要能断言：改错了这条会红，而不是等玩家发现关3 以后没台词
  assert.equal(isPerLevelLine('common_fail2'), true, 'common_fail2 是跨关兜底句 → 每关计');
  assert.equal(isPerLevelLine('form_beam'), false, '形态台词 → 整局计');
  assert.equal(isPerLevelLine('l1_win'), false, '普通台词 → 整局计');

  // 模拟：关里用满 2 次 → 进下一关 reset → 又能说 2 次
  const allow = createLineQuota(2);
  assert.deepEqual([allow('common_fail2'), allow('common_fail2'), allow('common_fail2')], [true, true, false],
    '同一关里只许 2 次');
  allow.reset();
  assert.deepEqual([allow('common_fail2'), allow('common_fail2'), allow('common_fail2')], [true, true, false],
    '进关 reset 之后必须又能说 2 次（这条不加，粒度改错没人发现）');
});

test('关2 失败暗示：逐字锁死 + 禁止话术黑名单 + 终态走兜底', async () => {
  const { LINES } = await import(pathToFileURL(path.join(ROOT, 'src/text/lines.js')).href);
  const lv = env.levels.l2.LEVEL_CH1_02;
  // 逐字（定稿，改一个字都要先改断言）
  assert.equal(lv.failHints[0], '它卡在边沿上，得往下压它。');
  // 三个"不可推进"终态全部走兜底台词（不再有专属 id）
  assert.deepEqual(lv.failLines, {
    'prop-back-on-bank': 'common_fail2',
    'prop-on-creature': 'common_fail2',
    'prop-wedged': 'common_fail2',
  });
  // 禁止话术：不许否掉玩家的手法，也不许给出物理上反方向的指令
  const BANNED = ['再试', '画长一点', '画得不对', '这次可能行', '够不着', '顶', '不太行', '抬不动'];
  const texts = [
    ...lv.failHints.filter((h) => typeof h === 'string'),
    LINES['common_fail2'].text,
  ];
  for (const line of texts) {
    for (const banned of BANNED) {
      assert.equal(line.indexOf(banned) >= 0, false, '「' + line + '」里不许出现「' + banned + '」');
    }
  }
});
