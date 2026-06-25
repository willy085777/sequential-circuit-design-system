export const complement = (variableName) => `${variableName}'`;

export function formatTerm(bits, variables) {
  const bitList = Array.isArray(bits) ? bits : [...String(bits)];
  if (bitList.length === 0) return "1";
  return bitList
    .map((bit, index) => (bit === "1" ? variables[index] : complement(variables[index])))
    .join(" · ");
}

export function normalizeEquationForVerilog(expression, variables) {
  if (expression === "0" || expression === "1") return `1'b${expression}`;
  const terms = expression.split(" + ").map((term) => {
    const factors = term.split(" · ").map((factor) => {
      const trimmed = factor.trim();
      if (trimmed.endsWith("'")) return `~${trimmed.slice(0, -1)}`;
      return trimmed;
    });
    return factors.length > 1 ? `(${factors.join(" & ")})` : factors[0];
  });
  const verilog = terms.join(" | ");
  const variableSet = new Set(variables);
  return verilog
    .split(/\b/)
    .map((piece) => (variableSet.has(piece) ? piece : piece))
    .join("");
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
