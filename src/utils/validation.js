export function parseVariables(rawValue, label) {
  const source = String(rawValue || "");
  const variables = source
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const errors = [];
  if (variables.length === 0) errors.push(`${label} must include at least one variable.`);
  if (/(^|,)\s*(,|$)/.test(source)) errors.push(`${label} contains an empty variable name.`);
  const seen = new Set();
  variables.forEach((variable) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(variable)) {
      errors.push(`${label} contains unsupported variable name: ${variable}`);
    }
    if (seen.has(variable)) errors.push(`${label} contains duplicate variable: ${variable}`);
    seen.add(variable);
  });
  return { variables, errors };
}

export function validateStateTable(rows, inputVariables, outputVariables, modelType) {
  const errors = [];
  const warnings = [];
  if (!rows.length) errors.push("State table is empty.");

  const mooreOutputs = new Map();
  rows.forEach((row, index) => {
    const rowNumber = index + 1;
    const present = String(row.presentState || "").trim();
    const next = String(row.nextState || "").trim();
    const input = String(row.input || "").trim();
    const output = String(row.output || "").trim();

    if (!present) errors.push(`Row ${rowNumber}: Present State is missing.`);
    if (!next) errors.push(`Row ${rowNumber}: Next State is missing.`);
    if (present && !/^[A-Za-z][A-Za-z0-9_]*$/.test(present)) {
      errors.push(`Row ${rowNumber}: Present State has unsupported characters.`);
    }
    if (next && !/^[A-Za-z][A-Za-z0-9_]*$/.test(next)) {
      errors.push(`Row ${rowNumber}: Next State has unsupported characters.`);
    }
    if (!/^[01]+$/.test(input)) {
      errors.push(`Row ${rowNumber}: Input contains unsupported characters. Use only 0 and 1.`);
    } else if (input.length !== inputVariables.length) {
      errors.push(`Row ${rowNumber}: Input value length must match ${inputVariables.length} input variable(s).`);
    }
    if (!/^[01]+$/.test(output)) {
      errors.push(`Row ${rowNumber}: Output contains unsupported characters. Use only 0 and 1.`);
    } else if (output.length !== outputVariables.length) {
      errors.push(`Row ${rowNumber}: Output value length must match ${outputVariables.length} output variable(s).`);
    }

    if (modelType === "Moore" && present) {
      if (mooreOutputs.has(present) && mooreOutputs.get(present) !== output) {
        warnings.push("Moore model warning: outputs for the same present state should be identical.");
      }
      mooreOutputs.set(present, output);
    }
  });

  return { errors, warnings: [...new Set(warnings)] };
}
