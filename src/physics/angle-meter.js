/**
 * src/physics/angle-meter.js —— 自转角累加器（关2「滚」的判据工具）
 *
 * 为什么需要它：只看首末 `angle` 差值会漏掉来回摆——南瓜先转 +1.2 rad 再转回 −1.2 rad，
 * 首末差值 0，但它其实转了两圈多里的一小段。判"它到底滚了没有"必须**逐帧累加 |Δangle|**。
 *
 * 用法：const m = createAngleMeter(body); 每帧 m.sample(); m.total / m.maxOmega / m.net
 */
export function createAngleMeter(body) {
  let last = body ? body.angle : 0;
  let total = 0;      // 累计 |Δangle|（弧度）
  let net = 0;        // 首末差（会互相抵消，只作对照）
  let maxOmega = 0;   // 单帧最大 |Δangle|
  let frames = 0;
  return {
    sample() {
      if (!body) return;
      let d = body.angle - last;
      // 角度可能被归一化到 (−π, π]，跨 ±π 时补一圈，避免把真实转动算成反向
      if (d > Math.PI) d -= Math.PI * 2;
      else if (d < -Math.PI) d += Math.PI * 2;
      last = body.angle;
      total += Math.abs(d);
      net += d;
      if (Math.abs(d) > maxOmega) maxOmega = Math.abs(d);
      frames++;
    },
    get total() { return total; },
    get net() { return net; },
    get maxOmega() { return maxOmega; },
    get turns() { return total / (Math.PI * 2); },
    get frames() { return frames; },
    reset() { last = body ? body.angle : 0; total = 0; net = 0; maxOmega = 0; frames = 0; },
  };
}
