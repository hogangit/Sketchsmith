/**
 * src/stroke/simplify.js —— 采样点去重 + RDP 简化（S4）
 */
import { RDP_EPSILON, SIMPLIFY_MAX_NODES } from './thresholds.js';
import { geoDist } from './geometry.js';

/** 去掉距离过近的连续点（含采样抽稀后的补处理） */
export function dedupePoints(pts, minDist) {
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
export function rdpSimplify(pts, eps) {
  let e = eps == null ? RDP_EPSILON : eps;
  let out = rdpCore(pts, e);
  let guard = 0;
  while (out.length > SIMPLIFY_MAX_NODES && guard++ < 8) {
    e *= 1.6;
    out = rdpCore(pts, e);
  }
  return out;
}
