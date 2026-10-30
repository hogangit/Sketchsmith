/**
 * tests/voice-scheduler.test.mjs —— 语音排队/配额（audio-spec-v2 附录 C.1 / C.1b / C.2）
 *
 * 这个文件逐条对应 audio-director 给的"出包前自查清单"。
 * 为什么配额这种东西必须能断言：它出错时的症状是"字幕都出来了，却一句都没念"，
 * 看起来像语音功能坏了（第一反应会去查 getVoices），排查方向全错。
 *
 * 用法：node --test tests/voice-scheduler.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createVoiceScheduler, LINE_LEVEL, VOICE_SPEAKER_INTERVAL_MS, VOICE_PENDING_TTL_MS,
} from '../src/audio/voice-scheduler.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 假时钟 + 假 backend：起播/结束由测试手动触发，才能逐帧验时序 */
function harness({ onScreen = true, quota = true } = {}) {
  let t = 0;
  let lastReq = null;
  const asked = [];
  const s = createVoiceScheduler({
    backend: {
      speak(req) { lastReq = req; asked.push(req.lineId); },
      cancel() { lastReq = null; },
    },
    now: () => t,
    isOnScreen: () => onScreen,
    precheckQuota: () => quota,
  });
  return {
    s,
    asked,
    advance(ms) { t += ms; s.tick(); },
    fireStart() { if (lastReq && lastReq.onStart) lastReq.onStart(); },
    fireEnd() { if (lastReq && lastReq.onEnd) lastReq.onEnd(); lastReq = null; },
    setOnScreen(v) { onScreen = v; },
    lines: () => s.state.budget.lines,
  };
}

test('C.1 ⑤ 唯一扣费点：没起播就不许扣', () => {
  const h = harness();
  assert.equal(h.s.request({ lineId: 'l1_win', speaker: '农夫', level: LINE_LEVEL.SUCCESS }), 'queued');
  assert.equal(h.lines(), 0, '请求播出 ≠ 已播出，onstart 之前不许扣');
  h.fireStart();
  assert.equal(h.lines(), 1, 'onstart 之后才扣 1 次');
});

test('C.1 ① C5 挂起：不在画面内不扣、不丢；入画后正常播且只扣 1 次', () => {
  const h = harness({ onScreen: false });
  assert.equal(h.s.request({ lineId: 'l3_intro', speaker: '水泵', level: LINE_LEVEL.INTRO }), 'blocked');
  assert.equal(h.lines(), 0, 'C5 拦下不许扣');
  assert.ok(h.s.state.pending, 'C5 是**挂起**不是丢弃（关3 水泵那句还等着入画）');
  h.advance(2000);
  assert.equal(h.lines(), 0, '挂起期间也不许扣');
  h.setOnScreen(true);
  h.advance(16);
  h.fireStart();
  assert.equal(h.lines(), 1, '延后成功、真正起播时才扣，且只扣 1 次');
});

test('C.1 ③ C4 同音色 45s：延后期间不扣，到点起播只扣 1 次', () => {
  const h = harness();
  h.s.request({ lineId: 'l1_win', speaker: '农夫', level: LINE_LEVEL.SUCCESS });
  h.fireStart();
  h.fireEnd();
  assert.equal(h.lines(), 1);
  // 同一个说话人紧接着再说一句 → 必须延后到 45s
  h.s.request({ lineId: 'l2_intro', speaker: '农夫', level: LINE_LEVEL.INTRO });
  h.advance(VOICE_SPEAKER_INTERVAL_MS - 1000);
  assert.equal(h.lines(), 1, '延后期间不许扣（白等还扣额度是最糟的组合）');
  assert.ok(h.s.state.pending, '延后是入队等待，不是丢弃');
  h.advance(2000);
  h.fireStart();
  assert.equal(h.lines(), 2, '到点起播才扣第 2 次');
});

test('C.1b 终止（已起播）：额度已扣且不回滚', () => {
  const h = harness();
  h.s.request({ lineId: 'l1_win', speaker: '农夫', level: LINE_LEVEL.SUCCESS });
  h.fireStart();
  assert.equal(h.lines(), 1);
  assert.equal(h.s.abortSpeaking('level-change'), true);
  assert.equal(h.s.state.playing, null, '切关必须停掉（音画脱钩会被当 bug 报）');
  assert.equal(h.lines(), 1, '已起播被打断 = 已消耗，不许回滚（否则能刷额度）');
});

test('C.1b 抢占（未起播）：额度一次都不扣', () => {
  const h = harness();
  h.s.request({ lineId: 'l1_win', speaker: '农夫', level: LINE_LEVEL.SUCCESS });
  h.fireStart();
  h.fireEnd();
  h.s.request({ lineId: 'l2_intro', speaker: '农夫', level: LINE_LEVEL.INTRO });   // 被 C4 延后 → 在队列里
  const before = h.lines();
  assert.equal(h.s.dropPending(), true);
  assert.equal(h.lines(), before, '抢占未起播的句子不许扣');
  assert.equal(h.s.state.pending, null);
});

test('C.1b 队列满（1 在播 + 1 等待）：丢的是"尚未起播的最低级别"', () => {
  const h = harness();
  h.s.request({ lineId: 'l1_win', speaker: '农夫', level: LINE_LEVEL.SUCCESS });   // 在播（不结束）
  h.s.request({ lineId: 'amb_a', speaker: 'A', level: LINE_LEVEL.AMBIENT });        // 等待（可抢占）
  assert.equal(h.s.state.pending.lineId, 'amb_a');
  // 队满，新来一条更重要（开场）→ 挤掉等待位里的环境句
  h.s.request({ lineId: 'l4_intro', speaker: 'B', level: LINE_LEVEL.INTRO });
  assert.equal(h.s.state.pending.lineId, 'l4_intro', '更高级别的开场应挤掉环境句');
  // 队满，新来一条更低优先级 → 新的被拒，等待位不动
  const r = h.s.request({ lineId: 'amb_b', speaker: 'C', level: LINE_LEVEL.AMBIENT });
  assert.equal(r, 'dropped', '更低优先级的句子不该挤掉已经等待的句子');
  assert.equal(h.s.state.pending.lineId, 'l4_intro');
  // 同级不换（先到先等，避免同级来回颠簸）
  assert.equal(h.s.request({ lineId: 'amb_c', speaker: 'C', level: LINE_LEVEL.INTRO }), 'dropped');
  // 受额度约束的句子在等时，任何可抢占的句子都不许挤掉它
  h.s.dropPending();
  h.s.request({ lineId: 'common_fail2', speaker: 'D', level: LINE_LEVEL.SCOPED });
  const r2 = h.s.request({ lineId: 'amb_d', speaker: 'E', level: LINE_LEVEL.AMBIENT });
  assert.equal(r2, 'dropped');
  assert.equal(h.s.state.pending.lineId, 'common_fail2', '受额度约束的等待句不许被抢占');
  assert.equal(h.lines(), 0, '这一路全是排队/被拒，一次都没起播 → 额度一次都不许扣');
});

test('C.1 ② 配额预检只读：额度不够就直接不出队，且不扣、不做 C4 延后', () => {
  const h = harness({ quota: false });
  assert.equal(h.s.request({ lineId: 'common_fail2', speaker: '农夫', level: LINE_LEVEL.SCOPED }), 'dropped');
  assert.equal(h.lines(), 0);
  assert.equal(h.s.state.pending, null, '预检不过 → 直接不出队（不留着等，避免白等 45s）');
});

test('C.2 两套额度不混：纯文字台词走多少次都不动语音额度', async () => {
  // 纯文字台词（形态台词 / 失败暗示）按 C.2 不在 6 类语音时机内 → 根本不进语音队列。
  // 这里用真 AudioBus 验：node 里没有 speechSynthesis → 语音不可用 → speak 恒 false，额度必须纹丝不动。
  const { createAudioBus } = await import('../src/audio/audio-bus.js');
  const bus = createAudioBus();
  for (let i = 0; i < 20; i++) bus.speak('common_fail2', '不急。我等你。真的。', { speaker: '农夫' });
  assert.equal(bus.voiceStateSnapshot.budget.lines, 0, '20 次纯文字台词后语音额度必须仍是满的');
  assert.equal(bus.voiceStateSnapshot.budget.linesLeft, 30);
});

test('cancel 全仓库只允许一处（abortSpeaking 走的那个 backend）', () => {
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (line.indexOf('speechSynthesis.cancel(') >= 0) hits.push(path.relative(ROOT, f) + ':' + (i + 1));
    });
  }
  assert.equal(hits.length, 1, 'speechSynthesis.cancel( 只应出现 1 处，实际：' + hits.join(', '));
  assert.ok(hits[0].indexOf('audio-bus.js') >= 0, '且必须在 audio-bus 的 voiceBackend.cancel 里');
});

test('C.1b 级别按"时机"推，不按文案内容手标', async () => {
  const { lineVoiceLevel } = await import('../src/text/lines.js');
  assert.equal(lineVoiceLevel('l1_win'), LINE_LEVEL.SUCCESS);
  assert.equal(lineVoiceLevel('stamp1'), LINE_LEVEL.SUCCESS);
  assert.equal(lineVoiceLevel('common_fail2'), LINE_LEVEL.SCOPED);
  assert.equal(lineVoiceLevel('form_beam'), LINE_LEVEL.SCOPED);
  assert.equal(lineVoiceLevel('l2_intro'), LINE_LEVEL.INTRO);
  assert.equal(lineVoiceLevel('whatever'), LINE_LEVEL.AMBIENT);
});
