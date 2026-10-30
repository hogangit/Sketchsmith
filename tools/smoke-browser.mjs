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
  // D32：关2 悬空量收到 21px 后，跨整条沟的长梁（182→356）不再扫到南瓜（t=9 实测 timeout）。
  // 改用「短梁架在悬空带右上方」的画法：206→300、t=9 实测稳过（tools/probe-l2-beam.mjs）。
  { level: 1, name: 'L2 梁+变硬', line: [206, 700, 300, 704], ability: 'harden' },
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
    await sleep(900);

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

    // 扉页截图：900ms 时还在静止展示段（1250ms 后才开始淡出），截到的是完整封面
    const coverShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'dist', 'smoke-title.png'), Buffer.from(coverShot.data, 'base64'));

    // 后续是玩法测试，不测扉页：跳过它，否则前 1.6s 物理被冻结，会拖长每关计时
    await evalJs('try{__WCWZ__.skipIntro();}catch(e){}; 1');
    await sleep(460);   // 等淡出走完，关卡截图不带遮罩

    // 「关于/许可」浮层：用真实鼠标事件点按钮，验证命中区与开关都成立
    // （直接改 view.about 是假验证——那只证明字段能赋值，不证明按钮点得到）
    const click = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    };
    const unlockedBeforeAbout = await evalJs('__WCWZ__.view.audioUnlocked');
    await click(305, 71);   // HUD「关于」按钮（x=280..330, y=54..88 的中心）
    await sleep(300);
    // 首次真实 pointerdown（mouse→pointerdown）必须在**同步路径**里解锁音频：这是 iOS 唯一合法的解锁时机。
    // headless 能验「解锁真的在手势里发生」；Safari 实机行为仍需另测（见 README 未验证项）。
    if (await evalJs('__WCWZ__.view.audioUnlocked') !== true) failures.push('首次真实 pointerdown 后音频仍未解锁（同步 unlockMedia 路径失效）');
    else console.log(`[smoke] 首次真实手势解锁：audioUnlocked ${unlockedBeforeAbout} → true ✔（iOS 同步路径结构正确，Safari 实机另测）`);
    if (await evalJs('__WCWZ__.view.about === true') !== true) {
      failures.push('「关于」按钮点击未命中（view.about 仍为 false）');
    } else {
      const aboutShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(ROOT, 'dist', 'smoke-about.png'), Buffer.from(aboutShot.data, 'base64'));
      // 声音风格芯片：点第 2 枚（八音盒）→ 主题切换 + 持久化，且面板不关
      await click(213, 565);
      await sleep(200);
      const th = JSON.parse(await evalJs(`JSON.stringify({about:__WCWZ__.view.about, t:__WCWZ__.view.soundTheme, ls:(typeof localStorage!=='undefined')?localStorage.getItem('wcwz_sound_theme'):null})`));
      if (th.about !== true) failures.push('点声音风格芯片时面板被误关（应保持打开）');
      if (th.t !== 'musicbox' || th.ls !== 'musicbox') failures.push(`声音风格切换/持久化失败（view=${th.t}, ls=${th.ls}）`);
      else console.log('[smoke] 声音风格 → 点「八音盒」切换并持久化 OK（面板不关）');
      // 语音朗读开关（用户投诉"说话的语音难听"后新增的出口）：必须点得到、状态落盘
      const vc0 = JSON.parse(await evalJs(`JSON.stringify({n:__WCWZ__.view.voiceCount, on:__WCWZ__.view.voiceOn, name:__WCWZ__.view.voiceName})`));
      await click(100, 623);   // 「语音」开/关（x 74..126, y 608..638 的中心）
      await sleep(200);
      const vo = JSON.parse(await evalJs(`JSON.stringify({about:__WCWZ__.view.about, on:__WCWZ__.view.voiceOn, ls:(typeof localStorage!=='undefined')?localStorage.getItem('wcwz_voice_on'):null})`));
      if (vo.about !== true) failures.push('点语音开关时面板被误关（应保持打开）');
      if (vo.on === vc0.on) failures.push(`语音开关点下去状态没变（一直是 ${vc0.on}）`);
      if (vo.ls !== (vo.on ? '1' : '0')) failures.push(`语音开关未落盘（on=${vo.on}, ls=${vo.ls}）`);
      else console.log(`[smoke] 语音 → ${vc0.n} 个中文音色，默认「${vc0.name || '无'}」，开关可点并落盘 ✔`);
      await click(100, 623);   // 再点回来：别把"关闭朗读"的状态带进后面的关卡
      await sleep(160);
      if (await evalJs('__WCWZ__.view.voiceOn') !== vc0.on) failures.push('语音开关点回原状态失败');
      await click(215, 420);   // 卡片内部任意处
      await sleep(220);
      if (await evalJs('__WCWZ__.view.about === false') !== true) failures.push('「关于」浮层点击后未关闭');
      else console.log('[smoke] 关于/许可浮层 → 打开 + 任点关闭 OK');
    }
    // 扉页把开场句的播放时机推后了（原本 build 后 240ms 就说），必须证明它没被吞：
    // 判据是「气泡真的出现了且非空」，不是「setTimeout 被调用过」。
    const bub = await evalJs('JSON.stringify(__WCWZ__.view.bubble||null)');
    if (!bub || bub === 'null' || !JSON.parse(bub).text) {
      failures.push('扉页落下后开场句未出现（view.bubble 为空）');
    } else {
      console.log('[smoke] 扉页落下后开场句 → ' + JSON.parse(bub).text);
    }

    // ── 真实 pointer 手势冒烟 ───────────────────────────────────────────────
    // 此前所有用例都走 __WCWZ__.spawnFromStrokes()，**绕过了 pointer 采样层**（README 曾列为未验证项）。
    // 这里用 CDP 派发真实 touch 事件（已开 touch emulation），走完整条
    //   canvasEl.pointerdown → capture.begin/move/end → 700ms 归组 → commit → spawnFromStrokes → 造物
    // 链路。能验的是「链路正确性 + 采样门禁 + 场景区不误画」，主观手感仍需真人。
    await evalJs('__WCWZ__.view.levelIndex=0; __WCWZ__.retryLevel(); 1');
    await sleep(300);
    // 包装 bus.emit 记录本段真实产生的事件（末尾还原，避免污染后续用例）
    await evalJs(`(()=>{const b=__WCWZ__.bus;window.__origEmit=b.emit.bind(b);window.__ev=[];b.emit=(e,p)=>{window.__ev.push([e,p]);return window.__origEmit(e,p);};return 1;})()`);
    const touch = async (type, pts) => {
      await cdp.send('Input.dispatchTouchEvent', {
        type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: 1, radiusX: 2, radiusY: 2, force: 0.5 })),
      });
    };

    // T2：场景区（y<BOOK_TOP）落笔必须**不**进入绘制（inBook 门禁），也不生成造物。
    // 先做 T2：此时 view.win=false，不会被「过关覆盖层」吞掉这次点击。
    await touch('touchStart', [{ x: 200, y: 300 }]);
    await touch('touchMove', [{ x: 240, y: 305 }]);
    await touch('touchEnd', []);
    await sleep(300);
    const t2 = JSON.parse(await evalJs('JSON.stringify({ev:window.__ev.map(e=>e[0]), n:__WCWZ__.runtime.creatures.length})'));
    if (t2.ev.includes('stroke:begin')) failures.push('场景区落笔误触发了 stroke:begin（inBook 门禁失效）');
    else if (t2.n !== 0) failures.push('场景区落笔误生成了造物（n=' + t2.n + '）');
    else console.log('[smoke] 真实手势 T2：场景区落笔不进入绘制、不生成造物 ✔');

    // T1：造物簿真实画一笔长横线；序列里夹杂「距上一点 <2px」的微抖点，验证 SAMPLE_MIN_DIST 门禁。
    await evalJs('window.__ev=[]; 1');
    const stroke = [{ x: 150, y: 700 }];
    for (let x = 160; x <= 350; x += 10) {
      stroke.push({ x, y: 700 + Math.sin(x) * 0.3 });          // 主点，间距 10px ≥2 → 记录
      stroke.push({ x: x + 0.6, y: 700 + Math.sin(x) * 0.3 });  // 微抖，距主点 0.6px <2 → 丢弃
    }
    await touch('touchStart', [stroke[0]]);
    for (let i = 1; i < stroke.length; i++) await touch('touchMove', [stroke[i]]);
    await touch('touchEnd', []);
    await sleep(120);   // <700ms 归组窗口：strokes 尚未 commit，可读 capture.pointCount
    const live = JSON.parse(await evalJs('JSON.stringify({pc:__WCWZ__.capture.pointCount, unlocked:__WCWZ__.view.audioUnlocked})'));
    if (!(live.pc > 2)) failures.push('真实手势采样点数过少（pc=' + live.pc + '）——pointer 链路没采到点');
    else if (!(live.pc < stroke.length)) failures.push('采样门禁失效：<2px 微抖点没被丢弃（pc=' + live.pc + ', 派发=' + stroke.length + '）');
    else console.log(`[smoke] 真实手势 T1-a：pointerdown 解锁=${live.unlocked} / 采样 ${stroke.length}→${live.pc} 点（2px 门禁生效）✔`);
    await sleep(850);   // >700ms 归组窗口：commit 已发生、造物已生成
    const t1 = JSON.parse(await evalJs(`JSON.stringify({ev:window.__ev.map(e=>e[0]), commit:(window.__ev.find(e=>e[0]==='stroke:commit')||[null,{}])[1], n:__WCWZ__.runtime.creatures.length, form:__WCWZ__.view.snapshot.creature?__WCWZ__.view.snapshot.creature.form:null})`));
    if (!t1.ev.includes('stroke:begin')) failures.push('真实手势未发出 stroke:begin');
    else if (!t1.ev.includes('stroke:end')) failures.push('真实手势未发出 stroke:end');
    else if (!t1.ev.includes('stroke:commit')) failures.push('真实手势未发出 stroke:commit（多笔归组/提交没接线）');
    else if (t1.n < 1) failures.push('真实手势画完却没生成造物（n=' + t1.n + '）');
    else console.log(`[smoke] 真实手势 T1-b：事件链 begin→end→commit 完整 / commit.points=${t1.commit.points} / 造物 ${t1.n} 个 form=${t1.form} ✔`);
    // 加分诊断：真实手势画出的造物贴「变硬」后能否通关关1（不强求，如实报告，形状受真实采样影响）
    await evalJs(`__WCWZ__.runtime.setAbility('harden'); 1`);
    let ptrWin = false;
    for (let i = 0; i < 24; i++) { await sleep(250); if (await evalJs('__WCWZ__.view.snapshot.status') === 'finished') { ptrWin = true; break; } }
    console.log(`[smoke] 真实手势 T1-c：贴「变硬」后 ${ptrWin ? '关1 真实通关 ✔' : '未通关（真实采样形状/落点差异，仅记录不判失败）'}`);
    await evalJs('__WCWZ__.bus.emit=window.__origEmit; 1');   // 还原，避免污染后续用例

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

    // ── 回归：过关覆盖层上点「重来」必须留在本关，不得跳下一关（用户实测 bug）──
    // 根因：view.win 为真时 handleUiTap 的 win 分支吞掉所有点击 → nextLevel()，
    // 而头部「重来」按钮在覆盖层下半透明可见，点它等于点了「继续」。
    // D32 备注：用例改用**关1**。关2 悬空量收到 21px 后，用合成笔画（无手势抖动）画梁
    // 落点不可控（实测只把南瓜推了 3px），会让这条 UI 回归被物理随机性搞挂；
    // 而"过关后点重来"是关卡无关的 UI 行为，关1 的梁 3.5s 稳定过关。
    {
      await evalJs('__WCWZ__.view.levelIndex=0; __WCWZ__.retryLevel(); 1');   // 第 1 关
      await sleep(200);
      await evalJs(`(()=>{const pts=[];const[x1,y1,x2,y2]=[148,700,352,703];const n=60;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:x1+(x2-x1)*t,y:y1+(y2-y1)*t});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`);
      await evalJs(`__WCWZ__.runtime.setAbility('harden'); 1`);
      let won = false;
      for (let i = 0; i < 24; i++) { await sleep(250); if (await evalJs('__WCWZ__.view.win') === true) { won = true; break; } }
      if (!won) {
        const diag = await evalJs(`JSON.stringify({idx:__WCWZ__.view.levelIndex, win:__WCWZ__.view.win, id:__WCWZ__.view.level && __WCWZ__.view.level.id, creatures:(__WCWZ__.runtime?__WCWZ__.runtime.creatures.length:-1), prop:(function(){try{const r=__WCWZ__.runtime;const p=r.state.props[r.state.activeProp];return [Math.round(p.position.x),Math.round(p.position.y)];}catch(e){return 'n/a';}})()})`);
        failures.push('重来回归用例未能过关（进不了 win 覆盖层，用例失效） ' + diag);
      } else {
        await sleep(700);   // 越过 winAt 的 600ms 保护窗
        const idxBefore = await evalJs('__WCWZ__.view.levelIndex');
        await click(357, 71);   // 头部「重来」按钮中心（x∈(334,380), y∈[52,92]）
        await sleep(320);
        const after = JSON.parse(await evalJs('JSON.stringify({idx:__WCWZ__.view.levelIndex, win:__WCWZ__.view.win})'));
        if (after.idx !== idxBefore) failures.push(`过关后点「重来」跳关了：levelIndex ${idxBefore} → ${after.idx}（应保持不变）`);
        else if (after.win !== false) failures.push('过关后点「重来」未清掉 win 覆盖层');
        else console.log(`[smoke] 过关后点「重来」→ 留在第 ${idxBefore + 1} 关、覆盖层已清（未跳关）✔`);
      }
    }

    // ── 沙盒「造物园」：真浏览器里也要能进、能画、不误判、能接回旧造物 ──
    // 判据同 tests/sandbox-acceptance.mjs，但那是 node 侧；这里补"页面真的会发生"。
    // 顺便拦 chapter 音：进沙盒＝换玩法模式，必须响一次「章节切换」。
    await evalJs(`(()=>{const a=__WCWZ__.audio;const o=a.play.bind(a);window.__sfx=[];a.play=(id,op)=>{window.__sfx.push(id);return o(id,op);};return 1;})()`);
    await evalJs('__WCWZ__.view.levelIndex=5; __WCWZ__.retryLevel(); 1');
    await sleep(400);
    const sfx = JSON.parse(await evalJs('JSON.stringify(window.__sfx||[])'));
    if (!sfx.includes('chapter')) failures.push(`进沙盒没响 chapter 音（实际播了：${sfx.join(',') || '（无）'}）`);
    else console.log(`[smoke] 进沙盒响 chapter 音 ✔（本次拦截到的音效：${sfx.join(',')}）`);
    if (await evalJs('__WCWZ__.view.level.id') !== 'sandbox') failures.push('未能进入沙盒（level.id 不是 sandbox）');
    await evalJs(`(()=>{const pts=[];const[x1,y1,x2,y2]=[150,700,280,704];const n=60;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:x1+(x2-x1)*t+Math.sin(i*1.7)*0.7,y:y1+(y2-y1)*t+Math.cos(i*2.3)*0.7});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`);
    await sleep(900);
    const sb = await evalJs('JSON.stringify({n:__WCWZ__.runtime.creatures.length, s:__WCWZ__.view.snapshot.status, w:__WCWZ__.view.win, saved:(__WCWZ__.store.read("wcwz:sandbox:v1")||{creatures:[]}).creatures.length})');
    const sbv = JSON.parse(sb);
    if (sbv.n < 1) failures.push('沙盒里画了一笔却没有造物（creatures=' + sbv.n + '）');
    if (sbv.w !== false) failures.push('沙盒误判通关（view.win=' + sbv.w + '）——沙盒没有"赢"');
    if (sbv.saved < 1) failures.push('沙盒造物没有落盘（saved=' + sbv.saved + '）——持久化没接线');
    // 重进沙盒：存档里的造物必须被**复原成实体**，不是只显示个数
    await evalJs('__WCWZ__.retryLevel(); 1');
    await sleep(900);
    const sb2 = await evalJs('JSON.stringify({n:__WCWZ__.runtime.creatures.length, rec:(__WCWZ__.store.read("wcwz:sandbox:v1")||{creatures:[]}).creatures.map(c=>({f:c.form,s:(c.strokes||[]).length,pts:(c.strokes&&c.strokes[0]&&c.strokes[0].pts)?c.strokes[0].pts.length:-1}))})');
    if (JSON.parse(sb2).n < 1) failures.push('重进沙盒后旧造物没接回来（creatures=' + JSON.parse(sb2).n + '，存档记录=' + JSON.stringify(JSON.parse(sb2).rec) + '）');
    else console.log(`[smoke] 沙盒：画 1 笔→造物 ${sbv.n} 个 / 落盘 ${sbv.saved} 条 / 重进接回 ${JSON.parse(sb2).n} 个 / 无误判`);

    // 截图要在清空**之前**拍：清空后画面里既没造物也没了「清空」按钮，看不出界面长什么样
    const sbShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ROOT, 'dist', 'smoke-sandbox.png'), Buffer.from(sbShot.data, 'base64'));

    // ── 沙盒单条删除：再画一个，选中它、点 ×，确认只少这一个（不是清空、不是删错）──
    await evalJs(`(()=>{const pts=[];const[x1,y1,x2,y2]=[340,700,410,704];const n=60;for(let i=0;i<=n;i++){const t=i/n;pts.push({x:x1+(x2-x1)*t+Math.sin(i*1.7)*0.7,y:y1+(y2-y1)*t+Math.cos(i*2.3)*0.7});}__WCWZ__.spawnFromStrokes([{pts}]);return 1;})()`);
    await sleep(900);
    const beforeDel = JSON.parse(await evalJs('JSON.stringify({n:__WCWZ__.runtime.creatures.length, saved:(__WCWZ__.store.read("wcwz:sandbox:v1")||{creatures:[]}).creatures.length})'));
    // 取最新画的那个造物的包围盒中心，真实点击选中它
    const lastC = JSON.parse(await evalJs('(()=>{const c=__WCWZ__.runtime.creatures[__WCWZ__.runtime.creatures.length-1];let mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;for(const b of c.bodies){mnx=Math.min(mnx,b.bounds.min.x);mxx=Math.max(mxx,b.bounds.max.x);mny=Math.min(mny,b.bounds.min.y);mxy=Math.max(mxy,b.bounds.max.y);}return JSON.stringify({cx:(mnx+mxx)/2,cy:(mny+mxy)/2,id:c.id});})()'));
    await click(lastC.cx, lastC.cy);
    await sleep(220);
    const sel = JSON.parse(await evalJs('JSON.stringify({sel:__WCWZ__.view.selectedSandboxId, badge:__WCWZ__.view.delBadge})'));
    if (sel.sel == null) {
      failures.push('点中造物后没有选中（selectedSandboxId=' + sel.sel + '）——单条删除入口失效');
    } else if (!sel.badge) {
      failures.push('选中后没有出现删除徽标（delBadge 为 ' + sel.badge + '）');
    } else {
      const bx = sel.badge.x + sel.badge.w / 2, by = sel.badge.y + sel.badge.h / 2;
      await click(bx, by);
      await sleep(320);
      const afterDel = JSON.parse(await evalJs('JSON.stringify({n:__WCWZ__.runtime.creatures.length, saved:(__WCWZ__.store.read("wcwz:sandbox:v1")||{creatures:[]}).creatures.length, sel:__WCWZ__.view.selectedSandboxId})'));
      if (afterDel.n !== beforeDel.n - 1) failures.push(`单条删除后场上只应少 1 个（删前 ${beforeDel.n} → 删后 ${afterDel.n}）`);
      else if (afterDel.saved !== beforeDel.saved - 1) failures.push(`单条删除后存档只应少 1 条（删前 ${beforeDel.saved} → 删后 ${afterDel.saved}）`);
      else if (afterDel.sel !== null) failures.push('删除后选中态没清除（selectedSandboxId=' + afterDel.sel + '）');
      else console.log(`[smoke] 沙盒单条删除：选中(id=${lastC.id}) → 点 × → 场上 ${beforeDel.n}→${afterDel.n} / 存档 ${beforeDel.saved}→${afterDel.saved} ✔`);
    }

    // ── 沙盒「清空」：真实点击两次（第一次是二次确认，不能一下就抹掉）──
    const CLEAR_BTN = { x: 251, y: 71 };   // design 坐标 = DESIGN_W-204+25 / 54+17；视口 430×932 与设计 1:1
    await click(CLEAR_BTN.x, CLEAR_BTN.y);
    await sleep(200);
    const armed = JSON.parse(await evalJs('JSON.stringify({a:__WCWZ__.view.clearArmed, n:__WCWZ__.runtime.creatures.length})'));
    if (armed.a !== true) failures.push('点「清空」没有进入二次确认态（clearArmed=' + armed.a + '）');
    if (armed.n < 1) failures.push('第一次点「清空」就把造物删了——二次确认没生效（creatures=' + armed.n + '）');
    await click(CLEAR_BTN.x, CLEAR_BTN.y);
    await sleep(500);
    const cleared = JSON.parse(await evalJs('JSON.stringify({n:__WCWZ__.runtime.creatures.length, saved:(__WCWZ__.store.read("wcwz:sandbox:v1")||{creatures:[]}).creatures.length, a:__WCWZ__.view.clearArmed})'));
    if (cleared.n !== 0) failures.push('二次确认后场上造物没清掉（creatures=' + cleared.n + '）');
    if (cleared.saved !== 0) failures.push('二次确认后存档没清掉（saved=' + cleared.saved + '）——重进又会长回来');
    if (cleared.a !== false) failures.push('清空后确认态没解除');
    if (cleared.n === 0 && cleared.saved === 0) console.log('[smoke] 沙盒清空：第 1 点仅进入确认态（造物仍在）→ 第 2 点真清空 ✔');

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
  console.log('\n[smoke] 全部通过：5 关参考解法走通 + 沙盒画/存/复原，430×932 竖屏截图已存 dist/');
}

main().catch((e) => { console.error('[smoke] 异常：' + e.message); process.exitCode = 1; });
