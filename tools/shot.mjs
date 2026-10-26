/**
 * tools/shot.mjs —— 单帧取证：开 ?debug=1，等 N 毫秒后截一张 430×932 的图，并打印关键读数。
 * 用法：node tools/shot.mjs [等待毫秒] [输出名]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const waitMs = Number(process.argv[2] || 3000);
const outName = process.argv[3] || 'shot-debug.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-shot-'))}`, 'about:blank'], { stdio: 'ignore' });

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
  const clean = process.argv.includes('clean');   // 不带 ?debug=1：给评审做"3 秒读图"用
  await send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href + (clean ? '' : '?debug=1') });
  await sleep(waitMs);
  const r = await send('Runtime.evaluate', {
    expression: `(()=>{const sf=__WCWZ__.surface;const m=sf.metrics();const ctx=sf.ctx;
      const px=(dx,dy)=>{const X=Math.round(dx*m.dprScale+m.dpr*m.offX);const Y=Math.round(dy*m.dprScale+m.dpr*m.offY);const d=ctx.getImageData(X,Y,1,1).data;return d[0]+','+d[1]+','+d[2];};
      return JSON.stringify({m,px_200_520:px(200,520),px_200_700:px(200,700),px_200_860:px(200,860),px_200_900:px(200,900),px_200_928:px(200,928)});})()`,
    returnByValue: true,
  });
  console.log('[shot] ' + r.result.value);
  // 第 4 个参数给 clip 时，只截底部 700..932 并放大 2 倍（看死区/纸面用）
  const wantClip = process.argv[4] === 'clip';
  const shot = await send('Page.captureScreenshot', wantClip
    ? { format: 'png', clip: { x: 0, y: 700, width: 430, height: 232, scale: 2 } }
    : { format: 'png' });
  fs.writeFileSync(path.join(ROOT, 'dist', outName), Buffer.from(shot.data, 'base64'));
  console.log('[shot] 已存 dist/' + outName + (wantClip ? '（底部 700..932 放大 2x）' : ''));
} finally {
  try { ws && ws.close(); } catch (e) { /* noop */ }
  try { proc.kill(); } catch (e) { /* noop */ }
}
