// Wire colouring for multi-output modules.
//
// Layout (see implementation-plan.md §1): gates in a row, outputs in a row below, decode
// wires routed between the rows. A wire is one net of one colour touching gate set G and
// output set O, so it delivers every gate in G to every output in O. Outputs toggle per
// signal, so the wires must XOR together to the inverse matrix: rows[p] bit k = gate k
// reaches output p an odd number of times.

import { Dictionary } from "../data/dictionary.js";
import { makeExpressionsBFS } from "./expressions.js";

// Colour i is input variable i (a, b, c, d) and Terms bitmap bit i + 1.
export const COLOURS = ["red", "blue", "green", "yellow"];

/**
 * A lamp: its printable name and the input colours wired to it (bit i = COLOURS[i]).
 * @typedef {{name: string, colours: number}} Lamp
 */
/**
 * A cheapest expression of a gate and its lamps. In a wiring's `stacks`, the lamps are
 * in stack order, bottom (on the gate tile) first.
 * @typedef {{expression: string, lamps: Lamp[]}} Stack
 */

/** @type {Map<string, {okSets: number, expressions: Stack[], padded: Stack[]}>} */
const lampCache = new Map();

/**
 * Every cheapest expression of a gate, and which colour sets the gate's own tile may
 * carry: the lamp directly above the gate tile touches it, so it must not use any colour
 * that is on the gate tile.
 * @param {Object} options
 * @param {number} options.term the gate's truth table
 * @param {number} options.mask don't cares
 * @param {number} options.varCount number of variables (2 to 4)
 * @returns {{okSets: number, expressions: Stack[], padded: Stack[]}} bit S of okSets is
 *   set when colour set S (bit i = COLOURS[i]) is avoided by some lamp of some cheapest
 *   expression; padded holds each expression with one more lamp that has no wires.
 */
export function gateLamps({ term, mask, varCount }) {
  const key = `${term}|${mask}|${varCount}`;
  const cached = lampCache.get(key);
  if (cached) return cached;

  const target = term | mask;
  let lamps = Infinity;
  for (const [t, count] of Dictionary[varCount - 2]) {
    if ((t | mask) === target && count < lamps) lamps = count;
  }
  // Not a single gate (e.g. a matrix from an old or edited localStorage): nothing to try,
  // and an unbounded search depth would never finish.
  const result = gateOptions(lamps === Infinity ? [] : makeExpressionsBFS({ varCount, maxDepth: lamps, term: target, mask }));
  lampCache.set(key, result);
  return result;
}

/**
 * gateLamps' result for a given list of a gate's expressions.
 * @param {[string, number|number[]][]} found expressions as makeExpressionsBFS returns them
 * @returns {{okSets: number, expressions: Stack[], padded: Stack[]}}
 */
export function gateOptions(found) {
  const expressions = found.map(([expression, bitmaps]) => {
    // A one-lamp expression is just the lamp; otherwise it reads "¬⊕(lamp, lamp, …)".
    const names = Array.isArray(bitmaps) ? expression.replace(/^¬?[⊕∧]\(|\)$/g, "").split(", ") : [expression];
    const list = Array.isArray(bitmaps) ? bitmaps : [bitmaps];
    return { expression, lamps: list.map((bitmap, i) => ({ name: names[i], colours: (bitmap >> 1) & 0xf })) };
  });
  let okSets = 0;
  for (const stack of expressions)
    for (const { colours } of stack.lamps) for (let s = 0; s < 16; s++) if ((s & colours) === 0) okSets |= 1 << s;
  // An unwired lamp that stays off ("0") changes no XOR, one that stays on ("1") no AND.
  // It costs a lamp but can sit under the gate whatever colours the gate tile carries.
  const padded = expressions.map(({ expression, lamps }) => {
    const pad = { name: expression.includes("∧(") ? "1" : "0", colours: 0 };
    const text = expression.includes("(") ? expression.replace("(", `(${pad.name}, `) : `⊕(0, ${expression})`;
    return { expression: text, lamps: [pad, ...lamps] };
  });
  return { okSets, expressions, padded };
}

/**
 * A column with no lamps and no gate, for gateOptions lists: input wires can run down it
 * and into lamps from the side. Its index must be past every gate in the matrix rows.
 */
export const SPACER = { okSets: 0xffff, expressions: [{ expression: "", lamps: [] }], padded: [] };

/**
 * Wires gates with the given lamp options: most wanted first, every output on one wire
 * (no diode merging gate signals), then one colour per wire (up to 4 outputs only). For
 * those, gates may take a pad lamp (one more lamp) to free their tile's colours. The last
 * try, plain, decides between "impossible" and "unverified": it is the least strict. Each
 * try gets the full budget. An "ok" wiring comes with its routes, for drawing.
 * @param {number[]} rows rows[p] bit k: gate k reaches output p
 * @param {{okSets: number, expressions: Stack[], padded: Stack[]}[]} lamps per gate
 * @param {number} budget search nodes before giving up as "unverified"
 * @returns {Wiring & {routes?: {rows: number, cells: number[][][]}}}
 */
export function wireGates(rows, lamps, budget) {
  const options = {
    rows,
    okSets: lamps.map((l) => l.okSets),
    expressions: lamps.map((l) => l.expressions),
    padded: lamps.map((l) => l.padded),
    budget,
  };
  const g = lamps.length;
  const tries = [
    { cleanOutputs: true, distinctOutputs: true, maxPads: g },
    { cleanOutputs: true, maxPads: g },
    { distinctOutputs: true, maxPads: g },
    {},
  ];
  let result;
  for (const t of tries.filter((t) => !t.distinctOutputs || rows.length <= 4))
    if ((result = wire({ ...options, ...t })).status === "ok") break;
  return result.status === "ok" ? { ...result, routes: route(result) } : result;
}

/**
 * One wire of the decode layer. Gates and outputs are indexes.
 * @typedef {{gates: number[], outputs: number[], colour: number}} Wire
 */
/**
 * stacks[k] is gate k's expression with its lamps bottom first; inputs[c] are the tiles
 * input wire COLOURS[c] uses, as [column, row] with row 0 the bottom lamps and the top
 * edge at row max(stack height). Both only when `wire` got the gates' expressions.
 * @typedef {{status: "ok", wires: Wire[], gateOrder: number[], outputOrder: number[],
 *   stacks?: Stack[], inputs?: number[][][]}
 *   | {status: "impossible"} | {status: "unverified"}} Wiring
 */

/** Number of set bits. */
function popcount(x) {
  let c = 0;
  for (; x; x &= x - 1) c++;
  return c;
}

/** Rank of a set of bit vectors over GF(2). */
function rank(rows) {
  const basis = [];
  for (let x of rows) {
    for (const b of basis) x = Math.min(x, x ^ b);
    if (x) basis.push(x);
  }
  return basis.length;
}

/**
 * True when two different wires of one colour cross on the boundary sequence: some
 * a…b…a…b with a ≠ b. A crossing in a prefix stays a crossing, so prefixes can be pruned.
 * @param {number[][]} seq wire indexes on each placed tile, in boundary order
 * @param {number[]} colourOf colour of each wire
 */
function crosses(seq, colourOf) {
  for (let c = 0; c < 4; c++) {
    const labels = [];
    for (const tile of seq) for (const w of tile) if (colourOf[w] === c) labels.push(w);
    const last = new Map();
    labels.forEach((w, i) => last.set(w, i));
    // Stack of wires seen that still appear later; closing one that isn't on top is a crossing.
    const open = [];
    for (let i = 0; i < labels.length; i++) {
      const w = labels[i];
      if (open.at(-1) === w) {
        if (last.get(w) === i) open.pop();
      } else if (open.includes(w)) {
        return true;
      } else if (last.get(w) !== i) {
        open.push(w);
      }
    }
  }
  return false;
}

/** Every order of `items`. */
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations(items.toSpliced(i, 1)).map((rest) => [item, ...rest]));
}

/**
 * Every way to stack a gate's lamps over a gate tile carrying colour set `set`: any
 * cheapest expression, any bottom lamp avoiding `set`, the rest in any order. Stacks with
 * the same colours at every height are the same for wiring, so only one is kept. Stacks
 * whose input wires can run straight up come first: each lamp's colours on every lamp above.
 * @param {Stack[]} expressions
 * @param {number} set
 * @returns {Stack[]}
 */
function stackOrders(expressions, set) {
  const seen = new Map();
  for (const { expression, lamps } of expressions) {
    if (lamps.length === 0) seen.set("", { expression, lamps }); // SPACER
    lamps.forEach((bottom, i) => {
      if ((bottom.colours & set) !== 0) return;
      for (const rest of permutations(lamps.toSpliced(i, 1))) {
        const stack = [bottom, ...rest];
        const key = stack.map((l) => l.colours).join();
        if (!seen.has(key)) seen.set(key, { expression, lamps: stack });
      }
    });
  }
  const blocked = ({ lamps }) =>
    lamps.reduce((sum, l, i) => sum + lamps.slice(i + 1).filter((u) => (l.colours & ~u.colours) !== 0).length, 0);
  return [...seen.values()].sort((a, b) => blocked(a) - blocked(b));
}

/**
 * Routes each input wire from the top edge of the lamp area down to every lamp using it.
 * A wire on a lamp's tile toggles that lamp, so a wire may only cross empty tiles (above
 * a shorter stack) and lamps of its own colour. Inputs come in from the top edge only.
 *
 * While stacks are chosen left to right, only the first `placed` columns are known; the
 * lamps of the others block every wire for now. A lamp not reached yet can still be,
 * through a stack to the right, but only if its group of same-coloured lamps touches the
 * last known column. `edge` sums up what the known columns offer the rest: per colour and
 * per row of that column, blocked, reached from the top, or which unreached group.
 * @param {number[][]} columns per column, lamp colours bottom first
 * @param {number[]} heights stack height per column
 * @param {number} [placed] how many columns are known
 * @returns {{paths: number[][][], edge: string, needs: {bit: number, rows: number[]}[]}|null}
 *   paths: per colour the [column, row] tiles of its wire; needs: per unreached group, its
 *   colour and the rows where the next column must carry it to reach the group; null when
 *   some known lamp can no longer be reached
 */
function inputPaths(columns, heights, placed = heights.length) {
  const n = heights.length;
  const top = Math.max(...heights);
  const paths = [];
  const needs = [];
  let edge = "";
  for (let c = 0; c < 4; c++) {
    const bit = 1 << c;
    const passable = (x, r) => r >= heights[x] || (x < placed && (columns[x][r] & bit) !== 0);
    const near = (cell) => {
      const x = cell % n;
      const r = (cell - x) / n;
      return [[x - 1, r], [x + 1, r], [x, r - 1], [x, r + 1]]
        .filter(([nx, nr]) => nx >= 0 && nx < n && nr >= 0 && nr <= top && passable(nx, nr))
        .map(([nx, nr]) => nr * n + nx);
    };
    // Breadth-first from the top edge, so paths are short and run mostly straight up.
    const parent = new Map();
    const queue = [];
    for (let x = 0; x < n; x++) {
      parent.set(top * n + x, -1);
      queue.push(top * n + x);
    }
    for (const cell of queue) {
      for (const next of near(cell)) {
        if (parent.has(next)) continue;
        parent.set(next, cell);
        queue.push(next);
      }
    }
    const used = new Set();
    const group = new Map();
    const touches = (cell) => placed < n && cell % n === placed - 1 && Math.floor(cell / n) < heights[placed];
    for (let x = 0; x < placed; x++) {
      for (let r = 0; r < heights[x]; r++) {
        const cell = r * n + x;
        if ((columns[x][r] & bit) === 0 || group.has(cell)) continue;
        if (parent.has(cell)) {
          for (let t = cell; t !== -1 && !used.has(t); t = parent.get(t)) used.add(t);
          continue;
        }
        // Unreached: its whole group is unreached too (anything next to a reached tile is reached).
        const members = [cell];
        group.set(cell, group.size);
        for (const m of members)
          for (const next of near(m)) if (!group.has(next)) group.set(next, group.get(cell)) && members.push(next);
        const rows = members.filter(touches).map((m) => Math.floor(m / n));
        if (rows.length === 0) return null;
        needs.push({ bit, rows });
      }
    }
    if (placed > 0 && placed < n) {
      const names = new Map();
      for (let r = 0; r < heights[placed]; r++) {
        const cell = r * n + placed - 1;
        if (parent.has(cell)) edge += "r";
        else if (group.has(cell)) edge += names.get(group.get(cell)) ?? names.set(group.get(cell), names.size).get(group.get(cell));
        else edge += "-";
      }
      edge += "|";
    }
    paths.push([...used].sort((p, q) => p - q).map((cell) => [cell % n, Math.floor(cell / n)]));
  }
  return { paths, edge, needs };
}

/**
 * Finds wires, their colours and the gate and output order for one inverse matrix.
 * Constraints (implementation-plan.md §1.6): the wires XOR to `rows` (C0); wires on one
 * tile have different colours (C1); same-colour wires don't cross (C2); each gate's colour
 * set is in its okSets (C3); neighbouring tiles in a row share a colour only through the
 * same wire (C4). Given the gates' expressions, it also stacks each gate's lamps so the
 * bottom lamp avoids the gate tile's colours and every input wire reaches its lamps from
 * the top edge (see inputPaths).
 * @param {Object} options
 * @param {number[]} options.rows the inverse matrix, rows[p] bit k: gate k reaches output p
 * @param {number[]} options.okSets per gate, from gateLamps
 * @param {Stack[][]} [options.expressions] per gate, from gateLamps; without them the
 *   lamp stacks aren't laid out
 * @param {number} [options.budget] search nodes to try before giving up as "unverified"
 * @param {number} [options.maxWires] most wires to try (default 4n: each gate holds ≤ 4)
 * @param {boolean} [options.distinctOutputs] no two wires share a colour, so outputs never
 *   carry the same colour through different wires (one wire may still reach several outputs;
 *   at most 4 wires, so up to 4 outputs)
 * @param {boolean} [options.cleanOutputs] every output on exactly one wire, so no output
 *   mixes gate signals and needs a diode. That wire then carries exactly the gates of its row.
 * @param {Stack[][]} [options.padded] per gate, from gateLamps: expressions with a pad lamp
 * @param {number} [options.maxPads] most gates that may use a padded expression (one more
 *   lamp each) to carry colours none of their own lamps avoid; fewest pads are tried first
 * @returns {Wiring}
 */
export function wire({
  rows,
  okSets,
  expressions,
  padded,
  maxPads = 0,
  budget = Infinity,
  distinctOutputs = false,
  cleanOutputs = false,
  maxWires = cleanOutputs ? rows.length : 4 * okSets.length,
}) {
  const n = rows.length;
  // Gates, which may outnumber outputs (two gates XORed onto one output).
  const g = okSets.length;
  const residual = rows.slice();
  /** @type {{gates: number, outputs: number, colour: number}[]} */
  const wires = [];
  const gateColours = new Array(g).fill(0);
  const outputColours = new Array(n).fill(0);
  // Colours are interchangeable only when no gate restricts them; lamps always do.
  const symmetric = !expressions && okSets.every((s) => s === 0xffff);
  let nodes = 0;
  /** @type {{gateOrder: number[], outputOrder: number[]}} */
  let order = { gateOrder: [], outputOrder: [] };
  /** @type {{stacks: Stack[], inputs: number[][][]}|null} */
  let layout = null;
  /** Stack orders per gate and gate tile colour set. */
  const stackCache = new Map();
  /** Layouts per gate order and gate tile colours: covers often repeat them. */
  const layoutCache = new Map();
  const noColours = new Array(g).fill(0);
  // A gate whose tile carries colours no lamp of its own avoids needs a pad lamp.
  const needsPad = (k, set) => ((okSets[k] >> set) & 1) === 0;
  let padLimit = 0;

  // True once the budget is used up; every search level then unwinds with false.
  const spent = () => ++nodes > budget;

  // Picks a stack for each gate, left to right, until every input wire reaches its lamps.
  function stackGates(gateOrder, colours, pad) {
    const options = (k) => (pad[k] ? padded[k] : expressions[k]);
    const heights = gateOrder.map((k) => options(k)[0].lamps.length);
    const columns = [];
    const stacks = [];
    // Edges (see inputPaths) after x columns that were already tried and failed.
    const dead = new Set();
    const fill = (x) => {
      if (spent()) return null;
      const reach = inputPaths(columns, heights, x);
      if (reach === null || dead.has(`${x}:${reach.edge}`)) return null;
      if (x === g) return reach.paths;
      const k = gateOrder[x];
      const key = `${k}|${colours[k]}|${pad[k]}`;
      if (!stackCache.has(key)) stackCache.set(key, stackOrders(options(k), colours[k]));
      for (const stack of stackCache.get(key)) {
        if (!reach.needs.every(({ bit, rows }) => rows.some((r) => (stack.lamps[r].colours & bit) !== 0))) continue;
        columns[x] = stack.lamps.map((l) => l.colours);
        stacks[k] = stack;
        const found = fill(x + 1);
        if (found) return found;
      }
      dead.add(`${x}:${reach.edge}`);
      return null;
    };
    const inputs = fill(0);
    return inputs && { stacks, inputs };
  }

  // Gate tile colours only rule out bottom lamps, so the layout with no colours (but the
  // same pads) is checked once per gate order: if it fails, every colouring fails; if its
  // bottom lamps happen to avoid the colours, it is a layout for them too.
  function layoutFor(gateOrder, colours, pad) {
    const loose = cached(`${gateOrder}|${pad}`, () => stackGates(gateOrder, noColours, pad));
    if (loose === null || gateOrder.every((k) => ((loose.stacks[k].lamps[0]?.colours ?? 0) & colours[k]) === 0)) return loose;
    return cached(`${gateOrder.map((k) => `${k}:${colours[k]}`).join("|")}|${pad}`, () => stackGates(gateOrder, colours, pad));
  }
  // A pad lamp also lifts a stack, which can let input wires past it. So besides the pads
  // the colours need, up to padLimit in all may be added, fewest first. Pads only where the
  // colours need them would make the cover add wires that cancel out, just to earn a pad.
  function layoutWithPads(gateOrder, colours) {
    const need = colours.reduce((m, set, k) => m | (needsPad(k, set) ? 1 << k : 0), 0);
    // Gates with no padded expressions (a SPACER) take no extra pad.
    const fixed = need | colours.reduce((m, _, k) => m | (padded?.[k]?.length ? 0 : 1 << k), 0);
    for (let extra = 0; extra <= padLimit - popcount(need); extra++) {
      for (let more = 0; more < 1 << g; more++) {
        if (popcount(more) !== extra || (more & fixed) !== 0) continue;
        const pad = colours.map((_, k) => (((need | more) >> k) & 1) === 1);
        const found = layoutFor(gateOrder, colours, pad);
        if (found) return found;
      }
    }
    return null;
  }
  function cached(key, make) {
    if (!layoutCache.has(key)) layoutCache.set(key, make());
    return layoutCache.get(key);
  }

  // Places gates left to right, then outputs right to left, around the routing region.
  function placeTiles() {
    const colourOf = wires.map((w) => w.colour);
    const tileWires = (bit, side) => wires.flatMap((w, i) => (((w[side] >> bit) & 1) === 1 ? [i] : []));
    const gateTiles = Array.from({ length: g }, (_, k) => tileWires(k, "gates"));
    const outputTiles = Array.from({ length: n }, (_, p) => tileWires(p, "outputs"));
    const seq = [];
    const ids = [];
    const used = [new Set(), new Set()];

    const place = () => {
      if (spent() || crosses(seq, colourOf)) return false;
      if (seq.length > 1 && seq.length !== g + 1) {
        const [a, b] = seq.slice(-2);
        if (a.some((x) => b.some((y) => x !== y && colourOf[x] === colourOf[y]))) return false;
      }
      // Stack heights decide which lamps the input wires can reach, so check each gate order.
      if (seq.length === g && expressions && (layout = layoutWithPads(ids, gateColours)) === null) return false;
      if (seq.length === g + n) return true;
      const side = seq.length < g ? 0 : 1;
      const tiles = side === 0 ? gateTiles : outputTiles;
      for (let i = 0; i < tiles.length; i++) {
        if (used[side].has(i)) continue;
        used[side].add(i);
        seq.push(tiles[i]);
        ids.push(i);
        if (place()) return true;
        seq.pop();
        ids.pop();
        used[side].delete(i);
      }
      return false;
    };
    if (!place()) return false;
    order = { gateOrder: ids.slice(0, g), outputOrder: ids.slice(g).reverse() };
    return true;
  }

  function cover(limit, maxColour) {
    if (spent()) return false;
    const p0 = residual.findIndex((r) => r !== 0);
    // Smaller covers were already placed (and failed) at a lower limit.
    if (p0 < 0) return wires.length === limit && placeTiles();
    // Every remaining wire lowers the rank by at most one.
    if (rank(residual) > limit - wires.length) return false;

    // Some wire must cover the first 1-cell; wire order doesn't matter, so take it next.
    const g0 = Math.log2(residual[p0] & -residual[p0]);
    const candidates = [];
    for (let gates = 1; gates < 1 << g; gates++) {
      if (((gates >> g0) & 1) === 0) continue;
      for (let outputs = 1; outputs < 1 << n; outputs++) {
        if (((outputs >> p0) & 1) === 0) continue;
        if (cleanOutputs && (outputs !== 1 << p0 || gates !== residual[p0])) continue;
        let score = 0;
        for (let p = 0; p < n; p++) {
          if (((outputs >> p) & 1) === 1) score += 2 * popcount(residual[p] & gates) - popcount(gates);
        }
        candidates.push({ score, gates, outputs });
      }
    }
    candidates.sort((a, b) => b.score - a.score);

    for (const { gates, outputs } of candidates) {
      let taken = 0;
      for (let k = 0; k < g; k++) if (((gates >> k) & 1) === 1) taken |= gateColours[k];
      // Every wire reaches an output, so all output colours are every colour in use.
      for (let p = 0; p < n; p++) if (distinctOutputs || ((outputs >> p) & 1) === 1) taken |= outputColours[p];

      for (let colour = 0; colour < 4; colour++) {
        if (symmetric && colour > maxColour + 1) break;
        if (((taken >> colour) & 1) === 1) continue;
        const bit = 1 << colour;
        // C3, or a pad lamp under the gate when allowed.
        let pads = 0;
        let lampOk = true;
        for (let k = 0; k < g; k++) {
          if (!needsPad(k, gateColours[k] | (((gates >> k) & 1) === 1 ? bit : 0))) continue;
          pads++;
          if (!padded?.[k]?.length) lampOk = false;
        }
        if (!lampOk || pads > padLimit) continue;

        const apply = () => {
          for (let p = 0; p < n; p++) if (((outputs >> p) & 1) === 1) residual[p] ^= gates;
          for (let k = 0; k < g; k++) if (((gates >> k) & 1) === 1) gateColours[k] ^= bit;
          for (let p = 0; p < n; p++) if (((outputs >> p) & 1) === 1) outputColours[p] ^= bit;
        };
        apply();
        wires.push({ gates, outputs, colour });
        if (cover(limit, Math.max(maxColour, colour))) return true;
        wires.pop();
        apply();
      }
    }
    return false;
  }

  // A gate no single gate makes has no lamps to stack.
  if (expressions?.some((list) => list.length === 0)) return { status: "impossible" };
  // Gate tile colours only rule out bottom lamps, so when no gate order can be stacked
  // with none yet (for any choice of up to `limit` padded gates), no wiring can be.
  // Cheap next to searching every cover to prove it.
  const gates = [...okSets.keys()];
  const orders = permutations(gates);
  const patternOk = new Map();
  const stackable = (limit) => {
    for (let mask = 0; mask < 1 << g; mask++) {
      if (popcount(mask) > limit) continue;
      const pad = gates.map((k) => ((mask >> k) & 1) === 1);
      if (!patternOk.has(mask)) patternOk.set(mask, orders.some((o) => layoutFor(o, noColours, pad) !== null));
      if (patternOk.get(mask)) return true;
    }
    return false;
  };

  // Fewest pad lamps first, then fewest wires: allowing extra wires from the start makes
  // the search wander.
  for (; padLimit <= maxPads; padLimit++) {
    if (expressions && !stackable(padLimit)) {
      if (nodes > budget) return { status: "unverified" };
      continue;
    }
    for (let limit = rank(rows); limit <= maxWires; limit++) {
      if (cover(limit, -1)) {
        const bits = (x) => [...Array(Math.max(g, n)).keys()].filter((i) => ((x >> i) & 1) === 1);
        return {
          status: /** @type {"ok"} */ ("ok"),
          wires: wires.map((w) => ({ gates: bits(w.gates), outputs: bits(w.outputs), colour: w.colour })),
          ...order,
          ...layout,
        };
      }
      if (nodes > budget) return { status: "unverified" };
    }
  }
  return { status: "impossible" };
}

/**
 * Lays the decode wires out on tiles, for drawing: gate row at y = 0, `rows` routing rows
 * below it, output row at y = rows + 1, columns as in gateOrder / outputOrder.
 *
 * Non-crossing (C2) means same-colour wires are ordered left to right in both rows, and
 * row neighbours (C4) leave a free column between them. So each wire gets a trunk under
 * its gates (row 1), one over its outputs (last row), and a connector: straight down where
 * the trunks overlap, else down, across on its own turn row, and down again. Turn rows are
 * odd from 3 and two apart: wires going right turn higher the further right they are,
 * wires going left the further left, so no wire touches another of its colour.
 * @param {{wires: Wire[], gateOrder: number[], outputOrder: number[]}} wiring an "ok" wiring
 * @returns {{rows: number, cells: number[][][]}} cells[i] = the [x, y] routing tiles of wires[i]
 */
export function route({ wires, gateOrder, outputOrder }) {
  const spans = wires.map((w) => {
    const g = w.gates.map((k) => gateOrder.indexOf(k));
    const o = w.outputs.map((p) => outputOrder.indexOf(p));
    return { a: Math.min(...g), b: Math.max(...g), c: Math.min(...o), d: Math.max(...o) };
  });
  // Turn row of each wire that has to go sideways; per colour, ordered as above.
  const turn = new Array(wires.length).fill(0);
  let turns = 0;
  for (let colour = 0; colour < 4; colour++) {
    const mine = [...wires.keys()].filter((i) => wires[i].colour === colour).sort((i, j) => spans[i].a - spans[j].a);
    const right = mine.filter((i) => spans[i].c > spans[i].b).reverse();
    const left = mine.filter((i) => spans[i].d < spans[i].a);
    for (const list of [right, left]) list.forEach((i, t) => (turn[i] = 3 + 2 * t));
    turns = Math.max(turns, right.length, left.length);
  }
  const rows = 2 * turns + 3;

  const cells = spans.map(({ a, b, c, d }, i) => {
    const tiles = new Set();
    const line = (x1, y1, x2, y2) => {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) tiles.add(`${x},${y}`);
    };
    line(a, 1, b, 1);
    line(c, rows, d, rows);
    if (turn[i] === 0) {
      const x = Math.max(a, c); // in both trunks
      line(x, 1, x, rows);
    } else {
      const [x, y] = c > b ? [b, c] : [a, d];
      line(x, 1, x, turn[i]);
      line(x, turn[i], y, turn[i]);
      line(y, turn[i], y, rows);
    }
    return [...tiles].map((t) => t.split(",").map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  });
  return { rows, cells };
}
