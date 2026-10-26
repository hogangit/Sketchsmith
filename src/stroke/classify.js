/**
 * src/stroke/classify.js —— S5 闭合检测 / S6 几何属性 / S7 自交 / S8 形态分类
 * 纯函数，零 DOM、零物理依赖 → node 可直接单测。
 *
 * 附录 A 铁律：任何分支未命中都兜底成 blob（团块）。判错只让玩家多花 30 秒，不会走进死路。
 */
import {
  CLOSE_TOL_MIN, CLOSE_TOL_RATIO, MIN_STROKE_LENGTH, MIN_STROKE_AREA,
  ASPECT_WHEEL_MAX, ASPECT_BLOB_MAX, ASPECT_BEAM_MIN, HOLE_AREA_RATIO,
} from './thresholds.js';
import {
  geoBBox, geoCentroid, geoConvexHull, geoDist, geoIsSelfIntersecting,
  geoPointInPolygon, geoPolygonArea, geoPolylineLength,
} from './geometry.js';
import { dedupePoints, rdpSimplify } from './simplify.js';

export const FORM_LABELS = {
  beam: '梁', wheel: '轮', blob: '团块', container: '容器',
  rope: '绳', pile: '松散堆', grain: '颗粒', dot: '墨点',
};

/** 闭合容差：max(8px, 0.18 × 短边) */
export function strokeCloseTolerance(bbox) {
  const shortSide = Math.max(1, Math.min(bbox.w, bbox.h));
  return Math.max(CLOSE_TOL_MIN, CLOSE_TOL_RATIO * shortSide);
}

/** S8 形态判定决策树：顺序即互斥，先命中先出（tech-baseline 第 5 节表 S8-v1.1-FROZEN） */
export function classifyForm(g) {
  if (g.strokeCount >= 3 && !g.strokesAdjacent) return 'pile';
  // 序 2 = 绳（rope）。D11 已裁定 v1 不实装绳，整条不写，只留这一行说明；阶段 3 若要启用再补。
  // 序 2b：两笔首尾相连且细长 → 判梁并打接痕（不依赖绳，照实现）
  if (g.strokeCount >= 2 && g.strokesAdjacent && g.aspect > 6) return 'beam';
  if (g.closed && g.holeCount >= 1 && g.holeAreaRatio > HOLE_AREA_RATIO) return 'container';
  if (g.closed && g.area < MIN_STROKE_AREA) return 'grain';
  if (g.closed && g.aspect <= ASPECT_WHEEL_MAX) return 'wheel';
  if (g.closed && g.aspect <= ASPECT_BLOB_MAX) return 'blob';
  if (g.closed) return 'blob';                       // 长闭合：不允许判梁，否则画个长圈白拿梁
  if (g.aspect > ASPECT_BEAM_MIN) return 'beam';
  return 'blob';                                      // 兜底
}

/**
 * S5–S8 主流程。
 * @param {Array<{pts:Array<{x:number,y:number}>}>} strokeGroup 同组笔画（本轮 UI 一笔一组）
 * @returns 几何属性 + form + tooSmall
 */
export function analyzeStrokeGroup(strokeGroup) {
  const prepared = strokeGroup
    .map((s) => rdpSimplify(dedupePoints(s.pts || [], 0.5)))
    .filter((p) => p.length >= 2);

  if (!prepared.length) {
    return {
      form: 'dot', tooSmall: true, strokeCount: 0, closed: false, selfIntersect: false,
      perimeter: 0, bbox: geoBBox([]), aspect: 1, area: 0, hullArea: 0,
      centroid: { x: 0, y: 0 }, holeCount: 0, holeAreaRatio: 0, strokesAdjacent: false,
      centerline: [], pointCount: 0, nodes: 0,
    };
  }

  const all = prepared.flat();
  // 未简化前的原始采样点：开笔画的重心必须用“点均值”，且必须用原始点，
  // 否则 RDP 留下的节点疏密不均会把落点带偏（关1/关2 的落点对齐全靠这一条）
  const rawAll = strokeGroup.flatMap((st) => st.pts || []);
  const bbox = geoBBox(all);
  const aspect = Math.max(bbox.w, bbox.h) / Math.max(1, Math.min(bbox.w, bbox.h));
  const single = prepared.length === 1;
  const centerline = single ? prepared[0] : all;
  const perimeter = prepared.reduce((sum, p) => sum + geoPolylineLength(p), 0);

  // S5 闭合检测：只对单笔有意义；首尾距落进容差即判闭合（宁可判闭合，闭合后仍能落进团块兜底）
  let closed = false;
  const tol = strokeCloseTolerance(bbox);
  if (single && prepared[0].length >= 3) {
    const first = prepared[0][0];
    const last = prepared[0][prepared[0].length - 1];
    closed = geoDist(first, last) <= tol && perimeter > tol * 2.5;
  }

  // S6 面积：闭合走鞋带公式；开口笔画面积按 0（→ 梁候选）
  let outerPoly = null;
  let area = 0;
  if (closed) {
    outerPoly = prepared[0].slice(0, -1);
    area = geoPolygonArea(outerPoly);
  }

  // 孔洞：另一条完整闭合笔画的所有点都落在本多边形内
  let holeCount = 0;
  let holeArea = 0;
  if (closed) {
    for (let i = 1; i < prepared.length; i++) {
      const cand = prepared[i];
      const candClosed = cand.length >= 3 && geoDist(cand[0], cand[cand.length - 1]) <= tol;
      if (!candClosed) continue;
      const poly = cand.slice(0, -1);
      if (poly.every((p) => geoPointInPolygon(p, outerPoly))) {
        holeCount++;
        holeArea += geoPolygonArea(poly);
      }
    }
  }
  const holeAreaRatio = area > 0 ? holeArea / area : 0;

  // 相邻性：相邻两笔的“上一笔末点 / 下一笔起点”距离 ≤ 闭合容差
  let strokesAdjacent = false;
  if (prepared.length >= 2) {
    strokesAdjacent = true;
    for (let i = 1; i < prepared.length; i++) {
      const a = prepared[i - 1];
      const b = prepared[i];
      if (geoDist(a[a.length - 1], b[0]) > tol) { strokesAdjacent = false; break; }
    }
  }

  // S9 单点/极小：不生成刚体、不消耗造物槽
  // S9：只有“总长 < 8px”才拒判（RDP 把直线压成 2 节点是正常的，不能当单点处理）
  const tooSmall = perimeter < MIN_STROKE_LENGTH;

  let selfIntersect = false;
  if (single) selfIntersect = geoIsSelfIntersecting(prepared[0], closed);

  const centroid = closed && outerPoly ? geoCentroid(outerPoly, true) : geoCentroid(rawAll.length ? rawAll : centerline, false);
  const hullArea = geoPolygonArea(geoConvexHull(all));

  const g = {
    form: 'blob', tooSmall, strokeCount: prepared.length, closed, selfIntersect,
    perimeter, bbox, aspect, area, hullArea, centroid,
    holeCount, holeAreaRatio, strokesAdjacent,
    centerline, outerPoly, prepared,
    pointCount: all.length, nodes: prepared.reduce((s, p) => s + p.length, 0),
  };
  g.form = tooSmall ? 'dot' : classifyForm(g);
  return g;
}
