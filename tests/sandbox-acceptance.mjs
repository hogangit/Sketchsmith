/**
 * tests/sandbox-acceptance.mjs —— 沙盒「造物园」验收（规格 levels-4-5-sandbox.md §3.6 的 5 条判据）
 *
 * 用法：node tests/sandbox-acceptance.mjs
 *
 * 为什么这 5 条现在才补：sandbox.js 早就写好了，但§3.6 表里列的 5 个测试文件一个都没有，
 * 于是「沙盒能用」只是作者口头结论。沙盒是**通关 5 关后的奖励**，玩家走到最后才见到，
 * 一旦它不工作，前面的努力全白费——所以它比关卡更需要机器验收。
 *
 * 判据：
 *   ① 解锁门禁：初始未解锁；解锁后 =true；**解锁不抹掉已有造物**（D25/D26 同源）
 *   ② 持久化：存 5 个 → 「刷新页面」（用同一份底层存储另起一个 store）→ 字段一致；
 *              第 31 个被拒且 reason='full'（**不静默丢**）
 *   ③ 无 goal 不误判：跑满 20 秒 + 造物落到世界外 → 永不 win、永不 fail
 *   ④ 能力可贴：chips = 全部已实装能力；第 3 枚被 compose 判 violated（每造物 ≤2）
 *   ⑤ 吐槽闭集：sb_toss1..4 存在、≤18 字、**textOnly（不进语音）**
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameEnv, synthLine } from './helpers/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const env = await loadGameEnv();
const { world: worldMod, runtime: runtimeMod, classify, compose, registry } = env;

const { SANDBOX_LEVEL, SANDBOX_KEY, SANDBOX_MAX_CREATURES, loadSandbox, saveCreature, unlockSandbox, clearSandbox, removeCreature } =
  await import(new URL('../src/level/sandbox.js', import.meta.url).href);
const { createMemorySaveStore } = await import(new URL('../src/core/storage.js', import.meta.url).href);
const { LINES, isTextOnlyLine } = await import(new URL('../src/text/lines.js', import.meta.url).href);

/** 模拟「刷新页面」：持久化层（_map）留着，store 对象重新造一个 */
function reload(store) {
  return createMemorySaveStore(Object.fromEntries(store._map));
}

// ── 判据①：解锁门禁 ────────────────────────────────────────────────────────
{
  const store = createMemorySaveStore();
  const fresh = loadSandbox(store);
  assert.equal(fresh.unlocked, false, '新玩家必须是未解锁：沙盒是通关奖励，不是初始内容');
  assert.deepEqual(fresh.creatures, [], '空存档读出来必须是空数组（不是 null / undefined）');

  // 未通关 ⇒ 没有入口。门禁的接线点在 main.js（见下面的源码契约断言）。
  unlockSandbox(store);
  assert.equal(loadSandbox(store).unlocked, true, 'unlockSandbox 后必须 unlocked=true');

  // ★ 解锁不许抹掉已有造物：先造 2 个再解锁，数量必须还是 2。
  //   （同 D25/D26 的精神：系统任何自动行为都不许抹掉玩家已经做出来的东西。）
  const s2 = createMemorySaveStore();
  saveCreature(s2, { id: 'a', form: 'beam', abilities: ['harden'], x: 1, y: 2 });
  saveCreature(s2, { id: 'b', form: 'wheel', abilities: [], x: 3, y: 4 });
  unlockSandbox(s2);
  const after = loadSandbox(s2);
  assert.equal(after.unlocked, true);
  assert.equal(after.creatures.length, 2, '解锁把已有造物抹掉了（' + after.creatures.length + '）——不许');

  // 门禁接线本身在 main.js：unlockSandbox 必须被「最后一关」守卫着，且沙盒不算关。
  // 这一条为什么是源码断言：main.js 依赖 DOM，跑不进 node；而「沙盒挂在数组末尾、
  // 所以最后一关 = length-2」这个不变量一旦被改（比如往数组里再插一项），
  // 玩家就会在没通关时提前掉进沙盒，或者在通关后永远进不去——值得拦。
  const mainSrc = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
  assert.ok(/const LAST_LEVEL_INDEX = GAME_LEVELS\.length - 2;/.test(mainSrc),
    'main.js 里 LAST_LEVEL_INDEX 必须是 GAME_LEVELS.length - 2（沙盒挂在末尾、不算关）');
  assert.ok(/if \(view\.levelIndex === LAST_LEVEL_INDEX\) unlockSandbox\(store\);/.test(mainSrc),
    'main.js 里 unlockSandbox 必须被 view.levelIndex === LAST_LEVEL_INDEX 守卫（不能无条件解锁）');
  assert.ok(/SANDBOX_LEVEL\]/.test(mainSrc) && /GAME_LEVELS = \[.*SANDBOX_LEVEL\]/.test(mainSrc),
    'main.js 的 GAME_LEVELS 必须以 SANDBOX_LEVEL 结尾（nextLevel 靠它自然推进到沙盒）');

  console.log('① 解锁门禁：初始 false / 解锁后 true / 解锁不抹造物 / 源码守卫在位 ✔');
}

// ── 判据②：持久化（含 30 上限，超出不静默丢）────────────────────────────────
{
  const store = createMemorySaveStore();
  unlockSandbox(store);
  for (let i = 0; i < 5; i++) {
    const r = saveCreature(store, {
      id: `c${i}`, form: i % 2 ? 'beam' : 'wheel', thickness: 8 + i,
      abilities: i % 2 ? ['harden'] : ['harden', 'tickle'],
      name: `造物${i}`, x: 100 + i, y: 200 + i,
    });
    assert.equal(r.ok, true, `第 ${i + 1} 个造物应当存下`);
  }
  const revived = loadSandbox(reload(store));   // ← 刷新页面
  assert.equal(revived.creatures.length, 5, '刷新后造物数量应仍为 5，实际 ' + revived.creatures.length);
  for (let i = 0; i < 5; i++) {
    const c = revived.creatures[i];
    assert.equal(c.id, `c${i}`, '刷新后 id 变了');
    assert.equal(c.form, i % 2 ? 'beam' : 'wheel', '刷新后 form 变了');
    assert.equal(c.thickness, 8 + i, '刷新后 thickness 变了');
    assert.deepEqual(c.abilities, i % 2 ? ['harden'] : ['harden', 'tickle'], '刷新后 abilities 变了');
    assert.equal(c.name, `造物${i}`, '刷新后 name 变了');
    assert.equal(c.x, 100 + i, '刷新后 x 变了');
    assert.equal(c.y, 200 + i, '刷新后 y 变了');
    assert.equal(typeof c.createdAt, 'number', 'createdAt 必须是数字（用于"先删掉旧的"排序）');
  }

  // 上限：补到 30 个，第 31 个必须被拒且给出 reason='full'
  const s3 = createMemorySaveStore();
  unlockSandbox(s3);
  for (let i = 0; i < SANDBOX_MAX_CREATURES; i++) saveCreature(s3, { id: `x${i}`, form: 'blob' });
  assert.equal(loadSandbox(s3).creatures.length, SANDBOX_MAX_CREATURES, '上限应为 ' + SANDBOX_MAX_CREATURES);
  const over = saveCreature(s3, { id: 'x31', form: 'blob' });
  assert.equal(over.ok, false, '第 31 个必须被拒（上限 ' + SANDBOX_MAX_CREATURES + '）');
  assert.equal(over.reason, 'full', '被拒必须给出 reason="full"，好让上层提示「先删掉旧的」');
  assert.equal(loadSandbox(s3).creatures.length, SANDBOX_MAX_CREATURES, '被拒后数量不许变（不静默丢也不静默加）');

  // 存档 key 与「进度」分开：沙盒有自己的 key，不挤占通关进度
  assert.equal(SANDBOX_KEY, 'wcwz:sandbox:v1', '沙盒存档 key 变了会让老玩家的造物消失');
  console.log(`② 持久化：存 5 个 → 刷新后字段全一致 / 上限 ${SANDBOX_MAX_CREATURES} 被拒 reason="full" ✔`);
}

// ── 判据③：无 goal 不误判（永不 win / 永不 fail）─────────────────────────────
{
  assert.equal(SANDBOX_LEVEL.goal, null, '沙盒必须 goal=null（这是"不误判"的根源）');
  assert.equal(SANDBOX_LEVEL.resetActorIfBelowY, null, '沙盒没有主角可重置，掉出世界也不该算失败');

  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const w = worldMod.createPhysicsWorld();
  const rt = runtimeMod.createLevelRuntime({ level: SANDBOX_LEVEL, world: w, bus });
  for (let f = 0; f < 4; f++) rt.step(1);

  // 真画三个东西进去（含一个画在世界下方、会一直往下掉的），确认造物本身也不触发判定
  for (const cx of [120, 215, 310]) {
    const geo = classify.analyzeStrokeGroup([{ pts: synthLine(cx - 30, 700, cx + 30, 702, 4, 0.7) }]);
    rt.spawnCreature({ form: geo.form, geo, thickness: 10 });
    for (let f = 0; f < 40; f++) rt.step(1);
  }
  const outside = classify.analyzeStrokeGroup([{ pts: synthLine(60, 1400, 110, 1402, 4, 0.7) }]);
  rt.spawnCreature({ form: outside.form, geo: outside, thickness: 10 });
  // ★ 前提断言：造物必须真的生成了。否则"win 0 次 / fail 0 次"是空跑出来的结论——
  //   什么都没画进去，当然也不会判赢判输。
  assert.ok(rt.creatures.length >= 3,
    '前提失效：造物没生成（' + rt.creatures.length + ' 个），下面的"永不 win/fail"是空跑结论');

  for (let f = 0; f < 60 * 20; f++) rt.step(1);   // 20 秒
  const wins = events.filter((e) => e[0] === 'level:win');
  const fails = events.filter((e) => e[0] === 'level:fail');
  assert.equal(wins.length, 0, '沙盒出现 level:win —— 系统替玩家宣布"过了"，这是沙盒最不该有的事');
  assert.equal(fails.length, 0, '沙盒出现 level:fail —— 玩家在沙盒里不该被告知失败');
  rt.destroy();

  // ★ 配对负对照：同一套装置换成**有 goal 的关 1**，必须真的能检出 win/fail。
  //   没有这一条，"沙盒 0 次 win" 可能只是"装置根本收不到事件"，结论就是假的。
  const { LEVEL_CH1_01 } = await import(new URL('../src/level/levels/ch1-01.js', import.meta.url).href);
  const ev2 = [];
  const bus2 = { emit: (e, p) => ev2.push([e, p]), on() {}, countOf() { return 0; } };
  const w2 = worldMod.createPhysicsWorld();
  const rt2 = runtimeMod.createLevelRuntime({ level: LEVEL_CH1_01, world: w2, bus: bus2 });
  for (let f = 0; f < 4; f++) rt2.step(1);
  const g2 = classify.analyzeStrokeGroup([{ pts: synthLine(150, 700, 250, 702, 4, 0.7) }]);
  rt2.spawnCreature({ form: g2.form, geo: g2, thickness: 12 });
  for (let f = 0; f < 60 * 20; f++) rt2.step(1);
  const ctl = ev2.filter((e) => e[0] === 'level:win' || e[0] === 'level:fail').length;
  rt2.destroy();
  assert.ok(ctl > 0, '负对照失效：有 goal 的关 1 也没发出 win/fail（装置收不到事件），判据③ 的结论不可信');
  console.log(`③ 无 goal 不误判：沙盒 win 0 / fail 0，负对照关1 检出 ${ctl} 次判定 ✔`);
}

// ── 判据④：能力可贴（全部已实装可用，每造物 ≤2）────────────────────────────
{
  const impl = registry.IMPLEMENTED_ABILITY_IDS;
  assert.deepEqual([...SANDBOX_LEVEL.chips].sort(), [...impl].sort(),
    '沙盒 chips 必须等于全部已实装能力（' + impl.join(',') + '），实际 ' + SANDBOX_LEVEL.chips.join(','));

  // 「每造物 ≤2」不是沙盒自己定的，走全局上限；三枚必须被判 violated
  const two = compose.composeAbilities(['harden', 'tickle']);
  assert.equal(two.violated, false, '2 枚能力不该被判 violated');
  const three = compose.composeAbilities(['harden', 'tickle', 'heavy']);
  assert.equal(three.violated, true, '3 枚能力必须被判 violated（每造物 ≤2）');

  // 沙盒里每一枚 chip 都得是"点得出来的"（不是只有名字）
  for (const id of SANDBOX_LEVEL.chips) {
    assert.ok(registry.getAbility(id), `沙盒 chip "${id}" 在能力表里查不到——点了没反应`);
  }
  console.log(`④ 能力可贴：chips=${SANDBOX_LEVEL.chips.length} 枚全部可解析 / 第 3 枚判 violated ✔`);
}

// ── 判据⑤：吐槽闭集（存在 / ≤18 字 / 不进语音）─────────────────────────────
{
  const ids = Object.keys(LINES).filter((k) => k.indexOf('sb_toss') === 0).sort();
  assert.deepEqual(ids, ['sb_toss1', 'sb_toss2', 'sb_toss3', 'sb_toss4'],
    '沙盒吐槽必须是 sb_toss1..4 闭集，实际 ' + ids.join(','));
  for (const id of ids) {
    const l = LINES[id];
    assert.ok(l && typeof l.text === 'string' && l.text.length > 0, `${id} 没有文本`);
    assert.ok(l.text.length <= 18, `${id} 超 18 字（${l.text.length}）：${l.text}`);
    // ★ "不进语音"以前只是 lines.js 里的一句注释，运行时照样送进 speak。
    //   现在它是数据（textOnly）+ showLine 里的提前 return，这里才断言得住。
    assert.equal(l.textOnly, true, `${id} 必须标 textOnly（沙盒吐槽纯文字、不朗读）`);
    assert.equal(isTextOnlyLine(id), true, `${id} 必须在 TEXT_ONLY_LINE_IDS 闭集里`);
  }
  // 沙盒自己的开场句要能解析（走正常语音，不标 textOnly）
  assert.ok(LINES[SANDBOX_LEVEL.lines.intro], '沙盒 lines.intro 指向了不存在的台词 id');
  assert.equal(LINES[SANDBOX_LEVEL.lines.intro].textOnly, undefined, '沙盒开场句是"迎宾"，应当朗读');
  assert.equal(SANDBOX_LEVEL.lines.win, null, '沙盒没有"赢"，win 槽位必须是 null');
  assert.equal(SANDBOX_LEVEL.lines.stamp, null, '沙盒没有章节印章，stamp 槽位必须是 null');
  console.log('⑤ 吐槽闭集：sb_toss1..4 存在 / ≤18 字 / textOnly 不进语音 ✔');
}

// ── 判据⑥：存满之后必须能腾地方（清空 / 单条删除）───────────────────────────
// 为什么补这条：判据②证明「第 31 个会被拒」，但被拒之后玩家没有任何办法腾位置——
// 上限 30 就成了一条死路。界面上给了「清空」（二次确认），这里是它背后的动作。
{
  const store = createMemorySaveStore();
  unlockSandbox(store);
  for (let i = 0; i < SANDBOX_MAX_CREATURES; i++) {
    saveCreature(store, { id: `c${i}`, form: 'beam', thickness: 10, abilities: [], x: 100 + i, y: 600, strokes: [{ pts: [{ x: 100, y: 700 }, { x: 160, y: 702 }] }] });
  }
  const full = loadSandbox(store);
  assert.equal(full.creatures.length, SANDBOX_MAX_CREATURES, '前置：应已存满');
  assert.equal(saveCreature(store, { id: 'overflow', form: 'beam', x: 200, y: 600 }).reason, 'full', '前置：第 31 个应被拒');

  // 清空：造物归零，但 **unlocked 不能跟着没**（清园子不该把解锁状态也清掉）
  clearSandbox(store);
  const after = loadSandbox(store);
  assert.equal(after.creatures.length, 0, 'clearSandbox 后造物应为 0');
  assert.equal(after.unlocked, true, 'clearSandbox 只删造物，不能把 unlocked 一起清掉');
  assert.equal(saveCreature(store, { id: 'again', form: 'beam', x: 200, y: 600 }).ok, true, '清空后应能继续存');

  // 单条删除：删一个只少一个，不存在的 id 要报 notfound 而不是静默
  const r1 = removeCreature(store, 'again');
  assert.equal(r1.ok, true, 'removeCreature 应删掉存在的 id');
  assert.equal(loadSandbox(store).creatures.length, 0, '删完应为空');
  const r2 = removeCreature(store, 'nope');
  assert.equal(r2.reason, 'notfound', '删不存在的 id 必须报 notfound（不能假装成功）');
  console.log(`⑥ 存满可腾地方：清空后 0 条且 unlocked 保留 / 单条删除 ok / 不存在 id 报 notfound ✔`);
}

// ── 判据⑦：单条删除的接线（live id == 存档 id，且 runtime 能按 id 移除）──────────
// 为什么补：判据⑥只验了 sandbox.js 的 removeCreature（存档层），但「界面上点一下删掉这一个」
// 真正需要两层对得上——(a) restore 时把存档 id 传进 spawnCreature，场上造物 id 才与存档记录同值；
// (b) runtime 提供按 id 移除的口子。缺任意一层，「删一个」就会删错或删了画面留着存档（D30）。
{
  const w = worldMod.createPhysicsWorld();
  const bus = { emit() {}, on() {}, countOf() { return 0; } };
  const rt = runtimeMod.createLevelRuntime({ level: SANDBOX_LEVEL, world: w, bus });

  // 模拟 restore：把「存档记录 id」作为 spec.id 传进去，spawnCreature 必须原样保留
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(200, 700, 260, 702, 4, 0.7) }]);
  const c = rt.spawnCreature({ form: geo.form, geo, thickness: 10, id: 'save-xyz' });
  assert.equal(c.id, 'save-xyz', 'spawnCreature 必须尊重传入的 spec.id（restore 才能把 live id 对上存档 id）');

  // 再补一个，确认「按 id 找」能精准命中其中一个而不误伤另一个
  const geo2 = classify.analyzeStrokeGroup([{ pts: synthLine(300, 700, 360, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo2.form, geo: geo2, thickness: 10, id: 'save-abc' });
  assert.equal(rt.creatures.length, 2, '前置：应有 2 个造物');

  const ok = rt.removeCreatureById('save-xyz');
  assert.equal(ok, true, 'removeCreatureById 应删掉存在的 id');
  assert.equal(rt.creatures.length, 1, '删除后场上应只剩 1 个造物');
  assert.equal(rt.creatures[0].id, 'save-abc', '被删的必须是 save-xyz，不能误删 save-abc');
  const no = rt.removeCreatureById('save-xyz');
  assert.equal(no, false, '重复删除不存在的 id 必须返回 false（不是静默成功）');
  rt.destroy();

  // 存档层与运行时的 id 约定一致：saveCreature 在传入 id 时以传入者为准（main 在 sandbox 里传 c.id）
  const s7 = createMemorySaveStore();
  unlockSandbox(s7);
  const r7 = saveCreature(s7, { id: 42, form: 'beam', x: 100, y: 600, strokes: [{ pts: [{ x: 100, y: 700 }, { x: 160, y: 702 }] }] });
  assert.equal(r7.ok, true, 'saveCreature 接受数字 id');
  assert.equal(loadSandbox(s7).creatures[0].id, 42, '存档记录 id 必须与传入一致（否则 restore 后对不上 live id）');

  // 真机复现的撞号 bug：重进沙盒用 spec.id 复活 id=1，紧接着画的新造物「自动编号」又取到 1，
  // 两条存档记录同号 → 单条删除时 removeCreature 一次删两条（实测 2→0）。spawnCreature 必须在
  // 收到显式数字 id 后把 creatureSeq 顶到它之后，避免后续自动编号撞上。
  const w3 = worldMod.createPhysicsWorld();
  const bus3 = { emit() {}, on() {}, countOf() { return 0; } };
  const rt3 = runtimeMod.createLevelRuntime({ level: SANDBOX_LEVEL, world: w3, bus: bus3 });
  const g3 = classify.analyzeStrokeGroup([{ pts: synthLine(150, 700, 210, 702, 4, 0.7) }]);
  rt3.spawnCreature({ form: g3.form, geo: g3, thickness: 10, id: 1 });   // 模拟 restore 复活 id=1
  const g4 = classify.analyzeStrokeGroup([{ pts: synthLine(300, 700, 360, 702, 4, 0.7) }]);
  const auto = rt3.spawnCreature({ form: g4.form, geo: g4, thickness: 10 });  // 不传 id，自动编号
  assert.notEqual(auto.id, 1, '显式 id=1 之后自动编号不能又取 1（否则存档记录撞号、单条删除误删两条）');
  assert.ok(auto.id > 1, '自动编号必须严格大于已用过的显式 id（实际 ' + auto.id + '）');
  rt3.destroy();
  console.log('⑦ 单条删除接线：spec.id 保留 / removeCreatureById 精准删一个、删不存在返回 false / 存档 id 约定一致 / 显式 id 后自动编号不撞号 ✔');
}

console.log('\n沙盒验收 7/7 通过');
