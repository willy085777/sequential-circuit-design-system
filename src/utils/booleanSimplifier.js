import { formatTerm } from "./equationFormatter.js";

export function allBinaryCodes(width) {
  return Array.from({ length: 2 ** width }, (_, index) => index.toString(2).padStart(width, "0"));
}

function onesCount(term) {
  return [...term].filter((bit) => bit === "1").length;
}

function combineTerms(left, right) {
  let diffCount = 0;
  let combined = "";
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      combined += left[index];
    } else if (left[index] !== "-" && right[index] !== "-") {
      diffCount += 1;
      combined += "-";
    } else {
      return null;
    }
  }
  return diffCount === 1 ? combined : null;
}

function termCovers(term, minterm) {
  return [...term].every((bit, index) => bit === "-" || bit === minterm[index]);
}

function termToAllCodes(term) {
  let codes = [""];
  [...term].forEach((bit) => {
    if (bit === "-") {
      codes = codes.flatMap((prefix) => [`${prefix}0`, `${prefix}1`]);
    } else {
      codes = codes.map((prefix) => `${prefix}${bit}`);
    }
  });
  return codes;
}

function findPrimeImplicants(minterms, dontCares) {
  let groups = new Map();
  [...new Set([...minterms, ...dontCares])].forEach((term) => {
    const key = onesCount(term);
    const entries = groups.get(key) || [];
    entries.push(term);
    groups.set(key, entries);
  });

  const primes = new Set();
  while (groups.size) {
    const nextGroups = new Map();
    const used = new Set();
    const keys = [...groups.keys()].sort((a, b) => a - b);

    keys.forEach((key) => {
      const current = groups.get(key) || [];
      const next = groups.get(key + 1) || [];
      current.forEach((left) => {
        next.forEach((right) => {
          const combined = combineTerms(left, right);
          if (combined) {
            used.add(left);
            used.add(right);
            const groupKey = onesCount(combined);
            const entries = nextGroups.get(groupKey) || [];
            if (!entries.includes(combined)) entries.push(combined);
            nextGroups.set(groupKey, entries);
          }
        });
      });
    });

    groups.forEach((terms) => {
      terms.forEach((term) => {
        if (!used.has(term)) primes.add(term);
      });
    });

    groups = nextGroups;
  }

  return [...primes];
}

function chooseImplicants(primes, minterms) {
  const uncovered = new Set(minterms);
  const chosen = [];

  minterms.forEach((minterm) => {
    const covering = primes.filter((prime) => termCovers(prime, minterm));
    if (covering.length === 1 && !chosen.includes(covering[0])) {
      chosen.push(covering[0]);
      minterms.forEach((candidate) => {
        if (termCovers(covering[0], candidate)) uncovered.delete(candidate);
      });
    }
  });

  while (uncovered.size) {
    const best = primes
      .filter((prime) => !chosen.includes(prime))
      .map((prime) => ({
        prime,
        coverage: [...uncovered].filter((minterm) => termCovers(prime, minterm)).length,
        literalCount: [...prime].filter((bit) => bit !== "-").length
      }))
      .sort((a, b) => b.coverage - a.coverage || a.literalCount - b.literalCount)[0];

    if (!best || best.coverage === 0) break;
    chosen.push(best.prime);
    [...uncovered].forEach((minterm) => {
      if (termCovers(best.prime, minterm)) uncovered.delete(minterm);
    });
  }

  return uncovered.size ? [] : chosen;
}

export function canonicalSop(minterms, variables) {
  if (!minterms.length) return "0";
  return minterms.map((minterm) => formatTerm(minterm, variables)).join(" + ");
}

export function simplifySop({ minterms, dontCares = [], variables }) {
  const uniqueMinterms = [...new Set(minterms)].sort();
  const uniqueDontCares = [...new Set(dontCares)].filter((term) => !uniqueMinterms.includes(term)).sort();
  const allCodes = allBinaryCodes(variables.length);
  const nonZeroCodes = new Set([...uniqueMinterms, ...uniqueDontCares]);
  const zeroCodes = allCodes.filter((code) => !nonZeroCodes.has(code));

  if (!uniqueMinterms.length) return "0";
  if (uniqueMinterms.length === allCodes.length) return "1";
  if (zeroCodes.length === 0) return "1";

  try {
    const primes = findPrimeImplicants(uniqueMinterms, uniqueDontCares).filter((prime) => {
      const coveredCodes = termToAllCodes(prime);
      return coveredCodes.every((code) => !zeroCodes.includes(code));
    });
    const chosen = chooseImplicants(primes, uniqueMinterms);
    if (!chosen.length) return canonicalSop(uniqueMinterms, variables);
    return chosen
      .sort((a, b) => a.localeCompare(b))
      .map((term) => {
        const bits = [...term];
        const usedVariables = [];
        const usedBits = [];
        bits.forEach((bit, index) => {
          if (bit !== "-") {
            usedVariables.push(variables[index]);
            usedBits.push(bit);
          }
        });
        return formatTerm(usedBits.join(""), usedVariables);
      })
      .join(" + ");
  } catch {
    return canonicalSop(uniqueMinterms, variables);
  }
}

export function valuesForMap({ variables, minterms, dontCares }) {
  const mintermSet = new Set(minterms);
  const dontCareSet = new Set(dontCares);
  return allBinaryCodes(variables.length).map((code) => ({
    code,
    value: mintermSet.has(code) ? "1" : dontCareSet.has(code) ? "X" : "0"
  }));
}
