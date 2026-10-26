/**
 * src/text/lines.js —— 台词表
 * **文本唯一来源是 `docs/levels.md` 第九节 9.2 表**，一律逐字照抄，不许自拟（音频侧按同一份文本对齐）。
 * 画面只查 id；音频侧按 id 出声；无中文语音时同一份文本走气泡。
 *
 * 绑定规则（D8-A1 / levels.md §338）：
 *   · 开场句 → 进关那一刻
 *   · 首次成功句 → **成功事件那一刻**，不是定时器连播
 *   · 关1 成功句必须在盖章音效**之前**念完；剩余时长 < 朗读时长 + 0.3s 则整句丢弃、只留盖章
 */

export const LINES = {
  // 9.2 表：关卡开场 9 条中的第 1 章 3 条
  l1_intro: { who: '农夫', text: '你是谁？' },
  l2_intro: { who: '农夫', text: '它不肯走。它是方的。' },
  l3_intro: { who: '水泵', text: '你踩不动我。别试了。' },
  // 9.2 表：首次成功 9 条中的第 1 章 3 条
  l1_win: { who: '农夫', text: '能踩。它没抱怨。' },
  l2_win: { who: '农夫', text: '它动了！它自己动的。' },
  l3_win: { who: '水泵', text: '出水了。三十年没这么顺。' },
  // 9.2 表：连续失败 2 次（通用）
  common_fail2: { who: '农夫', text: '不急。我等你。真的。' },
  // 9.2 表：章节盖章（第 1 章）
  stamp1: { who: '章印', text: '第一章：东西肯听话了。' },
};

/** 台词文本；未知 id 返回 null（调用方决定不显示） */
export function lineText(id) {
  const l = LINES[id];
  return l ? l.text : null;
}

export function lineWho(id) {
  const l = LINES[id];
  return l ? l.who : '';
}

/** 粗估语音时长（ms）。中文约 5.5 字/秒 → 每字 180ms + 起播 250ms */
export function estimateSpeechMs(text) {
  if (!text) return 0;
  return 250 + text.length * 180;
}

/**
 * 关1 的硬约束判据：这句台词能不能在盖章之前完整念完。
 * levels.md §338：剩余时长 < 朗读时长 + 0.3s → 整句丢弃，只留盖章；
 * 不允许把第 2 句挪到盖章之后。
 */
export function canFitBeforeStamp(text, remainingMs) {
  return estimateSpeechMs(text) + 300 <= Math.max(0, remainingMs);
}
