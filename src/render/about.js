/**
 * src/render/about.js —— 「关于 / 许可」浮层
 *
 * 为什么要有：MIT 要求「保留版权与许可声明」，而许可正文目前只躺在产物的那个
 * text/plain 许可块里——合规但玩家看不到。这里给一个能点到的入口，
 * 把「谁做的 / 什么许可 / 用了谁的库」摊开写清楚。
 *
 * 纯绘制 + 布局常量，无状态、无监听；开关状态由 main.js 的 view.about 持有。
 *
 * ⚠️ 顶层名一律加 ABT_ 前缀：本项目走 fallback-concat（纯拼接，无模块作用域隔离），
 * 构建门禁 D3 会拦「顶层名重复」。INK / roundRect 这些通用名会与 title-card.js、hud.js 撞。
 */
import { DESIGN_W } from '../core/config.js';

const ABT_INK = '#38312a';
const ABT_INK_MID = 'rgba(56,49,42,0.70)';
const ABT_INK_SOFT = 'rgba(56,49,42,0.46)';
const ABT_CARD = '#f7f2e4';
const ABT_UI = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
const ABT_SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';

/** 卡片几何（main.js 的命中判定与绘制共用，避免两处写死坐标对不上） */
export const ABOUT_CARD = { x: 40, y: 236, w: DESIGN_W - 80, h: 372 };
/** 「知道了」按钮 */
export function aboutCloseRect() {
  return { x: DESIGN_W / 2 - 54, y: ABOUT_CARD.y + ABOUT_CARD.h - 56, w: 108, h: 34 };
}

function abtRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 左侧标签 + 右侧值，返回下一行的 y */
function abtKv(ctx, label, value, y, x) {
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y);
  ctx.font = `12px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK;
  ctx.fillText(value, x + 46, y);
  return y + 22;
}

/**
 * @param {CanvasRenderingContext2D} ctx  design 坐标系
 * @param {object} view  只用 view.version
 */
export function drawAbout(ctx, view) {
  const c = ABOUT_CARD;
  ctx.save();

  // 遮罩：让底下关卡退后，但不全黑（纸页手感，不是模态弹窗）
  ctx.fillStyle = 'rgba(239,231,214,0.90)';
  ctx.fillRect(0, 0, DESIGN_W, 932);

  // 卡片
  ctx.fillStyle = ABT_CARD;
  abtRoundRect(ctx, c.x, c.y, c.w, c.h, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,64,0.55)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 小标题
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.fillText('关 于', DESIGN_W / 2, c.y + 34);

  // 主名：英文作署名行，中文为主
  ctx.font = `600 22px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK;
  ctx.fillText('Sketchsmith', DESIGN_W / 2, c.y + 66);
  ctx.font = `13px ${ABT_SERIF}`;
  ctx.fillStyle = ABT_INK_MID;
  ctx.fillText('《我是造物主》', DESIGN_W / 2, c.y + 88);

  // 分隔线
  ctx.strokeStyle = 'rgba(90,80,64,0.30)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x + 34, c.y + 106);
  ctx.lineTo(c.x + c.w - 34, c.y + 106);
  ctx.stroke();

  // 正文
  let y = c.y + 132;
  const x = c.x + 34;
  y = abtKv(ctx, '版本', (view && view.version ? 'v' + view.version : 'v0.2.0') + ' · 单文件离线运行', y, x);
  y = abtKv(ctx, '制作', 'Huanjin', y, x);
  y = abtKv(ctx, '许可', 'MIT（代码可自由使用、修改、再分发）', y, x);
  // 依赖名太长，一行放不进卡片内宽：拆两行，第二行不重复标签
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.fillText('依赖', x, y);
  ctx.font = `12px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK;
  ctx.fillText('matter-js · poly-decomp', x + 46, y);
  ctx.fillText('roughjs · perfect-freehand', x + 46, y + 19);
  y += 19;

  // 依赖许可补充说明（三行小字）
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.textAlign = 'left';
  ctx.fillText('以上 4 个库同为 MIT 许可，版权归各自作者。', x, y + 30);
  ctx.fillText('完整许可正文见仓库 LICENSE，以及产物内', x, y + 48);
  // ⚠️ 这里绝不能写出完整的 script 开标签字面量：
  // tools/check-single-file.mjs 用非贪婪正则抓「第一个 licenses 块」，
  // 注释或文案里的字面量会先被匹配到，导致真正的许可块被跳过后误判「缺失或不完整」。
  ctx.fillText('id="licenses" 的纯文本块（看页面源码可见）。', x, y + 66);

  // 「知道了」按钮
  const btn = aboutCloseRect();
  ctx.fillStyle = 'rgba(63,107,79,0.10)';
  abtRoundRect(ctx, btn.x, btn.y, btn.w, btn.h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(63,107,79,0.75)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#3f6b4f';
  ctx.font = `600 13px ${ABT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('知道了', DESIGN_W / 2, btn.y + btn.h / 2 + 0.5);

  // 底部提示：点任何地方都能关，别让玩家去找那个按钮
  ctx.font = `10px ${ABT_UI}`;
  ctx.fillStyle = 'rgba(56,49,42,0.30)';
  ctx.fillText('点任意处关闭', DESIGN_W / 2, c.y + c.h + 22);

  ctx.restore();
}
