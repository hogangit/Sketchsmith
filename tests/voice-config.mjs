/**
 * tests/voice-config.mjs —— 台词朗读的「音色可选 / 可关闭」必须真的生效
 *
 * 背景：用户实测「说话的语音还是比较难听」。这句抱怨没法靠改代码里的参数解决——
 * 念台词用的是**系统自带 TTS**，音质由设备上装了哪些音色决定：
 * Edge 的「Online (Natural)」神经音色像人，Windows 自带的 Huihui 是机器人腔。
 * 于是这件事变成三条可验证的承诺：
 *   ① 默认必须挑到这台设备上**最像人**的那个（有自然音色就绝不用本地机械音）；
 *   ② 玩家能换音色，且换完立刻能听出差别（走同一句试听词）；
 *   ③ 都难听就能一键关掉，关掉之后 speak() 一次都不许再调 speechSynthesis。
 *
 * 测试用假 speechSynthesis 捕获真实的 synthesis 调用对象，不看代码"声明了什么"。
 *
 * 运行：node tests/voice-config.mjs
 */
import assert from 'node:assert';

// ── 假浏览器环境：必须在 import audio-bus 之前装好 ───────────────────────────
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const spoken = [];
let VOICES = [];
globalThis.speechSynthesis = {
  getVoices: () => VOICES.slice(),
  speak: (u) => { spoken.push(u); },
  cancel: () => { /* noop */ },
  addEventListener: () => { /* noop */ },
};
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) {
    this.text = text;
    this.voice = null; this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1;
    this.onstart = null; this.onend = null; this.onerror = null;
  }
};

// 极简假 Web Audio：unlockMedia() 需要它才会把 unlocked 置真
class P { constructor(v) { this.value = v; } setValueAtTime() { return this; } exponentialRampToValueAtTime() { return this; } linearRampToValueAtTime() { return this; } }
class G { constructor() { this.gain = new P(1); } connect(d) { return d; } disconnect() { } }
class O { constructor() { this.type = 'sine'; this.frequency = new P(440); } connect(d) { return d; } start() { } stop() { } disconnect() { } }
class B { constructor() { this.type = 'lowpass'; this.frequency = new P(350); this.Q = new P(1); } connect(d) { return d; } disconnect() { } }
class S { constructor() { this.buffer = null; this.loop = false; } connect(d) { return d; } start() { } stop() { } disconnect() { } }
class FakeCtx {
  constructor() {
    this.currentTime = 0; this.sampleRate = 8000; this.state = 'running';
    this.destination = {};
  }
  createGain() { return new G(); }
  createOscillator() { return new O(); }
  createBiquadFilter() { return new B(); }
  createBufferSource() { return new S(); }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}
globalThis.AudioContext = function () { return new FakeCtx(); };

const devVoices = () => ([
  { name: 'Microsoft Huihui - Chinese (Simplified, PRC)', lang: 'zh-CN', voiceURI: 'huihui', localService: true },
  { name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN', voiceURI: 'xiaoxiao', localService: false },
  { name: 'Google 普通话（中国大陆）', lang: 'zh-CN', voiceURI: 'google', localService: false },
  { name: 'Alex', lang: 'en-US', voiceURI: 'alex', localService: true },
]);

const { createAudioBus } = await import('../src/audio/audio-bus.js');

// ── ① 默认音色：必须自动挑中最像人的那个 ─────────────────────────────────────
VOICES = devVoices();
const bus = createAudioBus();
bus.unlockMedia();

const list = bus.voiceList;
assert.equal(list.length, 3, `只该列中文音色（en-US 不能混进来），实际 ${list.length}`);
assert.equal(list[0].uri, 'xiaoxiao', `默认应挑「自然音色」，实际 ${list[0].uri}`);
assert.equal(bus.voiceConfig.uri, 'xiaoxiao', 'voiceConfig 必须与列表第一项一致');
assert.ok(/自然/.test(bus.voiceConfig.name), `音色短名应标出「自然」，实际 "${bus.voiceConfig.name}"`);
// 短名要能塞进面板（不出现 "Microsoft" / "- Chinese (Mainland)" 这种废话）
assert.ok(bus.voiceConfig.name.length <= 16, `短名过长：${bus.voiceConfig.name}`);
assert.ok(!/microsoft|chinese/i.test(bus.voiceConfig.name), `短名没压缩干净：${bus.voiceConfig.name}`);
console.log(`① 自动挑中「${bus.voiceConfig.name}」（${list.map((v) => v.name).join(' > ')}）✔`);

// ── ② 换音色：顺序循环、落盘、试听立刻用新音色 ───────────────────────────────
spoken.length = 0;      // unlockMedia 会发一条静音 utterance（iOS 解锁），先清掉
const second = bus.cycleVoice(1);
assert.equal(bus.voiceConfig.uri, 'google', `下一档应为 google，实际 ${bus.voiceConfig.uri}`);
assert.equal(mem.get('wcwz_voice_uri'), 'google', '换过的音色必须持久化（下次进游戏还是它）');
assert.ok(spoken.length === 0, 'cycleVoice 自己不该发声（试听由上层显式触发，便于测试）');

spoken.length = 0;
assert.equal(bus.previewVoice(), true, 'previewVoice 应返回 true');
assert.equal(spoken.length, 1, '试听应恰好合成一句');
assert.equal(spoken[0].voice.voiceURI, 'google', `试听必须用刚换的音色，实际 ${spoken[0].voice && spoken[0].voice.voiceURI}`);
assert.equal(spoken[0].rate, 0.94, `试听语速应为 0.94（慢一点才有讲故事感），实际 ${spoken[0].rate}`);
assert.ok(spoken[0].text && spoken[0].text.length >= 6, '试听句不能是空串');

bus.cycleVoice(-1);
assert.equal(bus.voiceConfig.uri, 'xiaoxiao', '往回切应回到上一档');
console.log(`② 音色可换：${second} ⇄ 持久化 wcwz_voice_uri=google，试听走同一句 ✔`);

// ── ③ 关掉朗读：speak() 一次都不许再合成，但手动试听仍可用 ─────────────────
spoken.length = 0;
bus.setVoiceOn(false);
assert.equal(bus.voiceMode, 'off', `关掉后 voiceMode 应为 off，实际 ${bus.voiceMode}`);
const ok = bus.speak('lv1_intro', '先把小人放下来试试。', { speaker: 'narrator', level: 3, textMs: 2000 });
assert.equal(ok, 'muted', `关掉朗读后 speak() 必须返回 'muted'（上层只会显示气泡），实际 ${ok}`);
for (let i = 0; i < 8; i++) bus.tickVoice();
assert.equal(spoken.length, 0, `关掉朗读后不该产生任何 synthesis 调用，实际 ${spoken.length} 次`);
assert.equal(mem.get('wcwz_voice_on'), '0', '开关状态必须持久化');

// 用户亲手点的试听不受开关影响（点了没反应会被当成坏了）
bus.previewVoice();
assert.equal(spoken.length, 1, '关闭朗读时，手动试听仍应出声');
console.log('③ 关闭朗读：speak 0 次合成、开关落盘、手动试听仍可用 ✔');

// ── ④ 重新打开：speak 能真正走到 synthesis ───────────────────────────────────
bus.setVoiceOn(true);
spoken.length = 0;
const res2 = bus.speak('lv1_intro', '先把小人放下来试试。', { speaker: 'narrator', level: 3, textMs: 2000 });
for (let i = 0; i < 8; i++) bus.tickVoice();
assert.ok(res2 === 'queued' || res2 === 'deferred', `打开后 speak() 应返回 queued/deferred，实际 ${res2}`);
assert.ok(spoken.length >= 1, '重新打开朗读后，台词应能合成出声');
assert.equal(spoken[0].voice.voiceURI, bus.voiceConfig.uri, '朗读必须使用面板里选中的音色');
console.log(`④ 重新打开：合成 ${spoken.length} 句，用的是选中音色 ✔`);

// ── ⑤ 换设备：存档里的音色不存在时静默回落到最佳，绝不静默失声 ──────────────
mem.set('wcwz_voice_uri', 'ghost-voice');
VOICES = devVoices().filter((v) => v.voiceURI !== 'ghost-voice');
const bus2 = createAudioBus();
bus2.refreshVoices();
assert.equal(bus2.voiceConfig.uri, 'xiaoxiao', `设备上没有存过的音色时应回落到最佳，实际 ${bus2.voiceConfig.uri}`);
spoken.length = 0;
bus2.previewVoice();
assert.equal(spoken[0].voice.voiceURI, 'xiaoxiao', '回落之后试听必须仍然有声音');
console.log('⑤ 存档音色缺失 → 静默回落到最佳音色 ✔');

// ── ⑥ 只有机械音色 / 完全没有中文音色的两种退化路径 ──────────────────────────
VOICES = [devVoices()[0]];                       // 只剩 Huihui
const bus3 = createAudioBus();
bus3.refreshVoices();
assert.equal(bus3.voiceMode, 'voice', '只有本地音色时仍应可用（不能因为"不够好听"就不出声）');
assert.equal(bus3.cycleVoice(1), '', '只有一个音色时切换应返回空串（UI 据此把箭头画灰）');

VOICES = [{ name: 'Alex', lang: 'en-US', voiceURI: 'alex', localService: true }];
const bus4 = createAudioBus();
bus4.refreshVoices();
assert.equal(bus4.voiceMode, 'bubble', '没有中文音色时必须走气泡，绝不拿英文嗓念中文');
assert.equal(bus4.voiceList.length, 0, '没有中文音色时列表应为空');
console.log('⑥ 单音色可切换性 / 无中文音色降级为气泡 ✔');

console.log('\n语音配置 6/6 通过：默认挑最佳、可换、可关、换设备不失声');
process.exit(0);   // BGM 定时器常驻，跑完显式退出
