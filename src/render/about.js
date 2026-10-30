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
import { SOUND_THEMES } from '../audio/audio-bus.js';

const ABT_INK = '#38312a';
const ABT_INK_MID = 'rgba(56,49,42,0.70)';
const ABT_INK_SOFT = 'rgba(56,49,42,0.46)';
const ABT_CARD = '#f7f2e4';
const ABT_UI = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
const ABT_SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';

/** 卡片几何（main.js 的命中判定与绘制共用，避免两处写死坐标对不上） */
export const ABOUT_CARD = { x: 40, y: 224, w: DESIGN_W - 80, h: 486 };
/** 「知道了」按钮 */
export function aboutCloseRect() {
  return { x: DESIGN_W / 2 - 54, y: ABOUT_CARD.y + ABOUT_CARD.h - 56, w: 108, h: 34 };
}

/**
 * 「声音风格」选择芯片的几何（与绘制共用）。三档：暖木 / 八音盒 / 陶笛。
 * main.js 在 view.about 为真时按这些矩形做命中判定，点中即换主题。
 */
export function aboutThemeRects() {
  const c = ABOUT_CARD;
  const ids = Object.keys(SOUND_THEMES);
  const w = 86, h = 34, gap = 10;
  const x0 = c.x + 34;
  const y0 = c.y + 312;
  return ids.map((id, i) => ({ id, label: SOUND_THEMES[id].label, x: x0 + i * (w + gap), y: y0, w, h }));
}
/** 命中测试：点中某枚声音风格芯片则返回其 id，否则 null */
export function aboutThemeHit(x, y) {
  for (const r of aboutThemeRects()) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r.id;
  }
  return null;
}

/**
 * 「语音朗读」控件的几何：左开关（开/关）+ 右音色条（‹ 名字 ›）。
 * 音色条整条都能点（点左半边上一个、右半边下一个），但左右箭头各有自己的命中区，
 * 玩家点小箭头时不会因为差 2px 而切成反方向。
 */
export function aboutVoiceRects() {
  const c = ABOUT_CARD;
  const y = c.y + 384;
  const toggle = { x: c.x + 34, y, w: 52, h: 30 };
  const stripW = c.x + c.w - 34 - (toggle.x + toggle.w + 10);
  const strip = { x: toggle.x + toggle.w + 10, y, w: stripW, h: 30 };
  const prev = { x: strip.x, y, w: 28, h: 30 };
  const next = { x: strip.x + strip.w - 28, y, w: 28, h: 30 };
  const name = { x: prev.x + prev.w, y, w: strip.w - 56, h: 30 };
  return { toggle, strip, prev, next, name };
}
/** 命中测试：返回 'toggle' | 'prev' | 'next' | 'strip' | null */
export function aboutVoiceHit(x, y) {
  const r = aboutVoiceRects();
  const inside = (b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
  if (inside(r.toggle)) return 'toggle';
  if (inside(r.prev)) return 'prev';
  if (inside(r.next)) return 'next';
  if (inside(r.strip)) return 'strip';
  return null;
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

  // 声音风格：让用户挑选音色（默认暖木，可换八音盒 / 陶笛）
  const ty = c.y + 300;
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.textAlign = 'left';
  ctx.fillText('声音风格', x, ty);
  const themeId = (view && view.soundTheme) || 'warm';
  for (const r of aboutThemeRects()) {
    const sel = r.id === themeId;
    ctx.fillStyle = sel ? 'rgba(63,107,79,0.16)' : 'rgba(246,241,227,0.95)';
    abtRoundRect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    ctx.strokeStyle = sel ? 'rgba(63,107,79,0.75)' : 'rgba(90,80,64,0.55)';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = sel ? '#3f6b4f' : '#3a352c';
    ctx.font = `600 13px ${ABT_UI}`;
    ctx.textAlign = 'center';
    ctx.fillText(r.label, r.x + r.w / 2, r.y + 22);
  }
  ctx.textAlign = 'left';

  // ── 语音朗读 ────────────────────────────────────────────────────────────
  // 浏览器念台词用的是**系统自带的 TTS**，音质随设备天差地别：
  // 有「在线自然」音色的设备像人，只有老 Huihui 的设备像机器人。
  // 所以这里给两件事：换音色（换成最像人的那个）、关掉（只用字幕）。
  const vOn = !!(view && view.voiceOn);
  const vCount = (view && view.voiceCount) || 0;
  ctx.font = `11px ${ABT_UI}`;
  ctx.fillStyle = ABT_INK_SOFT;
  ctx.textAlign = 'left';
  ctx.fillText('语音', x, c.y + 372);

  const vr = aboutVoiceRects();
  // 开关
  ctx.fillStyle = vOn ? 'rgba(63,107,79,0.16)' : 'rgba(246,241,227,0.95)';
  abtRoundRect(ctx, vr.toggle.x, vr.toggle.y, vr.toggle.w, vr.toggle.h, 8);
  ctx.fill();
  ctx.strokeStyle = vOn ? 'rgba(63,107,79,0.75)' : 'rgba(90,80,64,0.55)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.fillStyle = vOn ? '#3f6b4f' : ABT_INK_SOFT;
  ctx.font = `600 13px ${ABT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(vCount === 0 ? '无' : (vOn ? '开' : '关'), vr.toggle.x + vr.toggle.w / 2, vr.toggle.y + 16);
  ctx.textBaseline = 'alphabetic';

  // 音色条
  ctx.fillStyle = 'rgba(246,241,227,0.80)';
  abtRoundRect(ctx, vr.strip.x, vr.strip.y, vr.strip.w, vr.strip.h, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,80,64,0.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const canSwitch = vCount > 1 && vOn;
  ctx.font = `13px ${ABT_UI}`;
  ctx.fillStyle = canSwitch ? ABT_INK_MID : 'rgba(56,49,42,0.24)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('‹', vr.prev.x + vr.prev.w / 2, vr.strip.y + 14);
  ctx.fillText('›', vr.next.x + vr.next.w / 2, vr.strip.y + 14);

  let vLabel;
  if (vCount === 0) vLabel = '此设备没有中文语音';
  else if (!vOn) vLabel = '已关闭 · 台词只显示字幕';
  else {
    vLabel = (view && view.voiceName) || '默认音色';
    if (vCount > 1) vLabel += '  ' + ((view.voiceIndex || 1) + '/' + vCount);
  }
  ctx.font = `12px ${ABT_UI}`;
  ctx.fillStyle = vOn && vCount > 0 ? ABT_INK : ABT_INK_SOFT;
  ctx.fillText(vLabel, vr.name.x + vr.name.w / 2, vr.strip.y + 15);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

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
