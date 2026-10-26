/**
 * src/level/runtime.js —— 关卡运行时（零 DOM：可以在 node 里整关跑物理）
 *
 * 职责：把「关卡数据 + 造物刚体 + 角色行为 + 机关判定」跑成一局，
 * 胜负只从物理状态推导出来（不写死脚本动画），事件全部走 bus。
 *
 * 对外接口：
 *   createLevelRuntime({level, world, bus})
 *   → { spawnCreature, setAbility, toggleAbility, step, snapshot, destroy, state }
 */
import { DESIGN_W } from '../core/config.js';
import { ACTOR, DENSITY_PUMPKIN, FIXED_STEP_MS, MATERIALS, PLATE } from '../physics/materials.js';
import { buildCreatureBody } from '../physics/body-factory.js';
import { composeAbilities } from '../abilities/compose.js';
import { BodyBudget } from '../physics/budget.js';
import { MAX_ABILITIES_PER_CREATURE } from '../stroke/thresholds.js';

const MATTER_RT = typeof Matter !== 'undefined' ? Matter : globalThis.Matter;  // 本文件专用别名（兜底拼接器 D3：顶层名全仓库唯一）
const CREATURE_DESPAWN_Y = 780;
const MAX_LIVE_CREATURES = 2;     // N1：同时最多 2 个造物（试错-迭代不允许“一画就吞掉前一个”）
const CREATURE_FADE_MS = 200;     // 被替换的那个淡出 200ms，不许瞬间消失
const LANDING_MAX_FALL_SPEED = 3.4;   // px/step，落地缓冲期内的下落速度上限
const LANDING_FRAMES = 26;
const ACTOR_PIT_FAIL_MS = 2500;
const PLATE_LIGHT_FAIL_MS = 2500;
/** 南瓜"已经停稳"的速度门槛（px/step）：低于它才算落点已定，才判砸碎 */
const SETTLE_SPEED = 1.2;

function clampNum(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** 造一个会走会跳的小人（走路小人只服务演出与「他自己会去用它」） */
function spawnWalkerBody(def, world) {
  const body = MATTER_RT.Bodies.circle(def.x, def.y, ACTOR.radius, {
    label: 'actor', friction: ACTOR.friction, frictionAir: ACTOR.frictionAir, restitution: 0,
  });
  MATTER_RT.Body.setMass(body, ACTOR.mass);
  world.addBody(body);
  return {
    kind: 'walker',
    body,
    start: { x: def.x, y: def.y },
    targetX: def.targetX,
    label: def.label || '小人',
    active: false,      // 造物落地之后才开始走（否则玩家还没画他就掉沟里了）
    jumpCd: 0,
    stuck: 0,
    lastX: def.x,
    pitMs: 0,
    jumping: 0,
  };
}

/** 走路小人 AI：朝目标走；被挡住（连续 N 帧没位移）就跳一次 */
function stepWalker(a, world, dtMs) {
  const b = a.body;
  if (!a.active) return;
  if (a.jumpCd > 0) a.jumpCd = Math.max(0, a.jumpCd - dtMs);
  let ground = false;
  for (const off of [-6, 0, 6]) {
    const from = { x: b.position.x + off, y: b.position.y + ACTOR.radius - 2 };
    const to = { x: b.position.x + off, y: b.position.y + ACTOR.radius + 8 };
    if (world.raycast(from, to, 2).some((h) => h.body !== b)) { ground = true; break; }
  }
  const standing = ground && b.velocity.y > -1.2 && b.velocity.y < 1.0;
  const dx = a.targetX - b.position.x;
  const dir = Math.abs(dx) > ACTOR.arriveTolerance ? Math.sign(dx) : 0;

  if (standing) {
    // 速度逐步逼近目标速度（不是每帧硬设），否则小人会把桥当推土机推走
    const targetVx = dir * ACTOR.speed;
    const dvx = Math.max(-ACTOR.accelStep, Math.min(ACTOR.accelStep, targetVx - b.velocity.x));
    MATTER_RT.Body.setVelocity(b, { x: b.velocity.x + dvx, y: b.velocity.y });
    if (dir !== 0 && Math.abs(b.position.x - a.lastX) < 0.25) a.stuck++; else a.stuck = 0;
    if (a.stuck >= ACTOR.stuckFrames && a.jumpCd <= 0) {
      MATTER_RT.Body.setVelocity(b, { x: dir * ACTOR.speed * 1.15, y: -ACTOR.jumpSpeed });
      a.jumpCd = ACTOR.jumpCooldownMs;
      a.stuck = 0;
      a.jumping = 300;
    }
  }
  a.lastX = b.position.x;
  if (a.jumping > 0) a.jumping -= dtMs;
}

export function createLevelRuntime(opts) {
  const level = opts.level;
  const world = opts.world;
  const bus = opts.bus || { emit() {}, on() {}, countOf() { return 0; } };

  const state = {
    level,
    status: 'playing',      // playing | finished
    elapsedMs: 0,
    failStreak: 0,
    lastFailReason: null,
    hintLevel: 0,
    terrain: [],
    actor: null,
    props: [],
    plates: [],
    creatures: [],
    activeCreature: null,
    armedAbilities: [],
    degradeLog: [],
    creatureSeq: 0,
    plateFailMark: new Set(),
    actorReadyAt: -1,
    actorResumeAt: -1,
  };

  // ---- 地形 ----
  for (const t of level.terrain) {
    const mat = MATERIALS[t.mat] || MATERIALS.ground;
    const body = MATTER_RT.Bodies.rectangle(t.x, t.y, t.w, t.h, {
      isStatic: true, angle: t.angle || 0, label: 'terrain',
      friction: mat.friction, frictionStatic: mat.frictionStatic, restitution: mat.restitution,
    });
    body.plugin = { mat: t.mat || 'ground', terrain: true };
    world.addBody(body);
    state.terrain.push(body);
  }

  // ---- 移动角色 ----
  if (level.actors && level.actors.length) state.actor = spawnWalkerBody(level.actors[0], world);

  // ---- 道具（关2 的南瓜） ----
  for (const p of level.props || []) {
    const mat = MATERIALS.pumpkin;
    const body = MATTER_RT.Bodies.rectangle(p.x, p.y, p.w, p.h, {
      label: 'prop', friction: mat.friction, frictionStatic: mat.frictionStatic,
      restitution: mat.restitution, frictionAir: mat.frictionAir == null ? 0.01 : mat.frictionAir,
    });
    MATTER_RT.Body.setDensity(body, DENSITY_PUMPKIN);   // 红线 L6：密度只在 materials.js 里写
    body.plugin = {
      kind: p.kind, home: { x: p.x, y: p.y }, graceMs: p.graceMs || 0,
      vx0: Number.isFinite(p.vx0) ? p.vx0 : null, stallMs: 0,
      releaseOnSpawn: p.releaseOnSpawn === true,
    };
    if (body.plugin.graceMs > 0) MATTER_RT.Body.setStatic(body, true);
    world.addBody(body);
    state.props.push(body);
  }

  // ---- 压板 ----
  for (const pl of level.plates || []) {
    state.plates.push({
      def: pl, load: 0, holdMs: 0, releaseMs: 0, on: false, everOn: false,
    });
  }

  function emit(ev, payload) { bus.emit(ev, payload); }

  function addCreatureBodies(c) {
    for (const b of c.bodies) world.addBody(b);
    for (const con of c.constraints) world.addConstraint(con);
  }
  function removeCreatureBodies(c) {
    for (const con of c.constraints) world.removeConstraint(con);
    for (const b of c.bodies) world.removeBody(b);
    c.bodies = [];
    c.constraints = [];
  }

  function despawnCreature(c) {
    removeCreatureBodies(c);
    BodyBudget.release();
    const i = state.creatures.indexOf(c);
    if (i >= 0) state.creatures.splice(i, 1);
    if (state.activeCreature === c) state.activeCreature = null;
    emit('creature:despawn', { id: c.id });
  }

  /** 生成造物：落点 x = 笔画质心 x（造物簿与世界共用同一 x 轴），从天下掉下来 */
  function spawnCreature(spec) {
    if (state.status !== 'playing') return null;
    // N1：不清空旧造物，只在超过上限时让**最旧**的那个淡出
    const live = state.creatures.filter((c) => !(c.fadeMs > 0));
    while (live.length >= MAX_LIVE_CREATURES) {
      const oldest = live.shift();
      if (!oldest) break;
      oldest.fadeMs = CREATURE_FADE_MS;
      for (const b of oldest.bodies) { b.render = b.render || {}; b.render.opacity = 1; }
    }
    if (!BodyBudget.trySpawn()) {
      emit('creature:rejected', { reason: 'budget' });
      return null;
    }
    const spawn = {
      x: clampNum(spec.geo.centroid.x, 18, DESIGN_W - 18),
      y: level.spawnY == null ? 84 : level.spawnY,
    };
    const composed = composeAbilities(state.armedAbilities);
    const built = buildCreatureBody({
      form: spec.form, geo: spec.geo, thickness: spec.thickness, spawn,
      mods: composed.mods, flags: composed.flags,
    });
    const c = {
      id: ++state.creatureSeq,
      form: spec.form,
      geo: spec.geo,
      thickness: spec.thickness,
      bodies: built.bodies,
      constraints: built.constraints,
      degraded: built.degraded,
      abilities: state.armedAbilities.slice(),
      composed,
      spawn,
      bornAt: state.elapsedMs,
    };
    for (const b of c.bodies) { b.plugin = b.plugin || {}; b.plugin.landingFrames = LANDING_FRAMES; }
    addCreatureBodies(c);
    state.creatures.push(c);
    state.activeCreature = c;
    if (state.actor && !state.actor.active && state.actorReadyAt < 0) state.actorReadyAt = state.elapsedMs + 600;
    // 关2：南瓜一开始被钉住，等玩家把接驳坡架好再放手（否则玩家还没反应过来它就滑进河里了）
    for (const p of state.props) {
      if (p.plugin && p.plugin.releaseOnSpawn && p.isStatic && p.plugin.graceMs > 3000) {
        p.plugin.graceMs = level.propReleaseDelayMs || 1500;
      }
    }
    if (built.degraded !== 'none') state.degradeLog.push({ id: c.id, degraded: built.degraded });
    const main = c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]);
    emit('creature:spawn', {
      id: c.id, form: c.form, spawn, degraded: built.degraded,
      mass: main ? main.mass : 0, parts: main ? main.parts.length - 1 : 0,
      abilities: c.abilities.slice(),
    });
    return c;
  }

  /** 质量加权重心（多刚体造物用它对齐位置，单刚体就是 position） */
  function massCenter(bodies) {
    let m = 0, x = 0, y = 0;
    for (const b of bodies) { m += b.mass; x += b.position.x * b.mass; y += b.position.y * b.mass; }
    return m > 0 ? { x: x / m, y: y / m } : { x: 0, y: 0 };
  }

  function rebuildCreature(c) {
    const primary = c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]);
    const anchor = massCenter(c.bodies);          // 重建前后的重心必须重合
    const vel = { x: primary.velocity.x, y: primary.velocity.y };
    const ang = primary.angle;
    const av = primary.angularVelocity;
    removeCreatureBodies(c);
    const composed = composeAbilities(c.abilities);
    // 先以原点为锚构建（buildCreatureBody 会把它按 geo 质心居中到 spawn），再整体平移到原重心。
    // 不能用“主刚体位置”当 spawn：软梁两个半段的中心不是整根梁的中心，会横移 len/4。
    const built = buildCreatureBody({
      form: c.form, geo: c.geo, thickness: c.thickness, spawn: { x: 0, y: 0 },
      mods: composed.mods, flags: composed.flags,
    });
    const after = massCenter(built.bodies);
    const dx = anchor.x - after.x;
    const dy = anchor.y - after.y;
    if (dx || dy) for (const b of built.bodies) MATTER_RT.Body.setPosition(b, { x: b.position.x + dx, y: b.position.y + dy });
    c.bodies = built.bodies;
    c.constraints = built.constraints;
    c.degraded = built.degraded;
    c.composed = composed;
    addCreatureBodies(c);
    for (const b of c.bodies) {
      MATTER_RT.Body.setVelocity(b, vel);
      MATTER_RT.Body.setAngularVelocity(b, av);
      if (c.bodies.length === 1) MATTER_RT.Body.setAngle(b, ang);
    }
  }

  /** 点芯片：有造物就重建它，没造物就预选给下一个 */
  function setAbility(id) {
    const c = state.activeCreature;
    if (!c) {
      const i = state.armedAbilities.indexOf(id);
      if (i >= 0) state.armedAbilities.splice(i, 1);
      else if (state.armedAbilities.length < MAX_ABILITIES_PER_CREATURE) state.armedAbilities.push(id);
      else { emit('ability:rejected', { id, reason: 'cap' }); return { rejected: true }; }
      emit('ability:attach', { id, on: state.armedAbilities.includes(id), armed: true });
      return { armed: true };
    }
    const has = c.abilities.indexOf(id) >= 0;
    if (!has && c.abilities.length >= MAX_ABILITIES_PER_CREATURE) {
      emit('ability:rejected', { id, reason: 'cap' });
      return { rejected: true };
    }
    if (has) c.abilities = c.abilities.filter((a) => a !== id);
    else c.abilities.push(id);
    state.armedAbilities = c.abilities.slice();
    rebuildCreature(c);
    emit('ability:attach', { id, on: !has, form: c.form });
    if (!has && c.composed.combos.length) emit('combo:trigger', { ids: c.abilities.slice(), combos: c.composed.combos });
    return { ok: true, abilities: c.abilities.slice() };
  }

  function fail(reason) {
    state.failStreak++;
    state.lastFailReason = reason;
    state.hintLevel = Math.min(3, state.failStreak);
    emit('level:fail', { reason, failStreak: state.failStreak, hintLevel: state.hintLevel });
  }

  function updateWalker(dtMs) {
    const a = state.actor;
    if (!a) return;
    const failY = level.resetActorIfBelowY == null ? 1e9 : level.resetActorIfBelowY;
    if (a.body.position.y > failY) {
      a.pitMs += dtMs;
      if (a.pitMs > ACTOR_PIT_FAIL_MS) {
        a.pitMs = 0;
        MATTER_RT.Body.setPosition(a.body, a.start);
        MATTER_RT.Body.setVelocity(a.body, { x: 0, y: 0 });
        MATTER_RT.Body.setAngularVelocity(a.body, 0);
        fail('actor-fell');
      }
    } else if (a.body.position.y < failY - 60) {
      // 只有真的回到地面才算“没掉下去”；小人跳跃会短暂高过 failY，不能用 failY 直接清零
      a.pitMs = 0;
    }
  }

  function updatePlates(dtMs) {
    for (const p of state.plates) {
      const d = p.def;
      const hits = world.bodiesInRect({ x: d.x, y: d.y, w: d.w, h: d.h });
      let load = 0;
      for (const b of hits) {
        if (b.isStatic) continue;
        if (b === (state.actor && state.actor.body)) { load += b.mass; continue; }
        const speed = Math.hypot(b.velocity.x, b.velocity.y);
        if (speed > PLATE.minBodySpeed) continue;
        load += b.mass;
      }
      p.load = load;
      const pressed = load >= d.threshold;
      if (pressed) { p.holdMs += dtMs; p.releaseMs = 0; } else {
        p.releaseMs += dtMs;
        if (p.releaseMs > PLATE.releaseMs) p.holdMs = 0;
      }
      const wasOn = p.on;
      p.on = p.holdMs >= PLATE.sustainMs;
      if (p.on && !wasOn && !p.everOn) { p.everOn = true; emit('plate:on', { id: d.id, load }); }
      if (!p.on && wasOn) emit('plate:off', { id: d.id, load });
    }
  }

  /** 关3 的“压不动”失败：有造物压上去但重量一直不够 */
  function updatePlateSoftFail(dtMs) {
    for (const p of state.plates) {
      for (const c of state.creatures) {
        if (state.plateFailMark.has(c.id)) continue;
        const held = c.bodies.some((b) => b.position.x > p.def.x - 10 && b.position.x < p.def.x + p.def.w + 10 &&
          b.position.y > p.def.y - 40 && b.position.y < p.def.y + p.def.h + 30);
        if (!held) continue;
        c.plateSettleMs = (c.plateSettleMs || 0) + dtMs;
        if (c.plateSettleMs > PLATE_LIGHT_FAIL_MS && p.load < p.def.threshold) {
          state.plateFailMark.add(c.id);
          fail('too-light');
        }
      }
    }
  }

  function checkGoal() {
    const g = level.goal;
    if (g.type === 'reachActor') {
      const a = state.actor;
      if (a && a.body.position.x >= g.x && a.body.position.y <= (g.maxY == null ? 400 : g.maxY)) win('actor-crossed');
    } else if (g.type === 'propReach') {
      const p = state.props[g.propIndex || 0];
      if (p && p.position.x >= g.x) win('prop-delivered');
    } else if (g.type === 'propInZone') {
      // 关2：收货口是一个区域，不是一个 x 坐标。
      // 进去 = 成功；在沟底停稳但在区域外 = 砸在沟底石头上 = 碎（失败）。
      //
      // [实测坑] g.y 是**南瓜中心**的判定高度，不是地面的高度：
      // 沟底棚布面 y=470，南瓜 62 高 → 停稳时中心 y≈430（实测 426–435）。
      // 早先写 460（"比地面低一点"）→ 永远不成立 → 关卡对任何解法都不可过（实测 25/25 timeout）。
      // 所以门槛取 400（比台面 300 低一整个南瓜身位，且在停稳高度之上）。
      //
      // [实测坑] 失败必须等它**慢下来**才判：下落途中 x 还在扫过口沿，
      // 用瞬时 x 判会把"擦着口沿最后滚进去"的球误判成碎。
      const p = state.props[g.propIndex || 0];
      if (!p) return;
      if (p.position.y < g.y) {
        if (p.position.y < 260) state.propSmashed = false;   // 南瓜被重置回台上，标记复位
        return;
      }
      if (p.position.x >= g.x1 && p.position.x <= g.x2) { win('prop-caught'); return; }
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      if (speed < SETTLE_SPEED && !state.propSmashed) { state.propSmashed = true; fail('prop-smashed'); }
    } else if (g.type === 'plateSustained') {
      const p = state.plates.find((x) => x.def.id === g.plateId) || state.plates[0];
      if (p && p.on) win('plate-sustained');
    }
  }

  function win(reason) {
    if (state.status === 'finished') return;
    state.status = 'finished';
    emit('level:win', { reason, elapsedMs: state.elapsedMs, failStreak: state.failStreak });
  }

  /** 南瓜的“预备—放行”：静止 graceMs 后转成动态（不用魔法，是关卡节奏） */
  /** 南瓜掉进河里之后：把农夫也送回起点，歇一会儿再来一次（否则他走到终点就再也不回来了 → 死路） */
  function resetActorForRetry() {
    const a = state.actor;
    if (!a) return;
    MATTER_RT.Body.setPosition(a.body, a.start);
    MATTER_RT.Body.setVelocity(a.body, { x: 0, y: 0 });
    MATTER_RT.Body.setAngularVelocity(a.body, 0);
    a.active = false;
    a.pitMs = 0;
    a.stuck = 0;
    a.jumpCd = 0;
    a.lastX = a.start.x;
    state.actorResumeAt = state.elapsedMs + (level.propRetryMs || 1200);
  }

  function updatePropGrace(dtMs) {
    for (const p of state.props) {
      if (!p.plugin || !(p.plugin.graceMs > 0)) continue;
      if (p.isStatic) {
        p.plugin.graceMs -= dtMs;
        if (p.plugin.graceMs <= 0) {
          MATTER_RT.Body.setStatic(p, false);
          if (Number.isFinite(p.plugin.vx0)) MATTER_RT.Body.setVelocity(p, { x: p.plugin.vx0, y: 0 });
          emit('prop:release', { kind: p.plugin.kind });
        }
      }
    }
  }

  function updatePropStall(dtMs) {
    // 老关2 用"南瓜卡住"当失败（那时解法是让它滑）；新关2 里**南瓜不动才是正常初始状态**，
    // 所以只在关卡显式声明 propStallFails=true 时才判（goal.type==='propInZone' 的关不判）。
    if (level.goal && level.goal.type === 'propInZone') return;
    for (const p of state.props) {
      if (!p.plugin || p.isStatic) continue;
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      if (speed < 0.12) p.plugin.stallMs += dtMs; else p.plugin.stallMs = 0;
      if (p.plugin.stallMs > 3000) {
        p.plugin.stallMs = 0;
        fail('prop-stalled');
        MATTER_RT.Body.setPosition(p, p.plugin.home);
        MATTER_RT.Body.setVelocity(p, { x: 0, y: 0 });
        MATTER_RT.Body.setAngle(p, 0);
        MATTER_RT.Body.setAngularVelocity(p, 0);
        p.plugin.graceMs = 1200;
        MATTER_RT.Body.setStatic(p, true);
        resetActorForRetry();
      }
    }
  }

  function updatePropReset() {
    const limit = level.resetPropIfBelowY;
    if (limit == null) return;
    for (const p of state.props) {
      if (p.position.y > limit) {
        MATTER_RT.Body.setPosition(p, p.plugin.home);
        MATTER_RT.Body.setVelocity(p, { x: 0, y: 0 });
        MATTER_RT.Body.setAngle(p, 0);
        MATTER_RT.Body.setAngularVelocity(p, 0);
        p.plugin.graceMs = 1400;
        MATTER_RT.Body.setStatic(p, true);
        fail('prop-lost');
        resetActorForRetry();
      }
    }
  }

  function step(frames) {
    const n = frames == null ? 1 : Math.max(1, frames | 0);
    const advanced = world.stepFrame(n, (subDt) => {
      if (state.actor && state.actor.active && state.status === 'playing') stepWalker(state.actor, world, subDt);
      // 造物落地缓冲：生成后 26 帧内限制下落速度，让“架在沟沿上”是可控而非撞运气
      for (const c of state.creatures) {
        for (const b of c.bodies) {
          if (b.plugin && b.plugin.landingFrames > 0) {
            b.plugin.landingFrames--;
            if (b.velocity.y > LANDING_MAX_FALL_SPEED) {
              MATTER_RT.Body.setVelocity(b, { x: b.velocity.x, y: LANDING_MAX_FALL_SPEED });
            }
          }
        }
      }
    });
    const dt = advanced * FIXED_STEP_MS;
    state.elapsedMs += dt;
    // 造物落地后 600ms，小人开始行动（先让它掉下来、站稳）
    if (state.actor && !state.actor.active && state.actorReadyAt >= 0 && state.elapsedMs >= state.actorReadyAt) {
      state.actor.active = true;
      emit('actor:go', { label: state.actor.label });
    }
    // 南瓜掉河后的重试：歇够了农夫自己再走一趟
    if (state.actor && !state.actor.active && state.actorResumeAt >= 0 && state.elapsedMs >= state.actorResumeAt) {
      state.actorResumeAt = -1;
      state.actor.active = true;
      emit('actor:go', { label: state.actor.label, retry: true });
    }
    updateWalker(dt);
    updatePropGrace(dt);
    updatePropStall(dt);
    updatePropReset();
    updatePlates(dt);
    updatePlateSoftFail(dt);
    // 淡出中的造物：透明度线性衰减，归零才真正移除
    for (const c of state.creatures.slice()) {
      if (!(c.fadeMs > 0)) continue;
      c.fadeMs -= dt;
      const a = Math.max(0, c.fadeMs / CREATURE_FADE_MS);
      for (const b of c.bodies) { b.render = b.render || {}; b.render.opacity = a; }
      if (c.fadeMs <= 0) despawnCreature(c);
    }
    // 掉出世界的造物回收，避免越积越多
    for (const c of state.creatures.slice()) {
      const lowest = Math.max(...c.bodies.map((b) => b.position.y));
      if (lowest > CREATURE_DESPAWN_Y) {
        const id = c.id;
        despawnCreature(c);
        emit('creature:lost', { id });
      }
    }
    if (state.status === 'playing') checkGoal();
    return dt;
  }

  function snapshot() {
    const c = state.activeCreature;
    const geo = c ? c.geo : null;
    const main = c ? c.bodies.reduce((a, b) => (b.mass > a.mass ? b : a), c.bodies[0]) : null;
    return {
      levelId: level.id,
      title: level.title,
      status: state.status,
      elapsedMs: state.elapsedMs,
      failStreak: state.failStreak,
      hintLevel: state.hintLevel,
      chips: level.chips,
      armedAbilities: state.armedAbilities.slice(),
      creature: c ? {
        id: c.id, form: c.form,
        label: { beam: '梁', wheel: '轮', blob: '团块', container: '容器', rope: '绳', pile: '松散堆', grain: '颗粒' }[c.form] || c.form,
        degraded: c.degraded,
        mass: main ? main.mass : 0,
        parts: main ? main.parts.length - 1 : 0,
        bodies: c.bodies.length,
        abilities: c.abilities.slice(),
        mods: c.composed.mods,
        combos: c.composed.combos.map((x) => x.name),
        geo: geo ? {
          w: geo.bbox.w, h: geo.bbox.h, aspect: geo.aspect, area: geo.area,
          perimeter: geo.perimeter, closed: geo.closed, selfIntersect: geo.selfIntersect,
          nodes: geo.nodes, centroid: geo.centroid,
        } : null,
      } : null,
      plate: state.plates.map((p) => ({
        id: p.def.id, load: p.load, threshold: p.def.threshold, holdMs: p.holdMs, on: p.on,
      })),
      actorPos: state.actor ? { x: state.actor.body.position.x, y: state.actor.body.position.y } : null,
      propPos: state.props[0] ? { x: state.props[0].position.x, y: state.props[0].position.y } : null,
      hints: level.hints,
      guides: level.guides || [],
      degradeLog: state.degradeLog.slice(-5),
    };
  }

  function destroy() {
    for (const c of state.creatures.slice()) despawnCreature(c);
    world.clear();
  }

  return {
    state,
    level,
    spawnCreature,
    setAbility,
    step,
    snapshot,
    destroy,
    get status() { return state.status; },
    get creatures() { return state.creatures; },
  };
}
