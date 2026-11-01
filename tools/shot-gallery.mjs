/**
 * tools/shot-gallery.mjs —— 参赛画廊专用截图（Edge headless + CDP，零 npm 依赖）
 *
 * 与 shot-level.mjs 的区别：这个脚本会**主动画一笔解法**再截图，
 * 用于生成"解题中/沙盒留物"这类冒烟截图不方便给的画廊图。
 *
 * 产出（覆盖到 dist/，供报名材料包引用）：
 *   dist/gallery-l4.png       关4 弹射板解题中（无「过关」遮罩）
 *   dist/gallery-sandbox.png  沙盒：画多个造物留下，展示"画什么留什么"
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-gal-'));
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

  // 通用：画一笔（线条或圆或方）+ 贴能力
  const absStr = (abs) => (abs || []).map((a) => "__WCWZ__.runtime.setAbility('" + a + "');").join('');
  const drawLine = (x1, y1, x2, y2, abs) => evalJs("(()=>{const pts=[];const n=60;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:" + x1 + "+(" + x2 + "-" + x1 + ")*t,y:" + y1 + "+(" + y2 + "-" + y1 + ")*t});}__WCWZ__.spawnFromStrokes([{pts}]);" + absStr(abs) + "return 1;})()");
  const drawCircle = (cx, cy, r, abs) => evalJs("(()=>{const pts=[];for(let i=0;i<=64;i++){const t=i/64*Math.PI*2;pts.push({x:" + cx + "+Math.cos(t)*" + r + ",y:" + cy + "+Math.sin(t)*" + r + "});}__WCWZ__.spawnFromStrokes([{pts}]);" + absStr(abs) + "return 1;})()");
  const drawSquare = (cx, cy, hw, abs) => evalJs("(()=>{const pts=[];const c=[" + (cx - hw) + "," + (cy - hw) + "," + (cx + hw) + "," + (cy - hw) + "," + (cx + hw) + "," + (cy + hw) + "," + (cx - hw) + "," + (cy + hw) + "," + (cx - hw) + "," + (cy - hw) + "];for(let i=0;i<c.length-1;i+=2){const ax=c[i],ay=c[i+1],bx=c[i+2],by=c[i+3];const n=20;for(let s=0;s<n;s++){const t=s/n;pts.push({x:ax+(bx-ax)*t,y:ay+(by-ay)*t});}}__WCWZ__.spawnFromStrokes([{pts}]);" + absStr(abs) + "return 1;})()");
  const shot = async (name) => {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(ROOT, 'dist', name);
    fs.writeFileSync(out, Buffer.from(s.data, 'base64'));
    console.log(`[gallery] → ${out}`);
  };

  // —— 关1：画梁跨沟解题中（画梁 + 变硬，等 0.9s 抓梁已就位、农夫尚未过关，避开「过关」遮罩）——
  await evalJs('__WCWZ__.view.levelIndex=0; __WCWZ__.retryLevel(); 1');
  await sleep(500);
  await drawLine(148, 700, 352, 703, ['harden']);
  await sleep(900);
  await shot('gallery-l1.png');

  // —— 关4：弹射板解题中（画板 + 变硬 + 怕痒，等 1.1s 抓飞行瞬间，避开「过关」遮罩）——
  await evalJs('__WCWZ__.view.levelIndex=3; __WCWZ__.retryLevel(); 1');
  await sleep(500);
  await drawLine(107, 700, 177, 704, ['harden', 'tickle']);
  await sleep(1100);
  await shot('gallery-l4.png');

  // —— 沙盒：画多个造物留下（圆+硬、方+重、梁+滚）——
  await evalJs('__WCWZ__.view.levelIndex=5; __WCWZ__.retryLevel(); 1');
  await sleep(500);
  await drawCircle(120, 700, 30, ['harden']);
  await sleep(400);
  await drawSquare(215, 700, 26, ['heavy']);
  await sleep(400);
  await drawLine(300, 700, 360, 704, ['roll']);
  await sleep(1600); // 等它们落到地面、在场内留下
  await shot('gallery-sandbox.png');
} finally {
  try { proc.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 150);
}
