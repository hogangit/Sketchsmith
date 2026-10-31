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
import {
  drawSoilTexture, drawSoilTufts, drawPaperGrain, drawSceneVignette,
  drawSc_PitDepth, drawSc_Haystack, drawSc_Stall, drawSc_Stakes, drawSc_CanopyFold,
  drawSc_PennantPole, drawSc_Water, drawSc_Reeds, drawSc_Rust, drawSc_Cracks,
  drawAmbient,
} from './render/scenery.js';
import { drawTitleCard } from './render/title-card.js';
import { drawAbout, aboutThemeHit, aboutVoiceHit } from './render/about.js';
import { chipIndexAt, drawHud, headerButtonAt, pickFailHint } from './render/hud.js';
import { createStrokeCapture } from './stroke/capture.js';
import { analyzeStrokeGroup } from './stroke/classify.js';
import { createPhysicsWorld } from './physics/world.js';
import { BodyBudget, BODY_BUDGET_MAX, StrokeBudget } from './physics/budget.js';
import { createLevelRuntime } from './level/runtime.js';
import { getAbility, IMPLEMENTED_ABILITY_IDS } from './abilities/registry.js';
import { AudioBus } from './audio/audio-bus.js';
import { canFitBeforeStamp, createLineQuota, estimateSpeechMs, isPerLevelLine, isTextOnlyLine, LINES, lineText, lineVoiceLevel, lineWho } from './text/lines.js';
import { LEVEL_CH1_01 } from './level/levels/ch1-01.js';
import { LEVEL_CH1_02 } from './level/levels/ch1-02.js';
import { LEVEL_CH1_03 } from './level/levels/ch1-03.js';
import { LEVEL_CH1_04 } from './level/levels/ch1-04.js';
import { LEVEL_CH1_05 } from './level/levels/ch1-05.js';
import { SANDBOX_LEVEL, clearSandbox, loadSandbox, saveCreature, unlockSandbox } from './level/sandbox.js';

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
/** 开场扉页：静止展示 + 淡出（合计 1.63s）。点一下提前进入淡出，不硬切 */
const INTRO_HOLD_MS = 1250;
const INTRO_FADE_MS = 380;

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
  // 造物簿纸面烘焙层（art-polish 3.4）：drawPaper 原来每帧 ~25 次 path，现在关卡切换画一次。
  // 内容与关卡无关（每关同一张纸），因此永不 invalidate。
  const paperLayer = createStaticLayer();
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
    about: false,
    clearArmed: false,      // 沙盒「清空」的二次确认态（误触清掉一园子造物不可接受）
    selectedSandboxId: null,   // 沙盒单条删除：当前选中造物的 id（=== 存档记录 id，见 runtime spawnCreature 的 spec.id）
    selBounds: null,           // 选中造物的实时包围盒（每帧重算，跟着物理体走）
    delBadge: null,            // 「×」删除徽标的位置（跟随 selBounds）
    winAt: 0,
    failFlash: 0,
    fps: 60,
    frameMs: 0,
    tier: 'high',
    bodyCount: 0,
    strokeCount: 0,
    audioOn: true,
    audioUnlocked: false,
    soundTheme: AudioBus.soundTheme,   // 当前声音风格（暖木/八音盒/陶笛），「关于」面板里切换
    voiceMode: 'unknown',
    voiceOn: true,          // 台词朗读开关（「关于」里可关，关掉后只显示字幕）
    voiceName: '',          // 当前系统音色短名（None/无中文语音时为空）
    voiceCount: 0,          // 系统里可用的中文音色个数（决定 ‹ › 能不能点）
    voiceIndex: 1,          // 当前音色在列表里的序号（1 起）
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
  let actorStillSince = null;   // 农夫开始静止的时刻（ms），用于 F1 挠头的空闲计时

  // 开场扉页：introActive 期间冻结物理——「点一下就开始」要名副其实，
  // 否则玩家还在看扉页，小人已经自己开走了。
  let introActive = !Boot.introSkipped;
  let introT0 = mainNow();
  let introLineSaid = false;
  let comboPlayedThisLevel = false;
  let clearArmedAt = 0;
  /** 结束扉页：跳到淡出段起点（不硬切，也不让玩家觉得点了没反应） */
  function endIntro() {
    if (!introActive) return;
    introT0 = Math.min(introT0, mainNow() - INTRO_HOLD_MS);
  }

  /** 把一句台词交给"交付"：气泡一定出现（文字是信息通道），语音能不能起来由音频层决定 */
  function showLine(lineId, ms) {
    const text = lineText(lineId);
    if (!text) return false;
    view.bubble = { who: lineWho(lineId), text, until: mainNow() + (ms || 2600) };
    lastBubbleKey = lineId;
    // 纯文字台词（D28 闭集：环境吐槽 / 实验型对照）：**只出气泡，不进语音**。
    // 这条以前只在 lines.js 的注释里写着，运行时照样送进 speak —— 规格 3.6
    // 「sb_toss* 不进语音」没法验证。现在它是数据，在这里拦。
    if (isTextOnlyLine(lineId)) {
      bus.emit('text:bubble', { lineId, textOnly: true });
      return true;
    }
    // 有中文语音才出声；没有就静默走气泡（绝不拿英文嗓音念中文）。
    // 语音怎么排队（C5 挂起 / C4 延后 / 超时丢弃）由 AudioBus 内的 voice-scheduler 决定，
    // 这里只把"说话人、级别、朗读时长"三个事实交给它——扣额度发生在它那边 onstart。
    AudioBus.speak(lineId, text, {
      speaker: lineWho(lineId) || 'narrator',
      level: lineVoiceLevel(lineId),
      textMs: estimateSpeechMs(text),
    });
    if (AudioBus.voiceMode === 'bubble') bus.emit('text:bubble', { lineId, textOnly: false });
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
   * [已定契约 C.1c] `AudioBus.speak()` 现在返回六态字符串（'queued' / 'deferred' /
   * 'blocked' / 'dropped' / 'muted' / 'unavailable'），能分清"交给后端 / 被延后 / 被拦下"。
   * 但这里的额度是**文字额度**，交付点就是文字出现：气泡必出，所以无论语音走哪条路都扣。
   * 语音额度是另一套（voice-scheduler.budget），别混。
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
  function inSandbox() { return !!view.level && view.level.id === 'sandbox'; }

  function buildWorld() {
    if (runtime) { try { runtime.destroy(); } catch (e) { /* noop */ } }
    if (world) { try { world.clear(); } catch (e) { /* noop */ } }
    BodyBudget.reset();
    // 沙盒「造物园」要同时摆出玩家存过的所有造物，物理刚体配额得放宽（关卡保持默认 24）。
    // 30 个简单造物约 30~60 个刚体，给到 60；低端机由 PerfGovernor 降档兜底，不阻塞玩家。
    BodyBudget.setMax(inSandbox() ? 60 : BODY_BUDGET_MAX);
    StrokeBudget.reset();
    world = createPhysicsWorld({});
    // 音频唯一订阅点：碰撞音由物理侧每帧聚合、最多回调 1 次
    world.onImpact((evt) => AudioBus.play('collide', evt));
    view.level = currentLevel();
    // 进入沙盒＝换一种玩法模式，给一次「章节切换」音（翻页+落地）。
    // 全作只有 1 章，`sfx_chapter` 若挂在关卡推进上会每关都响，反而稀释了它的意义。
    if (inSandbox()) AudioBus.play('chapter');
    comboPlayedThisLevel = false;   // 奖励音的稀缺性按「每关一次」计（D29）
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
    // 切关 / 进沙盒都要清空单条删除的选中态：选中态只活在「当前这一园子」里
    view.selectedSandboxId = null;
    view.selBounds = null;
    view.delBadge = null;
    view.snapshot = runtime.snapshot();
    const key = GAME_CHAPTER_KEYS[view.levelIndex] || GAME_CHAPTER_KEYS[0];
    AudioBus.setKey(key.rootHz, key.mode);
    if (capture) capture.reset();
    restoreSandboxCreatures();
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
      if (inSandbox()) saveSandboxCreature(c, strokes);
    }
  }

  /**
   * 沙盒落盘（规格 3.3/3.4：退场不丢）。
   * 判据②只在模块层验过 saveCreature/loadSandbox，但**游戏里从来没调过**——
   * 那是"单测绿着、功能不在"的典型陷阱，所以这里必须接。
   */
  function saveSandboxCreature(c, strokes) {
    const rec = saveCreature(store, {
      id: c.id,
      form: c.form,
      thickness: MAIN_THICKNESS,
      abilities: (c.abilities || []).slice(0, 2),
      name: '',
      x: c.bodies && c.bodies[0] ? c.bodies[0].position.x : null,
      y: c.bodies && c.bodies[0] ? c.bodies[0].position.y : null,
      strokes,
    });
    if (!rec.ok && rec.reason === 'full') toast('造物园满了（30 个）。先删掉旧的。', 2600);
  }

  /**
   * 进沙盒时把存档里的造物**复原出来**（不是只显示个列表）。
   * 复原靠重跑 analyzeStrokeGroup(strokes)——所以 saveCreature 必须存笔画，
   * 只存 form 是复原不出形状的。老记录（没存 strokes）跳过，不因为你而打不开沙盒。
   */
  function restoreSandboxCreatures() {
    if (!inSandbox() || !runtime) return;
    const saved = loadSandbox(store);
    if (!saved.creatures.length) return;
    let n = 0;
    for (const c of saved.creatures) {
      // ⚠️ 守卫看的是"至少有一条笔画、且这条笔画有 ≥2 个点"，不是"笔画条数 ≥2"。
      //    绝大多数造物就是**单笔**画出来的（strokes.length === 1），写成 <2 会把它们全跳过。
      const ok = Array.isArray(c.strokes) && c.strokes.some((s) => s && Array.isArray(s.pts) && s.pts.length >= 2);
      if (!ok) continue;
      try {
        const analysis = analyzeStrokeGroup(c.strokes);
        if (analysis.tooSmall) continue;
        const made = runtime.spawnCreature({ form: analysis.form, geo: analysis, thickness: c.thickness || MAIN_THICKNESS, id: c.id });
        if (!made) continue;
        for (const a of (c.abilities || []).slice(0, 2)) runtime.setAbility(a);
        n++;
      } catch (e) { /* 一条记录坏了不能让整个沙盒打不开 */ }
    }
    if (n) {
      view.snapshot = runtime.snapshot();
      toast(`造物园：接回 ${n} 个旧造物。`, 2400);
    }
  }

  /**
   * 单条删除：点中的造物 id 既对应场上刚体，也对应存档记录（D30：restore 时把存档 id 传进 spawnCreature）。
   * 所以从世界撤掉 + 从存档删掉用的是同一个 id，不会删错、也不会删了画面却留着存档。
   */
  function deleteSandboxCreature(id) {
    if (!inSandbox() || id == null || !runtime) return;
    const onField = runtime.removeCreatureById(id);
    removeCreature(store, id);   // 存档里也删掉，否则下次进沙盒它又回来了
    if (onField) AudioBus.play('fall');
    if (view.selectedSandboxId === id) view.selectedSandboxId = null;
    view.selBounds = null;
    view.delBadge = null;
    toast('删掉了一个造物。', 1500);
  }

  /** 命中测试：点 (x,y) 落在哪个造物上（沙盒里才生效）。返回 id 或 -1。
   *  用刚体 AABB 粗判——造物大多凸形，点边缘一点也能选到，够用且不依赖精确几何。 */
  function sandboxCreatureAt(x, y) {
    if (!inSandbox() || !runtime) return -1;
    for (let i = runtime.creatures.length - 1; i >= 0; i--) {
      const c = runtime.creatures[i];
      for (const b of c.bodies) {
        const bb = b.bounds;
        if (x >= bb.min.x && x <= bb.max.x && y >= bb.min.y && y <= bb.max.y) return c.id;
      }
    }
    return -1;
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
    // 提示阶梯升级（第 2 次起）：柔和 ping，音量刻意低于失败音——提示不该抢戏，
    // 也不该让玩家觉得"又错了"。它说的是"可以再试"，不是说"你做错了"。
    if (payload && payload.hintLevel >= 2) AudioBus.play('hint');
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
  bus.on('combo:trigger', () => {
    // 奖励音每关只响一次（D29）：稀缺性就是奖励感。之后再组合退回普通贴附音，
    // 不重复给——否则它会变成"贴第二枚芯片的提示音"，奖励感立刻归零。
    AudioBus.play(comboPlayedThisLevel ? 'ability' : 'combo');
    comboPlayedThisLevel = true;
  });
  bus.on('creature:lost', () => AudioBus.play('fall'));          // 造物掉出世界
  bus.on('text:bubble', () => AudioBus.play('bubble'));          // 台词降级成气泡 / 吐槽字幕出现
  bus.on('plate:on', () => AudioBus.play('ability'));
  bus.on('ability:rejected', () => {
    AudioBus.play('ui');
    toast('最多只能贴 2 个能力。', 1600);
  });

  // ---- 输入 ----
  /** 把音频层的语音配置搬到 view（「关于」面板据此画开/关与音色名） */
  function syncVoiceView() {
    const cfg = AudioBus.voiceConfig;
    const list = AudioBus.voiceList;
    view.voiceOn = cfg.on;
    view.voiceCount = list.length;
    let idx = 0;
    for (let i = 0; i < list.length; i++) if (list[i].uri === cfg.uri) { idx = i; break; }
    view.voiceIndex = list.length ? idx + 1 : 0;
    view.voiceName = cfg.name || '';
  }
  /** 打开「关于」：先刷新音色表（有的浏览器音色是异步到达的），再同步到 view */
  function openAbout() {
    AudioBus.refreshVoices();
    syncVoiceView();
    view.about = true;
    AudioBus.play('ui');
  }

  function handleUiTap(x, y) {
    // 「关于」展开时：先判语音控件与声音风格芯片（点中就地改设置、不关面板），其余任意点关闭
    if (view.about) {
      const vh = aboutVoiceHit(x, y);
      if (vh) {
        if (vh === 'toggle') {
          const on = AudioBus.setVoiceOn(!view.voiceOn);
          syncVoiceView();
          AudioBus.play('ui');
          // 打开时念一句当作确认；关掉不弹 toast——音色条已经写着「已关闭 · 台词只显示字幕」，
          // 面板内的状态变化本身就是反馈，弹 toast 只会把正在显示的台词顶掉。
          if (on) AudioBus.previewVoice('朗读打开了。');
        } else if (view.voiceCount > 1 && view.voiceOn) {
          const name = AudioBus.cycleVoice(vh === 'prev' ? -1 : 1);
          syncVoiceView();
          AudioBus.play('ui');
          if (name) AudioBus.previewVoice();   // 换完立刻念同一句，方便两两对比
        } else if (view.voiceCount === 0) {
          toast('这台设备没装中文语音，台词只显示字幕。', 2600);
        }
        return true;
      }
      const tr = aboutThemeHit(x, y);
      if (tr) {
        AudioBus.setTheme(tr);
        view.soundTheme = AudioBus.soundTheme;
        AudioBus.play('preview');   // 选完即时试听（四音琶音，足够听出音色差异）
        return true;
      }
      view.about = false;
      AudioBus.play('ui');
      return true;
    }
    if (view.win) {
      if (mainNow() - view.winAt < 600) return true;
      // 过关覆盖层上头部按钮仍可见：先判它们，避免点「重来」被当成「继续」直接跳下一关（已修 bug）
      const wb = headerButtonAt(x, y);
      if (wb === 'retry') { AudioBus.play('ui'); retryLevel(); return true; }
      if (wb === 'audio') { view.audioOn = !view.audioOn; AudioBus.setEnabled(view.audioOn); AudioBus.play('ui'); return true; }
      if (wb === 'about') { openAbout(); return true; }
      if (view.levelIndex >= GAME_LEVELS.length - 1) { view.levelIndex = 0; buildWorld(); say(view.level.lines.intro, 3200); }
      else nextLevel();
      return true;
    }
    const btn = headerButtonAt(x, y);
    if (btn === 'clear') {
      // 非沙盒：按钮没画出来，静默吞掉这一下（那片区域本来就是空的头部）
      if (!inSandbox()) return true;
      AudioBus.play('ui');
      // 二次确认：清空是**不可逆**的，误触一次就把一园子造物抹掉不能接受。
      // 确认态 4 秒后自动解除，也不会被带到别的关卡。
      if (!view.clearArmed) {
        view.clearArmed = true;
        clearArmedAt = mainNow();
        toast('再点一次「确定？」，造物园就空了。', 3000);
        return true;
      }
      view.clearArmed = false;
      clearSandbox(store);
      buildWorld();                 // 重建＝把场上造物撤掉，并从（已清空的）存档复原
      toast('清空了。画点新的吧。', 2200);
      return true;
    }
    if (btn === 'about') { openAbout(); return true; }
    if (btn === 'retry') { AudioBus.play('ui'); retryLevel(); return true; }
    if (btn === 'audio') {
      view.audioOn = !view.audioOn;
      AudioBus.setEnabled(view.audioOn);
      AudioBus.play('ui');
      return true;
    }
    // ── 沙盒单条删除：命中「×」徽标 → 删这一个；否则点中造物 → 选中/取消；点空白 → 取消选中 ──
    // 这段只跑沙盒：非沙盒根本没有持久造物可选，且场景点空白处也不该被吞掉（免得误触挡住别的交互）。
    if (inSandbox()) {
      if (view.delBadge &&
          x >= view.delBadge.x && x <= view.delBadge.x + view.delBadge.w &&
          y >= view.delBadge.y && y <= view.delBadge.y + view.delBadge.h) {
        deleteSandboxCreature(view.selectedSandboxId);
        return true;
      }
      const hit = sandboxCreatureAt(x, y);
      if (hit !== -1) {
        view.selectedSandboxId = (view.selectedSandboxId === hit) ? null : hit;   // 再点一次同一只＝取消选中
        AudioBus.play('ui');
        return true;
      }
      if (view.selectedSandboxId != null) {   // 点空白处取消选中（不画图：场景点本就不落笔）
        view.selectedSandboxId = null;
        view.selBounds = null;
        view.delBadge = null;
        return true;
      }
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
    // 扉页期间：这一下只算「开始」，不落到画笔上——否则第一笔会画在看不见的地方，
    // 玩家以为没反应，其实已经落了一个造物。解锁音频仍走上面的同步路径（iOS 要求）。
    if (introActive) { endIntro(); ev.preventDefault(); return; }
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
    const sceneryList = lv.scenery || [];
    for (let si = 0; si < sceneryList.length; si++) {
      const s = sceneryList[si];
      const skey = (lv.id || 'lv') + '#' + s.kind + si;
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
      } else if (s.kind === 'haystack') {
        // L1-4 / L2-2 草垛：垛体 + 放射草纹 + 地面散稻草
        drawSc_Haystack(ctx, s, skey);
      } else if (s.kind === 'stall') {
        // L2-3 远景摊位剪影：背景不空
        drawSc_Stall(ctx, s);
      } else if (s.kind === 'stakes') {
        // L2-4 沟沿木桩 + 垂绳：强化"别掉下去"
        drawSc_Stakes(ctx, s, RenderQuality.tier);
      } else if (s.kind === 'canopyfold') {
        // L2-5 收货口棚布褶：读成软棚布而非木框
        drawSc_CanopyFold(ctx, s, RenderQuality.tier);
      } else if (s.kind === 'pennant') {
        // L2-1 布幡：静态画杆；旗面每帧由 drawAmbient 摆动
        drawSc_PennantPole(ctx, s);
      } else if (s.kind === 'water') {
        // L3-1 水塘：静态底 + 波纹；高光每帧由 drawAmbient 平移
        drawSc_Water(ctx, s, skey);
      } else if (s.kind === 'reeds') {
        // L3-2 芦苇/香蒲：静态画全丛；其中 2 根每帧由 drawAmbient 摆尖
        drawSc_Reeds(ctx, s, skey);
      } else if (s.kind === 'rust') {
        // L3-4 泵体锈迹 + 苔藓 + 滴线
        drawSc_Rust(ctx, s, RenderQuality.tier);
      } else if (s.kind === 'cracks') {
        // L3-5 干裂纹 + 翘起土片
        drawSc_Cracks(ctx, s, skey, RenderQuality.tier);
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
        // L1-5：洞口不再是"贴了块黑胶布"——上沿高光 + 内壁竖纹 + 口沿边缘石（art-polish 4.1）
        drawSc_PitDepth(ctx, s, (lv.id || 'lv') + '#pit' + (s.x1 | 0), RenderQuality.tier);
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

  function drawBodies(ctx, tMs) {
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
      if (b.label === 'prop' && b.plugin && b.plugin.kind === 'fish') {
        drawFish(ctx, b, tMs);
        continue;
      }
      if (b.label === 'prop' && b.plugin && b.plugin.kind === 'pumpkin') {
        drawPumpkin(ctx, b, tMs);
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
        const moving = Math.abs(vx) > 0.25;
        b.plugin = b.plugin || {};
        b.plugin.gait = (b.plugin.gait || 0) + Math.abs(vx) * 0.055;

        // ── 农夫「活」感 F1–F4（art-polish 第五章）──────────────────────────
        // 走路朝向永远优先；站着不动时才转头看造物（F2），否则走路与注视会打架。
        const a = runtime && runtime.state ? runtime.state.actor : null;
        const isOurActor = !!(a && a.body === b);
        let face = vx < -0.2 ? -1 : 1;
        let look = false;
        if (!moving && runtime) {
          let cx = null;
          for (const c of runtime.creatures || []) {
            const cb = c.bodies && c.bodies[0];
            if (cb && cb.position) cx = cb.position.x;   // 取最后一个（最新的造物）
          }
          if (cx != null && Math.abs(cx - b.position.x) > 6) {
            face = cx < b.position.x ? -1 : 1;
            look = true;
          }
        }
        // F1 挠头的空闲计时：以真实时刻记，不用固定步长累加（掉帧时不会误判）
        if (moving || !isOurActor) actorStillSince = null;
        else if (actorStillSince == null) actorStillSince = tMs;
        const idle = isOurActor && actorStillSince != null && tMs - actorStillSince > 1200;
        const jump = !!(isOurActor && a.jumping > 0);                 // F3
        const windy = !!(view.level && (view.level.scenery || []).some((s) => s.kind === 'wind'));  // F4
        drawFarmer(ctx, b.position.x, b.position.y, {
          phase: b.plugin.gait, face, t: tMs / 1000, jump, idle, look, windy,
        });
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

  /** 关5 的鱼：画成真正的锦鲤（椭圆身 + 摆尾 + 背鳍 + 眼 + 嘴），不再是与南瓜同款的橙色矩形。
   *  朝向随水平速度翻转，尾巴按时间轻摆，配暖橙渐变（背深肚浅）。物理体仍是矩形，仅作碰撞。 */
  function drawFish(ctx, body, tMs) {
    const p = body.position;
    const vx = (body.velocity && body.velocity.x) || 0;
    const dir = vx >= 0 ? 1 : -1;
    const w = (body.plugin && body.plugin.w) || 52;
    const h = (body.plugin && body.plugin.h) || 28;
    const sw = Math.sin((tMs / 1000) * 6) * 0.4;   // 摆尾相位
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(dir, 1);
    // 身体渐变：背深肚浅
    const grad = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grad.addColorStop(0, '#d9733a');
    grad.addColorStop(0.5, '#f3a45c');
    grad.addColorStop(1, '#fbd9a8');
    // 尾鳍（身体后方 = 左侧，已按 dir 翻转）
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 3, 0);
    ctx.quadraticCurveTo(-w / 2 - 16, -h / 2 - 4 + sw * 10, -w / 2 - 22, -2 + sw * 7);
    ctx.quadraticCurveTo(-w / 2 - 16, h / 2 + 4 + sw * 10, -w / 2 + 3, 0);
    ctx.closePath();
    ctx.fillStyle = '#f3a45c';
    ctx.strokeStyle = '#7a3d18';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    // 身体
    ctx.beginPath();
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.stroke();
    // 背鳍
    ctx.beginPath();
    ctx.moveTo(-4, -h / 2 + 1);
    ctx.quadraticCurveTo(4, -h / 2 - 13, 14, -h / 2 + 1);
    ctx.closePath();
    ctx.fillStyle = '#d9733a';
    ctx.fill();
    ctx.stroke();
    // 眼（前方 = 右侧）
    ctx.beginPath();
    ctx.arc(w / 2 - 11, -3, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w / 2 - 11.6, -3, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = '#222';
    ctx.fill();
    // 嘴
    ctx.beginPath();
    ctx.moveTo(w / 2 - 1, 4);
    ctx.lineTo(w / 2 - 7, 6.5);
    ctx.strokeStyle = '#7a3d18';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  /** 关2 的南瓜：画成「方形南瓜」，不再是一个橙色方块。
   *
   *  为什么还要是方的：关2 的教学前提就是「它是方的，所以不会滚」——子标题「它不肯走。它是方的。」、
   *  场景字「南瓜地（它是方的）」、失败提示「它是方的，自己不会走」都靠这句话成立；
   *  物理体也必须是矩形（D32 的 21px 悬空窗口是按矩形标定出来的）。
   *  所以这里不"画圆骗人"，而是把「方」做成角色设定：圆角方身 + 三条纵向瓜棱 + 瓜蒂 + 卷须 + 叶片，
   *  暖橙径向渐变（背深肚浅）+ 左上高光。读到的是"一颗方的南瓜"，不是"橙色纸箱"。
   *  姿态跟随 body.angle：翻倒时瓜蒂一起倒，形状与物理始终同一个姿态。 */
  function drawPumpkin(ctx, body) {
    const p = body.position;
    const pl = body.plugin || {};
    const w = pl.w || 62;
    const h = pl.h || 62;
    const hw = w / 2;
    const hh = h / 2;
    const bowX = Math.min(3.6, w * 0.058);    // 左右微鼓：瓜瓣的张力
    const bowY = Math.min(1.4, w * 0.022);    // 上下近乎平：保住"方"
    const r = Math.min(hw, hh) * 0.32;        // 圆角半径
    const lw = Math.max(1.8, w * 0.036);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(body.angle || 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const silhouette = () => {
      ctx.beginPath();
      ctx.moveTo(-hw + r, -hh);
      ctx.quadraticCurveTo(0, -hh - bowY, hw - r, -hh);
      ctx.quadraticCurveTo(hw, -hh, hw, -hh + r);
      ctx.quadraticCurveTo(hw + bowX, 0, hw, hh - r);
      ctx.quadraticCurveTo(hw, hh, hw - r, hh);
      ctx.quadraticCurveTo(0, hh + bowY, -hw + r, hh);
      ctx.quadraticCurveTo(-hw, hh, -hw, hh - r);
      ctx.quadraticCurveTo(-hw - bowX, 0, -hw, -hh + r);
      ctx.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      ctx.closePath();
    };

    // 瓜身：左上偏亮的径向渐变（背深肚浅）
    const grad = ctx.createRadialGradient(-hw * 0.28, -hh * 0.34, hh * 0.16, 0, 0, hh * 1.55);
    grad.addColorStop(0, '#f2a95c');
    grad.addColorStop(0.52, '#e0832f');
    grad.addColorStop(1, '#b95c1c');
    silhouette();
    ctx.fillStyle = grad;
    ctx.fill();

    // 纵向瓜棱：三条外弧把方身切成四瓣（"瓜"的辨识度主要靠这三笔）
    // 要点：棱必须**明显外弧**并且几乎贯通上下，否则读成"橙色盒子上的三道条纹"（实测踩过）。
    const ribLw = Math.max(1.5, w * 0.034);
    for (const rx of [-hw * 0.55, 0, hw * 0.55]) {
      const bulge = rx === 0 ? hw * 0.1 : Math.sign(rx) * hw * 0.21;
      const x0 = rx * 1.0;
      // 先给一道受光细边（棱右侧），再叠深色主棱 —— 两笔才有"瓣"的立体感
      ctx.beginPath();
      ctx.moveTo(x0 + ribLw * 0.7, -hh * 0.86);
      ctx.quadraticCurveTo(x0 + bulge + ribLw * 0.7, 0, x0 + ribLw * 0.7, hh * 0.86);
      ctx.strokeStyle = 'rgba(255,214,158,0.4)';
      ctx.lineWidth = ribLw * 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x0, -hh * 0.86);
      ctx.quadraticCurveTo(x0 + bulge, 0, x0, hh * 0.86);
      ctx.strokeStyle = 'rgba(122,58,16,0.5)';
      ctx.lineWidth = ribLw;
      ctx.stroke();
    }

    // 左上高光：径向渐隐（不能用硬边椭圆——那读成贴上去的浅色贴纸，实测）
    const hi = ctx.createRadialGradient(-hw * 0.42, -hh * 0.42, 0, -hw * 0.42, -hh * 0.42, hw * 0.72);
    hi.addColorStop(0, 'rgba(255,244,214,0.5)');
    hi.addColorStop(0.5, 'rgba(255,238,200,0.2)');
    hi.addColorStop(1, 'rgba(255,238,200,0)');
    silhouette();
    ctx.fillStyle = hi;
    ctx.fill();

    // 墨线轮廓（一笔深棕，手绘感）
    silhouette();
    ctx.strokeStyle = '#7a4718';
    ctx.lineWidth = lw;
    ctx.stroke();

    // 瓜蒂：短粗、上细下粗，从顶部偏右长出（翻倒时跟着倒）
    const stemW = Math.max(4, w * 0.09);
    ctx.beginPath();
    ctx.moveTo(hw * 0.03, -hh + 4);
    ctx.quadraticCurveTo(hw * 0.03, -hh - 5, -hw * 0.02, -hh - 9);
    ctx.strokeStyle = '#5e5530';
    ctx.lineWidth = stemW;
    ctx.stroke();
    ctx.strokeStyle = '#9a8d55';           // 受光侧一道细亮边
    ctx.lineWidth = Math.max(1.2, w * 0.026);
    ctx.stroke();

    // 卷须：从蒂根往左甩一小圈（南瓜的标志件之一）
    ctx.strokeStyle = '#6f7a3f';
    ctx.lineWidth = Math.max(1.2, w * 0.026);
    ctx.beginPath();
    ctx.moveTo(-hw * 0.02, -hh - 5);
    ctx.quadraticCurveTo(-hw * 0.3, -hh - 13, -hw * 0.46, -hh - 7);
    ctx.quadraticCurveTo(-hw * 0.56, -hh - 2, -hw * 0.42, -hh - 3);
    ctx.stroke();

    // 叶片：一片带缺刻的尖叶（两侧弧 + 主脉 + 两条侧脉），别画成"草叶"
    ctx.beginPath();
    ctx.moveTo(hw * 0.14, -hh + 2);
    ctx.quadraticCurveTo(hw * 0.3, -hh - 9, hw * 0.66, -hh - 12);
    ctx.quadraticCurveTo(hw * 0.92, -hh - 13, hw * 0.98, -hh - 9);
    ctx.quadraticCurveTo(hw * 0.72, -hh - 4.5, hw * 0.58, -hh + 0.5);
    ctx.quadraticCurveTo(hw * 0.4, -hh - 0.5, hw * 0.14, -hh + 2);
    ctx.closePath();
    ctx.fillStyle = '#7d8c46';
    ctx.fill();
    ctx.strokeStyle = '#4a5628';
    ctx.lineWidth = Math.max(1.1, w * 0.022);
    ctx.stroke();
    ctx.beginPath();                       // 主脉
    ctx.moveTo(hw * 0.18, -hh + 1);
    ctx.quadraticCurveTo(hw * 0.6, -hh - 6, hw * 0.94, -hh - 9.5);
    ctx.stroke();
    for (const t of [0.34, 0.62]) {        // 侧脉
      const bx = hw * (0.18 + (0.94 - 0.18) * t);
      const by = -hh + 1 - 7 * t;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + hw * 0.05, by - hh * 0.16);
      ctx.lineWidth = Math.max(0.9, w * 0.016);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawBook(ctx) {
    // 纸底已由 paperLayer 烘焙（见 frame），这里只画笔迹（art-polish 3.4）
    // 已落笔的笔画
    for (const s of capture.strokes) drawFreehandStroke(ctx, s.pts, 5);
    const live = capture.live;
    if (live && live.length) drawFreehandStroke(ctx, live, 5);
    view.livePoints = capture.pointCount + (live ? live.length : 0);
    view.strokeCount = capture.strokes.length + (live ? 1 : 0);
  }

  /** 造物簿纸面烘焙（art-polish 3.4）：drawPaper + 质感追加，只跑一次 */
  function drawPaperBake(ctx) {
    drawPaper(ctx, 0, BOOK_TOP, DESIGN_W, BOOK_H);
    ctx.save();
    // ① 顶部微亮→底部微暖的竖向 wash（半透明叠加，不盖格线）
    const wash = ctx.createLinearGradient(0, BOOK_TOP, 0, DESIGN_H);
    wash.addColorStop(0, 'rgba(248,244,232,0.5)');
    wash.addColorStop(1, 'rgba(244,238,223,0.5)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, BOOK_TOP, DESIGN_W, BOOK_H);
    // ② 页眉撕口/毛边：顶边一排极短墨点（P5）
    ctx.fillStyle = 'rgba(90,80,64,0.35)';
    const rng = mulberry32(20261028);
    for (let i = 0; i < 9; i++) {
      const gx = 14 + (DESIGN_W - 28) * (i / 8) + (rng() - 0.5) * 10;
      ctx.fillRect(gx, BOOK_TOP + 2.5, 2.5 + rng() * 2, 1);
    }
    // ③ 旧墨渍 2 处：贴非书写区（左下/右下角），不压正文
    ctx.fillStyle = 'rgba(150,96,74,0.05)';
    ctx.beginPath(); ctx.arc(46, DESIGN_H - 60, 30, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(DESIGN_W - 60, DESIGN_H - 140, 22, 0, Math.PI * 2); ctx.fill();
    // ④ 书页与场景分隔：BOOK_TOP 处 6px 内投影（场景的边落在纸上）
    const inset = ctx.createLinearGradient(0, BOOK_TOP, 0, BOOK_TOP + 6);
    inset.addColorStop(0, 'rgba(90,80,64,0.10)');
    inset.addColorStop(1, 'rgba(90,80,64,0)');
    ctx.fillStyle = inset;
    ctx.fillRect(0, BOOK_TOP, DESIGN_W, 6);
    ctx.restore();
  }

  /** 确定性 PRNG（局部用；与 scenery.js 的 mulberry32 同实现，避免跨模块导出私有辅助） */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
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
    // 扉页生命周期：到点自动结束；结束后补说开场句（若已跳过则第一帧就说）
    if (introActive && t - introT0 >= INTRO_HOLD_MS + INTRO_FADE_MS) introActive = false;
    if (!introActive && !introLineSaid && runtime) {
      introLineSaid = true;
      say(view.level.lines.intro, 3200);   // 开场句：扉页落下那一刻，仅一句
    }
    const physStart = mainNow();
    if (runtime && (introActive || view.about)) { /* 扉页 / 关于展开期间冻结物理：否则读文档时小人已经掉下去了 */ }
    else if (runtime && view.win === false) runtime.step(Math.max(0, Math.min(3, steps)));
    else if (runtime && steps > 0) runtime.step(0);
    const physMs = mainNow() - physStart;
    if (view.win && steps > 0 && !winTimer) { /* 过关后不再推进物理 */ }

    view.now = t;
    view.frameMs = dt;
    // 「清空」的二次确认 4 秒后自动解除：玩家点了第一下又改主意，不该一直挂在"待确认"上
    if (view.clearArmed && t - clearArmedAt > 4000) view.clearArmed = false;
    view.fps = view.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
    PerfGovernor.sample(dt, physMs);
    if (view.failFlash > 0) view.failFlash = Math.max(0, view.failFlash - dt / 600);
    AudioBus.tickVoice();   // C.5 挂起 / C.4 延后的推进（幂等）
    if (runtime) view.snapshot = runtime.snapshot();
    // 沙盒单条删除：每帧重算选中造物的实时包围盒与「×」徽标位置（造物会掉、会滚，徽标得跟着走）
    view.selBounds = null;
    view.delBadge = null;
    if (inSandbox() && view.selectedSandboxId != null && runtime) {
      const sc = runtime.creatures.find((x) => x.id === view.selectedSandboxId);
      if (sc && sc.bodies.length) {
        let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (const b of sc.bodies) {
          minX = Math.min(minX, b.bounds.min.x); maxX = Math.max(maxX, b.bounds.max.x);
          minY = Math.min(minY, b.bounds.min.y); maxY = Math.max(maxY, b.bounds.max.y);
        }
        const bx = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        view.selBounds = bx;
        view.delBadge = { x: bx.x + bx.w + 2, y: bx.y - 22, w: 22, h: 22 };
      } else {
        view.selectedSandboxId = null;   // 选中对象已经没了（掉出世界等），自动取消
      }
    }
    if (view.impactDebugOn && world) view.impactDebug = world.impactDebug;

    surface.beginFrame('#efe7d6');
    const ctx = surface.ctx;
    staticLayer.ensure(drawStatics);
    staticLayer.blit(ctx);
    paperLayer.ensure(drawPaperBake);   // 与关卡无关，第一次后命中缓存直接 blit
    paperLayer.blit(ctx);
    drawBodies(ctx, t);
    // 动态布景（风/水光/涟漪/旗摆/芦苇摆）夹在造物与造物簿之间：
    // 它在造物之上（水光能盖住造物边缘，读起来才像"泡在水里"），但绝不越界进造物簿。
    drawAmbient(ctx, view.level, t / 1000, RenderQuality.tier, BOOK_TOP);
    drawBook(ctx);
    drawHud(ctx, view);
    // 关于浮层：在 HUD 之上、扉页之下（开场时打不开，所以不会被扉页盖住）
    if (view.about) drawAbout(ctx, view);
    // 扉页画在最后一层：它要盖住 HUD，否则开场时芯片/进度条会和标题抢读
    if (introActive) {
      const el = t - introT0;
      const a = el <= INTRO_HOLD_MS ? 1 : Math.max(0, 1 - (el - INTRO_HOLD_MS) / INTRO_FADE_MS);
      drawTitleCard(ctx, { alpha: a, now: t });
    }
    surface.endFrame();
    requestAnimationFrame(frame);
  }

  buildWorld();
  requestAnimationFrame(frame);
  // 开场句不在这里播：改由 frame 在扉页落下的那一刻说（introLineSaid），
  // 否则台词会在扉页还盖着屏幕时念完，玩家只听见声音看不到人。

  return {
    view, bus, surface, store, progress,
    get runtime() { return runtime; },
    get world() { return world; },
    capture,
    retryLevel, nextLevel,
    skipIntro: endIntro,
    version: APP_VERSION,
    // 性能三件套暴露给自测/诊断（tools/perf-probe.mjs 按 tier 压测要用；QA 也按名 grep）
    perf: PerfGovernor,
    quality: RenderQuality,
    // 暴露给自测：冒烟要能在进沙盒那一刻拦到 AudioBus.play('chapter')，
    // 证明「章节切换音」真的接上了，而不是只在源码里写着。
    audio: AudioBus,
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
