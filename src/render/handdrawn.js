/**
 * src/render/handdrawn.js —— 手绘感渲染原语（rough.js 骨架线 + perfect-freehand 实时笔迹）
 * 只做“把线画出来”，不持有游戏状态。
 */
import { RenderQuality } from '../core/perf.js';

const ROUGH = typeof rough !== 'undefined' ? rough : null;
const FREEHAND = typeof perfectFreehand !== 'undefined' ? perfectFreehand : null;

let inkSeedCounter = 1;

export function nextInkSeed() {
  inkSeedCounter = (inkSeedCounter * 16807) % 2147483647;
  return inkSeedCounter;
}

/** 实时笔迹：perfect-freehand 轮廓 → 填充 */
export function drawFreehandStroke(ctx, pts, size) {
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

/**
 * 造物簿的纸面与格线。
 * 复审要求「底部不能看出纸面到此为止」：格线必须**一路画到页面最下沿**，
 * 并补两样一眼即认成"这是一整张纸"的东西——左侧装订线（双竖线）+ 右下页码。
 * 之前格线 alpha 0.18 太淡，截帧缩图后下半页看起来是空白块，故提到 0.26。
 */
export function drawPaper(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = '#f6f1e3';
  ctx.fillRect(x, y, w, h);
  // 格线：起点对齐 y+22，步长 22，一路画到 y+h-1（最后一根恒定落在页面内 1px 处）
  ctx.strokeStyle = 'rgba(120,108,86,0.26)';
  ctx.lineWidth = 1;
  for (let gy = y + 22; gy < y + h; gy += 22) {
    ctx.beginPath();
    ctx.moveTo(x + 8, gy + 0.5);
    ctx.lineTo(x + w - 8, gy + 0.5);
    ctx.stroke();
  }
  // 左侧装订线：双竖线，贯穿整页高度（最能证明"纸到底了"）
  ctx.strokeStyle = 'rgba(150,96,74,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 34.5, y + 1); ctx.lineTo(x + 34.5, y + h - 1); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,96,74,0.16)';
  ctx.beginPath(); ctx.moveTo(x + 38.5, y + 1); ctx.lineTo(x + 38.5, y + h - 1); ctx.stroke();
  // 页码：贴页脚右下，小幅墨迹
  ctx.fillStyle = 'rgba(90,80,64,0.55)';
  ctx.font = '10px ui-monospace,Menlo,Consolas,monospace';
  ctx.textAlign = 'right';
  ctx.fillText('— 1 —', x + w - 14, y + h - 7);
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'rgba(60,52,40,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.restore();
}

/**
 * 农夫（灰盒占位但必须"认得出是人"）：草帽 + 头 + 身 + 两臂 + 两腿，共 ~14 行。
 * 坐标按 body 中心给：脚踩 y+13.5，头顶 y-13，与 r=14 的物理圆一致。
 * phase 由移动距离累积，停下时脚合拢；face=+1 朝右 / -1 朝左。
 */
export function drawFarmer(ctx, cx, cy, opts) {
  const o = opts || {};
  const face = o.face == null ? 1 : (o.face < 0 ? -1 : 1);
  // 视觉放大（默认 1.5×，约 40px 高）：**以脚底为锚点**放大，脚永远踩在 cy+13.5，
  // 不会因为画大了就浮在地面上方（物理圆 r=14，底边 = cy+14）。
  const s = o.scale == null ? 1.5 : o.scale;
  const swing = Math.sin(o.phase || 0) * 3;
  const INK = '#3a352c';
  ctx.save();
  ctx.translate(cx, cy + 13.5);
  ctx.scale(face * s, s);
  ctx.translate(0, -13.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 地面投影
  ctx.fillStyle = 'rgba(90,80,64,0.16)';
  ctx.beginPath(); ctx.ellipse(0, 13.5, 10, 2.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK;
  // 腿
  ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(-4 + swing, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, 4); ctx.lineTo(4 - swing, 13); ctx.stroke();
  // 躯干
  ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(0, -4.2); ctx.lineTo(0, 4.6); ctx.stroke();
  // 手臂
  ctx.lineWidth = 2.1;
  ctx.beginPath(); ctx.moveTo(0, -2.6); ctx.lineTo(-6, 2.8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -2.6); ctx.lineTo(6 - swing * 0.6, 3.4); ctx.stroke();
  // 头
  ctx.beginPath(); ctx.arc(0.6, -8.4, 4.3, 0, Math.PI * 2);
  ctx.fillStyle = '#f3eddc'; ctx.fill();
  ctx.lineWidth = 1.7; ctx.stroke();
  // 草帽：帽檐 + 帽顶
  ctx.beginPath(); ctx.ellipse(0.6, -11.4, 8.4, 2.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#d9c69b'; ctx.fill();
  ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.arc(0.6, -11.1, 3.2, Math.PI, Math.PI * 2);
  ctx.fillStyle = '#cfba8c'; ctx.fill(); ctx.stroke();
  // 眼睛（朝右，让"面朝对岸"可读）
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(2.3, -8.8, 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function roughOptions(extra) {
  const base = { roughness: 1.1, bowing: 1.0, stroke: '#3a352c', strokeWidth: 2 };
  if (RenderQuality.fill) base.fill = 'rgba(122,116,96,0.20)';
  if (RenderQuality.shadow) base.fillStyle = 'hachure';
  return Object.assign(base, extra || {});
}

/** 骨干线：任意线（rough.canvas 的渲染器在 letterbox 变换下同样有效） */
export function drawRoughLine(rc, x1, y1, x2, y2, extra) {
  if (!rc) return;
  rc.line(x1, y1, x2, y2, roughOptions(extra));
}

export function drawRoughRect(rc, x, y, w, h, extra) {
  if (!rc) return;
  rc.rectangle(x, y, w, h, roughOptions(extra));
}

export function drawRoughCircle(rc, cx, cy, r, extra) {
  if (!rc) return;
  rc.circle(cx, cy, r * 2, roughOptions(extra));
}

export function drawRoughPolygon(rc, pts, extra) {
  if (!rc || !pts || pts.length < 2) return;
  rc.polygon(pts.map((p) => [p.x, p.y]), roughOptions(extra));
}

/** rough 渲染器（按 canvas 建一次） */
export function createRoughRenderer(canvasEl) {
  if (!ROUGH || !canvasEl) return null;
  try { return ROUGH.canvas(canvasEl); } catch (e) { return null; }
}
