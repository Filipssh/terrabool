// Tests for the wire colouring solver (js/worker/wiring.js).
// Every wiring the solver returns is re-checked by an independent checker below, and
// for 2 and 3 outputs the solver's verdict is compared with a brute-force search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wire, gateLamps, route, COLOURS } from "../js/worker/wiring.js";
import { Terms } from "../js/data/terms.js";
import { Dictionary } from "../js/data/dictionary.js";
import { checkLayout, checkRoutes, checkWiring } from "./wiring-check.js";

const ALL = 0xffff; // every colour set allowed on every gate

// --- brute-force oracle ------------------------------------------------------------
function* permutations(items) {
  if (items.length <= 1) return yield items;
  for (let i = 0; i < items.length; i++)
    for (const rest of permutations([...items.slice(0, i), ...items.slice(i + 1)])) yield [items[i], ...rest];
}
function* subsets(items, k, start = 0, picked = []) {
  if (picked.length === k) return yield picked;
  for (let i = start; i < items.length; i++) yield* subsets(items, k, i + 1, [...picked, items[i]]);
}
const bits = (x, n) => [...Array(n).keys()].filter((i) => (x >> i) & 1);
const passes = (rows, okSets, result) => {
  try {
    checkWiring(rows, okSets, result);
    return true;
  } catch {
    return false;
  }
};

/** True when some cover by up to `maxWires` distinct blocks can be coloured and placed. */
function oracle(rows, okSets, maxWires, keep = () => true) {
  const n = rows.length;
  const blocks = [];
  for (let g = 1; g < 1 << n; g++) for (let o = 1; o < 1 << n; o++) blocks.push({ gates: bits(g, n), outputs: bits(o, n) });
  const orders = [...permutations([...Array(n).keys()])];
  for (let w = 1; w <= maxWires; w++) {
    for (const pick of subsets(blocks, w)) {
      const rebuilt = new Array(n).fill(0);
      for (const b of pick) for (const p of b.outputs) for (const k of b.gates) rebuilt[p] ^= 1 << k;
      if (rebuilt.some((r, p) => r !== rows[p])) continue;
      for (let colours = 0; colours < 4 ** w; colours++) {
        const wires = pick.map((b, i) => ({ ...b, colour: Math.floor(colours / 4 ** i) % 4 }));
        // Cheap checks first, with any order.
        if (!passesIgnoringOrder(rows, okSets, wires) || !keep(wires)) continue;
        for (const gateOrder of orders)
          for (const outputOrder of orders)
            if (passes(rows, okSets, { status: "ok", wires, gateOrder, outputOrder })) return true;
      }
    }
  }
  return false;
}
/** No colour on two wires (a wire may reach several outputs). */
function distinctOutputs(wires) {
  return new Set(wires.map((w) => w.colour)).size === wires.length;
}
function passesIgnoringOrder(rows, okSets, wires) {
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    for (const side of ["gates", "outputs"]) {
      const c = wires.filter((w) => w[side].includes(i)).map((w) => w.colour);
      if (new Set(c).size !== c.length) return false;
      if (side === "gates" && !((okSets[i] >> c.reduce((a, x) => a | (1 << x), 0)) & 1)) return false;
    }
  }
  return true;
}

// Realistic okSets: from a few lamps, a set is ok when some lamp avoids it.
function okSetsFrom(lampMasks) {
  let ok = 0;
  for (let s = 0; s < 16; s++) if (lampMasks.some((l) => (l & s) === 0)) ok |= 1 << s;
  return ok;
}
let seed = 12345;
// A lamp mask with one free colour: the tightest restriction a real gate can have.
const oneFree = () => 0xf & ~(1 << rnd(4));
const rnd = (m) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % m;
function rank(v) {
  const b = [];
  for (let x of v) {
    for (const y of b) x = Math.min(x, x ^ y);
    if (x) b.push(x);
  }
  return b.length;
}
function randomInvertible(n) {
  let rows;
  do rows = Array.from({ length: n }, () => 1 + rnd(2 ** n - 1));
  while (rank(rows) < n);
  return rows;
}

// --- solver vs oracle ----------------------------------------------------------------
test("2 outputs: solver agrees with brute force on every matrix and many lamp restrictions", () => {
  const matrices = [];
  for (let a = 1; a < 4; a++) for (let b = 1; b < 4; b++) if (rank([a, b]) === 2) matrices.push([a, b]);
  assert.equal(matrices.length, 6);
  let ok = 0, impossible = 0;
  for (const rows of matrices)
    for (let t = 0; t < 12; t++) {
      const okSets = t === 0 ? [ALL, ALL] : [0, 0].map(() => okSetsFrom(t % 2 ? [oneFree()] : [oneFree(), rnd(16)]));
      const result = wire({ rows, okSets, maxWires: 3 });
      const expected = oracle(rows, okSets, 3);
      assert.equal(result.status, expected ? "ok" : "impossible", JSON.stringify({ rows, okSets }));
      if (expected) {
        checkWiring(rows, okSets, result);
        ok++;
      } else impossible++;
    }
  assert.ok(ok > 0 && impossible > 0, "both verdicts are exercised");
});

test("3 outputs: solver agrees with brute force", () => {
  let ok = 0, impossible = 0;
  for (let t = 0; t < 8; t++) {
    const rows = randomInvertible(3);
    const okSets = t < 2 ? [ALL, ALL, ALL] : [0, 0, 0].map(() => okSetsFrom([oneFree()]));
    const result = wire({ rows, okSets, maxWires: 4 });
    const expected = oracle(rows, okSets, 4);
    assert.equal(result.status, expected ? "ok" : "impossible", JSON.stringify({ rows, okSets }));
    if (expected) {
      checkWiring(rows, okSets, result);
      ok++;
    } else impossible++;
  }
  assert.ok(ok > 0 && impossible > 0, "both verdicts are exercised");
});

// --- hand cases ------------------------------------------------------------------------
test("identity matrix: one wire per gate", () => {
  const rows = [1, 2, 4, 8, 16];
  const result = wire({ rows, okSets: rows.map(() => ALL) });
  checkWiring(rows, rows.map(() => ALL), result);
  assert.equal(result.wires.length, 5);
});

test("shared wires: one wire can serve several gates and outputs", () => {
  // out0 = g0⊕g1, out1 = g0⊕g1⊕g2, out2 = g2 (rank 2: out1 = out0 ⊕ out2)
  const rows = [0b011, 0b111, 0b100];
  const okSets = [ALL, ALL, ALL];
  const result = wire({ rows, okSets });
  checkWiring(rows, okSets, result);
  assert.equal(result.wires.length, 2, "{g0,g1}×{out0,out1} and {g2}×{out1,out2}");
});

test("bigger random matrices: every ok result is valid", () => {
  for (const n of [4, 5, 6]) {
    for (let t = 0; t < 4; t++) {
      const rows = randomInvertible(n);
      const okSets = rows.map(() => (t % 2 ? okSetsFrom([rnd(16), rnd(16)]) : ALL));
      const result = wire({ rows, okSets, budget: 50000 });
      if (result.status === "ok") checkWiring(rows, okSets, result);
      else assert.ok(["unverified", "impossible"].includes(result.status));
    }
  }
});

test("bottom lamps and neighbours together can make a matrix impossible", () => {
  const rows = [0b01, 0b10];
  // Both gates allow only red (or nothing): two red gate tiles side by side would touch.
  const redOnly = okSetsFrom([0b1110]);
  assert.equal(wire({ rows, okSets: [redOnly, redOnly] }).status, "impossible");
  // One gate may use blue instead: now it works.
  const blueOnly = okSetsFrom([0b1101]);
  const result = wire({ rows, okSets: [redOnly, blueOnly] });
  checkWiring(rows, [redOnly, blueOnly], result);
  assert.deepEqual(result.wires.map((w) => COLOURS[w.colour]).sort(), ["blue", "red"]);
});

test("a gate whose lamps leave no colour free can't be wired", () => {
  assert.equal(wire({ rows: [1], okSets: [1] }).status, "impossible");
});

test("running out of budget gives unverified", () => {
  const rows = randomInvertible(6);
  assert.deepEqual(wire({ rows, okSets: rows.map(() => ALL), budget: 1 }), { status: "unverified" });
  // Budget spent while placing tiles, after a full cover was found.
  assert.deepEqual(wire({ rows: [1, 2], okSets: [ALL, ALL], budget: 4 }), { status: "unverified" });
});

// --- gateLamps ---------------------------------------------------------------------------
const lampColours = (varCount, name) => (Terms[varCount].find((t) => t[0] === name)[2] >> 1) & 0xf;

/** Every lamp is a real term with its own colours, all expressions are equally cheap, and
 * okSets has exactly the sets some lamp avoids. */
function checkLamps(varCount, { okSets, expressions }) {
  assert.ok(expressions.length > 0);
  assert.equal(new Set(expressions.map((e) => e.lamps.length)).size, 1, "all cheapest: same lamp count");
  for (const { expression, lamps } of expressions)
    for (const { name, colours } of lamps) {
      assert.equal(colours, lampColours(varCount, name), `${name} in ${expression}`);
      assert.ok(expression === name || expression.includes(`(${name}`) || expression.includes(` ${name}`));
    }
  const all = expressions.flatMap((e) => e.lamps);
  for (let s = 0; s < 16; s++) assert.equal((okSets >> s) & 1, all.some((l) => (l.colours & s) === 0) ? 1 : 0, `set ${s}`);
}

test("gateLamps: one-lamp gate can't carry its own input colour", () => {
  const result = gateLamps({ term: 0b1100, mask: 0, varCount: 2 }); // "a": the red lamp
  checkLamps(2, result);
  for (let s = 0; s < 16; s++) assert.equal((result.okSets >> s) & 1, s & 1 ? 0 : 1, `set ${s}`);
  assert.deepEqual(result.expressions, [{ expression: "a", lamps: [{ name: "a", colours: 1 }] }]);
});

test("gateLamps: multi-lamp gates list every cheapest expression with its lamps", () => {
  // ¬a ∧ ¬b style functions need two lamps with 2 inputs.
  const result = gateLamps({ term: 0b0001, mask: 0, varCount: 2 });
  checkLamps(2, result);
  assert.ok(result.expressions.every((e) => e.lamps.length === 2));

  // Some 4-input gates with 3 and 4 lamps.
  const picks = [3, 4].flatMap((lamps) => Dictionary[2].filter((d) => d[1] === lamps).slice(0, 3));
  assert.equal(picks.length, 6);
  for (const [term] of picks) checkLamps(4, gateLamps({ term, mask: 0, varCount: 4 }));
});

test("gateLamps: a truth table no single gate makes allows nothing", () => {
  const solvable = new Set(Dictionary[2].map((d) => d[0]));
  let term = 0;
  while (solvable.has(term)) term++;
  assert.deepEqual(gateLamps({ term, mask: 0, varCount: 4 }), { okSets: 0, expressions: [], padded: [] });
});

test("gateLamps: a constant lamp has no wires, so every set is ok", () => {
  assert.equal(gateLamps({ term: 0b1111, mask: 0, varCount: 2 }).okSets, ALL);
});

test("gateLamps: don't cares are used and results are cached", () => {
  const mask = 0b1110000000000000;
  const [solvable] = Dictionary[2].find((d) => d[1] === 3);
  const term = solvable & ~mask; // only matches the dictionary once don't cares are applied
  const first = gateLamps({ term, mask, varCount: 4 });
  checkLamps(4, first);
  assert.ok(first.okSets & 1);
  assert.equal(gateLamps({ term, mask, varCount: 4 }), first);
});

// --- lamp stacks and input wires -------------------------------------------------------------
const R = 1, B = 2, G = 4; // lamp colours: red (a), blue (b), green (c)
const lamp = (colours) => ({ name: `L${colours}`, colours });
/** A gate with one expression per list of lamp colours. */
const gate = (...lampSets) => lampSets.map((set, i) => ({ expression: `e${i}`, lamps: set.map(lamp) }));
const okOf = (expressions) => okSetsFrom(expressions.flatMap((e) => e.lamps.map((l) => l.colours)));
/** wire() with expressions; every ok answer passes all three checkers. */
function wireStacks(rows, expressions, options = {}) {
  const okSets = expressions.map(okOf);
  const result = wire({ rows, okSets, expressions, ...options });
  if (result.status === "ok") {
    checkWiring(rows, okSets, result);
    checkLayout(result, expressions);
    checkRoutes(result, route(result));
  }
  return result;
}
const TALL = [0, R, B]; // red or blue sits under the other: alone, one can't reach the top

test("stacks: each lamp's colours must reach the top edge through its own stack", () => {
  assert.equal(wireStacks([1], [gate(TALL)]).status, "impossible");
  const ok = wireStacks([1], [gate([0, R, R | B])]);
  assert.equal(ok.status, "ok");
  assert.deepEqual(ok.stacks[0].lamps.map((l) => l.colours), [0, R, R | B], "red under red+blue, not under blue");
  assert.deepEqual(ok.inputs[0], [[0, 1], [0, 2], [0, 3]], "red runs down from the top edge");
  assert.deepEqual(ok.inputs[2], [], "nothing uses green");
});

test("stacks: a shorter neighbour leaves room for input wires to come in from the side", () => {
  const result = wireStacks([1, 2], [gate(TALL), gate([0])]);
  assert.equal(result.status, "ok");
  assert.equal(result.stacks[0].lamps[0].colours, 0, "red and blue sit above the short stack");
});

test("stacks: the gate order and the expression are searched", () => {
  // Gate 0 must stand next to the short gate 2, so the first order (0, 1, 2) fails. Its
  // first expression can't be stacked anywhere: the bottom lamp's colour is never above it.
  const tall = gate([R, B, G], TALL);
  const result = wireStacks([1, 2, 4], [tall, gate([0, 0, 0]), gate([0])]);
  assert.equal(result.status, "ok");
  assert.equal(Math.abs(result.gateOrder.indexOf(0) - result.gateOrder.indexOf(2)), 1);
  assert.equal(result.stacks[0].expression, "e1");
});

test("stacks: running out of budget while stacking gives unverified", () => {
  const expressions = [gate(TALL), gate([0, 0, 0]), gate([0])];
  const okSets = expressions.map(okOf);
  // Find how many nodes the solver needs, then give it a few less.
  let needed = 1;
  while (wire({ rows: [1, 2, 4], okSets, expressions, budget: needed }).status !== "ok") needed++;
  assert.deepEqual(wire({ rows: [1, 2, 4], okSets, expressions, budget: needed - 1 }), { status: "unverified" });
});

// --- decode wire tiles ------------------------------------------------------------------------
test("route: straight, rightward and leftward wires of one colour stay apart", () => {
  // Gate k is in column k and output p in column p.
  const wiring = {
    wires: [
      { gates: [0], outputs: [2], colour: 0 }, // red, goes right
      { gates: [2], outputs: [4], colour: 0 }, // red, goes right
      { gates: [6], outputs: [6], colour: 0 }, // red, straight down
      { gates: [5, 6], outputs: [0, 1], colour: 1 }, // blue, goes left
    ],
    gateOrder: [0, 1, 2, 3, 4, 5, 6],
    outputOrder: [0, 1, 2, 3, 4, 5, 6],
  };
  const result = route(wiring);
  checkRoutes(wiring, result);
  assert.equal(result.rows, 7, "the two red wires going right turn on rows 5 and 3");
});

test("route: crossing same-colour wires can't be laid out", () => {
  // Not a valid wiring (C2), so its layout touches, which the checker catches.
  const wiring = {
    wires: [
      { gates: [0], outputs: [2], colour: 0 },
      { gates: [2], outputs: [0], colour: 0 },
    ],
    gateOrder: [0, 1, 2],
    outputOrder: [0, 1, 2],
  };
  assert.throws(() => checkRoutes(wiring, route(wiring)), /touch|share/);
});

// --- distinct output colours -------------------------------------------------------------------
test("distinct outputs: solver agrees with brute force for 2 and 3 outputs", () => {
  let ok = 0, impossible = 0;
  for (let t = 0; t < 10; t++) {
    const rows = randomInvertible(2 + (t % 2));
    const okSets = t < 4 ? rows.map(() => ALL) : rows.map(() => okSetsFrom([oneFree()]));
    const result = wire({ rows, okSets, maxWires: rows.length + 1, distinctOutputs: true });
    const expected = oracle(rows, okSets, rows.length + 1, distinctOutputs);
    assert.equal(result.status, expected ? "ok" : "impossible", JSON.stringify({ rows, okSets }));
    if (expected) {
      checkWiring(rows, okSets, result);
      assert.ok(distinctOutputs(result.wires));
      ok++;
    } else impossible++;
  }
  assert.ok(ok > 0 && impossible > 0, "both verdicts are exercised");
});

test("distinct outputs: one wire may reach several outputs, two wires never share a colour", () => {
  // out0 = g0⊕g1, out1 = g0⊕g1⊕g2, out2 = g2: two wires, one reaching out0 and out1.
  const shared = wire({ rows: [0b011, 0b111, 0b100], okSets: [ALL, ALL, ALL], distinctOutputs: true });
  checkWiring([0b011, 0b111, 0b100], [ALL, ALL, ALL], shared);
  assert.ok(shared.wires.some((w) => w.outputs.length > 1));

  // Gates 0 and 2 can only carry red: without the rule, red twice (not side by side).
  const redOnly = okSetsFrom([0b1110]);
  const okSets = [redOnly, okSetsFrom([0b1101]), redOnly];
  assert.equal(wire({ rows: [1, 2, 4], okSets, distinctOutputs: true }).status, "impossible");
  checkWiring([1, 2, 4], okSets, wire({ rows: [1, 2, 4], okSets }));
});

// --- clean outputs (no diodes) ---------------------------------------------------------------
/** Every output on exactly one wire. */
const cleanOutputs = (rows) => (wires) => wires.flatMap((w) => w.outputs).length === rows.length;

test("clean outputs: solver agrees with brute force for 2 and 3 outputs", () => {
  let ok = 0, impossible = 0;
  for (let t = 0; t < 10; t++) {
    const rows = randomInvertible(2 + (t % 2));
    const okSets = t < 4 ? rows.map(() => ALL) : rows.map(() => okSetsFrom([oneFree()]));
    const result = wire({ rows, okSets, cleanOutputs: true });
    const expected = oracle(rows, okSets, rows.length, cleanOutputs(rows));
    assert.equal(result.status, expected ? "ok" : "impossible", JSON.stringify({ rows, okSets }));
    if (expected) {
      checkWiring(rows, okSets, result);
      assert.ok(cleanOutputs(rows)(result.wires));
      ok++;
    } else impossible++;
  }
  assert.ok(ok > 0 && impossible > 0, "both verdicts are exercised");
});

test("clean outputs: a gate feeding every output then carries a wire per output", () => {
  const rows = [0b0001, 0b0011, 0b0101, 0b1001];
  // Gate 0 can carry one colour only: clean needs four wires on it.
  const okSets = [okSetsFrom([0b1110, 0b1101, 0b1011, 0b0111]), ALL, ALL, ALL];
  assert.equal(wire({ rows, okSets, cleanOutputs: true }).status, "impossible");
  // Mixed: one wire from gate 0 to every output, so it carries one colour.
  const mixed = wire({ rows, okSets });
  checkWiring(rows, okSets, mixed);
  assert.ok(!cleanOutputs(rows)(mixed.wires));
  const clean = wire({ rows, okSets: rows.map(() => ALL), cleanOutputs: true });
  assert.deepEqual(clean.wires.map((w) => [w.gates, w.outputs]).sort(), [[[0], [0]], [[0, 1], [1]], [[0, 2], [2]], [[0, 3], [3]]]);
});

// --- pad lamps ------------------------------------------------------------------------------
test("gateLamps: every expression also comes padded with an unwired lamp", () => {
  assert.deepEqual(gateLamps({ term: 0b1100, mask: 0, varCount: 2 }).padded, [
    { expression: "⊕(0, a)", lamps: [{ name: "0", colours: 0 }, { name: "a", colours: 1 }] },
  ]);
  // An off lamp would turn an AND off, so ANDs get an on lamp; XORs (negated too) an off one.
  for (const [term] of Dictionary[2].filter((d) => d[1] === 3).slice(0, 20)) {
    const { expressions, padded } = gateLamps({ term, mask: 0, varCount: 4 });
    padded.forEach((p, i) => {
      const pad = expressions[i].expression.includes("∧(") ? "1" : "0";
      assert.equal(p.expression, expressions[i].expression.replace("(", `(${pad}, `));
      assert.deepEqual(p.lamps, [{ name: pad, colours: 0 }, ...expressions[i].lamps]);
    });
  }
});

test("pads: a gate whose only lamp uses every colour is wired over an unwired lamp", () => {
  const all = gate([R | B | G | 8]);
  const padded = all.map((e) => ({ expression: `⊕(0, ${e.expression})`, lamps: [lamp(0), ...e.lamps] }));
  const options = { rows: [1], okSets: [okOf(all)], expressions: [all] };
  assert.equal(wire(options).status, "impossible");
  const result = wire({ ...options, padded: [padded], maxPads: 1 });
  checkLayout(result, [[...all, ...padded]]);
  assert.deepEqual(result.stacks[0].lamps.map((l) => l.colours), [0, 15]);
});

test("pads: the fewest gates are padded, and only gates that have padded expressions", () => {
  // Gate 0 can only take blue, gate 1 only red; both are needed with one colour each.
  const rows = [1, 2];
  const blueOnly = gate([R | G | 8]);
  const redOnly = gate([B | G | 8]);
  const pad = (e) => e.map((x) => ({ expression: `p${x.expression}`, lamps: [lamp(0), ...x.lamps] }));
  const options = { rows, okSets: [okOf(blueOnly), okOf(redOnly)], expressions: [blueOnly, redOnly], padded: [pad(blueOnly), pad(redOnly)] };
  // Without pads: blue on gate 0 and red on gate 1 works.
  const plain = wire({ ...options, maxPads: 2 });
  assert.ok(plain.stacks.every((s) => s.lamps.length === 1), "no pad when none is needed");
  // Forcing one colour per wire with only one colour for both: gate 1 must be padded.
  const sameColour = { ...options, okSets: [okOf(blueOnly), okOf(blueOnly)], expressions: [blueOnly, blueOnly], padded: [pad(blueOnly), pad(blueOnly)] };
  const one = wire({ ...sameColour, distinctOutputs: true, maxPads: 2 });
  assert.equal(one.stacks.filter((s) => s.lamps.length === 2).length, 1, "one pad is enough");
  // A gate without padded expressions can't be padded.
  assert.equal(wire({ ...sameColour, padded: [[], []], distinctOutputs: true, maxPads: 2 }).status, "impossible");
});

test("pads: running out of budget while proving no stacking works gives unverified", () => {
  const options = { rows: [1], okSets: [ALL], expressions: [gate(TALL)], padded: [gate([0, ...TALL])], maxPads: 1 };
  assert.equal(wire(options).status, "impossible", "a pad lamp makes the stack taller, not reachable");
  assert.deepEqual(wire({ ...options, budget: 3 }), { status: "unverified" });
});
