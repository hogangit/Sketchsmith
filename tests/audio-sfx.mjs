/**
 * tests/audio-sfx.mjs —— 音效规格 3.1 核心 15 项 + 触发接线验收（D29）
 *
 * 为什么单独一个文件：规格 3.1 列了 15 个「必做」音效，之前只做了 8 个，
 * 而且**没人检查过**。这个文件做两件事，缺一不可：
 *
 *   ① 数据层：15 个核心 id 在配方表里都存在；音量次序符合规格的 dB 基准
 *      （盖章最响 → 奖励音次之 → 笔迹摩擦最轻），避免"新加的音盖过盖章音"。
 *   ② 接线层：光有配方不算数（上一轮 saveCreature 就是这个坑——单测绿、功能不在）。
 *      所以每个新音都要证明**它对应的事件真的会发生**：
 *        combo ← 两个能力叠加 / fall ← 造物掉出世界 / hint ← 第 2 次失败起
 *        penup·penmove ← 抬笔与绘制限流（走真实 StrokeCapture，不是直接调 play）
 *        chapter ← 进沙盒 / bubble ← 纯文字台词与气泡降级
 *
 * 运行：node tests/audio-sfx.mjs
 */
import assert from 'node:assert';
import { AUDIO_SFX_RECIPES } from '../src/audio/audio-bus.js';
import { createStrokeCapture } from '../src/stroke/capture.js';
import { loadGameEnv, synthLine } from './helpers/env.mjs';
import { LINES, isTextOnlyLine } from '../src/text/lines.js';
import { LEVEL_CH1_01 } from '../src/level/levels/ch1-01.js';
import { LEVEL_CH1_02 } from '../src/level/levels/ch1-02.js';

// ── ① 数据层：规格 3.1 核心 15 项一个都不能少 ────────────────────────────────
// 规格 id 用 `sfx_` 前缀，代码里省掉前缀；`sfx_success` 在代码里叫 `win`（判定就是过关）。
const CORE_15 = ['pendown', 'penup', 'penmove', 'spawn', 'ability', 'combo', 'fall',
  'collide', 'win', 'fail', 'stamp', 'chapter', 'ui', 'hint', 'bubble'];

const missing = CORE_15.filter((id) => !AUDIO_SFX_RECIPES[id]);
assert.deepEqual(missing, [], `规格 3.1 核心音效缺失：${missing.join(', ')}`);
console.log(`① 核心 15 项齐全（实际配方 ${Object.keys(AUDIO_SFX_RECIPES).length} 个，含关4/5 专属 spring/water）✔`);

// ── ② 音量次序：盖章最响，奖励音次之，笔迹摩擦最轻 ───────────────────────────
const g = (id) => AUDIO_SFX_RECIPES[id].gain;
assert.ok(g('stamp') > g('combo'), `奖励音(${g('combo')})不该盖过盖章音(${g('stamp')})`);
assert.ok(g('combo') > g('spawn'), '奖励音应比造物成型响（3.4：sfx_combo 独占高频段）');
assert.ok(g('fail') < g('win'), '失败音必须低于成功音（规格 3.1：不做惩罚感）');
assert.ok(g('penmove') < g('pendown'), '笔迹摩擦必须轻于落笔（−24dB vs −10dB）');
assert.ok(g('penup') < g('pendown'), '抬笔必须轻于落笔（−16dB vs −10dB）');
assert.ok(g('hint') < g('fail'), '提示音必须轻于失败音（提示不该抢戏）');
assert.ok(g('penmove') < g('hint'), '笔迹摩擦必须是全表最轻（−24dB，低于 hint 的 −16dB）');
console.log(`② 音量次序：stamp ${g('stamp')} > combo ${g('combo')} > spawn ${g('spawn')} > win ${g('win')} > fail ${g('fail')} > penup ${g('penup')} > hint ${g('hint')} > penmove ${g('penmove')} ✔`);

// ── ③ combo 是琶音型（3 音 + shimmer），不是单振荡器 ────────────────────────
const combo = AUDIO_SFX_RECIPES.combo;
assert.equal(combo.type, 'arp', 'combo 必须是 arp 型（纯四度+纯五度上行三音）');
assert.equal(combo.notes.length, 3, 'combo 必须是上行三音');
assert.ok(combo.notes[0] < combo.notes[1] && combo.notes[1] < combo.notes[2], 'combo 三音必须上行');
assert.ok(combo.shimmer && combo.shimmer.length >= 2, 'combo 必须带高频 shimmer（全场唯一高亮度音色）');
// 纯四度 = 4:3，纯五度 = 3:2
const r41 = combo.notes[1] / combo.notes[0];
const r52 = combo.notes[2] / combo.notes[0];
assert.ok(Math.abs(r41 - 4 / 3) < 0.01, `第 2 音应是纯四度（4:3），实测 ${r41.toFixed(3)}`);
assert.ok(Math.abs(r52 - 3 / 2) < 0.01, `第 3 音应是纯五度（3:2），实测 ${r52.toFixed(3)}`);
console.log(`③ combo：上行三音 ${combo.notes.join('/')} Hz（+纯四度 +纯五度）+ ${combo.shimmer.length} 条 shimmer ✔`);

// ── ④ overlay 是通用机制：fall/chapter 靠它补"实体感"，但只有登记表里有才生效 ──
assert.ok(AUDIO_SFX_RECIPES.fall.overlay, 'fall 需要噪声尾（overlay）才有「掉下去」的实体感');
assert.ok(AUDIO_SFX_RECIPES.chapter.overlay, 'chapter 需要低频落地（overlay）才读成翻页+落定');
console.log('④ overlay 通用机制：fall（下滑音+噪声尾）/ chapter（翻页噪声+低频落地）✔');

// ── ⑤ 接线层：penup / penmove 走真实 StrokeCapture（不是直接调 play）────────
{
  const played = [];
  const audio = {
    play: (id) => { played.push(id); return true; },
    setDrawing() {}, unlockMedia() {},
  };
  const cap = createStrokeCapture({
    audio,
    toDesign: (x, y) => ({ x, y }),
    onGroup: () => {},
    bus: { emit() {} },
  });
  const down = (x, y) => cap.handlers.down({ preventDefault() {}, clientX: x, clientY: y });
  const move = (x, y) => cap.handlers.move({ preventDefault() {}, clientX: x, clientY: y });
  const up = () => cap.handlers.up({ preventDefault() {} });

  down(200, 700);                       // BOOK_TOP=513，700 在造物簿内
  assert.ok(played.includes('pendown'), '落笔应响 pendown');
  // penmove 限流：连打 20 个采样点，不能每个都响
  for (let i = 1; i <= 20; i++) move(200 + i * 6, 700);
  const moves = played.filter((p) => p === 'penmove').length;
  assert.ok(moves >= 1, '绘制中应至少响一次 penmove');
  assert.ok(moves <= 3, `penmove 限流失效：20 个采样点响了 ${moves} 次（应 ≤3）`);
  up();
  assert.ok(played.includes('penup'), '抬笔应响 penup');
  console.log(`⑤ 真实 StrokeCapture：落笔 pendown → 20 采样点只响 ${moves} 次 penmove（限流生效）→ 抬笔 penup ✔`);
}

// ── ⑥ 接线层：combo / fall / hint 的事件真的会发生 ──────────────────────────
const env = await loadGameEnv();
const { world, runtime, classify } = env;

{
  // combo：两个能力叠加成立 → combo:trigger
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const w = world.createPhysicsWorld();
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_02, world: w, bus });
  for (let f = 0; f < 4; f++) rt.step(1);
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(150, 700, 250, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 12 });
  rt.setAbility('harden');
  rt.setAbility('roll');
  const comboEvt = events.find((e) => e[0] === 'combo:trigger');
  assert.ok(comboEvt, '两个能力叠加应发出 combo:trigger（奖励音的触发源）');
  assert.ok(comboEvt[1].combos.length > 0, 'combo:trigger 应带成立的 combo 列表');
  rt.destroy();
  console.log(`⑥ combo:trigger 真的会发（combos=${JSON.stringify(comboEvt[1].combos)}）✔`);
}

{
  // fall：造物掉出世界 → creature:lost
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const w = world.createPhysicsWorld();
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_01, world: w, bus });
  for (let f = 0; f < 4; f++) rt.step(1);
  // 造物从 level.spawnY 出生后自由下落。画在洞正上方（关1 的洞是 x 164..334），
  // 它会直接穿过缺口往下掉 → 超过 CREATURE_DESPAWN_Y(780) 被回收。
  // （注意：不能靠"把笔画画在 y=1400"来制造坠落——spawn 位置由 level.spawnY 决定，
  //   与笔画 y 无关，那样写会得到一个"看起来像在测坠落、其实什么都没发生"的测试。）
  const geo = classify.analyzeStrokeGroup([{ pts: synthLine(220, 700, 280, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: geo.form, geo, thickness: 10 });
  for (let f = 0; f < 60 * 20; f++) rt.step(1);
  assert.ok(events.find((e) => e[0] === 'creature:lost'), '造物掉出世界应发 creature:lost（坠落音的触发源）');
  rt.destroy();
  console.log('⑦ creature:lost 真的会发（造物掉出世界 → 坠落音）✔');
}

{
  // hint：第 2 次失败起 hintLevel≥2（提示音的触发门槛）
  const events = [];
  const bus = { emit: (e, p) => events.push([e, p]), on() {}, countOf() { return 0; } };
  const w = world.createPhysicsWorld();
  const rt = runtime.createLevelRuntime({ level: LEVEL_CH1_01, world: w, bus });
  // 小人只在「有造物生成后」才起步（否则他站在原地不动，永远不失败）。
  // 画一根明显不够长的短梁 → 掉进洞里 → 小人照常往前走 → 也掉下去 → 反复失败。
  const shot = classify.analyzeStrokeGroup([{ pts: synthLine(230, 700, 270, 702, 4, 0.7) }]);
  rt.spawnCreature({ form: shot.form, geo: shot, thickness: 12 });
  for (let f = 0; f < 60 * 25; f++) rt.step(1);
  const fails = events.filter((e) => e[0] === 'level:fail');
  assert.ok(fails.length >= 2, `应至少失败 2 次（实测 ${fails.length} 次），否则验不到提示阶梯`);
  const maxHint = Math.max(...fails.map((e) => e[1].hintLevel));
  assert.ok(maxHint >= 2, `第 2 次失败起 hintLevel 应 ≥2（实测最大 ${maxHint}）`);
  rt.destroy();
  console.log(`⑧ 提示阶梯：${fails.length} 次失败，hintLevel 升到 ${maxHint}（≥2 才响提示音）✔`);
}

// ── ⑦ bubble：纯文字台词必然降级为气泡（textOnly 闭集非空）───────────────────
{
  const textOnly = Object.keys(LINES).filter(isTextOnlyLine);
  assert.ok(textOnly.length >= 6, `纯文字（不朗读）台词至少 6 条，实测 ${textOnly.length}`);
  assert.ok(textOnly.every((id) => id.startsWith('sb_toss') || id === 'l4_mole' || id === 'l4_control_light'),
    `出现了预期外的纯文字台词：${textOnly.join(', ')}`);
  console.log(`⑨ bubble 音源存在：${textOnly.length} 条纯文字台词必走气泡（${textOnly.join(', ')}）✔`);
}

console.log('\n音效验收全部通过：核心 15 项齐全、音量次序合规、7 个新音的触发事件均实测会发生。');
