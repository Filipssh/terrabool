import { Terms } from "../data/terms.js";
import { Gates, negate } from "../data/gates.js";
import { Dictionary } from "../data/dictionary.js";
import { Queue } from "../model/Queue.js";

/**
 * One term of an expression being built. Terms are chained through `prev`,
 * so the last term of an expression links back to the first.
 * The caches hold each gate's result for the chain up to this node (see gates.js).
 * @typedef {Object} TermNode
 * @property {number} idx index of the term in Terms[varCount]
 * @property {TermNode|null} prev the previous term, or null for the first
 * @property {TermNode|null} next used by Queue
 * @property {number} XOR_CACHE_O bits set in more than one term so far
 * @property {number} XOR_CACHE_E bits set in any term so far
 * @property {number} AND_CACHE AND of all terms so far
 */

// Search callbacks (testfunc, identity) are called with
// (terms, val, count, solutions, term, neg_term, mask, varCount).

/**
 * Creates the lookup table from dictionary.js.
 * Stores [boolean function, min depth to solve] in `solutions`, indexed by the function.
 * @param {Array<[string, number, number]>} terms each term as [printable term, truth table, wire/lamp bitmap]
 * @param {TermNode} val the last term of the current expression
 * @param {number} count the number of terms in the expression
 * @param {Array<[number, number]>} solutions
 * @param {number} _term unused
 * @param {number} _neg_term unused
 * @param {number} _mask unused
 * @param {number} varCount number of variables (2 to 4)
 */
const testfunc = (terms, val, count, solutions, _term, _neg_term, _mask, varCount) => {
  for (let gate of Gates) {
    let term = gate.combine(terms, val);
    solutions[term] = solutions[term]
      ? [term, Math.min(solutions[term][1], count)]
      : [term, count];
    term = negate(term, varCount);
    solutions[term] = solutions[term]
      ? [term, Math.min(solutions[term][1], count)]
      : [term, count];
  }
};

/**
 * Default validation function. Pushes valid text based expressions to the solutions array
 * as [printable expression, wire/lamp bitmap or array of them].
 * @param {Array<[string, number, number]>} terms each term as [printable term, truth table, wire/lamp bitmap]
 * @param {TermNode} val the last term of the current expression
 * @param {number} count the number of terms in the expression
 * @param {Array<[string, number|number[]]>} solutions
 * @param {number} term the term to be expressed
 * @param {number} neg_term the negated term, with don't cares set
 * @param {number} mask a mask taking care of don't cares
 * @param {number} _varCount unused
 */
const identity = (terms, val, count, solutions, term, neg_term, mask, _varCount) => {
  let vterm = terms[val.idx];
  if (count === 1) {
    // Fill the gate caches, which longer expressions build on.
    for (let gate of Gates) {
      gate.combine(terms, val);
    }
    if ((vterm[1] | mask) === term) {
      solutions.push([vterm[0], vterm[2]]);
    }
  } else {
    for (let gate of Gates) {
      const t = gate.combine(terms, val);
      const t_m = t | mask;
      if (t_m === term || t_m === neg_term) {
        let symbol_string = vterm[0];
        let current = val.prev;
        let wire_lamps = new Array(count);
        let index = count;
        wire_lamps[--index] = vterm[2];

        do {
          let cterm = terms[current.idx];
          symbol_string = cterm[0] + ", " + symbol_string;
          wire_lamps[--index] = cterm[2];
          current = current.prev;
        } while(current != null);

        // valid expression found. add it to solutions
        solutions.push([
          t_m === term ? `${gate.symbol}(${symbol_string})` : `¬${gate.symbol}(${symbol_string})`,
          wire_lamps,
        ]);
      }
    }
  }
};

/**
 * Generates all possible expressions for a given term, combinations generated in breadth-first-like order.
 * @param {Object} options
 * @param {number} options.varCount number of variables (2 to 4)
 * @param {number} options.maxDepth maximum depth of the expression. i.e. the maximum number of terms
 * @param {number} options.term the term to be expressed
 * @param {number} options.mask a mask taking care of don't cares
 * @param {function(Array, TermNode, number, Array, number, number, number, number): void} [options.callback] validates the expression and adds it to the solutions array
 * @returns {any[]|undefined} Formatted results, or undefined if nothing was found
 */
function makeExpressionsBFS({
  varCount,
  maxDepth,
  term,
  mask,
  callback = identity,
}) {
  const neg_term = negate(term ^ mask, varCount) | mask;
  const legalTerms = Terms[varCount];

  // Initialize the queue with the individual terms.
  let queue = new Queue();
  let next_queue = new Queue();

  for(let i = 0; i < legalTerms.length; i++) {
    next_queue.enqueue({
      XOR_CACHE_O: 0,
      XOR_CACHE_E: 0,
      AND_CACHE: 0,
      prev: null,
      next: null,
      idx: i,
    });
  }

  let solutions = [];
  let count = 0;

  // One pass per expression length, so every node's prev has its caches filled first.
  while(!next_queue.empty()) {
    let temp = next_queue;
    next_queue = queue;
    queue = temp;

    count++;

    while (!queue.empty()) {
      let val = queue.dequeue();
      callback(legalTerms, val, count, solutions, term, neg_term, mask, varCount);
      if (count < maxDepth) {
        for (let i = val.idx + 1; i < legalTerms.length; i++) {
          next_queue.enqueue({
            XOR_CACHE_O: 0,
            XOR_CACHE_E: 0,
            AND_CACHE: 0,
            prev: val,
            next: null,
            idx: i,
          });
        }
      }
    }
  }

  return solutions.length > 0 ? solutions : undefined;
}

onmessage = (e) => {
  switch (e.data.action) {
    case "search": {
      const maskedDictionary = Dictionary[e.data.varCount - 2].map((a) => [
        a[0] | e.data.mask,
        a[1],
      ]);

      if (maskedDictionary.find((a) => a[0] === e.data.term)) {
        const results = makeExpressionsBFS({
          varCount: e.data.varCount,
          maxDepth: e.data.maxDepth,
          term: e.data.term,
          mask: e.data.mask,
        });
        postMessage({ action: "result", results: results });
      } else {
        // Lowest complexity of each masked term, for quick pair lookups.
        let maskedDictionaryMap = new Map();
        for (const [term, complexity] of maskedDictionary) {
          const best = maskedDictionaryMap.get(term);
          if (best === undefined || complexity < best) {
            maskedDictionaryMap.set(term, complexity);
          }
        }
        // find the two terms of the shortest combined complexity that, when XOR'ed together, give the searched term
        let pair = [],
          min = Infinity;
        for (let i = 0; i < maskedDictionary.length; i++) {
          let term0 = maskedDictionary[i];
          let complementary = (e.data.term ^ term0[0]) | e.data.mask;
          if(maskedDictionaryMap.has(complementary)) {
            let term1Complexity = maskedDictionaryMap.get(complementary);
            if (term1Complexity + term0[1] < min) {
              pair = [complementary, term0[0]];
              min = term1Complexity + term0[1];
            }
          }
        }

        const results1 = makeExpressionsBFS({
          varCount: e.data.varCount,
          maxDepth: e.data.maxDepth,
          term: pair[0],
          mask: e.data.mask,
        });
        const results2 = makeExpressionsBFS({
          varCount: e.data.varCount,
          maxDepth: e.data.maxDepth,
          term: pair[1],
          mask: e.data.mask,
        });

        postMessage({
          action: "double",
          results1: results1,
          results2: results2,
        });
      }
      break;
    }
    case "test": {
      const results = makeExpressionsBFS({
        varCount: e.data.varCount,
        maxDepth: e.data.maxDepth,
        term: 0,
        mask: 0,
        callback: testfunc,
      });

      postMessage({
        action: "test",
        results: results,
      });
      break;
    }
  }
};
