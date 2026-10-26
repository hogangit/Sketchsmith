/**
 * src/level/levels/ch1-03.js —— 关3 踩不动的水泵（难度 2，压板原型）
 * 唯一变量是「重量阈值」：农夫 1.8 压不动，团块 9.6 也压不动，变重后 28.8 才压得动。
 */
export const LEVEL_CH1_03 = {
  id: 'ch1-03',
  chapter: 1,
  title: '踩不动的水泵',
  subtitle: '你踩不动我。别试了。',
  chips: ['harden', 'roll', 'heavy'],
  spawnY: 84,
  terrain: [
    { x: 215, y: 490, w: 430, h: 120, mat: 'ground' },     // 地面 顶面 y=430
    { x: 295, y: 424, w: 8, h: 14, mat: 'metal' },          // 踏板左挡边
    { x: 385, y: 424, w: 8, h: 14, mat: 'metal' },          // 踏板右挡边
  ],
  actors: [{ kind: 'walker', x: 55, y: 416, targetX: 340, label: '农夫' }],
  props: [],
  plates: [{
    id: 'pump',
    x: 299, y: 404, w: 82, h: 26,      // 判定区（矩形，用于 Query.region）
    threshold: 20,                      // 需要的持续重量 [待实测标定]
    label: '水泵踏板',
  }],
  goal: { type: 'plateSustained', plateId: 'pump' },
  resetActorIfBelowY: 9999,
  guides: [],
  hints: {
    highlight: [{ x: 340, y: 424, r: 34 }],
    beamOutline: null,
  },
  scenery: [
    { kind: 'line', x1: 0, y1: 430, x2: 430, y2: 430, width: 2 },
    { kind: 'rect', x: 340, y: 372, w: 56, h: 58 },          // 泵体
    { kind: 'circle', x: 340, y: 344, r: 13 },               // 泵头
    { kind: 'line', x1: 368, y1: 400, x2: 412, y2: 412, width: 3 }, // 出水管
    { kind: 'text', x: 340, y: 396, text: '30年', size: 10, align: 'center' },
    { kind: 'line', x1: 20, y1: 442, x2: 60, y2: 452, width: 1 },   // 干裂的地
    { kind: 'line', x1: 90, y1: 448, x2: 130, y2: 438, width: 1 },
    { kind: 'line', x1: 150, y1: 444, x2: 190, y2: 456, width: 1 },
    { kind: 'text', x: 105, y: 468, text: '田裂了', size: 10, align: 'center' },
  ],
  lines: { intro: 'l3_intro', win: 'l3_win', failStreak: 'common_fail2', stamp: 'ch1_stamp' },
  failHints: ['光靠你和一块小石头，压不动。', '「变重」——质量 ×3。', '把变重的东西丢到踏板上，然后走开。'],
};
