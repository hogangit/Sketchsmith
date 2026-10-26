/**
 * src/physics/nan-guard.js —— NaNGuard.sweep（风险 K3：物理爆炸兜底）
 * 每 10 帧扫一遍 position/velocity/angle，非有限值直接移除该 body；顺带做速度 clamp。
 */
import { BODY_MAX_SPEED } from './materials.js';

export const NAN_GUARD_EVERY_FRAMES = 10;

export const NaNGuard = {
  frames: 0,
  removed: 0,
  clamped: 0,
  /**
   * @param {object} engine matter 引擎
   * @param {object} MATTER matter 命名空间
   * @returns {{removed:number, clamped:number}} 本次清扫结果
   */
  sweep(engine, MATTER) {
    this.frames++;
    let removed = 0;
    let clamped = 0;
    if (!engine || !MATTER) return { removed, clamped };
    const bodies = MATTER.Composite.allBodies(engine.world);
    for (const b of bodies) {
      if (b.isStatic) continue;
      const p = b.position;
      const v = b.velocity;
      const bad = !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
        !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(b.angle);
      if (bad) {
        MATTER.Composite.remove(engine.world, b, true);
        removed++;
        continue;
      }
      const sp = Math.hypot(v.x, v.y);
      if (sp > BODY_MAX_SPEED) {
        MATTER.Body.setVelocity(b, { x: (v.x / sp) * BODY_MAX_SPEED, y: (v.y / sp) * BODY_MAX_SPEED });
        clamped++;
      }
    }
    this.removed += removed;
    this.clamped += clamped;
    return { removed, clamped };
  },
};
