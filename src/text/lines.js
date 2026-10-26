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
  // levels.md 附录 A「落地形状分岔台词」6 条**闭集**，表外不许自拟；同句整局最多 2 次，超额静默
  form_beam: { who: '农夫', text: '这东西能踩吗？' },
  form_wheel: { who: '农夫', text: '圆的。它会自己跑。' },
  form_blob: { who: '农夫', text: '你是不是想让我踩这个？' },
  form_pile: { who: '农夫', text: '你画了三个。我只有一双脚。' },
  form_container: { who: '农夫', text: '这玩意儿能装东西？' },
  form_grain: { who: '农夫', text: '这么小？吹口气就没了。' },
  // 9.2 表：连续失败 2 次（通用）
  common_fail2: { who: '农夫', text: '不急。我等你。真的。' },
  // 9.2 表：章节盖章（第 1 章）
  stamp1: { who: '章印', text: '第一章：东西肯听话了。' },
};

/**
 * 同一句台词的**整局配额**（附录 A：同句最多 2 次，超额静默）。
 * 静默不致命——视觉提示会接手；**绝不许用同义句填空**（换句会被读成"判定变了"）。
 * 抽成纯函数是为了能被单测直接数到：连接成功 ≠ 会被执行，配额也一样，必须能断言。
 */
export function createLineQuota(max = 2) {
  const said = new Map();
  return function allow(id) {
    const n = said.get(id) || 0;
    if (n >= max) return false;
    said.set(id, n + 1);
    return true;
  };
}

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
