import UI from "./state/handler.js";

let worker = new Worker("./js/worker/worker.js", { type: "module" });
let transmatrix = new Worker("./js/worker/transmatrix.js", { type: "module" });
UI.init({
  onSingle: single,
  onMulti: multi,
  onAbort: abort,
  onNext: next,
  onPrev: prev,
  onTryWiring: tryWiring,
  onDraw: draw,
});

// The shown single results: one list, or one per column of a double result.
let singleResults = [];
// Counts searches, so a drawing asked for by older results is dropped.
let search = 0;

export function single() {
  const term = UI.getSingleTermValue();

  try {
    const varCount = getValidTermSize(term);
    // Separate don't cares from the term, reformat as integers.
    const mask = parseMask(term);

    UI.onStartSingleEvent();
    search++;
    singleResults = [];

    worker.postMessage({
      action: "search",
      varCount: varCount,
      maxDepth: varCount + 1,
      term: parseTerm(term),
      mask: mask,
    });
  } catch (e) {
    UI.showError(e.message);
  }
}

export function multi() {
  const terms = UI.getMultiTermsValues();
  const hardLimit = UI.getMultiLimit();

  try {
    const varCount = getValidTermSize(terms[0]);
    const mask = parseMask(terms[0]);
    for (let i = 1; i < terms.length; i++) {
      if (varCount !== getValidTermSize(terms[i])) {
        // noinspection ExceptionCaughtLocallyJS
        throw new Error("All terms must have the same length");
      }
      if (mask !== parseMask(terms[i])) {
        // noinspection ExceptionCaughtLocallyJS
        throw new Error("All terms must have the same don't cares");
      }
    }
    UI.onStartMultiEvent();
    pending++;

    transmatrix.postMessage({
      action: "generate",
      varCount: varCount,
      terms: terms.map(parseTerm),
      mask: mask,
      hardLimit: hardLimit,
    });
  } catch (e) {
    UI.showMultiError(e.message);
  }
}

/**
 * Checks a truth table string and returns its number of variables.
 * @param {string} term e.g. "0110", lower case letters are don't cares
 * @returns {number} 2, 3 or 4
 */
function getValidTermSize(term) {
  if (!term.match(/^[01a-z]+$/)) {
    throw new Error("Use only 0, 1 and lower case letters");
  }

  switch (term.length) {
    case 4:
      return 2;
    case 8:
      return 3;
    case 16:
      return 4;
    default:
      throw new Error("Invalid value length");
  }
}

/**
 * Reads a truth table string as a number, with don't cares set to 1.
 * @param {string} term
 * @returns {number}
 */
function parseTerm(term) {
  return parseInt(term.replace(/[a-z]/g, "1"), 2);
}

/**
 * Returns a mask with a 1 for every don't care in the truth table string.
 * @param {string} term
 * @returns {number}
 */
function parseMask(term) {
  return parseInt(
    term.replace(/[1a-z]/g, (a) => (a === "1" ? "0" : "1")),
    2
  );
}

let testStartTime;
export function startTest(varCount, maxDepth) {
  testStartTime = Date.now();
  worker.postMessage({
    action: "test",
    varCount: varCount,
    maxDepth: maxDepth,
  });
}

// Single input worker. Generates terms.
worker.onmessage = (e) => {
  switch (e.data.action) {
    case "result":
      UI.onSingleResultEvent();

      if (e.data.results) {
        const csvContent =
          "data:text/csv;charset=utf-8,\uFEFF" +
          e.data.results.map((a) => `"${a[0]}"`).join("\n");
        UI.setDownload(encodeURI(csvContent));

        singleResults = [e.data.results];
        UI.setResultSingle(e.data.results);
      } else {
        UI.setResultUnexpectedError();
      }
      break;

    case "double":
      UI.onSingleResultEvent();

      if (e.data.results1 && e.data.results2) {
        // Make a csv file where the results are in two columns.
        const [array1, array2] = [
          e.data.results1.map((a) => a[0]),
          e.data.results2.map((a) => a[0]),
        ];
        const maxLength = Math.max(array1.length, array2.length);
        let transposedArray = [];
        for (let i = 0; i < maxLength; i++) {
          transposedArray[i] = [`"${array1[i] ?? ""}"`, `"${array2[i] ?? ""}"`];
        }
        const csvContent =
          "data:text/csv;charset=utf-8,\uFEFF" +
          transposedArray.map((a) => a.join(",")).join("\n");
        UI.setDownload(encodeURI(csvContent));

        // Display results.
        singleResults = [e.data.results1, e.data.results2];
        UI.setResultDouble(e.data.results1, e.data.results2);
      } else {
        UI.setResultUnexpectedError();
      }
      break;

    case "drawing":
      if (e.data.id === search) UI.showDrawing(e.data.picks, e.data.rows, e.data.wiring);
      break;

    case "test": {
      const timeTaken = Date.now() - testStartTime;
      console.log(Math.round(timeTaken / 1000) + " seconds");
      console.log(e.data.results.filter((a) => a != null));
      break;
    }
  }
};

/**
 * Asks for the module of the picked solutions: one, or one from each column.
 * @param {number[]} picks
 */
function draw(picks) {
  const expressions = picks.map((i, c) => singleResults[c][i]);
  worker.postMessage({ action: "draw", id: search, picks, expressions });
}

let index = 0;
// Keeps multi results in localStorage between visits. Off for now.
const KEEP_RESULTS = false;
let matrices = KEEP_RESULTS ? JSON.parse(localStorage.getItem("matrices")) : null;
// Older versions could store an empty list, which has nothing to display.
if (matrices?.length === 0) matrices = null;
// Jobs sent to the transmatrix worker and not answered yet. It answers them in order.
let pending = 0;
// The matrix a "try wiring" job is for. Its reply carries no identity of its own,
// and the list may have been replaced by then.
let wiringTarget = null;
// A retry is offered only while the worker is idle, so jobs never pile up behind one.
const show = () => UI.displayMatrix(matrices[index], pending === 0);
UI.setNextPrevState(index, matrices);
if (matrices != null) show();

/** Counts a job as answered; hides the loader once the worker is idle. */
function jobDone() {
  pending = Math.max(0, pending - 1);
  if (pending === 0) UI.onMultiResultEvent();
}

// Multi input worker. Generates transition matrices.
transmatrix.onmessage = (e) => transmatrix_onmessage(e);
function transmatrix_onmessage(e) {
  switch (e.data.action) {
    case "matrices":
      jobDone();

      if (e.data.results?.length > 0) {
        if (KEEP_RESULTS) localStorage.setItem("matrices", JSON.stringify(e.data.results));
        matrices = e.data.results;
        index = 0;
        UI.setNextPrevState(index, matrices);
        show();
      } else {
        if (KEEP_RESULTS) localStorage.removeItem("matrices");
        matrices = null;
        index = 0;
        UI.setNextPrevState(index, matrices);
        UI.showMultiError("No solution found for these outputs");
      }
      break;
    case "count":
      UI.setMultiProgress(e.data.count);
      break;
    case "wiring": {
      jobDone();
      const target = matrices?.indexOf(wiringTarget) ?? -1;
      wiringTarget = null;
      if (target < 0) break; // the results it was for are gone
      matrices[target].wiring = e.data.wiring;
      if (e.data.complexity !== undefined) matrices[target].complexity = e.data.complexity;
      if (KEEP_RESULTS) localStorage.setItem("matrices", JSON.stringify(matrices));
      // While a new search runs, its area stays cleared.
      if (target === index && pending === 0) show();
      break;
    }
  }
}

function next() {
  if (matrices != null && index < matrices.length - 1)
    index++;
  UI.setNextPrevState(index, matrices);
  show();
}

function prev() {
  if (index > 0) index--;
  UI.setNextPrevState(index, matrices);
  show();
}

// Retries the wiring of the shown matrix with no time limit; Abort stops it.
function tryWiring() {
  UI.onStartWiringEvent();
  pending++;
  wiringTarget = matrices[index];
  transmatrix.postMessage({ action: "wire", index: index, matrix: matrices[index] });
}

export function abort() {
  transmatrix.terminate();
  transmatrix = new Worker("./js/worker/transmatrix.js", { type: "module" });
  transmatrix.onmessage = (e) => transmatrix_onmessage(e);
  pending = 0;
  wiringTarget = null;
  UI.onMultiResultEvent();
  // Brings back the "try wiring" button if a retry was aborted.
  if (matrices != null) show();
}
