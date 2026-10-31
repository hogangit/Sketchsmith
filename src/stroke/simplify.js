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
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  // 首尾几乎重合（玩家把圆圈/方块**认真画回起点**）⇒ "点到首尾连线的垂距"失去意义：
  // 原实现此时会给所有点算出一个同样的常数距离（退化成 0/1e-9），maxD 不大于 ε ⇒ 整条笔被压成
  // 2 个点 ⇒ 周长=0 ⇒ 被判"墨点"，**什么都不生成**（D36 实测：精确闭合的正方/圆/星全是这个下场）。
  // 修法：改用"离首点最远的点"当切割点，把环切成两段有真实弦的子路径，之后递归即恢复正常。
  const degenerate = len < eps;
  let maxD = -1;
  let idx = 0;
  if (degenerate) {
    for (let i = 1; i < pts.length - 1; i++) {
      const d = geoDist(pts[i], first);
      if (d > maxD) { maxD = d; idx = i; }
    }
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const d = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
  }
  if (maxD > eps) {
    const left = rdpCore(pts.slice(0, idx + 1), eps);
    const right = rdpCore(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return degenerate ? [first, pts[idx]] : [first, last];
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
