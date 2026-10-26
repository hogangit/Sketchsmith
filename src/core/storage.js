/**
 * src/core/storage.js —— 存档抽象层（SaveStore）的**契约**部分，零平台 API。
 *
 * 铁律：localStorage / 平台存储的直接触碰只允许存在于 `src/platform/local-storage-save-store.js`
 * 一个文件里。core / UI 只依赖 `SaveStore` 的四个方法，不 import 任何实现类。
 * 组合根（src/main.js）负责把实现注入进来 —— 换引擎/换平台只改那一个文件。
 *
 * 接口契约：
 *   read<T>(key)  → T | null   键不存在 / 解析失败一律返回 null，**不抛异常**
 *   write<T>(key, value) → void  序列化或写盘失败**抛错**（让上层决定重试或降级）
 *   list() → string[]          全部逻辑键
 *   migrate(from, to) → void   版本迁移，不丢数据（目标已存在则不覆盖；成功后才删旧键）
 */

export const SAVE_SCHEMA_VERSION = 2;
export const SAVE_KEY_PROGRESS = 'progress';
export const SAVE_KEY_SETTINGS = 'settings';

/**
 * 内存桩：验收用（证明上层只依赖接口），也是 localStorage 不可用时的降级实现。
 * @returns {object} SaveStore
 */
export function createMemorySaveStore(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    read(key) {
      if (!map.has(key)) return null;
      try { return JSON.parse(map.get(key)); } catch (e) { return null; }
    },
    write(key, value) {
      map.set(key, JSON.stringify(value));
    },
    list() { return Array.from(map.keys()); },
    migrate(from, to) {
      if (from === to || !map.has(from) || map.has(to)) return;
      map.set(to, map.get(from));
      map.delete(from);
    },
    _map: map,
  };
}

/** 默认进度（新玩家） */
export function defaultProgress() {
  return { schema: SAVE_SCHEMA_VERSION, maxUnlocked: 1, cleared: {}, deaths: 0, seconds: 0 };
}

/**
 * v1 → v2 迁移。v1 的形状是 `{ cleared: <number> }`（通关到第几关），v2 加 schema 与 cleared 明细。
 * 迁移原则：只加字段、不丢信息；幂等（重复跑结果不变）。
 */
export function upgradeProgress(raw) {
  if (!raw || typeof raw !== 'object') return defaultProgress();
  const out = defaultProgress();
  if (typeof raw.schema === 'number' && raw.schema >= 2) {
    out.maxUnlocked = Number.isFinite(raw.maxUnlocked) ? raw.maxUnlocked : 1;
    out.cleared = raw.cleared && typeof raw.cleared === 'object' ? raw.cleared : {};
    out.deaths = Number.isFinite(raw.deaths) ? raw.deaths : 0;
    out.seconds = Number.isFinite(raw.seconds) ? raw.seconds : 0;
    return out;
  }
  // v1：cleared 是一个数字，表示已通关的关卡序号
  const legacy = Number.isFinite(raw.cleared) ? raw.cleared : 0;
  out.maxUnlocked = Math.max(1, Math.min(3, legacy + 1));
  for (let i = 1; i <= legacy; i++) out.cleared['ch1-0' + i] = true;
  out.deaths = Number.isFinite(raw.deaths) ? raw.deaths : 0;
  out.seconds = Number.isFinite(raw.seconds) ? raw.seconds : 0;
  return out;
}

/** 读进度（任何异常都降级成默认进度，绝不让存档问题挡住启动） */
export function loadProgress(store) {
  const raw = store.read(SAVE_KEY_PROGRESS);
  const upgraded = upgradeProgress(raw);
  if (raw && (!raw.schema || raw.schema < SAVE_SCHEMA_VERSION)) {
    try { store.write(SAVE_KEY_PROGRESS, upgraded); } catch (e) { /* 写不进去也不影响这一局 */ }
  }
  return upgraded;
}

export function saveProgress(store, progress) {
  try { store.write(SAVE_KEY_PROGRESS, progress); return true; } catch (e) { return false; }
}
