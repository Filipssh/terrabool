import UI from "./state/handler.js";

let worker = new Worker("./js/worker/worker.js", { type: "module" });
let transmatrix = new Worker("./js/worker/transmatrix.js", { type: "module" });
UI.init({
  onSingle: single,
  onMulti: multi,
  onAbort: abort,
  onNext: next,
  onPrev: prev,
});

export function single() {
  const term = UI.getSingleTermValue();

  try {
    const varCount = getValidTermSize(term);
    // Separate don't cares from the term, reformat as integers.
    const mask = parseMask(term);

    UI.onStartSingleEvent();

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
        UI.setResultDouble(e.data.results1, e.data.results2);
      } else {
        UI.setResultUnexpectedError();
      }
      break;

    case "test": {
      const timeTaken = Date.now() - testStartTime;
      console.log(Math.round(timeTaken / 1000) + " seconds");
      console.log(e.data.results.filter((a) => a != null));
      break;
    }
  }
};

let index = 0;
let matrices = JSON.parse(localStorage.getItem("matrices"));
// Older versions could store an empty list, which has nothing to display.
if (matrices?.length === 0) matrices = null;
UI.setNextPrevState(index, matrices);
if (matrices != null) UI.displayMatrix(matrices[index]);

// Multi input worker. Generates transition matrices.
transmatrix.onmessage = (e) => transmatrix_onmessage(e);
function transmatrix_onmessage(e) {
  switch (e.data.action) {
    case "matrices":
      UI.onMultiResultEvent();

      if (e.data.results?.length > 0) {
        localStorage.setItem("matrices", JSON.stringify(e.data.results));
        matrices = e.data.results;
        index = 0;
        UI.setNextPrevState(index, matrices);
        UI.displayMatrix(matrices[index]);
      } else {
        localStorage.removeItem("matrices");
        matrices = null;
        index = 0;
        UI.setNextPrevState(index, matrices);
        UI.showMultiError("No solution found for these outputs");
      }
      break;
    case "count":
      UI.setMultiProgress(e.data.count);
      break;
  }
}

function next() {
  if (matrices != null && index < matrices.length - 1)
    index++;
  UI.setNextPrevState(index, matrices);
  UI.displayMatrix(matrices[index]);
}

function prev() {
  if (index > 0) index--;
  UI.setNextPrevState(index, matrices);
  UI.displayMatrix(matrices[index]);
}

// TODO: wire colouring for displayed matrices. 4x4 or smaller is trivial.
// The bigger the matrix, the harder to wire outputs.
// Looking at the transform matrix, the same color can be assigned
// once in a column(kind of like sudoku).
// Also, the same color can't be on adjacent columns or rows.
// Exceptions to the rule are when a group of gates contribute to many outputs.
//
// heuristic idea: AND all row pairs to get common bits, count duplicate rows,
// prioritize groups with most common bits, most duplicates

export function abort() {
  transmatrix.terminate();
  transmatrix = new Worker("./js/worker/transmatrix.js", { type: "module" });
  transmatrix.onmessage = (e) => transmatrix_onmessage(e);
  UI.onMultiResultEvent();
}
