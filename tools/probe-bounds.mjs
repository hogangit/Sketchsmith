/**
 * tools/probe-bounds.mjs —— 内容边界实测（不再用 canvas 尺寸自证）
 *
 * 量的是**实际画到屏幕上的墨迹**：把整张画布 getImageData 下来，逐 design 行统计
 * 「与纸色不同的像素数」，找最后一行有内容的 y、以及 ≥N px 的连续空带。
 *
 * 输出三行（评审要求的格式）：
 *   sceneRect    {x,y,w,h} → bottom
 *   notebookRect {x,y,w,h} → bottom
 *   canvasH
 * 再输出 ink 统计：
 *   lastInkY / lastRuledY / gaps[]
 *
 * 用法：node tools/probe-bounds.mjs [等待毫秒]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const waitMs = Number(process.argv[2] || 2500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-bounds-'))}`, 'about:blank'], { stdio: 'ignore' });

const EXPR = `(() => {
  const sf = __WCWZ__.surface;
  const m = sf.metrics();
  const c = sf.canvas;
  const ctx = sf.ctx;
  const W = c.width, H = c.height;
  const img = ctx.getImageData(0, 0, W, H).data;
  const PAPER = [246, 241, 227];
  const dif = (i, ref) => Math.max(
    Math.abs(img[i] - ref[0]), Math.abs(img[i + 1] - ref[1]), Math.abs(img[i + 2] - ref[2]));
  const rowHas = (devRow) => {
    let n = 0;
    for (let x = 0; x < W; x += 2) if (dif((devRow * W + x) * 4, PAPER) > 8) n++;
    return n;
  };
  // design 行 -> device 行
  const d2r = (dy) => Math.round(dy * m.dprScale + m.dpr * m.offY);
  const rows = [];
  const profiles = [];
  for (let dy = 0; dy < 932; dy++) {
    const r0 = d2r(dy), r1 = d2r(dy + 1);
    let best = 0;
    for (let r = r0; r < Math.max(r0 + 1, r1); r++) if (r >= 0 && r < H) best = Math.max(best, rowHas(r));
    rows[dy] = best;
  }
  // 逐 design 行取「与纸色不同的像素数」，找出空带
  let lastInk = -1;
  for (let dy = 0; dy < 932; dy++) if (rows[dy] > 6) lastInk = dy;
  let lastRuled = -1;   // 横贯全宽的墨迹（纸面横线）
  for (let dy = 0; dy < 932; dy++) if (rows[dy] > 120) lastRuled = dy;
  const gaps = [];
  let run = 0, start = 0;
  const GAP_MIN = 34;   // 格线名义间距 22px，超过 1.5 倍才算真空带
  for (let dy = 96; dy < 932; dy++) {
    if (rows[dy] <= 6) { if (run === 0) start = dy; run++; }
    else { if (run >= GAP_MIN) gaps.push([start, dy - 1, run]); run = 0; }
  }
  if (run >= GAP_MIN) gaps.push([start, 931, run]);
  for (let dy = 780; dy < 932; dy += 6) profiles.push([dy, rows[dy]]);
  // 每个 100px 带的墨迹密度（不同行的墨迹像素总数），用来看下半页是否和上半页同密度
  const bands = [];
  for (let y0 = 96; y0 < 932; y0 += 100) {
    let sum = 0;
    for (let dy = y0; dy < Math.min(932, y0 + 100); dy++) sum += rows[dy];
    bands.push([y0 + '-' + Math.min(932, y0 + 100), sum]);
  }
  return JSON.stringify({
    sceneRect: m.sceneRect, sceneBottom: m.sceneRect.y + m.sceneRect.h,
    notebookRect: m.notebookRect, notebookBottom: m.notebookRect.y + m.notebookRect.h,
    notebookBottomCss: Math.round(m.notebookBottomCss),
    canvasH: m.cssH, designH: 932, dpr: m.dpr, scale: m.scale, offY: m.offY,
    lastInk, lastRuled, gaps, profiles, bands,
  });
})()`;

const lines = [];
let ws;
try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) wsUrl = p.webSocketDebuggerUrl;
    } catch (e) { /* 等 */ }
    if (!wsUrl) await sleep(250);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href });
  await sleep(waitMs);
  const r = await send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
  const d = JSON.parse(r.result.value);

  const rect = (o) => `{x:${o.x}, y:${o.y}, w:${o.w}, h:${o.h}} → bottom ${o.y + o.h}`;
  lines.push('sceneRect     ' + rect(d.sceneRect));
  lines.push('notebookRect  ' + rect(d.notebookRect));
  lines.push('canvasH       ' + d.canvasH + '  (design 932, dpr ' + d.dpr + ', scale ' + d.scale.toFixed(3) + ', offY ' + d.offY.toFixed(1) + ')');
  lines.push('');
  lines.push('notebookRect.bottom === 932 ± 1 ?  ' + (Math.abs(d.notebookBottom - 932) <= 1 ? 'YES' : 'NO') + '  (' + d.notebookBottom + ')');
  lines.push('notebook 底边在 CSS 像素上的位置: ' + d.notebookBottomCss + ' / cssH ' + d.canvasH);
  lines.push('');
  lines.push('墨迹实测（design 行，取与纸色差值 >8 的像素数）：');
  lines.push('  lastInk   y = ' + d.lastInk + '   ← 画面最下面一个有内容的行');
  lines.push('  lastRuled y = ' + d.lastRuled + '   ← 最后一根横贯整宽的纸面横线');
  lines.push('  空带（>34px 且该行墨迹像素 ≤6，格线间距 22px 属正常）：' + (d.gaps.length ? JSON.stringify(d.gaps) : '无'));
  lines.push('  每 100px 带的墨迹量：' + d.bands.map((b) => b[0] + '=' + b[1]).join('  '));
  lines.push('  y=780..930 每 6px 的墨迹像素数：' + d.profiles.map((p) => p[0] + ':' + p[1]).join(' '));
  console.log(lines.join('\n'));
  fs.writeFileSync(path.join(ROOT, 'dist', 'bounds.txt'), lines.join('\n'), 'utf8');
} finally {
  try { ws && ws.close(); } catch (e) { /* noop */ }
  try { proc.kill(); } catch (e) { /* noop */ }
}
