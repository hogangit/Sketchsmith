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
import { drawFreehandStroke, drawPaper } from './render/handdrawn.js';
import { buttonAt, chipIndexAt, drawHud } from './render/hud.js';
import { createStrokeCapture } from './stroke/capture.js';
import { analyzeStrokeGroup } from './stroke/classify.js';
import { createPhysicsWorld } from './physics/world.js';
import { BodyBudget, StrokeBudget } from './physics/budget.js';
import { createLevelRuntime } from './level/runtime.js';
import { getAbility, IMPLEMENTED_ABILITY_IDS } from './abilities/registry.js';
import { AudioBus } from './audio/audio-bus.js';
import { canFitBeforeStamp, estimateSpeechMs, LINES, lineText, lineWho } from './text/lines.js';
import { LEVEL_CH1_01 } from './level/levels/ch1-01.js';
import { LEVEL_CH1_02 } from './level/levels/ch1-02.js';
import { LEVEL_CH1_03 } from './level/levels/ch1-03.js';

const GAME_LEVELS = [LEVEL_CH1_01, LEVEL_CH1_02, LEVEL_CH1_03];
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

  function say(lineId, ms) {
    const text = lineText(lineId);
    if (!text) return;
    view.bubble = { who: lineWho(lineId), text, until: mainNow() + (ms || 2600) };
    lastBubbleKey = lineId;
    // 有中文语音才出声；没有就静默走气泡（绝不拿英文嗓音念中文）
    AudioBus.speak(lineId, text);
    if (AudioBus.voiceMode === 'bubble') bus.emit('text:bubble', { lineId });
  }

  function toast(text, ms) {
    view.bubble = { who: '', text, until: mainNow() + (ms || 1800) };
  }

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
    if (runtime.state.activeCreature) {
      // 一次只有一个造物（阶段2 的简化：新画覆盖旧画）
      bus.emit('creature:replace', {});
    }
    const c = runtime.spawnCreature({ form: analysis.form, geo: analysis, thickness: MAIN_THICKNESS });
    if (c) {
      AudioBus.play('spawn');
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
        if (view.levelIndex === GAME_LEVELS.length - 1) say('stamp1', 2600);
      }, stampAt);
    }
    winTimer = setTimeout(() => { winTimer = 0; }, 600);
  }

  function onFail(payload) {
    AudioBus.play('fail');
    view.failFlash = 1;
    const lv = view.level;
    const hints = lv.failHints || [];
    const t = hints[Math.min(hints.length - 1, Math.max(0, (payload.hintLevel || 1) - 1))];
    if (t) toast(t, 2600);
    else if (lv.lines.failStreak) say(lv.lines.failStreak, 2400);
  }

  bus.on('level:win', onWin);
  bus.on('level:fail', onFail);
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
    const btn = buttonAt(x, y);
    if (btn === 'retry') { AudioBus.play('ui'); retryLevel(); return true; }
    if (btn === 'audio') {
      view.audioOn = !view.audioOn;
      AudioBus.setEnabled(view.audioOn);
      AudioBus.play('ui');
      return true;
    }
    const ci = chipIndexAt(x, y);
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
    // 天空 / 地底
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    sky.addColorStop(0, '#e8dfca');
    sky.addColorStop(1, '#f2ead8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, DESIGN_W, WORLD_H);
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
      ctx.restore();
    }
    // 沟的虚线
    for (const g of lv.guides || []) {
      ctx.save();
      ctx.setLineDash([5, 6]);
      ctx.strokeStyle = 'rgba(120,60,40,0.45)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(g.x, 150);
      ctx.lineTo(g.x, WORLD_H - 8);
      ctx.stroke();
      ctx.restore();
    }
    // 提示轮廓（只在第一次失败后出现）
    const showHint = (view.snapshot && view.snapshot.hintLevel > 0) && lv.hints && lv.hints.beamOutline;
    if (showHint) {
      const b = lv.hints.beamOutline;
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
      } else if (s.kind === 'text') {
        ctx.fillStyle = 'rgba(90,80,64,0.8)';
        ctx.font = (s.size || 10) + 'px system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
        ctx.textAlign = s.align || 'left';
        ctx.fillText(s.text, s.x, s.y);
        ctx.textAlign = 'left';
      }
    }
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
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, b.circleRadius || 14, 0, Math.PI * 2);
        ctx.fillStyle = '#4a6f8c';
        ctx.fill();
        ctx.strokeStyle = '#2c4457';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(b.position.x + 4, b.position.y - 4, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#f4efe2';
        ctx.fill();
        continue;
      }
      // 造物（含 compound 的子 parts）
      const parts = b.parts && b.parts.length > 1 ? b.parts.slice(1) : [b];
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
