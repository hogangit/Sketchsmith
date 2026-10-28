/**
 * tools/perf-probe.mjs —— 分档帧率压测（Edge headless，桌面参考值）
 *
 * 背景：README 自陈「性能降级只做了绑定，没有压测证据」。真机不在手上，
 * 但至少要给出：(1) 三档在**同一台机器同一场景**下的帧时间对比；(2) 降档路径
 * 真实生效（setTier 之后 perf.tier 确实变了、渲染开关确实切了）。
 *
 * 方法：进沙盒（场景最自由、天然无 goal 不会被过关打断）→ 画 3 个造物 →
 * 每个 tier 各采 180 帧 rAF 间隔 → p50 / p90 / p99。
 * headless 桌面值**不代表真机**，只证明降档有序生效。
 *
 * 用法：node tools/perf-probe.mjs
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    } else if (msg.method) events.push(msg);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-perf-'));
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let ws = null;
  const failures = [];
  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page && page.webSocketDebuggerUrl) wsUrl = page.webSocketDebuggerUrl;
      } catch (e) { /* 还没起来 */ }
      if (!wsUrl) await sleep(250);
    }
    if (!wsUrl) throw new Error('连接 Edge CDP 失败');
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const cdp = makeClient(ws);
    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
      return r.result.value;
    };

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEW);
    await cdp.send('Page.navigate', { url: pathToFileURL(path.join(ROOT, 'dist', 'game.html')).href + '?skipIntro=1' });
    await sleep(1100);
    await evalJs('try{__WCWZ__.skipIntro();}catch(e){}; 1');
    await sleep(400);

    // 进沙盒：场景最自由，且天然没有 goal（不会被过关打断采样）
    await evalJs('__WCWZ__.view.levelIndex=5; __WCWZ__.retryLevel(); 1');
    await sleep(500);
    // 画 3 个造物，让画面里有真实内容
    for (const [x1, x2] of [[100, 200], [210, 300], [310, 400]]) {
      await evalJs(`(()=>{const pts=[];const n=50;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:${x1}+(${x2}-${x1})*t+Math.sin(i*1.7)*0.7,y:700+(i%2?2:-2)});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`);
      await sleep(120);
    }
    await sleep(700);   // 等造物落定，采样不被落地冲击污染

    // 页面内自计时：rAF 间隔就是浏览器送来的帧间隔（掉了帧立刻体现在 dt 上）
    const sample = () => evalJs(`new Promise((res)=>{
      const dts=[]; let last=performance.now(); let n=0;
      const tick=()=>{const now=performance.now(); dts.push(now-last); last=now;
        if(++n<180) requestAnimationFrame(tick); else {
          const s=[...dts].sort((a,b)=>a-b);
          const p=(q)=>Math.round(s[Math.min(s.length-1,Math.floor(s.length*q))]*10)/10;
          res(JSON.stringify({p50:p(0.5),p90:p(0.9),p99:p(0.99),max:Math.round(s[s.length-1])}));
        }};
      requestAnimationFrame(tick);})`);

    const rows = {};
    for (const tier of ['high', 'mid', 'low']) {
      await evalJs(`__WCWZ__.perf.setTier('${tier}'); 1`);
      await sleep(300);   // 等静态层按新档重烘焙
      const q = await evalJs('JSON.stringify({f:__WCWZ__.quality.fill,s:__WCWZ__.quality.shadow,t:__WCWZ__.perf.tier})');
      const qv = JSON.parse(q);
      const expect = tier === 'high' ? { f: true, s: true } : tier === 'mid' ? { f: true, s: false } : { f: false, s: false };
      if (qv.t !== tier || qv.f !== expect.f || qv.s !== expect.s) {
        failures.push(`setTier('${tier}') 未生效：quality=${q}`);
      }
      rows[tier] = JSON.parse(await sample());
    }

    console.log('\n[perf] 分档帧时间（ms，180 帧采样，沙盒 3 造物，headless 桌面参考值——不代表真机）');
    console.log('  tier   p50     p90     p99     max');
    for (const t of ['high', 'mid', 'low']) {
      const r = rows[t];
      console.log(`  ${t.padEnd(6)} ${String(r.p50).padEnd(7)} ${String(r.p90).padEnd(7)} ${String(r.p99).padEnd(7)} ${r.max}`);
    }

    // 有序性 sanity：降档是"少画东西"，low 的 p50 不应明显差于 high
    if (rows.low.p50 > rows.high.p50 * 1.5 + 2) {
      failures.push(`low 档 p50(${rows.low.p50}) 反而比 high(${rows.high.p50}) 差 50%+ —— 查 RenderQuality 开关是否真被渲染端消费`);
    }
  } finally {
    try { ws && ws.close(); } catch (e) { /* noop */ }
    try { proc.kill(); } catch (e) { /* noop */ }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }
  if (failures.length) {
    console.log('\n[perf] 失败：\n - ' + failures.join('\n - '));
    process.exitCode = 1;
    return;
  }
  console.log('\n[perf] 通过：三档帧时间已采出，setTier 生效且帧时间有序');
}

main().catch((e) => { console.error('[perf] 异常：' + e.message); process.exitCode = 1; });
