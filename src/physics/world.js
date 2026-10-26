/**
 * src/physics/world.js —— matter 引擎封装：定步长 / 子步 / 碰撞上报 / NaN 守卫
 * 这是唯一 import matter 的地方（vendor 以全局 MATTER 暴露）。
 */
import { FIXED_STEP_MS, IMPACT_MIN_SCORE, IMPACT_PAIR_COOLDOWN_MS, MATTER_GRAVITY, MAX_SUB_STEPS } from './materials.js';
import { NaNGuard, NAN_GUARD_EVERY_FRAMES } from './nan-guard.js';

const MATTER = Matter;
const DECOMP = typeof decomp !== 'undefined' ? decomp : null;

export function createPhysicsWorld(opts) {
  const options = opts || {};
  const engine = MATTER.Engine.create({
    positionIterations: 8,
    velocityIterations: 6,
    constraintIterations: 3,
    enableSleeping: false,
  });
  engine.gravity.x = MATTER_GRAVITY.x;
  engine.gravity.y = MATTER_GRAVITY.y;
  engine.gravity.scale = MATTER_GRAVITY.scale;

  if (DECOMP && MATTER.Common.setDecomp) MATTER.Common.setDecomp(DECOMP);

  let subSteps = MAX_SUB_STEPS;
  let clockMs = 0;

  // ---- 碰撞音聚合（契约：PhysicsWorld.onImpact(cb)，每帧最多回调 1 次）----
  // pair 里没有冲量字段，代理量必须在这里、用同一时刻的速度与法线算：
  //   vRel = dot(vB - vA, normal) ; mEff = mA*mB/(mA+mB)（静态体 mass=Infinity → 用另一方质量，否则 NaN）
  //   score = |vRel| * mEff
  let impactCb = options.onImpact || null;
  let best = null;                 // 本帧（跨子步）最大者
  const pairCooldown = new Map();  // key → 上次放行时刻
  const impactDebug = { score: 0, gated: false, reason: '-' };

  MATTER.Events.on(engine, 'collisionStart', (ev) => {
    for (const pair of ev.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      if (a.isStatic && b.isStatic) continue;
      const n = pair.collision && pair.collision.normal ? pair.collision.normal : { x: 0, y: 1 };
      const vRel = (b.velocity.x - a.velocity.x) * n.x + (b.velocity.y - a.velocity.y) * n.y;
      const mA = a.isStatic || !Number.isFinite(a.mass) ? null : a.mass;
      const mB = b.isStatic || !Number.isFinite(b.mass) ? null : b.mass;
      let mEff;
      if (mA == null && mB == null) mEff = 1;
      else if (mA == null) mEff = mB;
      else if (mB == null) mEff = mA;
      else mEff = (mA * mB) / (mA + mB);
      const score = Math.abs(vRel) * mEff;
      if (!Number.isFinite(score)) continue;
      const owner = a.isStatic ? b : a;
      const key = Math.min(a.id, b.id) + '+' + Math.max(a.id, b.id);
      if (!best || score > best.score) {
        best = {
          score, key, timeMs: clockMs,
          bodyId: owner.id,
          material: (owner.plugin && owner.plugin.mat) || owner.label || 'ground',
        };
      }
    }
  });

  function flushImpact() {
    const cand = best;
    best = null;
    if (!cand) { impactDebug.score = 0; impactDebug.gated = false; impactDebug.reason = 'no-contact'; return; }
    impactDebug.score = Number(cand.score.toFixed(3));
    const last = pairCooldown.get(cand.key);
    if (cand.score <= IMPACT_MIN_SCORE) { impactDebug.gated = true; impactDebug.reason = 'below-min'; return; }
    if (last != null && cand.timeMs - last < IMPACT_PAIR_COOLDOWN_MS) {
      impactDebug.gated = true; impactDebug.reason = 'pair-cooldown'; return;
    }
    pairCooldown.set(cand.key, cand.timeMs);
    impactDebug.gated = false; impactDebug.reason = 'ok';
    if (impactCb) impactCb({ score: cand.score, material: cand.material, bodyId: cand.bodyId });
  }

  const api = {
    engine,
    composite: engine.world,
    MATTER,
    DECOMP,
    get subSteps() { return subSteps; },
    /** 契约：PhysicsWorld.setSubSteps(n) 1..3 */
    setSubSteps(n) { subSteps = Math.max(1, Math.min(MAX_SUB_STEPS, n | 0)); },
    /** 契约：PhysicsWorld.onImpact(cb)，载荷 { score, material, bodyId }，每帧最多 1 次 */
    onImpact(cb) { impactCb = cb; },
    /** ?impactDebug=1 用：只报「本帧 score」与「是否被闸门拦下」，不报累计次数 */
    get impactDebug() { return impactDebug; },

    addBody(body) { MATTER.Composite.add(engine.world, body); return body; },
    removeBody(body) { MATTER.Composite.remove(engine.world, body, true); },
    addConstraint(c) { MATTER.Composite.add(engine.world, c); return c; },
    removeConstraint(c) { MATTER.Composite.remove(engine.world, c, true); },

    allBodies() { return MATTER.Composite.allBodies(engine.world); },
    dynamicBodies() { return MATTER.Composite.allBodies(engine.world).filter((b) => !b.isStatic); },

    /** 单个物理帧（固定步长；一帧内可多次调用以追帧） */
    step() {
      MATTER.Engine.update(engine, FIXED_STEP_MS);
      clockMs += FIXED_STEP_MS;
      NaNGuard.frames++;
      if (NaNGuard.frames % NAN_GUARD_EVERY_FRAMES === 0) NaNGuard.sweep(engine, MATTER);
    },
    /**
     * 本帧推进：steps 为累积器算出的步数，受 subSteps 上限钳制。
     * beforeStep(dtMs) 在每次 Engine.update 之前调用（角色 AI 必须和物理同频，否则子步会放大速度）。
     * 碰撞音在**帧末**（跨子步聚合之后）才回调一次。
     * @returns {number} 实际执行步数
     */
    stepFrame(steps, beforeStep) {
      const n = Math.max(1, Math.min(steps == null ? 1 : steps, subSteps));
      for (let i = 0; i < n; i++) {
        if (beforeStep) beforeStep(FIXED_STEP_MS);
        this.step();
      }
      flushImpact();
      return n;
    },

    sweepNaN() { return NaNGuard.sweep(engine, MATTER); },

    bodiesInRect(rect) {
      return MATTER.Query.region(MATTER.Composite.allBodies(engine.world), {
        min: { x: rect.x, y: rect.y },
        max: { x: rect.x + rect.w, y: rect.y + rect.h },
      });
    },
    raycast(from, to, width) {
      return MATTER.Query.ray(MATTER.Composite.allBodies(engine.world), from, to, width || 3);
    },
    clear() {
      MATTER.Composite.clear(engine.world, false, true);
      MATTER.Engine.clear(engine);
    },
  };
  return api;
}
