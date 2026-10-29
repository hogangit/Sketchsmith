/**
 * src/level/sandbox.js —— 沙盒「造物园」（通关 5 关后解锁，D1：沙盒作为全通奖励）
 *
 * 承接「主角可以造出天地万物」的核心承诺：**无过关判定、无失败、无计时**。
 *
 * ── 为什么 `goal: null` 是关键（验收判据 3：无 goal 不误判）────────────────
 *   沙盒场景**不带 goal**。runtime 的 `checkGoal` 在 `goal == null` 时必须直接返回，
 *   于是永不 `win`、永不 `fail` —— 玩家想画多久画多久，系统不许替他宣布"过了"。
 *   这一条本身要有测试（规格 3.6 `sandbox-nogoal`），不许只在文档里写"没有目标"。
 *
 * ── 与关卡的区别 ────────────────────────────────────────────────────────
 *   · chips = **全部已实装能力**（不是每关轮换的 4~5 枚），每造物仍 ≤2（全局上限不变）
 *   · 造物**持久化**到 `wcwz:sandbox:v1`（沿用 SaveStore 抽象，与关卡通关进度同一套）
 *   · 上限 30 个，超了提示「先删掉旧的」，**不静默丢弃**（同 D25/D26：不抹掉玩家成果）
 */
import { IMPLEMENTED_ABILITY_IDS } from '../abilities/registry.js';

/** 存档 key（规格 3.4） */
export const SANDBOX_KEY = 'wcwz:sandbox:v1';
/** 造物上限（规格 3.4）：超出提示，不静默丢 */
export const SANDBOX_MAX_CREATURES = 30;

export const SANDBOX_LEVEL = {
  id: 'sandbox',
  chapter: 1,
  title: '造物园',
  subtitle: '想造什么，就造什么。',
  // 全部已实装能力都可用（造物仍受「每造物 ≤2 枚」全局上限约束）
  chips: [...IMPLEMENTED_ABILITY_IDS],
  spawnY: 84,
  // 沙盒要同时摆出玩家存过的所有造物（"画什么都会留下"），不能用关卡的「同时最多 2 个」上限。
  // 这里给到存档上限 30，让存满时全部可见；再多的靠物理预算兜底（buildWorld 里调高 BodyBudget）。
  maxLiveCreatures: SANDBOX_MAX_CREATURES,
  terrain: [
    { x: 215, y: 471, w: 430, h: 82, mat: 'ground' },   // 一整块地台：x 0..430，顶面 430
  ],
  actors: [],
  props: [],
  plates: [],
  goal: null,               // ★ 沙盒没有目标：永不 win / 永不 fail
  resetActorIfBelowY: null,
  guides: [],
  hints: { highlight: [], beamOutline: null },
  scenery: [
    { kind: 'hills' },
    { kind: 'line', x1: 0, y1: 430, x2: 430, y2: 430, width: 2.5 },
    { kind: 'crops', x1: 24, x2: 60, y: 430, n: 3, h: 9 },
    { kind: 'crops', x1: 360, x2: 404, y: 430, n: 3, h: 10 },
    { kind: 'text', x: 215, y: 268, text: '造物园', size: 12, align: 'center' },
    { kind: 'text', x: 215, y: 292, text: '画什么都会留下', size: 10, align: 'center', tone: 'light' },
  ],
  lines: {
    intro: 'sb_intro',
    win: null,        // 沙盒没有"赢"，这个槽位必须是空（闭集断言会放过 null）
    failStreak: null,
    stamp: null,
  },
  failHints: [],
};

/**
 * 读沙盒存档（没有就给一个空壳，不阻塞启动）。
 * @param {{read:(k:string)=>any, write:(k:string,v:any)=>void}} store SaveStore 抽象
 */
export function loadSandbox(store) {
  const v = store && store.read ? store.read(SANDBOX_KEY) : null;
  if (!v || typeof v !== 'object') return { unlocked: false, creatures: [] };
  return {
    unlocked: !!v.unlocked,
    creatures: Array.isArray(v.creatures) ? v.creatures : [],
  };
}

/**
 * 存一个造物。返回 `{ ok, reason }`：
 *  - `ok:false, reason:'full'` 表示已达上限（调用方应提示「先删掉旧的」，**不静默丢**）。
 * @returns {{ok:boolean, reason?:string, count:number}}
 */
export function saveCreature(store, creature) {
  const cur = loadSandbox(store);
  if (cur.creatures.length >= SANDBOX_MAX_CREATURES) {
    return { ok: false, reason: 'full', count: cur.creatures.length };
  }
  const rec = {
    id: creature.id || `c${Date.now()}`,
    form: creature.form || null,
    thickness: creature.thickness == null ? null : creature.thickness,
    abilities: Array.isArray(creature.abilities) ? creature.abilities.slice(0, 2) : [],
    name: creature.name || '',
    x: creature.x, y: creature.y,
    createdAt: Date.now(),
    // ★ 存原始笔画，不只存 form：只存 form 是**复原不出形状**的（同一个 beam
    //   可以是长是短是弯的）。规格 3.3「退场不丢」要的是"回来时东西还在原样"，
    //   所以必须存笔画，进场时用 analyzeStrokeGroup 重跑一遍几何。
    strokes: Array.isArray(creature.strokes) ? creature.strokes : [],
  };
  const next = { unlocked: true, creatures: cur.creatures.concat([rec]) };
  if (store && store.write) store.write(SANDBOX_KEY, next);
  return { ok: true, count: next.creatures.length };
}

/**
 * 按 id 删一个造物。返回 `{ ok, reason }`。
 * 为什么需要它：上限 30 满了以后，玩家只能"先删掉旧的"——不给他删的口子，
 * 那条"不静默丢"的提示就是死路一条（告诉他有问题却不给办法）。
 */
export function removeCreature(store, id) {
  const cur = loadSandbox(store);
  const next = cur.creatures.filter((c) => c.id !== id);
  if (next.length === cur.creatures.length) return { ok: false, reason: 'notfound', count: next.length };
  if (store && store.write) store.write(SANDBOX_KEY, { unlocked: cur.unlocked, creatures: next });
  return { ok: true, count: next.length };
}

/**
 * 清空造物园（**只删造物，保留 unlocked 标记**）。
 * 为什么需要它：`removeCreature` 只删一条，而界面上没有"选一条"的入口——
 * 玩家存满 30 个以后会撞上 `reason:'full'`，却没有任何办法腾地方。
 */
export function clearSandbox(store) {
  const cur = loadSandbox(store);
  const next = { unlocked: cur.unlocked, creatures: [] };
  if (store && store.write) store.write(SANDBOX_KEY, next);
  return { ok: true, count: 0 };
}

/** 标记沙盒已解锁（通关第 5 关那一刻调用） */
export function unlockSandbox(store) {
  const cur = loadSandbox(store);
  if (cur.unlocked) return cur;
  const next = { unlocked: true, creatures: cur.creatures };
  if (store && store.write) store.write(SANDBOX_KEY, next);
  return next;
}
