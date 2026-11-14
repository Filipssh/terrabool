// Tests for how js/main.js shows multi-output results from the transmatrix worker,
// using the fake DOM. Starts with the empty list older versions saved, which used
// to crash the page on load.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./fake-dom.js";

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
  assert.equal(el("result_multi").style.display, "block");
  assert.match(el("displayed_matrix").innerHTML, /<span>3<\/span>/);
  assert.equal(storage.get("matrices"), JSON.stringify([m1, m2]));
  assert.equal(el("result_multi_prev").disabled, true);
  assert.equal(el("result_multi_next").disabled, false);

  el("result_multi_next").fire("click");
  assert.match(el("displayed_matrix").innerHTML, /<span>4<\/span>/);
  assert.equal(el("result_multi_next").disabled, true);
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
