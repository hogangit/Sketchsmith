/**
 * tests/l2-verdicts.test.mjs —— 关2 终态**判定表**的单测（构造状态，不靠玩法运气）
 *
 * 两个问题必须分开验：
 *   ① 判定**逻辑**对不对（顺序：win → 碎 → 岸台面 → 造物顶面 → 卡沟壁 → 仍悬空不判）
 *   ② 每种终态在真实物理里**到不到得了**（那是 tests/probe-l2-endstates.mjs 的事）
 * 这个文件只验 ①：直接摆好状态再跑 1.5s 静止窗口，看判定表命中哪一条。
 * ② 如果到不了，对应的台词就是死的——那一项照实上报，不在这个文件里掩盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameEnv } from './helpers/env.mjs';

const env = await loadGameEnv();
const M = globalThis.Matter;
const { world, runtime } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;

/** 造一局，摆好南瓜（可先放一个造物垫在下面），返回第一次终态 */
function settle({ propAt, propStatic = true, creature = null, frames = 200 }) {
  const w = world.createPhysicsWorld();
  const events = [];
  const rt = runtime.createLevelRuntime({
    level: L2, world: w,
    bus: { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } },
  });
  if (creature) {
    const b = M.Bodies.rectangle(creature.x, creature.y, creature.w, creature.h, { isStatic: creature.isStatic === true });
    w.addBody(b);
    // 把这块"造物"挂进 runtime 的造物列表，让 supportIsCreature 认得出它是玩家画的
    rt.state.creatures.push({ id: 99, bodies: [b], constraints: [], form: 'blob', fadeMs: 0 });
  }
  const p = rt.state.props[rt.state.activeProp];
  M.Body.setPosition(p, propAt);
  M.Body.setVelocity(p, { x: 0, y: 0 });
  M.Body.setAngularVelocity(p, 0);
  if (propStatic) M.Body.setStatic(p, true);
  let reason = null;
  for (let f = 0; f < frames; f++) {
    rt.step(1);
    const win = events.find((e) => e[0] === 'level:win');
    const los = events.filter((e) => e[0] === 'level:fail');
    if (win) { reason = 'win:' + win[1].reason; break; }
    if (los.length) { reason = 'fail:' + los[0][1].reason; break; }
  }
  const propCount = rt.state.props.length;
  rt.destroy();
  return { reason, propCount };
}

test('序 1：进收货口 = win（先于静止判，否则 win 会被判成 fail）', () => {
  const r = settle({ propAt: { x: 245, y: 430 } });
  assert.equal(r.reason, 'win:prop-caught');
});

test('序 2：到沟底但落在口外（石头上）= 碎', () => {
  const r = settle({ propAt: { x: 196, y: 430 } });
  assert.equal(r.reason, 'fail:prop-smashed');
});

test('序 3：完全退回岸台面 = fail（右缘 ≤ 台沿 200）', () => {
  const r = settle({ propAt: { x: 150, y: 269 } });
  assert.equal(r.reason, 'fail:prop-back-on-bank');
  assert.ok(r.propCount >= 2, '失败要送新南瓜，且旧的不销毁（场上 ≥2 颗）');
});

test('序 4：停在造物顶面 = fail（优先于"卡沟壁"，因为两者高度区间重叠）', () => {
  // 造物必须是真的动态刚体（静态刚体不算"玩家画的东西"，支撑判定会跳过它）
  const r = settle({
    propAt: { x: 214, y: 358 },                      // 底面 389，正好落在造物顶面上
    propStatic: false,
    creature: { x: 214, y: 430, w: 90, h: 80, isStatic: false },   // 顶面 390，坐在沟底棚布上
  });
  assert.equal(r.reason, 'fail:prop-on-creature');
});

test('序 5：卡在沟壁（台面与沟底之间、脚下没有造物）= fail', () => {
  const r = settle({ propAt: { x: 294, y: 366 } });
  assert.equal(r.reason, 'fail:prop-wedged');
});

test('序 6：仍部分悬空 + 静止 → **不判任何终态**（正常初始态 / 可继续）', () => {
  // 初始位置就是悬空态（164..226），摆着不动 3 秒也不许判失败——这是"擦碰不判"的根
  const r = settle({ propAt: { x: 195, y: 269 }, frames: 180 });
  assert.equal(r.reason, null, '悬空静止不许判失败，实际：' + r.reason);
  assert.equal(r.propCount, 1, '不判失败就不许送新南瓜');
});

test('终态台词映射：三个"不可推进"终态全部走兜底台词（专属 id 已按实测删除）', async () => {
  const { LINES } = await import('../src/text/lines.js');
  assert.deepEqual(L2.failLines, {
    'prop-back-on-bank': 'common_fail2',
    'prop-on-creature': 'common_fail2',
    'prop-wedged': 'common_fail2',
  });
  for (const id of Object.values(L2.failLines)) assert.ok(LINES[id], '台词 id 必须存在：' + id);
  // 防复发：这两句在 26 次真实运行里 0 次可达，已连 id 删除，不许再回来
  assert.equal(LINES['l2_fail_beam'], undefined, '岸台面台词已删除（不可达）');
  assert.equal(LINES['l2_fail_ontop'], undefined, '造物顶面台词已删除（不可达）');
});
