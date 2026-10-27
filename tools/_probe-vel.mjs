import { loadGameEnv } from '../tests/helpers/env.mjs';
const env = await loadGameEnv();
const M = globalThis.Matter;

function makeWorld() {
  const engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6, constraintIterations: 3, enableSleeping: false });
  engine.gravity.x = 0; engine.gravity.y = 1; engine.gravity.scale = 0.001;
  // ground
  const g = M.Bodies.rectangle(200, 470, 600, 82, { isStatic: true });
  engine.world.gravity = engine.gravity;
  M.Composite.add(engine.world, g);
  return engine;
}

function test(label, vx, vy) {
  const engine = makeWorld();
  const ball = M.Bodies.circle(200, 430, 14, { friction: 0.02, frictionAir: 0, restitution: 0 });
  M.Body.setMass(ball, 1.8);
  M.Composite.add(engine.world, ball);
  for (let i = 0; i < 60; i++) M.Engine.update(engine, 1000/60);
  // 现在 ball 应静止在地面 (~y=430-14=416 region，实际 416+ )
  const before = { x: ball.position.x, y: ball.position.y, vx: ball.velocity.x, vy: ball.velocity.y };
  M.Body.setVelocity(ball, { x: vx, y: vy });
  const postSet = { vx: ball.velocity.x, vy: ball.velocity.y, px: ball.positionPrev.x, py: ball.positionPrev.y, dt: ball.deltaTime };
  let nanF = -1;
  for (let i = 0; i < 30; i++) {
    M.Engine.update(engine, 1000/60);
    if (!Number.isFinite(ball.position.x) || !Number.isFinite(ball.velocity.x)) { nanF = i; break; }
  }
  console.log(`[${label}] set=(${vx},${vy})`);
  console.log(`   before=`, before);
  console.log(`   postSet=`, postSet);
  console.log(`   after30: pos=(${ball.position.x.toFixed(1)},${ball.position.y.toFixed(1)}) vel=(${ball.velocity.x.toFixed(2)},${ball.velocity.y.toFixed(2)}) nanF=${nanF}`);
}

test('small 1.9', 1.9, 0);
test('large 8.5', 8.5, -4.8);
test('large up 0,-8.5', 0, -8.5);
