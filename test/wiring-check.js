// Independent checker for wirings from js/worker/wiring.js, shared by the tests.
import assert from "node:assert/strict";

// --- independent checker ---------------------------------------------------------
/** Asserts that `result` is a valid wiring of `rows` (implementation-plan.md §1.6). */
export function checkWiring(rows, okSets, result) {
  const n = rows.length;
  assert.equal(result.status, "ok");
  const { wires, gateOrder, outputOrder } = result;
  assert.deepEqual([...gateOrder].sort(), [...Array(n).keys()], "gate order is a permutation");
  assert.deepEqual([...outputOrder].sort(), [...Array(n).keys()], "output order is a permutation");

  // C0: the wires XOR to the matrix.
  const rebuilt = new Array(n).fill(0);
  for (const w of wires) {
    assert.ok(w.gates.length > 0 && w.outputs.length > 0, "a wire touches a gate and an output");
    assert.ok(w.colour >= 0 && w.colour < 4);
    for (const p of w.outputs) for (const k of w.gates) rebuilt[p] ^= 1 << k;
  }
  assert.deepEqual(rebuilt, rows, "wires XOR to the inverse matrix");

  // C1: wires on one tile have different colours.
  const tileColours = (side, i) => wires.filter((w) => w[side].includes(i)).map((w) => w.colour);
  for (let i = 0; i < n; i++) {
    for (const side of ["gates", "outputs"]) {
      const c = tileColours(side, i);
      assert.equal(new Set(c).size, c.length, `${side} ${i} has a colour twice`);
    }
  }
  // C3: each gate's colour set has a bottom lamp.
  for (let k = 0; k < n; k++) {
    const set = tileColours("gates", k).reduce((a, c) => a | (1 << c), 0);
    assert.ok((okSets[k] >> set) & 1, `gate ${k} can't carry colour set ${set}`);
  }

  // Boundary of the routing region: gates left→right, then outputs right→left.
  const boundary = [
    ...gateOrder.map((k) => wires.filter((w) => w.gates.includes(k))),
    ...[...outputOrder].reverse().map((p) => wires.filter((w) => w.outputs.includes(p))),
  ];
  // C4: neighbours in one row share a colour only through the same wire.
  for (let i = 1; i < 2 * n; i++) {
    if (i === n) continue; // last gate and first output are in different rows
    for (const a of boundary[i - 1])
      for (const b of boundary[i]) assert.ok(a === b || a.colour !== b.colour, `tiles ${i - 1},${i} touch`);
  }
  // C2: no a…b…a…b of two same-coloured wires, by brute force over positions.
  for (const a of wires)
    for (const b of wires) {
      if (a === b || a.colour !== b.colour) continue;
      const has = (i, w) => boundary[i].includes(w);
      const m = boundary.length;
      for (let i = 0; i < m; i++)
        for (let j = i + 1; j < m; j++)
          for (let k = j + 1; k < m; k++)
            for (let l = k + 1; l < m; l++)
              assert.ok(!(has(i, a) && has(j, b) && has(k, a) && has(l, b)), "same-colour wires cross");
    }
}


/** Asserts that every tile in `tiles` (["x,y"] strings) connects to `start` tiles through `tiles`. */
function assertConnected(tiles, starts, message) {
  const seen = new Set(starts.filter((t) => tiles.has(t)));
  const todo = [...seen];
  while (todo.length) {
    const [x, y] = todo.pop().split(",").map(Number);
    for (const t of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`])
      if (tiles.has(t) && !seen.has(t)) seen.add(t) && todo.push(t);
  }
  assert.equal(seen.size, tiles.size, message);
}

/**
 * Asserts the lamp stacks and input wires of an "ok" wiring: each stack is a cheapest
 * expression of its gate, its bottom lamp avoids the gate tile's colours, and each input
 * wire runs only on empty tiles and lamps of its colour, reaches all of them and connects
 * every tile it uses to the top edge.
 * @param {{wires: {gates: number[], colour: number}[], gateOrder: number[], stacks: any[],
 *   inputs: number[][][]}} wiring
 * @param {{expression: string, lamps: {name: string, colours: number}[]}[][]} expressions per gate
 */
export function checkLayout(wiring, expressions) {
  const { wires, gateOrder, stacks, inputs } = wiring;
  const names = (lamps) => lamps.map((l) => `${l.name}:${l.colours}`).sort().join();
  stacks.forEach((stack, k) => {
    const own = expressions[k].find((e) => e.expression === stack.expression);
    assert.ok(own, `gate ${k} uses one of its cheapest expressions`);
    assert.equal(names(stack.lamps), names(own.lamps), `gate ${k} stacks exactly its expression's lamps`);
    const set = wires.filter((w) => w.gates.includes(k)).reduce((s, w) => s | (1 << w.colour), 0);
    if (stack.lamps.length > 0) assert.equal(stack.lamps[0].colours & set, 0, `gate ${k}: bottom lamp touches a wire on the gate tile`);
  });
  const columns = gateOrder.map((k) => stacks[k].lamps);
  const top = Math.max(...columns.map((c) => c.length));
  assert.equal(inputs.length, 4);
  inputs.forEach((tiles, c) => {
    const set = new Set(tiles.map(([x, r]) => `${x},${r}`));
    for (const [x, r] of tiles) {
      assert.ok(x >= 0 && x < columns.length && r >= 0 && r <= top, "input tile inside the module");
      if (r < columns[x].length) assert.ok((columns[x][r].colours >> c) & 1, `input ${c} would toggle a lamp at ${x},${r}`);
    }
    columns.forEach((lamps, x) =>
      lamps.forEach((l, r) => assert.equal(set.has(`${x},${r}`), ((l.colours >> c) & 1) === 1, `lamp ${x},${r} input ${c}`)),
    );
    assertConnected(set, columns.map((_, x) => `${x},${top}`), `input ${c} reaches its lamps from the top edge`);
  });
}

/**
 * Asserts a tile layout of the decode wires: each wire is one connected net through its
 * gate tiles (y = 0), routing tiles (1..rows) and output tiles (rows + 1), and never shares
 * or touches a tile of another wire of its colour.
 */
export function checkRoutes({ wires, gateOrder, outputOrder }, { rows, cells }) {
  assert.equal(cells.length, wires.length);
  const owner = [0, 1, 2, 3].map(() => new Map());
  wires.forEach((w, i) => {
    const tiles = new Set([
      ...w.gates.map((k) => `${gateOrder.indexOf(k)},0`),
      ...w.outputs.map((p) => `${outputOrder.indexOf(p)},${rows + 1}`),
    ]);
    for (const [x, y] of cells[i]) {
      assert.ok(x >= 0 && x < gateOrder.length && y >= 1 && y <= rows, "routing tile inside the routing rows");
      tiles.add(`${x},${y}`);
    }
    assertConnected(tiles, [[...tiles][0]], `wire ${i} is one net`);
    for (const t of tiles) {
      assert.ok(!owner[w.colour].has(t), `wires ${owner[w.colour].get(t)} and ${i} share tile ${t}`);
      owner[w.colour].set(t, i);
    }
  });
  for (const map of owner)
    for (const [t, i] of map) {
      const [x, y] = t.split(",").map(Number);
      for (const u of [`${x + 1},${y}`, `${x},${y + 1}`])
        assert.ok(!map.has(u) || map.get(u) === i, `wires ${i} and ${map.get(u)} touch at ${t}`);
    }
}
