/**
 * src/stroke/geometry.js —— 纯几何工具（零 DOM，可在 node 里单测）
 * 点一律用 {x, y}；多边形点集用 [{x,y}, ...]（闭合由调用方保证）。
 */
export function geoDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function geoPolylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += geoDist(pts[i - 1], pts[i]);
  return s;
}

/** 包围盒；cx/cy 为盒中心 */
export function geoBBox(pts) {
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
export function geoPolygonArea(pts) {
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
export function geoCentroid(pts, closed) {
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
export function geoPointInPolygon(pt, poly) {
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
export function geoIsSelfIntersecting(pts, closed) {
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
export function geoConvexHull(points) {
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
export function geoResample(pts, segments) {
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
export function geoToLocal(pts, origin) {
  return pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
}
