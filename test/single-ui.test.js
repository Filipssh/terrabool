// Tests for the Single tab UI path: js/main.js (single, parsing, worker replies)
// and the single-output parts of js/state/handler.js, using a tiny fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fake-dom.js";

const { el, workers } = installFakeDom();

const { startTest } = await import("../js/main.js");
const worker = workers.find((w) => w.url.endsWith("worker/worker.js"));
const reply = (data) => worker.onmessage({ data });
const submit = (value) => {
  el("term").value = value;
  worker.sent.length = 0;
  el("single_form").fire("submit");
  return worker.sent[0];
};

test("input turns blue only at a valid length", () => {
  for (const [v, color] of [["0110", "#00C8FF"], ["01100110", "#00C8FF"], ["0".repeat(16), "#00C8FF"], ["011", "black"]]) {
    el("term").value = v;
    el("term").fire("input");
    assert.equal(el("term").style.color, color, v);
  }
});

test("submit parses the truth table and starts a search", () => {
  assert.deepEqual(submit("0110"), { action: "search", varCount: 2, maxDepth: 3, term: 0b0110, mask: 0 });
  assert.deepEqual(submit("10010110"), { action: "search", varCount: 3, maxDepth: 4, term: 0b10010110, mask: 0 });
  assert.deepEqual(submit("xxx0011011001100"), {
    action: "search", varCount: 4, maxDepth: 5, term: 0b1110011011001100, mask: 0b1110000000000000,
  });
  // Any lower case letter counts as a don't care, not only "x".
  assert.deepEqual(submit("0a01"), { action: "search", varCount: 2, maxDepth: 3, term: 0b0101, mask: 0b0100 });
  assert.equal(el("loader").style.display, "inline-block");
  assert.equal(el("error").style.display, "none");
});

test("bad input shows an error and starts nothing", () => {
  for (const [v, msg] of [
    ["012", "Use only 0, 1 and lower case letters"],
    ["", "Use only 0, 1 and lower case letters"],
    ["0110X", "Use only 0, 1 and lower case letters"],
    ["011", "Invalid value length"],
    ["0".repeat(32), "Invalid value length"],
  ]) {
    assert.equal(submit(v), undefined, v);
    assert.equal(el("error").style.display, "block");
    assert.equal(el("error").innerHTML, msg, v);
  }
});

// The search id of the shown results, from the first drawing they asked for.
let id;

test("single result is listed, the first one drawn, and offered as csv", () => {
  submit("0110");
  worker.sent.length = 0;
  reply({ action: "result", results: [["ab", 7], ["¬⊕(a, <b)", [2, 5]]] });
  assert.equal(el("loader").style.display, "none");
  const html = el("result").innerHTML;
  assert.match(html, /<details id="sol_0"><summary><code>ab<\/code>.*id="draw_0"/);
  assert.match(html, /<code>¬⊕\(a, &lt;b\)<\/code>.*id="draw_1"/, "expressions are escaped");
  assert.equal(el("sol_0").open, true);
  id = worker.sent[0].id;
  assert.deepEqual(worker.sent, [{ action: "draw", id, picks: [0], expressions: [["ab", 7]] }]);
  assert.match(el("draw_0").innerHTML, /loader/);
  assert.equal(el("download").attrs.href, encodeURI('data:text/csv;charset=utf-8,﻿"ab"\n"¬⊕(a, <b)"'));
  assert.equal(el("download").attrs.download, "0110.csv");
  assert.equal(el("download").style.display, "inline-block");
});

test("opening a solution draws it once; replies for older searches are dropped", () => {
  worker.sent.length = 0;
  const sol = Object.assign(el("sol_1"), { id: "sol_1", open: true });
  el("result").fire("toggle", sol);
  assert.deepEqual(worker.sent, [{ action: "draw", id, picks: [1], expressions: [["¬⊕(a, <b)", [2, 5]]] }]);
  el("result").fire("toggle", sol); // already on its way: not asked again
  sol.open = false;
  el("result").fire("toggle", sol); // closing asks nothing
  assert.equal(worker.sent.length, 1);

  reply({ action: "drawing", id: id - 1, picks: [1], rows: [1], wiring: { status: "impossible" } });
  assert.match(el("draw_1").innerHTML, /loader/);
  reply({ action: "drawing", id, picks: [1], rows: [1], wiring: { status: "impossible" } });
  assert.match(el("draw_1").innerHTML, /can't be laid out/);
});

test("a drawn single shows its lamp count and module", () => {
  const wiring = {
    status: "ok",
    wires: [{ gates: [0], outputs: [0], colour: 1 }],
    gateOrder: [1, 0],
    outputOrder: [0],
    // Gate 1 is an empty spacer column: no tile is drawn for it.
    stacks: [{ expression: "ab", lamps: [{ name: "ab", colours: 0b0011 }] }, { expression: "", lamps: [] }],
    inputs: [[[1, 0], [1, 1]], [[0, 1], [0, 0], [1, 0]], [], []],
    routes: { rows: 3, cells: [[[1, 1], [1, 2], [0, 3], [1, 3]]] },
  };
  el("term").value = "1111"; // edited after the search: the export keeps the searched term
  reply({ action: "drawing", id, picks: [0], rows: [1], wiring });
  const html = el("draw_0").innerHTML;
  assert.match(html, /download="TBool_0110\.TEditSch"/);
  assert.match(html, /<span>1<\/span> lamps/);
  assert.match(html, /<svg class="module" viewBox="0 0 128 448"/);
  assert.equal(html.match(/gate_xor/g).length, 1, "the spacer has no gate tile");
  assert.doesNotMatch(html, />G2</);
});

test("double result is two columns to pick from, and csv pads the shorter one", () => {
  worker.sent.length = 0;
  reply({ action: "double", results1: [["a", 2], ["b", 4]], results2: [["c", 8]] });
  const html = el("result").innerHTML;
  assert.match(html, /name="col0" value="0" checked> <code>a<\/code>.*name="col0" value="1"> <code>b<\/code>.*name="col1" value="0" checked> <code>c<\/code>/s);
  assert.deepEqual(worker.sent, [{ action: "draw", id, picks: [0, 0], expressions: [["a", 2], ["c", 8]] }]);
  el("result").fire("change", { name: "col0", value: "1" });
  assert.deepEqual(worker.sent[1], { action: "draw", id, picks: [1, 0], expressions: [["b", 4], ["c", 8]] });
  // The reply for the previous pair isn't shown; the one for the current pair is.
  reply({ action: "drawing", id, picks: [0, 0], rows: [3], wiring: { status: "impossible" } });
  assert.match(el("draw_pair").innerHTML, /loader/);
  reply({ action: "drawing", id, picks: [1, 0], rows: [3], wiring: { status: "impossible" } });
  assert.match(el("draw_pair").innerHTML, /can't be laid out/);
  assert.equal(el("download").attrs.href, encodeURI('data:text/csv;charset=utf-8,﻿"a","c"\n"b",""'));
});

test("missing results show the bug message", () => {
  const bug = "Something went wrong. Please report this as a bug.";
  for (const data of [
    { action: "result", results: undefined },
    { action: "double", results1: [["a", 2]], results2: undefined },
  ]) {
    el("result").innerHTML = "";
    reply(data);
    assert.equal(el("result").innerHTML, bug);
  }
});

test("startTest asks the worker to rebuild the dictionary and logs the result", (t) => {
  const log = t.mock.method(console, "log", () => {});
  worker.sent.length = 0;
  startTest(2, 3);
  assert.deepEqual(worker.sent[0], { action: "test", varCount: 2, maxDepth: 3 });
  reply({ action: "test", results: [null, [1, 2]] });
  assert.deepEqual(log.mock.calls[1].arguments[0], [[1, 2]]);
});
