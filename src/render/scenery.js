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
