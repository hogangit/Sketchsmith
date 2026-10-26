/**
 * src/physics/budget.js —— 刚体配额与采样点配额（tech-baseline 第 4 节契约 P4 / P5）
 * 这两个名字（BodyBudget / StrokeBudget / trySpawn / setMax / push）必须逐字存在，QA 会 grep。
 * 采样点上限只在 thresholds.js 里定义一次（阈值单一出处），这里只引用。
 */
import { STROKE_MAX_POINTS } from '../stroke/thresholds.js';

export const BODY_BUDGET_MAX = 24;     // 顶层动态刚体上限

export const BodyBudget = {
  max: BODY_BUDGET_MAX,
  current: 0,
  rejected: 0,
  /** 准入：满了返回 false，由调用方降级（放静态轮廓 + 台词），不许阻塞玩家 */
  trySpawn() {
    if (this.current >= this.max) { this.rejected++; return false; }
    this.current++;
    return true;
  },
  release() { if (this.current > 0) this.current--; },
  setMax(n) { this.max = Math.max(1, n | 0); },
  count() { return this.current; },
  reset() { this.current = 0; this.rejected = 0; },
};

export const StrokeBudget = {
  used: 0,
  /** @returns {boolean} false = 已达上限，调用方应改为 2 点取 1 抽稀 */
  push() {
    if (this.used >= STROKE_MAX_POINTS) return false;
    this.used++;
    return true;
  },
  count() { return this.used; },
  reset() { this.used = 0; },
};
