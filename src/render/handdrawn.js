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

/** 造物簿的纸面与格线 */
export function drawPaper(ctx, x, y, w, h) {
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
