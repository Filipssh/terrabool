// A tiny fake DOM, localStorage and Worker: just enough for js/main.js and
// js/state/handler.js to load and run in Node. Call installFakeDom() before
// importing main.js; each test file runs in its own process.

export class El {
  style = {};
  value = "";
  innerHTML = "";
  innerText = "";
  checked = false;
  disabled = false;
  children = [];
  attrs = {};
  listeners = {};
  classList = {
    set: new Set(),
    add(c) { this.set.add(c); },
    remove(c) { this.set.delete(c); },
    contains(c) { return this.set.has(c); },
  };
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  setAttribute(k, v) { this.attrs[k] = v; }
  /**
   * @param {string} type
   * @param {any} [target] the event target, this element by default
   */
  fire(type, target = this) {
    for (const fn of this.listeners[type] ?? []) fn.call(this, { preventDefault() {}, target });
  }
}

/**
 * Installs the fakes on globalThis.
 * @param {Record<string, string>} [stored] initial localStorage contents
 */
export function installFakeDom(stored = {}) {
  // The fakes only implement what the app uses, so assign them untyped.
  const g = /** @type {any} */ (globalThis);
  const els = {};
  const el = (id) => (els[id] ??= new El());
  /** @type {Record<string, Function>} */
  const docListeners = {};
  g.document = {
    getElementById: el,
    querySelectorAll: (sel) => (sel === "#tabbar input" ? [el("btn_single"), el("btn_multi")] : []),
    addEventListener: (t, fn) => (docListeners[t] = fn),
  };
  const storage = new Map(Object.entries(stored));
  g.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const workers = [];
  g.Worker = class {
    // noinspection JSMismatchedCollectionQueryUpdate
    sent = [];
    constructor(url) { this.url = url; workers.push(this); }
    postMessage(m) { this.sent.push(m); }
    terminate() {}
  };
  return { el, docListeners, storage, workers };
}
