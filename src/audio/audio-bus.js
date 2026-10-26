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

const AUDIO_MAX_SFX = 8;
const AUDIO_NODE_BUDGET = 40;
const AUDIO_QUEUE_MAX = 3;
const AUDIO_QUEUE_TTL_MS = 1500;
const AUDIO_LOOKAHEAD_MS = 120;
const AUDIO_SCHED_INTERVAL_MS = 25;
const AUDIO_BGM_GAIN = 0.16;

/** 6 个 P0 音效配方（噪声源 | 振荡器 | 滤波 | 包络 | 时长），全部 [待实机标定] */
const AUDIO_SFX_RECIPES = {
  pendown: { type: 'noise', noise: 'white', dur: 0.09, gain: 0.30, filter: { type: 'bandpass', f0: 2600, f1: 1400, q: 1.1 }, attack: 0.002 },
  spawn: { type: 'tone', wave: 'triangle', f0: 220, f1: 132, dur: 0.34, gain: 0.24, attack: 0.006, filter: { type: 'lowpass', f0: 1800, f1: 500, q: 0.8 } },
  ability: { type: 'tone', wave: 'sine', f0: 660, f1: 990, dur: 0.18, gain: 0.18, attack: 0.004 },
  win: { type: 'tone', wave: 'triangle', f0: 523.25, f1: 783.99, dur: 0.55, gain: 0.22, attack: 0.008 },
  fail: { type: 'tone', wave: 'sawtooth', f0: 196, f1: 98, dur: 0.40, gain: 0.16, attack: 0.004, filter: { type: 'lowpass', f0: 900, f1: 300, q: 1.2 } },
  stamp: { type: 'noise', noise: 'brown', dur: 0.20, gain: 0.34, filter: { type: 'lowpass', f0: 900, f1: 180, q: 0.7 }, attack: 0.001 },
  collide: { type: 'noise', noise: 'brown', dur: 0.12, gain: 0.20, filter: { type: 'lowpass', f0: 700, f1: 200, q: 0.9 }, attack: 0.001 },
  ui: { type: 'tone', wave: 'square', f0: 440, f1: 440, dur: 0.05, gain: 0.10, attack: 0.002 },
};

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
  const voiceState = { available: null, mode: 'unknown', unlockedVoice: false };

  // ---- 语音可用性判据：存在 zh-* 才算可用（只有 en-US 时必须走气泡）----
  function probeVoices() {
    if (typeof speechSynthesis === 'undefined') { voiceState.available = false; return false; }
    let list = [];
    try { list = speechSynthesis.getVoices() || []; } catch (e) { list = []; }
    const zh = list.filter((v) => /^zh/i.test(v.lang || ''));
    voiceState.available = zh.length > 0;
    voiceState.mode = zh.length > 0 ? 'voice' : 'bubble';
    if (zh.length) voiceState.voiceLang = zh[0].lang;
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

  function playRecipe(id, opts) {
    const r = AUDIO_SFX_RECIPES[id];
    if (!r || !ctx || !enabled) return false;
    if (sfxLive >= AUDIO_MAX_SFX || nodeCount > AUDIO_NODE_BUDGET - 3) return false;
    const t0 = ctx.currentTime + 0.001;
    const gain = ctx.createGain();
    const vol = Math.max(0, Math.min(1, (r.gain || 0.2) * (opts && opts.score != null ? Math.min(1.4, 0.5 + opts.score / 8) : 1)));
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + (r.attack || 0.003));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + r.dur);
    let tail = gain;
    if (r.filter) {
      const bq = ctx.createBiquadFilter();
      bq.type = r.filter.type || 'lowpass';
      bq.frequency.setValueAtTime(r.filter.f0, t0);
      bq.frequency.exponentialRampToValueAtTime(Math.max(40, r.filter.f1), t0 + r.dur);
      bq.Q.value = r.filter.q || 1;
      gain.connect(bq);
      bq.connect(masterGain);
      tail = bq;
      track(1);
      bq.addEventListener && bq.addEventListener('ended', () => {});
      setTimeout(() => { try { bq.disconnect(); track(-1); } catch (e) { /* noop */ } }, (r.dur + 0.4) * 1000);
    } else {
      gain.connect(masterGain);
    }
    sfxLive++;
    track(1);
    let src;
    if (r.type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = r.noise === 'brown' ? noiseBrown : noiseWhite;
      src.loop = false;
      src.connect(gain);
    } else {
      src = ctx.createOscillator();
      src.type = r.wave || 'sine';
      src.frequency.setValueAtTime(r.f0, t0);
      if (r.f1 !== r.f0) src.frequency.exponentialRampToValueAtTime(Math.max(30, r.f1), t0 + r.dur);
      src.connect(gain);
    }
    track(1);
    src.onended = () => {
      sfxLive = Math.max(0, sfxLive - 1);
      try { src.disconnect(); } catch (e) { /* noop */ }
      try { gain.disconnect(); } catch (e) { /* noop */ }
      track(-2);
      if (tail === gain) { /* 滤波器已在 setTimeout 里回收 */ }
    };
    const stopAt = t0 + r.dur + 0.02;
    if (src.start) src.start(t0);
    if (src.stop) src.stop(stopAt);
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
    const now = ctx.currentTime;
    if (bgmNextNoteTime < now) bgmNextNoteTime = now + 0.05;   // 切回前台对齐，不补发
    while (bgmNextNoteTime < now + AUDIO_LOOKAHEAD_MS / 1000) {
      const t = bgmNextNoteTime;
      const deg = scale[bgmStep % scale.length];
      const oct = bgmStep % 8 === 0 ? 12 : 0;
      const hz = rootHz * Math.pow(2, (deg + oct) / 12);
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const dur = 0.9;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      g.connect(bgmGain);
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

    /** 契约：speak(lineId)。zh-* 不可用 / 绘制中 / 未解锁 都不出声。 */
    speak(lineId, text) {
      if (!lineId && !text) return false;
      if (drawing) return false;                       // 绘制期间任何语音都不许起播（硬规则）
      if (!unlocked) return false;                     // 不进队列：延迟台词比不播更糟
      if (voiceState.available == null) probeVoices();
      if (!voiceState.available) return false;         // 无中文语音 → 上层走气泡，绝不用英文念中文
      if (typeof speechSynthesis === 'undefined') return false;
      try {
        const u = new SpeechSynthesisUtterance(text || lineId);
        u.lang = voiceState.voiceLang || 'zh-CN';
        u.volume = 1;
        u.rate = 0.98;
        speechSynthesis.speak(u);
        return true;
      } catch (e) {
        return false;
      }
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
    get voiceMode() { if (voiceState.available == null) probeVoices(); return voiceState.mode; },
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
