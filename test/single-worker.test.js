// Tests for the single-output solver (js/worker/worker.js) and its helpers.
// Every expression the worker returns is re-evaluated by an independent
// evaluator below, so a wrong answer fails even if the code "runs fine".
import { test } from "node:test";
import assert from "node:assert/strict";
import { Dictionary } from "../js/data/dictionary.js";
import { Terms } from "../js/data/terms.js";
import { negate } from "../js/data/gates.js";
import { Queue } from "../js/model/Queue.js";

// worker.js assigns the global `onmessage` and calls `postMessage`, like a Web Worker.
// Assigned untyped: these are Web Worker globals, not the window ones.
const g = /** @type {any} */ (globalThis);
let posted;
g.onmessage = null;
g.postMessage = (m) => (posted = m);
await import("../js/worker/worker.js");
const send = (data) => {
  posted = undefined;
  g.onmessage({ data });
  return posted;
};

// --- independent evaluator -------------------------------------------------
// Bit r of a truth table is the output for input row r; "a" is the highest input bit.
const VARS = "abcd";
function evalTerm(sym, n, row) {
  if (sym === "0") return 0;
  if (sym === "1") return 1;
  let v = sym.startsWith("¬") ? 1 : 0;
  for (const ch of sym.replace("¬", "")) v ^= (row >> (n - 1 - VARS.indexOf(ch))) & 1;
  return v;
}
function parseExpr(expr) {
  const m = expr.match(/^(¬?)([⊕∧])\((.*)\)$/);
  return m ? { neg: m[1] === "¬", gate: m[2], terms: m[3].split(", ") } : { terms: [expr] };
}
function evalExpr(expr, n) {
  const { neg, gate, terms } = parseExpr(expr);
  let out = 0;
  for (let row = 0; row < 2 ** n; row++) {
    const vals = terms.map((s) => evalTerm(s, n, row));
    const ones = vals.filter(Boolean).length;
    let bit = !gate ? vals[0] : gate === "⊕" ? +(ones === 1) : +(ones === vals.length);
    if (neg) bit ^= 1;
    out |= bit << row;
  }
  return out;
}
const sameOutsideMask = (a, b, mask, n) => ((a ^ b) & ~mask & ((1 << 2 ** n) - 1)) === 0;
const lampOf = (n) => new Map(Terms[n].map(([s, , lamp]) => [s, lamp]));
const depthMap = (n) => new Map(Dictionary[n - 2]);

/**
 * Checks one solver result: right function, and wire/lamp data matching its terms.
 * @param {[string, *]} result expression and its lamp data
 * @param {number} n variable count
 * @param {number} term
 * @param {number} mask
 */
function checkResult([expr, lamps], n, term, mask) {
  assert.ok(sameOutsideMask(evalExpr(expr, n), term, mask, n), `${expr} != ${term.toString(2)}`);
  const { gate, terms } = parseExpr(expr);
  const lamp = lampOf(n);
  if (gate) assert.deepEqual(lamps, terms.map((s) => lamp.get(s)), expr);
  else assert.equal(lamps, lamp.get(expr), expr);
  return terms.length;
}

// --- helpers ----------------------------------------------------------------
test("Queue is FIFO and returns null when empty", () => {
  const q = new Queue();
  assert.equal(q.empty(), true);
  assert.equal(q.dequeue(), null);
  const a = { v: 1 }, b = { v: 2 }, c = { v: 3 };
  q.enqueue(a);
  q.enqueue(b);
  assert.equal(q.dequeue(), a);
  q.enqueue(c);
  assert.equal(q.dequeue(), b);
  assert.equal(q.dequeue(), c);
  assert.equal(q.empty(), true);
});

test("negate flips only the 2^n truth-table bits", () => {
  assert.equal(negate(0b0011, 2), 0b1100);
  assert.equal(negate(0, 3), 0xff);
  assert.equal(negate(0, 4), 0xffff);
  assert.equal(negate(0xffff, 4), 0);
});

test("every Terms entry evaluates to its truth table", () => {
  for (const n of [2, 3, 4])
    for (const [sym, table] of Terms[n]) assert.equal(evalExpr(sym, n), table, sym);
});

// --- dictionary -------------------------------------------------------------
// The "test" action is how dictionary.js was generated; regenerating it proves the data file.
for (const n of [2, 3, 4]) {
  test(`"test" action regenerates the ${n}-input dictionary`, () => {
    const r = send({ action: "test", varCount: n, maxDepth: n + 1 });
    assert.equal(r.action, "test");
    assert.deepEqual(r.results.filter((a) => a != null), Dictionary[n - 2]);
  });
}

// --- single gate search -----------------------------------------------------
for (const n of [2, 3]) {
  test(`every ${n}-input function is solved correctly at its minimum size`, () => {
    const depth = depthMap(n);
    for (let term = 0; term < 2 ** 2 ** n; term++) {
      const r = send({ action: "search", varCount: n, maxDepth: n + 1, term, mask: 0 });
      assert.equal(r.action, "result");
      const sizes = r.results.map((res) => checkResult(res, n, term, 0));
      assert.equal(Math.min(...sizes), depth.get(term), `min size for ${term}`);
    }
  });
}

test("don't cares: the README example gives the documented answer", () => {
  // "xxx0011011001100" as main.js parses it.
  const term = 0b1110011011001100, mask = 0b1110000000000000;
  const r = send({ action: "search", varCount: 4, maxDepth: 5, term, mask });
  assert.equal(r.action, "result");
  r.results.forEach((res) => checkResult(res, 4, term, mask));
  assert.ok(r.results.some(([e]) => e === "⊕(¬c, ¬ac, ¬cd, acd)"));
});

test("search returns undefined when maxDepth is too small", () => {
  const [term] = Dictionary[2].find(([, d]) => d === 5);
  const r = send({ action: "search", varCount: 4, maxDepth: 1, term, mask: 0 });
  assert.deepEqual(r, { action: "result", results: undefined });
});

// --- two gate search --------------------------------------------------------
test("functions outside the dictionary are split into the cheapest XOR pair", () => {
  const depth = depthMap(4);
  const missing = [];
  for (let t = 0; missing.length < 2; t++) if (!depth.has(t)) missing.push(t);

  for (const term of missing) {
    let best = Infinity;
    for (const [x, dx] of depth) if (depth.has(term ^ x)) best = Math.min(best, dx + depth.get(term ^ x));

    const r = send({ action: "search", varCount: 4, maxDepth: 5, term, mask: 0 });
    assert.equal(r.action, "double");
    const f1 = evalExpr(r.results1[0][0], 4);
    const f2 = evalExpr(r.results2[0][0], 4);
    r.results1.forEach((res) => checkResult(res, 4, f1, 0));
    r.results2.forEach((res) => checkResult(res, 4, f2, 0));
    assert.equal(f1 ^ f2, term, "two gates XOR to the target");
    assert.equal(depth.get(f1) + depth.get(f2), best, "pair is the cheapest");
  }
});

test("with don't cares, the XOR pair uses the cheapest term among those the mask merges", () => {
  const mask = 0b1;
  // Masking merges dictionary entries; keep the cheapest of each.
  const depth = new Map();
  for (const [t, d] of Dictionary[2]) {
    const m = t | mask;
    if (!depth.has(m) || d < depth.get(m)) depth.set(m, d);
  }
  let term = mask;
  while (depth.has(term)) term = (term + 2) | mask;

  let best = Infinity;
  for (const [x, dx] of depth) {
    const y = (term ^ x) | mask;
    if (depth.has(y)) best = Math.min(best, dx + depth.get(y));
  }

  const r = send({ action: "search", varCount: 4, maxDepth: 5, term, mask });
  assert.equal(r.action, "double");
  const f1 = evalExpr(r.results1[0][0], 4) | mask;
  const f2 = evalExpr(r.results2[0][0], 4) | mask;
  r.results1.forEach((res) => checkResult(res, 4, f1, mask));
  r.results2.forEach((res) => checkResult(res, 4, f2, mask));
  assert.ok(sameOutsideMask(f1 ^ f2, term, mask, 4), "two gates XOR to the target");
  assert.equal(depth.get(f1) + depth.get(f2), best, "pair is the cheapest");
});
