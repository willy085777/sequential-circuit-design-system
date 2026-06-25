import { allBinaryCodes, simplifySop, valuesForMap } from "./booleanSimplifier.js";
import { excitationForBit, getFlipFlopInputs } from "./excitationTable.js";
import { bitForStateVariable, codeInVariableOrder } from "./stateEncoding.js";

function pushUnique(target, value) {
  if (!target.includes(value)) target.push(value);
}

function buildDontCares(variableCount, specified, minterms) {
  return allBinaryCodes(variableCount).filter((code) => !specified.has(code) && !minterms.includes(code));
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
        if (value === "X") pushUnique(bucket.dontCares, termCode);
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

  const mapItems = [...equations, ...outputEquations].map((equation) => ({
    ...equation,
    values: valuesForMap(equation)
  }));

  return {
    allVariables,
    excitationRows,
    equations,
    outputEquations,
    mapItems
  };
}
