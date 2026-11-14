// Tests for the multi-output solver (js/worker/transmatrix.js).
// Every matrix the worker returns is checked independently: XOR-ing its gates as
// the inverse rows say must give back the original outputs, and its cost must match
// the dictionary. Small cases are also compared with a brute-force search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Dictionary } from "../js/data/dictionary.js";
import { Terms } from "../js/data/terms.js";
import { gateLamps, wire } from "../js/worker/wiring.js";
import { checkLayout, checkRoutes, checkWiring } from "./wiring-check.js";

// transmatrix.js assigns the global `onmessage` and calls `postMessage`, like a Web Worker.
// Assigned untyped: these are Web Worker globals, not the window ones.
const g = /** @type {any} */ (globalThis);
let posted = [];
g.onmessage = null;
g.postMessage = (m) => posted.push(m);
await import("../js/worker/transmatrix.js");

/** Sends a "generate" request; returns the matrices and the progress messages. */
function generate(data) {
  posted = [];
  g.onmessage({ data: { action: "generate", ...data } });
  const last = posted.pop();
  assert.equal(last.action, "matrices");
  assert.ok(posted.every((m) => m.action === "count"));
  return { matrices: last.results, counts: posted.map((m) => m.count) };
}

// --- independent reference ----------------------------------------------------
/** Cheapest lamp count of a single gate for `t`, ignoring don't cares; Infinity if none. */
function minLamps(t, mask, n) {
  let best = Infinity;
  for (const [d, lamps] of Dictionary[n - 2]) if ((d | mask) === (t | mask)) best = Math.min(best, lamps);
  return best;
}
/** XOR of the values whose bit is set in `bits`. */
const xorOf = (bits, values) => values.reduce((acc, v, j) => (((bits >> j) & 1) === 1 ? acc ^ v : acc), 0);
/** Rank of a set of bit vectors over GF(2). */
function rank(vectors) {
  const basis = [];
  for (let v of vectors) {
    for (const b of basis) v = Math.min(v, v ^ b);
    if (v) basis.push(v);
  }
  return basis.length;
}
/** All k-element subsets of `items`. */
function* subsets(items, k, start = 0, picked = []) {
  if (picked.length === k) return yield picked;
  for (let i = start; i < items.length; i++) yield* subsets(items, k, i + 1, [...picked, items[i]]);
}
const binom = (n, k) => (k < 0 || k > n ? 0 : k === 0 ? 1 : (binom(n - 1, k - 1) * n) / k);

/** Every combination of outputs that one gate can produce. */
function goodCombos(terms, mask, n) {
  const good = [];
  for (let c = 1; c < 2 ** terms.length; c++) if (minLamps(xorOf(c, terms), mask, n) < Infinity) good.push(c);
  return good;
}
/**
 * Each gate's lamps, as the wiring solver gets them.
 * @returns {{okSets: number, expressions: {expression: string, lamps: {name: string, colours: number}[]}[],
 *   padded: {expression: string, lamps: {name: string, colours: number}[]}[]}[]}
 */
const lampsOf = (transitioned, mask, n) => transitioned.map((term) => gateLamps({ term, mask, varCount: n }));

/**
 * Brute force: number of invertible matrices, how many of them can be wired, and the
 * cheapest wireable cost (cheapest gates, no pads). Wireability comes from wire(), which
 * wiring.test.js checks against its own brute force: plainly, or with pad lamps when every
 * output is on one wire or (up to 4 outputs) every wire has its own colour.
 */
function bruteForce(terms, mask, n) {
  let invertible = 0, count = 0, best = Infinity;
  const size = terms.length;
  for (const pick of subsets(goodCombos(terms, mask, n), size)) {
    if (rank(pick) !== size) continue;
    invertible++;
    const transitioned = pick.map((c) => xorOf(c, terms));
    // Inverse row p: the gates whose combinations XOR to output p alone.
    const rows = terms.map((_, p) => {
      for (let i = 1; i < 2 ** size; i++) if (xorOf(i, pick) === 1 << p) return i;
    });
    const lamps = lampsOf(transitioned, mask, n);
    const options = {
      rows,
      okSets: lamps.map((l) => l.okSets),
      expressions: lamps.map((l) => l.expressions),
      padded: lamps.map((l) => l.padded),
    };
    const wireable =
      wire(options).status === "ok" ||
      wire({ ...options, cleanOutputs: true, maxPads: size }).status === "ok" ||
      (size <= 4 && wire({ ...options, distinctOutputs: true, maxPads: size }).status === "ok");
    if (!wireable) continue;
    count++;
    best = Math.min(best, transitioned.reduce((s, t) => s + minLamps(t, mask, n), 0));
  }
  return { invertible, count, best };
}

/** 2 when every output is on one wire (no diodes), plus 1 when no two wires share a colour. */
function gradeOf({ wiring, rows }) {
  const clean = wiring.wires.flatMap((w) => w.outputs).length === rows.length;
  return 2 * Number(clean) + Number(new Set(wiring.wires.map((w) => w.colour)).size === wiring.wires.length);
}

/** Checks one matrix: it rebuilds every output, its cost adds up, and its wiring is valid. */
function checkMatrix(m, terms, mask, n) {
  assert.equal(m.mask, mask);
  assert.equal(m.varCount, n);
  const cheapest = m.transitioned.map((t) => minLamps(t, mask, n));
  if (m.wiring.status === "ok") {
    const lamps = lampsOf(m.transitioned, mask, n);
    // A padded gate has an unwired lamp at the bottom, so its tile may carry any colours.
    const padded = m.wiring.stacks.map((s, k) => s.lamps.length > cheapest[k]);
    checkWiring(m.rows, lamps.map((l, k) => (padded[k] ? 0xffff : l.okSets)), m.wiring);
    checkLayout(m.wiring, lamps.map((l) => [...l.expressions, ...l.padded]));
    checkRoutes(m.wiring, m.wiring.routes);
    m.wiring.stacks.forEach((s, k) => assert.ok(s.lamps.length <= cheapest[k] + 1, "at most one pad lamp"));
  } else {
    assert.deepEqual(m.wiring, { status: "unverified" });
  }
  assert.equal(m.rows.length, terms.length);
  assert.equal(m.transitioned.length, terms.length);
  assert.ok(cheapest.every((l) => l < Infinity), "every gate is solvable");
  // Lamps built: the cheapest gates, plus pad lamps when wired with them.
  const cost = m.wiring.stacks?.reduce((s, x) => s + x.lamps.length, 0) ?? cheapest.reduce((a, b) => a + b);
  assert.equal(m.complexity, cost, "complexity is the number of lamps");
  terms.forEach((t, k) => assert.equal(xorOf(m.rows[k], m.transitioned), t, `output ${k} is rebuilt`));
}
function checkAll(matrices, terms, mask, n) {
  matrices.forEach((m) => checkMatrix(m, terms, mask, n));
  // Wired by grade (no diodes, then one colour per wire), unverified last; then by complexity.
  const group = (m) => (m.wiring.status !== "ok" ? 4 : 3 - gradeOf(m));
  for (let i = 1; i < matrices.length; i++) {
    const [a, b] = [matrices[i - 1], matrices[i]];
    assert.ok(group(a) < group(b) || (group(a) === group(b) && a.complexity <= b.complexity), "sorted");
  }
  const keys = matrices.map((m) => JSON.stringify([m.rows, m.transitioned]));
  assert.equal(new Set(keys).size, keys.length, "no duplicates");
}

// Deterministic picks of 4-input functions one gate can solve.
const solvable4 = Dictionary[2].map(([t]) => t);
const pick4 = (...indexes) => indexes.map((i) => solvable4[(i * 2654435761) % solvable4.length]);

// --- full search compared with brute force --------------------------------------
/** @type {[name: string, varCount: number, terms: number[], mask: number][]} */
const CASES = [
  ["2 inputs, 3 independent outputs", 2, [0b0110, 0b1100, 0b0001], 0],
  ["2 inputs, outputs where the third is the XOR of the others", 2, [0b0110, 0b1100, 0b1010], 0],
  ["2 inputs, the same output twice", 2, [0b0110, 0b0110], 0],
  ["2 inputs, the same output three times", 2, [0b0110, 0b0110, 0b0110], 0],
  ["3 inputs, 3 outputs", 3, [0b10010110, 0b11101000, 0b00111100], 0],
  ["4 inputs, 3 outputs", 4, pick4(1, 2, 3), 0],
  ["4 inputs, 4 outputs", 4, pick4(4, 5, 6, 7), 0],
  ["4 inputs, 2 outputs with don't cares", 4, [0b1110011011001100, 0b1110101010010110], 0b1110000000000000],
];

for (const [name, n, terms, mask] of CASES) {
  test(`${name}: finds every valid matrix and the cheapest one`, () => {
    // No wiring budget: random 4-input gates can take more than the page allows.
    const { matrices, counts } = generate({ varCount: n, terms, mask, hardLimit: Infinity, wiringBudget: Infinity });
    checkAll(matrices, terms, mask, n);

    const expected = bruteForce(terms, mask, n);
    assert.ok(expected.count > 0, "the case has a solution");
    assert.ok(matrices.every((m) => m.wiring.status === "ok"), "with no budget, nothing is unverified");
    assert.equal(matrices.length, expected.count);
    const cheapest = (m) => m.transitioned.reduce((s, t) => s + minLamps(t, mask, n), 0);
    assert.equal(Math.min(...matrices.map(cheapest)), expected.best, "the cheapest matrix is found");

    // One progress message per candidate tried, the last one is "wired/invertible/tried".
    const tried = binom(goodCombos(terms, mask, n).length, terms.length);
    assert.equal(counts.length, tried);
    assert.equal(counts.at(-1), `${matrices.length}/${expected.invertible}/${tried}`);
  });
}

// --- limits, defaults and edge cases ---------------------------------------------
test("hardLimit stops the search once that many matrices are found", () => {
  const terms = pick4(4, 5, 6, 7);
  const all = bruteForce(terms, 0, 4).count;
  assert.ok(all > 5);
  const { matrices, counts } = generate({ varCount: 4, terms, mask: 0, hardLimit: 5, wiringBudget: Infinity });
  assert.equal(matrices.length, 5);
  assert.match(counts.at(-1), /^5\//);
  checkAll(matrices, terms, 0, 4);
});

test("mask defaults to none and hardLimit to 20", () => {
  const terms = [0b0110, 0b1100, 0b0001];
  assert.ok(bruteForce(terms, 0, 2).count > 20);
  const { matrices } = generate({ varCount: 2, terms });
  assert.equal(matrices.length, 20);
  checkAll(matrices, terms, 0, 2);
});

test("a single output gives the identity matrix", () => {
  // One lamp: a gate alone in its column can always be fed from the top.
  const t = Terms[4].find(([name]) => name === "ab")[1];
  const { matrices } = generate({ varCount: 4, terms: [t], mask: 0, hardLimit: 20 });
  assert.equal(matrices.length, 1);
  const { wiring, ...matrix } = matrices[0];
  assert.deepEqual(matrix, { complexity: minLamps(t, 0, 4), rows: [1], transitioned: [t], mask: 0, varCount: 4 });
  assert.equal(wiring.wires.length, 1, "one wire from the gate to the output");
  checkAll(matrices, [t], 0, 4);
});

test("a gate whose only lamp uses all four colours is wired with a pad lamp under it", () => {
  // a⊕b⊕c⊕d is one lamp with every input wire on it; the gate tile below it has no free
  // colour, unless an unwired "0" lamp sits between them.
  const abcd = 0b0110100110010110;
  assert.equal(minLamps(abcd, 0, 4), 1);
  const { matrices, counts } = generate({ varCount: 4, terms: [abcd], mask: 0, hardLimit: 20 });
  assert.equal(matrices.length, 1);
  assert.equal(matrices[0].complexity, 2, "one lamp more than the cheapest gate");
  assert.deepEqual(matrices[0].wiring.stacks[0].lamps.map((l) => l.name), ["0", "abcd"]);
  checkAll(matrices, [abcd], 0, 4);
  assert.equal(counts.at(-1), "1/1/1");
});

test("unverified matrices are kept after the wired ones", () => {
  // A small budget wires some matrices and gives up on others.
  const terms = [0b0110, 0b1100, 0b0001];
  const { matrices } = generate({ varCount: 2, terms, mask: 0, hardLimit: 5, wiringBudget: 16 });
  assert.equal(matrices.filter((m) => m.wiring.status === "ok").length, 5);
  assert.ok(matrices.some((m) => m.wiring.status === "unverified"), "the budget ran out at least once");
  checkAll(matrices, terms, 0, 2);
});

test("unverified matrices are capped at hardLimit too", () => {
  // Budget 1 wires nothing: every one of the > 20 matrices is unverified.
  const terms = [0b0110, 0b1100, 0b0001];
  assert.ok(bruteForce(terms, 0, 2).invertible > 20);
  const { matrices, counts } = generate({ varCount: 2, terms, mask: 0, hardLimit: 5, wiringBudget: 1 });
  assert.equal(matrices.length, 5);
  assert.ok(matrices.every((m) => m.wiring.status === "unverified"));
  assert.match(counts.at(-1), /^0\//, "the search ran to the end without wiring any");
  checkAll(matrices, terms, 0, 2);
});

test("the wire action retries one matrix with no budget", () => {
  const terms = [0b0110, 0b1100, 0b0001];
  const [m] = generate({ varCount: 2, terms, hardLimit: 1 }).matrices;
  posted = [];
  g.onmessage({ data: { action: "wire", index: 7, matrix: { ...m, wiring: { status: "unverified" } } } });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].action, "wiring");
  assert.equal(posted[0].index, 7);
  assert.equal(posted[0].complexity, m.complexity, "lamps built come back with it");
  checkMatrix({ ...m, wiring: posted[0].wiring }, terms, 0, 2);

  // A gate no single gate makes (only possible from edited storage) comes back impossible.
  const solvable = new Set(solvable4);
  let unsolvable = 0;
  while (solvable.has(unsolvable)) unsolvable++;
  posted = [];
  g.onmessage({ data: { action: "wire", index: 0, matrix: { rows: [1], transitioned: [unsolvable], mask: 0, varCount: 4 } } });
  assert.deepEqual(posted[0], { action: "wiring", index: 0, wiring: { status: "impossible" }, complexity: undefined });
});

test("outputs with no valid matrix give an empty list", () => {
  const solvable = new Set(solvable4);
  // Two outputs where neither they nor their XOR can be made with one gate.
  let terms;
  search: for (let a = 0; a < 2 ** 16; a++)
    if (!solvable.has(a))
      for (let b = a + 1; b < 2 ** 16; b++)
        if (!solvable.has(b) && !solvable.has(a ^ b)) {
          terms = [a, b];
          break search;
        }
  assert.equal(bruteForce(terms, 0, 4).count, 0);
  assert.deepEqual(generate({ varCount: 4, terms, mask: 0, hardLimit: 20 }).matrices, []);
  // A single unsolvable output too.
  assert.deepEqual(generate({ varCount: 4, terms: [terms[0]], mask: 0, hardLimit: 20 }).matrices, []);
});

test("unknown actions are ignored", () => {
  posted = [];
  g.onmessage({ data: { action: "nope" } });
  assert.deepEqual(posted, []);
});

test("each matrix gets clean outputs, then one colour per wire, with the fewest pad lamps", () => {
  // 2 inputs, and 4 inputs with don't cares (a user's case where clean wirings repeat a colour).
  const cases = [
    [2, [0b0110, 0b1100, 0b0001], 0, Infinity],
    [4, [0b0001100000000000, 0b0000011111110000, 0b0000011011001100, 0b0001010110101010], 0b1110000000000000, 20],
  ];
  const isClean = (m) => m.wiring.wires.flatMap((w) => w.outputs).length === m.rows.length;
  const distinct = (m) => new Set(m.wiring.wires.map((w) => w.colour)).size === m.wiring.wires.length;
  let padded = 0;
  for (const [n, terms, mask, hardLimit] of cases) {
    for (const m of generate({ varCount: n, terms, mask, hardLimit, wiringBudget: Infinity }).matrices) {
      const lamps = lampsOf(m.transitioned, mask, n);
      const options = {
        rows: m.rows,
        okSets: lamps.map((l) => l.okSets),
        expressions: lamps.map((l) => l.expressions),
        padded: lamps.map((l) => l.padded),
        maxPads: m.rows.length,
      };
      if (!isClean(m)) assert.notEqual(wire({ ...options, cleanOutputs: true }).status, "ok", "mixed only as a fallback");
      if (!distinct(m)) {
        const better = wire({ ...options, cleanOutputs: isClean(m), distinctOutputs: true });
        assert.notEqual(better.status, "ok", "shared colours only as a fallback");
      }
      // Pads cost lamps: the same grade without them would have been used.
      const extra = m.complexity - m.transitioned.reduce((s, t) => s + minLamps(t, mask, n), 0);
      if (extra > 0) {
        padded++;
        const plain = wire({ ...options, cleanOutputs: isClean(m), distinctOutputs: distinct(m), maxPads: extra - 1 });
        assert.notEqual(plain.status, "ok", "no more pads than needed");
      }
    }
  }
  assert.ok(padded > 0, "the 4-input case needs pad lamps for its best grade");
});

test("more than 4 outputs share colours from the start", () => {
  // 3 inputs, 5 independent outputs: there are only 4 colours, so outputs must share.
  const terms = [0b11110000, 0b11001100, 0b10101010, 0b00111100, 0b01011010];
  const { matrices } = generate({ varCount: 3, terms, mask: 0, hardLimit: 1 });
  assert.equal(matrices.length, 1);
  checkAll(matrices, terms, 0, 3);
});
