/**
 * src/core/bus.js —— 事件总线
 *
 * 能力钩子、音频、HUD 都挂在总线上。**handler 真被调用的次数要能读出来**：
 * 只 connect 不计数等于没验证过（见 tests 目录里的计数断言用例）。
 */
export function createBus() {
  /** @type {Map<string, Array<{fn:Function, tag:string}>>} */
  const handlers = new Map();
  const emitted = Object.create(null);
  const handled = Object.create(null);

  function on(ev, fn, tag) {
    if (typeof fn !== 'function') throw new TypeError(`bus.on(${ev}) 需要函数`);
    if (!handlers.has(ev)) handlers.set(ev, []);
    handlers.get(ev).push({ fn, tag: tag || ev });
    return () => off(ev, fn);
  }

  function off(ev, fn) {
    const list = handlers.get(ev);
    if (!list) return;
    const i = list.findIndex((h) => h.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }

  function emit(ev, payload) {
    emitted[ev] = (emitted[ev] || 0) + 1;
    const list = handlers.get(ev);
    if (!list) return 0;
    let n = 0;
    for (const h of list.slice()) {
      try {
        h.fn(payload, ev);
        handled[h.tag] = (handled[h.tag] || 0) + 1;
        n++;
      } catch (err) {
        if (typeof console !== 'undefined') console.warn(`[bus] handler 抛错 @${ev}:`, err);
      }
    }
    return n;
  }

  return {
    on,
    off,
    emit,
    get emitted() { return emitted; },
    get handled() { return handled; },
    countOf(tag) { return handled[tag] || 0; },
    emitCount(ev) { return emitted[ev] || 0; },
  };
}
