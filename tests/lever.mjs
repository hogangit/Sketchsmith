/**
 * tests/lever.mjs —— 撬杠可行性实测（诊断脚本，不是自动测试）
 *
 * 设计总监问的是：**1.8kg 的农夫，压不压得动 13.4kg 的南瓜？**
 * 实测发现这个问题得拆成两问，而且第二问的答案暴露了一个数值债：
 *
 *   实验 A（力矩）：梁架在悬空石台上，南瓜在短端、农夫在长端。
 *     量梁往哪边转 → 回答"质量比够不够"。
 *   实验 C（真实构型）：南瓜悬在平台边沿外，梁的短端塞进南瓜底下的悬空部分，
 *     石台当支点，农夫站在内侧长端上压。量南瓜最后有没有掉进集市。
 *     同时对南瓜 friction ∈ {0, 0.9} 各跑一遍 —— 因为 `friction: 0` 是**旧设计**（沿坡滑）的遗留，
 *     新关 2 的三条解都不依赖滑动，这个 0 现在是纯粹的债，而且它决定了南瓜"滑回去"还是"翻下去"。
 *
 * 用法：node tests/lever.mjs [A|C|all]
 */
import { loadGameEnv } from './helpers/env.mjs';

const env = await loadGameEnv();
const M = globalThis.Matter;
const { world, materials } = env;

const PUMPKIN_MASS = 62 * 62 * 0.0035;      // 13.45（与 runtime 一致）
const FARMER_MASS = materials.ACTOR.mass;    // 1.8
const CD = materials.DENSITY_CREATURE;       // 0.0025

function mkBeam(w, x, y, L, th) {
  const b = M.Bodies.rectangle(x, y, L, th);
  M.Body.setDensity(b, CD);
  b.friction = 0.9; b.frictionStatic = 1.1; b.restitution = 0.02; b.frictionAir = 0.008;
  w.addBody(b);
  return b;
}
function mkPumpkin(w, x, y, friction) {
  const p = M.Bodies.rectangle(x, y, 62, 62);
  M.Body.setDensity(p, 0.0035);
  p.friction = friction; p.frictionStatic = friction; p.restitution = 0; p.frictionAir = 0.002;
  w.addBody(p);
  return p;
}
function mkFarmer(w, x, y) {
  const f = M.Bodies.circle(x, y, 14);
  M.Body.setMass(f, FARMER_MASS);
  f.friction = materials.ACTOR.friction; f.frictionAir = 0;
  w.addBody(f);
  return f;
}

/** A：悬空支点，纯力矩。返回 { dAngleDeg, dPumpkinY }（角度 + = 农夫那侧往下压成功） */
function runA({ L, d1, th = 10 }) {
  const w = world.createPhysicsWorld();
  const fx = 215;
  const post = M.Bodies.rectangle(fx, 330, 14, 44, { isStatic: true });
  post.friction = 0.9; post.frictionStatic = 1.0; post.restitution = 0;
  w.addBody(post);
  const pivotTop = 308;                 // 梁底面贴石台顶
  const beam = mkBeam(w, fx + (L / 2 - d1), pivotTop - th / 2, L, th);
  const a0 = beam.angle;
  const pkTop = pivotTop - th;
  const pk = mkPumpkin(w, fx - d1 + 8, pkTop - 31, 0.9);   // 短端
  const fm = mkFarmer(w, fx + (L - d1) - 14, pkTop - 14);  // 长端
  const pkY0 = pk.position.y;
  for (let f = 0; f < 60; f++) w.step();
  const out = { dAngleDeg: (beam.angle - a0) * 57.3, dPumpkinY: pk.position.y - pkY0, beamMass: L * th * CD };
  w.clear();
  return out;
}

/**
 * C：真实构型。平台 0..180（顶面 300），右面是集市（落差到棚布/地面）。
 * 南瓜悬在边沿外（中心 172 → 悬空 23px），梁短端塞进悬空部分底下，石台当支点，农夫压内侧长端。
 * 返回南瓜最终位置与"有没有掉下去"。
 */
function runC({ L, d1, friction, th = 10, farmerOn = true, notch = false }) {
  const w = world.createPhysicsWorld();
  const plat = M.Bodies.rectangle(90, 330, 180, 60, { isStatic: true });
  plat.friction = 0.9; plat.frictionStatic = 1.0; plat.restitution = 0;
  w.addBody(plat);
  // 集市地面（低 60px）
  const market = M.Bodies.rectangle(305, 390, 250, 60, { isStatic: true });
  market.friction = 0.9; market.frictionStatic = 1.0; market.restitution = 0;
  w.addBody(market);
  // 边沿石台（支点）。notch=true 时换成"夹槽"：底板 + 两侧挡墙，梁只能转不能翻、不能滑
  if (notch) {
    const bed = M.Bodies.rectangle(180, 296, 40, 8, { isStatic: true });     // 底面顶 292
    const wallL = M.Bodies.rectangle(171, 278, 8, 28, { isStatic: true });
    const wallR = M.Bodies.rectangle(189, 278, 8, 28, { isStatic: true });
    for (const b of [bed, wallL, wallR]) {
      b.friction = 0.6; b.frictionStatic = 0.8; b.restitution = 0;
      w.addBody(b);
    }
  } else {
    const stone = M.Bodies.rectangle(180, 300 - 8, 18, 16, { isStatic: true });
    stone.friction = 0.9; stone.frictionStatic = 1.0; stone.restitution = 0;
    w.addBody(stone);
  }
  // 南瓜：悬在边沿外（底面 300，和平台同高）
  const pk = mkPumpkin(w, 172, 300 - 31, friction);
  // 梁：短端在支点右侧（悬空部分底下），长端在内侧平台上
  const beamY = notch ? (292 - th / 2) : (300 - 8 - th / 2);
  const beam = mkBeam(w, 180 + (L / 2 - d1), beamY, L, th);
  // 农夫：内侧长端上
  const fm = farmerOn ? mkFarmer(w, 180 + (L - d1) - 14, beamY - th / 2 - 14) : null;
  const pk0 = { x: pk.position.x, y: pk.position.y };
  for (let f = 0; f < 300; f++) w.step();
  const out = {
    dx: pk.position.x - pk0.x, dy: pk.position.y - pk0.y,
    x: pk.position.x, y: pk.position.y,
    fell: pk.position.x > 190 && pk.position.y > 340,
    beamAngleDeg: beam.angle * 57.3,
    farmerX: fm ? fm.position.x : null,
  };
  w.clear();
  return out;
}

const which = process.argv[2] || 'all';

if (which === 'all' || which === 'A') {
  console.log('\n===== A 力矩（悬空支点，南瓜 friction=0.9 固定在短端）=====');
  console.log('  L    d1  d2  梁重    梁转角    南瓜Δy');
  for (const L of [160, 200, 240, 280]) {
    for (const d1 of [16, 24, 32, 40]) {
      const r = runA({ L, d1 });
      const d2 = L - d1 - 14;
      console.log(`  ${String(L).padStart(3)}  ${String(d1).padStart(2)}  ${String(d2).padStart(3)}  ${r.beamMass.toFixed(1)}kg  ` +
        `${r.dAngleDeg.toFixed(1).padStart(7)}°  ${r.dPumpkinY.toFixed(1).padStart(7)}px` +
        (r.dAngleDeg > 1 ? '   ← 压得动' : '   ← 压不动'));
    }
  }
}

if (which === 'all' || which === 'C') {
  console.log('\n===== C 真实构型（南瓜悬在边沿外，农夫压内侧长端）=====');
  console.log('  夹槽  南瓜摩擦  L    d1   南瓜末位        掉进集市?  梁转角   农夫x');
  for (const notch of [false, true]) {
  for (const friction of [0, 0.9]) {
    for (const L of [180, 220, 260]) {
      for (const d1 of [26, 34]) {
        const r = runC({ L, d1, friction, notch });
        console.log(`  ${notch ? ' 有 ' : ' 无 '}  ${String(friction).padEnd(6)}  ${String(L).padStart(3)}  ${String(d1).padStart(2)}  ` +
          `(${r.x.toFixed(0)},${r.y.toFixed(0)})`.padEnd(14) +
          `  ${r.fell ? ' YES ' : '  no '}     ${r.beamAngleDeg.toFixed(1).padStart(6)}°  ` +
          `${r.farmerX == null ? '-' : r.farmerX.toFixed(0)}`);
      }
    }
  }
  }
  // 对照：农夫不压
  console.log('\n  对照（没有农夫压）：');
  for (const L of [220]) {
    for (const d1 of [26]) {
      const r = runC({ L, d1, friction: 0.9, farmerOn: false });
      console.log(`  农夫不压  L=${L} d1=${d1}  南瓜末位 (${r.x.toFixed(0)},${r.y.toFixed(0)})  掉进集市: ${r.fell ? 'YES' : 'no'}`);
    }
  }
}

console.log(`\n（南瓜 ${PUMPKIN_MASS.toFixed(1)}kg / 农夫 ${FARMER_MASS}kg = ${(PUMPKIN_MASS / FARMER_MASS).toFixed(1)}:1）`);
