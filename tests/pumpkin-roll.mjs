/**
 * tests/pumpkin-roll.mjs —— 关2《滚下去的南瓜》的「滚」判据（团队要求：写进测试，不写注释）
 *
 * 【已退役·勿再当门禁】原判据「累计 |Δangle| ≥ 2π」被设计撤除（2026-xx）：它量的是标题，不是玩法；
 *   方形南瓜转不满一圈是设定。且实测证明它会**把"翻滚"判成"滚"**（坠落撞壁也累计 2.49 圈。
 *   现行判据 = **南瓜落进沟底收货口（开口 80px）+ 未碎**，等关2 新几何落地后由本脚本接管。
 *   保留本文件是为了留下 angle-meter 的能力与那次实测结论（逐帧累加、跨 ±π 补圈）。
 *       （必须逐帧累加，不能只看首末差值——来回摆会互相抵消，见 src/physics/angle-meter.js）
 * 另记：单帧最大角速度（不设阈值，只记录）、`vx0` 启动成功率（5 次）。
 *
 * 现状（诚实）：`pumpkin.friction` 目前仍是 0（[债-1]，与关2 重建同包清），
 * 摩擦 0 = 打滑，南瓜**不会转**。所以本脚本现在必然 NOT MET —— 它的作用是
 * 在清债那一包里**立刻给出红/绿**，而不是靠人记着去看。
 */
import { loadGameEnv } from './helpers/env.mjs';

const env = await loadGameEnv();
const { world, materials, runtime } = env;
const { createAngleMeter } = await import('../src/physics/angle-meter.js');

const L2 = env.levels.l2.LEVEL_CH1_02;
const RUNS = 5;
const circles = [];

function runOnce() {
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level: L2, world: w, bus });
  const prop = rt.snapshot();
  // 直接驱动道具（几何重建前的旧关2：南瓜在高台上自己滑）
  const propBody = w.allBodies().find((b) => b.label === 'prop');
  const meter = propBody ? createAngleMeter(propBody) : null;
  let started = false;
  const x0 = propBody ? propBody.position.x : 0;
  const M = globalThis.Matter;
  for (let f = 0; f < 60 * 20; f++) {
    // 旧关2 的南瓜默认钉住（等玩家架桥），这里第 100 帧放手，模拟"玩家已就位"
    if (f === 100 && propBody) M.Body.setStatic(propBody, false);
    rt.step(1);
    if (meter) meter.sample();
    if (propBody && !started && Math.abs(propBody.position.x - x0) > 6) started = true;
    if (events.some((e) => e[0] === 'level:win')) break;
  }
  const out = {
    turns: meter ? meter.turns : 0,
    total: meter ? meter.total : 0,
    net: meter ? meter.net : 0,
    maxOmega: meter ? meter.maxOmega : 0,
    started,
    dx: propBody ? propBody.position.x - x0 : 0,
    won: events.some((e) => e[0] === 'level:win'),
  };
  rt.destroy();
  return out;
}

for (let i = 0; i < RUNS; i++) circles.push(runOnce());

const avgTurns = circles.reduce((s, r) => s + r.turns, 0) / RUNS;
const maxOmega = Math.max(...circles.map((r) => r.maxOmega));
const startedCount = circles.filter((r) => r.started).length;
const wonCount = circles.filter((r) => r.won).length;

console.log('\n===== 关2「滚」判据（累计 |Δangle| ≥ 2π）=====');
console.log(`  跑 ${RUNS} 次：启动 ${startedCount}/${RUNS}，过关 ${wonCount}/${RUNS}`);
console.log(`  累计转角 平均 ${avgTurns.toFixed(2)} 圈（阈值 1.00 圈）`);
console.log(`  首末净转角（对照，会用来说明"为什么不能只看差值"）：${circles.map((r) => r.net.toFixed(2)).join(' / ')}`);
console.log(`  单帧最大角速度：${maxOmega.toFixed(3)} rad/frame`);
const met = avgTurns >= 1;
console.log(`  → ${met ? 'MET（它真的在滚）' : 'NOT MET（它没滚：当前 friction=' + materials.MATERIALS.pumpkin.friction + '，[债-1] 待与关2 重建同包清）'}`);
process.exit(met ? 0 : 0);   // 诊断脚本，不阻塞；红/绿看输出
