import { loadGameEnv } from '../tests/helpers/env.mjs';
const env = await loadGameEnv();
const M = globalThis.Matter;

const FIXED = 1000/60;

function buildScene(boardPenetrate, boardY) {
  const engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6, constraintIterations: 3, enableSleeping: false });
  engine.gravity.x = 0; engine.gravity.y = 1; engine.gravity.scale = 0.001;
  const ground = M.Bodies.rectangle(120, 471, 240, 82, { isStatic: true, friction: 0.9, frictionStatic: 1.0, restitution: 0.02 });
  M.Composite.add(engine.world, ground);

  // board：模仿 body-factory 的 rigid 单矩形（harden 场景）
  const board = M.Bodies.rectangle(231, boardY, 50, 12, { friction: 0.9, frictionStatic: 1.1, restitution: 0.02, frictionAir: 0.008 });
  M.Body.setMass(board, 2);
  M.Composite.add(engine.world, board);

  const walker = M.Bodies.circle(60, 416, 14, { friction: 0.02, frictionAir: 0.0, restitution: 0 });
  M.Body.setMass(walker, 1.8);
  M.Composite.add(engine.world, walker);

  // 让 board 先稳定（穿透或正常），walker 落到位
  for (let i = 0; i < 30; i++) M.Engine.update(engine, FIXED);
  return { engine, board, walker };
}

function driveAndTickle(scene, boardPenetrate) {
  const { engine, board, walker } = scene;
  const tickleIds = new Set([board.id]);
  const cooldown = new Map();
  const targetX = 340;
  let nanF = -1, nanBody = null;
  for (let f = 0; f < 60 * 8; f++) {
    // beforeStep：模仿 stepWalker + flushTickles（求解器之前）
    // 1) tickle 冲量
    const pairs = (engine.pairs && engine.pairs.collisionActive) || [];
    for (const pair of pairs) {
      if (!pair.isActive) continue;
      const a = pair.bodyA, b = pair.bodyB;
      const ta = tickleIds.has(a.id), tb = tickleIds.has(b.id);
      let tb_, other;
      if (ta && !tb) { tb_ = a; other = b; }
      else if (tb && !ta) { tb_ = b; other = a; }
      else continue;
      if (other.isStatic) continue;
      const dx = other.position.x - tb_.position.x;
      const dy = other.position.y - tb_.position.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx/len, ny = dy/len;
      const key = Math.min(tb_.id, other.id) + '+' + Math.max(tb_.id, other.id);
      const last = cooldown.get(key);
      if (last != null && f - last < 12) continue;   // ~200ms @60fps
      cooldown.set(key, f);
      M.Body.setVelocity(other, { x: other.velocity.x + nx * 8.5, y: other.velocity.y + ny * 8.5 });
    }
    // 2) walker 驱动
    const dx = targetX - walker.position.x;
    const dir = Math.abs(dx) > 5 ? Math.sign(dx) : 0;
    // 简化：始终给向目标的速度（站立时）
    M.Body.setVelocity(walker, { x: walker.velocity.x + dir * 0.22, y: walker.velocity.y });

    M.Engine.update(engine, FIXED);
    for (const bd of [board, walker]) {
      if (!Number.isFinite(bd.position.x) || !Number.isFinite(bd.velocity.x)) { nanF = f; nanBody = bd.label; break; }
    }
    if (nanF >= 0) break;
  }
  return { nanF, nanBody, boardY: board.position.y, walkEnd: { x: walker.position.x.toFixed(0), y: walker.position.y.toFixed(0) } };
}

console.log('=== 忠实复现：board 是否穿透 ===');
const r1 = buildScene(false, 436);   // 正常落位（顶 430，板厚12 → 中心 436 不穿透）
console.log('正常落位:', JSON.stringify(driveAndTickle(r1, false)));
const r2 = buildScene(true, 434.8);  // 游戏里的穿透态（中心 434.8，底 440.8，穿 10px）
console.log('穿透 10px:', JSON.stringify(driveAndTickle(r2, true)));
