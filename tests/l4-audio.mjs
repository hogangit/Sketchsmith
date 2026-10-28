/**
 * tests/l4-audio.mjs —— 关4/关5 专属音效接线验收
 *
 * 验收点：
 *  ① 音频配方存在：spring（关4 弹射）/ water（关5 落水）在 AUDIO_SFX_RECIPES 中
 *  ② 关4 弹射小人时，runtime 发出 creature:tickle 且 payload.actor === true（main.js 据此播 spring）
 *  ③ 关5 level:fail 的 payload.failSfx === 'water'（main.js 据此播 water 替代通用失败音）
 *
 * 运行：node tests/l4-audio.mjs
 */
import assert from 'node:assert/strict';
import { loadGameEnv, synthLine } from './helpers/env.mjs';
import { LEVEL_CH1_04 } from '../src/level/levels/ch1-04.js';
import { LEVEL_CH1_05 } from '../src/level/levels/ch1-05.js';
import { AUDIO_SFX_RECIPES } from '../src/audio/audio-bus.js';

// ── ① 配方存在性（契约）──
assert.ok(AUDIO_SFX_RECIPES.spring, '缺 sfx 配方 spring（关4 弹射音）');
assert.ok(AUDIO_SFX_RECIPES.water, '缺 sfx 配方 water（关5 落水音）');
console.log('① 配方存在：spring / water ✔');

const env = await loadGameEnv();
const { classify, world, runtime } = env;

// ── ② 关4 弹射事件带 actor:true ──
const tickleEvents = [];
const bus4 = { emit: (e, p) => { if (e === 'creature:tickle') tickleEvents.push(p); }, on() {}, countOf() { return 0; } };
const w4 = world.createPhysicsWorld();
const rt4 = runtime.createLevelRuntime({ level: LEVEL_CH1_04, world: w4, bus: bus4 });
for (let f = 0; f < 4; f++) rt4.step(1);
const geo4 = classify.analyzeStrokeGroup([{ pts: synthLine(142 - 35, 700, 142 + 35, 702, 4, 0.7) }]);
rt4.spawnCreature({ form: geo4.form, geo: geo4, thickness: 12 });
rt4.setAbility('harden');
rt4.setAbility('tickle');
let actorLaunched = false;
for (let f = 0; f < 60 * 12; f++) {
  rt4.step(1);
  if (tickleEvents.some((p) => p.actor === true)) { actorLaunched = true; break; }
}
rt4.destroy();
assert.ok(actorLaunched, '关4 弹射小人时应发出 creature:tickle{actor:true}（spring 音触发点缺失）');
console.log('② 关4 弹射事件 creature:tickle{actor:true} 已发出 ✔');

// ── ③ 关5 失败 payload 带 failSfx:'water' ──
let failPayload = null;
const bus5 = { emit: (e, p) => { if (e === 'level:fail') failPayload = p; }, on() {}, countOf() { return 0; } };
const w5 = world.createPhysicsWorld();
const rt5 = runtime.createLevelRuntime({ level: LEVEL_CH1_05, world: w5, bus: bus5 });
for (let f = 0; f < 4; f++) rt5.step(1);
// 画一笔（造物）以激活小人 → 小人开始向右走 → 走到左岸边缘(x=150)坠入河中 → actor-fell
const geo5 = classify.analyzeStrokeGroup([{ pts: synthLine(20, 300, 60, 302, 4, 0.7) }]);
rt5.spawnCreature({ form: geo5.form, geo: geo5, thickness: 10 });
rt5.setAbility('harden');
let got = false;
for (let f = 0; f < 60 * 14; f++) {
  rt5.step(1);
  if (failPayload) { got = true; break; }
}
rt5.destroy();
assert.ok(got, '关5 应能产生一次 level:fail（小人坠河）');
assert.equal(failPayload && failPayload.failSfx, 'water', '关5 落水失败应带 failSfx:"water"（main.js 据此播水声）');
console.log('③ 关5 落水 level:fail 带 failSfx:"water" ✔');

console.log('\nl4-audio：全部通过 ✔');
