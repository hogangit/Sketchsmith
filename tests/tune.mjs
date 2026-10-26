/**
 * tests/tune.mjs —— 标定用的手动诊断脚本（不属于自动测试，`node tests/tune.mjs`）
 * 作用：把「某关 + 某种画法 + 某组能力」整关跑一遍，打印物理轨迹，用来标定阈值与验证解法。
 */
import { loadGameEnv, synthLine, synthCircle, synthRect } from './helpers/env.mjs';

const env = await loadGameEnv();
const { classify, world, runtime, budget } = env;

function runCase(name, { level, strokes, abilities, seconds, trace, traceKey }) {
  budget.BodyBudget.reset();
  budget.StrokeBudget.reset();
  const w = world.createPhysicsWorld();
  const events = [];
  const bus = { emit: (ev, p) => events.push([ev, p]), on() {}, countOf() { return 0; } };
  const rt = runtime.createLevelRuntime({ level, world: w, bus });

  const stroke = { pts: strokes };
  const geo = classify.analyzeStrokeGroup([stroke]);
  const c = rt.spawnCreature({ form: geo.form, geo, thickness: 9 });
  for (const a of abilities) rt.setAbility(a);

  const maxFrames = Math.round((seconds || 8) * 60);
  const log = [];
  let outcome = 'timeout';
  for (let f = 0; f < maxFrames; f++) {
    rt.step(1);
    const ev = events.find((e) => e[0] === 'level:win');
    if (ev) { outcome = 'WIN'; break; }
    if (f % 30 === 0 && trace) {
      const s = rt.snapshot();
      log.push(`  t=${(f / 60).toFixed(1)}s ` + trace.map((k) => {
        if (k === 'pumpkin') return `南瓜x=${(s.propPos ? s.propPos.x : 0).toFixed(0)} y=${(s.propPos ? s.propPos.y : 0).toFixed(0)}`;
        if (k === 'actor') return `小人x=${(s.actorPos ? s.actorPos.x : 0).toFixed(0)} y=${(s.actorPos ? s.actorPos.y : 0).toFixed(0)}`;
        if (k === 'plate') return `压板load=${(s.plate[0] ? s.plate[0].load : 0).toFixed(1)} hold=${(s.plate[0] ? s.plate[0].holdMs : 0).toFixed(0)}`;
        if (k === 'creature') return `造物y=${c && c.bodies[0] ? c.bodies[0].position.y.toFixed(0) : '-'}`;
        return '';
      }).join(' '));
    }
  }
  const s = rt.snapshot();
  const fails = events.filter((e) => e[0] === 'level:fail').map((e) => e[1].reason);
  console.log(`\n[${name}] form=${geo.form} aspect=${geo.aspect.toFixed(2)} area=${geo.area.toFixed(0)} ` +
    `closed=${geo.closed} degraded=${s.creature ? s.creature.degraded : '-'} parts=${s.creature ? s.creature.parts : '-'} ` +
    `mass=${s.creature ? s.creature.mass.toFixed(1) : '-'}`);
  console.log(`  → ${outcome}${fails.length ? '  fails=' + fails.join(',') : ''}`);
  if (trace) console.log(log.join('\n'));
  rt.destroy();
  return outcome === 'WIN';
}

const L1 = env.levels.l1.LEVEL_CH1_01;
const L2 = env.levels.l2.LEVEL_CH1_02;
const L3 = env.levels.l3.LEVEL_CH1_03;

const which = process.argv[2] || 'all';

if (which === 'all' || which === 'l1') {
  console.log('\n===== 关1 一个洞 =====');
  runCase('L1-梁+变硬', { level: L1, strokes: synthLine(148, 700, 352, 703, 4, 0.7), abilities: ['harden'], seconds: 12, trace: ['actor'], traceKey: 'actor' });
  runCase('L1-梁无能力', { level: L1, strokes: synthLine(148, 700, 352, 703, 4, 0.7), abilities: [], seconds: 12, trace: ['actor'] });
  runCase('L1-扁闭合圈+变硬(兜底)', { level: L1, strokes: synthRect(249, 700, 210, 46, 5), abilities: ['harden'], seconds: 16, trace: ['actor'] });
  runCase('L1-扁闭合圈无能力', { level: L1, strokes: synthRect(249, 700, 210, 46, 5), abilities: [], seconds: 14, trace: ['actor'] });
  runCase('L1-圆轮+变硬', { level: L1, strokes: synthCircle(249, 700, 40, 6), abilities: ['harden'], seconds: 14, trace: ['actor'] });
  runCase('L1-什么都不画', { level: L1, strokes: synthLine(120, 700, 130, 712, 4, 0.7), abilities: [], seconds: 10, trace: ['actor'] });
}

if (which === 'all' || which === 'l2') {
  console.log('\n===== 关2 滚下去的南瓜（坡道接驳式）=====');
  runCase('L2-梁+变硬', { level: L2, strokes: synthLine(196, 700, 312, 704, 4, 0.7), abilities: ['harden'], seconds: 20, trace: ['pumpkin'] });
  runCase('L2-扁闭合团块+变硬(兜底)', { level: L2, strokes: synthRect(254, 700, 118, 34, 5), abilities: ['harden'], seconds: 20, trace: ['pumpkin'] });
  runCase('L2-梁无能力(软桥)', { level: L2, strokes: synthLine(196, 700, 312, 704, 4, 0.7), abilities: [], seconds: 20, trace: ['pumpkin'] });
  runCase('L2-梁+会滚', { level: L2, strokes: synthLine(196, 700, 312, 704, 4, 0.7), abilities: ['roll'], seconds: 20, trace: ['pumpkin'] });
  runCase('L2-不架坡', { level: L2, strokes: synthLine(60, 700, 70, 712, 4, 0.7), abilities: [], seconds: 16, trace: ['pumpkin'] });
}

if (which === 'all' || which === 'l3') {
  console.log('\n===== 关3 踩不动的水泵 =====');
  runCase('L3-团块+变重', { level: L3, strokes: synthCircle(340, 700, 34, 4), abilities: ['heavy'], seconds: 14, trace: ['plate'] });
  runCase('L3-团块无能力', { level: L3, strokes: synthCircle(340, 700, 34, 4), abilities: [], seconds: 10, trace: ['plate'] });
  runCase('L3-轮+会滚+变重', { level: L3, strokes: synthCircle(340, 700, 35, 4), abilities: ['roll', 'heavy'], seconds: 14, trace: ['plate'] });
  runCase('L3-大团块无能力', { level: L3, strokes: synthCircle(340, 700, 52, 4), abilities: [], seconds: 10, trace: ['plate'] });
}
