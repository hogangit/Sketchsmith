/**
 * tools/shot-level.mjs —— 单关截图（Edge headless + CDP，零 npm 依赖）
 *
 * 干什么：打开 dist/game.html，跳过扉页，跳到指定关，等它静止后截一张图到 dist/shot-lN.png。
 * 用途：改绘制（鱼的形状、南瓜的形状、场景构件）后**人工核对版式**——冒烟只验"能不能过"，
 *      验不了"看起来像不像"。比反复启动整条冒烟快得多。
 *
 * 用法：node tools/shot-level.mjs <关卡下标 0..4> [等待毫秒，默认 1600] [--clip=x,y,w,h]
 *       node tools/shot-level.mjs 1        → dist/shot-l2.png（关2 南瓜）
 *       node tools/shot-level.mjs 1 1800 --clip=150,195,280,120  → 局部放大（看细节）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
const VIEW = { width: 430, height: 932, deviceScaleFactor: 2, mobile: true };

const clipArg = process.argv.find((a) => a.startsWith('--clip='));
const CLIP = clipArg ? (() => {
  const [x, y, width, height] = clipArg.slice(7).split(',').map(Number);
  return { x, y, width, height, scale: 4 };
})() : null;
const idx = Number(process.argv[2] || 0);
const wait = Number(process.argv[3] || 1600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('连接 Edge CDP 失败');
}

function makeClient(ws) {
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, 20000);
  });
  return { send };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-shot-'));
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank',
], { stdio: 'ignore' });

try {
  const ws = new WebSocket(await cdpConnect());
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = makeClient(ws);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', VIEW);

  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };

  await cdp.send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href });
  await sleep(900);
  await evalJs('try{__WCWZ__.skipIntro();}catch(e){}; 1');
  await sleep(460);
  await evalJs(`__WCWZ__.view.levelIndex=${idx}; __WCWZ__.retryLevel(); 1`);
  await sleep(wait);

  const shot = await cdp.send('Page.captureScreenshot', CLIP ? { format: 'png', clip: CLIP } : { format: 'png' });
  const out = path.join(ROOT, 'dist', CLIP ? `zoom-l${idx + 1}.png` : `shot-l${idx + 1}.png`);
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[shot] 关${idx + 1} → ${out}`);
} finally {
  try { proc.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 150);
}
