/**
 * src/abilities/combos.js —— 组合查表（R6）
 * 键 = [a,b].sort().join('+')，O(1)。命中时叠加 comboBonus 并解锁专属台词。
 *
 * 注：levels.md 第四节列的四条「看着没用，配对逆天」组合都依赖怕痒/会说话/透明/黏，
 * 这些能力本轮未实装，所以那四条现在不可达（已如实记入 README 未做项）。
 * 这里只保留一条对当前 4 个能力成立的组合：变硬 + 会滚 = 硬滚石。
 */
export const COMBO_TABLE = {
  'harden+roll': {
    id: 'harden+roll',
    name: '硬滚石',
    line: 'combo_hard_roll',
    bonus: { densityMul: 1.0 },
    note: '不变形的轮子：滚得稳，还抓得住砸下来的东西',
  },
  'harden+tickle': {
    id: 'harden+tickle',
    name: '弹射板',
    line: 'combo_harden_tickle',
    bonus: { densityMul: 1.0 },
    note: '不变形的弹射板：怕痒只在变硬后才立得住，软板会被自己弹塌',
  },
};

export function comboKey(ids) {
  return ids.slice().sort().join('+');
}

export function lookupCombos(ids) {
  if (!Array.isArray(ids) || ids.length < 2) return [];
  const hits = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = comboKey([ids[i], ids[j]]);
      const hit = COMBO_TABLE[key];
      if (hit) hits.push(hit);
    }
  }
  return hits;
}
