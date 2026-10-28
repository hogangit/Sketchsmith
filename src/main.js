/**
 * src/main.js —— 组合根（composition root）：把平台实现、物理、渲染、音频、关卡装配成一局游戏。
 *
 * 依赖注入方向：main → (platform | physics | render | audio | level)，其余模块互不 import 实现。
 * 音频与物理的连接在这里订阅一次：world.onImpact(evt => AudioBus.play('collide', evt))
 * （数据流 physics → audio，注册动作 audio → physics，单向依赖）
 */
import { APP_VERSION, BOOK_H, BOOK_TOP, DESIGN_H, DESIGN_W, WORLD_H } from './core/config.js';
import { createBus } from './core/bus.js';
import { Boot, PerfGovernor, RenderQuality } from './core/perf.js';
import { SAVE_KEY_PROGRESS, SAVE_SCHEMA_VERSION, loadProgress, saveProgress } from './core/storage.js';
import { createLocalStorageSaveStore } from './platform/local-storage-save-store.js';
import { createCanvasSurface, createStaticLayer } from './render/canvas.js';
import { drawFarmer, drawFreehandStroke, drawPaper } from './render/handdrawn.js';
import { drawSoilTexture, drawSoilTufts, drawPaperGrain, drawSceneVignette } from './render/scenery.js';
import { chipIndexAt, drawHud, headerButtonAt, pickFailHint } from './render/hud.js';
import { createStrokeCapture } from './stroke/capture.js';
import { analyzeStrokeGroup } from './stroke/classify.js';
import { createPhysicsWorld } from './physics/world.js';
import { BodyBudget, StrokeBudget } from './physics/budget.js';
import { createLevelRuntime } from './level/runtime.js';
import { getAbility, IMPLEMENTED_ABILITY_IDS } from './abilities/registry.js';
import { AudioBus } from './audio/audio-bus.js';
import { canFitBeforeStamp, createLineQuota, estimateSpeechMs, isPerLevelLine, LINES, lineText, lineVoiceLevel, lineWho } from './text/lines.js';
import { LEVEL_CH1_01 } from './level/levels/ch1-01.js';
import { LEVEL_CH1_02 } from './level/levels/ch1-02.js';
import { LEVEL_CH1_03 } from './level/levels/ch1-03.js';
import { LEVEL_CH1_04 } from './level/levels/ch1-04.js';
import { LEVEL_CH1_05 } from './level/levels/ch1-05.js';
import { SANDBOX_LEVEL, unlockSandbox } from './level/sandbox.js';

// 沙盒挂在数组末尾：通关最后一关后 nextLevel 会自然推进到它，不另开一套模式切换。
// ⚠️ 因此「最后一关」永远是 GAME_LEVELS.length - 2（沙盒不算关）。
const GAME_LEVELS = [LEVEL_CH1_01, LEVEL_CH1_02, LEVEL_CH1_03, LEVEL_CH1_04, LEVEL_CH1_05, SANDBOX_LEVEL];
/** 真正的最后一关下标（章节印章 / 沙盒解锁都以它为界） */
const LAST_LEVEL_INDEX = GAME_LEVELS.length - 2;
const GAME_CHAPTER_KEYS = [
  { rootHz: 293.66, mode: 0 },   // 关1 D 宫
  { rootHz: 293.66, mode: 1 },   // 关2 D 羽
  { rootHz: 220.0, mode: 1 },    // 关3 A 羽
];
const MAIN_THICKNESS = 9;
const MAIN_FRAME_CLAMP_MS = 50;

function mainNow() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function mainParam(name) {
  try { return new RegExp('(^|[?&])' + name + '=1').test(location.search); } catch (e) { return false; }
}

export function boot() {
  const canvasEl = document.getElementById('game');
  if (!canvasEl) return null;

  const bus = createBus();
  const surface = createCanvasSurface(canvasEl);
  const staticLayer = createStaticLayer();
  const store = createLocalStorageSaveStore();
  const progress = loadProgress(store);

  const view = {
    levelIndex: 0,
    totalLevels: GAME_LEVELS.length - 1,   // 真实关卡数（不含挂在末尾的沙盒）
    level: GAME_LEVELS[0],
    snapshot: null,
    debug: mainParam('debug'),
    impactDebugOn: mainParam('impactDebug'),
    impactDebug: null,
    bubble: null,
    win: false,
    winAt: 0,
    failFlash: 0,
    fps: 60,
    frameMs: 0,
    tier: 'high',
    bodyCount: 0,
    strokeCount: 0,
    audioOn: true,
    audioUnlocked: false,
    voiceMode: 'unknown',
    livePoints: 0,
    now: 0,
  };

  PerfGovernor.init();
  PerfGovernor.onChange = (t) => { view.tier = t; };
  view.tier = PerfGovernor.tier;
  if (Boot.wantsSkipFromQuery()) Boot.skipIntro();

  let world = null;
  let runtime = null;
  let sceneSeed = 1;
  let lastBubbleKey = '';
  let winTimer = 0;

  /** 把一句台词交给"交付"：气泡一定出现（文字是信息通道），语音能不能起来由音频层决定 */
  function showLine(lineId, ms) {
    const text = lineText(lineId);
    if (!text) return false;
    view.bubble = { who: lineWho(lineId), text, until: mainNow() + (ms || 2600) };
    lastBubbleKey = lineId;
    // 有中文语音才出声；没有就静默走气泡（绝不拿英文嗓音念中文）。
    // 语音怎么排队（C5 挂起 / C4 延后 / 超时丢弃）由 AudioBus 内的 voice-scheduler 决定，
    // 这里只把"说话人、级别、朗读时长"三个事实交给它——扣额度发生在它那边 onstart。
    AudioBus.speak(lineId, text, {
      speaker: lineWho(lineId) || 'narrator',
      level: lineVoiceLevel(lineId),
      textMs: estimateSpeechMs(text),
    });
    if (AudioBus.voiceMode === 'bubble') bus.emit('text:bubble', { lineId });
    return true;
  }

  /** 不设配额的场合（开场 / 成功 / 盖章）：这些句子每关最多一次，重复风险不在它们身上 */
  function say(lineId, ms) { showLine(lineId, ms); }

  function toast(text, ms) {
    view.bubble = { who: '', text, until: mainNow() + (ms || 1800) };
  }

  /**
   * 台词配额两个档（附录 A）：
   *   · 整局档：落地形态台词 + 各关专属失败暗示，永不重置；
   *   · 每关档：跨关通用兜底句（`common_fail2` 一类），进关时 reset ——
   *     否则前一关把额度吃光，关3..关9 的"没预料到的终态"就没有兜底了。
   * 静默不致命：视觉提示（悬空半边发光 / 轮廓虚线）会接手；**不许补同义句**，
   * 换句会被读成"判定变了"。
   *
   * **扣额度的时序**：`exhausted()` 只查不扣，`take()` 在真正交付之后才扣。
   * 被音频层拦下（C4 延后 / C5 不在画面内 / 超时丢弃）的那一次**一次都不许扣** ——
   * 否则整局 2 次额度会被三个"没播出去"的句子烧光，后面的关就没兜底了。
   * [待音频契约] 现在 `AudioBus.speak()` 只返回 boolean（分不出"播了 / 被延后 / 被拦下"），
   * 而气泡是必出的，所以当前交付点 = 气泡出现。等 audio-director 把 speak 的三态契约定下来，
   * 这里改成 `if (voiceOutcome === 'played' || AudioBus.voiceMode === 'bubble') quota.take(id)`，
   * 只动这一行——所以现在就把"查"和"扣"拆成两个口子。
   */
  const allowRunLine = createLineQuota(2);
  const allowLevelLine = createLineQuota(2);
  function sayCapped(lineId, ms) {
    if (!lineText(lineId)) return false;         // 表外不发声、不臆造
    const quota = isPerLevelLine(lineId) ? allowLevelLine : allowRunLine;
    if (quota.exhausted(lineId)) return false;   // 额度真用完才提前返回（其余一律走完交付）
    showLine(lineId, ms || 2600);
    quota.take(lineId);                          // 交付发生了才扣
    return true;
  }
  /** 落地形状分岔台词：闭集、同句 ≤2 次（整局）、超额静默 */
  function sayFormLine(form) { sayCapped('form_' + form, 2200); }

  // 把两个"只有主程序知道"的事实注入音频层（音频层不认识关卡，也不该认识）：
  //   · C5 前置条件：说话人在不在画面内；· C.1 第 2 步：文字额度的**只读**预检。
  // 注意 isOnScreen 目前恒为 true —— 关卡还没有镜头推拉；等有相机可视区再改这里，
  // 这是整个 C.5 唯一需要动主程序的地方，别在音频层里去猜。
  AudioBus.setVoiceHooks({
    isOnScreen: (speaker) => {
      const lv = view.level;
      if (!lv) return true;
      const labels = (lv.actors || []).map((a) => a.label);
      if (labels.indexOf(speaker) >= 0) return true;
      return true;   // [待设计] 章印 / 水泵这类非 actor 说话人目前也都在画面内
    },
    precheckQuota: (lineId) => {
      const quota = isPerLevelLine(lineId) ? allowLevelLine : allowRunLine;
      return !quota.exhausted(lineId);   // 只读：不扣
    },
  });
  /** 终态台词：与形态台词共用整局档，跨关兜底句自动落到每关档 */
  function sayFailLine(id) { sayCapped(id, 2600); }

  function currentLevel() { return GAME_LEVELS[view.levelIndex]; }

  function buildWorld() {
    if (runtime) { try { runtime.destroy(); } catch (e) { /* noop */ } }
    if (world) { try { world.clear(); } catch (e) { /* noop */ } }
    BodyBudget.reset();
    StrokeBudget.reset();
    world = createPhysicsWorld({});
    // 音频唯一订阅点：碰撞音由物理侧每帧聚合、最多回调 1 次
    world.onImpact((evt) => AudioBus.play('collide', evt));
    view.level = currentLevel();
    runtime = createLevelRuntime({ level: view.level, world, bus });
    // 进关重置"每关"档配额：跨关兜底句（common_fail2 一类）的额度不能被前一关吃光，
    // 否则关3..关9 的"没预料到的终态"只剩余光和静默，等于把安全网关掉了。
    allowLevelLine.reset();
    // C.1b 场景边界：切关时**已起播**的句子必须停（额度不退），否则玩家已站在新关卡、
    // 耳朵里还在念上一关 = 音画脱钩，会被当 bug 报。抢占未起播的那条不扣费。
    AudioBus.onSceneBoundary('level-change');
    sceneSeed = 7 + view.levelIndex * 31;
    staticLayer.invalidate();
    view.win = false;
    view.failFlash = 0;
    view.snapshot = runtime.snapshot();
    const key = GAME_CHAPTER_KEYS[view.levelIndex] || GAME_CHAPTER_KEYS[0];
    AudioBus.setKey(key.rootHz, key.mode);
    if (capture) capture.reset();
  }

  function spawnFromStrokes(strokes) {
    if (!runtime || view.win) return;
    if (runtime.status === 'finished') return;
    const analysis = analyzeStrokeGroup(strokes);
    if (analysis.tooSmall) {
      toast('太小了，看不清画的是什么。画大一点。');
      return;
    }
    StrokeBudget.push(analysis.pointCount);

    const c = runtime.spawnCreature({ form: analysis.form, geo: analysis, thickness: MAIN_THICKNESS });
    if (c) {
      AudioBus.play('spawn');
      // levels.md 附录 A：落地形状分岔台词（6 条闭集），同句整局最多 2 次，超额静默不改写
      sayFormLine(analysis.form);
      view.snapshot = runtime.snapshot();
    }
  }

  const capture = createStrokeCapture({
    audio: AudioBus,
    toDesign: surface.toDesign,
    bus,
    onGroup: spawnFromStrokes,
  });

  function retryLevel() {
    if (winTimer) { clearTimeout(winTimer); winTimer = 0; }
    buildWorld();
    say(view.level.lines.intro, 3200);   // 开场句：只在进关这一刻播，不排第二句
  }

  function nextLevel() {
    if (winTimer) { clearTimeout(winTimer); winTimer = 0; }
    view.levelIndex = Math.min(GAME_LEVELS.length - 1, view.levelIndex + 1);
    buildWorld();
    say(view.level.lines.intro, 3400);
  }

  function onWin(payload) {
    if (view.win) return;
    view.win = true;
    view.winAt = mainNow();
    AudioBus.play('win');
    const lv = view.level;
    progress.cleared[lv.id] = true;
    progress.maxUnlocked = Math.max(progress.maxUnlocked, Math.min(GAME_LEVELS.length, view.levelIndex + 2));
    progress.seconds = (progress.seconds || 0) + Math.round((payload.elapsedMs || 0) / 1000);
    saveProgress(store, progress);
    // 通关真正的最后一关 ⇒ 解锁沙盒「造物园」（D1：沙盒作为全通奖励）
    if (view.levelIndex === LAST_LEVEL_INDEX) unlockSandbox(store);
    // 首次成功句：绑在【成功这一刻】（D8-A1），不是定时器连播
    const winLine = lineText(lv.lines.win);
    const stampAt = view.levelIndex === 0 ? 3200 : 1400;
    if (view.levelIndex === 0) {
      // 关1 硬约束：这句必须在盖章音效之前完整念完；装不下就整句丢弃、只留盖章
      if (canFitBeforeStamp(winLine, stampAt)) {
        say(lv.lines.win, stampAt - 200);
        setTimeout(() => AudioBus.play('stamp'), stampAt);
      } else {
        setTimeout(() => AudioBus.play('stamp'), 1600);
      }
    } else {
      say(lv.lines.win, 2600);
      setTimeout(() => {
        AudioBus.play('stamp');
        if (view.levelIndex === LAST_LEVEL_INDEX) say('stamp1', 2600);
      }, stampAt);
    }
    winTimer = setTimeout(() => { winTimer = 0; }, 600);
  }

  function onFail(payload) {
    AudioBus.play(payload && payload.failSfx ? payload.failSfx : 'fail');
    view.failFlash = 1;
    const lv = view.level;
    // 终态台词优先（D24/D25）：位置决定说哪句，判定只有一条。
    // 有终态台词时**不再叠加暗示文字**——两句话叠在一起就是在教玩家读术语。
    // 同句整局 ≤2 次（sayFailLine 内计数），超额静默由视觉提示接手。
    const endLine = lv.failLines && lv.failLines[payload.reason];
    if (endLine) { sayFailLine(endLine); return; }
    const hints = lv.failHints || [];
    const t = pickFailHint(hints, payload.hintLevel || 1, view.snapshot && view.snapshot.creature && view.snapshot.creature.form);
    if (t) toast(t, 2600);
    else if (lv.lines.failStreak) sayCapped(lv.lines.failStreak, 2400);   // 兜底句也受配额，否则它会无限重播
  }

  bus.on('level:win', onWin);
  bus.on('level:fail', onFail);
  bus.on('creature:tickle', (e) => { if (e && e.actor) AudioBus.play('spring'); });  // 关4 弹射小人的弹簧音
  bus.on('plate:on', () => AudioBus.play('ability'));
  bus.on('ability:rejected', () => {
    AudioBus.play('ui');
    toast('最多只能贴 2 个能力。', 1600);
  });

  // ---- 输入 ----
  function handleUiTap(x, y) {
    if (view.win) {
      if (mainNow() - view.winAt < 600) return true;
      if (view.levelIndex >= GAME_LEVELS.length - 1) { view.levelIndex = 0; buildWorld(); say(view.level.lines.intro, 3200); }
      else nextLevel();
      return true;
    }
    const btn = headerButtonAt(x, y);
    if (btn === 'retry') { AudioBus.play('ui'); retryLevel(); return true; }
    if (btn === 'audio') {
      view.audioOn = !view.audioOn;
      AudioBus.setEnabled(view.audioOn);
      AudioBus.play('ui');
      return true;
    }
    const ci = chipIndexAt(x, y, (view.level.chips || []).length);
    if (ci >= 0) {
      const id = (view.level.chips || [])[ci];
      if (!id || IMPLEMENTED_ABILITY_IDS.indexOf(id) < 0) return true;
      const r = runtime ? runtime.setAbility(id) : null;
      if (r && !r.rejected) {
        AudioBus.play('ability');
        if (getAbility(id) && getAbility(id).flags && getAbility(id).flags.rigid) toast('变硬：冻成一块整的。', 1400);
        view.snapshot = runtime.snapshot();
      }
      return true;
    }
    return false;
  }

  canvasEl.addEventListener('pointerdown', (ev) => {
    if (!AudioBus.unlocked) {
      AudioBus.unlockMedia();
      view.audioUnlocked = AudioBus.unlocked;
      view.voiceMode = AudioBus.voiceMode;
    }
    const p = surface.toDesign(ev.clientX, ev.clientY);
    if (handleUiTap(p.x, p.y)) { ev.preventDefault(); return; }
    try { canvasEl.setPointerCapture(ev.pointerId); } catch (e) { /* noop */ }
    capture.handlers.down(ev);
  });
  canvasEl.addEventListener('pointermove', (ev) => capture.handlers.move(ev));
  canvasEl.addEventListener('pointerup', (ev) => capture.handlers.up(ev));
  canvasEl.addEventListener('pointercancel', () => capture.handlers.cancel());
  canvasEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'r' || ev.key === 'R') retryLevel();
    else if (ev.key === 'Escape') { view.levelIndex = 0; buildWorld(); }
    else if (ev.key === 'Enter') capture.flush();
  });
  window.addEventListener('resize', () => surface.resize());

  // ---- 场景静态层 ----
  function drawStatics(ctx) {
    const lv = view.level;
    const rc = staticLayer.rough;
    ctx.save();
    // 天空：4 档竖向渐变（顶浅→近地平最暖）——上半屏读成「清晨田野」而非灰板（art-polish 3.1）
    const sky = ctx.createLinearGradient(0, 0, 0, 300);
    sky.addColorStop(0, '#ECE4D2');    // P2
    sky.addColorStop(0.55, '#E9DEC6');
    sky.addColorStop(0.88, '#EFE0BE'); // 近地平最暖
    sky.addColorStop(1, '#F1E6CC');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, DESIGN_W, WORLD_H);
    // 地平线晕染：贴 y=300 上方 46px 横向渐变带，按关卡主题换色（A1 晨光 / A2 集市暖尘 / A3 水塘冷调）
    const WASH = { 'ch1-01': 'rgba(232,201,138,0.12)', 'ch1-02': 'rgba(196,150,96,0.10)', 'ch1-03': 'rgba(150,178,168,0.12)' };
    const wash = WASH[lv.id];
    if (wash) {
      const wg = ctx.createLinearGradient(0, 254, 0, 300);
      wg.addColorStop(0, 'rgba(0,0,0,0)');
      wg.addColorStop(1, wash);
      ctx.fillStyle = wg;
      ctx.fillRect(0, 254, DESIGN_W, 46);
    }
    ctx.fillStyle = '#e2d8c0';
    ctx.fillRect(0, BOOK_TOP, DESIGN_W, BOOK_H);
    // 地形
    for (const t of lv.terrain) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.angle || 0);
      const isIce = t.mat === 'ice';
      ctx.fillStyle = isIce ? 'rgba(196,226,232,0.85)' : '#cfc3a6';
      ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
      ctx.strokeStyle = '#5b5344';
      ctx.lineWidth = 2;
      ctx.strokeRect(-t.w / 2, -t.h / 2, t.w, t.h);
      // 土：分层剖面纹理（art-polish-spec 3.3）——表土/层理/斜纹/碎石/根须/潮斑 + 地表草簇
      // 静态层一次烘焙，零每帧开销；确定性 seed 保证同关重进布局一致
      if (!isIce) {
        const seed = (lv.id || 'lv') + '#' + (t.x | 0) + ',' + (t.y | 0);
        ctx.save();
        ctx.beginPath();
        ctx.rect(-t.w / 2, -t.h / 2, t.w, t.h);
        ctx.clip();
        drawSoilTexture(ctx, t.w, t.h, RenderQuality.tier, seed);
        ctx.restore();
        drawSoilTufts(ctx, t.w, t.h, RenderQuality.tier, seed);   // 草簇在 clip 外，可越过顶边
      }
      ctx.restore();
    }
    // 沟沿刻度：只在沟口上方留一小段（32px）+ 一个朝下的小三角。
    // 原来是从 y=150 一路贯穿到沟底，把云和山都切开了，读起来像施工辅助线漏进成品。
    // 信息（"梁要跨到这里"）保住，杂线去掉。
    for (const g of lv.guides || []) {
      const rim = g.y == null ? 430 : g.y;
      ctx.save();
      ctx.strokeStyle = 'rgba(120,60,40,0.55)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(g.x, rim - 40);
      ctx.lineTo(g.x, rim - 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(g.x - 4.5, rim - 11);
      ctx.lineTo(g.x, rim - 3);
      ctx.lineTo(g.x + 4.5, rim - 11);
      ctx.closePath();
      ctx.fillStyle = 'rgba(120,60,40,0.6)';
      ctx.fill();
      ctx.restore();
    }
    // 提示轮廓：关1 画桥位（beamOutline），关2 画**悬空那半边**（dropZone，第 2 次失败起）。
    // 关2 不再画桥：梁已经是合法解，画一座桥等于教玩家画非主解，而本关的教学是"砸哪儿"。
    const hintShape = lv.hints && (lv.hints.dropZone || lv.hints.beamOutline);
    const hintFrom = (hintShape && hintShape.fromHint) || 1;
    if (view.snapshot && view.snapshot.hintLevel >= hintFrom && hintShape) {
      const b = hintShape;
      ctx.save();
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(80,120,90,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.restore();
    }
    // 布景
    for (const s of lv.scenery || []) {
      if (s.kind === 'line') {
        ctx.save();
        if (s.dash) ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(70,62,50,0.7)';
        ctx.lineWidth = s.width || 1.5;
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        ctx.restore();
      } else if (s.kind === 'rect') {
        ctx.strokeStyle = 'rgba(70,62,50,0.75)';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      } else if (s.kind === 'hills') {
        // 三层远山（alpha 0.16/0.24/0.34，层间基线错开制造纵深）+ 最近层轮廓与树点 + 云 + 鸟（art-polish 3.1）
        // 远层（最淡）
        ctx.fillStyle = 'rgba(158,158,136,0.16)';
        ctx.beginPath();
        ctx.moveTo(-10, 300); ctx.lineTo(68, 240); ctx.lineTo(182, 300); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(248, 300); ctx.lineTo(352, 246); ctx.lineTo(440, 300); ctx.closePath(); ctx.fill();
        // 中层
        ctx.fillStyle = 'rgba(158,158,136,0.24)';
        ctx.beginPath();
        ctx.moveTo(56, 300); ctx.lineTo(180, 220); ctx.lineTo(304, 300); ctx.closePath(); ctx.fill();
        // 近层（最深）
        ctx.fillStyle = 'rgba(158,158,136,0.34)';
        ctx.beginPath();
        ctx.moveTo(-10, 300); ctx.lineTo(96, 214); ctx.lineTo(206, 300); ctx.closePath(); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(140, 300); ctx.lineTo(262, 236); ctx.lineTo(400, 300); ctx.closePath(); ctx.fill();
        // 近层轮廓（I4）+ 树点
        ctx.strokeStyle = 'rgba(90,84,70,0.38)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-10, 300); ctx.lineTo(96, 214); ctx.lineTo(206, 300); ctx.stroke();
        ctx.fillStyle = 'rgba(90,84,70,0.40)';
        for (const [tx, ty] of [[66, 266], [120, 248], [92, 278], [158, 272]]) {
          ctx.beginPath(); ctx.arc(tx, ty, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.ellipse(318, 186, 34, 13, 0, 0, Math.PI * 2);
        ctx.ellipse(292, 190, 22, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(90,84,70,0.55)';
        ctx.lineWidth = 1.5;
        const bird = (bx, by, r) => {
          ctx.beginPath();
          ctx.moveTo(bx - r * 2, by);
          ctx.quadraticCurveTo(bx - r, by - r, bx, by);
          ctx.quadraticCurveTo(bx + r, by - r, bx + r * 2, by);
          ctx.stroke();
        };
        bird(104, 152, 4.5);
        bird(146, 132, 3.6);
        bird(372, 150, 3.2);
      } else if (s.kind === 'chasm') {
        // 又深又暗的沟：明确“下去就上不来”，并在沟壁上放几块碎石
        const g = ctx.createLinearGradient(0, s.y, 0, s.y + (s.depth || 80));
        g.addColorStop(0, 'rgba(52,44,38,0.86)');
        g.addColorStop(0.55, 'rgba(28,24,21,0.95)');
        g.addColorStop(1, 'rgba(12,10,9,1)');
        ctx.fillStyle = g;
        ctx.fillRect(s.x1, s.y, s.x2 - s.x1, s.depth || 80);
        ctx.fillStyle = 'rgba(120,110,96,0.5)';
        ctx.beginPath(); ctx.arc(s.x1 + 18, s.y + 62, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s.x1 + 34, s.y + 74, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(s.x2 - 22, s.y + 58, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(60,52,44,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x1, s.y); ctx.lineTo(s.x1, s.y + (s.depth || 80)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s.x2, s.y); ctx.lineTo(s.x2, s.y + (s.depth || 80)); ctx.stroke();
      } else if (s.kind === 'crops') {
        // 作物：竖杆 + 三叉穗 + 一片叶；三笔就能认成"庄稼"
        const n = s.n || 3;
        for (let i = 0; i < n; i++) {
          const cx = n === 1 ? s.x1 : s.x1 + (s.x2 - s.x1) * (i / (n - 1));
          const hh = (s.h || 18) + (i % 2) * 4;
          ctx.strokeStyle = 'rgba(96,86,62,0.9)';
          ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(cx, s.y); ctx.lineTo(cx, s.y - hh); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx, s.y - hh + 3); ctx.lineTo(cx - 3.4, s.y - hh - 4);
          ctx.moveTo(cx, s.y - hh + 3); ctx.lineTo(cx + 3.4, s.y - hh - 4);
          ctx.moveTo(cx, s.y - hh * 0.55); ctx.lineTo(cx + 4.6, s.y - hh * 0.55 - 3.4);
          ctx.stroke();
        }
      } else if (s.kind === 'ridge') {
        // 矮土垄：一条微微拱起的土带
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y + 1);
        ctx.quadraticCurveTo((s.x1 + s.x2) / 2, s.y - (s.h || 8), s.x2, s.y + 1);
        ctx.closePath();
        ctx.fillStyle = 'rgba(140,118,82,0.55)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(84,74,58,0.65)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else if (s.kind === 'sign') {
        // 木牌：立柱 + 牌面 + 一个字
        ctx.strokeStyle = 'rgba(84,74,58,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y - 17); ctx.stroke();
        ctx.fillStyle = '#ece0c4';
        ctx.fillRect(s.x - 9, s.y - 31, 18, 14);
        ctx.lineWidth = 1.3;
        ctx.strokeRect(s.x - 9, s.y - 31, 18, 14);
        ctx.fillStyle = '#4a4335';
        ctx.font = '10px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.text || '田', s.x, s.y - 20);
        ctx.textAlign = 'left';
      } else if (s.kind === 'fence') {
        ctx.strokeStyle = 'rgba(84,74,60,0.75)';
        ctx.lineWidth = 1.6;
        for (let fx = s.x1; fx <= s.x2; fx += 12) {
          ctx.beginPath(); ctx.moveTo(fx, s.y); ctx.lineTo(fx, s.y - 12); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(s.x1, s.y - 8); ctx.lineTo(s.x2, s.y - 8); ctx.stroke();
      } else if (s.kind === 'text') {
        ctx.fillStyle = s.tone === 'light' ? 'rgba(242,234,216,0.8)' : 'rgba(90,80,64,0.8)';
        ctx.font = (s.size || 10) + 'px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = s.align || 'left';
        ctx.fillText(s.text, s.x, s.y);
        ctx.textAlign = 'left';
      }
    }
    // 纸面颗粒 + 暗角（art-polish 3.6）：只铺场景带 0..BOOK_TOP，正文/造物簿区不撒点
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, DESIGN_W, BOOK_TOP);
    ctx.clip();
    if (RenderQuality.tier !== 'low') drawPaperGrain(ctx, DESIGN_W, BOOK_TOP, 'scene');
    drawSceneVignette(ctx, DESIGN_W, BOOK_TOP);
    ctx.restore();
    if (rc) { rc.rectangle(0, 0, 1, 1, { stroke: 'none' }); }
    ctx.restore();
  }

  // ---- 动态层 ----
  function bodyPath(ctx, b) {
    const v = b.vertices;
    if (!v || !v.length) return false;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    return true;
  }

  function drawBodies(ctx) {
    if (!world) return;
    const bodies = world.allBodies();
    view.bodyCount = bodies.length;
    for (const b of bodies) {
      if (b.plugin && b.plugin.terrain) continue;
      if (b.label === 'plate') {
        ctx.fillStyle = b.plugin && b.plugin.on ? '#6d8f5f' : '#b8ab8d';
        if (bodyPath(ctx, b)) { ctx.fill(); ctx.strokeStyle = '#4d4638'; ctx.lineWidth = 2; ctx.stroke(); }
        continue;
      }
      if (b.label === 'prop') {
        ctx.fillStyle = '#d98b3a';
        if (bodyPath(ctx, b)) { ctx.fill(); ctx.strokeStyle = '#7a4718'; ctx.lineWidth = 2; ctx.stroke(); }
        continue;
      }
      if (b.label === 'actor') {
        // 人形，不是一个圈：草帽+头+身+两臂+两腿（细节见 handdrawn.drawFarmer）
        const vx = (b.velocity && b.velocity.x) || 0;
        const face = vx < -0.2 ? -1 : 1;
        b.plugin = b.plugin || {};
        b.plugin.gait = (b.plugin.gait || 0) + Math.abs(vx) * 0.055;
        drawFarmer(ctx, b.position.x, b.position.y, { phase: b.plugin.gait, face });
        continue;
      }
      // 造物（含 compound 的子 parts）
      const parts = b.parts && b.parts.length > 1 ? b.parts.slice(1) : [b];
      ctx.globalAlpha = b.render && b.render.opacity != null ? b.render.opacity : 1;
      for (const part of parts) {
        if (!part.vertices || !part.vertices.length) continue;
        if (part.circleRadius) {
          ctx.beginPath();
          ctx.arc(part.position.x, part.position.y, part.circleRadius, 0, Math.PI * 2);
        } else if (!bodyPath(ctx, part)) continue;
        const soft = b.plugin && b.plugin.soft;
        ctx.fillStyle = 'rgba(126,150,132,0.38)';
        ctx.fill();
        ctx.strokeStyle = '#33473b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBook(ctx) {
    drawPaper(ctx, 0, BOOK_TOP, DESIGN_W, BOOK_H);
    // 已落笔的笔画
    for (const s of capture.strokes) drawFreehandStroke(ctx, s.pts, 5);
    const live = capture.live;
    if (live && live.length) drawFreehandStroke(ctx, live, 5);
    view.livePoints = capture.pointCount + (live ? live.length : 0);
    view.strokeCount = capture.strokes.length + (live ? 1 : 0);
  }

  // ---- 主循环 ----
  let last = mainNow();
  let accum = 0;

  function frame() {
    const t = mainNow();
    let dt = t - last;
    last = t;
    if (dt > 200) dt = 16.7;
    accum += Math.min(MAIN_FRAME_CLAMP_MS, dt);
    const steps = Math.floor(accum / 16.666);
    accum -= steps * 16.666;
    const physStart = mainNow();
    if (runtime && view.win === false) runtime.step(Math.max(0, Math.min(3, steps)));
    else if (runtime && steps > 0) runtime.step(0);
    const physMs = mainNow() - physStart;
    if (view.win && steps > 0 && !winTimer) { /* 过关后不再推进物理 */ }

    view.now = t;
    view.frameMs = dt;
    view.fps = view.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
    PerfGovernor.sample(dt, physMs);
    if (view.failFlash > 0) view.failFlash = Math.max(0, view.failFlash - dt / 600);
    AudioBus.tickVoice();   // C.5 挂起 / C.4 延后的推进（幂等）
    if (runtime) view.snapshot = runtime.snapshot();
    if (view.impactDebugOn && world) view.impactDebug = world.impactDebug;

    surface.beginFrame('#efe7d6');
    const ctx = surface.ctx;
    staticLayer.ensure(drawStatics);
    staticLayer.blit(ctx);
    drawBodies(ctx);
    drawBook(ctx);
    drawHud(ctx, view);
    surface.endFrame();
    requestAnimationFrame(frame);
  }

  buildWorld();
  requestAnimationFrame(frame);
  setTimeout(() => { say(view.level.lines.intro, 3200); }, 240);   // 开场句：进关那一刻，仅一句

  return {
    view, bus, surface, store, progress,
    get runtime() { return runtime; },
    get world() { return world; },
    capture,
    retryLevel, nextLevel,
    version: APP_VERSION,
    schema: SAVE_SCHEMA_VERSION,
    key: SAVE_KEY_PROGRESS,
    lines: LINES,
    spawnFromStrokes,
  };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const w = /** @type {any} */ (window);
  const start = () => {
    // 单文件游戏留一个句柄：自测脚本（tools/smoke-browser.mjs）与 ?debug=1 都靠它读状态
    try { w.__WCWZ__ = boot(); } catch (e) { w.__WCWZ_ERROR__ = String((e && e.stack) || e); throw e; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}
