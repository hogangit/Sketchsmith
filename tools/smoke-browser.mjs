/**
 * tools/smoke-browser.mjs —— 真浏览器冒烟（Edge headless + CDP，零 npm 依赖）
 *
 * 做什么：
 *   1. 用 file:// 打开 dist/game.html（等价于双击）
 *   2. 收集未捕获异常 / console.error（有就判失败）
 *   3. 430×932 竖屏视口，逐关用「参考解法」在页面里真的画一笔、贴能力，等 rAF 主循环自己跑到过关
 *   4. 截图存 dist/smoke-l1.png … 供人工核对版式
 *
 * 用法：node tools/smoke-browser.mjs [--headful]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const VIEW = { width: 430, height: 932, deviceScaleFactor: 2, mobile: true };
const HEADFUL = process.argv.includes('--headful');

const CASES = [
  { level: 0, name: 'L1 梁+变硬', line: [148, 700, 352, 703], ability: 'harden' },
  { level: 1, name: 'L2 梁+变硬', line: [182, 700, 356, 704], ability: 'harden' },
  { level: 2, name: 'L3 团块+变重', circle: [340, 700, 34], ability: 'heavy' },
  // 关4 弹射主解：弹簧板画在崖前平地（中心 x≈142，落在可绘制窗口 [100,155] 内），点「变硬+怕痒」
  // 小人踩中沿法线被弹起、actor 特例改「向上+朝目标」弹射（D27），抛物线落上高台。
  { level: 3, name: 'L4 弹射板(变硬+怕痒)', line: [107, 700, 177, 704], ability: ['harden', 'tickle'] },
  { level: 4, name: 'L5 跨河长桥+变硬', line: [140, 700, 292, 704], ability: 'harden' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function userDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-edge-'));
}

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
  const events = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, 20000);
  });
  return { send, events };
}

async function main() {
  const dir = userDir();
  const args = [
    HEADFUL ? '--headless=false' : '--headless=new',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank',
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore', detached: false });
  let ws;
  let failures = [];
  try {
    const wsUrl = await cdpConnect();
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = makeClient(ws);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEW);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    const fileUrl = pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href;
    await cdp.send('Page.navigate', { url: fileUrl });
    await sleep(1500);

    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };

    if (await evalJs('typeof window.__WCWZ__') !== 'object') {
      const err = await evalJs('window.__WCWZ_ERROR__ || "未初始化"');
      throw new Error('启动失败：' + err);
    }

    const boot = await evalJs('JSON.stringify({v:__WCWZ__.version, level:__WCWZ__.view.level.title, bookTop:513, h:window.innerHeight, w:window.innerWidth, canvasTop:__WCWZ__.surface.canvas.getBoundingClientRect().top})');
    console.log('[smoke] 启动 OK ' + boot);

    for (const c of CASES) {
      await evalJs(`__WCWZ__.view.levelIndex=${c.level}; __WCWZ__.retryLevel(); 1`);
      await sleep(300);
      const drawExpr = c.circle
        ? `(()=>{const pts=[];const[rx,ry,r]=[${c.circle[0]},${c.circle[1]},${c.circle[2]}];for(let i=0;i<=64;i++){const t=i/64*Math.PI*2*0.96-Math.PI*0.25;pts.push({x:rx+Math.cos(t)*r*(1+Math.sin(i*1.9)*0.012),y:ry+Math.sin(t)*r});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`
        : `(()=>{const pts=[];const[x1,y1,x2,y2]=[${c.line[0]},${c.line[1]},${c.line[2]},${c.line[3]}];const n=60;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:x1+(x2-x1)*t+Math.sin(i*1.7)*0.7,y:y1+(y2-y1)*t+Math.cos(i*2.3)*0.7});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`;
      await evalJs(drawExpr);
      await sleep(200);
      // 支持多枚能力：关4 弹射板是「变硬 + 怕痒」两枚相乘才成立（认知变量=配对）
      const abs = Array.isArray(c.ability) ? c.ability : [c.ability];
      for (const a of abs) await evalJs(`__WCWZ__.runtime.setAbility('${a}'); 1`);
      let status = 'playing';
      let elapsed = 0;
      for (let i = 0; i < 60; i++) {
        await sleep(250); elapsed += 250;
        const st = await evalJs('JSON.stringify({s:__WCWZ__.view.snapshot.status, f:__WCWZ__.view.snapshot.creature?__WCWZ__.view.snapshot.creature.form:null, d:__WCWZ__.view.snapshot.creature?__WCWZ__.view.snapshot.creature.degraded:null})');
        const o = JSON.parse(st);
        status = o.s;
        if (status === 'finished') { console.log(`[smoke] ${c.name} → 过关（${(elapsed / 1000).toFixed(1)}s, form=${o.f}, degraded=${o.d}）`); break; }
      }
      if (status !== 'finished') {
        failures.push(`${c.name} 未过关（卡在 ${status}）`);
        const dbg = await evalJs('JSON.stringify(__WCWZ__.view.snapshot)');
        console.log('[smoke] 失败快照 ' + dbg.slice(0, 400));
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ROOT, 'dist', `smoke-l${c.level + 1}.png`), Buffer.from(shot.data, 'base64'));
      // 点一下继续（过关覆盖层）
      await evalJs('__WCWZ__.view.winAt=0; __WCWZ__.nextLevel(); 1');
    }

    const errs = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
    if (errs.length) {
      failures.push('页面报错 ' + errs.length + ' 条');
      for (const e of errs.slice(0, 5)) console.log('[smoke] ERROR ' + JSON.stringify(e.params).slice(0, 300));
    } else {
      console.log('[smoke] 无未捕获异常 / 无 console.error');
    }
  } finally {
    try { ws && ws.close(); } catch (e) { /* noop */ }
    try { proc.kill(); } catch (e) { /* noop */ }
  }
  if (failures.length) {
    console.log('\n[smoke] 失败：\n - ' + failures.join('\n - '));
    process.exitCode = 1;
    return;
  }
  console.log('\n[smoke] 全部通过：三关各自用参考解法真的走通，430×932 竖屏截图已存 dist/');
}

main().catch((e) => { console.error('[smoke] 异常：' + e.message); process.exitCode = 1; });
