/**
 * tests/roll.test.mjs —— D16「会滚」验收
 *
 * 要证明的不是"滚得动"，是三件事：
 *   ① `会滚` 一个 friction 都没动（friction / frictionStatic 与基线完全相同）
 *   ② 它只压 frictionAir（×0.25），且是乘算键（与其它能力叠乘、顺序无关）
 *   ③ 效果落在形状上：圆 = 明显滚得更远；长条/团块 = 基本无变化（"没有滚这回事"）
 *
 * 同时把"friction=0"那条被否决的路也钉在案上：friction 被清零的圆**滚不动**（它会打滑而不是滚）。
 */
import { loadGameEnv, synthCircle, synthLine } from './helpers/env.mjs';

const env = await loadGameEnv();
const M = globalThis.Matter;
const { classify, world, bodyFactory, compose, materials } = env;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name + (detail ? '  —  ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  —  ' + detail : '')); }
}

const ramp = (w) => {
  const b = M.Bodies.rectangle(215, 260, 460, 16, { isStatic: true, angle: 0.14, label: 'ramp' });
  b.friction = 0.9; b.frictionStatic = 1.0; b.restitution = 0;
  w.addBody(b);
  return b;
};

/** 在斜坡上把造物放 3 秒，返回横向位移与末速度 */
function slide(strokes, abilityIds, seconds) {
  const w = world.createPhysicsWorld();
  ramp(w);
  const geo = classify.analyzeStrokeGroup([{ pts: strokes }]);
  const c = compose.composeAbilities(abilityIds || []);
  const built = bodyFactory.buildCreatureBody({ form: geo.form, geo, thickness: 9, spawn: { x: 215, y: 700 }, mods: c.mods, flags: c.flags });
  for (const b of built.bodies) w.addBody(b);
  // 统一摆到坡上同一处（坡面在 x≈60 处，y 由坡面决定）
  const bodies = built.bodies.filter((b) => !b.isStatic);
  const cx0 = bodies.reduce((s, b) => s + b.position.x, 0) / bodies.length;
  const cy0 = bodies.reduce((s, b) => s + b.position.y, 0) / bodies.length;
  const dx = 60 - cx0;
  const dy = (260 + (60 - 215) * Math.tan(0.14) - 30) - cy0;
  for (const b of bodies) M.Body.translate(b, { x: dx, y: dy });
  const x0 = bodies[0].position.x;
  const frames = Math.round((seconds || 3) * 60);
  let vmax = 0;
  for (let f = 0; f < frames; f++) {
    w.step();
    for (const b of bodies) vmax = Math.max(vmax, Math.hypot(b.velocity.x, b.velocity.y));
  }
  const dist = bodies[0].position.x - x0;
  const rolled_angle = Math.abs(bodies[0].angle);
  const air = built.bodies.filter((b) => !b.isStatic).map((b) => b.frictionAir);
  const fr = built.bodies.filter((b) => !b.isStatic).map((b) => b.friction);
  const fs = built.bodies.filter((b) => !b.isStatic).map((b) => b.frictionStatic);
  w.clear();
  return { dist, vmax, angle: rolled_angle, form: geo.form, air, fr, fs, mass: bodies[0].mass };
}

const circle = synthCircle(215, 700, 26, 4);
const line = synthLine(160, 700, 270, 704, 4, 0.7);

console.log('\n===== D16 会滚 =====');

// ① 摩擦一个字都不动
const plain = slide(circle, [], 3);
const rolled = slide(circle, ['roll'], 3);
check('圆：会滚不改 friction', plain.fr[0] === rolled.fr[0], `friction ${plain.fr[0]} vs ${rolled.fr[0]}`);
check('圆：会滚不改 frictionStatic', plain.fs[0] === rolled.fs[0], `frictionStatic ${plain.fs[0]} vs ${rolled.fs[0]}`);
check('圆：会滚只压 frictionAir ×0.25',
  Math.abs(rolled.air[0] - plain.air[0] * 0.25) < 1e-9,
  `frictionAir ${plain.air[0]} → ${rolled.air[0]}`);
check('圆：基线摩擦仍是造物软基线（没有变成冰面）',
  plain.fr[0] === materials.CREATURE_SOFT.friction && plain.fr[0] > 0,
  `friction=${plain.fr[0]}`);

// ② 效果：圆滚得更远
check('圆会滚：横向位移明显更远', rolled.dist > plain.dist * 1.25,
  `${plain.dist.toFixed(0)}px → ${rolled.dist.toFixed(0)}px（×${(rolled.dist / plain.dist).toFixed(2)}）`);
check('圆：两种都真的在滚（自转角 ≠ 0，不是滑）',
  Math.abs(rolled.angle) > 0.5 && Math.abs(plain.angle) > 0.5,
  `转过 ${plain.angle.toFixed(1)} / ${rolled.angle.toFixed(1)} rad`);

// ③ 形状无关性：长条贴会滚基本无变化
const linePlain = slide(line, [], 3);
const lineRolled = slide(line, ['roll'], 3);
const lineRel = Math.abs(lineRolled.dist - linePlain.dist) / Math.max(1, Math.abs(linePlain.dist));
check('长条：贴会滚基本无变化（同一能力只在形状对时才有意义）', lineRel < 0.15,
  `${linePlain.dist.toFixed(0)}px → ${lineRolled.dist.toFixed(0)}px（差 ${(lineRel * 100).toFixed(1)}%）`);

// ④ 被否决的方案留证：friction=0 的圆「不转」，它是滑不是滚
{
  const geo = classify.analyzeStrokeGroup([{ pts: circle }]);
  const w = world.createPhysicsWorld();
  ramp(w);
  const built = bodyFactory.buildCreatureBody({
    form: geo.form, geo, thickness: 9, spawn: { x: 215, y: 700 },
    mods: { friction: 0, frictionStatic: 0 }, flags: {},
  });
  for (const b of built.bodies) w.addBody(b);
  const bodies = built.bodies.filter((b) => !b.isStatic);
  const cyFace = 260 + (60 - 215) * Math.tan(0.14) - 30;
  for (const b of bodies) M.Body.translate(b, { x: 60 - b.position.x, y: cyFace - b.position.y });
  for (let f = 0; f < 180; f++) w.step();
  const angleZeroFriction = Math.abs(bodies[0].angle);
  check('friction=0 的圆（已否决方案）：下坡位移不小，但**一点不转**——它是滑，不是滚',
    angleZeroFriction < 0.05,
    `转过 ${angleZeroFriction.toFixed(3)} rad（会滚时是 ${rolled.angle.toFixed(1)} rad）`);
  w.clear();
}

// ④b 平地推一把：friction=0 = 永不停（冰面），会滚 = 抓地还在、会停
{
  const flat = (w) => {
    const g = M.Bodies.rectangle(215, 300, 460, 16, { isStatic: true });
    g.friction = 0.9; g.frictionStatic = 1.0; g.restitution = 0;
    w.addBody(g);
  };
  const push = (mods) => {
    const geo = classify.analyzeStrokeGroup([{ pts: circle }]);
    const w = world.createPhysicsWorld();
    flat(w);
    const built = bodyFactory.buildCreatureBody({
      form: geo.form, geo, thickness: 9, spawn: { x: 215, y: 700 }, mods, flags: {},
    });
    for (const b of built.bodies) w.addBody(b);
    const bodies = built.bodies.filter((b) => !b.isStatic);
    for (const b of bodies) M.Body.translate(b, { x: 80 - b.position.x, y: 292 - b.position.y });
    M.Body.setVelocity(bodies[0], { x: 6, y: 0 });
    for (let f = 0; f < 240; f++) w.step();
    const v = Math.hypot(bodies[0].velocity.x, bodies[0].velocity.y);
    const x = bodies[0].position.x - 80;
    const ang = Math.abs(bodies[0].angle);
    w.clear();
    return { v, x, ang };
  };
  const ice = push({ friction: 0, frictionStatic: 0 });
  const grip = push({ frictionAirMul: 0.25 });
  const iceExpected = ice.x / 26;   // 真的滚过这么多距离，应转 x/r 弧度
  check('平地上 friction=0：滑得最远，但**几乎不转**——那是打滑（skating），不是滚',
    ice.x > grip.x * 1.3 && ice.ang < iceExpected * 0.1,
    `滑出 ${ice.x.toFixed(0)}px，真滚应转 ${iceExpected.toFixed(1)} rad，实际只 ${ice.ang.toFixed(2)} rad`);
  check('会滚：距离短得多，但**真在转**——traction 保留',
    grip.ang > 1.0,
    `走 ${grip.x.toFixed(0)}px、转 ${grip.ang.toFixed(1)} rad（会滚的"滚"是转出来的）`);
}

// ⑤ 乘算可交换（R3）：与变重叠加，顺序无关
const a1 = compose.composeAbilities(['roll', 'heavy']).mods;
const a2 = compose.composeAbilities(['heavy', 'roll']).mods;
check('会滚 × 变重：乘算结果与点选顺序无关',
  a1.frictionAirMul === a2.frictionAirMul && a1.densityMul === a2.densityMul,
  `roll→heavy ${a1.frictionAirMul}/${a1.densityMul}  heavy→roll ${a2.frictionAirMul}/${a2.densityMul}`);

console.log(`\n# pass ${pass}  fail ${fail}`);
process.exit(fail ? 1 : 0);
