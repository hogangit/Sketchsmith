/**
 * src/render/title-card.js —— 开场扉页（Title Card）
 *
 * 中英主次（见 docs/naming.md 的接线清单）：
 *   · 中文《我是造物主》= 主视觉：48px 宋体，逐字绘制 + 交替微旋 + 基线起伏，
 *     模拟手写落笔的歪斜感（一次性静态字，不用字体文件，零网络请求）。
 *   · 英文 SKETCHSMITH = 副行：13px、字距拉开、淡墨。它是「署名」不是「标题」，
 *     所以不跟中文抢视觉重量。
 *   · tagline = 第三行，最淡。
 *
 * 纯函数式绘制：alpha / now 由调用方（main.js）持有，本模块不持状态、不读时钟、不注册监听。
 * 无导入依赖（除版式常量），可在离屏层或主画布上任意调用。
 */
import { DESIGN_H, DESIGN_W } from '../core/config.js';

const INK = '#38312a';
const INK_MID = 'rgba(56,49,42,0.66)';
const INK_SOFT = 'rgba(56,49,42,0.38)';
const PAPER = '#efe7d6';
const SEAL = 'rgba(166,62,46,0.78)';
/** 宋体系：macOS 宋体 → Noto/Source Han Serif → 通用 serif（Windows 上落到 SimSun） */
const CN_FONT = '"Songti SC","Noto Serif SC","Source Han Serif SC",serif';
const UI_FONT = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';

/** 一条带手抖的墨线（确定性：抖幅由 seed 定相位，不随时间变化） */
function inkLine(ctx, x1, x2, y, seed, color) {
  ctx.strokeStyle = color || INK_MID;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x1 + (x2 - x1) * t;
    const dy = Math.sin(t * 7.3 + seed) * 0.9 + Math.sin(t * 2.1 + seed * 1.7) * 0.6;
    if (i === 0) ctx.moveTo(x, y + dy);
    else ctx.lineTo(x, y + dy);
  }
  ctx.stroke();
}

/** 逐字左对齐绘制并拉开字距（canvas 的 letterSpacing 在旧内核不可靠） */
function trackedText(ctx, text, cx, y, track, font, color) {
  ctx.font = font;
  const ws = [];
  let total = 0;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    ws.push(w);
    total += w + track;
  }
  total -= track;
  let x = cx - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y);
    x += ws[i] + track;
  }
  return total;
}

/**
 * @param {CanvasRenderingContext2D} ctx  已处于 design 坐标系（430×932）
 * @param {{alpha?:number, now?:number}} opt
 */
export function drawTitleCard(ctx, opt) {
  const o = opt || {};
  const alpha = Math.max(0, Math.min(1, o.alpha == null ? 1 : o.alpha));
  if (alpha <= 0.002) return;
  const now = o.now || 0;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── 纸底：整屏盖住，避免与关卡画面抢读 ──
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);

  // 稿纸横线：极淡，给「练习本扉页」的质感（不是装饰，是让空白不透成灰）
  ctx.strokeStyle = 'rgba(56,49,42,0.05)';
  ctx.lineWidth = 1;
  for (let y = 132; y < DESIGN_H - 96; y += 38) {
    ctx.beginPath();
    ctx.moveTo(30, y + 0.5);
    ctx.lineTo(DESIGN_W - 30, y + 0.5);
    ctx.stroke();
  }

  // ── 版框：上下两条手抖长线 ──
  // 上留白 98px / 下留白 76px：按「书名页」习惯顶部呼吸略大于底部，
  // 下框不能贴住 tagline（初版 520 时只差 30px，标题块被读成往下挤）。
  inkLine(ctx, 46, DESIGN_W - 46, 250, 1.3);
  inkLine(ctx, 46, DESIGN_W - 46, 540, 2.7);

  // ── 中文主视觉：48px 宋体，逐字微旋 + 基线起伏 ──
  const CN = '我是造物主';
  const SIZE = 48;
  const TRACK = 5;
  ctx.font = `700 ${SIZE}px ${CN_FONT}`;
  const ws = [];
  let total = 0;
  for (const ch of CN) {
    const w = ctx.measureText(ch).width;
    ws.push(w);
    total += w + TRACK;
  }
  total -= TRACK;
  const DIP = [0, -1.6, 1.1, -0.6, 1.5, 0];
  let x = (DESIGN_W - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < CN.length; i++) {
    ctx.save();
    ctx.translate(x + ws[i] / 2, 372 + DIP[i % DIP.length]);
    ctx.rotate((i % 2 === 0 ? -1 : 1) * 0.011);
    ctx.fillStyle = INK;
    ctx.fillText(CN[i], 0, 0);
    ctx.restore();
    x += ws[i] + TRACK;
  }

  // 中文与英文之间的短分隔：一小段墨线 + 两端点
  inkLine(ctx, DESIGN_W / 2 - 46, DESIGN_W / 2 + 46, 410, 4.1, INK_SOFT);
  ctx.fillStyle = INK_SOFT;
  ctx.beginPath();
  ctx.arc(DESIGN_W / 2 - 52, 410, 1.6, 0, Math.PI * 2);
  ctx.arc(DESIGN_W / 2 + 52, 410, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // ── 英文副行：署名，不抢主视觉 ──
  trackedText(ctx, 'SKETCHSMITH', DESIGN_W / 2, 438, 6, `600 13px ${UI_FONT}`, INK_MID);

  // ── tagline ──
  ctx.font = `italic 11px ${CN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK_SOFT;
  ctx.fillText('Draw it. Bless it. See if it holds.', DESIGN_W / 2, 464);

  // ── 印章：右下角「造」，给中味落款 ──
  const sx = DESIGN_W - 62;
  const sy = 540 - 38;   // 完整落在下框线之上，不骑线（骑线会读成「盖歪了」而非「随手盖的」）
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(0.045);
  ctx.strokeStyle = SEAL;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(-15.5, -15.5, 31, 31);
  ctx.fillStyle = SEAL;
  ctx.font = `700 17px ${CN_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('造', 0, 0.5);
  ctx.restore();

  // ── 底部提示：呼吸明暗，告诉玩家可以点 ──
  const breath = 0.5 + 0.5 * Math.sin(now / 420);
  ctx.font = `12px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(56,49,42,${(0.30 + 0.30 * breath).toFixed(3)})`;
  ctx.fillText('点一下就开始', DESIGN_W / 2, 826);
  ctx.font = `10px ${UI_FONT}`;
  ctx.fillStyle = `rgba(56,49,42,${(0.18 + 0.16 * breath).toFixed(3)})`;
  ctx.fillText('tap to begin', DESIGN_W / 2, 848);

  ctx.restore();
}
