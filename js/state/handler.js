import { teditSchematic } from "./tedit.js";

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
 * output row, each tile on or off as tileStates says; then a link to the same tiles as a
 * TEdit schematic.
 * @param {{wires: {gates: number[], outputs: number[], colour: number}[],
 *   gateOrder: number[], outputOrder: number[],
 *   stacks: {expression: string, lamps: {name: string, colours: number}[]}[],
 *   inputs: number[][][], routes: {rows: number, cells: number[][][]}}} wiring an "ok" wiring
 * @param {number[]} rows the inverse matrix, for the output states
 * @param {string} name the schematic's file name, without extension
 * @returns {string}
 */
function moduleSvg({ wires, gateOrder, outputOrder, stacks, inputs, routes }, rows, name) {
  name = name.replace(/[^\w-]/g, "");
  name = name ? `TBool_${name}` : "terrabool"; // file and schematic name
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
  // cells[row][x]: the block on that tile, for the TEdit export; null where only wires run.
  const cells = colours.map((row) => row.map(() => null));
  const tile = (x, y, image, on, label) => {
    cells[y][x] = { image, on };
    // noinspection HtmlUnknownAttribute: an SVG <image>, which the HTML inspection doesn't know
    tiles += `<image href="assets/tileset/${image}_${on ? "on" : "off"}.png" x="${x * size}" y="${y * size}" width="${size}" height="${size}"/>`;
    labels += `<text x="${(x + 0.5) * size}" y="${(y + 0.5) * size + 5}">${label}</text>`;
  };
  gateOrder.forEach((k, x) => {
    if (stacks[k].lamps.length === 0) return; // a SPACER column (wiring.js): wires only
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
  const schematic = btoa(String.fromCharCode(...teditSchematic(name, colours, cells)));
  return `<svg class="module" viewBox="0 0 ${n * size} ${(outY + 1) * size}" width="${n * size}" role="img" aria-label="Module tile layout">${tiles}${lines}${labels}</svg>` +
    `<a class="export" download="${name}.TEditSch" href="data:application/octet-stream;base64,${schematic}">Export as TEdit schematic</a>`;
}


/**
 * Lamp count and module picture of a wiring, or why there is none.
 * @param {{status: string}} wiring
 * @param {number[]} rows the inverse matrix, for the output states
 */
function drawing(wiring, rows, name) {
  if (wiring.status !== "ok") return `<p>This one can't be laid out as a module.</p>`;
  const lamps = /** @type {any} */ (wiring).stacks.reduce((sum, s) => sum + s.lamps.length, 0);
  return `<p class="cost"><span>${lamps}</span> lamps</p>${moduleSvg(/** @type {any} */ (wiring), rows, name)}`;
}

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export default class UIStateHandler {
  static #error = document.getElementById("error");

  static #error_multi = document.getElementById("error_multi");
  static #result_multi = document.getElementById("result_multi");

  static #loader = document.getElementById("loader");
  static #loader_multi = document.getElementById("loader_multi");

  static #a_download = document.getElementById("download");

  static #input_term = /** @type {HTMLInputElement} */ (document.getElementById("term"));

  static #multi_progress = document.getElementById("multi_progress");
  static #input_hardlimit = /** @type {HTMLInputElement} */ (document.getElementById("hardlimit"));
  static #multi_compute = document.getElementById("multi_compute");
  static #multi_abort = document.getElementById("multi_abort");
  static #result_multi_prev = /** @type {HTMLButtonElement} */ (document.getElementById("result_multi_prev"));
  static #result_multi_next = /** @type {HTMLButtonElement} */ (document.getElementById("result_multi_next"));
  static #result_multi_pos = document.getElementById("result_multi_pos");
  static #result_multi_wire = document.getElementById("result_multi_wire");

  static #multi_field_group = document.getElementById("multi_field_group");
  static #multi_new_field = /** @type {HTMLInputElement} */ (document.getElementById("multi_new_field"));

  static #single_form = document.getElementById("single_form");
  static #multi_form = document.getElementById("multi_form");

  static #result = document.getElementById("result");
  static #displayed_matrix = document.getElementById("displayed_matrix");

  /** @type {(picks: number[]) => void} */
  static #onDraw;
  /** The pick of each column of a double result. */
  static #pair = [0, 0];
  /** The term of the shown single results, for their export names: the field may change since. */
  static #singleTerm = "";

  static init({ onSingle, onMulti, onAbort, onNext, onPrev, onTryWiring, onDraw }) {
    this.#onDraw = onDraw;

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

    // A single solution is drawn the first time it is opened. "toggle" doesn't bubble.
    this.#result.addEventListener(
      "toggle",
      function (e) {
        const details = /** @type {HTMLDetailsElement} */ (e.target);
        if (details.open && details.id.startsWith("sol_")) UIStateHandler.#draw([Number(details.id.slice(4))]);
      },
      true,
    );
    // Picking from either column of a double result redraws the pair.
    this.#result.addEventListener("change", function (e) {
      const radio = /** @type {HTMLInputElement} */ (e.target);
      UIStateHandler.#pair[radio.name === "col1" ? 1 : 0] = Number(radio.value);
      UIStateHandler.#draw(UIStateHandler.#pair);
    });

    this.#multi_new_field.addEventListener("input", function () {
      UIStateHandler.#addField(this.value).focus();
      this.value = "";
    });

    this.#multi_new_field.addEventListener("paste", function (e) {
      e.preventDefault();
      for (const p of e.clipboardData.getData("text").split(/\r?\n/)) {
        if (p.trim() !== "") UIStateHandler.#addField(p.trim());
      }
    });

    this.#multi_field_group.addEventListener("change", function (e) {
      const input = /** @type {HTMLInputElement} */ (e.target);
      if (input.value === "") input.remove();
    });

    this.#multi_field_group.addEventListener("input", function (e) {
      UIStateHandler.#textLength(e.target);
    });
    this.#input_term.addEventListener("input", function (e) {
      UIStateHandler.#textLength(e.target);
    });
  }

  static #addField(value) {
    const input = document.createElement("input");
    input.classList.add("multi_output");
    input.type = "text";
    input.value = value;
    input.ariaLabel = "Output truth table";
    input.autocomplete = "off";
    input.spellcheck = false;
    this.#multi_field_group.appendChild(input);
    this.#textLength(input);
    return input;
  }

  /** Asks for the module of these picks, unless it is already drawn or on its way. */
  static #draw(picks) {
    const target = document.getElementById(picks.length === 1 ? `draw_${picks[0]}` : "draw_pair");
    if (picks.length === 1 && target.innerHTML !== "") return;
    target.innerHTML = `<div class="loader"></div>`;
    this.#onDraw(picks.slice());
  }

  /**
   * Shows the module of a single or double pick, if those picks are still the shown ones.
   * @param {number[]} picks
   * @param {number[]} rows
   * @param {{status: string}} wiring
   */
  static showDrawing(picks, rows, wiring) {
    if (picks.length === 1) {
      document.getElementById(`draw_${picks[0]}`).innerHTML = drawing(wiring, rows, this.#singleTerm);
    } else if (String(picks) === String(this.#pair)) {
      document.getElementById("draw_pair").innerHTML = drawing(wiring, rows, this.#singleTerm);
    }
  }

  static showError(message) {
    this.#error.style.display = "block";
    this.#error.innerHTML = message;
  }
  static showMultiError(message) {
    this.#error_multi.style.display = "block";
    this.#error_multi.innerHTML = message;
  }

  static getSingleTermValue() {
    return this.#input_term.value.trim();
  }

  /** @returns {string[]} the value of each output field */
  static getMultiTermsValues() {
    const fields = /** @type {NodeListOf<HTMLInputElement>} */ (
      document.querySelectorAll("#multi_field_group .multi_output")
    );
    return Array.from(fields, (a) => a.value.trim());
  }

  static getMultiLimit() {
    return Number(this.#input_hardlimit.value);
  }

  static onStartSingleEvent() {
    this.#singleTerm = this.getSingleTermValue();
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
    this.#a_download.setAttribute("download", this.#input_term.value.trim() + ".csv");
    this.#a_download.style.display = "inline-block";
  }

  /** Lists the solutions; each draws its module when opened, the first one right away. */
  static setResultSingle(terms) {
    this.#result.innerHTML = `<ol class="solutions">${terms
      .map((a, i) => `<li><details id="sol_${i}"><summary><code>${escape(a[0])}</code></summary><div class="drawing" id="draw_${i}"></div></details></li>`)
      .join("")}</ol>`;
    const first = /** @type {HTMLDetailsElement} */ (document.getElementById("sol_0"));
    first.open = true;
    this.#draw([0]);
  }

  /** Two columns to pick one gate from each; the pair's module is drawn beside them. */
  static setResultDouble(terms1, terms2) {
    const column = (terms, c) =>
      `<fieldset><legend>Gate ${c + 1}</legend>${terms
        .map((a, i) => `<label><input type="radio" name="col${c}" value="${i}"${i === 0 ? " checked" : ""}> <code>${escape(a[0])}</code></label>`)
        .join("")}</fieldset>`;
    this.#result.innerHTML = `<div class="double">
      <p>No single gate makes this function. Pick one gate from each column: their outputs share one wire.</p>
      ${column(terms1, 0)}${column(terms2, 1)}<div class="drawing" id="draw_pair"></div></div>`;
    this.#pair = [0, 0];
    this.#draw(this.#pair);
  }

  static setResultUnexpectedError() {
    this.#result.innerHTML = `Something went wrong. Please report this as a bug.`;
  }

  static setNextPrevState(index, matrices){
    if(matrices == null){
      this.#result_multi.style.display = "none";
    }else{
      this.#result_multi.style.display = "grid";
      this.#result_multi_next.disabled = index === matrices.length-1;
      this.#result_multi_prev.disabled = index === 0;
      this.#result_multi_pos.innerText = `${index + 1} / ${matrices.length}`;
    }
  }

  /**
   * Shows a matrix's module first; the matrix (row O<p> is output p, column G<k> is gate k,
   * the last column the truth table of gate <row>) and the wire and lamp lists that led to
   * it are folded away as intermediate steps.
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
    let steps = `<table><tr><th></th>`;
    for (let k = n; k >= 1; k--) steps += `<th>G${k}</th>`;
    steps += `<th></th></tr>`;
    const txtMask = mask.toString(2).padStart(16, "0");
    const bits = (v) => v.toString(2).padStart(16, "0").split('').map((a, idx) => (txtMask[idx] === "1" ? "x" : a)).join('');
    for (let i in rows) {
      const num = bits(transitioned[i]);
      steps += `<tr><th>O${Number(i) + 1}</th><td>${(rows[i] + 2 ** n)
        .toString(2)
        .substring(1)
        .split("")
        .join("</td><td>")}</td>`;
      steps += `<td>G${Number(i) + 1} = ${num}</td></tr>`;
    }
    steps += `</table>`;

    // A wiring without lamp stacks is from before input wires were checked: wire it again.
    const status = wiring?.status === "ok" && !wiring.routes ? "unverified" : (wiring?.status ?? "unverified");
    let shown;
    if (status === "ok") {
      const swatch = (c) => `<span class="wire" style="background: ${WIRE_COLOURS[c]}"></span>${WIRE_COLOURS[c]}`;
      const list = (prefix, items) => items.map((i) => `${prefix}${i + 1}`).join(" ");
      steps += `<ul>${wiring.wires
        .map((w) => `<li>${swatch(w.colour)}: ${list("G", w.gates)} → ${list("O", w.outputs)}</li>`)
        .join("")}</ul>`;
      steps += `<p>Gates left to right: ${list("G", wiring.gateOrder)}<br>`;
      steps += `Outputs left to right: ${list("O", wiring.outputOrder)}</p><ul>`;
      for (let k = 0; k < n; k++) {
        const colours = wiring.wires.filter((w) => w.gates.includes(k)).map((w) => WIRE_COLOURS[w.colour]);
        const { expression, lamps } = wiring.stacks[k];
        steps += `<li>G${k + 1} = ${expression}: ${colours.join(", ")} on the gate, lamps bottom to top ${lamps.map((l) => l.name).join(" ")}</li>`;
      }
      steps += `</ul>`;
      // An output on several wires mixes gate signals and needs a diode to merge them.
      const mixed = [...rows.keys()].filter((p) => wiring.wires.filter((w) => w.outputs.includes(p)).length > 1);
      shown = mixed.length === 0
        ? `<p>Every output is on one wire: no diodes needed.</p>`
        : `<p>${list("O", mixed)} mix${mixed.length === 1 ? "es" : ""} gate signals: one diode each.</p>`;
      // File name: gates, lamps, and the start of each output's truth table (the XOR of the
      // gates its row reaches), so it doesn't depend on the input fields matching.
      const lamps = wiring.stacks.reduce((sum, s) => sum + s.lamps.length, 0);
      // A 2- or 3-variable table is only the last 4 or 8 of the 16 bits.
      const outputs = rows.map((row) => bits(transitioned.reduce((acc, t, k) => ((row >> k) & 1 ? acc ^ t : acc), 0)).slice(-(2 ** varCount)).slice(0, 6));
      shown += moduleSvg(wiring, rows, `${n}g_${lamps}l_${outputs.join("-")}`);
    } else if (status === "impossible") {
      shown = `<p>This matrix can't be wired.</p>`;
    } else if (varCount !== undefined) {
      shown = `<p>Wiring not verified: the search ran out of time.</p>`;
    } else {
      shown = `<p>Saved by an older version: search again to see its wiring.</p>`;
    }
    // Only matrices the search gave up on, with what's needed to retry them, can be wired again.
    const canRetry = allowRetry && status === "unverified" && varCount !== undefined;
    this.#result_multi_wire.style.display = canRetry ? "inline-block" : "none";

    this.#displayed_matrix.innerHTML = `<p class="cost"><span>${complexity}</span> lamps</p>${shown}` +
      `<details class="steps"><summary>Intermediate steps</summary>${steps}</details>`;
  }

  static #textLength(e) {
    const length = e.value.trim().length;
    if (length === 4 || length === 8 || length === 16) {
      e.style.color = "#00C8FF";
    } else {
      e.style.color = "black";
    }
  }
}
