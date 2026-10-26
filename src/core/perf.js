/**
 * src/core/perf.js —— 性能降级三件套（QA 会按名 grep，名字不许改）
 *
 * PerfGovernor.sample(dtMs) / setTier(tier) / tier
 * RenderQuality.setFill(bool) / setShadow(bool) / fill / shadow
 * Boot.skipIntro()
 *
 * 阈值与基线逐字对齐：
 *   · 物理耗时 > 6.0ms 连续 30 帧 → 降一级
 *   · 帧间隔 p90 > 16.7ms 连续 120 帧 → 降一级
 *   · 降级顺序 high → mid → low，不自动升（升档会抖动）
 * Safari / 移动端默认 mid（不填 hachure、不投影），DPR 硬 cap 2。
 */

export const PERF_PHYSICS_BUDGET_MS = 6.0;
export const PERF_DOWNGRADE_FRAMES = 30;
export const PERF_P90_BUDGET_MS = 16.7;
export const PERF_P90_FRAMES = 120;
export const RENDER_DPR_CAP = 2;

const PERF_TIERS = ['low', 'mid', 'high'];

function perfTierIndex(t) {
  const i = PERF_TIERS.indexOf(t);
  return i < 0 ? 1 : i;
}

export function isSafariLike() {
  try {
    const ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg/.test(ua);
  } catch (e) {
    return false;
  }
}

export const RenderQuality = {
  fill: true,
  shadow: false,
  hachure: true,
  tier: 'mid',
  /** 契约：RenderQuality.setFill(bool) */
  setFill(on) { this.fill = !!on; },
  /** 契约：RenderQuality.setShadow(bool) */
  setShadow(on) { this.shadow = !!on; },
  applyTier(tier) {
    this.tier = tier;
    if (tier === 'high') { this.fill = true; this.shadow = true; this.hachure = true; }
    else if (tier === 'mid') { this.fill = true; this.shadow = false; this.hachure = false; }
    else { this.fill = false; this.shadow = false; this.hachure = false; }
  },
};

export const PerfGovernor = {
  tier: 'mid',
  slowFrames: 0,
  p90Frames: 0,
  window: [],
  stats: { p90: 0, physMs: 0, degraded: 0 },
  onChange: null,

  init(tier) {
    const start = tier || (isSafariLike() ? 'mid' : 'high');
    this.tier = start;
    RenderQuality.applyTier(start);
    return start;
  },

  /** 契约：PerfGovernor.sample(dtMs)。physMs 可选（物理步耗时） */
  sample(dtMs, physMs) {
    this.window.push(dtMs);
    if (this.window.length > PERF_P90_FRAMES) this.window.shift();
    if (dtMs > PERF_P90_BUDGET_MS) this.p90Frames++; else this.p90Frames = 0;
    if (physMs != null && physMs > PERF_PHYSICS_BUDGET_MS) this.slowFrames++; else this.slowFrames = 0;
    if (this.window.length >= 30) {
      const sorted = this.window.slice().sort((a, b) => a - b);
      this.stats.p90 = sorted[Math.floor(sorted.length * 0.9)];
    }
    this.stats.physMs = physMs == null ? this.stats.physMs : physMs;
    if (this.p90Frames >= PERF_P90_FRAMES || this.slowFrames >= PERF_DOWNGRADE_FRAMES) this.downgrade();
  },

  /** 契约：PerfGovernor.setTier(tier) */
  setTier(tier) {
    if (perfTierIndex(tier) === perfTierIndex(this.tier)) return;
    this.tier = tier;
    RenderQuality.applyTier(tier);
    if (this.onChange) this.onChange(tier);
  },

  downgrade() {
    const i = perfTierIndex(this.tier);
    this.slowFrames = 0;
    this.p90Frames = 0;
    this.window.length = 0;
    if (i <= 0) return;
    this.stats.degraded++;
    this.setTier(PERF_TIERS[i - 1]);
  },
};

/** 启动闸门：?skipIntro=1 或 Boot.skipIntro() 可跳过开场，直接进关（自测与调试用） */
export const Boot = {
  introSkipped: false,
  /** 契约：Boot.skipIntro() */
  skipIntro() { this.introSkipped = true; return true; },
  wantsSkipFromQuery() {
    try { return /(^|[?&])skipIntro=1/.test(location.search); } catch (e) { return false; }
  },
};
