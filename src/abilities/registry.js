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
  CREATURE_HARD, CREATURE_ROLL, DENSITY_MUL_HEAVY, DENSITY_MUL_LIGHT,
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
};

export const IMPLEMENTED_ABILITY_IDS = ['harden', 'roll', 'heavy', 'light'];

/** 池子里另外 20 个：只有名字，尚未实现（不许算进「已实装」） */
export const PLANNED_ABILITY_NAMES = [
  '怕痒', '会说话', '透明', '滑', '黏', '发光', '可燃', '时间慢', '无限长', '复制',
  '磁', '反重力', '会跳', '防水', '导电', '吸水', '倒转', '一刀切', '饿', '记仇',
];

export function getAbility(id) {
  return ABILITIES[id] || null;
}
