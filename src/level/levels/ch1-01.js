/**
 * src/level/levels/ch1-01.js —— 关1 一个洞（难度 1，无机关）
 * 地形坐标一律 **中心点 + 宽高**（{x,y,w,h} 的 x/y 是 body 中心），旋转地形再加 angle。
 */
export const LEVEL_CH1_01 = {
  id: 'ch1-01',
  chapter: 1,
  title: '一个洞',
  subtitle: '他过不去。画点什么。',
  chips: ['harden'],
  spawnY: 84,
  terrain: [
    { x: 73.5, y: 440, w: 187, h: 220, mat: 'ground' },   // 左岸 顶面 y=330（到 x=167）
    { x: 346.5, y: 440, w: 167, h: 220, mat: 'ground' },  // 右岸 顶面 y=330（从 x=263）
    { x: 215, y: 487, w: 96, h: 70, mat: 'ground' },      // 沟底 顶面 y=452（造物掉进去当装饰）
  ],
  actors: [{ kind: 'walker', x: 55, y: 314, targetX: 392, label: '农夫' }],
  props: [],
  plates: [],
  goal: { type: 'reachActor', x: 372, maxY: 392 },
  resetActorIfBelowY: 420,     // 掉进沟里超过这个 y 就判一次失败
  guides: [{ x: 167 }, { x: 263 }],
  hints: {
    highlight: [{ x: 167, y: 330, r: 26 }, { x: 263, y: 330, r: 26 }],
    beamOutline: { x1: 150, y1: 322, x2: 280, y2: 330 },
  },
  scenery: [
    { kind: 'line', x1: 0, y1: 330, x2: 430, y2: 330, width: 2 },
    { kind: 'text', x: 392, y: 306, text: '他的田', size: 11, align: 'right' },
    { kind: 'circle', x: 320, y: 318, r: 7 },
    { kind: 'circle', x: 345, y: 322, r: 6 },
    { kind: 'circle', x: 300, y: 324, r: 5 },
    { kind: 'rect', x: 40, y: 292, w: 46, h: 38 },
    { kind: 'line', x1: 62, y1: 273, x2: 40, y2: 292, width: 2 },
    { kind: 'line', x1: 62, y1: 273, x2: 86, y2: 292, width: 2 },
    { kind: 'text', x: 215, y: 470, text: '（沟）', size: 10, align: 'center' },
  ],
  lines: { intro: 'l1_intro', win: 'l1_win', failStreak: 'common_fail2', stamp: 'ch1_stamp' },
  failHints: ['再画长一点：梁要跨过整道沟。', '沟沿会发光——那也是能踩的地方。', '照虚线画一条，加上「变硬」。'],
};
