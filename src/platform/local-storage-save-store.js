/**
 * src/platform/local-storage-save-store.js —— SaveStore 的**唯一实现**（平台边界 / 排污口）。
 *
 * 这是全仓库唯一允许触碰 localStorage 的文件（core 零 DOM 铁律的唯一合法例外）。
 * 物理键名集中在这里（前缀 + 逻辑键），序列化也集中在这里。
 * file:// 下部分环境会把 localStorage 访问直接抛异常，所以构造时就探测一次，
 * 不可用则整体退化为内存桩 —— 绝不阻塞启动。
 */
import { createMemorySaveStore } from '../core/storage.js';

const PHYS_PREFIX = 'wcwz:';

function probeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const k = PHYS_PREFIX + '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch (e) {
    return null;
  }
}

export function createLocalStorageSaveStore() {
  const ls = probeLocalStorage();
  if (!ls) {
    const mem = createMemorySaveStore();
    mem.persistent = false;
    return mem;
  }
  const phys = (key) => PHYS_PREFIX + key;
  return {
    persistent: true,
    read(key) {
      try {
        const raw = ls.getItem(phys(key));
        if (raw == null) return null;
        return JSON.parse(raw);
      } catch (e) {
        return null;              // 契约：解析失败返回 null，不抛
      }
    },
    write(key, value) {
      // 契约：写失败抛错（配额满 / 隐私模式），由上层决定重试或降级
      ls.setItem(phys(key), JSON.stringify(value));
    },
    list() {
      const out = [];
      try {
        for (let i = 0; i < ls.length; i++) {
          const k = ls.key(i);
          if (k && k.indexOf(PHYS_PREFIX) === 0) out.push(k.slice(PHYS_PREFIX.length));
        }
      } catch (e) { /* 忽略 */ }
      return out;
    },
    migrate(from, to) {
      if (from === to) return;
      const exists = ls.getItem(phys(to)) != null;
      if (exists) return;                       // 目标已有数据 → 不覆盖
      const raw = ls.getItem(phys(from));
      if (raw == null) return;
      ls.setItem(phys(to), raw);                // 先写成功
      ls.removeItem(phys(from));                // 再动旧键
    },
  };
}
