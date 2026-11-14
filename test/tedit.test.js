// Tests for the TEdit schematic writer, byte for byte against the layout TEdit reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { teditSchematic } from "../js/state/tedit.js";

test("a 2x2 module is written as TEdit's V5 clipboard file", () => {
  const bytes = teditSchematic(
    "t",
    [
      [0b0001, 0b1000],
      [0b0110, 0],
    ],
    [
      [null, { image: "lamp", on: true }],
      [{ image: "gate_xor", on: false }, { image: "output", on: true }],
    ],
  );
  const size = [2, 0, 0, 0, 2, 0, 0, 0];
  const head = [1, 116, 0x66, 0x4f, 0, 0]; // "t", 326 + 20000
  assert.deepEqual([...bytes.slice(0, 6)], head);
  assert.deepEqual([...bytes.slice(6, 8)], [0xf2, 0x02], "754 frame-important bits follow");
  const tiles = [
    [1, 2], // red wire only
    [35, 12, 164, 1, 0, 0, 72, 0], // blue + green on an off XOR gate (420, U 0, V 72)
    [35, 1, 32, 163, 1, 18, 0, 0, 0], // yellow on an on lamp (419, U 18, V 0)
    [34, 11, 1], // an on output: Diamond Gemspark (267), no frame
  ].flat();
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 1, 116, 0x46, 1, 0, 0, ...size];
  assert.deepEqual([...bytes.slice(6 + 97)], [...size, ...tiles, ...tail]);
});

test("an off AND gate and an off output", () => {
  const bytes = teditSchematic("t", [[0, 0]], [[{ image: "gate_and", on: false }, { image: "output", on: false }]]);
  // AND is frame V 0; an off output is Diamond Gemspark (Offline), 260. Then 8 empty bytes and the 14-byte footer.
  assert.deepEqual([...bytes.slice(6 + 97 + 8, -14)], [34, 164, 1, 0, 0, 0, 0, 34, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
});
