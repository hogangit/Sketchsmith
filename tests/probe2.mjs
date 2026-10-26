/**
 * tests/probe2.mjs —— 关2 可行性探针（临时工具，不进构建）
 * 待验命题：friction=0 的南瓜（滑行体）能否越过「桥面比岸面高 9px」这个小台阶。
 * 若能 → 关2 可以保持「平地 + 一道沟 + 架桥」的最简结构。
 */
import { loadGameEnv } from './helpers/env.mjs';

await loadGameEnv();
const M = globalThis.Matter;

function run(tag, { bridgeTop, lipLeft = true, gapL = 240, gapR = 340 }) {
  const engine = M.Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } });
  const world = engine.world;
  const left = M.Bodies.rectangle(120, 400, 240, 80, { isStatic: true, friction: 0.9, frictionStatic: 1.0, restitution: 0 });
  const right = M.Bodies.rectangle(385, 400, 90, 80, { isStatic: true, friction: 0.9, frictionStatic: 1.0, restitution: 0 });
  const bodies = [left, right];
  if (bridgeTop != null) {
    const t = 9;
    const b = M.Bodies.rectangle((gapL + gapR) / 2, bridgeTop + t / 2, gapR - gapL + 20, t, {
      isStatic: true, friction: 0.9, frictionStatic: 1.1, restitution: 0,
    });
    bodies.push(b);
  }
  const pk = M.Bodies.rectangle(100, 329, 62, 62, { friction: 0, frictionStatic: 0, restitution: 0, frictionAir: 0.002 });
  M.Body.setDensity(pk, 0.0035);
  bodies.push(pk);
  M.Composite.add(world, bodies);
  M.Body.setVelocity(pk, { x: 1.6, y: 0 });
  const xs = [];
  let maxX = pk.position.x;
  for (let i = 1; i <= 420; i++) {
    M.Engine.update(engine, 16.666);
    maxX = Math.max(maxX, pk.position.x);
    if (i % 60 === 0) xs.push(`${i}:${pk.position.x.toFixed(0)},${pk.position.y.toFixed(0)}`);
  }
  console.log(`${tag.padEnd(30)} final ${pk.position.x.toFixed(0)},${pk.position.y.toFixed(0)}  maxX ${maxX.toFixed(0)} WIN=${maxX >= 352} | ${xs.join(' ')}`);
}

console.log('=== 关2 命题：friction=0 南瓜 + 桥面台阶 ===');
run('无桥（应掉河）', { bridgeTop: null });
run('桥面顶=360 齐平', { bridgeTop: 360 });
run('桥面顶=365 高5px', { bridgeTop: 365 });
run('桥面顶=369 高9px', { bridgeTop: 369 });
run('桥面顶=378 高18px', { bridgeTop: 378 });
