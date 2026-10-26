/**
 * src/core/config.js —— 版式与设计分辨率常量
 * 坐标系统：全部逻辑计算在 430×932 的设计空间里进行（美术尺寸无关），
 * 渲染时统一缩放到实际视口。世界（物理区）在上，造物簿（绘制区）在下。
 */
export const DESIGN_W = 430;
export const DESIGN_H = 932;

/** 造物簿上沿 = 屏幕下半 45%（levels.md 第八节硬指标 / tech-baseline K9） */
export const BOOK_TOP = 513;
export const BOOK_H = DESIGN_H - BOOK_TOP; // 419 px = 44.96%

/** 物理世界可视高度：造物簿以上的部分 */
export const WORLD_H = BOOK_TOP;

/** 造物从天上落下来的高度（设计 px） */
export const SPAWN_Y = 84;

export const APP_VERSION = '0.2.0';
