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
    // 纯标记、不绘制：本关有水塘与芦苇，同样算「有风」（F4 帽檐微动）
    { kind: 'wind', y: 322 },
    { kind: 'line', x1: 0, y1: 430, x2: 430, y2: 430, width: 2 },
    // L3-1 水塘：顶边贴地表线 430 往下，读成地面上的一片积水（不是地下水）
    { kind: 'water', x: 390, y: 430, w: 100, h: 44 },
    { kind: 'rect', x: 340, y: 372, w: 56, h: 58 },          // 泵体
    { kind: 'circle', x: 340, y: 344, r: 13 },               // 泵头
    { kind: 'line', x1: 368, y1: 400, x2: 412, y2: 412, width: 3 }, // 出水管
    { kind: 'text', x: 340, y: 396, text: '30年', size: 10, align: 'center' },
    // L3-4 泵体锈迹 + 苔藓 + 出水口滴线
    { kind: 'rust', x: 340, y: 372, w: 56, h: 58, drip: [412, 412] },
    // L3-2 芦苇/香蒲：岸线有"活物"；其中第 1、4 根每帧摆尖
    { kind: 'reeds', x1: 336, x2: 430, y: 430, n: 7, h: 30, sway: [1, 4] },
    // L3-3 涟漪：出水口下方（动态层，2 环错相位）
    { kind: 'ripple', x: 412, y: 436 },
    // L3-5 干裂纹：替代原来的三条示意线，主干 + 分叉 + 翘起土片
    { kind: 'cracks', x1: 20, x2: 190, y: 446 },
    { kind: 'text', x: 105, y: 468, text: '田裂了', size: 10, align: 'center' },
  ],
  lines: { intro: 'l3_intro', win: 'l3_win', failStreak: 'common_fail2', stamp: 'stamp1' },
  failHints: ['光靠你和一块小石头，压不动。', '「变重」——质量 ×3。', '把变重的东西丢到踏板上，然后走开。'],
};
