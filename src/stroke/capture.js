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
import { BOOK_TOP, DESIGN_H, DESIGN_W } from '../core/config.js';
import { SAMPLE_MIN_DIST, STROKE_MAX_POINTS, SUBMIT_COOLDOWN_MS } from './thresholds.js';

const CAPTURE_GROUP_WINDOW_MS = 700;
/** 笔迹摩擦音的限流间隔（规格 3.1 `sfx_penmove`：绘制中限流触发，≥[待实]ms 一次） */
const CAPTURE_PENMOVE_MS = 90;

export function createStrokeCapture(opts) {
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
  // ⚠️ 不能初始化成 0：performance.now() 在页面刚启动的前 90ms 内小于限流间隔，
  // 会让「第一笔永远不响摩擦音」——正确性不该依赖页面活了多久。每笔重置成 -1e9，
  // 语义也更对：每一次新落笔都是一次新的笔尖接触，本来就该响。
  let lastPenMove = -1e9;
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
    lastPenMove = -1e9;
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
    // 笔迹摩擦音：限流，不能每个采样点都响（那是噪音不是反馈）
    if (audio && now() - lastPenMove >= CAPTURE_PENMOVE_MS) {
      lastPenMove = now();
      audio.play('penmove');
    }
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
    if (audio) audio.play('penup');
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
