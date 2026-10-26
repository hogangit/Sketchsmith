(function(){"use strict";
/* src/core/config.js */
/**
 * src/core/config.js —— 版式与设计分辨率常量
 * 坐标系统：全部逻辑计算在 430×932 的设计空间里进行（美术尺寸无关），
 * 渲染时统一缩放到实际视口。世界（物理区）在上，造物簿（绘制区）在下。
 */
const DESIGN_W = 430;
const DESIGN_H = 932;

/** 造物簿上沿 = 屏幕下半 45%（levels.md 第八节硬指标 / tech-baseline K9） */
const BOOK_TOP = 513;
const BOOK_H = DESIGN_H - BOOK_TOP; // 419 px = 44.96%

/** 物理世界可视高度：造物簿以上的部分 */
const WORLD_H = BOOK_TOP;

/** 造物从天上落下来的高度（设计 px） */
const SPAWN_Y = 84;

const APP_VERSION = '0.2.0';
;
/* src/core/bus.js */
/**
 * src/core/bus.js —— 事件总线
 *
 * 能力钩子、音频、HUD 都挂在总线上。**handler 真被调用的次数要能读出来**：
 * 只 connect 不计数等于没验证过（见 tests 目录里的计数断言用例）。
 */
function createBus() {
  /** @type {Map<string, Array<{fn:Function, tag:string}>>} */
  const handlers = new Map();
  const emitted = Object.create(null);
  const handled = Object.create(null);

  function on(ev, fn, tag) {
    if (typeof fn !== 'function') throw new TypeError(`bus.on(${ev}) 需要函数`);
    if (!handlers.has(ev)) handlers.set(ev, []);
    handlers.get(ev).push({ fn, tag: tag || ev });
    return () => off(ev, fn);
  }

  function off(ev, fn) {
    const list = handlers.get(ev);
    if (!list) return;
    const i = list.findIndex((h) => h.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(ev, payload) {
    emitted[ev] = (emitted[ev] || 0) + 1;
    const list = handlers.get(ev);
    if (!list) return 0;
    let n = 0;
    for (const h of list.slice()) {
      try {
        h.fn(payload, ev);
        handled[h.tag] = (handled[h.tag] || 0) + 1;
        n++;
      } catch (err) {
        if (typeof console !== 'undefined') console.warn(`[bus] handler 抛错 @${ev}:`, err);
      }
    }
    return n;
  }

  return {
    on,
    off,
    emit,
    get emitted() { return emitted; },
    get handled() { return handled; },
    countOf(tag) { return handled[tag] || 0; },
    emitCount(ev) { return emitted[ev] || 0; },
  };
}
;
/* src/core/perf.js */
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

const PERF_PHYSICS_BUDGET_MS = 6.0;
const PERF_DOWNGRADE_FRAMES = 30;
const PERF_P90_BUDGET_MS = 16.7;
const PERF_P90_FRAMES = 120;
const RENDER_DPR_CAP = 2;

const PERF_TIERS = ['low', 'mid', 'high'];

function perfTierIndex(t) {
  const i = PERF_TIERS.indexOf(t);
  return i < 0 ? 1 : i;
}

function isSafariLike() {
  try {
    const ua = navigator.userAgent || '';
    return /Safari/.test(ua) && !/Chrome|CriOS|Chromium|Edg/.test(ua);
  } catch (e) {
    return false;
  }
}

const RenderQuality = {
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

const PerfGovernor = {
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
const Boot = {
  introSkipped: false,
  /** 契约：Boot.skipIntro() */
  skipIntro() { this.introSkipped = true; return true; },
  wantsSkipFromQuery() {
    try { return /(^|[?&])skipIntro=1/.test(location.search); } catch (e) { return false; }
  },
};
;
/* src/core/storage.js */
/**
 * src/core/storage.js —— 存档抽象层（SaveStore）的**契约**部分，零平台 API。
 *
 * 铁律：localStorage / 平台存储的直接触碰只允许存在于 `src/platform/local-storage-save-store.js`
 * 一个文件里。core / UI 只依赖 `SaveStore` 的四个方法，不 import 任何实现类。
 * 组合根（src/main.js）负责把实现注入进来 —— 换引擎/换平台只改那一个文件。
 *
 * 接口契约：
 *   read<T>(key)  → T | null   键不存在 / 解析失败一律返回 null，**不抛异常**
 *   write<T>(key, value) → void  序列化或写盘失败**抛错**（让上层决定重试或降级）
 *   list() → string[]          全部逻辑键
 *   migrate(from, to) → void   版本迁移，不丢数据（目标已存在则不覆盖；成功后才删旧键）
 */

const SAVE_SCHEMA_VERSION = 2;
const SAVE_KEY_PROGRESS = 'progress';
const SAVE_KEY_SETTINGS = 'settings';

/**
 * 内存桩：验收用（证明上层只依赖接口），也是 localStorage 不可用时的降级实现。
 * @returns {object} SaveStore
 */
function createMemorySaveStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    read(key) {
      if (!map.has(key)) return null;
      try { return JSON.parse(map.get(key)); } catch (e) { return null; }
    },
    write(key, value) {
      map.set(key, JSON.stringify(value));
    },
    list() { return Array.from(map.keys()); },
    migrate(from, to) {
      if (from === to || !map.has(from) || map.has(to)) return;
      map.set(to, map.get(from));
      map.delete(from);
    },
    _map: map,
  };
}

/** 默认进度（新玩家） */
function defaultProgress() {
  return { schema: SAVE_SCHEMA_VERSION, maxUnlocked: 1, cleared: {}, deaths: 0, seconds: 0 };
}

/**
 * v1 → v2 迁移。v1 的形状是 `{ cleared: <number> }`（通关到第几关），v2 加 schema 与 cleared 明细。
 * 迁移原则：只加字段、不丢信息；幂等（重复跑结果不变）。
 */
function upgradeProgress(raw) {
  if (!raw || typeof raw !== 'object') return defaultProgress();
  const out = defaultProgress();
  if (typeof raw.schema === 'number' && raw.schema >= 2) {
    out.maxUnlocked = Number.isFinite(raw.maxUnlocked) ? raw.maxUnlocked : 1;
    out.cleared = raw.cleared && typeof raw.cleared === 'object' ? raw.cleared : {};
    out.deaths = Number.isFinite(raw.deaths) ? raw.deaths : 0;
    out.seconds = Number.isFinite(raw.seconds) ? raw.seconds : 0;
    return out;
  }
  // v1：cleared 是一个数字，表示已通关的关卡序号
  const legacy = Number.isFinite(raw.cleared) ? raw.cleared : 0;
  out.maxUnlocked = Math.max(1, Math.min(3, legacy + 1));
  for (let i = 1; i <= legacy; i++) out.cleared['ch1-0' + i] = true;
  out.deaths = Number.isFinite(raw.deaths) ? raw.deaths : 0;
  out.seconds = Number.isFinite(raw.seconds) ? raw.seconds : 0;
  return out;
}

/** 读进度（任何异常都降级成默认进度，绝不让存档问题挡住启动） */
function loadProgress(store) {
  const raw = store.read(SAVE_KEY_PROGRESS);
  const upgraded = upgradeProgress(raw);
  if (raw && (!raw.schema || raw.schema < SAVE_SCHEMA_VERSION)) {
    try { store.write(SAVE_KEY_PROGRESS, upgraded); } catch (e) { /* 写不进去也不影响这一局 */ }
  }
  return upgraded;
}

function saveProgress(store, progress) {
  try { store.write(SAVE_KEY_PROGRESS, progress); return true; } catch (e) { return false; }
}
;
/* src/platform/local-storage-save-store.js */
/**
 * src/platform/local-storage-save-store.js —— SaveStore 的**唯一实现**（平台边界 / 排污口）。
 *
 * 这是全仓库唯一允许触碰 localStorage 的文件（core 零 DOM 铁律的唯一合法例外）。
 * 物理键名集中在这里（前缀 + 逻辑键），序列化也集中在这里。
 * file:// 下部分环境会把 localStorage 访问直接抛异常，所以构造时就探测一次，
 * 不可用则整体退化为内存桩 —— 绝不阻塞启动。
 */


const PHYS_PREFIX = 'wcwz:';

function probeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const k = PHYS_PREFIX + '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch (e) {
    return null;
  }
}

function createLocalStorageSaveStore() {
  const ls = probeLocalStorage();
  if (!ls) {
    const mem = createMemorySaveStore();
    mem.persistent = false;
    return mem;
  }
  const phys = (key) => PHYS_PREFIX + key;
  return {
    persistent: true,
    read(key) {
      try {
        const raw = ls.getItem(phys(key));
        if (raw == null) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;              // 契约：解析失败返回 null，不抛
      }
    },
    write(key, value) {
      // 契约：写失败抛错（配额满 / 隐私模式），由上层决定重试或降级
      ls.setItem(phys(key), JSON.stringify(value));
    },
    list() {
      const out = [];
      try {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.indexOf(PHYS_PREFIX) === 0) out.push(k.slice(PHYS_PREFIX.length));
        }
      } catch (e) { /* 忽略 */ }
      return out;
    },
    migrate(from, to) {
      if (from === to) return;
      const exists = ls.getItem(phys(to)) != null;
      if (exists) return;                       // 目标已有数据 → 不覆盖
      const raw = ls.getItem(phys(from));
      if (raw == null) return;
      ls.setItem(phys(to), raw);                // 先写成功
      ls.removeItem(phys(from));                // 再动旧键
    },
  };
}
;
/* src/render/handdrawn.js */
/**
 * src/render/handdrawn.js —— 手绘感渲染原语（rough.js 骨架线 + perfect-freehand 实时笔迹）
 * 只做“把线画出来”，不持有游戏状态。
 */


const ROUGH = typeof rough !== 'undefined' ? rough : null;
const FREEHAND = typeof perfectFreehand !== 'undefined' ? perfectFreehand : null;

let inkSeedCounter = 1;

function nextInkSeed() {
  inkSeedCounter = (inkSeedCounter * 16807) % 2147483647;
  return inkSeedCounter;
}

/** 实时笔迹：perfect-freehand 轮廓 → 填充 */
function drawFreehandStroke(ctx, pts, size) {
  if (!pts || pts.length < 2) return;
  if (FREEHAND && FREEHAND.getStroke) {
    const outline = FREEHAND.getStroke(pts, {
      size: size || 6, thinning: 0.6, smoothing: 0.5, streamline: 0.5, last: true,
    });
    if (!outline || !outline.length) return;
    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      const p = outline[i];
      const n = outline[(i + 1) % outline.length];
      ctx.quadraticCurveTo(p[0], p[1], (p[0] + n[0]) / 2, (p[1] + n[1]) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = '#2c2a26';
    ctx.fill();
    return;
  }
  // 兜底：普通折线
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineWidth = size || 3;
  ctx.strokeStyle = '#2c2a26';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** 造物簿的纸面与格线 */
function drawPaper(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = '#f6f1e3';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(120,108,86,0.18)';
  ctx.lineWidth = 1;
  for (let gy = y + 22; gy < y + h; gy += 22) {
    ctx.beginPath();
    ctx.moveTo(x + 8, gy);
    ctx.lineTo(x + w - 8, gy);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(60,52,40,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

function roughOptions(extra) {
  const base = { roughness: 1.1, bowing: 1.0, stroke: '#3a352c', strokeWidth: 2 };
  if (RenderQuality.fill) base.fill = 'rgba(122,116,96,0.20)';
  if (RenderQuality.shadow) base.fillStyle = 'hachure';
  return Object.assign(base, extra || {});
}

/** 骨干线：任意线（rough.canvas 的渲染器在 letterbox 变换下同样有效） */
function drawRoughLine(rc, x1, y1, x2, y2, extra) {
  if (!rc) return;
  rc.line(x1, y1, x2, y2, roughOptions(extra));
}

function drawRoughRect(rc, x, y, w, h, extra) {
  if (!rc) return;
  rc.rectangle(x, y, w, h, roughOptions(extra));
}

function drawRoughCircle(rc, cx, cy, r, extra) {
  if (!rc) return;
  rc.circle(cx, cy, r * 2, roughOptions(extra));
}

function drawRoughPolygon(rc, pts, extra) {
  if (!rc || !pts || pts.length < 2) return;
  rc.polygon(pts.map((p) => [p.x, p.y]), roughOptions(extra));
}

/** rough 渲染器（按 canvas 建一次） */
function createRoughRenderer(canvasEl) {
  if (!ROUGH || !canvasEl) return null;
  try { return ROUGH.canvas(canvasEl); } catch (e) { return null; }
}
;
/* src/render/canvas.js */
/**
 * src/render/canvas.js —— 画布与坐标（DPR 硬 cap 2、design 430×932 letterbox、静态层缓存）
 * 所有渲染都在 design 坐标系里进行；输入用 toDesign() 反算。
 */




function createCanvasSurface(canvasEl) {
  const ctx = canvasEl.getContext('2d', { alpha: false });
  let dpr = 1;
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let cssW = DESIGN_W;
  let cssH = DESIGN_H;

  function resize() {
    cssW = Math.max(320, Math.floor(window.innerWidth || DESIGN_W));
    cssH = Math.max(400, Math.floor(window.innerHeight || DESIGN_H));
    dpr = Math.min(RENDER_DPR_CAP, Math.max(1, window.devicePixelRatio || 1));
    canvasEl.width = Math.floor(cssW * dpr);
    canvasEl.height = Math.floor(cssH * dpr);
    canvasEl.style.width = cssW + 'px';
    canvasEl.style.height = cssH + 'px';
    scale = Math.min(cssW / DESIGN_W, cssH / DESIGN_H);
    offX = (cssW - DESIGN_W * scale) / 2;
    offY = (cssH - DESIGN_H * scale) / 2;
  }

  function beginFrame(bg) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg || '#efe7d6';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    ctx.save();
  }

  function endFrame() { ctx.restore(); }

  function toDesign(clientX, clientY) {
    const r = canvasEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - offX) / scale,
      y: (clientY - r.top - offY) / scale,
    };
  }

  resize();
  const roughRenderer = createRoughRenderer(canvasEl);

  return {
    canvas: canvasEl,
    ctx,
    rough: roughRenderer,
    resize,
    beginFrame,
    endFrame,
    toDesign,
    get scale() { return scale; },
    get dpr() { return dpr; },
    get cssSize() { return { w: cssW, h: cssH }; },
  };
}

/**
 * 静态层：地形/布景只画一次到离屏画布，之后每帧一次 drawImage。
 * 关卡切换时 invalidate()。
 */
function createStaticLayer() {
  const off = document.createElement('canvas');
  off.width = Math.ceil(DESIGN_W);
  off.height = Math.ceil(DESIGN_H);
  const octx = off.getContext('2d');
  const orc = createRoughRenderer(off);
  let dirty = true;
  return {
    canvas: off,
    ctx: octx,
    rough: orc,
    invalidate() { dirty = true; },
    /** drawFn(octx, orc) 只在 invalidate 之后跑一次 */
    ensure(drawFn) {
      if (!dirty) return false;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, off.width, off.height);
      if (drawFn) drawFn(octx, orc);
      dirty = false;
      return true;
    },
    blit(targetCtx) {
      targetCtx.drawImage(off, 0, 0);
    },
  };
}
;
/* src/render/hud.js */
/**
 * src/render/hud.js —— HUD 与按钮命中（零物理、零平台 API）
 * 包含：关卡标题、芯片面板、失败提示阶梯、对话气泡、过关覆盖层、?debug=1 / ?impactDebug=1。
 */


const HUD_CHIP_W = 88;
const HUD_CHIP_H = 40;
const HUD_CHIP_GAP = 8;
const HUD_CHIP_Y = 92;
const HUD_CHIP_X0 = 20;

const ABILITY_LABELS = {
  harden: '变硬', roll: '会滚', heavy: '变重', light: '变轻',
};

function chipRect(i) {
  return { x: HUD_CHIP_X0 + i * (HUD_CHIP_W + HUD_CHIP_GAP), y: HUD_CHIP_Y, w: HUD_CHIP_W, h: HUD_CHIP_H };
}

function chipIndexAt(x, y) {
  for (let i = 0; i < 4; i++) {
    const r = chipRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

function buttonAt(x, y) {
  if (x > DESIGN_W - 58 && y > 16 && y < 56) return 'audio';
  if (x > DESIGN_W - 118 && x < DESIGN_W - 62 && y > 16 && y < 56) return 'retry';
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHud(ctx, view) {
  const snap = view.snapshot || {};
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---- 标题 ----
  ctx.fillStyle = '#2b2620';
  ctx.font = '600 22px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(snap.title || view.level.title, 20, 44);
  ctx.fillStyle = '#7a6f5e';
  ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('第 ' + (view.levelIndex + 1) + ' 关 / 3　' + (view.level.subtitle || ''), 20, 66);

  // ---- 右上两个按钮 ----
  ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#5d5446';
  ctx.strokeStyle = 'rgba(90,80,64,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, DESIGN_W - 118, 16, 56, 40, 10); ctx.stroke();
  ctx.fillText('重来', DESIGN_W - 104, 41);
  roundRect(ctx, DESIGN_W - 58, 16, 42, 40, 10); ctx.stroke();
  ctx.fillText(view.audioOn ? '声' : '静', DESIGN_W - 44, 41);

  // ---- 芯片 ----
  const chips = snap.chips || view.level.chips || [];
  const armed = snap.armedAbilities || [];
  for (let i = 0; i < chips.length && i < 4; i++) {
    const r = chipRect(i);
    const id = chips[i];
    const on = armed.indexOf(id) >= 0;
    ctx.fillStyle = on ? '#3f6b4f' : 'rgba(246,241,227,0.92)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.strokeStyle = on ? '#2c4a37' : 'rgba(90,80,64,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = on ? '#f4efe2' : '#3a352c';
    ctx.font = '600 16px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(ABILITY_LABELS[id] || id, r.x + 14, r.y + 26);
    if (on) { ctx.font = '11px system-ui'; ctx.fillText('已贴', r.x + 58, r.y + 26); }
  }
  if (snap.chips && snap.chips.length < 4) {
    ctx.fillStyle = 'rgba(90,80,64,0.45)';
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('（本轮只做 4 个能力，其余 20 个未实装）', HUD_CHIP_X0, HUD_CHIP_Y + HUD_CHIP_H + 16);
  }

  // ---- 提示阶梯 ----
  const hints = view.level.failHints || [];
  if (snap.hintLevel > 0 && hints.length) {
    const t = hints[Math.min(hints.length - 1, snap.hintLevel - 1)];
    ctx.fillStyle = 'rgba(120,40,32,0.92)';
    ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    wrapText(ctx, t, 20, 168, DESIGN_W - 40, 18);
  }

  // ---- 对话气泡 ----
  if (view.bubble && view.bubble.until > view.now) {
    const b = view.bubble;
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const text = b.text || '';
    const w = Math.min(DESIGN_W - 40, Math.max(120, ctx.measureText(text).width + 28));
    const x = 20;
    const y = 452;
    ctx.fillStyle = 'rgba(250,246,236,0.96)';
    ctx.strokeStyle = 'rgba(90,80,64,0.5)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, x, y, w, 54, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b6050';
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(b.who || '', x + 14, y + 18);
    ctx.fillStyle = '#2b2620';
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(text, x + 14, y + 39);
    if (view.voiceMode === 'bubble') {
      ctx.fillStyle = 'rgba(120,110,90,0.6)';
      ctx.font = '10px system-ui';
      ctx.fillText('（无中文语音 · 气泡模式）', x + 14, y + 50);
    }
  }

  // ---- 失败闪红 ----
  if (view.failFlash > 0) {
    ctx.fillStyle = 'rgba(178,58,44,' + (0.16 * view.failFlash).toFixed(3) + ')';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  }

  // ---- 过关覆盖层 ----
  if (view.win) {
    ctx.fillStyle = 'rgba(24,22,18,0.55)';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    ctx.fillStyle = '#f7f2e4';
    ctx.font = '700 34px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const title = view.levelIndex >= 2 ? '第一章 · 过完了' : '过关';
    const tw = ctx.measureText(title).width;
    ctx.fillText(title, (DESIGN_W - tw) / 2, 400);
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const sub = view.levelIndex >= 2 ? '点一下重玩第 1 关（本轮只做 3 关）' : '点一下继续';
    const sw = ctx.measureText(sub).width;
    ctx.fillStyle = 'rgba(247,242,228,0.75)';
    ctx.fillText(sub, (DESIGN_W - sw) / 2, 434);
  }

  // ---- 造物簿标题 ----
  ctx.fillStyle = 'rgba(90,80,64,0.7)';
  ctx.font = '12px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('造物簿 · 在这里画', 20, BOOK_TOP + 18);
  if (view.livePoints > 0) {
    ctx.fillStyle = 'rgba(90,80,64,0.9)';
    ctx.fillText('采样 ' + view.livePoints + ' 点', DESIGN_W - 92, BOOK_TOP + 18);
  }

  // ---- ?debug=1 ----
  if (view.debug) {
    const s = snap.creature;
    const lines = [
      'fps ' + view.fps.toFixed(0) + '  frame ' + view.frameMs.toFixed(1) + 'ms  tier ' + view.tier,
      'bodies ' + view.bodyCount + '  strokes ' + view.strokeCount + '  unlocked ' + view.audioUnlocked,
      s ? ('form ' + s.form + '  degraded ' + s.degraded + '  parts ' + s.parts + '  mass ' + s.mass.toFixed(1)) : 'form -',
      s && s.geo ? ('aspect ' + s.geo.aspect.toFixed(2) + '  area ' + s.geo.area.toFixed(0) + '  w/h ' + s.geo.w.toFixed(0) + '/' + s.geo.h.toFixed(0) + '  closed ' + s.geo.closed + '  nodes ' + s.geo.nodes) : 'geo -',
      'abilities [' + (snap.armedAbilities || []).join(',') + ']  combos ' + (s ? s.combos.join('/') : '-'),
      snap.propPos ? ('prop ' + snap.propPos.x.toFixed(0) + ',' + snap.propPos.y.toFixed(0)) : 'prop -',
      snap.plate && snap.plate.length ? ('plate load ' + snap.plate[0].load.toFixed(1) + '/' + snap.plate[0].threshold + '  hold ' + snap.plate[0].holdMs.toFixed(0) + 'ms') : 'plate -',
      'actor ' + (snap.actorPos ? snap.actorPos.x.toFixed(0) + ',' + snap.actorPos.y.toFixed(0) : '-') + '  fails ' + snap.failStreak,
    ];
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = 'rgba(20,18,14,0.78)';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 20, 200 + i * 14);
  }

  // ---- ?impactDebug=1（只报本帧 score 与是否被闸门拦下，不报累计次数）----
  if (view.impactDebug) {
    const d = view.impactDebug;
    ctx.font = '12px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = d.gated ? 'rgba(150,90,20,0.9)' : 'rgba(30,90,50,0.9)';
    ctx.fillText('impact score ' + d.score.toFixed(3) + '  ' + (d.gated ? 'GATED(' + d.reason + ')' : d.reason), 20, 200 + 8 * 14 + 8);
  }

  ctx.restore();
}

function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = String(text).split('');
  let line = '';
  let yy = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}
;
/* src/stroke/thresholds.js */
/**
 * src/stroke/thresholds.js —— 形状判定全部阈值（tech-baseline 第 5 节）
 * 硬规则：阈值只许出现在这里，禁止散落到 classify / body-factory 里。
 * 每个值后面 [待实测标定]，标定后直接改这里。
 */
const SAMPLE_MIN_DIST = 2;        // S2 采样距离 CSS px              [待实测标定]
const STROKE_MAX_POINTS = 400;    // S2 单笔采样上限                  [待实测标定]
const FREEZE_IDLE_MS = 2000;      // S3 静默冻结                       [待实测标定]
const RDP_EPSILON = 1.2;          // S4 RDP 简化容差 px                [待实测标定]
const SIMPLIFY_MAX_NODES = 120;   // S4 简化后节点上限
const CLOSE_TOL_MIN = 8;          // S5 闭合容差下限 px                [待实测标定]
const CLOSE_TOL_RATIO = 0.18;     // S5 闭合容差 = 0.18 × 短边          [待实测标定]
const MIN_STROKE_LENGTH = 8;      // S9 单点/极小拒判长度 px            [待实测标定]
const MIN_STROKE_AREA = 60;       // S9 颗粒面积阈值 px²                [待实测标定]
const ASPECT_WHEEL_MAX = 1.5;     // 轮/团块分界                        [待实测标定]
const ASPECT_BLOB_MAX = 3.0;      // 团块/长闭合分界                    [待实测标定]
const ASPECT_BEAM_MIN = 6.0;      // 梁长宽比阈值                       [待实测标定]
const HOLE_AREA_RATIO = 0.15;     // 容器孔面积比                       [待实测标定]
const DECOMP_MAX_PARTS = 8;       // 拆凸块上限                         [待实测标定]
const SUBMIT_COOLDOWN_MS = 150;   // 提交冷却                            [待实测标定]
const MAX_ABILITIES_PER_CREATURE = 2; // S12 单造物能力上限
const ROPE_JOINT_MAX = 8;         // 绳：最多 8 节
;
/* src/stroke/capture.js */
/**
 * src/stroke/capture.js —— 笔迹采集（输入层，唯一处理 pointer 的地方）
 *
 * 职责：pointerdown → 采样 → pointerup 后把「一组笔画」交给判定管线。
 *   · 采样最小间距 2px、单笔上限 400 点（StrokeBudget 同一上限）
 *   · 只在造物簿区域（design y ≥ BOOK_TOP）落笔有效
 *   · 多笔归组：pointerup 后等 GROUP_WINDOW_MS，期间又落笔就继续归到同一组（拉索/容器要靠两笔）
 *   · 首次 pointerdown 的**同步**路径里调 AudioBus.unlockMedia()（iOS 唯一合法时机）
 *   · 绘制期间 AudioBus.setDrawing(true)，语音静默（硬规则）
 */



const CAPTURE_GROUP_WINDOW_MS = 700;

function createStrokeCapture(opts) {
  const audio = opts.audio;
  const toDesign = opts.toDesign;
  const onGroup = opts.onGroup;
  const bus = opts.bus || { emit() {} };
  const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  const strokes = [];
  let current = null;
  let drawing = false;
  let groupTimer = 0;
  let lastSubmit = -1e9;
  let enabled = true;

  function inBook(p) {
    return p.y >= BOOK_TOP - 6 && p.y <= DESIGN_H && p.x >= 0 && p.x <= DESIGN_W;
  }

  function commitGroup() {
    groupTimer = 0;
    if (!strokes.length) return;
    const group = strokes.slice();
    strokes.length = 0;
    lastSubmit = now();
    bus.emit('stroke:commit', { strokes: group.length, points: group.reduce((n, s) => n + s.pts.length, 0) });
    onGroup(group);
  }

  function scheduleCommit() {
    if (groupTimer) clearTimeout(groupTimer);
    groupTimer = setTimeout(commitGroup, CAPTURE_GROUP_WINDOW_MS);
  }

  function begin(ev) {
    if (!enabled) return;
    // iOS 音频解锁：必须在这个手势的同步路径里
    if (audio) audio.unlockMedia();
    if (now() - lastSubmit < SUBMIT_COOLDOWN_MS) return;
    const p = toDesign(ev.clientX, ev.clientY);
    if (!inBook(p)) return;
    drawing = true;
    if (audio) audio.setDrawing(true);
    current = { pts: [p] };
    strokes.push(current);
    if (audio) audio.play('pendown');
    bus.emit('stroke:begin', { x: p.x, y: p.y });
  }

  function move(ev) {
    if (!drawing || !current) return;
    const p = toDesign(ev.clientX, ev.clientY);
    const last = current.pts[current.pts.length - 1];
    if (!last) return;
    const dx = p.x - last.x;
    const dy = p.y - last.y;
    if (dx * dx + dy * dy < SAMPLE_MIN_DIST * SAMPLE_MIN_DIST) return;
    if (current.pts.length >= STROKE_MAX_POINTS) return;
    current.pts.push(p);
  }

  function end() {
    if (!drawing) return;
    drawing = false;
    if (audio) audio.setDrawing(false);
    if (current && current.pts.length < 2) {
      const i = strokes.indexOf(current);
      if (i >= 0) strokes.splice(i, 1);
    }
    current = null;
    bus.emit('stroke:end', {});
    if (strokes.length) scheduleCommit();
  }

  /** 立刻提交（点「提交」按钮 / 快捷键时用） */
  function flush() {
    if (groupTimer) { clearTimeout(groupTimer); groupTimer = 0; }
    if (!drawing) commitGroup();
  }

  function reset() {
    if (groupTimer) { clearTimeout(groupTimer); groupTimer = 0; }
    strokes.length = 0;
    current = null;
    drawing = false;
  }

  const handlers = {
    down(e) { e.preventDefault(); begin(e); },
    move(e) { if (drawing) { e.preventDefault(); move(e); } },
    up(e) { if (drawing) { e.preventDefault(); end(); } },
    cancel() { if (drawing) end(); },
  };

  return {
    handlers,
    flush,
    reset,
    setEnabled(on) { enabled = !!on; if (!enabled) end(); },
    get drawing() { return drawing; },
    get strokes() { return strokes; },
    get pointCount() { return strokes.reduce((n, s) => n + s.pts.length, 0); },
    /** 实时笔迹（渲染层要画） */
    get live() { return current ? current.pts : null; },
  };
}
;
/* src/stroke/geometry.js */
/**
 * src/stroke/geometry.js —— 纯几何工具（零 DOM，可在 node 里单测）
 * 点一律用 {x, y}；多边形点集用 [{x,y}, ...]（闭合由调用方保证）。
 */
function geoDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function geoPolylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += geoDist(pts[i - 1], pts[i]);
  return s;
}

/** 包围盒；cx/cy 为盒中心 */
function geoBBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0, cx: 0, cy: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** 鞋带公式，返回绝对面积 */
function geoPolygonArea(pts) {
  const n = pts.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** 闭合多边形形心；退化时退化为点均值 */
function geoCentroid(pts, closed) {
  const n = pts.length;
  if (n === 0) return { x: 0, y: 0 };
  if (closed && n >= 3) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const cross = p.x * q.y - q.x * p.y;
      a += cross;
      cx += (p.x + q.x) * cross;
      cy += (p.y + q.y) * cross;
    }
    if (Math.abs(a) > 1e-6) return { x: cx / (3 * a), y: cy / (3 * a) };
  }
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}

/** 射线法判点在多边形内 */
function geoPointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function geoSegmentCross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function geoSegmentsIntersect(p1, p2, p3, p4) {
  const d1 = geoSegmentCross(p3, p4, p1);
  const d2 = geoSegmentCross(p3, p4, p2);
  const d3 = geoSegmentCross(p1, p2, p3);
  const d4 = geoSegmentCross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** S7 自交检测：O(n²)，n ≤ 120。相邻边共享端点，跳过 */
function geoIsSelfIntersecting(pts, closed) {
  const n = pts.length;
  if (n < 4) return false;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a1 = pts[i], a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < last; j++) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      if (j === i + 1) continue;
      if (closed && i === 0 && j === last - 1) continue;
      const b1 = pts[j], b2 = pts[(j + 1) % n];
      if (geoSegmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/** Andrew monotone chain 凸包（K3 第二级退化用） */
function geoConvexHull(points) {
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** 沿折线按段长等分取点（绳/梁分段用） */
function geoResample(pts, segments) {
  const total = geoPolylineLength(pts);
  if (total <= 0 || segments < 1) return pts.slice();
  const step = total / segments;
  const out = [pts[0]];
  let acc = 0, si = 1;
  let cur = pts[0];
  while (out.length <= segments && si < pts.length) {
    const next = pts[si];
    const d = geoDist(cur, next);
    if (acc + d >= step) {
      const t = (step - acc) / (d || 1);
      const p = { x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t };
      out.push(p);
      cur = p;
      acc = 0;
    } else {
      acc += d;
      cur = next;
      si++;
    }
  }
  const tail = pts[pts.length - 1];
  if (geoDist(out[out.length - 1], tail) > 0.5) out.push(tail);
  return out;
}

/** 把一个点集平移到以它的质心为原点 */
function geoToLocal(pts, origin) {
  return pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
}
;
/* src/stroke/simplify.js */
/**
 * src/stroke/simplify.js —— 采样点去重 + RDP 简化（S4）
 */



/** 去掉距离过近的连续点（含采样抽稀后的补处理） */
function dedupePoints(pts, minDist) {
  const d = minDist == null ? 0.5 : minDist;
  const out = [];
  for (const p of pts) {
    if (!out.length || geoDist(out[out.length - 1], p) >= d) out.push(p);
  }
  if (out.length === 1 && pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}

function rdpCore(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  let maxD = -1;
  let idx = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const d = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / len;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdpCore(pts.slice(0, idx + 1), eps);
    const right = rdpCore(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

/** RDP：ε 从阈值起，若节点数仍超上限则放大 ε 重试（保证 n ≤ 120，S7 的 O(n²) 才成立） */
function rdpSimplify(pts, eps) {
  let e = eps == null ? RDP_EPSILON : eps;
  let out = rdpCore(pts, e);
  let guard = 0;
  while (out.length > SIMPLIFY_MAX_NODES && guard++ < 8) {
    e *= 1.6;
    out = rdpCore(pts, e);
  }
  return out;
}
;
/* src/stroke/classify.js */
/**
 * src/stroke/classify.js —— S5 闭合检测 / S6 几何属性 / S7 自交 / S8 形态分类
 * 纯函数，零 DOM、零物理依赖 → node 可直接单测。
 *
 * 附录 A 铁律：任何分支未命中都兜底成 blob（团块）。判错只让玩家多花 30 秒，不会走进死路。
 */




const FORM_LABELS = {
  beam: '梁', wheel: '轮', blob: '团块', container: '容器',
  rope: '绳', pile: '松散堆', grain: '颗粒', dot: '墨点',
};

/** 闭合容差：max(8px, 0.18 × 短边) */
function strokeCloseTolerance(bbox) {
  const shortSide = Math.max(1, Math.min(bbox.w, bbox.h));
  return Math.max(CLOSE_TOL_MIN, CLOSE_TOL_RATIO * shortSide);
}

/** S8 形态判定决策树：顺序即互斥，先命中先出（tech-baseline 第 5 节表 S8-v1.1-FROZEN） */
function classifyForm(g) {
  if (g.strokeCount >= 3 && !g.strokesAdjacent) return 'pile';
  // 序 2 = 绳（rope）。D11 已裁定 v1 不实装绳，整条不写，只留这一行说明；阶段 3 若要启用再补。
  // 序 2b：两笔首尾相连且细长 → 判梁并打接痕（不依赖绳，照实现）
  if (g.strokeCount >= 2 && g.strokesAdjacent && g.aspect > 6) return 'beam';
  if (g.closed && g.holeCount >= 1 && g.holeAreaRatio > HOLE_AREA_RATIO) return 'container';
  if (g.closed && g.area < MIN_STROKE_AREA) return 'grain';
  if (g.closed && g.aspect <= ASPECT_WHEEL_MAX) return 'wheel';
  if (g.closed && g.aspect <= ASPECT_BLOB_MAX) return 'blob';
  if (g.closed) return 'blob';                       // 长闭合：不允许判梁，否则画个长圈白拿梁
  if (g.aspect > ASPECT_BEAM_MIN) return 'beam';
  return 'blob';                                      // 兜底
}

/**
 * S5–S8 主流程。
 * @param {Array<{pts:Array<{x:number,y:number}>}>} strokeGroup 同组笔画（本轮 UI 一笔一组）
 * @returns 几何属性 + form + tooSmall
 */
function analyzeStrokeGroup(strokeGroup) {
  const prepared = strokeGroup
    .map((s) => rdpSimplify(dedupePoints(s.pts || [], 0.5)))
    .filter((p) => p.length >= 2);

  if (!prepared.length) {
    return {
      form: 'dot', tooSmall: true, strokeCount: 0, closed: false, selfIntersect: false,
      perimeter: 0, bbox: geoBBox([]), aspect: 1, area: 0, hullArea: 0,
      centroid: { x: 0, y: 0 }, holeCount: 0, holeAreaRatio: 0, strokesAdjacent: false,
      centerline: [], pointCount: 0, nodes: 0,
    };
  }

  const all = prepared.flat();
  // 未简化前的原始采样点：开笔画的重心必须用“点均值”，且必须用原始点，
  // 否则 RDP 留下的节点疏密不均会把落点带偏（关1/关2 的落点对齐全靠这一条）
  const rawAll = strokeGroup.flatMap((st) => st.pts || []);
  const bbox = geoBBox(all);
  const aspect = Math.max(bbox.w, bbox.h) / Math.max(1, Math.min(bbox.w, bbox.h));
  const single = prepared.length === 1;
  const centerline = single ? prepared[0] : all;
  const perimeter = prepared.reduce((sum, p) => sum + geoPolylineLength(p), 0);

  // S5 闭合检测：只对单笔有意义；首尾距落进容差即判闭合（宁可判闭合，闭合后仍能落进团块兜底）
  let closed = false;
  const tol = strokeCloseTolerance(bbox);
  if (single && prepared[0].length >= 3) {
    const first = prepared[0][0];
    const last = prepared[0][prepared[0].length - 1];
    closed = geoDist(first, last) <= tol && perimeter > tol * 2.5;
  }

  // S6 面积：闭合走鞋带公式；开口笔画面积按 0（→ 梁候选）
  let outerPoly = null;
  let area = 0;
  if (closed) {
    outerPoly = prepared[0].slice(0, -1);
    area = geoPolygonArea(outerPoly);
  }

  // 孔洞：另一条完整闭合笔画的所有点都落在本多边形内
  let holeCount = 0;
  let holeArea = 0;
  if (closed) {
    for (let i = 1; i < prepared.length; i++) {
      const cand = prepared[i];
      const candClosed = cand.length >= 3 && geoDist(cand[0], cand[cand.length - 1]) <= tol;
      if (!candClosed) continue;
      const poly = cand.slice(0, -1);
      if (poly.every((p) => geoPointInPolygon(p, outerPoly))) {
        holeCount++;
        holeArea += geoPolygonArea(poly);
      }
    }
  }
  const holeAreaRatio = area > 0 ? holeArea / area : 0;

  // 相邻性：相邻两笔的“上一笔末点 / 下一笔起点”距离 ≤ 闭合容差
  let strokesAdjacent = false;
  if (prepared.length >= 2) {
    strokesAdjacent = true;
    for (let i = 1; i < prepared.length; i++) {
      const a = prepared[i - 1];
      const b = prepared[i];
      if (geoDist(a[a.length - 1], b[0]) > tol) { strokesAdjacent = false; break; }
    }
  }

  // S9 单点/极小：不生成刚体、不消耗造物槽
  // S9：只有“总长 < 8px”才拒判（RDP 把直线压成 2 节点是正常的，不能当单点处理）
  const tooSmall = perimeter < MIN_STROKE_LENGTH;

  let selfIntersect = false;
  if (single) selfIntersect = geoIsSelfIntersecting(prepared[0], closed);

  const centroid = closed && outerPoly ? geoCentroid(outerPoly, true) : geoCentroid(rawAll.length ? rawAll : centerline, false);
  const hullArea = geoPolygonArea(geoConvexHull(all));

  const g = {
    form: 'blob', tooSmall, strokeCount: prepared.length, closed, selfIntersect,
    perimeter, bbox, aspect, area, hullArea, centroid,
    holeCount, holeAreaRatio, strokesAdjacent,
    centerline, outerPoly, prepared,
    pointCount: all.length, nodes: prepared.reduce((s, p) => s + p.length, 0),
  };
  g.form = tooSmall ? 'dot' : classifyForm(g);
  return g;
}
;
/* src/physics/materials.js */
/**
 * src/physics/materials.js —— 物理常数与材质基线的唯一出处（红线 L6）
 * 任何物理数值（密度/摩擦/弹性/步长/速度上限/角色行为）只许写在这里；
 * abilities/registry.js 只许引用，不许自己写字面量。
 * 全部 [待实测标定]。
 */
const MATTER_GRAVITY = { x: 0, y: 1, scale: 0.001 };

const FIXED_STEP_MS = 16.666;   // 物理固定步长 1/60s
const MAX_SUB_STEPS = 3;        // 单帧最大子步
const MAX_ACCUM_MS = 50;        // 累积上限，超出丢弃（不追帧）

const BODY_MAX_SPEED = 24;      // px/step，NaNGuard 里做速度 clamp
const BEAM_MIN_THICKNESS = 8;
const BEAM_LENGTH_PAD = 6;
const SOFT_BEAM_STIFFNESS = 0.18;   // 未变硬时中缝铰接刚度（会折下去）      // 梁两端各外扩，保证能搭在沟沿上
const WHEEL_MIN_RADIUS = 6;
const GRAIN_MAX_RADIUS = 9;

const DENSITY_CREATURE = 0.0025; // 质量 = 面积 × 密度 → 「画多大就有多重」
const DENSITY_PUMPKIN = 0.0035;

/** 造物“软”基线：不加变硬时它在沟沿上会弹走/滑走（关1 的教学性失败） */
const CREATURE_SOFT = { friction: 0.05, frictionStatic: 0.08, restitution: 0.32, frictionAir: 0.02 };
/** 变硬后：抓得住、不弹 */
const CREATURE_HARD = { friction: 0.9, frictionStatic: 1.1, restitution: 0.02, frictionAir: 0.008 };
/** 会滚：摩擦降到 ≈0（冰面） */
const CREATURE_ROLL = { friction: 0.02, frictionStatic: 0.02 };

/** 质量倍数（变重 / 变轻） */
const DENSITY_MUL_HEAVY = 3;
const DENSITY_MUL_LIGHT = 0.2;

const MATERIALS = {
  ground: { friction: 0.9, frictionStatic: 1.0, restitution: 0.02 },
  slope:  { friction: 0.9, frictionStatic: 1.0, restitution: 0.02 },
  metal:  { friction: 0.4, frictionStatic: 0.5, restitution: 0.1 },
  /**
   * 南瓜：friction 必须为 0，否则它在任何地面都被“粘”住。
   * 依据（实测 tests/probe2.mjs）：matter 的 pair.friction = min(a,b)、pair.frictionStatic = max(a,b)，
   * 求解时相乘，所以只要接触对里有一方 friction>0，切向速度就被清零（0.05 与 0.9 停止距离都是 ≈8px）。
   * friction=0 时它才真的滑得起来 —— 这也是「圆的/滚的东西」在本引擎里的等价写法。
   * frictionAir 是它唯一的减速来源（决定能滑多远），[待实测标定]。
   */
  pumpkin: { friction: 0, frictionStatic: 0, restitution: 0, frictionAir: 0.002 },
  ice:    { friction: 0.08, frictionStatic: 0.05, restitution: 0.0 },
};


/** 走路小人（农夫 / 对岸小人）：速度式驱动，不是真的“推” */
const ACTOR = {
  radius: 14,
  mass: 1.8,
  friction: 0.02,
  frictionAir: 0.0,
  speed: 1.9,             // px/step
  accelStep: 0.22,        // 每子步速度最大变化量（防止推土机效应）
  jumpSpeed: 6.0,         // px/step → 跳高约 65px
  jumpCooldownMs: 420,
  stuckFrames: 9,         // 连撞 9 帧判定“卡住”→ 跳
  arriveTolerance: 5,
};

/** 压板：持续重量阈值与判定 */
const PLATE = {
  sustainMs: 1000,       // 持续压住多久算数
  releaseMs: 250,        // 撤重多久算抬起
  minBodySpeed: 2.2,     // 只统计“压在板上”的物体（速度低于此值）
};

/**
 * 碰撞音闸门（物理侧聚合后每帧最多回调 1 次）。[待实测标定]
 * 单位是 score = |法向相对速度| × 约化质量，不是冲量（matter 不暴露冲量）。
 * 定阈值前必须先做 pair 去抖（同 pair 200ms 内重复 start 丢弃），否则分布被污染。
 */
const IMPACT_MIN_SCORE = 0.6;
const IMPACT_PAIR_COOLDOWN_MS = 90;
;
/* src/physics/nan-guard.js */
/**
 * src/physics/nan-guard.js —— NaNGuard.sweep（风险 K3：物理爆炸兜底）
 * 每 10 帧扫一遍 position/velocity/angle，非有限值直接移除该 body；顺带做速度 clamp。
 */


const NAN_GUARD_EVERY_FRAMES = 10;

const NaNGuard = {
  frames: 0,
  removed: 0,
  clamped: 0,
  /**
   * @param {object} engine matter 引擎
   * @param {object} MATTER matter 命名空间
   * @returns {{removed:number, clamped:number}} 本次清扫结果
   */
  sweep(engine, MATTER) {
    this.frames++;
    let removed = 0;
    let clamped = 0;
    if (!engine || !MATTER) return { removed, clamped };
    const bodies = MATTER.Composite.allBodies(engine.world);
    for (const b of bodies) {
      if (b.isStatic) continue;
      const p = b.position;
      const v = b.velocity;
      const bad = !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(b.angle);
      if (bad) {
        MATTER.Composite.remove(engine.world, b, true);
        removed++;
        continue;
      }
      const sp = Math.hypot(v.x, v.y);
      if (sp > BODY_MAX_SPEED) {
        MATTER.Body.setVelocity(b, { x: (v.x / sp) * BODY_MAX_SPEED, y: (v.y / sp) * BODY_MAX_SPEED });
        clamped++;
      }
    }
    this.removed += removed;
    this.clamped += clamped;
    return { removed, clamped };
  },
};
;
/* src/physics/world.js */
/**
 * src/physics/world.js —— matter 引擎封装：定步长 / 子步 / 碰撞上报 / NaN 守卫
 * 这是唯一 import matter 的地方（vendor 以全局 MATTER 暴露）。
 */



const MATTER = Matter;
const DECOMP = typeof decomp !== 'undefined' ? decomp : null;

function createPhysicsWorld(opts) {
  const options = opts || {};
  const engine = MATTER.Engine.create({
    positionIterations: 8,
    velocityIterations: 6,
    constraintIterations: 3,
    enableSleeping: false,
  });
  engine.gravity.x = MATTER_GRAVITY.x;
  engine.gravity.y = MATTER_GRAVITY.y;
  engine.gravity.scale = MATTER_GRAVITY.scale;

  if (DECOMP && MATTER.Common.setDecomp) MATTER.Common.setDecomp(DECOMP);

  let subSteps = MAX_SUB_STEPS;
  let clockMs = 0;

  // ---- 碰撞音聚合（契约：PhysicsWorld.onImpact(cb)，每帧最多回调 1 次）----
  // pair 里没有冲量字段，代理量必须在这里、用同一时刻的速度与法线算：
  //   vRel = dot(vB - vA, normal) ; mEff = mA*mB/(mA+mB)（静态体 mass=Infinity → 用另一方质量，否则 NaN）
  //   score = |vRel| * mEff
  let impactCb = options.onImpact || null;
  let best = null;                 // 本帧（跨子步）最大者
  const pairCooldown = new Map();  // key → 上次放行时刻
  const impactDebug = { score: 0, gated: false, reason: '-' };

  MATTER.Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.isStatic && b.isStatic) continue;
      const n = pair.collision && pair.collision.normal ? pair.collision.normal : { x: 0, y: 1 };
      const vRel = (b.velocity.x - a.velocity.x) * n.x + (b.velocity.y - a.velocity.y) * n.y;
      const mA = a.isStatic || !Number.isFinite(a.mass) ? null : a.mass;
      const mB = b.isStatic || !Number.isFinite(b.mass) ? null : b.mass;
      let mEff;
      if (mA == null && mB == null) mEff = 1;
      else if (mA == null) mEff = mB;
      else if (mB == null) mEff = mA;
      else mEff = (mA * mB) / (mA + mB);
      const score = Math.abs(vRel) * mEff;
      if (!Number.isFinite(score)) continue;
      const owner = a.isStatic ? b : a;
      const key = Math.min(a.id, b.id) + '+' + Math.max(a.id, b.id);
      if (!best || score > best.score) {
        best = {
          score, key, timeMs: clockMs,
          bodyId: owner.id,
          material: (owner.plugin && owner.plugin.mat) || owner.label || 'ground',
        };
      }
    }
  });

  function flushImpact() {
    const cand = best;
    best = null;
    if (!cand) { impactDebug.score = 0; impactDebug.gated = false; impactDebug.reason = 'no-contact'; return; }
    impactDebug.score = Number(cand.score.toFixed(3));
    const last = pairCooldown.get(cand.key);
    if (cand.score <= IMPACT_MIN_SCORE) { impactDebug.gated = true; impactDebug.reason = 'below-min'; return; }
    if (last != null && cand.timeMs - last < IMPACT_PAIR_COOLDOWN_MS) {
      impactDebug.gated = true; impactDebug.reason = 'pair-cooldown'; return;
    }
    pairCooldown.set(cand.key, cand.timeMs);
    impactDebug.gated = false; impactDebug.reason = 'ok';
    if (impactCb) impactCb({ score: cand.score, material: cand.material, bodyId: cand.bodyId });
  }

  const api = {
    engine,
    composite: engine.world,
    MATTER,
    DECOMP,
    get subSteps() { return subSteps; },
    /** 契约：PhysicsWorld.setSubSteps(n) 1..3 */
    setSubSteps(n) { subSteps = Math.max(1, Math.min(MAX_SUB_STEPS, n | 0)); },
    /** 契约：PhysicsWorld.onImpact(cb)，载荷 { score, material, bodyId }，每帧最多 1 次 */
    onImpact(cb) { impactCb = cb; },
    /** ?impactDebug=1 用：只报「本帧 score」与「是否被闸门拦下」，不报累计次数 */
    get impactDebug() { return impactDebug; },

    addBody(body) { MATTER.Composite.add(engine.world, body); return body; },
    removeBody(body) { MATTER.Composite.remove(engine.world, body, true); },
    addConstraint(c) { MATTER.Composite.add(engine.world, c); return c; },
    removeConstraint(c) { MATTER.Composite.remove(engine.world, c, true); },

    allBodies() { return MATTER.Composite.allBodies(engine.world); },
    dynamicBodies() { return MATTER.Composite.allBodies(engine.world).filter((b) => !b.isStatic); },

    /** 单个物理帧（固定步长；一帧内可多次调用以追帧） */
    step() {
      MATTER.Engine.update(engine, FIXED_STEP_MS);
      clockMs += FIXED_STEP_MS;
      NaNGuard.frames++;
      if (NaNGuard.frames % NAN_GUARD_EVERY_FRAMES === 0) NaNGuard.sweep(engine, MATTER);
    },
    /**
     * 本帧推进：steps 为累积器算出的步数，受 subSteps 上限钳制。
     * beforeStep(dtMs) 在每次 Engine.update 之前调用（角色 AI 必须和物理同频，否则子步会放大速度）。
     * 碰撞音在**帧末**（跨子步聚合之后）才回调一次。
     * @returns {number} 实际执行步数
     */
    stepFrame(steps, beforeStep) {
      const n = Math.max(1, Math.min(steps == null ? 1 : steps, subSteps));
      for (let i = 0; i < n; i++) {
        if (beforeStep) beforeStep(FIXED_STEP_MS);
        this.step();
      }
      flushImpact();
      return n;
    },

    sweepNaN() { return NaNGuard.sweep(engine, MATTER); },

    bodiesInRect(rect) {
      return MATTER.Query.region(MATTER.Composite.allBodies(engine.world), {
        min: { x: rect.x, y: rect.y },
        max: { x: rect.x + rect.w, y: rect.y + rect.h },
      });
    },
    raycast(from, to, width) {
      return MATTER.Query.ray(MATTER.Composite.allBodies(engine.world), from, to, width || 3);
    },
    clear() {
      MATTER.Composite.clear(engine.world, false, true);
      MATTER.Engine.clear(engine);
    },
  };
  return api;
}
;
/* src/physics/budget.js */
/**
 * src/physics/budget.js —— 刚体配额与采样点配额（tech-baseline 第 4 节契约 P4 / P5）
 * 这两个名字（BodyBudget / StrokeBudget / trySpawn / setMax / push）必须逐字存在，QA 会 grep。
 * 采样点上限只在 thresholds.js 里定义一次（阈值单一出处），这里只引用。
 */


const BODY_BUDGET_MAX = 24;     // 顶层动态刚体上限

const BodyBudget = {
  max: BODY_BUDGET_MAX,
  current: 0,
  rejected: 0,
  /** 准入：满了返回 false，由调用方降级（放静态轮廓 + 台词），不许阻塞玩家 */
  trySpawn() {
    if (this.current >= this.max) { this.rejected++; return false; }
    this.current++;
    return true;
  },
  release() { if (this.current > 0) this.current--; },
  setMax(n) { this.max = Math.max(1, n | 0); },
  count() { return this.current; },
  reset() { this.current = 0; this.rejected = 0; },
};

const StrokeBudget = {
  used: 0,
  /** @returns {boolean} false = 已达上限，调用方应改为 2 点取 1 抽稀 */
  push() {
    if (this.used >= STROKE_MAX_POINTS) return false;
    this.used++;
    return true;
  },
  count() { return this.used; },
  reset() { this.used = 0; },
};
;
/* src/physics/body-factory.js */
/**
 * src/physics/body-factory.js —— 点集 → 刚体（S10 拆凸 / S11 刚体生成）
 * 风险 K3 的三级退化在这里：decomp（matter 内置 poly-decomp）→ 凸包 → bbox 矩形 → 圆形。
 * 任何一级失败都不抛到上层；最差也给一个能玩的圆，绝不让核心动作失效。
 */




/* MATTER 由 physics/world.js 在同一打包作用域声明（兜底拼接器 D3：顶层名全仓库唯一） */

function isFinitePt(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** 复合体校验：任一块顶点 < 3 或含非有限值 → 判废（S11） */
function sanitizeCompound(body, maxParts) {
  if (!body || !Array.isArray(body.parts)) return null;
  // fromVertices 对凸多边形会返回单块 body（parts.length === 1），那也是合法结果
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  if (parts.length > maxParts) return null;
  for (const p of parts) {
    if (!p.vertices || p.vertices.length < 3) return null;
    for (const v of p.vertices) if (!isFinitePt(v)) return null;
  }
  return body;
}

function polygonFrom(points) {
  const out = [];
  for (const p of points) {
    if (!isFinitePt(p)) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.4) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * 多边形 → 刚体数组（含 K3 三级退化）
 * @returns {{bodies:Array, degraded:'none'|'hull'|'bbox'|'circle'}}
 */
function bodyFromPolygon(points, spawn, options) {
  const opts = options || {};
  const poly = polygonFrom(points);
  const base = Object.assign({}, opts);

  // 一级：交给 matter 的 fromVertices（内部用 poly-decomp 拆凸）
  if (poly.length >= 3) {
    try {
      const b = MATTER.Bodies.fromVertices(spawn.x, spawn.y, [poly.map((p) => ({ x: p.x, y: p.y }))], base, true);
      const ok = sanitizeCompound(b, DECOMP_MAX_PARTS);
      if (ok) return { bodies: [ok], degraded: 'none' };
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] decomp 失败，退化到凸包', err && err.message);
    }
  }

  // 二级：凸包（单块）
  if (poly.length >= 3) {
    try {
      const hull = geoConvexHull(poly);
      if (hull.length >= 3) {
        const b = MATTER.Bodies.fromVertices(spawn.x, spawn.y, [hull.map((p) => ({ x: p.x, y: p.y }))], base, true);
        if (b && b.vertices && b.vertices.length >= 3) {
          for (const v of b.vertices) if (!isFinitePt(v)) throw new Error('hull 顶点非法');
          return { bodies: [b], degraded: 'hull' };
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] 凸包失败，退化到矩形', err && err.message);
    }
  }

  // 三级：bbox 矩形
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (isFinite(minX) && maxX - minX > 1 && maxY - minY > 1) {
    try {
      const b = MATTER.Bodies.rectangle((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY, base);
      return { bodies: [b], degraded: 'bbox' };
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] 矩形失败，退化到圆', err && err.message);
    }
  }

  // 四级：圆形（最差也能玩）
  const r = Math.max(WHEEL_MIN_RADIUS, (Number.isFinite(maxX - minX) ? maxX - minX : 0) / 2 || 12);
  return { bodies: [MATTER.Bodies.circle(spawn.x, spawn.y, r, base)], degraded: 'circle' };
}

/** 把刚体组整体平移到目标点（让落点与虚线引导一致） */
function recenter(bodies, target) {
  let mx = 0, my = 0, tm = 0;
  for (const b of bodies) {
    const m = Math.max(b.mass, 1e-4);
    mx += b.position.x * m;
    my += b.position.y * m;
    tm += m;
  }
  if (!tm) return;
  const dx = target.x - mx / tm;
  const dy = target.y - my / tm;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  for (const b of bodies) MATTER.Body.translate(b, { x: dx, y: dy });
}

/**
 * 落地材质与能力 mods（幂等：同一组 mods 重复施加结果一致）
 * 层序由 compose.js 决定，这里只负责写入。
 */
function applyMods(bodies, mods) {
  const m = mods || {};
  const densityMul = Number.isFinite(m.densityMul) ? m.densityMul : 1;
  for (const b of bodies) {
    if (!b.isStatic) {
      MATTER.Body.setDensity(b, DENSITY_CREATURE * densityMul);
      b.friction = m.friction != null ? m.friction : CREATURE_SOFT.friction;
      b.frictionStatic = m.frictionStatic != null ? m.frictionStatic : CREATURE_SOFT.frictionStatic;
      b.frictionAir = m.frictionAir != null ? m.frictionAir : CREATURE_SOFT.frictionAir;
      b.restitution = m.restitution != null ? m.restitution : CREATURE_SOFT.restitution;
      b.slop = 0.02;
    }
  }
}

/**
 * 主入口：按形态生成造物刚体。
 * @param {object} spec { form, geo, thickness, spawn:{x,y}, mods }
 * @returns {{bodies:Array, constraints:Array, degraded:string, form:string}}
 */
function buildCreatureBody(spec) {
  const { form, geo, spawn } = spec;
  const mods = spec.mods || {};
  const flags = spec.flags || {};
  const rigid = flags.rigid === true || mods.rigid === true;
  const thickness = Math.max(BEAM_MIN_THICKNESS, spec.thickness || BEAM_MIN_THICKNESS);
  const centerline = (geo && geo.centerline) || [];
  const poly = (geo && geo.outerPoly) || centerline;
  let bodies = [];
  let constraints = [];
  let degraded = 'none';

  if (form === 'beam' && centerline.length >= 2) {
    // 梁：中心线首尾决定长度与角度（支持斜梁），厚度取笔宽
    const p0 = centerline[0];
    const pN = centerline[centerline.length - 1];
    const len = Math.max(BEAM_MIN_THICKNESS * 2, Math.hypot(pN.x - p0.x, pN.y - p0.y) + BEAM_LENGTH_PAD * 2);
    const angle = Math.atan2(pN.y - p0.y, pN.x - p0.x);
    const mx = (p0.x + pN.x) / 2;
    const my = (p0.y + pN.y) / 2;
    if (rigid || len < 90) {
      bodies = [MATTER.Bodies.rectangle(mx, my, len, thickness, { angle })];
    } else {
      // 没变硬 = 软的：两段铰接，压上去会从中折下去（关1 的教学性失败）
      const half = len / 2;
      const dx = Math.cos(angle) * (len / 4);
      const dy = Math.sin(angle) * (len / 4);
      const left = MATTER.Bodies.rectangle(mx - dx, my - dy, half, thickness, { angle });
      const right = MATTER.Bodies.rectangle(mx + dx, my + dy, half, thickness, { angle });
      bodies = [left, right];
      constraints = [MATTER.Constraint.create({
        bodyA: left, pointA: { x: half / 2, y: 0 },
        bodyB: right, pointB: { x: -half / 2, y: 0 },
        length: 0, stiffness: SOFT_BEAM_STIFFNESS, render: { visible: false },
      })];
      degraded = 'soft-hinge';
    }
  } else if (form === 'wheel' && geo) {
    const r = Math.max(WHEEL_MIN_RADIUS, Math.min(geo.bbox.w, geo.bbox.h) / 2);
    bodies = [MATTER.Bodies.circle(geo.centroid.x, geo.centroid.y, r)];
  } else if (form === 'grain' && geo) {
    const r = Math.min(GRAIN_MAX_RADIUS, Math.max(4, Math.sqrt(Math.max(geo.area, 40) / Math.PI)));
    bodies = [MATTER.Bodies.circle(geo.centroid.x, geo.centroid.y, r)];
  } else if (form === 'rope' && centerline.length >= 2) {
    // 绳：中心线切成 n 节小刚体 + 铰接约束（首尾相连的多笔才有意义，本轮 UI 未接线）
    const total = geoPolylineLength(centerline);
    const n = Math.max(2, Math.min(ROPE_JOINT_MAX, Math.round(total / 40)));
    const nodes = geoResample(centerline, n);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      bodies.push(MATTER.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(6, segLen), thickness, { angle }));
    }
    recenter(bodies, spawn);
    for (let i = 1; i < bodies.length; i++) {
      const segLen = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
      constraints.push(MATTER.Constraint.create({
        bodyA: bodies[i - 1], pointA: { x: segLen / 2, y: 0 },
        bodyB: bodies[i], pointB: { x: -segLen / 2, y: 0 },
        length: 0, stiffness: 0.9, render: { visible: false },
      }));
    }
  } else if (form === 'pile' && geo && geo.prepared && geo.prepared.length >= 2) {
    // 松散堆：每笔一块小刚体（本轮 UI 一笔一组，走不到这里；管线与单测覆盖）
    for (const strokePts of geo.prepared) {
      const r = Math.max(6, Math.min(18, Math.sqrt(Math.max(60, strokePts.length * 6) / Math.PI)));
      bodies.push(MATTER.Bodies.circle(strokePts[0].x, strokePts[0].y, r));
    }
  } else if (poly.length >= 3 && geo && geo.closed) {
    const r = bodyFromPolygon(poly, spawn, {});
    bodies = r.bodies;
    degraded = r.degraded;
  } else if (poly.length >= 3) {
    // 开口但不判梁（长宽比不到 6）：按墨迹凸包做成一块，兜底团块
    const r = bodyFromPolygon(poly, spawn, {});
    bodies = r.bodies;
    degraded = r.degraded;
  } else if (geo && geo.bbox) {
    const w = Math.max(BEAM_MIN_THICKNESS * 2, geo.bbox.w);
    const h = Math.max(BEAM_MIN_THICKNESS * 2, geo.bbox.h);
    bodies = [MATTER.Bodies.rectangle(geo.bbox.cx, geo.bbox.cy, w, h)];
    degraded = 'bbox';
  } else {
    bodies = [MATTER.Bodies.circle(spawn.x, spawn.y, 12)];
    degraded = 'circle';
  }

  if (form !== 'rope') recenter(bodies, spawn);

  // 材质：先铺“软”基线，再叠能力 mods（未加变硬就是软的，这是关 1 的教学点）
  applyMods(bodies, Object.assign({}, CREATURE_SOFT, mods));

  for (const b of bodies) {
    b.render.visible = false;
    b.plugin = b.plugin || {};
    b.plugin.creatureForm = form;
  }

  return { bodies, constraints, degraded, form };
}
;
/* src/abilities/registry.js */
/**
 * src/abilities/registry.js —— 能力 = 纯数据记录（红线 L4：不许写 if-else 链）
 *
 * 一个能力只有三种施加方式：
 *   mods  静态物理属性改写（生成时一次性 applyMods，幂等）
 *   hooks 事件钩子（按 order 升序确定性执行）
 *   flags 行为开关（供其它系统读）
 *
 * 本轮（阶段 2）只实装 4 个：变硬 / 会滚 / 变重 / 变轻。
 * 其余 20 个只登记名字（PLANNED_ABILITY_NAMES），**没有记录、没有实现**，不许当已完成。
 */


const ABILITIES = {
  harden: {
    id: 'harden', name: '变硬', chapter: 1,
    layer: 'material', priority: 10,
    mods: {
      friction: CREATURE_HARD.friction,
      frictionStatic: CREATURE_HARD.frictionStatic,
      restitution: CREATURE_HARD.restitution,
      frictionAir: CREATURE_HARD.frictionAir,
    },
    flags: { rigid: true },
    hooks: {},
    tags: ['structural'],
    conflicts: ['roll'],
    blurb: '不变形、抓得住：架在沟上不会弹走',
  },
  roll: {
    id: 'roll', name: '会滚', chapter: 2,
    layer: 'motion', priority: 20,
    mods: { friction: CREATURE_ROLL.friction, frictionStatic: CREATURE_ROLL.frictionStatic },
    flags: { rolling: true },
    hooks: {},
    tags: ['motion'],
    conflicts: [],
    blurb: '表面摩擦降到≈0，碰到斜的东西就一直加速',
  },
  heavy: {
    id: 'heavy', name: '变重', chapter: 3,
    layer: 'material', priority: 12,
    mods: { densityMul: DENSITY_MUL_HEAVY },
    flags: { heavy: true },
    hooks: {},
    tags: ['mass'],
    conflicts: [],
    blurb: '质量 ×3，压得下踏板',
  },
  light: {
    id: 'light', name: '变轻', chapter: 4,
    layer: 'material', priority: 12,
    mods: { densityMul: DENSITY_MUL_LIGHT },
    flags: { light: true },
    hooks: {},
    tags: ['mass'],
    conflicts: [],
    blurb: '质量 ×0.2，一碰就飞（本轮仅实装数值，未进关卡）',
  },
};

const IMPLEMENTED_ABILITY_IDS = ['harden', 'roll', 'heavy', 'light'];

/** 池子里另外 20 个：只有名字，尚未实现（不许算进「已实装」） */
const PLANNED_ABILITY_NAMES = [
  '怕痒', '会说话', '透明', '滑', '黏', '发光', '可燃', '时间慢', '无限长', '复制',
  '磁', '反重力', '会跳', '防水', '导电', '吸水', '倒转', '一刀切', '饿', '记仇',
];

function getAbility(id) {
  return ABILITIES[id] || null;
}
;
/* src/abilities/combos.js */
/**
 * src/abilities/combos.js —— 组合查表（R6）
 * 键 = [a,b].sort().join('+')，O(1)。命中时叠加 comboBonus 并解锁专属台词。
 *
 * 注：levels.md 第四节列的四条「看着没用，配对逆天」组合都依赖怕痒/会说话/透明/黏，
 * 这些能力本轮未实装，所以那四条现在不可达（已如实记入 README 未做项）。
 * 这里只保留一条对当前 4 个能力成立的组合：变硬 + 会滚 = 硬滚石。
 */
const COMBO_TABLE = {
  'harden+roll': {
    id: 'harden+roll',
    name: '硬滚石',
    line: 'combo_hard_roll',
    bonus: { densityMul: 1.0 },
    note: '不变形的轮子：滚得稳，还抓得住砸下来的东西',
  },
};

function comboKey(ids) {
  return ids.slice().sort().join('+');
}

function lookupCombos(ids) {
  if (!Array.isArray(ids) || ids.length < 2) return [];
  const hits = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = comboKey([ids[i], ids[j]]);
      const hit = COMBO_TABLE[key];
      if (hit) hits.push(hit);
    }
  }
  return hits;
}
;
/* src/abilities/compose.js */
/**
 * src/abilities/compose.js —— 组合裁定器
 * 规则 R1–R7 全部确定性，玩家点选顺序不影响结果（否则复现不了）。
 *
 * R1 层优先：material → motion → sense → meta（后写覆盖同名键：会滚的摩擦压过变硬的摩擦）
 * R2 同层冲突：priority 小者胜；被盖掉时记一条 note，拿去生成“变硬盖过了滑”这类台词
 * R3 数值可交换：densityMul 乘算（0.2 × 3 = 3 × 0.2），其余键覆盖
 * R4 同 order 决胜：按 id 字典序
 * R5 单造物上限 2（超出由调用方拒绝，这里只提供常量）
 * R6 组合查表
 * R7 钩子不得改几何
 */




const ABILITY_LAYER_ORDER = ['material', 'motion', 'sense', 'meta'];

function composeAbilities(ids) {
  const picked = [];
  const unknown = [];
  for (const id of ids || []) {
    const ab = ABILITIES[id];
    if (ab) picked.push(ab); else unknown.push(id);
  }

  const sorted = picked.slice().sort((a, b) => {
    const la = ABILITY_LAYER_ORDER.indexOf(a.layer);
    const lb = ABILITY_LAYER_ORDER.indexOf(b.layer);
    if (la !== lb) return la - lb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;   // R4
  });

  const mods = {};
  const flags = {};
  const hooks = [];
  const notes = [];
  const owner = {};   // key -> abilityId，用于 R2 冲突台词

  for (const ab of sorted) {
    for (const key of Object.keys(ab.mods || {})) {
      const val = ab.mods[key];
      if (key === 'densityMul') {
        mods.densityMul = (mods.densityMul == null ? 1 : mods.densityMul) * val;  // R3
      } else {
        if (owner[key] && owner[key] !== ab.id) {
          notes.push({ type: 'override', key, from: owner[key], to: ab.id });
        }
        mods[key] = val;
      }
      owner[key] = ab.id;
    }
    Object.assign(flags, ab.flags || {});
    for (const ev of Object.keys(ab.hooks || {})) {
      const h = ab.hooks[ev];
      hooks.push({ event: ev, order: h.order == null ? 100 : h.order, id: ab.id, fn: h.fn });
    }
  }

  hooks.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));  // R4

  const combos = lookupCombos(picked.map((a) => a.id));
  for (const c of combos) {
    for (const key of Object.keys(c.bonus || {})) {
      if (key === 'densityMul') mods.densityMul = (mods.densityMul == null ? 1 : mods.densityMul) * c.bonus[key];
      else mods[key] = c.bonus[key];
    }
  }

  if (mods.densityMul == null) mods.densityMul = 1;

  return {
    ids: picked.map((a) => a.id),
    layers: sorted.map((a) => a.layer),
    mods,
    flags,
    hooks,
    combos,
    notes,
    unknown,
    violated: picked.length > MAX_ABILITIES_PER_CREATURE,
  };
}
;
/* src/level/runtime.js */
/**
 * src/level/runtime.js —— 关卡运行时（零 DOM：可以在 node 里整关跑物理）
 *
 * 职责：把「关卡数据 + 造物刚体 + 角色行为 + 机关判定」跑成一局，
 * 胜负只从物理状态推导出来（不写死脚本动画），事件全部走 bus。
 *
 * 对外接口：
 *   createLevelRuntime({level, world, bus})
 *   → { spawnCreature, setAbility, toggleAbility, step, snapshot, destroy, state }
 */







/* MATTER 由 physics/world.js 在同一打包作用域声明（兜底拼接器 D3：顶层名全仓库唯一） */
const CREATURE_DESPAWN_Y = 780;
const LANDING_MAX_FALL_SPEED = 3.4;   // px/step，落地缓冲期内的下落速度上限
const LANDING_FRAMES = 26;
const ACTOR_PIT_FAIL_MS = 2500;
const PLATE_LIGHT_FAIL_MS = 2500;

function clampNum(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** 造一个会走会跳的小人（走路小人只服务演出与「他自己会去用它」） */
function spawnWalkerBody(def, world) {
  const body = MATTER.Bodies.circle(def.x, def.y, ACTOR.radius, {
    label: 'actor', friction: ACTOR.friction, frictionAir: ACTOR.frictionAir, restitution: 0,
  });
  MATTER.Body.setMass(body, ACTOR.mass);
  world.addBody(body);
  return {
    kind: 'walker',
    body,
    start: { x: def.x, y: def.y },
    targetX: def.targetX,
    label: def.label || '小人',
    active: false,      // 造物落地之后才开始走（否则玩家还没画他就掉沟里了）
    jumpCd: 0,
    stuck: 0,
    lastX: def.x,
    pitMs: 0,
    jumping: 0,
  };
}

/** 走路小人 AI：朝目标走；被挡住（连续 N 帧没位移）就跳一次 */
function stepWalker(a, world, dtMs) {
  const b = a.body;
  if (!a.active) return;
  if (a.jumpCd > 0) a.jumpCd = Math.max(0, a.jumpCd - dtMs);
  let ground = false;
  for (const off of [-6, 0, 6]) {
    const from = { x: b.position.x + off, y: b.position.y + ACTOR.radius - 2 };
    const to = { x: b.position.x + off, y: b.position.y + ACTOR.radius + 8 };
    if (world.raycast(from, to, 2).some((h) => h.body !== b)) { ground = true; break; }
  }
  const standing = ground && b.velocity.y > -1.2 && b.velocity.y < 1.0;
  const dx = a.targetX - b.position.x;
  const dir = Math.abs(dx) > ACTOR.arriveTolerance ? Math.sign(dx) : 0;

  if (standing) {
    // 速度逐步逼近目标速度（不是每帧硬设），否则小人会把桥当推土机推走
    const targetVx = dir * ACTOR.speed;
    const dvx = Math.max(-ACTOR.accelStep, Math.min(ACTOR.accelStep, targetVx - b.velocity.x));
    MATTER.Body.setVelocity(b, { x: b.velocity.x + dvx, y: b.velocity.y });
    if (dir !== 0 && Math.abs(b.position.x - a.lastX) < 0.25) a.stuck++; else a.stuck = 0;
    if (a.stuck >= ACTOR.stuckFrames && a.jumpCd <= 0) {
      MATTER.Body.setVelocity(b, { x: dir * ACTOR.speed * 1.15, y: -ACTOR.jumpSpeed });
      a.jumpCd = ACTOR.jumpCooldownMs;
      a.stuck = 0;
      a.jumping = 300;
    }
  }
  a.lastX = b.position.x;
  if (a.jumping > 0) a.jumping -= dtMs;
}

function createLevelRuntime(opts) {
  const level = opts.level;
  const world = opts.world;
  const bus = opts.bus || { emit() {}, on() {}, countOf() { return 0; } };

  const state = {
    level,
    status: 'playing',      // playing | finished
    elapsedMs: 0,
    failStreak: 0,
    lastFailReason: null,
    hintLevel: 0,
    terrain: [],
    actor: null,
    props: [],
    plates: [],
    creatures: [],
    activeCreature: null,
    armedAbilities: [],
    degradeLog: [],
    creatureSeq: 0,
    plateFailMark: new Set(),
    actorReadyAt: -1,
    actorResumeAt: -1,
  };

  // ---- 地形 ----
  for (const t of level.terrain) {
    const mat = MATERIALS[t.mat] || MATERIALS.ground;
    const body = MATTER.Bodies.rectangle(t.x, t.y, t.w, t.h, {
      isStatic: true, angle: t.angle || 0, label: 'terrain',
      friction: mat.friction, frictionStatic: mat.frictionStatic, restitution: mat.restitution,
    });
    body.plugin = { mat: t.mat || 'ground', terrain: true };
    world.addBody(body);
    state.terrain.push(body);
  }

  // ---- 移动角色 ----
  if (level.actors && level.actors.length) state.actor = spawnWalkerBody(level.actors[0], world);

  // ---- 道具（关2 的南瓜） ----
  for (const p of level.props || []) {
    const mat = MATERIALS.pumpkin;
    const body = MATTER.Bodies.rectangle(p.x, p.y, p.w, p.h, {
      label: 'prop', friction: mat.friction, frictionStatic: mat.frictionStatic,
      restitution: mat.restitution, frictionAir: mat.frictionAir == null ? 0.01 : mat.frictionAir,
    });
    MATTER.Body.setDensity(body, 0.0035);
    body.plugin = {
      kind: p.kind, home: { x: p.x, y: p.y }, graceMs: p.graceMs || 0,
      vx0: Number.isFinite(p.vx0) ? p.vx0 : null, stallMs: 0,
      releaseOnSpawn: p.releaseOnSpawn === true,
    };
    if (body.plugin.graceMs > 0) MATTER.Body.setStatic(body, true);
    world.addBody(body);
    state.props.push(body);
  }

  // ---- 压板 ----
  for (const pl of level.plates || []) {
    state.plates.push({
      def: pl, load: 0, holdMs: 0, releaseMs: 0, on: false, everOn: false,
    });
  }

  function emit(ev, payload) { bus.emit(ev, payload); }

  function addCreatureBodies(c) {
    for (const b of c.bodies) world.addBody(b);
    for (const con of c.constraints) world.addConstraint(con);
  }
  function removeCreatureBodies(c) {
    for (const con of c.constraints) world.removeConstraint(con);
    for (const b of c.bodies) world.removeBody(b);
    c.bodies = [];
    c.constraints = [];
  }

  function despawnCreature(c) {
    removeCreatureBodies(c);
    BodyBudget.release();
    const i = state.creatures.indexOf(c);
    if (i >= 0) state.creatures.splice(i, 1);
    if (state.activeCreature === c) state.activeCreature = null;
    emit('creature:despawn', { id: c.id });
  }

  /** 生成造物：落点 x = 笔画质心 x（造物簿与世界共用同一 x 轴），从天下掉下来 */
  function spawnCreature(spec) {
    if (state.status !== 'playing') return null;
    if (state.activeCreature) despawnCreature(state.activeCreature);
    if (!BodyBudget.trySpawn()) {
      emit('creature:rejected', { reason: 'budget' });
      return null;
    }
    const spawn = {
      x: clampNum(spec.geo.centroid.x, 18, DESIGN_W - 18),
      y: level.spawnY == null ? 84 : level.spawnY,
    };
    const composed = composeAbilities(state.armedAbilities);
    const built = buildCreatureBody({
      form: spec.form, geo: spec.geo, thickness: spec.thickness, spawn,
      mods: composed.mods, flags: composed.flags,
    });
    const c = {
      id: ++state.creatureSeq,
      form: spec.form,
      geo: spec.geo,
      thickness: spec.thickness,
      bodies: built.bodies,
      constraints: built.constraints,
      degraded: built.degraded,
      abilities: state.armedAbilities.slice(),
      composed,
      spawn,
      bornAt: state.elapsedMs,
    };
    for (const b of c.bodies) { b.plugin = b.plugin || {}; b.plugin.landingFrames = LANDING_FRAMES; }
    addCreatureBodies(c);
    state.creatures.push(c);
    state.activeCreature = c;
    if (state.actor && !state.actor.active && state.actorReadyAt < 0) state.actorReadyAt = state.elapsedMs + 600;
    // 关2：南瓜一开始被钉住，等玩家把接驳坡架好再放手（否则玩家还没反应过来它就滑进河里了）
    for (const p of state.props) {
      if (p.plugin && p.plugin.releaseOnSpawn && p.isStatic && p.plugin.graceMs > 3000) {
        p.plugin.graceMs = level.propReleaseDelayMs || 1500;
      }
    }
    if (built.degraded !== 'none') state.degradeLog.push({ id: c.id, degraded: built.degraded });
    const main = c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]);
    emit('creature:spawn', {
      id: c.id, form: c.form, spawn, degraded: built.degraded,
      mass: main ? main.mass : 0, parts: main ? main.parts.length - 1 : 0,
      abilities: c.abilities.slice(),
    });
    return c;
  }

  /** 质量加权重心（多刚体造物用它对齐位置，单刚体就是 position） */
  function massCenter(bodies) {
    let m = 0, x = 0, y = 0;
    for (const b of bodies) { m += b.mass; x += b.position.x * b.mass; y += b.position.y * b.mass; }
    return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  function rebuildCreature(c) {
    const primary = c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]);
    const anchor = massCenter(c.bodies);          // 重建前后的重心必须重合
    const vel = { x: primary.velocity.x, y: primary.velocity.y };
    const ang = primary.angle;
    const av = primary.angularVelocity;
    removeCreatureBodies(c);
    const composed = composeAbilities(c.abilities);
    // 先以原点为锚构建（buildCreatureBody 会把它按 geo 质心居中到 spawn），再整体平移到原重心。
    // 不能用“主刚体位置”当 spawn：软梁两个半段的中心不是整根梁的中心，会横移 len/4。
    const built = buildCreatureBody({
      form: c.form, geo: c.geo, thickness: c.thickness, spawn: { x: 0, y: 0 },
      mods: composed.mods, flags: composed.flags,
    });
    const after = massCenter(built.bodies);
    const dx = anchor.x - after.x;
    const dy = anchor.y - after.y;
    if (dx || dy) for (const b of built.bodies) MATTER.Body.setPosition(b, { x: b.position.x + dx, y: b.position.y + dy });
    c.bodies = built.bodies;
    c.constraints = built.constraints;
    c.degraded = built.degraded;
    c.composed = composed;
    addCreatureBodies(c);
    for (const b of c.bodies) {
      MATTER.Body.setVelocity(b, vel);
      MATTER.Body.setAngularVelocity(b, av);
      if (c.bodies.length === 1) MATTER.Body.setAngle(b, ang);
    }
  }

  /** 点芯片：有造物就重建它，没造物就预选给下一个 */
  function setAbility(id) {
    const c = state.activeCreature;
    if (!c) {
      const i = state.armedAbilities.indexOf(id);
      if (i >= 0) state.armedAbilities.splice(i, 1);
      else if (state.armedAbilities.length < MAX_ABILITIES_PER_CREATURE) state.armedAbilities.push(id);
      else { emit('ability:rejected', { id, reason: 'cap' }); return { rejected: true }; }
      emit('ability:attach', { id, on: state.armedAbilities.includes(id), armed: true });
      return { armed: true };
    }
    const has = c.abilities.indexOf(id) >= 0;
    if (!has && c.abilities.length >= MAX_ABILITIES_PER_CREATURE) {
      emit('ability:rejected', { id, reason: 'cap' });
      return { rejected: true };
    }
    if (has) c.abilities = c.abilities.filter((a) => a !== id);
    else c.abilities.push(id);
    state.armedAbilities = c.abilities.slice();
    rebuildCreature(c);
    emit('ability:attach', { id, on: !has, form: c.form });
    if (!has && c.composed.combos.length) emit('combo:trigger', { ids: c.abilities.slice(), combos: c.composed.combos });
    return { ok: true, abilities: c.abilities.slice() };
  }

  function fail(reason) {
    state.failStreak++;
    state.lastFailReason = reason;
    state.hintLevel = Math.min(3, state.failStreak);
    emit('level:fail', { reason, failStreak: state.failStreak, hintLevel: state.hintLevel });
  }

  function updateWalker(dtMs) {
    const a = state.actor;
    if (!a) return;
    const failY = level.resetActorIfBelowY == null ? 1e9 : level.resetActorIfBelowY;
    if (a.body.position.y > failY) {
      a.pitMs += dtMs;
      if (a.pitMs > ACTOR_PIT_FAIL_MS) {
        a.pitMs = 0;
        MATTER.Body.setPosition(a.body, a.start);
        MATTER.Body.setVelocity(a.body, { x: 0, y: 0 });
        MATTER.Body.setAngularVelocity(a.body, 0);
        fail('actor-fell');
      }
    } else if (a.body.position.y < failY - 60) {
      // 只有真的回到地面才算“没掉下去”；小人跳跃会短暂高过 failY，不能用 failY 直接清零
      a.pitMs = 0;
    }
  }

  function updatePlates(dtMs) {
    for (const p of state.plates) {
      const d = p.def;
      const hits = world.bodiesInRect({ x: d.x, y: d.y, w: d.w, h: d.h });
      let load = 0;
      for (const b of hits) {
        if (b.isStatic) continue;
        if (b === (state.actor && state.actor.body)) { load += b.mass; continue; }
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        if (speed > PLATE.minBodySpeed) continue;
        load += b.mass;
      }
      p.load = load;
      const pressed = load >= d.threshold;
      if (pressed) { p.holdMs += dtMs; p.releaseMs = 0; } else {
        p.releaseMs += dtMs;
        if (p.releaseMs > PLATE.releaseMs) p.holdMs = 0;
      }
      const wasOn = p.on;
      p.on = p.holdMs >= PLATE.sustainMs;
      if (p.on && !wasOn && !p.everOn) { p.everOn = true; emit('plate:on', { id: d.id, load }); }
      if (!p.on && wasOn) emit('plate:off', { id: d.id, load });
    }
  }

  /** 关3 的“压不动”失败：有造物压上去但重量一直不够 */
  function updatePlateSoftFail(dtMs) {
    for (const p of state.plates) {
      for (const c of state.creatures) {
        if (state.plateFailMark.has(c.id)) continue;
        const held = c.bodies.some((b) => b.position.x > p.def.x - 10 && b.position.x < p.def.x + p.def.w + 10 &&
          b.position.y > p.def.y - 40 && b.position.y < p.def.y + p.def.h + 30);
        if (!held) continue;
        c.plateSettleMs = (c.plateSettleMs || 0) + dtMs;
        if (c.plateSettleMs > PLATE_LIGHT_FAIL_MS && p.load < p.def.threshold) {
          state.plateFailMark.add(c.id);
          fail('too-light');
        }
      }
    }
  }

  function checkGoal() {
    const g = level.goal;
    if (g.type === 'reachActor') {
      const a = state.actor;
      if (a && a.body.position.x >= g.x && a.body.position.y <= (g.maxY == null ? 400 : g.maxY)) win('actor-crossed');
    } else if (g.type === 'propReach') {
      const p = state.props[g.propIndex || 0];
      if (p && p.position.x >= g.x) win('prop-delivered');
    } else if (g.type === 'plateSustained') {
      const p = state.plates.find((x) => x.def.id === g.plateId) || state.plates[0];
      if (p && p.on) win('plate-sustained');
    }
  }

  function win(reason) {
    if (state.status === 'finished') return;
    state.status = 'finished';
    emit('level:win', { reason, elapsedMs: state.elapsedMs, failStreak: state.failStreak });
  }

  /** 南瓜的“预备—放行”：静止 graceMs 后转成动态（不用魔法，是关卡节奏） */
  /** 南瓜掉进河里之后：把农夫也送回起点，歇一会儿再来一次（否则他走到终点就再也不回来了 → 死路） */
  function resetActorForRetry() {
    const a = state.actor;
    if (!a) return;
    MATTER.Body.setPosition(a.body, a.start);
    MATTER.Body.setVelocity(a.body, { x: 0, y: 0 });
    MATTER.Body.setAngularVelocity(a.body, 0);
    a.active = false;
    a.pitMs = 0;
    a.stuck = 0;
    a.jumpCd = 0;
    a.lastX = a.start.x;
    state.actorResumeAt = state.elapsedMs + (level.propRetryMs || 1200);
  }

  function updatePropGrace(dtMs) {
    for (const p of state.props) {
      if (!p.plugin || !(p.plugin.graceMs > 0)) continue;
      if (p.isStatic) {
        p.plugin.graceMs -= dtMs;
        if (p.plugin.graceMs <= 0) {
          MATTER.Body.setStatic(p, false);
          if (Number.isFinite(p.plugin.vx0)) MATTER.Body.setVelocity(p, { x: p.plugin.vx0, y: 0 });
          emit('prop:release', { kind: p.plugin.kind });
        }
      }
    }
  }

  function updatePropStall(dtMs) {
    for (const p of state.props) {
      if (!p.plugin || p.isStatic) continue;
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      if (speed < 0.12) p.plugin.stallMs += dtMs; else p.plugin.stallMs = 0;
      if (p.plugin.stallMs > 3000) {
        p.plugin.stallMs = 0;
        fail('prop-stalled');
        MATTER.Body.setPosition(p, p.plugin.home);
        MATTER.Body.setVelocity(p, { x: 0, y: 0 });
        MATTER.Body.setAngle(p, 0);
        MATTER.Body.setAngularVelocity(p, 0);
        p.plugin.graceMs = 1200;
        MATTER.Body.setStatic(p, true);
        resetActorForRetry();
      }
    }
  }

  function updatePropReset() {
    const limit = level.resetPropIfBelowY;
    if (limit == null) return;
    for (const p of state.props) {
      if (p.position.y > limit) {
        MATTER.Body.setPosition(p, p.plugin.home);
        MATTER.Body.setVelocity(p, { x: 0, y: 0 });
        MATTER.Body.setAngle(p, 0);
        MATTER.Body.setAngularVelocity(p, 0);
        p.plugin.graceMs = 1400;
        MATTER.Body.setStatic(p, true);
        fail('prop-lost');
        resetActorForRetry();
      }
    }
  }

  function step(frames) {
    const n = frames == null ? 1 : Math.max(1, frames | 0);
    const advanced = world.stepFrame(n, (subDt) => {
      if (state.actor && state.actor.active && state.status === 'playing') stepWalker(state.actor, world, subDt);
      // 造物落地缓冲：生成后 26 帧内限制下落速度，让“架在沟沿上”是可控而非撞运气
      for (const c of state.creatures) {
        for (const b of c.bodies) {
          if (b.plugin && b.plugin.landingFrames > 0) {
            b.plugin.landingFrames--;
            if (b.velocity.y > LANDING_MAX_FALL_SPEED) {
              MATTER.Body.setVelocity(b, { x: b.velocity.x, y: LANDING_MAX_FALL_SPEED });
            }
          }
        }
      }
    });
    const dt = advanced * FIXED_STEP_MS;
    state.elapsedMs += dt;
    // 造物落地后 600ms，小人开始行动（先让它掉下来、站稳）
    if (state.actor && !state.actor.active && state.actorReadyAt >= 0 && state.elapsedMs >= state.actorReadyAt) {
      state.actor.active = true;
      emit('actor:go', { label: state.actor.label });
    }
    // 南瓜掉河后的重试：歇够了农夫自己再走一趟
    if (state.actor && !state.actor.active && state.actorResumeAt >= 0 && state.elapsedMs >= state.actorResumeAt) {
      state.actorResumeAt = -1;
      state.actor.active = true;
      emit('actor:go', { label: state.actor.label, retry: true });
    }
    updateWalker(dt);
    updatePropGrace(dt);
    updatePropStall(dt);
    updatePropReset();
    updatePlates(dt);
    updatePlateSoftFail(dt);
    // 掉出世界的造物回收，避免越积越多
    for (const c of state.creatures.slice()) {
      const lowest = Math.max(...c.bodies.map((b) => b.position.y));
      if (lowest > CREATURE_DESPAWN_Y) {
        const id = c.id;
        despawnCreature(c);
        emit('creature:lost', { id });
      }
    }
    if (state.status === 'playing') checkGoal();
    return dt;
  }

  function snapshot() {
    const c = state.activeCreature;
    const geo = c ? c.geo : null;
    const main = c ? c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]) : null;
    return {
      levelId: level.id,
      title: level.title,
      status: state.status,
      elapsedMs: state.elapsedMs,
      failStreak: state.failStreak,
      hintLevel: state.hintLevel,
      chips: level.chips,
      armedAbilities: state.armedAbilities.slice(),
      creature: c ? {
        id: c.id, form: c.form,
        label: { beam: '梁', wheel: '轮', blob: '团块', container: '容器', rope: '绳', pile: '松散堆', grain: '颗粒' }[c.form] || c.form,
        degraded: c.degraded,
        mass: main ? main.mass : 0,
        parts: main ? main.parts.length - 1 : 0,
        bodies: c.bodies.length,
        abilities: c.abilities.slice(),
        mods: c.composed.mods,
        combos: c.composed.combos.map((x) => x.name),
        geo: geo ? {
          w: geo.bbox.w, h: geo.bbox.h, aspect: geo.aspect, area: geo.area,
          perimeter: geo.perimeter, closed: geo.closed, selfIntersect: geo.selfIntersect,
          nodes: geo.nodes, centroid: geo.centroid,
        } : null,
      } : null,
      plate: state.plates.map((p) => ({
        id: p.def.id, load: p.load, threshold: p.def.threshold, holdMs: p.holdMs, on: p.on,
      })),
      actorPos: state.actor ? { x: state.actor.body.position.x, y: state.actor.body.position.y } : null,
      propPos: state.props[0] ? { x: state.props[0].position.x, y: state.props[0].position.y } : null,
      hints: level.hints,
      guides: level.guides || [],
      degradeLog: state.degradeLog.slice(-5),
    };
  }

  function destroy() {
    for (const c of state.creatures.slice()) despawnCreature(c);
    world.clear();
  }

  return {
    state,
    level,
    spawnCreature,
    setAbility,
    step,
    snapshot,
    destroy,
    get status() { return state.status; },
    get creatures() { return state.creatures; },
  };
}
;
/* src/audio/audio-bus.js */
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

function createAudioBus() {
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
const AudioBus = createAudioBus();
;
/* src/text/lines.js */
/**
 * src/text/lines.js —— 台词表（P0 的 10 条 + 失败提示）
 * 语音一句话都不要硬写在画面代码里：画面只查 id，音频侧按 id 出声，无中文语音时同一份文本走气泡。
 */

const LINES = {
  l1_intro: { who: '农夫', text: '这条沟我跳了四十年。今天不跳了。' },
  l1_intro2: { who: '农夫', text: '能踩。它没抱怨。' },
  l1_win: { who: '农夫', text: '它比我信得过。' },
  common_fail1: { who: '农夫', text: '这玩意儿我踩上去就得下去。' },
  l2_intro: { who: '农夫', text: '它不肯走。它是方的。' },
  l2_win: { who: '农夫', text: '它动了！它自己动的。' },
  common_fail2: { who: '农夫', text: '它现在是一条鱼了。' },
  l3_intro: { who: '农夫', text: '这水泵要压足重量才出水，我站上去它不动。' },
  l3_win: { who: '农夫', text: '水出来了。你是造物主还是水电工？' },
  common_fail3: { who: '农夫', text: '压板连晃都没晃。' },
  stamp: { who: '画外音', text: '已阅。' },
  no_voice: { who: '画外音', text: '（这台设备没有中文语音，台词改由气泡显示）' },
};

/** 台词文本；未知 id 返回 null（调用方决定不显示） */
function lineText(id) {
  const l = LINES[id];
  return l ? l.text : null;
}

function lineWho(id) {
  const l = LINES[id];
  return l ? l.who : '';
}

/** 粗估语音时长（ms）。中文约 5.5 字/秒 → 每字 180ms + 起播 250ms */
function estimateSpeechMs(text) {
  if (!text) return 0;
  return 250 + text.length * 180;
}

/**
 * 关1 的硬约束：第 2 句「能踩。它没抱怨。」必须在盖章音效**之前**完整念完，
 * 剩余时间不够就丢弃这句、只留盖章（宁少一句，不许叠音）。
 */
function canFitBeforeStamp(text, remainingMs) {
  return estimateSpeechMs(text) <= Math.max(0, remainingMs);
}
;
/* src/level/levels/ch1-01.js */
/**
 * src/level/levels/ch1-01.js —— 关1 一个洞（难度 1，无机关）
 * 地形坐标一律 **中心点 + 宽高**（{x,y,w,h} 的 x/y 是 body 中心），旋转地形再加 angle。
 */
const LEVEL_CH1_01 = {
  id: 'ch1-01',
  chapter: 1,
  title: '一个洞',
  subtitle: '他过不去。画点什么。',
  chips: ['harden'],
  spawnY: 84,
  terrain: [
    { x: 73.5, y: 440, w: 187, h: 220, mat: 'ground' },   // 左岸 顶面 y=330（到 x=167）
    { x: 346.5, y: 440, w: 167, h: 220, mat: 'ground' },  // 右岸 顶面 y=330（从 x=263）
    { x: 215, y: 487, w: 96, h: 70, mat: 'ground' },      // 沟底 顶面 y=452（造物掉进去当装饰）
  ],
  actors: [{ kind: 'walker', x: 55, y: 314, targetX: 392, label: '农夫' }],
  props: [],
  plates: [],
  goal: { type: 'reachActor', x: 372, maxY: 392 },
  resetActorIfBelowY: 420,     // 掉进沟里超过这个 y 就判一次失败
  guides: [{ x: 167 }, { x: 263 }],
  hints: {
    highlight: [{ x: 167, y: 330, r: 26 }, { x: 263, y: 330, r: 26 }],
    beamOutline: { x1: 150, y1: 322, x2: 280, y2: 330 },
  },
  scenery: [
    { kind: 'line', x1: 0, y1: 330, x2: 430, y2: 330, width: 2 },
    { kind: 'text', x: 392, y: 306, text: '他的田', size: 11, align: 'right' },
    { kind: 'circle', x: 320, y: 318, r: 7 },
    { kind: 'circle', x: 345, y: 322, r: 6 },
    { kind: 'circle', x: 300, y: 324, r: 5 },
    { kind: 'rect', x: 40, y: 292, w: 46, h: 38 },
    { kind: 'line', x1: 62, y1: 273, x2: 40, y2: 292, width: 2 },
    { kind: 'line', x1: 62, y1: 273, x2: 86, y2: 292, width: 2 },
    { kind: 'text', x: 215, y: 470, text: '（沟）', size: 10, align: 'center' },
  ],
  lines: { intro: 'l1_intro', win: 'l1_win', failStreak: 'common_fail2', stamp: 'ch1_stamp' },
  failHints: ['再画长一点：梁要跨过整道沟。', '沟沿会发光——那也是能踩的地方。', '照虚线画一条，加上「变硬」。'],
};
;
/* src/level/levels/ch1-02.js */
/**
 * src/level/levels/ch1-02.js —— 关2 滚下去的南瓜（难度 2，无机关）
 *
 * ── 与 levels.md 的偏差（必读，README「与设计案的偏差」逐条同步）──────────────
 * levels.md 的三条参考解法都以「让南瓜滑/滚起来」为前提：① 圆轮 ② 变硬滑道 ③ 变硬雪橇。
 * 实测 matter-js 的摩擦求解器（tests/probe2.mjs，全部实测数据，不是推测）：
 *   · pair.friction = min(a,b)、pair.frictionStatic = max(a,b)，求解时相乘
 *     → 接触对里只要有一方 friction>0，切向相对速度就被清零：0.05 与 0.9 的停止距离都是 ≈8px
 *   · 只有 friction 恒为 0 才真的滑得起来（「圆的东西」在本引擎里的等价写法）
 *   · friction=0 的滑行体**任何 ≥5px 的台阶都会把它彻底卡死**（实测 5px 就停住）
 * 结论：本引擎里不存在「平地架桥 → 南瓜一路滑过去」——玩家画的梁一定会比岸面高一个梁厚。
 *
 * 本关只用一条可靠的物理事实：**南瓜只会往下走**。关卡几何为此专门设计：
 *   南瓜地平台(top 300) ── 落差 60px ──▶ 玩家架的桥（搭在两侧河岸 top 360 上，桥面 ≈351）
 *                                        ── 落差 9px ──▶ 集市河岸(top 360)
 *   · 玩家不架桥 → 南瓜滑出平台直接落进小河 → 重来（不惩罚，只是提示）
 *   · 桥只要「两头都搭到河岸上」就成立；桥面高度必须低于平台，所以桥越薄越贴、越厚越靠下，
 *     两种都成立 —— 这就是为什么「梁」和「厚团块」都能过，而「薄得像纸的团块」反而会卡住。
 *   → 教学点从「形状决定形态」偏向「强度」：南瓜落地 13.4kg，中缝会折的软梁接不住它，
 *     必须「变硬」把它冻成一块整的。
 *   → 「会滚」是**干扰芯片**：南瓜本身就是 friction=0 的滑行体，给桥面降摩擦毫无变化。
 *     已如实记录（README），不承当必需路径。
 */
const LEVEL_CH1_02 = {
  id: 'ch1-02',
  chapter: 1,
  title: '滚下去的南瓜',
  subtitle: '它不肯走。它是方的。',
  chips: ['harden', 'roll'],
  spawnY: 84,
  terrain: [
    { x: 115, y: 400, w: 230, h: 80, mat: 'ground' },   // 左岸 顶面 360，x 0..230
    { x: 85, y: 330, w: 170, h: 60, mat: 'ground' },    // 南瓜地平台 顶面 300，x 0..170
    { x: 385, y: 400, w: 90, h: 80, mat: 'ground' },    // 右岸（山脚集市）顶面 360，x 340..430
  ],
  actors: [],
  props: [{
    kind: 'pumpkin', x: 80, y: 269, w: 62, h: 62, label: '南瓜',
    graceMs: 999999,      // 先钉住，等玩家把桥架好再放手（releaseOnSpawn 改成 1.5s）
    releaseOnSpawn: true,
    vx0: 0.8,             // 农夫推的那一把：很小，但它再也不停
  }],
  plates: [],
  goal: { type: 'propReach', propIndex: 0, x: 372 },
  resetPropIfBelowY: 560,
  propReleaseDelayMs: 1500,   // 造物落地后 1.5s 南瓜才开始滑
  guides: [{ x: 230 }, { x: 340 }],
  hints: {
    highlight: [{ x: 230, y: 360, r: 22 }, { x: 340, y: 360, r: 22 }],
    beamOutline: { x1: 182, y1: 388, x2: 356, y2: 392 },
  },
  scenery: [
    { kind: 'line', x1: 0, y1: 300, x2: 170, y2: 300, width: 2 },
    { kind: 'line', x1: 170, y1: 300, x2: 170, y2: 360, width: 2 },
    { kind: 'line', x1: 0, y1: 360, x2: 230, y2: 360, width: 2 },
    { kind: 'line', x1: 340, y1: 360, x2: 430, y2: 360, width: 2 },
    { kind: 'line', x1: 230, y1: 372, x2: 340, y2: 372, width: 1.5, dash: true },
    { kind: 'text', x: 285, y: 512, text: '（小河，南瓜掉下去就成鱼了）', size: 10, align: 'center' },
    { kind: 'rect', x: 400, y: 334, w: 44, h: 26 },
    { kind: 'text', x: 400, y: 350, text: '集市', size: 10, align: 'center' },
    { kind: 'text', x: 60, y: 286, text: '南瓜地（高）', size: 10, align: 'center' },
  ],
  lines: { intro: 'l2_intro', win: 'l2_win', failStreak: 'common_fail2', stamp: null },
  failHints: [
    '南瓜只会往下走。桥要横在沟里、两头都搭到河岸上，让南瓜从高台落到桥面。',
    '中缝会折的软梁接不住 13kg 的南瓜，落地就塌——点「变硬」把它冻成一块整的。',
    '梁或团块都行，两头压住两岸，再点「变硬」。团块别画太厚，顶到高台边会挡住南瓜。',
  ],
};
;
/* src/level/levels/ch1-03.js */
/**
 * src/level/levels/ch1-03.js —— 关3 踩不动的水泵（难度 2，压板原型）
 * 唯一变量是「重量阈值」：农夫 1.8 压不动，团块 9.6 也压不动，变重后 28.8 才压得动。
 */
const LEVEL_CH1_03 = {
  id: 'ch1-03',
  chapter: 1,
  title: '踩不动的水泵',
  subtitle: '你踩不动我。别试了。',
  chips: ['harden', 'roll', 'heavy'],
  spawnY: 84,
  terrain: [
    { x: 215, y: 490, w: 430, h: 120, mat: 'ground' },     // 地面 顶面 y=430
    { x: 295, y: 424, w: 8, h: 14, mat: 'metal' },          // 踏板左挡边
    { x: 385, y: 424, w: 8, h: 14, mat: 'metal' },          // 踏板右挡边
  ],
  actors: [{ kind: 'walker', x: 55, y: 416, targetX: 340, label: '农夫' }],
  props: [],
  plates: [{
    id: 'pump',
    x: 299, y: 404, w: 82, h: 26,      // 判定区（矩形，用于 Query.region）
    threshold: 20,                      // 需要的持续重量 [待实测标定]
    label: '水泵踏板',
  }],
  goal: { type: 'plateSustained', plateId: 'pump' },
  resetActorIfBelowY: 9999,
  guides: [],
  hints: {
    highlight: [{ x: 340, y: 424, r: 34 }],
    beamOutline: null,
  },
  scenery: [
    { kind: 'line', x1: 0, y1: 430, x2: 430, y2: 430, width: 2 },
    { kind: 'rect', x: 340, y: 372, w: 56, h: 58 },          // 泵体
    { kind: 'circle', x: 340, y: 344, r: 13 },               // 泵头
    { kind: 'line', x1: 368, y1: 400, x2: 412, y2: 412, width: 3 }, // 出水管
    { kind: 'text', x: 340, y: 396, text: '30年', size: 10, align: 'center' },
    { kind: 'line', x1: 20, y1: 442, x2: 60, y2: 452, width: 1 },   // 干裂的地
    { kind: 'line', x1: 90, y1: 448, x2: 130, y2: 438, width: 1 },
    { kind: 'line', x1: 150, y1: 444, x2: 190, y2: 456, width: 1 },
    { kind: 'text', x: 105, y: 468, text: '田裂了', size: 10, align: 'center' },
  ],
  lines: { intro: 'l3_intro', win: 'l3_win', failStreak: 'common_fail2', stamp: 'ch1_stamp' },
  failHints: ['光靠你和一块小石头，压不动。', '「变重」——质量 ×3。', '把变重的东西丢到踏板上，然后走开。'],
};
;
/* src/main.js */
/**
 * src/main.js —— 组合根（composition root）：把平台实现、物理、渲染、音频、关卡装配成一局游戏。
 *
 * 依赖注入方向：main → (platform | physics | render | audio | level)，其余模块互不 import 实现。
 * 音频与物理的连接在这里订阅一次：world.onImpact(evt => AudioBus.play('collide', evt))
 * （数据流 physics → audio，注册动作 audio → physics，单向依赖）
 */




















const GAME_LEVELS = [LEVEL_CH1_01, LEVEL_CH1_02, LEVEL_CH1_03];
const GAME_CHAPTER_KEYS = [
  { rootHz: 293.66, mode: 0 },   // 关1 D 宫
  { rootHz: 293.66, mode: 1 },   // 关2 D 羽
  { rootHz: 220.0, mode: 1 },    // 关3 A 羽
];
const MAIN_THICKNESS = 9;
const MAIN_FRAME_CLAMP_MS = 50;

function mainNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function mainParam(name) {
  try { return new RegExp('(^|[?&])' + name + '=1').test(location.search); } catch (e) { return false; }
}

function boot() {
  const canvasEl = document.getElementById('game');
  if (!canvasEl) return null;

  const bus = createBus();
  const surface = createCanvasSurface(canvasEl);
  const staticLayer = createStaticLayer();
  const store = createLocalStorageSaveStore();
  const progress = loadProgress(store);

  const view = {
    levelIndex: 0,
    level: GAME_LEVELS[0],
    snapshot: null,
    debug: mainParam('debug'),
    impactDebugOn: mainParam('impactDebug'),
    impactDebug: null,
    bubble: null,
    win: false,
    winAt: 0,
    failFlash: 0,
    fps: 60,
    frameMs: 0,
    tier: 'high',
    bodyCount: 0,
    strokeCount: 0,
    audioOn: true,
    audioUnlocked: false,
    voiceMode: 'unknown',
    livePoints: 0,
    now: 0,
  };

  PerfGovernor.init();
  PerfGovernor.onChange = (t) => { view.tier = t; };
  view.tier = PerfGovernor.tier;
  if (Boot.wantsSkipFromQuery()) Boot.skipIntro();

  let world = null;
  let runtime = null;
  let sceneSeed = 1;
  let lastBubbleKey = '';
  let winTimer = 0;

  function say(lineId, ms) {
    const text = lineText(lineId);
    if (!text) return;
    view.bubble = { who: lineWho(lineId), text, until: mainNow() + (ms || 2600) };
    lastBubbleKey = lineId;
    // 有中文语音才出声；没有就静默走气泡（绝不拿英文嗓音念中文）
    AudioBus.speak(lineId, text);
    if (AudioBus.voiceMode === 'bubble') bus.emit('text:bubble', { lineId });
  }

  function toast(text, ms) {
    view.bubble = { who: '', text, until: mainNow() + (ms || 1800) };
  }

  function currentLevel() { return GAME_LEVELS[view.levelIndex]; }

  function buildWorld() {
    if (runtime) { try { runtime.destroy(); } catch (e) { /* noop */ } }
    if (world) { try { world.clear(); } catch (e) { /* noop */ } }
    BodyBudget.reset();
    StrokeBudget.reset();
    world = createPhysicsWorld({});
    // 音频唯一订阅点：碰撞音由物理侧每帧聚合、最多回调 1 次
    world.onImpact((evt) => AudioBus.play('collide', evt));
    view.level = currentLevel();
    runtime = createLevelRuntime({ level: view.level, world, bus });
    sceneSeed = 7 + view.levelIndex * 31;
    staticLayer.invalidate();
    view.win = false;
    view.failFlash = 0;
    view.snapshot = runtime.snapshot();
    const key = GAME_CHAPTER_KEYS[view.levelIndex] || GAME_CHAPTER_KEYS[0];
    AudioBus.setKey(key.rootHz, key.mode);
    if (capture) capture.reset();
  }

  function spawnFromStrokes(strokes) {
    if (!runtime || view.win) return;
    if (runtime.status === 'finished') return;
    const analysis = analyzeStrokeGroup(strokes);
    if (analysis.tooSmall) {
      toast('太小了，看不清画的是什么。画大一点。');
      return;
    }
    StrokeBudget.push(analysis.pointCount);
    if (runtime.state.activeCreature) {
      // 一次只有一个造物（阶段2 的简化：新画覆盖旧画）
      bus.emit('creature:replace', {});
    }
    const c = runtime.spawnCreature({ form: analysis.form, geo: analysis, thickness: MAIN_THICKNESS });
    if (c) {
      AudioBus.play('spawn');
      view.snapshot = runtime.snapshot();
    }
  }

  const capture = createStrokeCapture({
    audio: AudioBus,
    toDesign: surface.toDesign,
    bus,
    onGroup: spawnFromStrokes,
  });

  function retryLevel() {
    if (winTimer) { clearTimeout(winTimer); winTimer = 0; }
    buildWorld();
    say(view.level.lines.intro, 3200);
    if (view.levelIndex === 0) {
      setTimeout(() => { if (!view.win) say('l1_intro2', 2600); }, 2600);
    }
  }

  function nextLevel() {
    if (winTimer) { clearTimeout(winTimer); winTimer = 0; }
    view.levelIndex = Math.min(GAME_LEVELS.length - 1, view.levelIndex + 1);
    buildWorld();
    say(view.level.lines.intro, 3400);
  }

  function onWin(payload) {
    if (view.win) return;
    view.win = true;
    view.winAt = mainNow();
    AudioBus.play('win');
    const lv = view.level;
    progress.cleared[lv.id] = true;
    progress.maxUnlocked = Math.max(progress.maxUnlocked, Math.min(GAME_LEVELS.length, view.levelIndex + 2));
    progress.seconds = (progress.seconds || 0) + Math.round((payload.elapsedMs || 0) / 1000);
    saveProgress(store, progress);
    // 关1 的硬约束：第 2 句必须在盖章音效之前**完整**念完；时间不够就丢弃这句、只留盖章。
    if (view.levelIndex === 0) {
      say(lv.lines.win, 2400);
      const gapMs = 1600;
      const tail = lineText('l1_intro2');
      if (canFitBeforeStamp(tail, gapMs - 260)) {
        setTimeout(() => say('l1_intro2', 1800), gapMs);
        setTimeout(() => AudioBus.play('stamp'), gapMs + estimateSpeechMs(tail));
      } else {
        setTimeout(() => AudioBus.play('stamp'), gapMs);
      }
    } else {
      say(lv.lines.win, 2600);
      setTimeout(() => AudioBus.play('stamp'), 1400);
    }
    winTimer = setTimeout(() => { winTimer = 0; }, 600);
  }

  function onFail(payload) {
    AudioBus.play('fail');
    view.failFlash = 1;
    const lv = view.level;
    const hints = lv.failHints || [];
    const t = hints[Math.min(hints.length - 1, Math.max(0, (payload.hintLevel || 1) - 1))];
    if (t) toast(t, 2600);
    else if (lv.lines.failStreak) say(lv.lines.failStreak, 2400);
  }

  bus.on('level:win', onWin);
  bus.on('level:fail', onFail);
  bus.on('plate:on', () => AudioBus.play('ability'));
  bus.on('ability:rejected', () => {
    AudioBus.play('ui');
    toast('最多只能贴 2 个能力。', 1600);
  });

  // ---- 输入 ----
  function handleUiTap(x, y) {
    if (view.win) {
      if (mainNow() - view.winAt < 600) return true;
      if (view.levelIndex >= GAME_LEVELS.length - 1) { view.levelIndex = 0; buildWorld(); say(view.level.lines.intro, 3200); }
      else nextLevel();
      return true;
    }
    const btn = buttonAt(x, y);
    if (btn === 'retry') { AudioBus.play('ui'); retryLevel(); return true; }
    if (btn === 'audio') {
      view.audioOn = !view.audioOn;
      AudioBus.setEnabled(view.audioOn);
      AudioBus.play('ui');
      return true;
    }
    const ci = chipIndexAt(x, y);
    if (ci >= 0) {
      const id = (view.level.chips || [])[ci];
      if (!id || IMPLEMENTED_ABILITY_IDS.indexOf(id) < 0) return true;
      const r = runtime ? runtime.setAbility(id) : null;
      if (r && !r.rejected) {
        AudioBus.play('ability');
        if (getAbility(id) && getAbility(id).flags && getAbility(id).flags.rigid) toast('变硬：冻成一块整的。', 1400);
        view.snapshot = runtime.snapshot();
      }
      return true;
    }
    return false;
  }

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!AudioBus.unlocked) {
      AudioBus.unlockMedia();
      view.audioUnlocked = AudioBus.unlocked;
      view.voiceMode = AudioBus.voiceMode;
    }
    const p = surface.toDesign(ev.clientX, ev.clientY);
    if (handleUiTap(p.x, p.y)) { ev.preventDefault(); return; }
    try { canvasEl.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
    capture.handlers.down(ev);
  });
  canvasEl.addEventListener('pointermove', (ev) => capture.handlers.move(ev));
  canvasEl.addEventListener('pointerup', (ev) => capture.handlers.up(ev));
  canvasEl.addEventListener('pointercancel', () => capture.handlers.cancel());
  canvasEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'r' || ev.key === 'R') retryLevel();
    else if (ev.key === 'Escape') { view.levelIndex = 0; buildWorld(); }
    else if (ev.key === 'Enter') capture.flush();
  });
  window.addEventListener('resize', () => surface.resize());

  // ---- 场景静态层 ----
  function drawStatics(ctx) {
    const lv = view.level;
    const rc = staticLayer.rough;
    ctx.save();
    // 天空 / 地底
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#e8dfca');
    sky.addColorStop(1, '#f2ead8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, DESIGN_W, WORLD_H);
    ctx.fillStyle = '#e2d8c0';
    ctx.fillRect(0, BOOK_TOP, DESIGN_W, BOOK_H);
    // 地形
    for (const t of lv.terrain) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle || 0);
      const isIce = t.mat === 'ice';
      ctx.fillStyle = isIce ? 'rgba(196,226,232,0.85)' : '#cfc3a6';
      ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
      ctx.strokeStyle = '#5b5344';
      ctx.lineWidth = 2;
      ctx.strokeRect(-t.w / 2, -t.h / 2, t.w, t.h);
      ctx.restore();
    }
    // 沟的虚线
    for (const g of lv.guides || []) {
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(120,60,40,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(g.x, 150);
      ctx.lineTo(g.x, WORLD_H - 8);
      ctx.stroke();
      ctx.restore();
    }
    // 提示轮廓（只在第一次失败后出现）
    const showHint = (view.snapshot && view.snapshot.hintLevel > 0) && lv.hints && lv.hints.beamOutline;
    if (showHint) {
      const b = lv.hints.beamOutline;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(80,120,90,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.restore();
    }
    // 布景
    for (const s of lv.scenery || []) {
      if (s.kind === 'line') {
        ctx.save();
        if (s.dash) ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(70,62,50,0.7)';
        ctx.lineWidth = s.width || 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.restore();
      } else if (s.kind === 'rect') {
        ctx.strokeStyle = 'rgba(70,62,50,0.75)';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      } else if (s.kind === 'text') {
        ctx.fillStyle = 'rgba(90,80,64,0.8)';
        ctx.font = (s.size || 10) + 'px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = s.align || 'left';
        ctx.fillText(s.text, s.x, s.y);
        ctx.textAlign = 'left';
      }
    }
    if (rc) { rc.rectangle(0, 0, 1, 1, { stroke: 'none' }); }
    ctx.restore();
  }

  // ---- 动态层 ----
  function bodyPath(ctx, b) {
    const v = b.vertices;
    if (!v || !v.length) return false;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    return true;
  }

  function drawBodies(ctx) {
    if (!world) return;
    const bodies = world.allBodies();
    view.bodyCount = bodies.length;
    for (const b of bodies) {
      if (b.plugin && b.plugin.terrain) continue;
      if (b.label === 'plate') {
        ctx.fillStyle = b.plugin && b.plugin.on ? '#6d8f5f' : '#b8ab8d';
        if (bodyPath(ctx, b)) { ctx.fill(); ctx.strokeStyle = '#4d4638'; ctx.lineWidth = 2; ctx.stroke(); }
        continue;
      }
      if (b.label === 'prop') {
        ctx.fillStyle = '#d98b3a';
        if (bodyPath(ctx, b)) { ctx.fill(); ctx.strokeStyle = '#7a4718'; ctx.lineWidth = 2; ctx.stroke(); }
        continue;
      }
      if (b.label === 'actor') {
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, b.circleRadius || 14, 0, Math.PI * 2);
        ctx.fillStyle = '#4a6f8c';
        ctx.fill();
        ctx.strokeStyle = '#2c4457';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.position.x + 4, b.position.y - 4, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#f4efe2';
        ctx.fill();
        continue;
      }
      // 造物（含 compound 的子 parts）
      const parts = b.parts && b.parts.length > 1 ? b.parts.slice(1) : [b];
      for (const part of parts) {
        if (!part.vertices || !part.vertices.length) continue;
        if (part.circleRadius) {
          ctx.beginPath();
          ctx.arc(part.position.x, part.position.y, part.circleRadius, 0, Math.PI * 2);
        } else if (!bodyPath(ctx, part)) continue;
        const soft = b.plugin && b.plugin.soft;
        ctx.fillStyle = 'rgba(126,150,132,0.38)';
        ctx.fill();
        ctx.strokeStyle = '#33473b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  function drawBook(ctx) {
    drawPaper(ctx, 0, BOOK_TOP, DESIGN_W, BOOK_H);
    // 已落笔的笔画
    for (const s of capture.strokes) drawFreehandStroke(ctx, s.pts, 5);
    const live = capture.live;
    if (live && live.length) drawFreehandStroke(ctx, live, 5);
    view.livePoints = capture.pointCount + (live ? live.length : 0);
    view.strokeCount = capture.strokes.length + (live ? 1 : 0);
  }

  // ---- 主循环 ----
  let last = mainNow();
  let accum = 0;

  function frame() {
    const t = mainNow();
    let dt = t - last;
    last = t;
    if (dt > 200) dt = 16.7;
    accum += Math.min(MAIN_FRAME_CLAMP_MS, dt);
    const steps = Math.floor(accum / 16.666);
    accum -= steps * 16.666;
    const physStart = mainNow();
    if (runtime && view.win === false) runtime.step(Math.max(0, Math.min(3, steps)));
    else if (runtime && steps > 0) runtime.step(0);
    const physMs = mainNow() - physStart;
    if (view.win && steps > 0 && !winTimer) { /* 过关后不再推进物理 */ }

    view.now = t;
    view.frameMs = dt;
    view.fps = view.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
    PerfGovernor.sample(dt, physMs);
    if (view.failFlash > 0) view.failFlash = Math.max(0, view.failFlash - dt / 600);
    if (runtime) view.snapshot = runtime.snapshot();
    if (view.impactDebugOn && world) view.impactDebug = world.impactDebug;

    surface.beginFrame('#efe7d6');
    const ctx = surface.ctx;
    staticLayer.ensure(drawStatics);
    staticLayer.blit(ctx);
    drawBodies(ctx);
    drawBook(ctx);
    drawHud(ctx, view);
    surface.endFrame();
    requestAnimationFrame(frame);
  }

  buildWorld();
  requestAnimationFrame(frame);
  setTimeout(() => {
    if (view.levelIndex === 0) {
      say(view.level.lines.intro, 3200);
      setTimeout(() => { if (!view.win) say('l1_intro2', 2600); }, 2600);
    } else {
      say(view.level.lines.intro, 3200);
    }
  }, 240);

  return {
    view, bus, surface, store, progress,
    get runtime() { return runtime; },
    get world() { return world; },
    capture,
    retryLevel, nextLevel,
    version: APP_VERSION,
    schema: SAVE_SCHEMA_VERSION,
    key: SAVE_KEY_PROGRESS,
    lines: LINES,
    spawnFromStrokes,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const w = /** @type {any} */ (window);
  const start = () => {
    // 单文件游戏留一个句柄：自测脚本（tools/smoke-browser.mjs）与 ?debug=1 都靠它读状态
    try { w.__WCWZ__ = boot(); } catch (e) { w.__WCWZ_ERROR__ = String((e && e.stack) || e); throw e; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
})();
