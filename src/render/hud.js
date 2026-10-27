/**
 * src/render/hud.js —— HUD 与按钮命中（零物理、零平台 API）
 * 版式约束（阶段2 评审 P1-2/P2-4）：
 *   · 头部 ≤96px：标题 / 副标题 / 芯片同行，开发注记只在 ?debug=1 里出现
 *   · 场景 ≥360px：BOOK_TOP=513，场景占 96–513
 *   · 调试 HUD 做成右上角半透明小块，不与主角区域重叠
 */
import { BOOK_TOP, DESIGN_H, DESIGN_W } from '../core/config.js';

const HUD_CHIP_W = 66;
const HUD_CHIP_H = 34;
const HUD_CHIP_GAP = 6;
const HUD_CHIP_Y = 8;
const HUD_PAD = 12;

const ABILITY_LABELS = {
  harden: '变硬', roll: '会滚', heavy: '变重', light: '变轻', tickle: '怕痒',
};

/** 芯片按「右对齐、与标题同行」排布；n 由当前关卡芯片数决定 */
export function chipRect(i, n) {
  // ⚠️ 原来 Math.min(4, n) 把 5 枚钳到 4：第 5 枚（怕痒）直接溢出右边界
  const count = Math.max(1, n || 4);
  // 5 枚起缩窄芯片：66px 一枚时 5 枚总宽 354、右对齐后 x0=64，会压到左侧标题（标题止于 x≈100）；
  // 56px 一枚时总宽 304、x0=114，与标题不重叠
  const w = count > 4 ? 56 : HUD_CHIP_W;
  const total = count * w + (count - 1) * HUD_CHIP_GAP;
  const x0 = DESIGN_W - HUD_PAD - total;
  return { x: x0 + i * (w + HUD_CHIP_GAP), y: HUD_CHIP_Y, w, h: HUD_CHIP_H };
}

export function chipIndexAt(x, y, n) {
  // ⚠️ 原来 i < 4 写死：第 5 枚芯片看得见却**点不到**（关5/沙盒的「怕痒」由此失灵）
  const count = Math.max(1, n || 4);
  for (let i = 0; i < count; i++) {
    const r = chipRect(i, n);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

export function buttonAt(x, y) {
  return null;   // 重来/声音按钮已挪进标题行下方 40 内，见 drawHud 的 hitRect
}

/** 标题行右下角的两个小按钮命中区（与 drawHud 中的绘制保持一致） */
export function headerButtonAt(x, y) {
  if (y < 52 || y > 92) return null;
  if (x > DESIGN_W - 46 && x < DESIGN_W - 10) return 'audio';
  if (x > DESIGN_W - 96 && x < DESIGN_W - 50) return 'retry';
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.closePath();
}

export function drawHud(ctx, view) {
  const snap = view.snapshot || {};
  const chips = snap.chips || view.level.chips || [];
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---- 头部（≤96px）：标题 + 副标题在左，芯片在右，同一行带 ----
  ctx.fillStyle = '#2b2620';
  ctx.font = '700 19px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(snap.title || view.level.title, 20, 30);
  ctx.fillStyle = '#7a6f5e';
  ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  // 沙盒没有关号、也没有「过关」这回事 ⇒ 不显示「第 N 关」，只显示「造物园」
  const headLabel = (view.level && view.level.id === 'sandbox')
    ? '造物园'
    : ('第 ' + (view.levelIndex + 1) + ' 关 / ' + (view.totalLevels || 5));
  ctx.fillText(headLabel + '　' + (view.level.subtitle || ''), 20, 48);

  const armed = snap.armedAbilities || [];
  // ⚠️ 原来还有个 && i < 4 写死：第 5 枚芯片（怕痒）永远画不出来。上限交给 chipRect 的宽度适配
  for (let i = 0; i < chips.length; i++) {
    const r = chipRect(i, chips.length);
    const id = chips[i];
    const on = armed.indexOf(id) >= 0;
    ctx.fillStyle = on ? '#3f6b4f' : 'rgba(246,241,227,0.95)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 9);
    ctx.fill();
    ctx.strokeStyle = on ? '#2c4a37' : 'rgba(90,80,64,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = on ? '#f4efe2' : '#3a352c';
    ctx.font = '600 14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(ABILITY_LABELS[id] || id, r.x + 11, r.y + 22);
  }

  // 重来 / 声音：标题行下方，不与场景争位置
  ctx.strokeStyle = 'rgba(90,80,64,0.45)';
  ctx.lineWidth = 1.3;
  roundRect(ctx, DESIGN_W - 96, 54, 46, 34, 8); ctx.stroke();
  roundRect(ctx, DESIGN_W - 46, 54, 36, 34, 8); ctx.stroke();
  ctx.fillStyle = '#5d5446';
  ctx.font = '12px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('重来', DESIGN_W - 88, 76);
  ctx.fillText(view.audioOn ? '声' : '静', DESIGN_W - 34, 76);

  // ---- 失败提示（只在场景上沿，不压地形）----
  // 提示项可以是字符串，也可以是 {beam, other}：**按玩家上一次造出来的形态分岔**（关1 在用）。
  // 【禁止话术·写死在这里】不许出现「再试」「画长一点」「画得不对」「够不着」「顶」
  //   —— 提示要否掉方向，不要否掉玩家的手法；后者会让他在错误方向上更努力。
  const hints = view.level.failHints || [];
  if (snap.hintLevel > 0 && hints.length) {
    const t = pickFailHint(hints, snap.hintLevel, snap.creature && snap.creature.form);
    ctx.fillStyle = 'rgba(120,40,32,0.92)';
    ctx.font = '12px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    wrapText(ctx, t || '', 20, 100, DESIGN_W - 40, 16);
  }

  // ---- 对话气泡（放在天空带 y≈296，绝不压地面/沟/农夫）----
  if (view.bubble && view.bubble.until > view.now) {
    const b = view.bubble;
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const text = b.text || '';
    const w = Math.min(DESIGN_W - 40, Math.max(130, ctx.measureText(text).width + 28));
    const x = 20;
    const y = 296;
    ctx.fillStyle = 'rgba(250,246,236,0.96)';
    ctx.strokeStyle = 'rgba(90,80,64,0.5)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, x, y, w, 50, 12); ctx.fill(); ctx.stroke();
    // 小尾巴：指向左岸的农夫（气泡在天空带，读者要知道是谁在说话）
    ctx.beginPath();
    ctx.moveTo(x + 34, y + 48);
    ctx.lineTo(x + 46, y + 62);
    ctx.lineTo(x + 52, y + 47);
    ctx.closePath();
    ctx.fillStyle = 'rgba(250,246,236,0.96)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,80,64,0.5)';
    ctx.beginPath(); ctx.moveTo(x + 34, y + 49); ctx.lineTo(x + 46, y + 62); ctx.lineTo(x + 52, y + 48); ctx.stroke();
    ctx.fillStyle = '#6b6050';
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(b.who || '', x + 14, y + 17);
    ctx.fillStyle = '#2b2620';
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(text, x + 14, y + 37);
    if (view.voiceMode === 'bubble') {
      ctx.fillStyle = 'rgba(120,110,90,0.6)';
      ctx.font = '10px system-ui';
      ctx.fillText('（无中文语音 · 气泡模式）', x + 14, y + 47);
    }
  }

  // ---- 失败闪红 ----
  if (view.failFlash > 0) {
    ctx.fillStyle = 'rgba(178,58,44,' + (0.16 * view.failFlash).toFixed(3) + ')';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  }

  // ---- 过关覆盖层 ----
  if (view.win) {
    ctx.fillStyle = 'rgba(24,22,18,0.55)';
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    ctx.fillStyle = '#f7f2e4';
    ctx.font = '700 34px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const isLast = view.levelIndex >= ((view.totalLevels || 3) - 1);
    const title = isLast ? '第一章 · 过完了' : '过关';
    const tw = ctx.measureText(title).width;
    ctx.fillText(title, (DESIGN_W - tw) / 2, 400);
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const sub = isLast ? '点一下进造物园（想造什么就造什么）' : '点一下继续';
    const sw = ctx.measureText(sub).width;
    ctx.fillStyle = 'rgba(247,242,228,0.75)';
    ctx.fillText(sub, (DESIGN_W - sw) / 2, 434);
  }

  // ---- 造物簿标题 ----
  ctx.fillStyle = 'rgba(90,80,64,0.7)';
  ctx.font = '12px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('造物簿 · 在这里画', 20, BOOK_TOP + 18);
  if (view.livePoints > 0) {
    ctx.fillStyle = 'rgba(90,80,64,0.9)';
    ctx.fillText('采样 ' + view.livePoints + ' 点', DESIGN_W - 92, BOOK_TOP + 18);
  }

  // ---- ?debug=1：右上角半透明小块，不压主角 ----
  if (view.debug) {
    const s = snap.creature;
    const lines = [
      'fps ' + view.fps.toFixed(0) + '  frame ' + view.frameMs.toFixed(1) + 'ms  tier ' + view.tier,
      'bodies ' + view.bodyCount + '  strokes ' + view.strokeCount + '  unlocked ' + view.audioUnlocked,
      'chips [' + chips.join(',') + ']  armed [' + (snap.armedAbilities || []).join(',') + ']',
      s ? ('form ' + s.form + '  deg ' + s.degraded + '  parts ' + s.parts + '  mass ' + s.mass.toFixed(1)) : 'form -',
      s && s.geo ? ('aspect ' + s.geo.aspect.toFixed(2) + '  area ' + s.geo.area.toFixed(0) + '  w/h ' + s.geo.w.toFixed(0) + '/' + s.geo.h.toFixed(0)) : 'geo -',
      s && s.geo ? ('closed ' + s.geo.closed + '  nodes ' + s.geo.nodes + '  combos ' + s.combos.join('/')) : 'combos -',
      snap.propPos ? ('prop ' + snap.propPos.x.toFixed(0) + ',' + snap.propPos.y.toFixed(0)) : 'prop -',
      snap.plate && snap.plate.length ? ('plate ' + snap.plate[0].load.toFixed(1) + '/' + snap.plate[0].threshold + '  hold ' + snap.plate[0].holdMs.toFixed(0) + 'ms') : 'plate -',
      // 位置分开报：B=物理圆心（body.position），R=渲染锚点（drawFarmer 的 cx,cy），feet=脚底 y。
      // 三者关系固定：R === B（渲染直接用 body.position，没有任何偏移），feet = B.y + 14（r=14）。
      // 画面上的人是按脚底放大 1.5× 的，但锚点仍是 B —— 所以"报的位置"和"画的位置"永远同一坐标系。
      (snap.actorPos
        ? ('actor B' + snap.actorPos.x.toFixed(0) + ',' + snap.actorPos.y.toFixed(0) +
           '  R' + snap.actorPos.x.toFixed(0) + ',' + snap.actorPos.y.toFixed(0) +
           '  feet ' + (snap.actorPos.y + 14).toFixed(0))
        : 'actor -') + '  fails ' + snap.failStreak,
      '（本轮只做 4 个能力，其余 20 个未实装）',
    ];
    const bx = 176;
    const bw = DESIGN_W - bx - 12;
    const bh = lines.length * 12 + 12;
    ctx.fillStyle = 'rgba(20,18,14,0.55)';
    roundRect(ctx, bx, 118, bw, bh, 8);
    ctx.fill();
    ctx.font = '10px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = 'rgba(244,239,226,0.95)';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + 8, 132 + i * 12);
  }

  // ---- ?impactDebug=1：只报本帧 score 与是否被闸门拦下，不报累计次数 ----
  if (view.impactDebug) {
    const d = view.impactDebug;
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = d.gated ? 'rgba(150,90,20,0.95)' : 'rgba(30,90,50,0.95)';
    ctx.fillText('impact score ' + d.score.toFixed(3) + '  ' + (d.gated ? 'GATED(' + d.reason + ')' : d.reason), 20, view.debug ? 262 : 120);
  }

  ctx.restore();
}

/**
 * 失败提示的取值（纯函数，便于单测）：字符串直接返回；{beam, other} 按形态分岔。
 * 形态分岔现在只有关1 在用——**关2 已不再按形态分岔**（梁是合法解，去否掉梁的方向就是骗玩家），
 * 但分岔机制本身保留：它是"提示是否真的被说出"的可断言入口。
 *
 * 【禁止话术·闭集】任何提示里不许出现「再试」「画长一点」「画得不对」「这次可能行」「够不着」，
 * 「顶」也不许（"从底下往上顶"重心往里走，南瓜更稳——那是反的）。
 * 由 tests/ 下的闭集断言拦住，不靠自觉（注释里别写测试文件名：产物里一旦出现测试文件后缀，
 * 单文件门禁 L2"测试未被打进产物"就会红——那条断言是对的，别去改它）。
 */
export function pickFailHint(hints, hintLevel, form) {
  if (!hints || !hints.length || !(hintLevel > 0)) return '';
  const raw = hints[Math.min(hints.length - 1, hintLevel - 1)];
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  return (form === 'beam' ? raw.beam : raw.other) || '';
}

export function wrapText(ctx, text, x, y, maxW, lh) {
  const chars = String(text).split('');
  let line = '';
  let yy = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = ch;
      yy += lh;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
  return yy;
}
