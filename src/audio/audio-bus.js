/**
 * src/audio/audio-bus.js —— 音频模块**单例**（全仓库唯一允许 new AudioContext 的文件）
 *
 * 对外只暴露 5 个方法（契约）：
 *   unlockMedia()          唯一解锁点，幂等；必须在首次 pointerdown 的**同步**路径里调
 *   play(sfxId, opts)      opts = { score?, material?, x? }（P0 忽略 x）
 *   speak(lineId)          zh-* 语音可用才出声，否则返回 false → 上层走气泡
 *   setEnabled(on)         总开关：suspend()/resume()，**不 stop()、不重建**
 *   setKey(rootHz, modeId) 章节转调唯一入口，modeId 是数字（0=宫 1=羽）
 *   setVolume(bus, v)      P1
 *
 * 硬约束（附录 C / E）：
 *   · AudioContext 实例数 = 1，惰性创建；
 *   · 节点总数 ≤40：BGM 常驻 ≤12，SFX 并发 ≤8；
 *   · 每个 oscillator 包络结束必须 stop(t) + disconnect()，不许靠 GC；
 *   · 噪声 buffer 只生成 2 个（白 1s / 棕 1s）全局复用；
 *   · 未解锁前 play 排队 ≤3（只排 pendown/spawn），speak 直接丢弃；
 *   · 绘制期间（pointerdown→pointerup）任何语音都不起播；
 *   · 切后台停调度，切回来用 ctx.currentTime 对齐，不补发漏掉的音符。
 *
 * 本文件不 import 物理层：依赖方向是 audio → physics（订阅一次 onImpact 由 main.js 完成）。
 */

import { createVoiceScheduler, LINE_LEVEL } from './voice-scheduler.js';

const AUDIO_MAX_SFX = 8;
// 单位是「同时存活的音频节点数」。一个乐音现在可能带 2 条泛音（每条 振荡器+增益 = 2 节点），
// 所以最坏情形 ≈ 8 个音 × 7 节点 = 56；40 会让主题化后的音效在混战时被提前拒绝。
const AUDIO_NODE_BUDGET = 56;
const AUDIO_QUEUE_MAX = 3;
const AUDIO_QUEUE_TTL_MS = 1500;
const AUDIO_LOOKAHEAD_MS = 120;
const AUDIO_SCHED_INTERVAL_MS = 25;
const AUDIO_BGM_GAIN = 0.16;

/** 6 个 P0 音效配方（噪声源 | 振荡器 | 滤波 | 包络 | 时长），全部 [待实机标定] */
export const AUDIO_SFX_RECIPES = {
  // 落笔：轻沙沙，短而柔（降增益、q 更柔，不再刺耳）
  pendown: { type: 'noise', noise: 'white', dur: 0.09, gain: 0.22, filter: { type: 'bandpass', f0: 2400, f1: 1500, q: 0.8 }, attack: 0.003 },
  // 生成造物：温润木琴「咚」——正弦下滑 + 轻低通，圆润不刺
  spawn: { type: 'tone', wave: 'sine', f0: 392, f1: 262, dur: 0.30, gain: 0.22, attack: 0.006, filter: { type: 'lowpass', f0: 2200, f1: 900, q: 0.7 } },
  // 贴能力：清亮「叮」，正弦上扬
  ability: { type: 'tone', wave: 'sine', f0: 660, f1: 990, dur: 0.16, gain: 0.18, attack: 0.004 },
  // 过关：上行小三和弦琶音（C-E-G），明亮而柔；波形随「声音风格」替换
  win: { type: 'arp', wave: 'triangle', notes: [523.25, 659.25, 783.99], step: 0.10, noteDur: 0.5,
    gain: 0.20, attack: 0.01, shimmer: [1046.5, 1318.5], shimmerDur: 0.4, shimmerGain: 0.04 },
  // 失败：柔和下行「噗」——三角波 + 低通，不再用锯齿的刺耳下滑
  fail: { type: 'tone', wave: 'triangle', f0: 294, f1: 147, dur: 0.42, gain: 0.18, attack: 0.006, filter: { type: 'lowpass', f0: 1100, f1: 400, q: 0.9 } },
  // 盖章：低沉「咚」，棕噪低通（保留）
  stamp: { type: 'noise', noise: 'brown', dur: 0.20, gain: 0.30, filter: { type: 'lowpass', f0: 800, f1: 160, q: 0.7 }, attack: 0.001 },
  // 碰撞：闷响棕噪（保留，略降）
  collide: { type: 'noise', noise: 'brown', dur: 0.12, gain: 0.17, filter: { type: 'lowpass', f0: 650, f1: 200, q: 0.9 }, attack: 0.001 },
  // 界面点击：柔和木鱼「嗒」，三角短音（原 square → triangle，去掉刺耳方波）
  ui: { type: 'tone', wave: 'triangle', f0: 520, f1: 520, dur: 0.05, gain: 0.09, attack: 0.002 },
  // 关4 怕痒弹射小人：弹簧「boing」——正弦上扬 + 轻低通，听感是「被弹起来」而非「被砸」
  spring: { type: 'tone', wave: 'sine', f0: 300, f1: 640, dur: 0.22, gain: 0.18, attack: 0.003, filter: { type: 'lowpass', f0: 2200, f1: 900, q: 0.9 } },
  // 关5 落水：环境水声——带通白噪，中心频率慢扫 400→1200Hz（水面感）
  water: { type: 'noise', noise: 'white', dur: 0.40, gain: 0.22, filter: { type: 'bandpass', f0: 400, f1: 1200, q: 1.0 }, attack: 0.03 },

  // ── 规格 3.1 核心表补齐（D29）：音量按「盖章 stamp=0dB」基准换算 ──────────────
  // 抬笔：同落笔一路但更短、更高频、更陡，避免和落笔听混
  penup: { type: 'noise', noise: 'white', dur: 0.05, gain: 0.12, filter: { type: 'bandpass', f0: 3400, f1: 2200, q: 1.2 }, attack: 0.001 },
  // 笔迹摩擦：全表最轻，只作「笔还在纸上」的存在感，不做节奏
  penmove: { type: 'noise', noise: 'white', dur: 0.06, gain: 0.028, filter: { type: 'bandpass', f0: 3200, f1: 3900, q: 2.2 }, attack: 0.004 },
  // 造物坠落：低频正弦下滑 + 轻噪声尾。**不做滑稽下滑音**
  fall: { type: 'tone', wave: 'sine', f0: 240, f1: 90, dur: 0.44, gain: 0.14, attack: 0.006,
    filter: { type: 'lowpass', f0: 800, f1: 200, q: 0.8 },
    overlay: { type: 'noise', noise: 'white', dur: 0.18, gain: 0.045, filter: { type: 'highpass', f0: 1200, f1: 600, q: 0.7 }, attack: 0.01 } },
  // 章节/模式切换：翻页噪声（高通上扫）+ 低频落地 thump（overlay）
  chapter: { type: 'noise', noise: 'white', dur: 0.42, gain: 0.17, attack: 0.02,
    filter: { type: 'highpass', f0: 600, f1: 2600, q: 0.7 },
    overlay: { type: 'tone', wave: 'sine', f0: 150, f1: 70, dur: 0.30, gain: 0.15, attack: 0.004 } },
  // 提示阶梯升级：柔和 ping，音量刻意低（提示不该抢戏）
  hint: { type: 'tone', wave: 'sine', f0: 880, f1: 880, dur: 0.50, gain: 0.05, attack: 0.02 },
  // 文字气泡：极短纸沙沙，decay 陡
  bubble: { type: 'noise', noise: 'white', dur: 0.07, gain: 0.06, filter: { type: 'highpass', f0: 2000, f1: 4200, q: 0.8 }, attack: 0.002 },
  // 能力组合奖励音：全场唯一高亮度音色。纯四度+纯五度上行三音 + 高频 shimmer。
  combo: { type: 'arp', wave: 'triangle', notes: [392, 523.25, 587.33], step: 0.085, noteDur: 0.46,
    gain: 0.24, attack: 0.008, shimmer: [2093, 2637, 3136], shimmerDur: 0.34, shimmerGain: 0.045 },

  // ── 声音风格试听音（不是游戏事件，只在「关于」里点芯片时播）─────────────────
  // 四个音跨两个八度：低音显厚度、高音显泛音。时长足够（0.62s × 主题系数）才听得出
  // 八音盒的短促金属尾与陶笛的慢起音——早先复用 0.18s 的 ability，三者听感几乎一样。
  preview: { type: 'arp', wave: 'triangle', notes: [392, 523.25, 659.25, 783.99], step: 0.15,
    noteDur: 0.62, gain: 0.20, attack: 0.006 },
};

/**
 * 声音风格（用户可切换）。每条定义：
 *   wave   —— 给所有「乐音类」音效（tone/arp）替换的波形（噪声类不受影响）
 *   gain   —— 全局音量系数（叠在配方表基准增益之上）
 *   bgm    —— 背景音乐的波形 / 增益 / 衰减时长
 * 默认 warm；选择持久化到 localStorage('wcwz_sound_theme')。
 */
export const SOUND_THEMES = {
  /**
   * 暖木：木琴 / 马林巴。三角波（本身奇次泛音丰富）+ 一条短 2 倍泛音，
   * 起音与衰减保持原表节奏，亮度中性 → 温而不闷。
   */
  warm: {
    label: '暖木', wave: 'triangle', gain: 1.0,
    attack: 1.0, dur: 1.0, minAttack: 0, bright: 1.0,
    partials: [{ ratio: 2.0, gain: 0.16, durScale: 0.55 }],
    bgm: { wave: 'triangle', gain: 1.0, decay: 0.9, attack: 0.18 },
  },
  /**
   * 八音盒：金属拨片。**靠非谐泛音立住音色**——2 倍 + 4.2 倍的亮泛音衰减远快于基频，
   * 起音极快（×0.45）、整体短促（×0.72），噪声也提亮（×1.45），听感是「叮」不是「咚」。
   * 三个主题里唯一带高频金属味的那一个。
   */
  musicbox: {
    label: '八音盒', wave: 'sine', gain: 1.05,
    attack: 0.45, dur: 0.72, minAttack: 0, bright: 1.45,
    partials: [{ ratio: 2.0, gain: 0.34, durScale: 0.55 }, { ratio: 4.2, gain: 0.18, durScale: 0.32 }],
    bgm: { wave: 'sine', gain: 1.0, decay: 0.45, attack: 0.01, partial: { ratio: 3.0, gain: 0.16 } },
  },
  /**
   * 陶笛：空心管乐。慢起音（最短 45ms，圆头不爆）+ 1.5 倍长衰减 + 低通压暗（×0.6），
   * 2 倍泛音很轻 → 气息感、连奏感，三个主题里唯一「软起音」的那一个。
   */
  ocarina: {
    label: '陶笛', wave: 'sine', gain: 1.0,
    attack: 3.2, dur: 1.5, minAttack: 0.045, bright: 0.6,
    partials: [{ ratio: 2.0, gain: 0.10, durScale: 1.1 }],
    // 无滤波器的配方（如 ability）给一条固定低通，保证「闷」这个特征在所有音效上都成立
    toneLowpass: 1700,
    bgm: { wave: 'sine', gain: 0.85, decay: 1.5, attack: 0.26 },
  },
};

/** 三条主题在「波形 + 泛音列 + 包络 + 亮度」四维上的指纹，测试用它断言三者两两不同 */
export function soundThemeFingerprint(id) {
  const t = SOUND_THEMES[id];
  if (!t) return '';
  const parts = (t.partials || []).map((p) => `${p.ratio}:${p.gain}:${p.durScale}`).join(',');
  return [t.wave, parts, `${t.attack}/${t.dur}/${t.minAttack}`, t.bright].join('|');
}

const AUDIO_MODE_SCALES = {
  0: [0, 2, 4, 7, 9],   // 宫（五声大调）
  1: [0, 3, 5, 7, 10],  // 羽（五声小调）
};

function audioNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

export function createAudioBus() {
  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let enabled = true;
  let unlocked = false;
  let unlockAt = 0;
  let drawing = false;
  let noiseWhite = null;
  let noiseBrown = null;
  let rootHz = 293.66;          // D
  let modeId = 0;
  let bgmTimer = 0;
  let bgmNextNoteTime = 0;
  let bgmStep = 0;
  let sfxLive = 0;
  let nodeCount = 0;
  const queue = [];             // 未解锁前的 pendown/spawn 排队
  const voiceState = { available: null, mode: 'unknown', unlockedVoice: false, voices: [], listening: false };

  // ── 语音（TTS）配置：音色可选，选不中还能整个关掉 ──────────────────────────
  // 浏览器 TTS 的音质**完全取决于这台设备装了什么音色**：Edge 的「Online (Natural)」
  // 神经音色听起来像人，Windows 自带的 Huihui / Yaoyao 则是标准机器人腔。
  // 单文件离线游戏换不了引擎，能做的是把选择权交出去：
  //   · 默认自动挑分数最高的那个（有自然音色就绝不用本地机械音）；
  //   · 用户点「‹ ›」循环切换，切换即试听；
  //   · 实在都难听，一键关掉朗读——台词只走字幕，游戏本身不受影响。
  const VOICE_URI_KEY = 'wcwz_voice_uri';
  const VOICE_ON_KEY = 'wcwz_voice_on';
  /** 试听句：短、有起伏、含常见字，最容易听出音色差别 */
  const VOICE_TRY = '你好呀，我是一幅会动的画。';
  const voiceCfg = { on: true, uri: '', rate: 0.94, pitch: 1.0 };
  try {
    if (typeof localStorage !== 'undefined') {
      const u = localStorage.getItem(VOICE_URI_KEY);
      if (u) voiceCfg.uri = u;
      if (localStorage.getItem(VOICE_ON_KEY) === '0') voiceCfg.on = false;
    }
  } catch (e) { /* 隐私模式：用默认值 */ }

  // ── 声音风格（用户可切换）──
  let currentThemeId = 'warm';
  let theme = SOUND_THEMES[currentThemeId];
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('wcwz_sound_theme');
      if (saved && SOUND_THEMES[saved]) { currentThemeId = saved; theme = SOUND_THEMES[saved]; }
    }
  } catch (e) { /* 隐私模式等场景 localStorage 不可用，退回默认 */ }

  /**
   * 语音调度（C.1 / C.1b / C.2）。真 backend 只在这里出现：
   * `onstart` 回调是**全程唯一扣语音额度的地方**（C.1 第 ⑤ 步）。
   * `isOnScreen` / `precheckQuota` 由主程序注入——音频层不认识关卡，也不该认识。
   */
  const voiceHooks = { isOnScreen: null, precheckQuota: null };

  /**
   * 音色打分：只服务一个目标——挑出这台设备上「最像人」的那个。
   * Edge 的神经音色（名字带 Online / Natural）远好于系统本地音色；
   * Google 的 zh 音色次之；Windows 自带 Huihui / Yaoyao 垫底，但总比没有强。
   */
  function voiceScore(v) {
    const n = String(v && v.name || '').toLowerCase();
    let s = 0;
    if (/natural|online/.test(n)) s += 100;
    if (/xiaoxiao|xiaoyi|yunxi|yunyang|yunjian|yunxia|yunting|xiaoqiu/.test(n)) s += 40;
    if (/google/.test(n)) s += 30;
    if (v && v.localService) s -= 12;      // 同等条件下，本地合成更机械
    return s;
  }
  /** 音色短名：把 "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)" 压成 "Xiaoxiao 自然" */
  function shortVoiceName(n) {
    let s = String(n || '').replace(/^microsoft\s*/i, '').replace(/\s*-\s*chinese.*$/i, '');
    s = s.replace(/\s*online\s*/i, ' ').replace(/\s*\(natural\)\s*/i, ' 自然').replace(/\s+/g, ' ').trim();
    if (s.length > 16) s = s.slice(0, 15) + '…';
    return s || '默认音色';
  }
  /** 当前选中的音色对象；没选过就取打分第一（不写 localStorage，换设备后能自动重挑） */
  function currentVoice() {
    const list = voiceState.voices || [];
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) if (list[i].voiceURI === voiceCfg.uri) return list[i];
    return list[0];
  }
  /** 有的浏览器 getVoices() 首次为空、随后异步补齐——没这个监听就会一直判「没有中文语音」 */
  function installVoicesListener() {
    if (voiceState.listening || typeof speechSynthesis === 'undefined' || !speechSynthesis.addEventListener) return;
    voiceState.listening = true;
    try { speechSynthesis.addEventListener('voiceschanged', () => { probeVoices(); }); } catch (e) { /* 老浏览器无此事件 */ }
  }

  const voiceBackend = {
    speak(req) {
      try {
        const u = new SpeechSynthesisUtterance(req.text || req.lineId);
        const v = currentVoice();
        if (v) u.voice = v;
        u.lang = (v && v.lang) || voiceState.voiceLang || 'zh-CN';
        // 语速略慢、音高不动：念台词要有"讲故事"的停顿感，念快了就变新闻播报腔
        u.rate = voiceCfg.rate;
        u.pitch = voiceCfg.pitch;
        u.volume = 0.92;
        u.onstart = () => { if (req.onStart) req.onStart(); };
        u.onend = () => { if (req.onEnd) req.onEnd(); };
        u.onerror = () => { if (req.onError) req.onError(); };
        speechSynthesis.speak(u);
      } catch (e) { if (req.onError) req.onError(); }
    },
    cancel() { try { speechSynthesis.cancel(); } catch (e) { /* 忽略 */ } },
  };
  const voiceScheduler = createVoiceScheduler({
    backend: voiceBackend,
    now: audioNow,
    isOnScreen: (sp) => (voiceHooks.isOnScreen ? voiceHooks.isOnScreen(sp) : true),
    precheckQuota: (id) => (voiceHooks.precheckQuota ? voiceHooks.precheckQuota(id) : true),
  });

  // ---- 语音可用性判据：存在 zh-* 才算可用（只有 en-US 时必须走气泡）----
  function probeVoices() {
    if (typeof speechSynthesis === 'undefined') { voiceState.available = false; return false; }
    let list = [];
    try { list = speechSynthesis.getVoices() || []; } catch (e) { list = []; }
    const zh = list.filter((v) => /^zh/i.test(v.lang || ''));
    zh.sort((a, b) => voiceScore(b) - voiceScore(a));   // 天然音色排前面，UI 顺序＝推荐顺序
    voiceState.voices = zh;
    voiceState.available = zh.length > 0;
    voiceState.mode = zh.length > 0 ? (voiceCfg.on ? 'voice' : 'off') : 'bubble';
    // 用户选过的音色如果这台设备上没有（换设备 / 卸了语音包），静默回落到最佳
    if (voiceCfg.uri && !zh.some((v) => v.voiceURI === voiceCfg.uri)) voiceCfg.uri = '';
    if (!voiceCfg.uri && zh.length) voiceCfg.uri = zh[0].voiceURI;
    const cur = currentVoice();
    voiceState.voiceLang = (cur && cur.lang) || 'zh-CN';
    installVoicesListener();
    return voiceState.available;
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
      return null;
    }
    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 1 : 0;
    masterGain.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = AUDIO_BGM_GAIN;
    bgmGain.connect(masterGain);
    // 2 个噪声 buffer 全局复用
    const sr = ctx.sampleRate;
    noiseWhite = ctx.createBuffer(1, sr, sr);
    const wd = noiseWhite.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    noiseBrown = ctx.createBuffer(1, sr, sr);
    const bd = noiseBrown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      bd[i] = last * 3.2;
    }
    probeVoices();
    return ctx;
  }

  function track(delta) {
    nodeCount = Math.max(0, nodeCount + delta);
  }

  /**
   * 起一个「声部」：src → gain →（可选 filter）→ masterGain。
   * `overlay`（副振荡器）与 `arp`（琶音的每一个音）都复用它——两者都是**通用机制**，
   * 不是为某个音效 id 开的分支，所以配方表仍然保持纯数据。
   * 滤波器由 setTimeout 独立回收（与 onended 不同路径），避免重复 track。
   */
  function startVoice(spec, t0, volScale, onEnded) {
    const gain = ctx.createGain();
    const vol = Math.max(0, Math.min(1, (spec.gain || 0.2) * (volScale == null ? 1 : volScale)));
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + (spec.attack || 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
    let dest = masterGain;
    if (spec.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = spec.filter.type || 'lowpass';
      bq.frequency.setValueAtTime(spec.filter.f0, t0);
      bq.frequency.exponentialRampToValueAtTime(Math.max(40, spec.filter.f1), t0 + spec.dur);
      bq.Q.value = spec.filter.q || 1;
      gain.connect(bq);
      bq.connect(masterGain);
      track(1);
      setTimeout(() => { try { bq.disconnect(); track(-1); } catch (e) { /* noop */ } }, (spec.dur + 0.4) * 1000);
      dest = bq;
    } else {
      gain.connect(masterGain);
    }
    let src;
    if (spec.type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = spec.noise === 'brown' ? noiseBrown : noiseWhite;
      src.loop = false;
      src.connect(gain);
    } else {
      src = ctx.createOscillator();
      src.type = spec.wave || 'sine';
      src.frequency.setValueAtTime(spec.f0, t0);
      if (spec.f1 !== spec.f0) src.frequency.exponentialRampToValueAtTime(Math.max(30, spec.f1), t0 + spec.dur);
      src.connect(gain);
    }
    track(2);                                   // gain + src
    src.onended = () => {
      try { src.disconnect(); } catch (e) { /* noop */ }
      try { gain.disconnect(); } catch (e) { /* noop */ }
      track(-2);
      if (onEnded) onEnded();
    };
    if (src.start) src.start(t0);
    if (src.stop) src.stop(t0 + spec.dur + 0.02);
    // ── 泛音列（音色核心）─────────────────────────────────────────────────
    // 每条泛音有自己的增益包络，衰减普遍比基频快（durScale<1）——这正是八音盒「叮」和
    // 木琴「咚」的区别来源。噪声类没有泛音概念，直接跳过。
    if (spec.type !== 'noise' && spec.partials && spec.partials.length) {
      spec.partials.forEach((pt) => {
        const ratio = pt.ratio || 2;
        const pDur = Math.max(0.05, spec.dur * (pt.durScale || 1));
        const pVol = Math.max(0.0002, vol * (pt.gain || 0.2));
        const pg = ctx.createGain();
        pg.gain.setValueAtTime(0.0001, t0);
        pg.gain.exponentialRampToValueAtTime(pVol, t0 + Math.max(0.002, (spec.attack || 0.003) * 0.5));
        pg.gain.exponentialRampToValueAtTime(0.0001, t0 + pDur);
        const po = ctx.createOscillator();
        po.type = spec.wave || 'sine';
        po.frequency.setValueAtTime(Math.max(20, spec.f0 * ratio), t0);
        if (spec.f1 !== spec.f0) {
          po.frequency.exponentialRampToValueAtTime(Math.max(20, spec.f1 * ratio), t0 + pDur);
        }
        po.connect(pg);
        pg.connect(dest);
        track(2);
        po.onended = () => {
          try { po.disconnect(); } catch (e) { /* noop */ }
          try { pg.disconnect(); } catch (e) { /* noop */ }
          track(-2);
        };
        po.start(t0);
        po.stop(t0 + pDur + 0.02);
      });
    }
    return true;
  }

  /**
   * 琶音型（目前只有 `combo` 用）：上行三音错位起播 + 高频 shimmer。
   * 规格 3.1 要求它是「全场唯一高亮度音色」，所以走 sine/triangle 泛音少、
   * 高频 shimmer 加持；gain 上限已按 −2dB 换算，只低于盖章音。
   */
  /**
   * 把当前「声音风格」套到一条配方上：乐音类换波形 + 泛音列 + 起音/衰减缩放 + 亮度；
   * 噪声类换不了波形，就只缩放滤波频率（亮度）与增益。
   * 返回拷贝，绝不改写共享的 AUDIO_SFX_RECIPES（overlay 也单独套，避免污染原表）。
   *
   * 为什么不是「只换 wave」：早先 warm/musicbox/ocarina 里后两者都是 sine，
   * 只有 5% 音量差 —— 用户实测「选 3 个声音没区别」。音色必须靠**泛音结构 + 包络**区分，
   * 波形只是其中一维（见 SOUND_THEMES 每条注释）。
   */
  function scaleFilter(f, k) {
    const lo = 40, hi = 16000;
    return {
      type: f.type,
      f0: Math.max(lo, Math.min(hi, f.f0 * k)),
      f1: Math.max(lo, Math.min(hi, f.f1 * k)),
      q: f.q,
    };
  }

  function applyTheme(r) {
    if (!theme || !r) return r;
    const out = Object.assign({}, r);
    const tg = theme.gain != null ? theme.gain : 1;
    const bright = theme.bright || 1;
    if (r.type === 'tone' || r.type === 'arp') {
      out.wave = theme.wave || r.wave;
      out.gain = (r.gain || 0.2) * tg;
      out.attack = Math.max((r.attack || 0.003) * (theme.attack || 1), theme.minAttack || 0);
      if (r.dur) out.dur = r.dur * (theme.dur || 1);
      if (r.noteDur) out.noteDur = r.noteDur * (theme.dur || 1);
      if (theme.partials) out.partials = theme.partials;
      if (r.filter) out.filter = scaleFilter(r.filter, bright);
      else if (theme.toneLowpass) out.filter = { type: 'lowpass', f0: theme.toneLowpass, f1: theme.toneLowpass, q: 0.7 };
    } else if (r.type === 'noise') {
      out.gain = (r.gain || 0.2) * tg;
      if (r.filter) out.filter = scaleFilter(r.filter, bright);
    }
    return out;
  }

  function playArp(r, opts) {
    sfxLive++;
    const volScale = opts && opts.score != null ? Math.min(1.4, 0.5 + opts.score / 8) : 1;
    const t0 = ctx.currentTime + 0.001;
    const step = r.step || 0.08;
    const notes = r.notes || [];
    let done = 0;
    const total = notes.length + (r.shimmer ? r.shimmer.length : 0);
    const oneDown = () => {
      done++;
      if (done >= total) sfxLive = Math.max(0, sfxLive - 1);
    };
    notes.forEach((f, i) => {
      startVoice({ type: 'tone', wave: r.wave || 'triangle', f0: f, f1: f, dur: r.noteDur || 0.45,
        gain: r.gain || 0.2, attack: r.attack || 0.008,
        filter: r.filter || null, partials: r.partials || null }, t0 + i * step, volScale, oneDown);
    });
    if (r.shimmer) {
      r.shimmer.forEach((f, i) => {
        // 随机相位：不用固定起播点，避免三个泛音叠成一条死板的「和弦柱」
        startVoice({ type: 'tone', wave: 'sine', f0: f, f1: f, dur: r.shimmerDur || 0.3,
          gain: r.shimmerGain || 0.04, attack: 0.004 }, t0 + (r.shimmerDelay || 0.02) + i * 0.055, 1, oneDown);
      });
    }
    return true;
  }

  function playRecipe(id, opts) {
    const r = AUDIO_SFX_RECIPES[id];
    if (!r || !ctx || !enabled) return false;
    if (sfxLive >= AUDIO_MAX_SFX || nodeCount > AUDIO_NODE_BUDGET - 3) return false;
    if (r.type === 'arp') return playArp(applyTheme(r), opts);
    const t0 = ctx.currentTime + 0.001;
    const volScale = opts && opts.score != null ? Math.min(1.4, 0.5 + opts.score / 8) : 1;
    sfxLive++;
    startVoice(applyTheme(r), t0, volScale, () => { sfxLive = Math.max(0, sfxLive - 1); });
    // 副声部（`overlay`）：与主声部同时起，给音效补「实体感 / 尾巴」，
    // 例如 chapter 的翻页噪声 + 低频落地、fall 的下滑音 + 噪声尾。
    if (r.overlay) startVoice(applyTheme(r.overlay), t0 + (r.overlayDelay || 0), volScale, null);
    return true;
  }

  function flushQueue() {
    while (queue.length) {
      const item = queue.shift();
      if (audioNow() - item.at <= AUDIO_QUEUE_TTL_MS) playRecipe(item.id, item.opts);
    }
  }

  function scheduleBgm() {
    if (!ctx || !enabled || !bgmGain) return;
    const scale = AUDIO_MODE_SCALES[modeId] || AUDIO_MODE_SCALES[0];
    const bgm = (theme && theme.bgm) || { wave: 'sine', gain: 1, decay: 0.9 };
    const now = ctx.currentTime;
    if (bgmNextNoteTime < now) bgmNextNoteTime = now + 0.05;   // 切回前台对齐，不补发
    while (bgmNextNoteTime < now + AUDIO_LOOKAHEAD_MS / 1000) {
      const t = bgmNextNoteTime;
      const deg = scale[bgmStep % scale.length];
      const oct = bgmStep % 8 === 0 ? 12 : 0;
      const hz = rootHz * Math.pow(2, (deg + oct) / 12);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = bgm.wave || 'sine';
      osc.frequency.value = hz;
      const dur = bgm.decay || 0.9;
      const peak = 0.09 * (bgm.gain != null ? bgm.gain : 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + (bgm.attack || 0.18));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(bgmGain);
      // 八音盒的 BGM 也挂一条高泛音，否则切主题只有音效变了、背景还是同一副嗓子
      if (bgm.partial) {
        const po = ctx.createOscillator();
        const pg = ctx.createGain();
        po.type = bgm.wave || 'sine';
        po.frequency.value = hz * (bgm.partial.ratio || 3);
        pg.gain.setValueAtTime(0.0001, t);
        pg.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * (bgm.partial.gain || 0.15)), t + 0.01);
        pg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.5);
        po.connect(pg);
        pg.connect(bgmGain);
        po.start(t);
        po.stop(t + dur * 0.5 + 0.02);
        po.onended = () => { try { po.disconnect(); pg.disconnect(); } catch (e) { /* noop */ } };
      }
      osc.start(t);
      osc.stop(t + dur + 0.02);
      osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
      bgmStep++;
      bgmNextNoteTime += 0.62;
    }
  }

  function startBgm() {
    if (bgmTimer || !ctx) return;
    bgmNextNoteTime = ctx.currentTime + 0.1;
    bgmTimer = setInterval(scheduleBgm, AUDIO_SCHED_INTERVAL_MS);
  }

  const api = {
    /** 契约：唯一解锁点。必须在首次 pointerdown 的同步路径里调一次。 */
    unlockMedia() {
      if (unlocked) return true;
      const c = ensureCtx();
      if (!c) return false;
      unlocked = true;
      unlockAt = audioNow();
      // iOS：必须同时做 resume + 一次静音语音，缺一不可
      try { c.resume && c.resume(); } catch (e) { /* iOS 可能拒绝，保持 suspended，下次手势再试 */ }
      try {
        if (typeof speechSynthesis !== 'undefined') {
          const u = new SpeechSynthesisUtterance('');
          u.volume = 0;
          speechSynthesis.speak(u);
        }
      } catch (e) { /* 忽略 */ }
      voiceState.unlockedVoice = true;
      flushQueue();
      startBgm();
      return true;
    },

    /** 契约：play(sfxId, opts)。未解锁前只排 pendown/spawn，≤3 条，1.5s 过期。 */
    play(sfxId, opts) {
      if (!AUDIO_SFX_RECIPES[sfxId]) return false;
      if (!unlocked) {
        if (sfxId !== 'pendown' && sfxId !== 'spawn') return false;
        if (queue.length >= AUDIO_QUEUE_MAX) return false;
        queue.push({ id: sfxId, opts, at: audioNow() });
        return false;
      }
      if (!enabled) return false;
      return playRecipe(sfxId, opts);
    },

    /**
     * 契约：speak(lineId, text, opts) → C.1c 六态字符串（**不是 boolean**）。
     * opts = { speaker?, level?, textMs? }
     *   · speaker   用于 C4 同音色 45s 间隔
     *   · level     C.1b 级别（1 成功/盖章 2 受额度约束 3 开场 4 环境）
     *
     * 返回值：
     *   'queued'      已进队列 / 已交给后端（未确认出声、未扣额度）
     *   'deferred'    被 C4 同音色间隔延后，到点自动起播，未扣
     *   'blocked'     被 C5 拦下并挂起（说话人未入画），未扣
     *   'dropped'     额度耗尽 / 队列满 / 超时 / 未声明 id → 丢弃，未扣
     *   'muted'       绘制中静默，或用户关掉了朗读 → 只出文字
     *   'unavailable' 无中文语音引擎（bubble 模式）或尚未解锁
     * **永远不返回「已播」**：onstart 是异步的，同步说"播了"是假信息。
     * 上层据此只决定"要不要额外做点什么"；气泡无论如何都会出（文字是信息通道）。
     */
    speak(lineId, text, opts) {
      const o2 = opts || {};
      if (!lineId && !text) return 'dropped';
      if (drawing) return 'muted';                     // 绘制期间任何语音都不许起播（硬规则）
      if (!voiceCfg.on) return 'muted';                // 用户关掉了朗读 → 只走字幕，不占调度器
      if (!unlocked) return 'unavailable';             // 不进队列：延迟台词比不播更糟
      if (voiceState.available == null || !voiceState.available) probeVoices();
      if (!voiceState.available) return 'unavailable'; // 无中文语音 → 上层走气泡，绝不用英文念中文
      if (typeof speechSynthesis === 'undefined') return 'unavailable';
      return voiceScheduler.request({
        lineId: lineId || text,
        text: text || lineId,
        speaker: o2.speaker || 'narrator',
        level: o2.level == null ? LINE_LEVEL.AMBIENT : o2.level,
        textMs: o2.textMs,
      });
    },

    /** C.1b 抢占（尚未起播）：不扣额度 */
    dropPendingLine(lineId) { return voiceScheduler.dropPending(lineId); },
    /** C.1b 终止（已起播）：额度不退；只在语义过期时用 */
    abortSpeaking(reason) { return voiceScheduler.abortSpeaking(reason); },
    /** 场景边界（切关 / 说话人离场）：先抢占再终止 */
    onSceneBoundary(reason) { return voiceScheduler.onSceneBoundary(reason); },
    /** 主循环推进挂起/延后（每帧调一次即可，内部幂等） */
    tickVoice() { voiceScheduler.tick(); },
    /** 只读：语音额度与队列快照（诊断 / 单测） */
    get voiceStateSnapshot() { return voiceScheduler.state; },
    /** 主程序注入 C5 前置条件与 C.1 第 2 步的只读预检（音频层不认识关卡） */
    setVoiceHooks(h) {
      if (h && typeof h.isOnScreen === 'function') voiceHooks.isOnScreen = h.isOnScreen;
      if (h && typeof h.precheckQuota === 'function') voiceHooks.precheckQuota = h.precheckQuota;
    },

    /** 契约：总开关。用 suspend/resume，保图，不重建。 */
    setEnabled(on) {
      enabled = !!on;
      if (!ctx) return;
      try {
        if (enabled) { if (ctx.state === 'suspended' && unlocked) ctx.resume(); }
        else ctx.suspend();
      } catch (e) { /* iOS 可能拒绝，保持原状 */ }
      if (masterGain) masterGain.gain.value = enabled ? 1 : 0;
    },

    /** 契约：章节转调唯一入口（换根音 + 重选音阶）。modeId 是数字：0=宫 1=羽 */
    setKey(hz, m) {
      rootHz = Number.isFinite(hz) ? hz : rootHz;
      if (Number.isFinite(m)) modeId = m | 0;
    },

    /**
     * 切换声音风格（用户选择）：warm / musicbox / ocarina，持久化到 localStorage
     */
    setTheme(id) {
      if (!SOUND_THEMES[id]) return;
      currentThemeId = id;
      theme = SOUND_THEMES[id];
      try { if (typeof localStorage !== 'undefined') localStorage.setItem('wcwz_sound_theme', id); } catch (e) { /* 忽略 */ }
    },

    // ── 语音（TTS）对外接口：音色选择 / 朗读开关 / 试听 ────────────────────────

    /** 重新探测系统音色（打开「关于」面板时调一次，补齐延迟加载的音色） */
    refreshVoices() { probeVoices(); return voiceState.voices.length; },

    /** 可选音色列表（顺序＝推荐顺序，第一个是自动挑出的默认） */
    get voiceList() {
      if (!voiceState.voices.length) probeVoices();
      return (voiceState.voices || []).map((v) => ({
        uri: v.voiceURI, name: shortVoiceName(v.name), lang: v.lang,
      }));
    },

    /** 当前语音配置（给 UI 画状态；name 已压缩成短名） */
    get voiceConfig() {
      const cur = currentVoice();
      return { on: voiceCfg.on, uri: voiceCfg.uri, name: cur ? shortVoiceName(cur.name) : '' };
    },

    /** 朗读开关：关掉后 speak() 直接返回 false，台词只走字幕 */
    setVoiceOn(on) {
      voiceCfg.on = !!on;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(VOICE_ON_KEY, voiceCfg.on ? '1' : '0'); } catch (e) { /* 忽略 */ }
      voiceState.mode = voiceState.available ? (voiceCfg.on ? 'voice' : 'off') : 'bubble';
      // 关掉时掐断正在念的那句——走 voiceBackend.cancel() 这个唯一出口（不许各处自己 cancel）
      if (!voiceCfg.on) voiceBackend.cancel();
      return voiceCfg.on;
    },

    /** 换上一个/下一个音色，返回新的短名（列表不足 2 个时返回空串＝没得换） */
    cycleVoice(dir) {
      const list = voiceState.voices || [];
      if (list.length < 2) return '';
      let i = 0;
      for (let k = 0; k < list.length; k++) if (list[k].voiceURI === voiceCfg.uri) { i = k; break; }
      const n = (i + (dir < 0 ? -1 : 1) + list.length) % list.length;
      voiceCfg.uri = list[n].voiceURI;
      voiceState.voiceLang = list[n].lang || voiceState.voiceLang;
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(VOICE_URI_KEY, voiceCfg.uri); } catch (e) { /* 忽略 */ }
      return shortVoiceName(list[n].name);
    },

    /**
     * 试听：**绕过 scheduler**。这是用户主动点出来的声音，不该排队、不该被额度或
     * 「绘制中静默」拦下——点了没反应会被当成功能坏了。
     */
    previewVoice(text) {
      if (typeof speechSynthesis === 'undefined') return false;
      if (!voiceState.voices.length) probeVoices();
      const v = currentVoice();
      if (!v) return false;
      try {
        voiceBackend.cancel();   // 同上：取消只走这一个出口
        const u = new SpeechSynthesisUtterance(text || VOICE_TRY);
        u.voice = v;
        u.lang = v.lang || 'zh-CN';
        u.rate = voiceCfg.rate;
        u.pitch = voiceCfg.pitch;
        u.volume = 0.95;
        speechSynthesis.speak(u);
        return true;
      } catch (e) { return false; }
    },

    /** P1：setVolume(bus, v) */
    setVolume(bus, v) {
      if (!ctx) return;
      const target = bus === 'bgm' ? bgmGain : masterGain;
      if (target) target.gain.value = Math.max(0, Math.min(1, v));
    },

    /** 输入层告诉音频：正在绘制（语音静默） */
    setDrawing(on) { drawing = !!on; },

    get unlocked() { return unlocked; },
    get unlockAt() { return unlockAt; },
    get soundTheme() { return currentThemeId; },
    get voiceMode() {
      if (voiceState.available == null) probeVoices();
      if (!voiceState.available) return 'bubble';
      return voiceCfg.on ? 'voice' : 'off';   // off = 有音色但用户主动关掉了朗读
    },
    get state() { return ctx ? ctx.state : 'none'; },
    get nodeCount() { return nodeCount; },
    get sfxLive() { return sfxLive; },
  };

  // visibilitychange 由音频侧单独处理（其他模块不许碰 ctx.suspend/resume）
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      try {
        if (document.hidden) { if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = 0; } }
        else if (enabled && unlocked) { ctx.resume(); bgmNextNoteTime = 0; startBgm(); }
      } catch (e) { /* 忽略 */ }
    });
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) {
      speechSynthesis.addEventListener('voiceschanged', probeVoices);
    }
  }

  return api;
}

/** 单例：游戏层只拿这一个，禁止自行 new AudioContext */
export const AudioBus = createAudioBus();
