/**
 * src/render/scenery.js —— 程序化布景（纯装饰 · 无物理 · 零外部素材）
 *
 * 依据 docs/art-polish-spec.md 3.3「土体剖面纹理升级」（P0，全屏最高优先级）。
 * 目标：把原来「一块纯色板 + 9px 表土带 + 几条斜线」的土体，变成可读出层次的剖面：
 *   表土暗带 / 水平层理 / 斜向土纹 / 碎石 / 根须 / 潮斑 / 地表草簇。
 *
 * 三条硬约束（spec 红线）：
 *   · 不改任何关卡几何/物理/判定——本文件只画，不产生刚体；
 *   · 色值只从 art-polish-spec 第二节色板取（E1/E2/E4/I2/I3/E5），不出现表外 hex；
 *   · 确定性：用固定 seed 的局部 PRNG（mulberry32），同一关每次进入布局完全一致
 *     （注意：不用全局 nextInkSeed——它跨关卡递增、重进关卡布局会变）。
 *
 * 调用约定：drawSoilTexture 在「已 translate+rotate+clip 到土体矩形」的上下文里调用，
 * 坐标为刚体局部坐标 x∈[-w/2,w/2], y∈[-h/2,h/2]，顶面 y=-h/2；
 * drawSoilTufts 在 clip 之外调用（草要越过顶边长到地面上方）。
 */

/** mulberry32：确定性 PRNG，同 seed 同序列 */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 字符串哈希 → 稳定 seed */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * 土体剖面纹理（在 clip 内绘制，只画土面以下）。
 * @param {CanvasRenderingContext2D} ctx 已 translate+rotate+clip 的上下文
 * @param {number} w 土体宽
 * @param {number} h 土体高
 * @param {string} tier 'low' | 'mid' | 'high'
 * @param {string} seedKey 关卡稳定键（建议 levelId + 土体坐标）
 */
export function drawSoilTexture(ctx, w, h, tier, seedKey) {
  const rng = makeRng(hashStr(seedKey + ':tex'));
  const top = -h / 2;
  const mid = tier !== 'low';
  const high = tier === 'high';

  // ① 表土暗带 12px（E1）+ 3px 过渡
  ctx.fillStyle = 'rgba(120,104,74,0.30)';   // E1
  ctx.fillRect(-w / 2, top, w, 12);
  ctx.fillStyle = 'rgba(90,80,64,0.14)';
  ctx.fillRect(-w / 2, top + 12, w, 3);

  // ② 水平层理（mid/high）：每 16px 一条细横线，带 ±1px 抖动，避免机械重复
  if (mid) {
    ctx.strokeStyle = 'rgba(110,96,70,0.12)';
    ctx.lineWidth = 1;
    for (let y = top + 18; y < h / 2 - 2; y += 16) {
      const j = (rng() - 0.5) * 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y + j);
      ctx.lineTo(w / 2, y + j);
      ctx.stroke();
    }
  }

  // ③ 斜向土纹 hachure（mid/high）：保留原思路，间距 13
  if (mid) {
    ctx.strokeStyle = 'rgba(110,96,70,0.20)';  // E2 加强一点
    ctx.lineWidth = 1;
    for (let hx = -w / 2 - h; hx < w / 2; hx += 13) {
      ctx.beginPath();
      ctx.moveTo(hx, h / 2);
      ctx.lineTo(hx + h, top);
      ctx.stroke();
    }
  }

  // ④ 碎石（mid/high）：8–12 块椭圆，E4 填充 + I2 描边
  if (mid) {
    const n = 8 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + 6 + rng() * Math.max(1, w - 12);
      const y = top + 16 + rng() * Math.max(1, h - 24);
      const r = 3 + rng() * 2;
      ctx.fillStyle = 'rgba(120,110,96,0.55)';   // E4
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(91,83,68,0.60)';    // I2 淡
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // ⑤ 根须（mid/high）：2–3 条折线，从表土往下钻
  if (mid) {
    const roots = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < roots; i++) {
      let x = -w / 2 + 10 + rng() * Math.max(1, w - 20);
      let y = top + 2;
      ctx.strokeStyle = 'rgba(96,86,62,0.50)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rng() * 2);
      for (let s = 0; s < segs; s++) {
        x += (rng() - 0.5) * 10;
        y += 6 + rng() * 8;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ⑥ 潮斑（mid/high）：2–3 团大椭圆，极淡
  if (mid) {
    const spots = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < spots; i++) {
      const x = -w / 2 + 12 + rng() * Math.max(1, w - 24);
      const y = top + 20 + rng() * Math.max(1, h - 30);
      ctx.fillStyle = 'rgba(110,96,70,0.10)';
      ctx.beginPath();
      ctx.ellipse(x, y, 10 + rng() * 14, 6 + rng() * 8, rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // high 档追加一层极淡竖向压暗（增强"土体有厚度"）：非必需，仅锦上添花
  if (high) {
    const g = ctx.createLinearGradient(0, top, 0, h / 2);
    g.addColorStop(0, 'rgba(70,58,44,0.00)');
    g.addColorStop(1, 'rgba(70,58,44,0.10)');   // E5 方向
    ctx.fillStyle = g;
    ctx.fillRect(-w / 2, top, w, h);
  }
}

/**
 * 地表草簇（在 clip 之外绘制，可越过土体顶边长到地面上方）。
 * 全档保留；low 档稍矮。
 * @param {CanvasRenderingContext2D} ctx 仍处于土体 translate+rotate 的上下文（未 clip）
 * @param {number} w 土体宽
 * @param {number} h 土体高
 * @param {string} tier
 * @param {string} seedKey
 */
export function drawSoilTufts(ctx, w, h, tier, seedKey) {
  const rng = makeRng(hashStr(seedKey + ':tuft'));
  const top = -h / 2;
  const scale = tier === 'low' ? 0.8 : 1;
  const step = 34 + rng() * 12;
  ctx.strokeStyle = 'rgba(70,62,50,0.72)';   // I3
  ctx.lineWidth = 1;
  for (let x = -w / 2 + 6; x < w / 2 - 4; x += step) {
    const gx = x + (rng() - 0.5) * 6;
    const gh = (3 + rng() * 4) * scale;
    ctx.beginPath();
    ctx.moveTo(gx, top + 1); ctx.lineTo(gx - 2.2, top - gh);
    ctx.moveTo(gx, top + 1); ctx.lineTo(gx, top - gh - 1.5);
    ctx.moveTo(gx, top + 1); ctx.lineTo(gx + 2.2, top - gh);
    ctx.stroke();
  }
}

/**
 * 纸面颗粒（art-polish 3.6）：确定性撒 ~160 个 1px 点，给「纸的牙口」。
 * 只在场景带内调用（正文/造物簿区不撒点，保证文字可读）。low 档由调用方决定是否跳过。
 */
export function drawPaperGrain(ctx, w, h, seedKey) {
  const rng = makeRng(hashStr((seedKey || 'scene') + ':grain'));
  ctx.fillStyle = 'rgba(60,52,40,0.05)';
  const n = Math.round((w * h) / 1400);     // 面积自适应，约 160 个 @430×513
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * 场景暗角（art-polish 3.6）：径向渐变，中心透明 → 四角极淡压暗，增强聚焦。
 */
export function drawSceneVignette(ctx, w, h) {
  const g = ctx.createRadialGradient(w / 2, h * 0.42, h * 0.18, w / 2, h * 0.42, h * 0.82);
  g.addColorStop(0, 'rgba(60,50,36,0)');
  g.addColorStop(1, 'rgba(60,50,36,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 第四章：逐关场景元素（art-polish-spec 四章 · 每关 5 个 · 全部纯装饰无物理）
 *
 * 命名遵循规格第九章：静态 drawSc_[元素] / 动态 drawAm_[元素]。
 * 全部确定性（同关重进布局一致），全部只用色板令牌。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 一块小碎石：椭圆 E4 填 + I2 描边（L1-5 / L3-5 共用） */
function SC_stone(ctx, x, y, rx, ry) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0.3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(120,110,96,0.55)';   // E4
  ctx.fill();
  ctx.strokeStyle = '#5B5344';               // I2
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * L1-5 洞口边缘石 + 内壁深度（本关重点）。
 * 现在的洞读起来是「贴了块黑胶布」；加上沿高光 + 内壁竖纹 + 边缘石后读成「地表的一个坑」。
 * 参数沿用 chasm 的 { x1, x2, y, depth }，不改关卡数值。
 */
export function drawSc_PitDepth(ctx, s, seedKey, tier) {
  const rng = makeRng(hashStr((seedKey || 'pit') + ':pit'));
  const d = s.depth || 80;
  const top = s.y;
  ctx.save();
  // ① 上沿内投影：贴洞口一圈 2px 暗边，读成"口沿的厚度"
  const eg = ctx.createLinearGradient(0, top, 0, top + 10);
  eg.addColorStop(0, 'rgba(0,0,0,0.18)');
  eg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = eg;
  ctx.fillRect(s.x1, top, s.x2 - s.x1, 10);
  // ② 上沿高光：两侧口沿各一条亮线（纸感，不是塑料高光）
  ctx.strokeStyle = 'rgba(240,236,220,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(s.x1 + 1.5, top + 1.5); ctx.lineTo(s.x2 - 1.5, top + 1.5); ctx.stroke();
  // ③ 内壁竖纹：3 条，只在 mid/high（low 档内壁保持干净，省笔数）
  if (tier !== 'low') {
    ctx.strokeStyle = 'rgba(90,84,70,0.5)';   // I3 系
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const x = s.x1 + (s.x2 - s.x1) * (0.18 + 0.32 * i) + (rng() - 0.5) * 8;
      const len = d * (0.34 + rng() * 0.26);
      ctx.beginPath();
      ctx.moveTo(x, top + 6);
      ctx.lineTo(x + (rng() - 0.5) * 5, top + 6 + len);
      ctx.stroke();
    }
  }
  // ④ 口沿边缘石：左右各 2 块，压在地平线上（不是悬空）
  SC_stone(ctx, s.x1 - 1, top - 2, 4.6, 2.8);
  SC_stone(ctx, s.x1 + 7, top - 1.6, 3.2, 2.1);
  SC_stone(ctx, s.x2 + 1, top - 2, 4.2, 2.6);
  SC_stone(ctx, s.x2 - 7, top - 1.6, 3.0, 2.0);
  ctx.restore();
}

/**
 * L1-4 / L2-2 草垛：半圆弧 + 放射 5 线（E1 填 + I3 描），与草簇同一语言。
 */
export function drawSc_Haystack(ctx, s, seedKey) {
  const rng = makeRng(hashStr((seedKey || 'hay') + ':hay'));
  const w = s.w || 26;
  const h = s.h || 15;
  const x = s.x;
  const y = s.y;
  ctx.save();
  // 垛体：下半矩形 + 上半弧（干草堆的剪影）
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.lineTo(x - w / 2, y - h * 0.45);
  ctx.quadraticCurveTo(x, y - h * 1.22, x + w / 2, y - h * 0.45);
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(120,104,74,0.30)';   // E1
  ctx.fill();
  ctx.strokeStyle = 'rgba(70,62,50,0.72)';   // I3
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 放射草纹 5 条
  ctx.strokeStyle = 'rgba(70,62,50,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI * 0.86 + (Math.PI * 0.72) * (i / 4) + (rng() - 0.5) * 0.08;
    ctx.beginPath();
    ctx.moveTo(x, y - h * 0.18);
    ctx.lineTo(x + Math.cos(a) * w * 0.46, y - h * 0.18 + Math.sin(a) * h * 0.95);
    ctx.stroke();
  }
  // 地面散 3 根稻草
  ctx.strokeStyle = 'rgba(96,86,62,0.5)';
  for (let i = 0; i < 3; i++) {
    const sx = x + (rng() - 0.5) * w * 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, y + 1);
    ctx.lineTo(sx + (rng() - 0.5) * 7, y + 1 + (rng() - 0.5) * 2.5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L2-3 远景摊位剪影：矮摊（顶棚线 + 两根竖杆 + 货品 3 小弧），I4 淡线。
 * 目的只有一个——背景不空。
 */
export function drawSc_Stall(ctx, s) {
  const x = s.x;
  const y = s.y;
  const w = s.w || 40;
  const h = s.h || 22;
  ctx.save();
  ctx.strokeStyle = 'rgba(90,84,70,0.38)';   // I4
  ctx.lineWidth = 1.1;
  // 顶棚：略斜的一条，两端微微翘（不是标准矩形，避免读成建筑图）
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h * 0.55);
  ctx.quadraticCurveTo(x, y - h * 0.86, x + w / 2, y - h * 0.55);
  ctx.stroke();
  // 两根竖杆
  ctx.beginPath();
  ctx.moveTo(x - w / 2 + 3, y - h * 0.56); ctx.lineTo(x - w / 2 + 3, y);
  ctx.moveTo(x + w / 2 - 3, y - h * 0.56); ctx.lineTo(x + w / 2 - 3, y);
  ctx.stroke();
  // 货品：台面上 3 个小弧
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const gx = x - w * 0.28 + (w * 0.28) * i;
    ctx.moveTo(gx - 3.6, y - 1);
    ctx.quadraticCurveTo(gx, y - 6.2, gx + 3.6, y - 1);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * L2-4 沟沿木桩 + 垂绳：强化「别掉下去」。
 * posts: [[x,y],...] 的世界坐标；桩间连一条下垂的绳（贝塞尔 2 笔）。
 */
export function drawSc_Stakes(ctx, s, tier) {
  ctx.save();
  // 垂绳先画（在桩后面）
  if (tier !== 'low' && s.rope) {
    const [a, b] = s.rope;
    ctx.strokeStyle = 'rgba(70,62,50,0.6)';   // I3
    ctx.lineWidth = 1.1;
    const sag = s.sag || 12;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1] + 2);
    ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag, b[0], b[1] + 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(70,62,50,0.34)';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1] + 4);
    ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + sag + 3, b[0], b[1] + 4);
    ctx.stroke();
  }
  for (const p of s.posts || []) {
    const [px, py] = p;
    // 桩身：短竖（略斜）
    ctx.strokeStyle = '#5B5344';              // I2
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 1.2, py - (s.h || 12));
    ctx.stroke();
    // 斜帽：桩顶被敲过的小斜面
    ctx.strokeStyle = 'rgba(70,62,50,0.72)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(px - 2.6, py - (s.h || 12) - 1.5);
    ctx.lineTo(px + 3.6, py - (s.h || 12) + 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L2-5 收货口棚布升级：褶线 4 条 + 边缘扇贝 6 弧 + C5 微赭 wash。
 * 让漏斗读成"软棚布"而不是"木框"。
 */
export function drawSc_CanopyFold(ctx, s, tier) {
  const x = s.x;
  const y = s.y;
  const w = s.w || 80;
  const h = s.h || 16;
  ctx.save();
  // 微赭 wash（A2 调性，极淡）
  ctx.fillStyle = 'rgba(196,150,96,0.10)';    // A2
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  // 褶线 4 条：放射状，从中心向两侧散开
  ctx.strokeStyle = 'rgba(90,80,64,0.35)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 4; i++) {
    const fx = x - w / 2 + (w / 5) * (i + 1);
    ctx.beginPath();
    ctx.moveTo(fx, y - h / 2 + 1);
    ctx.lineTo(fx + (fx - x) * 0.12, y + h / 2 - 1);
    ctx.stroke();
  }
  // 扇贝边 6 弧（低档删）
  if (tier !== 'low') {
    ctx.strokeStyle = 'rgba(96,86,62,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ax = x - w / 2 + (w / n) * i;
      ctx.moveTo(ax, y + h / 2 - 1);
      ctx.quadraticCurveTo(ax + w / (n * 2), y + h / 2 + 3.4, ax + w / n, y + h / 2 - 1);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L2-1 布幡：杆 + 三角旗（静态底）。旗面本身由 drawAm_Pennant 每帧摆动，
 * 这里只画杆与旗的固定锚点，避免静态层里出现"待动的旗"。
 */
export function drawSc_PennantPole(ctx, s) {
  ctx.save();
  ctx.strokeStyle = '#5B5344';                // I2
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x, s.y - (s.h || 60));
  ctx.stroke();
  ctx.restore();
}

/**
 * L3-1 水面（静态部分）：不规则水塘 W0 底 + W2 水平波纹。
 * 高光由 drawAm_WaterGlint 每帧轻微平移。
 */
export function drawSc_Water(ctx, s, seedKey) {
  const rng = makeRng(hashStr((seedKey || 'water') + ':water'));
  const x = s.x;
  const y = s.y;
  const w = s.w || 92;
  const h = s.h || 90;
  ctx.save();
  // 水面：上下沿不是直线（用二次曲线做出水塘的不规则轮廓）
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.quadraticCurveTo(x - w * 0.2, y - 4, x + w * 0.16, y - 1);
  ctx.quadraticCurveTo(x + w * 0.5, y + 3, x + w / 2, y + h * 0.5);
  ctx.lineTo(x + w / 2 - 4, y + h);
  ctx.quadraticCurveTo(x, y + h + 5, x - w / 2 + 3, y + h * 0.72);
  ctx.closePath();
  ctx.fillStyle = 'rgba(150,178,168,0.30)';   // W0
  ctx.fill();
  ctx.strokeStyle = 'rgba(110,140,132,0.45)'; // W2
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 水平波纹 3–5 条
  ctx.strokeStyle = 'rgba(110,140,132,0.45)';
  ctx.lineWidth = 1;
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const wy = y + 10 + (h - 20) * ((i + 0.5) / n) + (rng() - 0.5) * 6;
    const wx = x - w / 2 + 8 + rng() * (w * 0.3);
    const ww = w * (0.28 + rng() * 0.34);
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.quadraticCurveTo(wx + ww / 2, wy - 2.2, wx + ww, wy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L3-2 芦苇 / 香蒲：杆（I3 竖）+ 2–3 片叶（斜线）+ 香蒲头（短粗棒 E1）。
 * 摆动由 drawAm_Reeds 处理（只摆 s.sway 指定的 2 根）。
 */
export function drawSc_Reeds(ctx, s, seedKey) {
  const rng = makeRng(hashStr((seedKey || 'reed') + ':reed'));
  const n = s.n || 7;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const rx = s.x1 + (s.x2 - s.x1) * (n === 1 ? 0.5 : i / (n - 1)) + (rng() - 0.5) * 5;
    const hh = (s.h || 30) * (0.72 + rng() * 0.5);
    const lean = (rng() - 0.5) * 5;
    const swayIdx = (s.sway || []).indexOf(i);
    // 杆
    ctx.strokeStyle = 'rgba(70,62,50,0.72)';   // I3
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(rx, s.y);
    ctx.quadraticCurveTo(rx + lean * 0.4, s.y - hh * 0.6, rx + lean, s.y - hh);
    ctx.stroke();
    // 叶 2–3 片
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,62,50,0.55)';
    for (let k = 0; k < 2 + (rng() > 0.5 ? 1 : 0); k++) {
      const ly = s.y - hh * (0.4 + k * 0.22);
      const dir = k % 2 ? 1 : -1;
      ctx.beginPath();
      ctx.moveTo(rx + lean * (0.4 + k * 0.22), ly);
      ctx.quadraticCurveTo(rx + dir * 7, ly - 3, rx + dir * 11, ly - 6.5);
      ctx.stroke();
    }
    // 香蒲头：短粗棒（E1 填 + I3 描）
    if (swayIdx >= 0 || rng() > 0.45) {
      const hx = rx + lean;
      const hy = s.y - hh;
      ctx.beginPath();
      ctx.ellipse(hx, hy - 4, 1.9, 5.2, lean * 0.02, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,104,74,0.30)'; // E1
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,62,50,0.72)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * L3-4 泵体锈迹 + 苔藓 + 出水口滴线：让泵有"三十年了"的旧感。
 */
export function drawSc_Rust(ctx, s, tier) {
  ctx.save();
  // 锈迹 3 条竖短折线（C5 @.5 —— 赭红，允许饱和但面积极小）
  ctx.strokeStyle = 'rgba(166,96,58,0.5)';
  ctx.lineWidth = 1.4;
  const rx = s.x - s.w / 2 + 6;
  for (let i = 0; i < 3; i++) {
    const px = rx + (s.w - 12) * (0.22 + 0.3 * i);
    const py = s.y - s.h / 2 + 8;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + 1.6, py + 8);
    ctx.lineTo(px - 1.2, py + 15);
    ctx.stroke();
  }
  // 苔藓 3 团（C0 @.35，低档删）
  if (tier !== 'low') {
    ctx.fillStyle = 'rgba(63,107,79,0.35)';    // C0
    for (let i = 0; i < 3; i++) {
      const mx = s.x - s.w / 2 + 10 + (s.w - 20) * (i / 2);
      ctx.beginPath();
      ctx.arc(mx, s.y + s.h / 2 - 3, 3.4, Math.PI, Math.PI * 2);
      ctx.fill();
    }
  }
  // 出水口滴线 1 条（W2）
  if (s.drip) {
    ctx.strokeStyle = 'rgba(110,140,132,0.45)'; // W2
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(s.drip[0], s.drip[1]);
    ctx.lineTo(s.drip[0] + 0.8, s.drip[1] + 9);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * L3-5 干裂纹：主干 1 条 + 3–4 条分叉（E5）+ 2–3 块翘起土片（E0 + I2）。
 * 低档只画主干。
 */
export function drawSc_Cracks(ctx, s, seedKey, tier) {
  const rng = makeRng(hashStr((seedKey || 'crack') + ':crack'));
  ctx.save();
  ctx.strokeStyle = 'rgba(70,58,44,0.60)';    // E5
  ctx.lineWidth = 1.2;
  const branches = tier === 'low' ? 0 : 3 + Math.floor(rng() * 2);
  for (let b = 0; b <= branches; b++) {
    const isMain = b === 0;
    const sx = s.x1 + (s.x2 - s.x1) * (isMain ? 0.12 : 0.3 + rng() * 0.62);
    const sy = s.y + (rng() - 0.5) * 6;
    const segs = isMain ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let px = sx;
    let py = sy;
    const dirX = isMain ? 1 : (rng() - 0.5) * 1.4;
    for (let k = 0; k < segs; k++) {
      px += ((s.x2 - s.x1) / segs) * 0.55 * dirX + (rng() - 0.5) * 4;
      py += (rng() - 0.5) * 7;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // 翘起土片（低档删）
  if (tier !== 'low') {
    for (let i = 0; i < 3; i++) {
      const fx = s.x1 + (s.x2 - s.x1) * (0.2 + rng() * 0.6);
      const fy = s.y + 6 + rng() * 12;
      ctx.beginPath();
      ctx.moveTo(fx - 5, fy);
      ctx.lineTo(fx, fy - 3.2);
      ctx.lineTo(fx + 5, fy + 0.6);
      ctx.closePath();
      ctx.fillStyle = '#CFC3A6';              // E0
      ctx.fill();
      ctx.strokeStyle = '#5B5344';            // I2
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ══════════════════════════════════════════════════════════════════════════
 * 动态层（每帧 · 纯 canvas · 禁 rough）
 *
 * 预算（art-polish 6.3）：风 ≤4 / 水光 ≤3 / 涟漪 ≤2 / 布幡+芦苇 ≤3，合计 ≤12 笔/帧。
 * 全部在 drawAmbient 里统一裁剪到 0..BOOK_TOP——动效永不越界进造物簿。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 风：2–3 条横向短线匀速右漂 + 1 片飘叶。超出右边界后从左侧回收（无分配、无状态） */
function drawAm_Wind(ctx, s, t) {
  const n = 3;
  const y0 = s.y || 250;
  ctx.save();
  ctx.strokeStyle = 'rgba(120,110,90,0.35)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([9, 7]);
  for (let i = 0; i < n; i++) {
    const period = 6.5 + i * 1.7;                       // 各线速度不同，避免整齐得像传送带
    const phase = ((t / period) + i * 0.37) % 1;
    const len = 24 + i * 8;
    const x = -len + phase * (DESIGN_W_AM + len * 2);
    const y = y0 + i * 26 + Math.sin(t * 0.7 + i) * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // 飘叶：1 片小弧，走一条缓慢的横向+上下摆动轨迹
  const lp = (t / 11) % 1;
  const lx = -20 + lp * (DESIGN_W_AM + 40);
  const ly = y0 + 58 + Math.sin(t * 1.3) * 9;
  ctx.strokeStyle = 'rgba(96,86,62,0.5)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.quadraticCurveTo(lx + 5, ly - 3.4, lx + 10, ly);
  ctx.quadraticCurveTo(lx + 5, ly + 2.6, lx, ly);
  ctx.stroke();
  ctx.restore();
}

/** 水面高光：3 段短杠，随时间正弦平移 ±1.5px（低档由调用方跳过） */
function drawAm_WaterGlint(ctx, s, t) {
  const w = s.w || 92;
  ctx.save();
  ctx.strokeStyle = 'rgba(240,246,240,0.55)';   // W1
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    const gy = s.y + 18 + (s.h || 90) * 0.24 * i;
    const gx = s.x - w * 0.24 + Math.sin(t * 0.9 + i * 2.1) * 1.5;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + w * (0.26 - i * 0.04), gy);
    ctx.stroke();
  }
  ctx.restore();
}

/** 涟漪：2 个同心椭圆环，半径 6→18 周期扩散 + alpha 0.45→0 淡出（错相位） */
function drawAm_Ripple(ctx, s, t) {
  ctx.save();
  ctx.strokeStyle = 'rgba(110,140,132,0.45)';   // W2
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 2; i++) {
    const p = ((t / 2.6) + i * 0.5) % 1;
    const r = 6 + p * 12;
    ctx.globalAlpha = 0.45 * (1 - p);
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/** 布幡：三角旗，旗尖随时间 ±3px 摆（静态杆由 drawSc_PennantPole 画） */
function drawAm_Pennant(ctx, s, t) {
  const top = s.y - (s.h || 60);
  ctx.save();
  for (let i = 0; i < (s.flags || 2); i++) {
    const fy = top + 6 + i * 13;
    const swing = Math.sin(t * 1.9 + i * 1.3) * 3;
    ctx.beginPath();
    ctx.moveTo(s.x, fy);
    ctx.lineTo(s.x + 20, fy + 4 + swing * 0.5);
    ctx.lineTo(s.x, fy + 11);
    ctx.closePath();
    ctx.fillStyle = 'rgba(166,96,58,0.7)';      // C5 @.7
    ctx.fill();
    ctx.strokeStyle = '#5B5344';                // I2
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/** 芦苇摆动：只摆 s.sway 指定的 2 根，顶部 ±1.5px */
function drawAm_ReedsSway(ctx, s, t) {
  const n = s.n || 7;
  ctx.save();
  ctx.strokeStyle = 'rgba(70,62,50,0.6)';
  ctx.lineWidth = 1.3;
  for (const i of s.sway || []) {
    const rx = s.x1 + (s.x2 - s.x1) * (n === 1 ? 0.5 : i / (n - 1));
    const hh = (s.h || 30) * 0.95;
    const tipX = rx + Math.sin(t * 1.5 + i) * 1.5;
    ctx.beginPath();
    ctx.moveTo(rx, s.y - hh * 0.55);
    ctx.quadraticCurveTo(rx, s.y - hh * 0.8, tipX, s.y - hh);
    ctx.stroke();
  }
  ctx.restore();
}

/** 场景带宽（与 config DESIGN_W 一致；此处避免再引入一层 import 依赖） */
const DESIGN_W_AM = 430;

/**
 * 动态布景统一入口（art-polish 第九章）：在 drawBodies 之后、drawBook 之前调用。
 * 内部裁剪到 0..BOOK_TOP——动效绝不越界进造物簿。
 * @param {number} t 秒
 * @param {string} tier 'low' | 'mid' | 'high'；low 档只保留农夫相关，环境动效全关
 */
export function drawAmbient(ctx, level, t, tier, bookTop) {
  if (!level || !level.scenery) return;
  if (tier === 'low') return;                  // 6.3：low 档环境动效全关
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, DESIGN_W_AM, bookTop || 513);
  ctx.clip();
  for (const s of level.scenery) {
    if (s.kind === 'wind') drawAm_Wind(ctx, s, t);
    else if (s.kind === 'water') drawAm_WaterGlint(ctx, s, t);
    else if (s.kind === 'ripple') drawAm_Ripple(ctx, s, t);
    else if (s.kind === 'pennant') drawAm_Pennant(ctx, s, t);
    else if (s.kind === 'reeds') drawAm_ReedsSway(ctx, s, t);
  }
  ctx.restore();
}
