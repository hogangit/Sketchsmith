/**
 * src/physics/materials.js —— 物理常数与材质基线的唯一出处（红线 L6）
 * 任何物理数值（密度/摩擦/弹性/步长/速度上限/角色行为）只许写在这里；
 * abilities/registry.js 只许引用，不许自己写字面量。
 * 全部 [待实测标定]。
 */
export const MATTER_GRAVITY = { x: 0, y: 1, scale: 0.001 };

export const FIXED_STEP_MS = 16.666;   // 物理固定步长 1/60s
export const MAX_SUB_STEPS = 3;        // 单帧最大子步
export const MAX_ACCUM_MS = 50;        // 累积上限，超出丢弃（不追帧）

export const BODY_MAX_SPEED = 24;      // px/step，NaNGuard 里做速度 clamp
export const BEAM_MIN_THICKNESS = 8;
export const BEAM_LENGTH_PAD = 6;
export const SOFT_BEAM_STIFFNESS = 0.18;   // 未变硬时中缝铰接刚度（会折下去）      // 梁两端各外扩，保证能搭在沟沿上
export const WHEEL_MIN_RADIUS = 6;
export const GRAIN_MAX_RADIUS = 9;

export const DENSITY_CREATURE = 0.0025; // 质量 = 面积 × 密度 → 「画多大就有多重」
export const DENSITY_PUMPKIN = 0.0035;

/** 造物“软”基线：不加变硬时它在沟沿上会弹走/滑走（关1 的教学性失败） */
export const CREATURE_SOFT = { friction: 0.05, frictionStatic: 0.08, restitution: 0.32, frictionAir: 0.02 };
/** 变硬后：抓得住、不弹 */
export const CREATURE_HARD = { friction: 0.9, frictionStatic: 1.1, restitution: 0.02, frictionAir: 0.008 };
/**
 * 会滚 = **不改摩擦，只压空气阻尼**（D16）。
 * 依据（实测 tests/probe2.mjs + matter 0.20.0 求解顺序）：
 *   · friction / frictionStatic 一旦非 0，切向速度就被乘着清掉（0.05 与 0.9 停止距离都 ≈8px），
 *     所以「friction=0」换来的不是"会滚"，是"既不打滑也不滚、被任何 5px 台阶卡死"——
 *     名字和实现相反。凡改 friction 的方案一律否决。
 *   · frictionAir 每个子步同时衰减 velocity 与 angularVelocity（v *= 1-f，ω *= 1-f），
 *     所以压低它 = 抓地还在 + 滚得更远，不需要额外扭矩。
 * 乘算键：与其它能力叠乘（见 compose.js 的 MUL_KEYS）。
 * [待实测标定] 0.25 是"滚得明显更远但还会停"的起点，等关 2 圆滚路径实测后再定。
 */
export const CREATURE_ROLL = { frictionAirMul: 0.25 };

/** 质量倍数（变重 / 变轻） */
export const DENSITY_MUL_HEAVY = 3;
export const DENSITY_MUL_LIGHT = 0.2;

export const MATERIALS = {
  ground: { friction: 0.9, frictionStatic: 1.0, restitution: 0.02 },
  slope:  { friction: 0.9, frictionStatic: 1.0, restitution: 0.02 },
  metal:  { friction: 0.4, frictionStatic: 0.5, restitution: 0.1 },
  /**
   * 南瓜：friction 必须为 0，否则它在任何地面都被“粘”住。
   * 依据（实测 tests/probe2.mjs）：matter 的 pair.friction = min(a,b)、pair.frictionStatic = max(a,b)，
   * 求解时相乘，所以只要接触对里有一方 friction>0，切向速度就被清零（0.05 与 0.9 停止距离都是 ≈8px）。
   * friction=0 时它才真的滑得起来 —— 这也是「圆的/滚的东西」在本引擎里的等价写法。
   * frictionAir 是它唯一的减速来源（决定能滑多远），[待实测标定]。
   */
  /**
   * [债-1] `friction: 0` 已判"该删"（团队已裁定，不是标定问题），但**删除与关 2 重建必须同一包**：
   * 差包里把 0 改成 0.5 后实测关 2 立刻不可通（南瓜不再自己滑出高台，`smoke-browser` 卡在
   * `ch1-02 / playing / failStreak 3`）。所以这里**暂时保留 0**，等关 2 按设计新案
   * （圆滚 + 团块逐级跌 + 长条对照组，无"沿坡滑"解法）重建时一并改成 0.5。
   * 理由写在代码里，是因为"为什么还留着这个 0"比"这个 0 是多少"更容易被忘掉。
   */
  pumpkin: { friction: 0, frictionStatic: 0, restitution: 0, frictionAir: 0.002 },
  ice:    { friction: 0.08, frictionStatic: 0.05, restitution: 0.0 },
};


/** 走路小人（农夫 / 对岸小人）：速度式驱动，不是真的“推” */
export const ACTOR = {
  radius: 14,
  mass: 1.8,
  friction: 0.02,
  frictionAir: 0.0,
  speed: 1.9,             // px/step
  accelStep: 0.22,        // 每子步速度最大变化量（防止推土机效应）
  jumpSpeed: 6.0,         // px/step → 跳高约 65px
  jumpCooldownMs: 420,
  stuckFrames: 9,         // 连撞 9 帧判定“卡住”→ 跳
  arriveTolerance: 5,
};

/** 压板：持续重量阈值与判定 */
export const PLATE = {
  sustainMs: 1000,       // 持续压住多久算数
  releaseMs: 250,        // 撤重多久算抬起
  minBodySpeed: 2.2,     // 只统计“压在板上”的物体（速度低于此值）
};

/**
 * 碰撞音闸门（物理侧聚合后每帧最多回调 1 次）。[待实测标定]
 * 单位是 score = |法向相对速度| × 约化质量，不是冲量（matter 不暴露冲量）。
 * 定阈值前必须先做 pair 去抖（同 pair 200ms 内重复 start 丢弃），否则分布被污染。
 */
export const IMPACT_MIN_SCORE = 0.6;
export const IMPACT_PAIR_COOLDOWN_MS = 90;

