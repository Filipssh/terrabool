// Tests for how js/main.js shows multi-output results from the transmatrix worker,
// using the fake DOM. Starts with the empty list older versions saved, which used
// to crash the page on load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fake-dom.js";
import { route } from "../js/worker/wiring.js";

const { el, storage, workers } = installFakeDom({ matrices: "[]" });
await import("../js/main.js"); // would throw here if the stored [] were displayed
const transmatrix = workers.find((w) => w.url.endsWith("worker/transmatrix.js"));
const reply = (data) => transmatrix.onmessage({ data });

const m1 = { complexity: 3, rows: [1, 2], transitioned: [0b0110, 0b1100], mask: 0 };
const m2 = { complexity: 4, rows: [3, 2], transitioned: [0b1010, 0b1100], mask: 0 };

test("a stored empty list from an older version loads with the results hidden", () => {
  assert.equal(el("result_multi").style.display, "none");
  assert.equal(el("displayed_matrix").innerHTML, "");
});

test("matrices are shown, saved, and the first one has prev disabled", () => {
  reply({ action: "matrices", results: [m1, m2] });
  assert.equal(el("result_multi").style.display, "grid");
  assert.equal(el("result_multi_pos").innerText, "1 / 2");
  assert.match(el("displayed_matrix").innerHTML, /<span>3<\/span>/);
  assert.equal(storage.get("matrices"), JSON.stringify([m1, m2]));
  assert.equal(el("result_multi_prev").disabled, true);
  assert.equal(el("result_multi_next").disabled, false);

  el("result_multi_next").fire("click");
  assert.match(el("displayed_matrix").innerHTML, /<span>4<\/span>/);
  assert.equal(el("result_multi_next").disabled, true);
  assert.equal(el("result_multi_pos").innerText, "2 / 2");
});

for (const results of [[], undefined]) {
  test(`no matrices (${JSON.stringify(results)}) shows an error instead of crashing`, () => {
    reply({ action: "matrices", results: [m1, m2] });
    reply({ action: "matrices", results });
    assert.equal(el("error_multi").style.display, "block");
    assert.equal(el("error_multi").innerHTML, "No solution found for these outputs");
    assert.equal(el("result_multi").style.display, "none", "old prev/next are hidden");
    assert.equal(storage.has("matrices"), false, "nothing is saved for the next page load");
  });
}

/**
 * The first column of a TEdit schematic (js/state/tedit.js), top to bottom: "type:U,V/wires"
 * ("type/wires" for a block without frame; just the wires on an empty tile).
 */
function teditColumn(bytes, height) {
  let p = 1 + bytes[0] + 4 + 97 + 8; // past the name, version, frame-important bits and size
  const column = [];
  while (column.length < height) {
    const h1 = bytes[p++];
    const h2 = h1 & 1 ? bytes[p++] : 0;
    const h3 = h2 & 1 ? bytes[p++] : 0;
    let tile = "";
    if (h1 & 2) {
      const type = bytes[p] | (h1 & 32 ? bytes[p + 1] << 8 : 0);
      p += h1 & 32 ? 2 : 1;
      tile = String(type);
      if (type === 419 || type === 420) (tile += `:${bytes.readInt16LE(p)},${bytes.readInt16LE(p + 2)}`), (p += 4);
    }
    const wires = ["R", "B", "G"].filter((_, c) => (h2 >> (c + 1)) & 1).join("") + (h3 & 32 ? "Y" : "");
    column.push(tile && wires ? `${tile}/${wires}` : tile || wires);
  }
  return column;
}

// --- wiring ------------------------------------------------------------------------
const wired = {
  complexity: 2,
  rows: [0b01, 0b11],
  transitioned: [0b0110, 0b1100],
  mask: 0,
  varCount: 2,
  wiring: {
    status: "ok",
    wires: [
      { gates: [0], outputs: [0, 1], colour: 2 },
      { gates: [1], outputs: [1], colour: 3 },
    ],
    gateOrder: [1, 0],
    outputOrder: [0, 1],
    stacks: [
      { expression: "ab", lamps: [{ name: "ab", colours: 0b0011 }] },
      { expression: "a", lamps: [{ name: "a", colours: 0b0001 }] },
    ],
    // Red reaches both lamps, blue only "ab" (column 1); both from the top edge (row 1).
    inputs: [[[0, 0], [1, 0], [0, 1], [1, 1]], [[1, 0], [1, 1]], [], []],
  },
};
wired.wiring.routes = route(wired.wiring);
const unverified = { ...wired, complexity: 5, wiring: { status: "unverified" } };
// A real worker reply is a structured clone, and main.js updates the matrices it gets.
const results = (list) => reply({ action: "matrices", results: structuredClone(list) });

test("a wired matrix lists its wires, the tile order, each gate's lamp stack and a picture", () => {
  results([wired, unverified]);
  const html = el("displayed_matrix").innerHTML;
  assert.match(html, /<th>G2<\/th><th>G1<\/th>/, "columns are labelled, last gate first");
  assert.match(html, /<th>O2<\/th><td>1<\/td><td>1<\/td><td>G2 = 0000000000001100<\/td>/);
  assert.match(html, /background: green"><\/span>green: G1 → O1 O2/);
  assert.match(html, /background: yellow"><\/span>yellow: G2 → O2/);
  assert.match(html, /Gates left to right: G2 G1<br>Outputs left to right: O1 O2/);
  assert.match(html, /O2 mixes gate signals: one diode each/, "O2 is on the green and the yellow wire");
  assert.match(html, /G1 = ab: green on the gate, lamps bottom to top ab/);
  // The picture comes before the folded intermediate steps, which hold the matrix.
  // O1 is G1 (0110), O2 is G1 xor G2 (0110 ^ 1100): 2-variable tables are 4 characters.
  assert.match(html, /<\/svg><a class="export" download="TBool_2g_2l_0110-1010.TEditSch" href="data:application\/octet-stream;base64,[\w+/=]+">Export as TEdit schematic<\/a><details class="steps"><summary>Intermediate steps<\/summary><table>/);
  // The export holds the picture's tiles. Column 0 is G2 ("a"): top edge, lamp, gate, 5 routing rows, O1.
  const bytes = Buffer.from(html.match(/base64,([\w+/=]+)/)[1], "base64");
  // Red input to the off lamp, the off XOR gate on yellow (to O2, turning right), O1 off on green.
  assert.deepEqual(teditColumn(bytes, 9), ["R", "419:0,0/R", "420:0,72/Y", "Y", "Y", "Y", "", "G", "260/G"]);
  const svg = html.match(/<svg[^>]*>.*<\/svg>/s)?.[0];
  assert.ok(svg, "the module is drawn");
  // Top edge, one lamp row, gate row, 5 routing rows (yellow turns right), output row: 9 rows of 64px.
  assert.match(svg, /viewBox="0 0 128 576"/);
  // "a" and "ab" are off lamps; each XOR gate has no lamp on; so are both outputs.
  for (const tile of ["lamp_off", "gate_xor_off", "output_off"]) assert.ok(svg.includes(`assets/tileset/${tile}.png`), tile);
  assert.doesNotMatch(svg, /_on\.png/);
  for (const label of [">a<", ">ab<", ">G2<", ">G1<", ">O1<", ">O2<"]) assert.ok(svg.includes(label), label);
  // Red (#d62728) and blue (#1f77b4) input wires leave through the top; green and yellow don't.
  assert.match(svg, /y2="0" stroke="#d62728"/);
  assert.match(svg, /y2="0" stroke="#1f77b4"/);
  assert.doesNotMatch(svg, /y2="0" stroke="#2ca02c"/);
  assert.equal(el("result_multi_wire").style.display, "none");
});

test("an unverified matrix can be wired again, with Abort available", () => {
  results([wired, unverified]);
  el("result_multi_next").fire("click");
  assert.match(el("displayed_matrix").innerHTML, /Wiring not verified/);
  assert.equal(el("result_multi_wire").style.display, "inline-block");

  transmatrix.sent = [];
  el("result_multi_wire").fire("click");
  assert.deepEqual(transmatrix.sent, [{ action: "wire", index: 1, matrix: unverified }]);
  assert.equal(el("loader_multi").style.display, "inline-block");
  assert.equal(el("multi_abort").style.display, "inline-block");
  assert.equal(el("result_multi_wire").style.display, "none");

  // Pad lamps can make the wired matrix cost more: the reply carries its lamp count.
  reply({ action: "wiring", index: 1, wiring: wired.wiring, complexity: 6 });
  assert.equal(el("loader_multi").style.display, "none");
  assert.match(el("displayed_matrix").innerHTML, /<span>6<\/span>.*Gates left to right/s);
  assert.equal(JSON.parse(storage.get("matrices"))[1].wiring.status, "ok", "saved for the next page load");
  assert.equal(JSON.parse(storage.get("matrices"))[1].complexity, 6);
});

test("a retry that proves the matrix impossible says so, and replies for hidden matrices only save", () => {
  results([wired, unverified]);
  el("result_multi_next").fire("click");
  el("result_multi_wire").fire("click");
  el("result_multi_prev").fire("click"); // look at another matrix while it runs
  reply({ action: "wiring", index: 1, wiring: { status: "impossible" } });
  assert.match(el("displayed_matrix").innerHTML, /Gates left to right/, "matrix 0 is still shown");
  assert.equal(JSON.parse(storage.get("matrices"))[1].wiring.status, "impossible");
  el("result_multi_next").fire("click");
  assert.match(el("displayed_matrix").innerHTML, /can't be wired/);
  assert.equal(el("result_multi_wire").style.display, "none");
});

test("a wiring saved before lamp stacks were laid out is offered for wiring again", () => {
  const { stacks, inputs, routes, ...old } = wired.wiring;
  results([{ ...wired, wiring: old }]);
  assert.match(el("displayed_matrix").innerHTML, /Wiring not verified/);
  assert.doesNotMatch(el("displayed_matrix").innerHTML, /<svg/);
  assert.equal(el("result_multi_wire").style.display, "inline-block");
});

test("matrices saved by older versions can't be retried", () => {
  reply({ action: "matrices", results: [m1] });
  assert.match(el("displayed_matrix").innerHTML, /older version/);
  assert.equal(el("result_multi_wire").style.display, "none");
});

test("aborting a retry brings the button back", () => {
  results([unverified]);
  el("result_multi_wire").fire("click");
  el("multi_abort").fire("click");
  assert.equal(el("result_multi_wire").style.display, "inline-block");
  assert.equal(el("loader_multi").style.display, "none");
});

// --- overlapping jobs (code review findings) ----------------------------------------
/** Submits the multi form with these output fields, like a user pressing Start. */
function multiWith(values) {
  const fields = values.map((value) => ({ value }));
  const original = document.querySelectorAll;
  /** @type {any} */ (document).querySelectorAll = (sel) => (sel === "#multi_field_group .multi_output" ? fields : original(sel));
  el("multi_form").fire("submit");
  /** @type {any} */ (document).querySelectorAll = original;
}
test("a new search hides try wiring, and a late retry reply never lands on the new results", () => {
  results([wired, unverified]);
  el("result_multi_next").fire("click");
  el("result_multi_wire").fire("click"); // retry of the unverified matrix…
  multiWith(["0110", "1100"]); // …then a new search, queued behind it
  assert.equal(el("result_multi_wire").style.display, "none");

  reply({ action: "wiring", index: 1, wiring: wired.wiring });
  assert.equal(el("loader_multi").style.display, "inline-block", "the search is still running");
  assert.equal(el("displayed_matrix").innerHTML, "", "the cleared area stays cleared");

  // The new results arrive; a stale reply for index 0 must not be applied to them.
  results([unverified]);
  assert.equal(el("loader_multi").style.display, "none");
  reply({ action: "wiring", index: 0, wiring: wired.wiring });
  assert.equal(JSON.parse(storage.get("matrices"))[0].wiring.status, "unverified");
  assert.match(el("displayed_matrix").innerHTML, /Wiring not verified/);
});

test("try wiring is hidden while a retry runs, even on another unverified matrix", () => {
  results([unverified, { ...unverified }]); // two separate objects, as a worker reply has
  el("result_multi_wire").fire("click");
  el("result_multi_next").fire("click");
  assert.equal(el("result_multi_wire").style.display, "none");
  reply({ action: "wiring", index: 0, wiring: { status: "impossible" } });
  assert.equal(el("result_multi_wire").style.display, "none", "redraws only the matrix shown");
  el("result_multi_prev").fire("click");
  assert.match(el("displayed_matrix").innerHTML, /can't be wired/, "applied to the matrix it was for");
  el("result_multi_next").fire("click");
  assert.equal(el("result_multi_wire").style.display, "inline-block", "offered again once idle");
});

test("a retry reply after the results were cleared is ignored", () => {
  results([unverified]);
  el("result_multi_wire").fire("click");
  reply({ action: "matrices", results: [] });
  assert.doesNotThrow(() => reply({ action: "wiring", index: 0, wiring: wired.wiring }));
});

// --- tile states ------------------------------------------------------------------------
const { tileStates } = await import("../js/state/handler.js");

test("tile states: negated lamps are on, a gate follows its lamps, its ¬ flips the output", () => {
  // ¬∧(¬b, ¬ab): two on lamps, an on AND gate, an off output.
  const stacks = [{ expression: "¬∧(¬b, ¬ab)", lamps: [{ name: "¬b" }, { name: "¬ab" }] }];
  assert.deepEqual(tileStates(stacks, [1]), { lamps: [[true, true]], gates: [true], outputs: [false] });
  // An XOR gate is on with exactly one lamp on (pads and "1" count); an output XORs the
  // gates of its row.
  const xor = [
    { expression: "⊕(1, a)", lamps: [{ name: "1" }, { name: "a" }] }, // on: one lamp on
    { expression: "¬⊕(¬a, ¬b, ¬c)", lamps: [{ name: "¬a" }, { name: "¬b" }, { name: "¬c" }] }, // off: three on; ¬ makes it 1
    { expression: "∧(0, a)", lamps: [{ name: "0" }, { name: "a" }] }, // off
  ];
  assert.deepEqual(tileStates(xor, [0b001, 0b011, 0b111]), {
    lamps: [[true, false], [true, true, true], [false, false]],
    gates: [true, false, false],
    outputs: [true, false, false],
  });
});

test("tile states: every output shows its own value with all inputs off", async () => {
  // The real worker on a user's 4 outputs (4 inputs, top 3 rows don't care). It is a
  // worker script: importing it sets the global onmessage, and it answers by postMessage.
  const g = /** @type {any} */ (globalThis);
  const replies = [];
  g.onmessage = null;
  g.postMessage = (m) => replies.push(m);
  await import("../js/worker/transmatrix.js");
  const terms = [0b0001100000000000, 0b0000011111110000, 0b0000011011001100, 0b0001010110101010];
  // noinspection JSObjectNullOrUndefined: the import above set it
  g.onmessage({ data: { action: "generate", varCount: 4, terms, mask: 0b1110000000000000, hardLimit: 20 } });
  const { results } = replies.at(-1);
  assert.equal(results.length, 20);
  for (const m of results) {
    // Input 0 (all off) is bit 0 of a truth table, for the outputs and for each gate's signal.
    const { outputs } = tileStates(m.wiring.stacks, m.rows);
    assert.deepEqual(outputs, terms.map((t) => (t & 1) === 1), JSON.stringify(m.wiring.stacks));
    m.transitioned.forEach((t, k) => {
      const one = tileStates([m.wiring.stacks[k]], [1]).outputs[0];
      assert.equal(one, (t & 1) === 1, m.wiring.stacks[k].expression);
    });
  }
});
