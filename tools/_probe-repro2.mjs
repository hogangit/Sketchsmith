import { loadGameEnv, synthLine } from '../tests/helpers/env.mjs';
const env = await loadGameEnv();
const { world, budget, classify } = env;
const M = globalThis.Matter;
const FIXED = 1000/60;
const ACTOR = { radius: 14, mass: 1.8, friction: 0.02, frictionAir: 0.0, speed: 1.9, accelStep: 0.22, jumpSpeed: 6.0, jumpCooldownMs: 420, stuckFrames: 9, arriveTolerance: 5 };

// 选项：用 createPhysicsWorld + 完整 L4 地形 + 忠实 stepWalker
function run(useWorld, fullTerrain) {
  const w = useWorld ? world.createPhysicsWorld() : (() => {
    const e = M.Engine.create({ positionIterations: 8, velocityIterations: 6, constraintIterations: 3, enableSleeping: false });
    e.gravity.x = 0; e.gravity.y = 1; e.gravity.scale = 0.001;
    return { engine: e, addBody(b){ M.Composite.add(e.world, b); return b; }, raycast(f,t,wd){ return M.Query.ray(M.Composite.allBodies(e.world), f, t, wd||3); } };
  })();

  const terrainDefs = fullTerrain ? [
    { x: 120, y: 471, w: 240, h: 82 },
    { x: 330, y: 370, w: 180, h: 140 },
    { x: 250, y: 296, w: 34, h: 8 },
  ] : [{ x: 120, y: 471, w: 240, h: 82 }];
  for (const t of terrainDefs) {
    const b = M.Bodies.rectangle(t.x, t.y, t.w, t.h, { isStatic: true, friction: 0.9, frictionStatic: 1.0, restitution: 0.02 });
    w.addBody(b);
  }

  // board：rigid 单矩形（模仿 harden beam），预置穿透态 434.8
  const board = M.Bodies.rectangle(231.8, 434.8, 50, 12, { friction: 0.9, frictionStatic: 1.1, restitution: 0.02, frictionAir: 0.008 });
  M.Body.setMass(board, 1.5);
  w.addBody(board);

  const walker = M.Bodies.circle(60, 416, ACTOR.radius, { friction: ACTOR.friction, frictionAir: ACTOR.frictionAir, restitution: 0 });
  M.Body.setMass(walker, ACTOR.mass);
  w.addBody(walker);

  const tickleIds = new Set([board.id]);
  const cooldown = new Map();
  const targetX = 340;
  let nanF = -1, nanBody = null;
  for (let f = 0; f < 60 * 8; f++) {
    // beforeStep
    // 1) tickle（求解器之前，用上一帧 pairs）
    const pairs = (w.engine.pairs && w.engine.pairs.collisionActive) || [];
    for (const pair of pairs) {
      if (!pair.isActive) continue;
      const a = pair.bodyA, b = pair.bodyB;
      const ta = tickleIds.has(a.id), tb = tickleIds.has(b.id);
      let tb_, other;
      if (ta && !tb) { tb_ = a; other = b; } else if (tb && !ta) { tb_ = b; other = a; } else continue;
      if (other.isStatic) continue;
      const dx = other.position.x - tb_.position.x, dy = other.position.y - tb_.position.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx/len, ny = dy/len;
      const key = Math.min(tb_.id, other.id) + '+' + Math.max(tb_.id, other.id);
      const last = cooldown.get(key);
      if (last != null && f - last < 12) continue;
      cooldown.set(key, f);
      M.Body.setVelocity(other, { x: other.velocity.x + nx * 8.5, y: other.velocity.y + ny * 8.5 });
    }
    // 2) faithful stepWalker
    let ground = false;
    for (const off of [-6, 0, 6]) {
      const from = { x: walker.position.x + off, y: walker.position.y + ACTOR.radius - 2 };
      const to = { x: walker.position.x + off, y: walker.position.y + ACTOR.radius + 8 };
      if (w.raycast(from, to, 2).some((h) => h.body !== walker)) { ground = true; break; }
    }
    const standing = ground && walker.velocity.y > -1.2 && walker.velocity.y < 1.0;
    const dx = targetX - walker.position.x;
    const dir = Math.abs(dx) > ACTOR.arriveTolerance ? Math.sign(dx) : 0;
    if (standing) {
      const targetVx = dir * ACTOR.speed;
      const dvx = Math.max(-ACTOR.accelStep, Math.min(ACTOR.accelStep, targetVx - walker.velocity.x));
      M.Body.setVelocity(walker, { x: walker.velocity.x + dvx, y: walker.velocity.y });
    }

    if (useWorld) w.stepFrame(1, () => {});
    else M.Engine.update(w.engine, FIXED);

    for (const bd of [board, walker]) {
      if (!Number.isFinite(bd.position.x) || !Number.isFinite(bd.velocity.x)) { nanF = f; nanBody = bd.label; break; }
    }
    if (nanF >= 0) break;
  }
  console.log(`useWorld=${useWorld} fullTerrain=${fullTerrain} => nanF=${nanF} body=${nanBody} boardY=${board.position.y.toFixed(1)} walk=(${walker.position.x.toFixed(0)},${walker.position.y.toFixed(0)})`);
}

run(false, false);
run(true, false);
run(true, true);
