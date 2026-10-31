/**
 * tools/probe-form-browser.mjs —— 真浏览器里的形态识别探针
 *
 * 为什么必须有它：node 环境里 matter 拿不到 poly-decomp（`Matter.Common.setDecomp` 没生效），
 * 凹多边形会被 matter 内部退化成凸包 —— **node 探针的结果和真机不是一回事**（实测已踩）。
 * 所以要在 dist/game.html（decomp 齐全）里真跑一遍 produce：按下 materia Analyze → buildCreatureBody。
 *
 * 干什么：把十几种"人真的会这样画"的笔画喂给 __WCWZ__.spawnFromStrokes，
 *        读出 form / degraded / 最终刚体是圆还是多边形，统计"画什么都变圆"的比例。
 *
 * 用法：node tools/probe-form-browser.mjs [关卡下标，默认 3=关4]
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
const levelIdx = Number(process.argv[2] || 3);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 共用的笔画生成器（与 tools/probe-form.mjs 同一批形状，便于 node/浏览器对照）──
const SHAPES = [
  ['水平直线（关4 弹簧板）', 'L', [110, 700, 180, 702]],
  ['斜线', 'L', [120, 700, 190, 730]],
  ['长闭合矩形（当板画）', 'R', [180, 700, 140, 18, 3]],
  ['中等闭合矩形', 'R', [200, 700, 80, 30, 3]],
  ['正方轮廓', 'R', [200, 700, 50, 50, 3]],
  ['正方轮廓（首尾精确重合）', 'R', [200, 700, 50, 50, 0]],
  ['正方轮廓（首尾差 1px）', 'R', [200, 700, 50, 50, 1]],
  ['圆/椭圆轮廓', 'E', [200, 700, 30, 26, 3]],
  ['圆/椭圆（首尾精确重合）', 'E', [200, 700, 30, 26, 0]],
  ['三角轮廓', 'T', [200, 700, 32, 3]],
  ['L 形（开口）', 'L2', [160, 690, 50, 40]],
  ['V 形（开口）', 'V', [200, 700, 40]],
  ['涂鸦来回线', 'S', [200, 700, 90, 50]],
  ['闭合不规则团', 'B', [200, 700, 26, 18]],
  ['星形轮廓', 'STAR', [200, 700, 34]],
];

const genJs = `
window.__GEN__ = {
  L: (x1,y1,x2,y2)=>{const p=[];for(let i=0;i<26;i++){const t=i/25;p.push({x:x1+(x2-x1)*t,y:y1+(y2-y1)*t});}return p;},
  // 沿参数曲线走一圈回到起点的稠密点；gap = 收笔离起点多少 px（0 = 精确回到起点）
  loop: (fn, steps, gap)=>{const p=[];for(let i=0;i<=steps;i++)p.push(fn(i/steps*Math.PI*2));return window.__GEN__.trim(p, gap);},
  // 沿折线走（矩形/三角/星），同样按弧长收尾
  walk: (corners, gap)=>{const p=[];for(let i=0;i<corners.length-1;i++){const[ax,ay]=corners[i],[bx,by]=corners[i+1];
     const n=Math.max(6,Math.round(Math.hypot(bx-ax,by-ay)/5));
     for(let s=0;s<n;s++){const t=s/n;p.push({x:ax+(bx-ax)*t,y:ay+(by-ay)*t});}}p.push({x:corners[corners.length-1][0],y:corners[corners.length-1][1]});return window.__GEN__.trim(p,gap);},
  // 从尾部裁掉点，直到末点距起点 >= gap（gap=0 时原样返回：末点就是起点）
  trim: (p, gap)=>{ if(!gap) return p; const s=p[0];
     for(let i=p.length-1;i>3;i--){ if(Math.hypot(p[i].x-s.x,p[i].y-s.y)>=gap) return p.slice(0,i+1); }
     return p; },
  R: (cx,cy,w,h,gap)=>{const hw=w/2,hh=h/2;return window.__GEN__.walk([[cx-hw,cy-hh],[cx+hw,cy-hh],[cx+hw,cy+hh],[cx-hw,cy+hh],[cx-hw,cy-hh]],gap);},
  E: (cx,cy,rx,ry,gap)=>window.__GEN__.loop((a)=>({x:cx+Math.cos(a)*rx,y:cy+Math.sin(a)*ry}),48,gap),
  T: (cx,cy,r,gap)=>{const cs=[0,1,2,0].map((i)=>{const a=-Math.PI/2+i*Math.PI*2/3;return [cx+Math.cos(a)*r,cy+Math.sin(a)*r];});return window.__GEN__.walk(cs,gap);},
  L2: (x,y,w,h)=>[...__GEN__.L(x,y,x,y+h),...__GEN__.L(x,y+h,x+w,y+h)],
  V: (cx,cy,r)=>[...__GEN__.L(cx-r,cy-r,cx,cy+r),...__GEN__.L(cx,cy+r,cx+r,cy-r)],
  S: (cx,cy,w,h)=>{const p=[];for(let i=0;i<60;i++){const t=i/59;p.push({x:cx-w/2+w*t,y:cy+Math.sin(t*Math.PI*4)*h/2});}return p;},
  B: (cx,cy,rx,ry)=>{const p=[];for(let i=0;i<=30;i++){const a=i/30*Math.PI*2;p.push({x:cx+Math.cos(a)*rx*(1+Math.sin(a*3)*0.18),y:cy+Math.sin(a)*ry*(1+Math.cos(a*4)*0.16)});}return p;},
  STAR:(cx,cy,r)=>{const cs=[];for(let i=0;i<=20;i++){const a=i/20*Math.PI*2;const rr=(i%2?r*0.45:r);cs.push([cx+Math.cos(a)*rr,cy+Math.sin(a)*rr]);}return window.__GEN__.walk(cs,3);},
};
`;

async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('连接 Edge CDP 失败');
}
function makeClient(ws) {
  let seq = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); }
  });
  return { send: (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, 20000);
  }) };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wcwz-form-'));
const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank',
], { stdio: 'ignore' });

try {
  const ws = new WebSocket(await cdpConnect());
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
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
  await sleep(1000);
  await evalJs('try{__WCWZ__.skipIntro();}catch(e){}; 1');
  await evalJs(genJs);
  const hasDecomp = await evalJs('!!(window.Matter && Matter.Common.getDecomp && Matter.Common.getDecomp())');
  console.log(`[probe-form-browser] 关${levelIdx + 1}｜poly-decomp 就绪：${hasDecomp ? '是（与真机一致）' : '否（结果不可信！）'}\n`);
  console.log('笔画'.padEnd(24) + 'form'.padEnd(10) + 'degraded'.padEnd(12) + '刚体');
  console.log('-'.repeat(78));

  let circles = 0;
  const shotArg = process.argv.find((a) => a.startsWith('--shot='));
  for (const [name, kind, args] of SHAPES) {
    await evalJs(`__WCWZ__.view.levelIndex=${levelIdx}; __WCWZ__.retryLevel(); 1`);
    await sleep(320);
    const res = await evalJs(`(()=>{
      const pts = __GEN__.${kind}(${args.map((n) => Number(n)).join(',')});
      __WCWZ__.spawnFromStrokes([{pts}]);
      const c = __WCWZ__.runtime.state.creatures[0];
      if (!c) return JSON.stringify({none:true});
      const b = c.bodies[0];
      return JSON.stringify({form:c.form, degraded:c.degraded, n:c.bodies.length,
        circle: b.circleRadius ? +b.circleRadius.toFixed(1) : 0,
        verts: b.vertices ? b.vertices.length : 0,
        parts: b.parts ? b.parts.length - 1 : 0});
    })()`);
    const o = JSON.parse(res);
    if (o.none) { console.log(name.padEnd(24) + '（没生成：判定为墨点/太小）'); continue; }
    if (o.circle) circles++;
    const body = o.circle ? `圆 r=${o.circle}` : `${o.n}块/${o.verts}顶点${o.parts > 1 ? `(compound ${o.parts})` : ''}`;
    console.log(name.padEnd(24) + String(o.form).padEnd(10) + String(o.degraded).padEnd(12) + body);
    if (shotArg) {
      const k = Number(shotArg.slice(7));
      if (SHAPES[k] && SHAPES[k][0] === name) {
        await sleep(1200);   // 等它掉落到地面再截
        const pos = JSON.parse(await evalJs(`(()=>{const c=__WCWZ__.runtime.state.creatures[0]; if(!c) return '{}';
          const b=c.bodies[0]; return JSON.stringify({x:Math.round(b.position.x), y:Math.round(b.position.y),
            r: b.circleRadius? +b.circleRadius.toFixed(1):0,
            verts: b.vertices? b.vertices.map(v=>[Math.round(v.x),Math.round(v.y)]):[]});})()`));
        console.log(`  ↳ 落点 x=${pos.x} y=${pos.y}` + (pos.r ? ` 圆柱 r=${pos.r}` : ` 多边形顶点 ${JSON.stringify(pos.verts)}`));
        const clipArg = process.argv.find((a) => a.startsWith('--clip='));
        const clip = clipArg ? (() => {
          const [x, y, width, height] = clipArg.slice(7).split(',').map(Number);
          return { x, y, width, height, scale: 5 };
        })() : null;
        const png = await cdp.send('Page.captureScreenshot', clip ? { format: 'png', clip } : { format: 'png' });
        const out = path.join(ROOT, 'dist', clip ? 'probe-form-zoom.png' : 'probe-form-shot.png');
        fs.writeFileSync(out, Buffer.from(png.data, 'base64'));
        console.log(`  ↳ 已存 ${clip ? 'dist/probe-form-zoom.png' : 'dist/probe-form-shot.png'}（${name}）`);
      }
    }
  }
  console.log('-'.repeat(78));
  console.log(`变成完美圆的：${circles}/${SHAPES.length}`);
} finally {
  try { proc.kill(); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 150);
}
