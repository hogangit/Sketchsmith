/**
 * src/abilities/compose.js —— 组合裁定器
 * 规则 R1–R7 全部确定性，玩家点选顺序不影响结果（否则复现不了）。
 *
 * R1 层优先：material → motion → sense → meta（后写覆盖同名键：会滚的摩擦压过变硬的摩擦）
 * R2 同层冲突：priority 小者胜；被盖掉时记一条 note，拿去生成“变硬盖过了滑”这类台词
 * R3 数值可交换：densityMul 乘算（0.2 × 3 = 3 × 0.2），其余键覆盖
 * R4 同 order 决胜：按 id 字典序
 * R5 单造物上限 2（超出由调用方拒绝，这里只提供常量）
 * R6 组合查表
 * R7 钩子不得改几何
 */
import { MAX_ABILITIES_PER_CREATURE } from '../stroke/thresholds.js';
import { ABILITIES } from './registry.js';
import { lookupCombos } from './combos.js';

export const ABILITY_LAYER_ORDER = ['material', 'motion', 'sense', 'meta'];

/** 乘算键：同键多处出现时相乘而不是覆盖（R3 可交换） */
const MUL_KEYS = ['densityMul', 'frictionAirMul'];
const isMul = (key) => MUL_KEYS.indexOf(key) >= 0;

export function composeAbilities(ids) {
  const picked = [];
  const unknown = [];
  for (const id of ids || []) {
    const ab = ABILITIES[id];
    if (ab) picked.push(ab); else unknown.push(id);
  }

  const sorted = picked.slice().sort((a, b) => {
    const la = ABILITY_LAYER_ORDER.indexOf(a.layer);
    const lb = ABILITY_LAYER_ORDER.indexOf(b.layer);
    if (la !== lb) return la - lb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;   // R4
  });

  const mods = {};
  const flags = {};
  const hooks = [];
  const notes = [];
  const owner = {};   // key -> abilityId，用于 R2 冲突台词

  for (const ab of sorted) {
    for (const key of Object.keys(ab.mods || {})) {
      const val = ab.mods[key];
      if (isMul(key)) {
        mods[key] = (mods[key] == null ? 1 : mods[key]) * val;  // R3
      } else {
        if (owner[key] && owner[key] !== ab.id) {
          notes.push({ type: 'override', key, from: owner[key], to: ab.id });
        }
        mods[key] = val;
      }
      owner[key] = ab.id;
    }
    Object.assign(flags, ab.flags || {});
    for (const ev of Object.keys(ab.hooks || {})) {
      const h = ab.hooks[ev];
      hooks.push({ event: ev, order: h.order == null ? 100 : h.order, id: ab.id, fn: h.fn });
    }
  }

  hooks.sort((a, b) => (a.order - b.order) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));  // R4

  const combos = lookupCombos(picked.map((a) => a.id));
  for (const c of combos) {
    for (const key of Object.keys(c.bonus || {})) {
      if (isMul(key)) mods[key] = (mods[key] == null ? 1 : mods[key]) * c.bonus[key];
      else mods[key] = c.bonus[key];
    }
  }

  if (mods.densityMul == null) mods.densityMul = 1;
  if (mods.frictionAirMul == null) mods.frictionAirMul = 1;

  return {
    ids: picked.map((a) => a.id),
    layers: sorted.map((a) => a.layer),
    mods,
    flags,
    hooks,
    combos,
    notes,
    unknown,
    violated: picked.length > MAX_ABILITIES_PER_CREATURE,
  };
}
