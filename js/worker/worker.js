import { Dictionary } from "../data/dictionary.js";
import { makeExpressionsBFS, testfunc } from "./expressions.js";

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
