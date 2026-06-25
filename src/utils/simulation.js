import { parseSopExpression } from "./expressionParser.js";
import { bitForStateVariable } from "./stateEncoding.js";

export function defaultInputSequence(result, length = 8) {
  const width = Math.max(1, result?.inputVariables?.length || 1);
  return Array.from({ length }, (_, index) => (index % 2).toString().repeat(width)).join(" ");
}

export function parseInputSequence(rawValue, width = 1) {
  const source = String(rawValue || "").trim();
  if (!source) return { values: [], errors: ["Input sequence is empty."] };
  const tokens = /[\s,]/.test(source)
    ? source.split(/[\s,]+/).filter(Boolean)
    : width === 1
      ? [...source]
      : source.match(new RegExp(`[01]{${width}}`, "g")) || [];
  const errors = [];
  const values = tokens.map((token, index) => {
    const value = token.trim();
    if (!/^[01]+$/.test(value)) errors.push(`Step ${index + 1}: input must contain only 0 and 1.`);
    if (value.length !== width) errors.push(`Step ${index + 1}: input length must be ${width}.`);
    return value;
  });
  return { values, errors: [...new Set(errors)] };
}

export function evaluateEquation(expression, variableValues, variables = []) {
  const source = String(expression || "").trim();
  if (source === "0") return "0";
  if (source === "1") return "1";
  const terms = parseSopExpression(source, variables);
  const isOne = terms.some((term) =>
    term.factors.every((factor) => {
      const value = variableValues[factor.variable] || "0";
      return factor.inverted ? value === "0" : value === "1";
    })
  );
  return isOne ? "1" : "0";
}

function stateValuesFromCode(result, code) {
  return Object.fromEntries(
    result.encodingInfo.stateVariables.map((stateVariable) => [stateVariable, bitForStateVariable(code, stateVariable)])
  );
}

function inputValuesFromCode(inputVariables, inputCode) {
  return Object.fromEntries(inputVariables.map((variable, index) => [variable, inputCode[index] || "0"]));
}

function codeFromStateValues(result, values) {
  return result.encodingInfo.encodingBitVariables.map((stateVariable) => values[stateVariable] || "0").join("");
}

function stateForCode(result, code) {
  const match = Object.entries(result.encodingInfo.encoding).find(([, value]) => value === code);
  return match?.[0] || `Unused ${code}`;
}

function findTransitionRow(result, presentState, inputCode) {
  return result.sourceRows.find((row) => row.presentState === presentState && row.input === inputCode);
}

function equationValues(result, variableValues) {
  return Object.fromEntries(
    result.equations.map((equation) => [
      equation.input,
      evaluateEquation(equation.equation, variableValues, equation.variables)
    ])
  );
}

function outputValues(result, variableValues) {
  return result.outputEquations
    .map((equation) => evaluateEquation(equation.equation, variableValues, equation.variables))
    .join("");
}

function nextStateValuesFromFlipFlops(result, presentValues, ffValues) {
  const nextValues = {};
  result.encodingInfo.stateVariables.forEach((stateVariable) => {
    const suffix = stateVariable.slice(1);
    const q = presentValues[stateVariable] || "0";
    if (result.flipFlopType === "D") {
      nextValues[stateVariable] = ffValues[`D${suffix}`] || "0";
      return;
    }
    if (result.flipFlopType === "T") {
      const t = ffValues[`T${suffix}`] || "0";
      nextValues[stateVariable] = t === "1" ? (q === "1" ? "0" : "1") : q;
      return;
    }
    const j = ffValues[`J${suffix}`] || "0";
    const k = ffValues[`K${suffix}`] || "0";
    if (j === "0" && k === "0") nextValues[stateVariable] = q;
    else if (j === "0" && k === "1") nextValues[stateVariable] = "0";
    else if (j === "1" && k === "0") nextValues[stateVariable] = "1";
    else nextValues[stateVariable] = q === "1" ? "0" : "1";
  });
  return nextValues;
}

export function simulateStep(result, presentState, presentCode, inputCode, stepIndex = 0) {
  const presentValues = stateValuesFromCode(result, presentCode);
  const variableValues = {
    ...presentValues,
    ...inputValuesFromCode(result.inputVariables, inputCode)
  };
  const expectedRow = findTransitionRow(result, presentState, inputCode);
  const expectedOutput = expectedRow?.output ?? "?";
  const expectedNextState = expectedRow?.nextState ?? "?";
  const ffValues = equationValues(result, variableValues);
  const actualOutput = outputValues(result, variableValues);
  const actualNextValues = nextStateValuesFromFlipFlops(result, presentValues, ffValues);
  const actualNextCode = codeFromStateValues(result, actualNextValues);
  const actualNextState = stateForCode(result, actualNextCode);
  const expectedNextCode = result.encodingInfo.encoding[expectedNextState] || "?";
  const pass = expectedOutput === actualOutput && expectedNextState === actualNextState;

  return {
    step: stepIndex + 1,
    input: inputCode,
    presentState,
    presentCode,
    presentValues,
    expectedOutput,
    actualOutput,
    expectedNextState,
    expectedNextCode,
    actualNextState,
    actualNextCode,
    actualNextValues,
    ffValues,
    result: pass ? "PASS" : "FAIL"
  };
}

export function createSimulationTrace({ result, inputSequence }) {
  if (!result) return { rows: [], errors: ["Generate a design before running timing simulation."] };
  const parsed = Array.isArray(inputSequence)
    ? { values: inputSequence, errors: [] }
    : parseInputSequence(inputSequence, result.inputVariables.length);
  if (parsed.errors.length) return { rows: [], errors: parsed.errors };

  const rows = [];
  let presentState = result.encodingInfo.states[0];
  let presentCode = result.encodingInfo.encoding[presentState] || "0".repeat(result.encodingInfo.bitCount);
  parsed.values.forEach((inputCode, index) => {
    const row = simulateStep(result, presentState, presentCode, inputCode, index);
    rows.push(row);
    presentState = row.actualNextState;
    presentCode = row.actualNextCode;
  });
  return { rows, errors: [] };
}

function reachableStates(result) {
  if (!result?.sourceRows?.length) return new Set();
  const reachable = new Set([result.encodingInfo.states[0]]);
  let changed = true;
  while (changed) {
    changed = false;
    result.sourceRows.forEach((row) => {
      if (reachable.has(row.presentState) && !reachable.has(row.nextState)) {
        reachable.add(row.nextState);
        changed = true;
      }
    });
  }
  return reachable;
}

function checkEveryTransition(result, predicate) {
  return result.sourceRows.every((row, index) => {
    const presentCode = result.encodingInfo.encoding[row.presentState];
    if (!presentCode) return false;
    return predicate(simulateStep(result, row.presentState, presentCode, row.input, index), row);
  });
}

function status(condition, hasRun) {
  if (!hasRun) return "skipped";
  return condition ? "pass" : "fail";
}

function circuitValidationFromSvg(diagramSvg = "") {
  if (!diagramSvg) return { valid: false, errorCount: 0, detail: "Circuit SVG has not been generated." };
  const dataStatus = diagramSvg.match(/data-circuit-validation="([^"]+)"/)?.[1];
  const dataErrorCount = Number(diagramSvg.match(/data-circuit-error-count="([^"]+)"/)?.[1] || 0);
  const desc = diagramSvg.match(/<desc>([\s\S]*?)<\/desc>/)?.[1]?.replace(/<[^>]*>/g, "") || "";
  const valid = dataStatus ? dataStatus === "valid" : desc.includes("Layout validation: valid");
  if (valid) {
    return {
      valid: true,
      errorCount: 0,
      detail: "Circuit layout, exact pin connections, OR inputs, buses, and graph checks passed."
    };
  }
  const detail = desc.includes("invalid -")
    ? desc.replace(/^Layout validation:\s*/i, "").replace(/^invalid\s*-\s*/i, "")
    : "Circuit graph validation failed.";
  return {
    valid: false,
    errorCount: Number.isFinite(dataErrorCount) ? dataErrorCount : 0,
    detail
  };
}

export function buildValidationCards({ result, messages = { errors: [], warnings: [] }, diagramSvg = "", timingTrace = null }) {
  const hasRun = Boolean(result) || messages.errors.length > 0;
  if (!hasRun) {
    return {
      allCriticalPass: false,
      cards: [
        ["Design Check", "Generate a design to run validation."],
        ["State Transition Check", "Waiting for generated transition data."],
        ["Flip-Flop Excitation Check", "Waiting for generated flip-flop equations."],
        ["Output Equation Check", "Waiting for generated output equations."],
        ["Timing Trace Check", "Waiting for timing simulation."],
        ["Circuit Graph Check", "Waiting for generated circuit SVG."]
      ].map(([title, detail]) => ({ title, detail, status: "skipped", critical: true }))
    };
  }

  const reachable = result ? reachableStates(result) : new Set();
  const statesForReachability = result ? (result.encodingInfo.activeStates?.length ? result.encodingInfo.activeStates : result.encodingInfo.states) : [];
  const unreachable = result ? statesForReachability.filter((state) => !reachable.has(state)) : [];
  const designPass = Boolean(result) && messages.errors.length === 0 && unreachable.length === 0;
  const transitionPass =
    Boolean(result) &&
    result.sourceRows.every(
      (row) =>
        result.encodingInfo.encoding[row.presentState] &&
        result.encodingInfo.encoding[row.nextState] &&
        /^[01]+$/.test(row.input) &&
        /^[01]+$/.test(row.output)
    );
  const excitationPass =
    Boolean(result) &&
    checkEveryTransition(result, (step, row) => step.actualNextState === row.nextState);
  const outputPass = Boolean(result) && checkEveryTransition(result, (step, row) => step.actualOutput === row.output);
  const traceRows = timingTrace?.rows || (result ? createSimulationTrace({ result, inputSequence: defaultInputSequence(result) }).rows : []);
  const timingPass = Boolean(result) && traceRows.length > 0 && traceRows.every((row) => row.result === "PASS");
  const circuitValidation = circuitValidationFromSvg(diagramSvg);
  const circuitPass = Boolean(diagramSvg) && circuitValidation.valid;

  const cards = [
    {
      title: "Design Check",
      status: messages.errors.length ? "fail" : status(designPass, hasRun),
      detail: messages.errors.length
        ? messages.errors.join(" ")
        : unreachable.length
          ? `Unreachable state(s): ${unreachable.join(", ")}.`
          : "State table is complete, states are non-empty, and all states are reachable from the initial state.",
      critical: true
    },
    {
      title: "State Transition Check",
      status: status(transitionPass, hasRun),
      detail: transitionPass
        ? "All present/next states are encoded and transition rows use valid binary input/output values."
        : "One or more transition rows cannot be matched to valid encoded states.",
      critical: true
    },
    {
      title: "Flip-Flop Excitation Check",
      status: status(excitationPass, hasRun),
      detail: excitationPass
        ? "Evaluated flip-flop input equations reproduce the expected next state for every transition row."
        : "At least one evaluated flip-flop equation does not reproduce the expected next state.",
      critical: true
    },
    {
      title: "Output Equation Check",
      status: status(outputPass, hasRun),
      detail: outputPass
        ? "Output equations match the state table outputs for every generated transition."
        : "At least one output equation does not match the state table output.",
      critical: true
    },
    {
      title: "Timing Trace Check",
      status: status(timingPass, hasRun),
      detail: timingPass
        ? "Default timing simulation trace matches expected outputs and next states."
        : "Timing trace has mismatches or could not run.",
      critical: true
    },
    {
      title: "Circuit Graph Check",
      status: status(circuitPass, hasRun),
      detail: circuitPass
        ? circuitValidation.detail
        : `Circuit graph validation failed${circuitValidation.errorCount ? ` with ${circuitValidation.errorCount} issue(s)` : ""}: ${circuitValidation.detail}`,
      critical: true
    }
  ];

  return {
    cards,
    allCriticalPass: cards.filter((card) => card.critical).every((card) => card.status === "pass")
  };
}
