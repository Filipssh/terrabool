// Tests for the multi-output solver (js/worker/transmatrix.js).
// Every matrix the worker returns is checked independently: XOR-ing its gates as
// the inverse rows say must give back the original outputs, and its cost must match
// the dictionary. Small cases are also compared with a brute-force search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Dictionary } from "../js/data/dictionary.js";

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
/** Brute force: number of valid matrices and the cheapest cost. */
function bruteForce(terms, mask, n) {
  let count = 0, best = Infinity;
  for (const pick of subsets(goodCombos(terms, mask, n), terms.length)) {
    if (rank(pick) !== terms.length) continue;
    count++;
    best = Math.min(best, pick.reduce((s, c) => s + minLamps(xorOf(c, terms), mask, n), 0));
  }
  return { count, best };
}

/** Checks one matrix: it rebuilds every output and its cost adds up. */
function checkMatrix(m, terms, mask, n) {
  assert.equal(m.mask, mask);
  assert.equal(m.rows.length, terms.length);
  assert.equal(m.transitioned.length, terms.length);
  let cost = 0;
  for (const t of m.transitioned) {
    const lamps = minLamps(t, mask, n);
    assert.ok(lamps < Infinity, `gate ${t} is not solvable`);
    cost += lamps;
  }
  assert.equal(m.complexity, cost, "complexity is the sum of the gates' lamp counts");
  terms.forEach((t, k) => assert.equal(xorOf(m.rows[k], m.transitioned), t, `output ${k} is rebuilt`));
}
function checkAll(matrices, terms, mask, n) {
  matrices.forEach((m) => checkMatrix(m, terms, mask, n));
  for (let i = 1; i < matrices.length; i++)
    assert.ok(matrices[i - 1].complexity <= matrices[i].complexity, "sorted by complexity");
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
    const { matrices, counts } = generate({ varCount: n, terms, mask, hardLimit: Infinity });
    checkAll(matrices, terms, mask, n);

    const expected = bruteForce(terms, mask, n);
    assert.ok(expected.count > 0, "the case has a solution");
    assert.equal(matrices.length, expected.count);
    assert.equal(matrices[0].complexity, expected.best);

    // One progress message per candidate tried, the last one is "found/tried".
    const tried = binom(goodCombos(terms, mask, n).length, terms.length);
    assert.equal(counts.length, tried);
    assert.equal(counts.at(-1), `${matrices.length}/${tried}`);
  });
}

// --- limits, defaults and edge cases ---------------------------------------------
test("hardLimit stops the search once that many matrices are found", () => {
  const terms = pick4(4, 5, 6, 7);
  const all = bruteForce(terms, 0, 4).count;
  assert.ok(all > 5);
  const { matrices, counts } = generate({ varCount: 4, terms, mask: 0, hardLimit: 5 });
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
  const [t] = pick4(1);
  const { matrices } = generate({ varCount: 4, terms: [t], mask: 0, hardLimit: 20 });
  assert.deepEqual(matrices, [{ complexity: minLamps(t, 0, 4), rows: [1], transitioned: [t], mask: 0 }]);
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
