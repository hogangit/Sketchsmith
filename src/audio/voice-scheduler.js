/**
 * src/audio/voice-scheduler.js —— 语音排队与配额（`audio-spec-v2` 附录 **C.1 / C.1b / C.2**）
 *
 * 这个文件是**纯逻辑**：不碰 `speechSynthesis`、不碰 `AudioContext`、不读时钟（时钟注入）。
 * 只有这样，C.1 那张"五步优先序"才能被单测逐条数出来——否则它只能靠读代码相信。
 *
 * ── C.1 五步（顺序写死，不许实现方自行调换）────────────────────────────────
 *   ① C5 说话人不在画面内 → **挂起**（不扣、不丢），等 `onScreen` 变 true
 *   ② 配额预检（**只读**）→ 不够就**不出队**，连 C4 的延后都别做
 *   ③ C4 同音色 45s 间隔 → 未到就延后（不扣）
 *   ④ 超时整句丢弃 → 丢弃（不扣）
 *   ⑤ `utterance.onstart` → **扣 1 次；这是全程唯一允许扣费的地方**
 *
 * 为什么不能只在 ⑤ 检查额度：会出现"C4 已延后 30 秒 → 到点发现额度没了 → 丢弃"，
 * 玩家白等 30 秒，这次延后完全是白做的。所以 ② 只读预检必须在入队前。
 *
 * ── C.1b 「抢占」与「终止」是两个动作 ─────────────────────────────────────
 *   · `dropPending()`   只从**队列**里摘掉：**不扣费**，是优先手段；
 *   · `abortSpeaking()` 对**已起播**的句子 cancel：**已扣不退**，只在语义过期时用。
 *   合成一个 `cancel()` 会撞上场景边界（切关时上一关还在念 = 音画脱钩，会被当 bug 报）。
 *
 * ── C.2 两套额度不要混 ──────────────────────────────────────────────────────
 *   本文件的 `budget` 是**语音额度**（整局 ≤30 条 / ≤75 s）；
 *   主程序的 `sayCapped` 是**文字出现次数**。
 *   两者共用 → 文字把语音额度吃光 → 症状是"字幕全出来了，却一句都没念"，
 *   而排查看起来像语音坏了（会先去查 getVoices），方向全错。
 */

export const VOICE_SPEAKER_INTERVAL_MS = 45000;   // C4 同音色强制间隔 [待实机标定]
export const VOICE_PENDING_TTL_MS = 45000;         // 挂起/延后的兜底上限（过窗判据优先用事件）[待实机标定]
export const VOICE_BUDGET_LINES = 30;              // 整局语音条数上限 [待实机标定]
export const VOICE_BUDGET_MS = 75000;              // 整局语音时长上限 [待实机标定]

/**
 * C.1b 级别：由**时机**决定，不由文案内容决定（否则会冒出"这句写得重要所以不给抢"）
 * 数字越小优先级越高；≥INTRO 的可被抢占，SUCCESS/SCOPED 不可抢占。
 */
export const LINE_LEVEL = {
  SUCCESS: 1,        // 首次成功 / 章节盖章 / 终局
  SCOPED: 2,         // 受逐句稀缺额度约束的句子（common_fail2、各关失败暗示）
  INTRO: 3,          // 关卡开场
  AMBIENT: 4,        // 隐藏解法 / 环境吐槽
};
const canPreempt = (lv) => lv >= LINE_LEVEL.INTRO;

/**
 * @param {object} o
 * @param {{speak:(u:object)=>void, cancel:()=>void}} o.backend  语音后端（audio-bus 注入）
 * @param {()=>number} o.now                                    时钟（ms）
 * @param {(speaker:string)=>boolean} [o.isOnScreen]             C5 前置条件，由主程序提供
 * @param {(lineId:string)=>boolean} [o.precheckQuota]           **只读**文字额度预检（C.1 第 2 步）
 * @param {(lineId:string)=>void} [o.onSpoken]                   真正起播后的回调（诊断/打点）
 * @param {(lineId:string, reason:string)=>void} [o.onAbort]      终止回调（诊断/打点）
 */
export function createVoiceScheduler(o) {
  const backend = o.backend;
  const now = o.now || (() => Date.now());
  const isOnScreen = o.isOnScreen || (() => true);
  const precheckQuota = o.precheckQuota || (() => true);

  let playing = null;              // { lineId, speaker, level, startedAt }
  let pending = null;              // { lineId, speaker, level, textMs, enqueuedAt, notBefore, suspended }
  const lastStartAt = new Map();   // speaker → 上次真正起播的时间（C4 用）
  const budget = { lines: 0, ms: 0 };

  function start(entry) {
    playing = { lineId: entry.lineId, speaker: entry.speaker, level: entry.level, startedAt: now() };
    const mine = playing;
    backend.speak({
      lineId: entry.lineId,
      text: entry.text,
      speaker: entry.speaker,
      // ⑤ 全程唯一允许扣费的地方
      onStart: () => {
        budget.lines += 1;
        budget.ms += Math.max(0, entry.textMs || 0);
        lastStartAt.set(entry.speaker, now());
        if (o.onSpoken) o.onSpoken(entry.lineId);
      },
      onEnd: () => { if (playing === mine) playing = null; },
      onError: () => { if (playing === mine) playing = null; },
    });
  }

  /**
   * 推进一步：① C5 → ② 只读预检 → ③ C4 → ④ 超时 → ⑤ 起播
   * 内部口径：'started' | 'queued' | 'deferred' | 'blocked' | 'dropped'。
   * `request()` 会把 'started' 归一成 'queued'——对外只暴露 C.1c 的四态，
   * 因为「已调用 backend.speak」不等于「已出声」（onstart 是异步的）。
   */
  function pump() {
    if (playing || !pending) return 'queued';       // 有句在播 → 排队等着
    const t = now();
    // ① C5：不在画面内 → 挂起（不扣、不丢）；过窗才作废，作废也不扣
    if (!isOnScreen(pending.speaker)) {
      pending.suspended = true;
      if (t - pending.enqueuedAt > VOICE_PENDING_TTL_MS) { pending = null; return 'dropped'; }
      return 'blocked';
    }
    pending.suspended = false;
    // ② 配额只读预检：不够就直接不出队（连 C4 的延后都别做）
    if (!precheckQuota(pending.lineId)) { pending = null; return 'dropped'; }
    // ③ C4 同音色间隔：延后，不扣
    const last = lastStartAt.get(pending.speaker);
    const notBefore = Math.max(pending.notBefore || 0,
      last == null ? 0 : last + VOICE_SPEAKER_INTERVAL_MS);
    if (t < notBefore) { pending.notBefore = notBefore; return 'deferred'; }
    // ④ 超时整句丢弃：不扣。
    // 计时从"**它本来可以起播**"那一刻算起，不是从入队算起 —— 否则 TTL 与 C4 同为 45s 时，
    // 被 C4 延后的句子会在刚够格的同一刻被判超时，C4 永远不可能成功。
    const eligibleAt = Math.max(pending.enqueuedAt, pending.notBefore || 0);
    if (t - eligibleAt > VOICE_PENDING_TTL_MS) { pending = null; return 'dropped'; }
    // ⑤ 起播（扣费仍只在 backend 的 onStart 里发生）
    const entry = pending;
    pending = null;
    start(entry);
    return 'started';
  }

  /** 对内 'started' 只表示「已交给 backend」，对外一律报 'queued'（C.1c 没有「已播」态） */
  function norm(r) { return r === 'started' ? 'queued' : r; }

  const api = {
    /**
     * 请求播一句。返回（C.1c 口径）'queued' | 'deferred' | 'blocked' | 'dropped'。
     * **永远不会返回 'played'**——真正起播另走 `onSpoken` 回调；**这里也不扣费**。
     */
    request({ lineId, text, speaker, level, textMs }) {
      const lv = level || LINE_LEVEL.AMBIENT;
      const make = () => ({ lineId, text, speaker, level: lv, textMs, enqueuedAt: now(), notBefore: 0, suspended: false });
      if (!pending) { pending = make(); return norm(pump()); }
      // 队满：抢占**尚未起播的最低级别**（不扣费）
      if (!canPreempt(lv)) return 'dropped';             // 不可抢占的句子不许挤掉别人
      if (!canPreempt(pending.level)) return 'dropped';  // 正在等的不可抢占 → 只能拒新的
      // 同级别不换（先到先等，避免同级来回颠簸）；只有"新的更重要"才抢占等待位
      if (pending.level > lv) { pending = make(); return norm(pump()); }
      return 'dropped';                                  // 新的不比在等的更重要 → 拒
    },

    /** C.1b 抢占：只摘队列里尚未起播的，**不扣费** */
    dropPending(lineId) {
      if (pending && (!lineId || pending.lineId === lineId)) { pending = null; return true; }
      return false;
    },

    /** C.1b 终止：已起播的句子停掉，**已扣不退**。只用于语义过期（切关 / 说话人离场 / 事件已过去） */
    abortSpeaking(reason) {
      if (!playing) return false;
      const was = playing;
      playing = null;
      backend.cancel();                    // 全仓库唯一允许 cancel 的地方
      if (o.onAbort) o.onAbort(was.lineId, reason);
      return true;
    },

    /** 场景边界：切关 / 说话人离场 / 事件已过去 → 先抢占再终止（额度不退） */
    onSceneBoundary(reason) {
      api.dropPending();
      return api.abortSpeaking(reason);
    },

    /** 由主循环或事件驱动：推进挂起与延后 */
    tick() { pump(); },

    /** 只读快照（给 HUD / 单测看，不许在这里改状态） */
    get state() {
      return {
        playing: playing ? { ...playing } : null,
        pending: pending ? { ...pending } : null,
        budget: {
          lines: budget.lines, ms: budget.ms,
          linesLeft: Math.max(0, VOICE_BUDGET_LINES - budget.lines),
          msLeft: Math.max(0, VOICE_BUDGET_MS - budget.ms),
        },
      };
    },
  };
  return api;
}
