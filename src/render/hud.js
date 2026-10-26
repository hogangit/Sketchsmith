/**
 * src/render/hud.js —— HUD 与按钮命中（零物理、零平台 API）
 * 包含：关卡标题、芯片面板、失败提示阶梯、对话气泡、过关覆盖层、?debug=1 / ?impactDebug=1。
 */
import { BOOK_TOP, DESIGN_H, DESIGN_W } from '../core/config.js';

const HUD_CHIP_W = 88;
const HUD_CHIP_H = 40;
const HUD_CHIP_GAP = 8;
const HUD_CHIP_Y = 92;
const HUD_CHIP_X0 = 20;

const ABILITY_LABELS = {
  harden: '变硬', roll: '会滚', heavy: '变重', light: '变轻',
};

export function chipRect(i) {
  return { x: HUD_CHIP_X0 + i * (HUD_CHIP_W + HUD_CHIP_GAP), y: HUD_CHIP_Y, w: HUD_CHIP_W, h: HUD_CHIP_H };
}

export function chipIndexAt(x, y) {
  for (let i = 0; i < 4; i++) {
    const r = chipRect(i);
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
  }
  return -1;
}

export function buttonAt(x, y) {
  if (x > DESIGN_W - 58 && y > 16 && y < 56) return 'audio';
  if (x > DESIGN_W - 118 && x < DESIGN_W - 62 && y > 16 && y < 56) return 'retry';
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawHud(ctx, view) {
  const snap = view.snapshot || {};
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  // ---- 标题 ----
  ctx.fillStyle = '#2b2620';
  ctx.font = '600 22px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(snap.title || view.level.title, 20, 44);
  ctx.fillStyle = '#7a6f5e';
  ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('第 ' + (view.levelIndex + 1) + ' 关 / 3　' + (view.level.subtitle || ''), 20, 66);

  // ---- 右上两个按钮 ----
  ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = '#5d5446';
  ctx.strokeStyle = 'rgba(90,80,64,0.5)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, DESIGN_W - 118, 16, 56, 40, 10); ctx.stroke();
  ctx.fillText('重来', DESIGN_W - 104, 41);
  roundRect(ctx, DESIGN_W - 58, 16, 42, 40, 10); ctx.stroke();
  ctx.fillText(view.audioOn ? '声' : '静', DESIGN_W - 44, 41);

  // ---- 芯片 ----
  const chips = snap.chips || view.level.chips || [];
  const armed = snap.armedAbilities || [];
  for (let i = 0; i < chips.length && i < 4; i++) {
    const r = chipRect(i);
    const id = chips[i];
    const on = armed.indexOf(id) >= 0;
    ctx.fillStyle = on ? '#3f6b4f' : 'rgba(246,241,227,0.92)';
    roundRect(ctx, r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.strokeStyle = on ? '#2c4a37' : 'rgba(90,80,64,0.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = on ? '#f4efe2' : '#3a352c';
    ctx.font = '600 16px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(ABILITY_LABELS[id] || id, r.x + 14, r.y + 26);
    if (on) { ctx.font = '11px system-ui'; ctx.fillText('已贴', r.x + 58, r.y + 26); }
  }
  if (snap.chips && snap.chips.length < 4) {
    ctx.fillStyle = 'rgba(90,80,64,0.45)';
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText('（本轮只做 4 个能力，其余 20 个未实装）', HUD_CHIP_X0, HUD_CHIP_Y + HUD_CHIP_H + 16);
  }

  // ---- 提示阶梯 ----
  const hints = view.level.failHints || [];
  if (snap.hintLevel > 0 && hints.length) {
    const t = hints[Math.min(hints.length - 1, snap.hintLevel - 1)];
    ctx.fillStyle = 'rgba(120,40,32,0.92)';
    ctx.font = '13px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    wrapText(ctx, t, 20, 168, DESIGN_W - 40, 18);
  }

  // ---- 对话气泡 ----
  if (view.bubble && view.bubble.until > view.now) {
    const b = view.bubble;
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const text = b.text || '';
    const w = Math.min(DESIGN_W - 40, Math.max(120, ctx.measureText(text).width + 28));
    const x = 20;
    const y = 452;
    ctx.fillStyle = 'rgba(250,246,236,0.96)';
    ctx.strokeStyle = 'rgba(90,80,64,0.5)';
    ctx.lineWidth = 1.4;
    roundRect(ctx, x, y, w, 54, 12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6b6050';
    ctx.font = '11px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(b.who || '', x + 14, y + 18);
    ctx.fillStyle = '#2b2620';
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillText(text, x + 14, y + 39);
    if (view.voiceMode === 'bubble') {
      ctx.fillStyle = 'rgba(120,110,90,0.6)';
      ctx.font = '10px system-ui';
      ctx.fillText('（无中文语音 · 气泡模式）', x + 14, y + 50);
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
    const title = view.levelIndex >= 2 ? '第一章 · 过完了' : '过关';
    const tw = ctx.measureText(title).width;
    ctx.fillText(title, (DESIGN_W - tw) / 2, 400);
    ctx.font = '14px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    const sub = view.levelIndex >= 2 ? '点一下重玩第 1 关（本轮只做 3 关）' : '点一下继续';
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

  // ---- ?debug=1 ----
  if (view.debug) {
    const s = snap.creature;
    const lines = [
      'fps ' + view.fps.toFixed(0) + '  frame ' + view.frameMs.toFixed(1) + 'ms  tier ' + view.tier,
      'bodies ' + view.bodyCount + '  strokes ' + view.strokeCount + '  unlocked ' + view.audioUnlocked,
      s ? ('form ' + s.form + '  degraded ' + s.degraded + '  parts ' + s.parts + '  mass ' + s.mass.toFixed(1)) : 'form -',
      s && s.geo ? ('aspect ' + s.geo.aspect.toFixed(2) + '  area ' + s.geo.area.toFixed(0) + '  w/h ' + s.geo.w.toFixed(0) + '/' + s.geo.h.toFixed(0) + '  closed ' + s.geo.closed + '  nodes ' + s.geo.nodes) : 'geo -',
      'abilities [' + (snap.armedAbilities || []).join(',') + ']  combos ' + (s ? s.combos.join('/') : '-'),
      snap.propPos ? ('prop ' + snap.propPos.x.toFixed(0) + ',' + snap.propPos.y.toFixed(0)) : 'prop -',
      snap.plate && snap.plate.length ? ('plate load ' + snap.plate[0].load.toFixed(1) + '/' + snap.plate[0].threshold + '  hold ' + snap.plate[0].holdMs.toFixed(0) + 'ms') : 'plate -',
      'actor ' + (snap.actorPos ? snap.actorPos.x.toFixed(0) + ',' + snap.actorPos.y.toFixed(0) : '-') + '  fails ' + snap.failStreak,
    ];
    ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = 'rgba(20,18,14,0.78)';
    for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 20, 200 + i * 14);
  }

  // ---- ?impactDebug=1（只报本帧 score 与是否被闸门拦下，不报累计次数）----
  if (view.impactDebug) {
    const d = view.impactDebug;
    ctx.font = '12px ui-monospace,Menlo,Consolas,monospace';
    ctx.fillStyle = d.gated ? 'rgba(150,90,20,0.9)' : 'rgba(30,90,50,0.9)';
    ctx.fillText('impact score ' + d.score.toFixed(3) + '  ' + (d.gated ? 'GATED(' + d.reason + ')' : d.reason), 20, 200 + 8 * 14 + 8);
  }

  ctx.restore();
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
