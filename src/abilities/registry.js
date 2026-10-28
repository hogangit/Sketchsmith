/**
 * src/abilities/registry.js —— 能力 = 纯数据记录（红线 L4：不许写 if-else 链）
 *
 * 一个能力只有三种施加方式：
 *   mods  静态物理属性改写（生成时一次性 applyMods，幂等）
 *   hooks 事件钩子（按 order 升序确定性执行）
 *   flags 行为开关（供其它系统读）
 *
 * 本轮（阶段 2）只实装 4 个：变硬 / 会滚 / 变重 / 变轻。
 * 其余 20 个只登记名字（PLANNED_ABILITY_NAMES），**没有记录、没有实现**，不许当已完成。
 */
import {
  CREATURE_HARD, CREATURE_ROLL, DENSITY_MUL_HEAVY, DENSITY_MUL_LIGHT, MATERIALS, TICKLE_K, TICKLE_ACTOR_VY, ACTOR,
} from '../physics/materials.js';

export const ABILITIES = {
  harden: {
    id: 'harden', name: '变硬', chapter: 1,
    layer: 'material', priority: 10,
    mods: {
      friction: CREATURE_HARD.friction,
      frictionStatic: CREATURE_HARD.frictionStatic,
      restitution: CREATURE_HARD.restitution,
      frictionAir: CREATURE_HARD.frictionAir,
    },
    flags: { rigid: true },
    hooks: {},
    tags: ['structural'],
    conflicts: ['roll'],
    blurb: '不变形、抓得住：架在沟上不会弹走',
  },
  roll: {
    id: 'roll', name: '会滚', chapter: 2,
    layer: 'motion', priority: 20,
    // D16：只压空气阻尼，friction / frictionStatic 一个字都不动（动了就等于把造物钉在地上）
    mods: { frictionAirMul: CREATURE_ROLL.frictionAirMul },
    flags: { rolling: true },
    hooks: {},
    tags: ['motion'],
    conflicts: [],
    blurb: '抓地不变，空气阻力降到 1/4：圆的东西滚得更远——长条和团块本来就没什么可滚的',
  },
  heavy: {
    id: 'heavy', name: '变重', chapter: 3,
    layer: 'material', priority: 12,
    mods: { densityMul: DENSITY_MUL_HEAVY },
    flags: { heavy: true },
    hooks: {},
    tags: ['mass'],
    conflicts: [],
    blurb: '质量 ×3，压得下踏板',
  },
  light: {
    id: 'light', name: '变轻', chapter: 4,
    layer: 'material', priority: 12,
    mods: { densityMul: DENSITY_MUL_LIGHT },
    flags: { light: true },
    hooks: {},
    tags: ['mass'],
    conflicts: [],
    blurb: '质量 ×0.2，一碰就飞（本轮仅实装数值，未进关卡）',
  },
  /**
   * 怕痒（tickle）：被任何刚体接触时，沿接触法线**反方向**给「接触方」施加一次冲量
   * J = TICKLE_K × 接触方质量 ⇒ Δv = TICKLE_K 恒定（D15：画粗画细弹一样高，不抽奖）。
   * 纯 D15 钩子能力，约 30 行。不弹自己、不弹静态体、200ms 同对冷却防多子步连发。
   * 与变轻叠加天然 no-op（J 不随造物质量缩放 ⇒ Δv 不变，D15）。
   * hooks.onContact.fn 由 runtime 在 collisionStart 中注入 { Matter, matterBody, otherBody, normal, nowMs } 后调用。
   */
  tickle: {
    id: 'tickle', name: '怕痒', chapter: 4,
    layer: 'sense', priority: 30,
    mods: {},
    flags: { tickle: true },
    hooks: {
      onContact: {
        order: 10,
        fn(ctx) {
          const M = ctx.Matter;
          const other = ctx.otherBody;
          if (!other || other.isStatic) return;
          // ── 小人特例：蹦床语义（D27）──
          // 平放的怕痒体挡在小人面前时，他先撞到板「侧面」（接触法线水平），沿法线弹会被
          // 往左推飞、永远登不上板顶。所以对 actor 改为「向上 + 朝目标方向」的竖直弹射，
          // 保住设计意图「把小人弹上高台」，只是实现手段从「接触法线」换成对 actor 的特例。
          // 竖直速度用 TICKLE_K（=8.5，单跳约 130px，恰好够越 130px 落差），水平用它自身的
          // 行走速度，落地后再由 stepWalker 接管走到目标点。
          if (other.plugin && other.plugin.actor) {
            const tx = other.plugin.actorTargetX != null ? other.plugin.actorTargetX : other.position.x + 1;
            const dir = Math.sign(tx - other.position.x) || 1;
            M.Body.setVelocity(other, { x: dir * ACTOR.speed * 2.0, y: -TICKLE_ACTOR_VY });
            return;
          }
          // ⚠️ TICKLE_K 是**独立导出**，不是 MATERIALS 的成员：写成 MATERIALS.TICKLE_K 会拿到
          // undefined ⇒ 冲量算成 NaN ⇒ 整局物理在第 118 帧炸掉（探针实测 nanF=118 的根因）。
          const k = TICKLE_K;
          let nx, ny;
          const n = ctx.normal;
          if (n && Number.isFinite(n.x) && Number.isFinite(n.y) && (n.x !== 0 || n.y !== 0)) {
            // 优先用**接触法线**：小人站在板顶面上时法线垂直向上 ⇒ 被垂直弹起。
            // 不能用两体连心线：板很宽、小人站在端点时连心线几乎水平，会把小人**往左推、
            // 推离高台**（探针实测 dx,dy = -35.3, -19.8，斜向左上，就是这条旧逻辑）。
            nx = n.x; ny = n.y;
            // 符号校正：法线必须指向「把 other 推离怕痒体」的那一侧（matter 法线符号不定）
            const sepX = other.position.x - ctx.matterBody.position.x;
            const sepY = other.position.y - ctx.matterBody.position.y;
            if (nx * sepX + ny * sepY < 0) { nx = -nx; ny = -ny; }
          } else {
            // 退化：拿不到法线时用两体分离方向（保底，不新增失败模式）
            nx = other.position.x - ctx.matterBody.position.x;
            ny = other.position.y - ctx.matterBody.position.y;
          }
          const len = Math.hypot(nx, ny);
          if (!(len > 0)) return;            // 完全重合：什么都不做，绝不写 NaN
          if (!Number.isFinite(k)) return;   // 常量缺失时不许污染速度（NaN 守卫）
          nx /= len; ny /= len;
          M.Body.setVelocity(other, {
            x: other.velocity.x + nx * k,
            y: other.velocity.y + ny * k,
          });
        },
      },
    },
    tags: ['active'],
    conflicts: [],
    blurb: '被碰就弹别人一下：Δv 恒定，画多大都一样（D15 配对主解）',
  },
};

export const IMPLEMENTED_ABILITY_IDS = ['harden', 'roll', 'heavy', 'light', 'tickle'];

/** 池子里另外的未实装能力：只有名字，尚未实现（不许算进「已实装」） */
export const PLANNED_ABILITY_NAMES = [
  '会说话', '透明', '滑', '黏', '发光', '可燃', '时间慢', '无限长', '复制',
  '磁', '反重力', '会跳', '防水', '导电', '吸水', '倒转', '一刀切', '饿', '记仇',
];

export function getAbility(id) {
  return ABILITIES[id] || null;
}
