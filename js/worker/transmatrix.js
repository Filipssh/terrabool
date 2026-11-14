/*
|                                    ~ ~ TIME AND MEMORY ESTIMATES ~ ~                                      |
| outputs |            combinations            memory  | transition matrices    memory  |  time to compute  |
|    4    | C(15,4)  =               1 365    ≈ 5KB    |            840        ≈ 3KB    |    2ms            |
|    5    | C(31,5)  =             169 911    ≈ 663KB  |         83 328        ≈ 326KB  |    250ms          |
|    6    | C(63,6)  =          67 945 521    ≈ 259MB  |     27 998 208        ≈ 106MB  |    3 min          |
|    7    | C(127,7) =      94 525 795 200    ≈ 440GB  |                       ~ 180GB  |    est 3 days     |
|    8    | C(255,8) = 409 663 695 276 000    ≈ 2608TB |                       ~ 1043TB |    est 36 years   |

SOLUTION: prune linear combination set (what the getGoodTerms function does) at the possible cost of missing some matrices 
*/

import { Dictionary } from "../data/dictionary.js";
import { gateLamps, route, wire } from "./wiring.js";

// Search nodes the wiring solver may use per matrix before the matrix is listed as
// unverified. Tuned on the 7-segment benchmark (implementation-plan.md Appendix B):
// 6 outputs < 1 s, 7 outputs ~13 s. 200 000 halved the unverified ones at 7 outputs but
// took ~40 s; they can still be retried one by one with the "wire" action.
const WIRING_BUDGET = 50000;

/**
 * tests if a number is a power of two
 * @param {number} x
 * @returns {boolean}
 */
function isPowerOfTwo(x) {
  return Math.log2(x) % 1 === 0;
}

/**
 * Tests if the matrix is invertible by checking the rows are linearly independent in GF(2).
 * @param {number[]} rows
 * @param {number} pad
 * @returns {boolean}
 */
function isInvertible(rows, pad = 2 ** rows.length) {
  for (let i = 3; i < pad; i++) {
    if (isPowerOfTwo(i)) continue; // skip a trivial combination
    let term = 0;
    let bitmask = 1;
    for (let j = 0; j < rows.length; j++) {
      if ((i & bitmask) !== 0) term ^= rows[j];
      bitmask <<= 1;
    }
    if (rows.includes(term)) return false;
  }
  return true;
}

/**
 * Performs a GF(2) transition on a set of terms using a transition matrix.
 * @param {number[]} rows The rows of the transition matrix
 * @param {number[]} terms The terms to be transitioned
 * @returns {number[]} Transitioned terms
 */
function transition(rows, terms) {
  let newTerms = Array(terms.length).fill(0);

  for (let i = 0; i < terms.length; i++) {
    let bitmask = 1;
    for (let j = 0; j < terms.length; j++) {
      if ((rows[i] & bitmask) !== 0) {
        newTerms[i] ^= terms[j];
      }
      bitmask <<= 1;
    }
  }
  return newTerms;
}

/**
 * @typedef {Map<number,number>} TermMap
 * @description Transitioned term as key, lamp count as value, ordered by lamp count
 */
/**
 * @typedef {number[]} viableCombinations
 * @description Array of solvable linear combinations, preserving order of TermMap
 */
/**
 * Generates all viable linear combinations (encodings) of input terms
 * @param {Object} options
 * @param {number} options.varCount number of variables (2 to 4)
 * @param {number[]} options.terms
 * @param {number} [options.mask]
 * @returns {{linearCombinations: viableCombinations, goodTermsMap: TermMap}} Viable linear combinations array, and pruned map of terms.
 */
function getGoodTerms({ varCount, terms, mask = 0 }) {
  const masked_dictionary = Dictionary[varCount - 2].map((a) => [
    a[0] | mask,
    a[1],
  ]);
  let precursorTerms = [];

  // Test all linear combinations.
  for (let combination = 1; combination < 2 ** terms.length; combination++) {
    let bitmask = 0b1;
    let precursor = 0b0;

    for (let term of terms) {
      // Apply the term if the bit in its row is high.
      if ((combination & bitmask) !== 0) {
        precursor ^= term;
      }
      bitmask <<= 1;
    }

    // Get the minimum lamp count of a gate that defines this term.
    const minimum = Math.min(
      ...masked_dictionary
        .filter((a) => a[0] === (precursor | mask))
        .map((a) => a[1])
    );

    // If the transitioned term is in the dictionary, add it to the viable combinations.
    if (minimum !== Infinity) {
      precursorTerms.push({
        precursor: precursor,
        linearCombination: combination,
        lampCount: minimum,
      });
    }
  }
  precursorTerms.sort((a, b) => a.lampCount - b.lampCount);
  return {
    linearCombinations: precursorTerms.map((a) => a.linearCombination),
    goodTermsMap: new Map(
      precursorTerms.map((a) => [a.precursor, a.lampCount])
    ),
  };
}

/**
 * A transition matrix found for a set of terms.
 * @typedef {Object} Matrix
 * @property {number} complexity total lamp count of the transitioned terms
 * @property {number[]} rows rows of the inverse transition matrix
 * @property {number[]} transitioned the transitioned terms
 * @property {number} mask a mask taking care of don't cares
 * @property {number} varCount number of variables, needed to wire the matrix again later
 * @property {Object} wiring the decode wires, see wireMatrix
 */

/**
 * Finds the decode wires for a matrix (see wiring.js), the lamp stacks and input wires
 * above the gates, and a tile layout of the decode wires for drawing.
 * @param {number[]} rows rows of the inverse transition matrix
 * @param {number[]} transitioned the gates' truth tables
 * @param {number} mask don't cares
 * @param {number} varCount number of variables (2 to 4)
 * @param {number} budget search nodes before giving up as "unverified"
 */
export function wireMatrix(rows, transitioned, mask, varCount, budget) {
  const lamps = transitioned.map((term) => gateLamps({ term, mask, varCount }));
  const options = {
    rows,
    okSets: lamps.map((l) => l.okSets),
    expressions: lamps.map((l) => l.expressions),
    padded: lamps.map((l) => l.padded),
    budget,
  };
  // Most wanted first: every output on one wire (no diode merging gate signals), then one
  // colour per wire (up to 4 outputs only). For those, gates may take a pad lamp (one more
  // lamp) to free their tile's colours. The last try, plain, decides between "impossible"
  // and "unverified": it is the least strict. Each try gets the full budget.
  const n = rows.length;
  const tries = [
    { cleanOutputs: true, distinctOutputs: true, maxPads: n },
    { cleanOutputs: true, maxPads: n },
    { distinctOutputs: true, maxPads: n },
    {},
  ];
  let result;
  for (const t of tries.filter((t) => !t.distinctOutputs || rows.length <= 4))
    if ((result = wire({ ...options, ...t })).status === "ok") break;
  return result.status === "ok" ? { ...result, routes: route(result) } : result;
}

/**
 * Lamps a wiring builds, pad lamps included; undefined when it has no stacks (not wired).
 * @param {{stacks?: {lamps: unknown[]}[]}} wiring
 */
function lampsOf(wiring) {
  return wiring.stacks?.reduce((sum, s) => sum + s.lamps.length, 0);
}

/**
 * How good a wiring is: 2 when every output is on one wire (no diode merging gate
 * signals), plus 1 when no two wires share a colour.
 * @param {{wires: {outputs: number[], colour: number}[]}} wiring an "ok" wiring
 * @param {number} outputs number of outputs
 */
export function grade({ wires }, outputs) {
  const clean = wires.flatMap((w) => w.outputs).length === outputs;
  const distinct = new Set(wires.map((w) => w.colour)).size === wires.length;
  return 2 * Number(clean) + Number(distinct);
}

/**
 * Generates all transition matrices for a given set of terms
 * @param {Object} options
 * @param {number} options.varCount number of variables (2 to 4)
 * @param {number[]} options.terms
 * @param {number} [options.mask]
 * @param {number} [options.hardLimit] stop after this many wired matrices
 * @param {number} [options.wiringBudget] wiring search nodes per matrix
 * @returns {Matrix[]} Transition matrices: wired ones best grade first, then unverified ones,
 *   each by complexity (lamps built, pads included)
 */
function combinations({ varCount, terms, mask = 0, hardLimit = 20, wiringBudget = WIRING_BUDGET }) {
  const { linearCombinations, goodTermsMap } = getGoodTerms({
    varCount: varCount,
    terms: terms,
    mask: mask,
  });
  let combination = new Array(terms.length).fill(0);
  // Count combinations, not distinct terms: when outputs repeat or depend on each
  // other, several combinations give the same term and the map holds fewer entries.
  const dim = linearCombinations.length;
  let idx = 0;
  let BigRes = [];
  let unverified = [];
  let invertible = 0;
  let tested = 0;
  const byComplexity = (a, b) => a.complexity - b.complexity;
  // Wired matrices first: every output on one wire (no diodes) above one colour per wire,
  // above lamp count. Then the ones the wiring search gave up on.
  const byGrade = (a, b) => grade(b.wiring, b.rows.length) - grade(a.wiring, a.rows.length) || byComplexity(a, b);
  const results = () => [...BigRes.sort(byGrade), ...unverified.sort(byComplexity)];
  while (idx >= 0) {
    if (combination[idx] >= dim) {
      idx--;
    } else if (idx === terms.length - 1) {
      const lin_combinations = combination.map((a) => linearCombinations[a]);

      // Check the matrix and add it to possible solutions list.
      if (isInvertible(lin_combinations)) {
        invertible++;
        const transitioned = transition(lin_combinations, terms);
        const lampSum = transitioned.reduce(
          (acc, term) => acc + goodTermsMap.get(term),
          0
        );
        const inverse = getInverseMatrix(lin_combinations);
        const wiring = wireMatrix(inverse, transitioned, mask, varCount, wiringBudget);
        const matrix = {
          complexity: lampsOf(wiring) ?? lampSum,
          rows: inverse,
          transitioned: transitioned,
          mask: mask,
          varCount: varCount,
          wiring: wiring,
        };
        // Matrices that can't be wired are dropped; only wired ones count toward the limit.
        // Unverified ones are capped too, or a long search could outgrow localStorage.
        if (wiring.status === "ok") BigRes.push(matrix);
        else if (wiring.status === "unverified" && unverified.length < hardLimit) unverified.push(matrix);
      }
      tested++;
      postMessage({
        action: "count",
        count: `${BigRes.length}/${invertible}/${tested}`,
      });
      if (BigRes.length >= hardLimit) return results();
    } else {
      idx++;
      combination[idx] = combination[idx - 1];
    }
    combination[idx]++;
  }
  return results();
}

/**
 * Finds the inverse matrix of a transition matrix.
 * @param {number[]} lin_combinations Set of linear combinations
 * @returns {number[]} Inverse transition matrix
 */
function getInverseMatrix(lin_combinations) {
  let found = 0;
  let inverse = new Array(lin_combinations.length).fill(0);
  // Try all transformations per row.
  for (let i = 1; i < 2 ** lin_combinations.length; i++) {
    let term = 0;
    let bitmask = 1;

    // Apply transition.
    for (const combination of lin_combinations) {
      if ((i & bitmask) !== 0) term ^= combination;
      bitmask <<= 1;
    }

    // If after transition the row has a single high bit, then that transition is part of the inverse matrix.
    if (isPowerOfTwo(term)) {
      inverse[Math.log2(term)] = i;
      found++;
      if (found === lin_combinations.length) break;
    }
  }
  return inverse;
}

onmessage = (e) => {
  switch (e.data.action) {
    case "generate": {
      // combinations() already returns the matrices sorted by complexity.
      const matrices = combinations({
        varCount: e.data.varCount,
        terms: e.data.terms,
        mask: e.data.mask,
        hardLimit: e.data.hardLimit,
        // Only tests send this; the page uses the default.
        wiringBudget: e.data.wiringBudget,
      });
      postMessage({
        action: "matrices",
        results: matrices,
      });
      break;
    }
    case "wire": {
      // Retry one matrix the automatic search gave up on, with no budget.
      const { rows, transitioned, mask, varCount } = e.data.matrix;
      const wiring = wireMatrix(rows, transitioned, mask, varCount, Infinity);
      // Pad lamps can make it cost more than the cheapest gates did.
      postMessage({ action: "wiring", index: e.data.index, wiring, complexity: lampsOf(wiring) });
      break;
    }
    default:
      break;
  }
};
