/** 临时诊断：南瓜悬空多少才站得住（落地后并入 l2-acceptance 的判据 4） */
import { loadGameEnv } from './helpers/env.mjs';
const env = await loadGameEnv();
const { world, runtime } = env;
const L2 = env.levels.l2.LEVEL_CH1_02;
console.log(' 中心x  悬空px  3秒漂移px   末位');
for (const cx of [186, 190, 195, 198, 200, 203, 205]) {
  L2.props[0].x = cx;
  const w = world.createPhysicsWorld();
  const bus = { emit() {}, on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const p = w.allBodies().find((b) => b.label === 'prop');
  const p0 = { x: p.position.x, y: p.position.y };
  let dev = 0;
  for (let f = 0; f < 180; f++) { rt.step(1); dev = Math.max(dev, Math.hypot(p.position.x - p0.x, p.position.y - p0.y)); }
  console.log(`  ${String(cx).padStart(4)}   ${String(Math.max(0, cx + 31 - 200)).padStart(4)}   ${dev.toFixed(2).padStart(9)}   (${p.position.x.toFixed(0)},${p.position.y.toFixed(0)})`);
  rt.destroy();
}
