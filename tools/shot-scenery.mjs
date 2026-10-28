/**
 * tools/shot-scenery.mjs —— 截取 L1/L2/L3 的「初始画面」（不解题、无过关遮罩），
 * 供人工核对 art-polish 第四章逐关布景（草垛/布幡/木桩/水塘/芦苇/涟漪/锈迹/裂纹）。
 * 用法：node tools/shot-scenery.mjs → dist/shot-l1.png / shot-l2.png / shot-l3.png
 */
import { spawn } from 'node:child_process';
import { accessSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const c of [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ]) { try { accessSync(c); return c; } catch (e) { /* next */ } }
  throw new Error('未找到 Edge/Chrome');
}

async function main() {
  const proc = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    '--window-size=430,932', '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });

  try {
    let wsUrl = null;
    for (let i = 0; i < 40 && !wsUrl; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        const page = (await r.json()).find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
      } catch (e) { await sleep(250); }
    }
    if (!wsUrl) throw new Error('CDP 端口未就绪');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r.result && r.result.result ? r.result.result.value : null;
    };
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });

    const fileUrl = pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href + '?skipIntro=1';
    await send('Page.navigate', { url: fileUrl });
    await sleep(1300);

    for (const idx of [0, 1, 2]) {
      if (idx > 0) {
        await evalJs(`__WCWZ__.view.levelIndex=${idx}; __WCWZ__.retryLevel(); 1`);
        await sleep(700);
      }
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const out = path.join(ROOT, 'dist', `shot-l${idx + 1}.png`);
      writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      const info = await evalJs('JSON.stringify({t:__WCWZ__.view.level.title, bodies:__WCWZ__.view.bodyCount})');
      console.log(`[shot] L${idx + 1} ${info} → ${out}`);
    }
    ws.close();
  } finally {
    proc.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
