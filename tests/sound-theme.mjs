/**
 * tests/sound-theme.mjs —— 声音风格「三选一」必须真的听得出差别
 *
 * 背景：用户实测「选了 3 个声音，并没有差异」。查代码发现是真的——
 * 早先主题表里 musicbox 和 ocarina 的波形**都是 sine**，只有 5% 音量差，
 * 而试听音是 0.18s 的 ability，连 warm(三角) 和 sine 的区别都被吞掉了。
 *
 * 这个测试不看代码"声明了什么"，而是**捕获真实发声路径**上创建的振荡器与包络：
 * 用假 AudioContext 记录 createOscillator / createBiquadFilter / gain 包络调用，
 * 再断言三个主题在「波形 / 泛音个数与比例 / 起音时长 / 滤波亮度」上两两不同。
 *
 * 运行：node tests/sound-theme.mjs
 */
import assert from 'node:assert';
import { AUDIO_SFX_RECIPES, SOUND_THEMES, soundThemeFingerprint, createAudioBus } from '../src/audio/audio-bus.js';

// ── 假 Web Audio：只记录，不出声 ──────────────────────────────────────────────
class FakeParam {
  constructor(v) { this.value = v; this.calls = []; }
  setValueAtTime(v, t) { this.calls.push({ k: 'set', v, t }); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push({ k: 'exp', v, t }); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.calls.push({ k: 'lin', v, t }); this.value = v; return this; }
}
class FakeGain { constructor() { this.gain = new FakeParam(1); this.dest = null; } connect(d) { this.dest = d; return d; } disconnect() { this.dest = null; } }
class FakeBiquad {
  constructor() { this.type = 'lowpass'; this.frequency = new FakeParam(350); this.Q = new FakeParam(1); }
  connect(d) { this.dest = d; return d; }
  disconnect() { this.dest = null; }
}
class FakeOsc {
  constructor(rec) { this.type = 'sine'; this.frequency = new FakeParam(440); this.started = null; this.stopped = null; rec.osc.push(this); }
  connect(d) { this.dest = d; return d; }
  start(t) { this.started = t; }
  stop(t) { this.stopped = t; }
  disconnect() { this.dest = null; }
}
class FakeBufferSource {
  constructor(rec) { this.buffer = null; this.loop = false; this.started = null; rec.sources.push(this); }
  connect(d) { this.dest = d; return d; }
  start(t) { this.started = t; }
  stop() { /* noop */ }
  disconnect() { this.dest = null; }
}
class FakeCtx {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;          // 取样率调小，只为构造噪声 buffer 时快
    this.state = 'running';
    this.destination = { kind: 'dest' };
    this.osc = [];
    this.gains = [];
    this.biquads = [];
    this.sources = [];
  }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createOscillator() { return new FakeOsc(this); }
  createBiquadFilter() { const b = new FakeBiquad(); this.biquads.push(b); return b; }
  createBufferSource() { return new FakeBufferSource(this); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

const g = (id) => AUDIO_SFX_RECIPES[id].gain;

// ── ① 主题指纹两两不同（数据层）──────────────────────────────────────────────
const ids = Object.keys(SOUND_THEMES);
assert.equal(ids.length, 3, '应该有 3 个声音风格');
const prints = ids.map((id) => soundThemeFingerprint(id));
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    assert.notEqual(prints[i], prints[j],
      `${ids[i]} 与 ${ids[j]} 的音色指纹相同（${prints[i]}）——两者听感会一样`);
  }
}
console.log(`① 三个主题指纹两两不同：${ids.join(' / ')} ✔`);

// ── ② 真实发声路径：一次乐音实际产生了什么 ──────────────────────────────────
/** 用给定主题播一个音，返回捕获到的「一波发声」特征 */
function capture(themeId, recipeId) {
  const ctx = new FakeCtx();
  const realAC = globalThis.AudioContext;
  globalThis.AudioContext = function () { return ctx; };
  const bus = createAudioBus();
  bus.setTheme(themeId);
  bus.unlockMedia();
  ctx.osc.length = 0;            // 丢掉 BGM 可能已排的音，只看这一发
  ctx.gains.length = 0;
  ctx.biquads.length = 0;
  ctx.sources.length = 0;
  bus.play(recipeId);
  globalThis.AudioContext = realAC;
  // 主声部包络：startVoice 第一个建的 gain 就是它。
  // calls[0] 是 setValueAtTime(0.0001, t0)，calls[1] 是 exponentialRampToValueAtTime(vol, t0+attack)，
  // 两者时间差就是**起音时长**——陶笛慢起音、八音盒硬起音全靠它区分。
  const mainEnv = (ctx.gains[0] && ctx.gains[0].gain.calls) || [];
  const attack = mainEnv.length >= 2 ? +(mainEnv[1].t - mainEnv[0].t).toFixed(4) : null;
  return {
    oscs: ctx.osc.map((o) => ({ type: o.type, hz: Math.round(o.frequency.calls[0].v) })),
    filters: ctx.biquads.map((b) => ({ type: b.type, f0: b.frequency.calls[0].v })),
    attack,
  };
}

const ABILITY = 'ability';        // 660→990Hz、无滤波器、0.18s：最能暴露音色差异的配方
const cap = {};
for (const id of ids) cap[id] = capture(id, ABILITY);

for (const id of ids) {
  const c = cap[id];
  assert.ok(c.oscs.length >= 1, `${id}：没有创建任何振荡器，说明音效根本没播`);
}
// 波形：暖木必须是三角波（有奇次泛音），八音盒/陶笛是正弦——但靠泛音列区分
assert.equal(cap.warm.oscs[0].type, 'triangle', '暖木的基频应为三角波');
assert.equal(cap.musicbox.oscs[0].type, 'sine', '八音盒的基频应为正弦波');
assert.equal(cap.ocarina.oscs[0].type, 'sine', '陶笛的基频应为正弦波');

// 泛音个数：八音盒 2 条（2× 与 4.2×），暖木/陶笛各 1 条
assert.equal(cap.warm.oscs.length, 2, '暖木应为 基频 + 1 条泛音');
assert.equal(cap.musicbox.oscs.length, 3, '八音盒应为 基频 + 2 条泛音（金属感来源）');
assert.equal(cap.ocarina.oscs.length, 2, '陶笛应为 基频 + 1 条泛音');
// 八音盒必须带一条非整数倍泛音（4.2×），这是「叮」的金属味，也是它区别于暖木的关键
const mbRatios = cap.musicbox.oscs.slice(1).map((o) => o.hz / cap.musicbox.oscs[0].hz);
assert.ok(mbRatios.some((r) => r > 3.5), `八音盒必须有高频非谐泛音，实际比值 ${mbRatios.join(',')}`);

// 起音：陶笛慢（≥40ms），八音盒快（≤10ms）——这是「软起音」与「硬起音」的分界
assert.ok(cap.ocarina.attack >= 0.04, `陶笛起音应 ≥40ms（实际 ${cap.ocarina.attack}）`);
assert.ok(cap.musicbox.attack <= 0.01, `八音盒起音应 ≤10ms（实际 ${cap.musicbox.attack}）`);
assert.ok(cap.warm.attack > cap.musicbox.attack, '暖木起音应比八音盒慢');

// 陶笛：原本没有滤波器的配方（ability）也必须被压暗
assert.ok(cap.ocarina.filters.length >= 1 && cap.ocarina.filters[0].f0 <= 2000,
  '陶笛应给无滤波配方补一条低通（空心、发闷）');
assert.equal(cap.warm.filters.length, 0, '暖木不该给 ability 加滤波器（它本身不闷）');
console.log(`② 同一发 ability：osc ${cap.warm.oscs.length}/${cap.musicbox.oscs.length}/${cap.ocarina.oscs.length} 条，`
  + `起音 ${cap.warm.attack}/${cap.musicbox.attack}/${cap.ocarina.attack}s，陶笛低通 f0=${cap.ocarina.filters[0].f0}Hz ✔`);

// ── ③ 噪声类音效：换不了波形，但亮度（滤波频率）必须跟着主题变 ──────────────
const noiseCap = {};
for (const id of ids) noiseCap[id] = capture(id, 'pendown');   // 白噪 + bandpass 2600→1400
const f0 = (id) => noiseCap[id].filters[0].f0;
assert.ok(f0('musicbox') > f0('warm'), `八音盒的噪声应更亮（${f0('musicbox')} vs ${f0('warm')}）`);
assert.ok(f0('ocarina') < f0('warm'), `陶笛的噪声应更暗（${f0('ocarina')} vs ${f0('warm')}）`);
assert.ok(Math.abs(f0('ocarina') - f0('musicbox')) > 800, '陶笛与八音盒的噪声亮度差应显著');
console.log(`③ 噪声亮度随主题：八音盒 ${Math.round(f0('musicbox'))}Hz > 暖木 ${Math.round(f0('warm'))}Hz > 陶笛 ${Math.round(f0('ocarina'))}Hz ✔`);

// ── ④ 试听音本身要够长，且不受主题影响（它只是载体）────────────────────────
const pv = AUDIO_SFX_RECIPES.preview;
assert.ok(pv, '必须存在 preview 试听音');
assert.equal(pv.type, 'arp', '试听音应为琶音（四个音才听得出版形与音色）');
assert.ok(pv.notes.length >= 4, `试听音至少 4 个音，实际 ${pv.notes.length}`);
assert.ok(pv.noteDur >= 0.5, `试听音单音时长应 ≥0.5s（太短听不出衰减），实际 ${pv.noteDur}`);
assert.ok(g('preview') < g('stamp'), '试听音不该盖过盖章音（且它不是游戏事件）');
console.log(`④ 试听音：${pv.notes.length} 音琶音、单音 ${pv.noteDur}s、gain ${g('preview')} ✔`);

// ── ⑤ 主题切换不该改动共享配方表 ────────────────────────────────────────────
assert.equal(AUDIO_SFX_RECIPES.ability.wave, 'sine', 'applyTheme 不能改写共享配方表');
assert.equal(AUDIO_SFX_RECIPES.ability.filter, undefined, 'applyTheme 不能把低通写回配方表');
console.log('⑤ 共享配方表未被主题污染（applyTheme 返回拷贝）✔');

console.log('\n声音风格 5/5 通过：三个主题在波形/泛音/起音/亮度上两两不同');
process.exit(0);   // BGM 定时器是常驻的，跑完显式退出
