// Wire colour i carries input variable i (a, b, c, d); same order as js/worker/wiring.js.
const WIRE_COLOURS = ["red", "blue", "green", "yellow"];
// Darker shades for the module picture, readable on its light tiles.
const WIRE_STROKES = ["#d62728", "#1f77b4", "#2ca02c", "#d4a000"];

/**
 * What each tile shows with every input off. A lamp is on when it is negated (or the
 * constant "1"). A gate tile is on when its lamps satisfy it: an AND when all are on, an
 * XOR (also a one-lamp gate) when exactly one is, as Terraria's XOR gate and gates.js do;
 * a negated gate ("¬⊕(…)") shows the
 * same tile and flips its signal instead. An output is the XOR of the signals of the gates
 * its row reaches.
 * @param {{expression: string, lamps: {name: string}[]}[]} stacks per gate
 * @param {number[]} rows the inverse matrix, rows[p] bit k: gate k reaches output p
 */
export function tileStates(stacks, rows) {
  const lamps = stacks.map((s) => s.lamps.map((l) => l.name.startsWith("¬") || l.name === "1"));
  const gates = stacks.map((s, k) => {
    const on = lamps[k].filter(Boolean).length;
    return s.expression.includes("∧(") ? on === lamps[k].length : on === 1;
  });
  const signal = stacks.map((s, k) => gates[k] !== /^¬[⊕∧]\(/.test(s.expression));
  const outputs = rows.map((row) => signal.reduce((acc, on, k) => acc !== (((row >> k) & 1) === 1 && on), false));
  return { lamps, gates, outputs };
}

/**
 * Tile picture of a wired module (SVG), drawn with the tile set: input wires entering at
 * the top, lamp stacks (bottom lamp on the gate), the gate row, the decode wires and the
 * output row, each tile on or off as tileStates says.
 * @param {{wires: {gates: number[], outputs: number[], colour: number}[],
 *   gateOrder: number[], outputOrder: number[],
 *   stacks: {expression: string, lamps: {name: string, colours: number}[]}[],
 *   inputs: number[][][], routes: {rows: number, cells: number[][][]}}} wiring an "ok" wiring
 * @param {number[]} rows the inverse matrix, for the output states
 * @returns {string}
 */
function moduleSvg({ wires, gateOrder, outputOrder, stacks, inputs, routes }, rows) {
  const n = gateOrder.length;
  const size = 64; // the tile set's own size, so its pixels stay square
  const top = Math.max(...gateOrder.map((k) => stacks[k].lamps.length));
  const gateY = top + 1; // picture row of the gates; row 0 is the top edge
  const outY = gateY + routes.rows + 1;
  // colours[row][x]: bit c set when wire colour c is on that tile.
  const colours = Array.from({ length: outY + 1 }, () => new Array(n).fill(0));
  inputs.forEach((tiles, c) => tiles.forEach(([x, r]) => (colours[top - r][x] |= 1 << c)));
  wires.forEach((w, i) => {
    for (const k of w.gates) colours[gateY][gateOrder.indexOf(k)] |= 1 << w.colour;
    for (const p of w.outputs) colours[outY][outputOrder.indexOf(p)] |= 1 << w.colour;
    for (const [x, y] of routes.cells[i]) colours[gateY + y][x] |= 1 << w.colour;
  });

  const state = tileStates(stacks, rows);
  let tiles = "";
  let labels = ""; // drawn last, so wires don't cover them
  const tile = (x, y, image, on, label) => {
    // noinspection HtmlUnknownAttribute: an SVG <image>, which the HTML inspection doesn't know
    tiles += `<image href="assets/tileset/${image}_${on ? "on" : "off"}.png" x="${x * size}" y="${y * size}" width="${size}" height="${size}"/>`;
    labels += `<text x="${(x + 0.5) * size}" y="${(y + 0.5) * size + 5}">${label}</text>`;
  };
  gateOrder.forEach((k, x) => {
    stacks[k].lamps.forEach((l, r) => tile(x, top - r, "lamp", state.lamps[k][r], l.name));
    const type = stacks[k].expression.includes("∧(") ? "gate_and" : "gate_xor";
    tile(x, gateY, type, state.gates[k], `G${k + 1}`);
  });
  outputOrder.forEach((p, x) => tile(x, outY, "output", state.outputs[p], `O${p + 1}`));

  // Each colour runs on its own offset in a tile, as wire layers do; same-coloured
  // neighbours are always one wire (the solver guarantees it), so they're joined.
  let lines = "";
  const at = (v, c) => (v + 0.5) * size + (c - 1.5) * 8;
  colours.forEach((row, y) =>
    row.forEach((set, x) => {
      for (let c = 0; c < 4; c++) {
        if (((set >> c) & 1) === 0) continue;
        const stroke = `stroke="${WIRE_STROKES[c]}" stroke-width="4"`;
        lines += `<circle cx="${at(x, c)}" cy="${at(y, c)}" r="4" fill="${WIRE_STROKES[c]}"/>`;
        // Input wires leave through the top edge.
        const ends = [[x + 1, y], [x, y + 1], ...(y === 0 ? [[x, -1]] : [])];
        for (const [x2, y2] of ends)
          if (y2 < 0 || ((colours[y2]?.[x2] >> c) & 1) === 1)
            lines += `<line x1="${at(x, c)}" y1="${at(y, c)}" x2="${y2 < 0 ? at(x, c) : at(x2, c)}" y2="${y2 < 0 ? 0 : at(y2, c)}" ${stroke}/>`;
      }
    }),
  );
  return `<svg class="module" viewBox="0 0 ${n * size} ${(outY + 1) * size}" width="${n * size}" role="img" aria-label="Module tile layout">${tiles}${lines}${labels}</svg>`;
}

export default class UIStateHandler {
  static #error = document.getElementById("error");

  static #error_multi = document.getElementById("error_multi");
  static #result_multi = document.getElementById("result_multi");

  static #loader = document.getElementById("loader");
  static #loader_multi = document.getElementById("loader_multi");

  static #a_download = document.getElementById("download");
  static #download_multi = document.getElementById("download_multi");

  static #input_term = /** @type {HTMLInputElement} */ (document.getElementById("term"));

  static #multi_progress = document.getElementById("multi_progress");
  static #input_hardlimit = /** @type {HTMLInputElement} */ (document.getElementById("hardlimit"));
  static #multi_compute = document.getElementById("multi_compute");
  static #multi_abort = document.getElementById("multi_abort");
  static #result_multi_prev = /** @type {HTMLButtonElement} */ (document.getElementById("result_multi_prev"));
  static #result_multi_next = /** @type {HTMLButtonElement} */ (document.getElementById("result_multi_next"));
  static #result_multi_wire = document.getElementById("result_multi_wire");
  static #btn_single = /** @type {HTMLInputElement} */ (document.getElementById("btn_single"));

  static #tab_single = document.getElementById("tab_single");
  static #tab_multi = document.getElementById("tab_multi");

  static #multi_field_group = document.getElementById("multi_field_group");
  static #multi_new_field = /** @type {HTMLInputElement} */ (document.getElementById("multi_new_field"));

  static #single_form = document.getElementById("single_form");
  static #multi_form = document.getElementById("multi_form");

  static #result = document.getElementById("result");
  static #displayed_matrix = document.getElementById("displayed_matrix");

  static init({ onSingle, onMulti, onAbort, onNext, onPrev, onTryWiring }) {
    document
      .querySelectorAll("#tabbar input")
      .forEach((tab) =>
        tab.addEventListener("click", UIStateHandler.#switchTab)
      );

    document.addEventListener("DOMContentLoaded", function () {
      UIStateHandler.#switchTab();
      if (UIStateHandler.#multi_field_group.children.length === 0) {
        UIStateHandler.#multi_field_group.style.display = "none";
      }
    });

    this.#single_form.addEventListener("submit", function (event) {
      event.preventDefault();
      onSingle();
    });

    this.#multi_form.addEventListener("submit", function (event) {
      event.preventDefault();
      onMulti();
    });

    this.#multi_abort.addEventListener("click", function (event) {
      event.preventDefault();
      onAbort();
    });

    this.#result_multi_prev.addEventListener("click", onPrev);
    this.#result_multi_next.addEventListener("click", onNext);
    this.#result_multi_wire.addEventListener("click", onTryWiring);

    this.#multi_new_field.addEventListener("input", function () {
      const input = document.createElement("input");
      input.classList.add("multi_output");
      input.type = "text";
      input.value = this.value;
      UIStateHandler.#multi_field_group.style.display = "flex";
      UIStateHandler.#multi_field_group.appendChild(input);
      input.focus();
      UIStateHandler.#textLength(input);
      this.value = "";
    });

    this.#multi_new_field.addEventListener("paste", function (e) {
      e.preventDefault();

      let paste = e.clipboardData
        .getData("text")
        .split("\n");
      for (let p of paste) {
        const input = document.createElement("input");
        input.classList.add("multi_output");
        input.type = "text";
        input.value = p;
        UIStateHandler.#multi_field_group.style.display = "flex";
        UIStateHandler.#multi_field_group.appendChild(input);
        UIStateHandler.#textLength(input);
      }
    });

    this.#multi_field_group.addEventListener("change", function (e) {
      const input = /** @type {HTMLInputElement} */ (e.target);
      if (input.value === "") {
        input.remove();
      }
      if (UIStateHandler.#multi_field_group.children.length === 0) {
        // this.#multi_new_field.focus();
        UIStateHandler.#multi_field_group.style.display = "none";
      }
    });

    this.#multi_field_group.addEventListener("input", function (e) {
      UIStateHandler.#textLength(e.target);
    });
    this.#input_term.addEventListener("input", function (e) {
      UIStateHandler.#textLength(e.target);
    });
  }

  static showError(message) {
    this.#error.style.display = "block";
    this.#error.innerHTML = message;
  }
  static showMultiError(message) {
    this.#error_multi.style.display = "block";
    this.#error_multi.innerHTML = message;
  }
  static clearError() {
    this.#error.style.display = "none";
  }
  static clearMultiError() {
    this.#error_multi.style.display = "none";
  }

  static getSingleTermValue() {
    return this.#input_term.value;
  }

  /** @returns {string[]} the value of each output field */
  static getMultiTermsValues() {
    const fields = /** @type {NodeListOf<HTMLInputElement>} */ (
      document.querySelectorAll("#multi_field_group .multi_output")
    );
    return Array.from(fields, (a) => a.value);
  }

  static getMultiLimit() {
    return Number(this.#input_hardlimit.value);
  }

  static onStartSingleEvent() {
    this.#result.innerHTML = "";
    this.#error.style.display = "none";
    this.#a_download.style.display = "none";
    this.#loader.style.display = "inline-block";
  }

  static onSingleResultEvent() {
    this.#loader.style.display = "none";
  }

  static onStartMultiEvent() {
    this.#displayed_matrix.innerHTML = "";
    this.#result_multi_wire.style.display = "none";
    this.#error_multi.style.display = "none";
    this.#download_multi.style.display = "none";
    this.#loader_multi.style.display = "inline-block";
    this.#multi_abort.style.display = "inline-block";
    this.#multi_compute.style.display = "flex";
    this.#multi_progress.innerText = "0/0";
  }

  /** Shows the loader and Abort while one matrix is being wired. */
  static onStartWiringEvent() {
    this.#result_multi_wire.style.display = "none";
    this.#loader_multi.style.display = "inline-block";
    this.#multi_abort.style.display = "inline-block";
    this.#multi_compute.style.display = "flex";
  }

  static onMultiResultEvent() {
    this.#loader_multi.style.display = "none";
    this.#multi_abort.style.display = "none";
  }

  static setMultiProgress(count) {
    this.#multi_progress.innerText = count;
  }

  static setDownload(encodedUri) {
    this.#a_download.setAttribute("href", encodedUri);
    this.#a_download.setAttribute("download", this.#input_term.value + ".csv");
    this.#a_download.style.display = "inline-block";
  }

  static setResultSingle(terms) {
    this.#result.innerHTML = terms.map((a) => a[0]).join("<br>");
  }

  static setResultDouble(terms1, terms2) {
    const firstColumn = terms1.map((a) => a[0]).join("<br>");
    const secondColumn = terms2.map((a) => a[0]).join("<br>");

    this.#result.innerHTML = `<div class="double">
                    <div>${firstColumn}</div>
                    <div>${secondColumn}</div>
                </div>`;
  }

  static setResultUnexpectedError() {
    this.#result.innerHTML = `Something went wrong. Please report this as a bug.`;
  }

  static setNextPrevState(index, matrices){
    if(matrices == null){
      this.#result_multi.style.display = "none";
    }else{
      this.#result_multi.style.display = "block";
      this.#result_multi_next.disabled = index === matrices.length-1;
      this.#result_multi_prev.disabled = index === 0;
    }
  }

  /**
   * Shows a matrix: row O<p> is output p, column G<k> is gate k, and the last column is
   * the truth table of gate <row>. Below it, the decode wires if they were found.
   * @param {{complexity: number, rows: number[], transitioned: number[], mask: number,
   *   varCount?: number, wiring?: {status: string,
   *     wires?: {gates: number[], outputs: number[], colour: number}[],
   *     gateOrder?: number[], outputOrder?: number[],
   *     stacks?: {expression: string, lamps: {name: string, colours: number}[]}[],
   *     inputs?: number[][][], routes?: {rows: number, cells: number[][][]}}}} matrix
   *   varCount and wiring are missing in matrices saved by older versions, and stacks,
   *   inputs and routes in wirings saved before lamps were laid out
   * @param {boolean} [allowRetry] false while the worker is busy, which hides "try wiring"
   */
  static displayMatrix({ complexity, rows, transitioned, mask, varCount, wiring }, allowRetry = true) {
    const n = transitioned.length;
    // Bits print most significant first, so the leftmost column is the last gate.
    let text = `<table><tr><th></th>`;
    for (let k = n; k >= 1; k--) text += `<th>G${k}</th>`;
    text += `<th></th></tr>`;
    for (let i in rows) {
      let num = transitioned[i].toString(2).padStart(16, "0");
      let txtMask = mask.toString(2).padStart(16, "0");
      num = num.split('').map((a, idx) => (txtMask[idx] === "1" ? "x" : a)).join('');
      text += `<tr><th>O${Number(i) + 1}</th><td>${(rows[i] + 2 ** n)
        .toString(2)
        .substring(1)
        .split("")
        .join("</td><td>")}</td>`;
      text += `<td>G${Number(i) + 1} = ${num}</td></tr>`;
    }
    text += `</table>`;

    // A wiring without lamp stacks is from before input wires were checked: wire it again.
    const status = wiring?.status === "ok" && !wiring.routes ? "unverified" : (wiring?.status ?? "unverified");
    let wires;
    if (status === "ok") {
      const swatch = (c) => `<span class="wire" style="background: ${WIRE_COLOURS[c]}"></span>${WIRE_COLOURS[c]}`;
      const list = (prefix, items) => items.map((i) => `${prefix}${i + 1}`).join(" ");
      wires = `<ul>${wiring.wires
        .map((w) => `<li>${swatch(w.colour)}: ${list("G", w.gates)} → ${list("O", w.outputs)}</li>`)
        .join("")}</ul>`;
      wires += `<p>Gates left to right: ${list("G", wiring.gateOrder)}<br>`;
      wires += `Outputs left to right: ${list("O", wiring.outputOrder)}</p>`;
      // An output on several wires mixes gate signals and needs a diode to merge them.
      const mixed = [...rows.keys()].filter((p) => wiring.wires.filter((w) => w.outputs.includes(p)).length > 1);
      wires += mixed.length === 0
        ? `<p>Every output is on one wire: no diodes needed.</p><ul>`
        : `<p>${list("O", mixed)} mix${mixed.length === 1 ? "es" : ""} gate signals: one diode each.</p><ul>`;
      for (let k = 0; k < n; k++) {
        const colours = wiring.wires.filter((w) => w.gates.includes(k)).map((w) => WIRE_COLOURS[w.colour]);
        const { expression, lamps } = wiring.stacks[k];
        wires += `<li>G${k + 1} = ${expression}: ${colours.join(", ")} on the gate, lamps bottom to top ${lamps.map((l) => l.name).join(" ")}</li>`;
      }
      wires += `</ul>${moduleSvg(wiring, rows)}`;
    } else if (status === "impossible") {
      wires = `<p>This matrix can't be wired.</p>`;
    } else if (varCount !== undefined) {
      wires = `<p>Wiring not verified: the search ran out of time.</p>`;
    } else {
      wires = `<p>Saved by an older version: search again to see its wiring.</p>`;
    }
    // Only matrices the search gave up on, with what's needed to retry them, can be wired again.
    const canRetry = allowRetry && status === "unverified" && varCount !== undefined;
    this.#result_multi_wire.style.display = canRetry ? "inline-block" : "none";

    this.#displayed_matrix.innerHTML = `<div class='grid'>${text}<span>${complexity}</span></div>${wires}`;
  }

  static #switchTab() {
    if (UIStateHandler.#btn_single.checked) {
      UIStateHandler.#tab_single.classList.add("active");
      UIStateHandler.#tab_multi.classList.remove("active");
    } else {
      UIStateHandler.#tab_single.classList.remove("active");
      UIStateHandler.#tab_multi.classList.add("active");
    }
  }

  static #textLength(e) {
    const length = e.value.length;
    if (length === 4 || length === 8 || length === 16) {
      e.style.color = "#00C8FF";
    } else {
      e.style.color = "black";
    }
  }
}
