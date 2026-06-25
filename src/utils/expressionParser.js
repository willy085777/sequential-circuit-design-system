import { allBinaryCodes } from "./booleanSimplifier.js";

export function parseSopExpression(expression, variables) {
  const source = String(expression || "").trim();
  if (source === "0") return [];
  if (source === "1") {
    return [
      {
        label: "1",
        factors: [],
        pattern: "-".repeat(variables.length),
        coveredCodes: allBinaryCodes(variables.length)
      }
    ];
  }

  return source.split(" + ").map((term, termIndex) => {
    const factors = term
      .split(" · ")
      .map((factor) => factor.trim())
      .filter(Boolean)
      .map((factor) => {
        const inverted = factor.endsWith("'");
        return { variable: inverted ? factor.slice(0, -1) : factor, inverted };
      });

    const pattern = variables
      .map((variable) => {
        const factor = factors.find((item) => item.variable === variable);
        if (!factor) return "-";
        return factor.inverted ? "0" : "1";
      })
      .join("");

    return {
      label: term || `Group ${termIndex + 1}`,
      factors,
      pattern,
      coveredCodes: allBinaryCodes(variables.length).filter((code) =>
        [...pattern].every((bit, index) => bit === "-" || bit === code[index])
      )
    };
  });
}
