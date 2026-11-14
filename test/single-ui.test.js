// Tests for the Single tab UI path: js/main.js (single, parsing, worker replies)
// and the single-output parts of js/state/handler.js, using a tiny fake DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fake-dom.js";

const { el, docListeners, workers } = installFakeDom();

const { startTest } = await import("../js/main.js");
const worker = workers.find((w) => w.url.endsWith("worker/worker.js"));
const reply = (data) => worker.onmessage({ data });
const submit = (value) => {
  el("term").value = value;
  worker.sent.length = 0;
  el("single_form").fire("submit");
  return worker.sent[0];
};

test("page load shows the checked tab; clicking a tab switches", () => {
  docListeners.DOMContentLoaded();
  assert.ok(el("tab_multi").classList.contains("active"));
  el("btn_single").checked = true;
  el("btn_single").fire("click");
  assert.ok(el("tab_single").classList.contains("active"));
  assert.ok(!el("tab_multi").classList.contains("active"));
});

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

test("single result is shown and offered as csv", () => {
  submit("0110");
  reply({ action: "result", results: [["ab", 7], ["¬⊕(a, ¬b)", [2, 5]]] });
  assert.equal(el("loader").style.display, "none");
  assert.equal(el("result").innerHTML, "ab<br>¬⊕(a, ¬b)");
  assert.equal(el("download").attrs.href, encodeURI('data:text/csv;charset=utf-8,﻿"ab"\n"¬⊕(a, ¬b)"'));
  assert.equal(el("download").attrs.download, "0110.csv");
  assert.equal(el("download").style.display, "inline-block");
});

test("double result is shown in two columns and csv pads the shorter one", () => {
  reply({ action: "double", results1: [["a", 2], ["b", 4]], results2: [["c", 8]] });
  assert.match(el("result").innerHTML, /<div>a<br>b<\/div>\s*<div>c<\/div>/);
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
