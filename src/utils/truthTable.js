import { allBinaryCodes, simplifySop, valuesForMap } from "./booleanSimplifier.js";
import { excitationForBit, getFlipFlopInputs } from "./excitationTable.js";
import { bitForStateVariable, codeInVariableOrder } from "./stateEncoding.js";

const FIXED_KMAP_ROW_CODES = ["0", "1"];
const FIXED_KMAP_COLUMN_CODES = ["00", "01", "11", "10"];
const FIXED_KMAP_VARIABLES = new Set(["Q0", "Q1", "X"]);

function pushUnique(target, value) {
  if (!target.includes(value)) target.push(value);
}

function buildDontCares(variableCount, specified, minterms) {
  return allBinaryCodes(variableCount).filter((code) => !specified.has(code) && !minterms.includes(code));
}

function isDontCareValue(value) {
  return value === "-" || value === "X";
}

function supportsFixedKMapAxes(variables = []) {
  const variableSet = new Set(variables);
  return variableSet.has("Q0")
    && variableSet.has("Q1")
    && variables.every((variable) => FIXED_KMAP_VARIABLES.has(variable));
}

function codeForFixedKMapCell(variables, inputCode, stateCode) {
  return variables
    .map((variable) => {
      if (variable === "X") return inputCode;
      if (variable === "Q0") return stateCode[0];
      if (variable === "Q1") return stateCode[1];
      return "0";
    })
    .join("");
}

function fixedAxisKMapForEquation(equation, values) {
  if (!supportsFixedKMapAxes(equation.variables)) return null;
  const valueMap = new Map(values.map((item) => [item.code, item.value]));
  return {
    header: "x / Q1Q0",
    rowVariable: "X",
    columnVariables: ["Q1", "Q0"],
    rowCodes: FIXED_KMAP_ROW_CODES,
    columnCodes: FIXED_KMAP_COLUMN_CODES,
    cells: FIXED_KMAP_ROW_CODES.flatMap((inputCode) =>
      FIXED_KMAP_COLUMN_CODES.map((stateCode) => {
        const code = codeForFixedKMapCell(equation.variables, inputCode, stateCode);
        return {
          rowCode: inputCode,
          columnCode: stateCode,
          code,
          value: valueMap.get(code) || "0"
        };
      })
    )
  };
}

export function generateCircuitAnalysis({ rows, modelType, flipFlopType, inputVariables, outputVariables, encodingInfo }) {
  const { stateVariables, encoding, unusedCodes } = encodingInfo;
  const allVariables = [...stateVariables, ...inputVariables];
  const equations = [];
  const excitationRows = [];
  const inputNames = getFlipFlopInputs(flipFlopType);
  const equationBuckets = new Map();

  stateVariables.forEach((stateVariable) => {
    const suffix = stateVariable.slice(1);
    inputNames.forEach((inputName) => {
      equationBuckets.set(`${inputName}${suffix}`, { minterms: [], dontCares: [], specified: new Set() });
    });
  });

  rows.forEach((row) => {
    const presentCode = encoding[row.presentState.trim()];
    const nextCode = encoding[row.nextState.trim()];
    const inputCode = row.input.trim();
    const presentVariableCode = codeInVariableOrder(presentCode, stateVariables);
    const termCode = `${presentVariableCode}${inputCode}`;
    const excitation = {};

    stateVariables.forEach((stateVariable) => {
      const suffix = stateVariable.slice(1);
      const values = excitationForBit(
        flipFlopType,
        bitForStateVariable(presentCode, stateVariable),
        bitForStateVariable(nextCode, stateVariable)
      );
      Object.entries(values).forEach(([inputName, value]) => {
        const equationName = `${inputName}${suffix}`;
        const bucket = equationBuckets.get(equationName);
        bucket.specified.add(termCode);
        if (value === "1") pushUnique(bucket.minterms, termCode);
        if (isDontCareValue(value)) pushUnique(bucket.dontCares, termCode);
        excitation[equationName] = value;
      });
    });

    excitationRows.push({
      presentState: row.presentState.trim(),
      presentCode,
      input: inputCode,
      nextState: row.nextState.trim(),
      nextCode,
      output: row.output.trim(),
      excitation
    });
  });

  equationBuckets.forEach((bucket, equationName) => {
    unusedCodes.forEach((stateCode) => {
      const unusedVariableCode = codeInVariableOrder(stateCode, stateVariables);
      allBinaryCodes(inputVariables.length).forEach((inputCode) => {
        pushUnique(bucket.dontCares, `${unusedVariableCode}${inputCode}`);
      });
    });
    buildDontCares(allVariables.length, bucket.specified, bucket.minterms).forEach((code) =>
      pushUnique(bucket.dontCares, code)
    );
    const stateVariable = `Q${equationName.replace(/^[A-Z]+/, "")}`;
    equations.push({
      id: equationName,
      flipFlop: `FF for ${stateVariable}`,
      input: equationName,
      variables: allVariables,
      minterms: bucket.minterms,
      dontCares: bucket.dontCares,
      equation: simplifySop({ minterms: bucket.minterms, dontCares: bucket.dontCares, variables: allVariables })
    });
  });

  const outputEquations = outputVariables.map((outputVariable, outputIndex) => {
    const variables = modelType === "Moore" ? stateVariables : allVariables;
    const minterms = [];
    const specified = new Set();
    const dontCares = [];

    if (modelType === "Moore") {
      const stateOutput = new Map();
      rows.forEach((row) => {
        const stateCode = encoding[row.presentState.trim()];
        const stateVariableCode = codeInVariableOrder(stateCode, stateVariables);
        if (!stateOutput.has(stateVariableCode)) stateOutput.set(stateVariableCode, row.output.trim()[outputIndex]);
      });
      stateOutput.forEach((value, stateCode) => {
        specified.add(stateCode);
        if (value === "1") pushUnique(minterms, stateCode);
      });
      unusedCodes.forEach((code) => pushUnique(dontCares, code));
      buildDontCares(variables.length, specified, minterms).forEach((code) => pushUnique(dontCares, code));
    } else {
      rows.forEach((row) => {
        const termCode = `${codeInVariableOrder(encoding[row.presentState.trim()], stateVariables)}${row.input.trim()}`;
        specified.add(termCode);
        if (row.output.trim()[outputIndex] === "1") pushUnique(minterms, termCode);
      });
      unusedCodes.forEach((stateCode) => {
        const unusedVariableCode = codeInVariableOrder(stateCode, stateVariables);
        allBinaryCodes(inputVariables.length).forEach((inputCode) => pushUnique(dontCares, `${unusedVariableCode}${inputCode}`));
      });
      buildDontCares(variables.length, specified, minterms).forEach((code) => pushUnique(dontCares, code));
    }

    return {
      id: outputVariable,
      output: outputVariable,
      variables,
      minterms,
      dontCares,
      equation: simplifySop({ minterms, dontCares, variables })
    };
  });

  const mapItems = [...equations, ...outputEquations].map((equation) => {
    const values = valuesForMap(equation);
    return {
      ...equation,
      values,
      kmap: fixedAxisKMapForEquation(equation, values)
    };
  });

  return {
    allVariables,
    excitationRows,
    equations,
    outputEquations,
    mapItems
  };
}
