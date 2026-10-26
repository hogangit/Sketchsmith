/**
 * src/render/canvas.js —— 画布与坐标（DPR 硬 cap 2、design 430×932 letterbox、静态层缓存）
 * 所有渲染都在 design 坐标系里进行；输入用 toDesign() 反算。
 */
import { DESIGN_H, DESIGN_W } from '../core/config.js';
import { RENDER_DPR_CAP } from '../core/perf.js';
import { createRoughRenderer } from './handdrawn.js';

export function createCanvasSurface(canvasEl) {
  const ctx = canvasEl.getContext('2d', { alpha: false });
  let dpr = 1;
  let scale = 1;
  let offX = 0;
  let offY = 0;
  let cssW = DESIGN_W;
  let cssH = DESIGN_H;

  function resize() {
    // 用 CSS 盒子尺寸（position:fixed;inset:0;100%），不用 innerHeight：
    // innerHeight 在部分移动端比可视区高，会留出底部死区。
    cssW = Math.max(320, Math.floor(canvasEl.clientWidth || window.innerWidth || DESIGN_W));
    cssH = Math.max(400, Math.floor(canvasEl.clientHeight || window.innerHeight || DESIGN_H));
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
export function createStaticLayer() {
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
