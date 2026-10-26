/**
 * src/level/schema.js —— 关卡数据结构校验
 * 关卡是纯数据，错字段要在启动时就炸掉，不要等到玩家画到一半才发现。
 */
export const LEVEL_REQUIRED_FIELDS = ['id', 'chapter', 'title', 'chips', 'terrain', 'goal'];

export const GOAL_TYPES = ['reachActor', 'propReach', 'plateSustained'];

export function validateLevel(level) {
  if (!level || typeof level !== 'object') throw new Error('关卡不是对象');
  for (const f of LEVEL_REQUIRED_FIELDS) {
    if (level[f] == null) throw new Error(`关卡 ${level.id || '?'} 缺字段 ${f}`);
  }
  if (!Array.isArray(level.chips) || level.chips.length < 1) throw new Error(`${level.id}: chips 必须是非空数组`);
  if (!Array.isArray(level.terrain)) throw new Error(`${level.id}: terrain 必须是数组`);
  for (const t of level.terrain) {
    if (![t.x, t.y, t.w, t.h].every((n) => Number.isFinite(n))) throw new Error(`${level.id}: terrain 项坐标非法`);
  }
  if (!GOAL_TYPES.includes(level.goal.type)) throw new Error(`${level.id}: 未知 goal.type=${level.goal.type}`);
  if (level.chips.length > 6) throw new Error(`${level.id}: 芯片数不得超过 6（R2 封顶）`);
  return level;
}
