/**
 * src/level/levels/ch1-01.js —— 关1 一个洞（难度 1，无机关）
 * 地形坐标一律 **中心点 + 宽高**（{x,y,w,h} 的 x/y 是 body 中心）。
 *
 * 构图（阶段2 复审后重做）：横向构图，两岸地平线**对齐同一条水平线 y=430**，
 * 中间是又深又暗的沟（下到底就上不来），农夫站在左岸地面上，田在右岸地面上。
 * 沟宽 170px？不 —— 100px（164..334），约三个身位（农夫直径 28），玩家一眼能判断梁要跨多远。
 */
export const LEVEL_CH1_01 = {
  id: 'ch1-01',
  chapter: 1,
  title: '一个洞',
  subtitle: '他过不去。画点什么。',
  chips: ['harden'],
  spawnY: 84,
  terrain: [
    { x: 82, y: 471, w: 164, h: 82, mat: 'ground' },    // 左岸：x 0..164，顶面 430
    { x: 382, y: 471, w: 96, h: 82, mat: 'ground' },    // 右岸（他的田）：x 334..430，顶面 430
  ],
  actors: [{ kind: 'walker', x: 58, y: 416, targetX: 392, label: '农夫' }],
  props: [],
  plates: [],
  goal: { type: 'reachActor', x: 372, maxY: 446 },
  resetActorIfBelowY: 560,
  guides: [{ x: 164 }, { x: 334 }],
  hints: {
    highlight: [{ x: 164, y: 430, r: 22 }, { x: 334, y: 430, r: 22 }],
    beamOutline: { x1: 148, y1: 438, x2: 352, y2: 440 },
  },
  scenery: [
    { kind: 'hills' },
    { kind: 'chasm', x1: 164, x2: 334, y: 430, depth: 83 },
    { kind: 'line', x1: 0, y1: 430, x2: 164, y2: 430, width: 2.5 },
    { kind: 'line', x1: 334, y1: 430, x2: 430, y2: 430, width: 2.5 },
    // 左岸：两丛草，让"地"不是一块空板
    { kind: 'crops', x1: 24, x2: 40, y: 430, n: 2, h: 8 },
    { kind: 'crops', x1: 104, x2: 124, y: 430, n: 2, h: 9 },
    // 右岸＝他的田：矮土垄 + 三根作物 + 木牌（三样东西一眼认成田）
    { kind: 'ridge', x1: 336, x2: 428, y: 430, h: 9 },
    // L1-4 草垛：田侧两垛，让地表不再是一条直线（art-polish 4.1）
    { kind: 'haystack', x: 66, y: 430, w: 28, h: 16 },
    { kind: 'haystack', x: 348, y: 430, w: 24, h: 13 },
    { kind: 'crops', x1: 372, x2: 420, y: 430, n: 3, h: 26 },
    { kind: 'sign', x: 353, y: 430, text: '田' },
    { kind: 'text', x: 382, y: 480, text: '他的田', size: 10, align: 'center' },
    { kind: 'text', x: 249, y: 470, text: '下去就上不来', size: 10, align: 'center', tone: 'light' },
  ],
  lines: { intro: 'l1_intro', win: 'l1_win', failStreak: 'common_fail2', stamp: null },
  failHints: [
    '两头都要搭到岸上才算桥。虚线是沟的两端。',
    '中缝会折的桥踩上去会塌——点「变硬」把造物冻成一块整的。',
    '扁长的梁最好用：从这头一直拉到那头，再点「变硬」。',
  ],
};
