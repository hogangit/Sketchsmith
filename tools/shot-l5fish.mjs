/**
 * tools/shot-l5fish.mjs —— 关5「河里有条鱼」专属截图（Edge headless + CDP，零 npm 依赖）
 *
 * 专门解决：默认冒烟截图里那条鱼被开场白话气泡挡住、看不清。
 * 这里等气泡自动消失（>2.6s）后再截，确保河里的鱼清晰可见。
 *
 * 产出（覆盖到 dist/，供报名材料包引用）：
 *   dist/gallery-l5.png   关5 全景：左岸小人 + 河中巡游的真鱼 + 对岸高墙
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const VIEW = { width: 430, height: 932, deviceScaleFactor: 2, mobile: true };
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
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-l5-'));
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
  await sleep(400);
  // 跳到关5（下标 4）
  await evalJs('__WCWZ__.view.levelIndex=4; __WCWZ__.retryLevel(); 1');
  // 等开场白话气泡自动消失（默认 2.6s）+ 让鱼游到画面中可见位置
  await sleep(4800);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(ROOT, 'dist', 'gallery-l5.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`[l5fish] → ${out}`);
} finally {
  try { proc.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 150);
}
