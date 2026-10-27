import { loadGameEnv } from '../tests/helpers/env.mjs';
const env = await loadGameEnv();
const M = globalThis.Matter;

function makeWorld() {
  const engine = M.Engine.create({ positionIterations: 8, velocityIterations: 6, constraintIterations: 3, enableSleeping: false });
  engine.gravity.x = 0; engine.gravity.y = 1; engine.gravity.scale = 0.001;
  const g = M.Bodies.rectangle(200, 470, 600, 82, { isStatic: true });
  M.Composite.add(engine.world, g);
  return engine;
}

function test(label, applyWhen) {
  const engine = makeWorld();
  // dynamic board resting on ground
  const board = M.Bodies.rectangle(200, 424, 50, 12, { friction: 0.9, restitution: 0.02, frictionAir: 0.008 });
  M.Body.setMass(board, 1.0);
  // dynamic ball resting on board
  const ball = M.Bodies.circle(200, 405, 14, { friction: 0.02, frictionAir: 0, restitution: 0 });
  M.Body.setMass(ball, 1.8);
  M.Composite.add(engine.world, [board, ball]);
  for (let i = 0; i < 120; i++) M.Engine.update(engine, 1000/60);
  const ballRest = { x: ball.position.x.toFixed(1), y: ball.position.y.toFixed(1) };
  // 接触状态确认
  let nanF = -1;
  const launch = () => {
    const dx = ball.position.x - board.position.x;
    const dy = ball.position.y - board.position.y;
    const len = Math.hypot(dx, dy) || 1;
    M.Body.setVelocity(ball, { x: ball.velocity.x + (dx/len)*8.5, y: ball.velocity.y + (dy/len)*8.5 });
  };
  for (let i = 0; i < 40; i++) {
    if (applyWhen === 'before' && i === 0) launch();
    M.Engine.update(engine, 1000/60);
    if (applyWhen === 'after' && i === 0) launch();
    if (!Number.isFinite(ball.position.x) || !Number.isFinite(ball.velocity.x) || !Number.isFinite(board.position.x)) { nanF = i; break; }
  }
  console.log(`[${label}] ballRest=${JSON.stringify(ballRest)} after40: ball=(${ball.position.x.toFixed(1)},${ball.position.y.toFixed(1)}) vel=(${ball.velocity.x.toFixed(2)},${ball.velocity.y.toFixed(2)}) board=(${board.position.x.toFixed(1)},${board.position.y.toFixed(1)}) nanF=${nanF}`);
}

test('launch AFTER solver (tickle 路径)', 'after');
test('launch BEFORE solver (stepWalker 路径)', 'before');
