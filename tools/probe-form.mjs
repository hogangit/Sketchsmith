/**
 * tools/probe-form.mjs —— 形态识别探针：玩家常见的十几种笔画，最后到底变成了什么刚体
 *
 * 干什么：把一组"人真的会这样画"的笔画喂给 analyzeStrokeGroup + buildCreatureBody，
 *        打印 form / degraded / 最终刚体是真多边形还是**圆**，看有没有"画什么都变圆"。
 *
 * ⚠️ 用途限制：**本探针缺少 poly-decomp**（node 里 `Matter.Common.setDecomp` 不生效，
 *    matter 会把凹多边形退化成凸包，日志里会出现 "Install the 'poly-decomp' library"）。
 *    ⇒ **只有 form 分类可信，degraded/刚体形状不可信**。
 *    要核对刚体真实结果请用 `tools/probe-form-browser.mjs`（真浏览器，decomp 齐全）。
 *
 * 用法：node tools/probe-form.mjs
 */
import { loadGameEnv } from '../tests/helpers/env.mjs';

const env = await loadGameEnv();
const { classify, bodyFactory } = env;

// ── 笔画生成器（坐标都在造物簿里，y≈700，和真机一致）──────────────────────────
const line = (x1, y1, x2, y2, n = 26) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
  }
  return pts;
};
/** 闭合矩形轮廓：真正的"画个方框"（带手抖） */
function rectOutline(cx, cy, w, h, jitter = 0.6) {
  const hw = w / 2, hh = h / 2;
  const corners = [
    [cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh], [cx - hw, cy - hh],
  ];
  const pts = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const steps = Math.max(6, Math.round(Math.hypot(bx - ax, by - ay) / 6));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push({ x: ax + (bx - ax) * t + (Math.random() - 0.5) * jitter, y: ay + (by - ay) * t + (Math.random() - 0.5) * jitter });
    }
  }
  pts.push({ x: corners[4][0], y: corners[4][1] });
  return pts;
}
/** 闭合圆/椭圆 */
function ellipseOutline(cx, cy, rx, ry, n = 26) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}
/** 闭合三角 */
function triOutline(cx, cy, r) {
  const pts = [];
  for (const i of [0, 1, 2, 0]) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    const prev = pts[pts.length - 1];
    if (prev) {
      const steps = 8;
      for (let s = 1; s <= steps; s++) pts.push({ x: prev.x + (px - prev.x) * (s / steps), y: prev.y + (py - prev.y) * (s / steps) });
    } else pts.push({ x: px, y: py });
  }
  return pts;
}
/** L 形（两条折线，单笔）*/
function lShape(x, y, w, h) {
  return [...line(x, y, x, y + h, 14), ...line(x, y + h, x + w, y + h, 14)];
}
/** 涂鸦（来回乱线）*/
function scribble(cx, cy, w, h) {
  const pts = [];
  for (let i = 0; i < 60; i++) {
    const t = i / 59;
    pts.push({ x: cx - w / 2 + w * t, y: cy + Math.sin(t * Math.PI * 4) * h / 2 });
  }
  return pts;
}

const CASES = [
  { name: '水平直线（关4 弹簧板）', pts: line(110, 700, 180, 702) },
  { name: '斜线', pts: line(120, 700, 190, 730) },
  { name: '短横线（放大版短划线）', pts: line(150, 700, 190, 701) },
  { name: '长闭合矩形（当板画）', pts: rectOutline(180, 700, 140, 18) },
  { name: '中等闭合矩形', pts: rectOutline(200, 700, 80, 30) },
  { name: '正方轮廓', pts: rectOutline(200, 700, 50, 50) },
  { name: '圆/椭圆轮廓', pts: ellipseOutline(200, 700, 30, 26) },
  { name: '三角轮廓', pts: triOutline(200, 700, 32) },
  { name: 'L 形（开口）', pts: lShape(160, 690, 50, 40) },
  { name: '涂鸦来回线', pts: scribble(200, 700, 90, 50) },
  { name: '很小的圆（墨点）', pts: ellipseOutline(200, 700, 5, 5, 16) },
  { name: '闭合不规则团', pts: ellipseOutline(200, 700, 26, 18, 30).map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * 6, y: p.y + Math.cos(i * 1.3) * 5 })) },
];

console.log('[probe-form] 形态识别：' + CASES.length + ' 种笔画\n');
console.log('笔画'.padEnd(24) + 'form'.padEnd(10) + '闭合'.padEnd(6) + '长宽比'.padEnd(8) + '面积'.padEnd(8) + 'degraded'.padEnd(12) + '刚体');
console.log('-'.repeat(96));
let circleCount = 0;
for (const c of CASES) {
  const g = classify.analyzeStrokeGroup([{ pts: c.pts }]);
  const built = bodyFactory.buildCreatureBody({
    form: g.form, geo: g, thickness: 12, spawn: { x: g.centroid.x, y: 84 }, mods: {}, flags: {},
  });
  const b = built.bodies[0];
  const isCircle = !!(b && b.circleRadius);
  if (isCircle) circleCount++;
  const bodyDesc = b
    ? (isCircle ? `圆 r=${b.circleRadius.toFixed(1)}` : `${built.bodies.length}块/${b.vertices.length}顶点`)
    : '（无刚体）';
  console.log(
    (g.tooSmall ? c.name + '(太小被拒)' : c.name).padEnd(24)
    + String(g.form).padEnd(10)
    + String(g.closed).padEnd(6)
    + g.aspect.toFixed(2).padEnd(8)
    + String(Math.round(g.area)).padEnd(8)
    + String(built.degraded).padEnd(12)
    + bodyDesc,
  );
}
console.log('-'.repeat(96));
console.log(`变成圆的：${circleCount}/${CASES.length}  ← 这就是"画什么都变圆"的实测量`);
