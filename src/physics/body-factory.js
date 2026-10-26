/**
 * src/physics/body-factory.js —— 点集 → 刚体（S10 拆凸 / S11 刚体生成）
 * 风险 K3 的三级退化在这里：decomp（matter 内置 poly-decomp）→ 凸包 → bbox 矩形 → 圆形。
 * 任何一级失败都不抛到上层；最差也给一个能玩的圆，绝不让核心动作失效。
 */
import {
  BEAM_LENGTH_PAD, BEAM_MIN_THICKNESS, CREATURE_SOFT, DENSITY_CREATURE,
  GRAIN_MAX_RADIUS, SOFT_BEAM_STIFFNESS, WHEEL_MIN_RADIUS,
} from './materials.js';
import { DECOMP_MAX_PARTS, ROPE_JOINT_MAX } from '../stroke/thresholds.js';
import { geoConvexHull, geoResample, geoPolylineLength } from '../stroke/geometry.js';

const MATTER_BF = typeof Matter !== 'undefined' ? Matter : globalThis.Matter;  // 本文件专用别名（兜底拼接器 D3：顶层名全仓库唯一）

function isFinitePt(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** 复合体校验：任一块顶点 < 3 或含非有限值 → 判废（S11） */
function sanitizeCompound(body, maxParts) {
  if (!body || !Array.isArray(body.parts)) return null;
  // fromVertices 对凸多边形会返回单块 body（parts.length === 1），那也是合法结果
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  if (parts.length > maxParts) return null;
  for (const p of parts) {
    if (!p.vertices || p.vertices.length < 3) return null;
    for (const v of p.vertices) if (!isFinitePt(v)) return null;
  }
  return body;
}

function polygonFrom(points) {
  const out = [];
  for (const p of points) {
    if (!isFinitePt(p)) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.4) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * 多边形 → 刚体数组（含 K3 三级退化）
 * @returns {{bodies:Array, degraded:'none'|'hull'|'bbox'|'circle'}}
 */
export function bodyFromPolygon(points, spawn, options) {
  const opts = options || {};
  const poly = polygonFrom(points);
  const base = Object.assign({}, opts);

  // 一级：交给 matter 的 fromVertices（内部用 poly-decomp 拆凸）
  if (poly.length >= 3) {
    try {
      const b = MATTER_BF.Bodies.fromVertices(spawn.x, spawn.y, [poly.map((p) => ({ x: p.x, y: p.y }))], base, true);
      const ok = sanitizeCompound(b, DECOMP_MAX_PARTS);
      if (ok) return { bodies: [ok], degraded: 'none' };
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] decomp 失败，退化到凸包', err && err.message);
    }
  }

  // 二级：凸包（单块）
  if (poly.length >= 3) {
    try {
      const hull = geoConvexHull(poly);
      if (hull.length >= 3) {
        const b = MATTER_BF.Bodies.fromVertices(spawn.x, spawn.y, [hull.map((p) => ({ x: p.x, y: p.y }))], base, true);
        if (b && b.vertices && b.vertices.length >= 3) {
          for (const v of b.vertices) if (!isFinitePt(v)) throw new Error('hull 顶点非法');
          return { bodies: [b], degraded: 'hull' };
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] 凸包失败，退化到矩形', err && err.message);
    }
  }

  // 三级：bbox 矩形
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (isFinite(minX) && maxX - minX > 1 && maxY - minY > 1) {
    try {
      const b = MATTER_BF.Bodies.rectangle((minX + maxX) / 2, (minY + maxY) / 2, maxX - minX, maxY - minY, base);
      return { bodies: [b], degraded: 'bbox' };
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[body-factory] 矩形失败，退化到圆', err && err.message);
    }
  }

  // 四级：圆形（最差也能玩）
  const r = Math.max(WHEEL_MIN_RADIUS, (Number.isFinite(maxX - minX) ? maxX - minX : 0) / 2 || 12);
  return { bodies: [MATTER_BF.Bodies.circle(spawn.x, spawn.y, r, base)], degraded: 'circle' };
}

/** 把刚体组整体平移到目标点（让落点与虚线引导一致） */
function recenter(bodies, target) {
  let mx = 0, my = 0, tm = 0;
  for (const b of bodies) {
    const m = Math.max(b.mass, 1e-4);
    mx += b.position.x * m;
    my += b.position.y * m;
    tm += m;
  }
  if (!tm) return;
  const dx = target.x - mx / tm;
  const dy = target.y - my / tm;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  for (const b of bodies) MATTER_BF.Body.translate(b, { x: dx, y: dy });
}

/**
 * 落地材质与能力 mods（幂等：同一组 mods 重复施加结果一致）
 * 层序由 compose.js 决定，这里只负责写入。
 */
function applyMods(bodies, mods) {
  const m = mods || {};
  const densityMul = Number.isFinite(m.densityMul) ? m.densityMul : 1;
  // 会滚（D16）：只乘空气阻尼；friction / frictionStatic 不从这里改
  const airMul = Number.isFinite(m.frictionAirMul) ? m.frictionAirMul : 1;
  for (const b of bodies) {
    if (!b.isStatic) {
      MATTER_BF.Body.setDensity(b, DENSITY_CREATURE * densityMul);
      b.friction = m.friction != null ? m.friction : CREATURE_SOFT.friction;
      b.frictionStatic = m.frictionStatic != null ? m.frictionStatic : CREATURE_SOFT.frictionStatic;
      const air = m.frictionAir != null ? m.frictionAir : CREATURE_SOFT.frictionAir;
      b.frictionAir = air * airMul;
      b.restitution = m.restitution != null ? m.restitution : CREATURE_SOFT.restitution;
      b.slop = 0.02;
    }
  }
}

/**
 * 主入口：按形态生成造物刚体。
 * @param {object} spec { form, geo, thickness, spawn:{x,y}, mods }
 * @returns {{bodies:Array, constraints:Array, degraded:string, form:string}}
 */
export function buildCreatureBody(spec) {
  const { form, geo, spawn } = spec;
  const mods = spec.mods || {};
  const flags = spec.flags || {};
  const rigid = flags.rigid === true || mods.rigid === true;
  const thickness = Math.max(BEAM_MIN_THICKNESS, spec.thickness || BEAM_MIN_THICKNESS);
  const centerline = (geo && geo.centerline) || [];
  const poly = (geo && geo.outerPoly) || centerline;
  let bodies = [];
  let constraints = [];
  let degraded = 'none';

  if (form === 'beam' && centerline.length >= 2) {
    // 梁：中心线首尾决定长度与角度（支持斜梁），厚度取笔宽
    const p0 = centerline[0];
    const pN = centerline[centerline.length - 1];
    const len = Math.max(BEAM_MIN_THICKNESS * 2, Math.hypot(pN.x - p0.x, pN.y - p0.y) + BEAM_LENGTH_PAD * 2);
    const angle = Math.atan2(pN.y - p0.y, pN.x - p0.x);
    const mx = (p0.x + pN.x) / 2;
    const my = (p0.y + pN.y) / 2;
    if (rigid || len < 90) {
      bodies = [MATTER_BF.Bodies.rectangle(mx, my, len, thickness, { angle })];
    } else {
      // 没变硬 = 软的：两段铰接，压上去会从中折下去（关1 的教学性失败）
      const half = len / 2;
      const dx = Math.cos(angle) * (len / 4);
      const dy = Math.sin(angle) * (len / 4);
      const left = MATTER_BF.Bodies.rectangle(mx - dx, my - dy, half, thickness, { angle });
      const right = MATTER_BF.Bodies.rectangle(mx + dx, my + dy, half, thickness, { angle });
      bodies = [left, right];
      constraints = [MATTER_BF.Constraint.create({
        bodyA: left, pointA: { x: half / 2, y: 0 },
        bodyB: right, pointB: { x: -half / 2, y: 0 },
        length: 0, stiffness: SOFT_BEAM_STIFFNESS, render: { visible: false },
      })];
      degraded = 'soft-hinge';
    }
  } else if (form === 'wheel' && geo) {
    const r = Math.max(WHEEL_MIN_RADIUS, Math.min(geo.bbox.w, geo.bbox.h) / 2);
    bodies = [MATTER_BF.Bodies.circle(geo.centroid.x, geo.centroid.y, r)];
  } else if (form === 'grain' && geo) {
    const r = Math.min(GRAIN_MAX_RADIUS, Math.max(4, Math.sqrt(Math.max(geo.area, 40) / Math.PI)));
    bodies = [MATTER_BF.Bodies.circle(geo.centroid.x, geo.centroid.y, r)];
  } else if (form === 'rope' && centerline.length >= 2) {
    // 绳：中心线切成 n 节小刚体 + 铰接约束（首尾相连的多笔才有意义，本轮 UI 未接线）
    const total = geoPolylineLength(centerline);
    const n = Math.max(2, Math.min(ROPE_JOINT_MAX, Math.round(total / 40)));
    const nodes = geoResample(centerline, n);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      bodies.push(MATTER_BF.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, Math.max(6, segLen), thickness, { angle }));
    }
    recenter(bodies, spawn);
    for (let i = 1; i < bodies.length; i++) {
      const segLen = Math.hypot(nodes[i].x - nodes[i - 1].x, nodes[i].y - nodes[i - 1].y);
      constraints.push(MATTER_BF.Constraint.create({
        bodyA: bodies[i - 1], pointA: { x: segLen / 2, y: 0 },
        bodyB: bodies[i], pointB: { x: -segLen / 2, y: 0 },
        length: 0, stiffness: 0.9, render: { visible: false },
      }));
    }
  } else if (form === 'pile' && geo && geo.prepared && geo.prepared.length >= 2) {
    // 松散堆：每笔一块小刚体（本轮 UI 一笔一组，走不到这里；管线与单测覆盖）
    for (const strokePts of geo.prepared) {
      const r = Math.max(6, Math.min(18, Math.sqrt(Math.max(60, strokePts.length * 6) / Math.PI)));
      bodies.push(MATTER_BF.Bodies.circle(strokePts[0].x, strokePts[0].y, r));
    }
  } else if (poly.length >= 3 && geo && geo.closed) {
    const r = bodyFromPolygon(poly, spawn, {});
    bodies = r.bodies;
    degraded = r.degraded;
  } else if (poly.length >= 3) {
    // 开口但不判梁（长宽比不到 6）：按墨迹凸包做成一块，兜底团块
    const r = bodyFromPolygon(poly, spawn, {});
    bodies = r.bodies;
    degraded = r.degraded;
  } else if (geo && geo.bbox) {
    const w = Math.max(BEAM_MIN_THICKNESS * 2, geo.bbox.w);
    const h = Math.max(BEAM_MIN_THICKNESS * 2, geo.bbox.h);
    bodies = [MATTER_BF.Bodies.rectangle(geo.bbox.cx, geo.bbox.cy, w, h)];
    degraded = 'bbox';
  } else {
    bodies = [MATTER_BF.Bodies.circle(spawn.x, spawn.y, 12)];
    degraded = 'circle';
  }

  if (form !== 'rope') recenter(bodies, spawn);

  // 材质：先铺“软”基线，再叠能力 mods（未加变硬就是软的，这是关 1 的教学点）
  applyMods(bodies, Object.assign({}, CREATURE_SOFT, mods));

  for (const b of bodies) {
    b.render.visible = false;
    b.plugin = b.plugin || {};
    b.plugin.creatureForm = form;
  }

  return { bodies, constraints, degraded, form };
}
