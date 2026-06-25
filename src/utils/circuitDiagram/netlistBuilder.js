const PRODUCT_SPLIT_RE = /\s*(?:\u7e5a|\u00b7|\*|&|\?|\ufffd)\s*/u;
const SUM_SPLIT_RE = /\s*\+\s*/u;
const INPUT_ORDER = ["Q0", "Q0'", "Q1", "Q1'", "X", "X'"];

function sanitizeId(value) {
  return String(value || "node")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "node";
}

function unique(values) {
  return [...new Set(values)];
}

function literalNetId(literal) {
  return literal.inverted ? `${literal.name}'` : literal.name;
}

export function getSignalInputOrderRank(signal) {
  const index = INPUT_ORDER.indexOf(signal);
  if (index >= 0) return index;
  const qMatch = String(signal || "").match(/^Q(\d+)('?)$/);
  if (qMatch) return Number(qMatch[1]) * 2 + (qMatch[2] ? 1 : 0);
  return INPUT_ORDER.length + 100;
}

export function sortLiteralsForAndGate(literals = []) {
  return [...literals].sort((left, right) => {
    if (left.inputOrderRank !== right.inputOrderRank) return left.inputOrderRank - right.inputOrderRank;
    return left.signal.localeCompare(right.signal);
  });
}

function directSignalClass(name, inputVariables = []) {
  if (inputVariables.includes(name)) return "input";
  if (/^Q\d+$/.test(name)) return "feedback";
  return "internal";
}

function literalSignalClass(literal, inputVariables = []) {
  if (inputVariables.includes(literal.name)) return literal.inverted ? "input-inverted" : "input";
  if (/^Q\d+$/.test(literal.name)) return "feedback";
  return literal.inverted ? "internal" : directSignalClass(literal.name, inputVariables);
}

function createBuilder({ inputVariables = [], outputVariables = [] } = {}) {
  const builder = {
    inputVariables,
    outputVariables,
    gates: [],
    nets: new Map(),
    equations: [],
    visualGatePlans: {},
    targetMap: {},
    counters: {
      gate: 0,
      const: 0,
      wire: 0
    }
  };

  inputVariables.forEach((input) => ensureNet(builder, input, "input", `input:${input}`));
  return builder;
}

function ensureNet(builder, id, signalClass = "internal", source = "") {
  const existing = builder.nets.get(id);
  if (existing) {
    if (source && !existing.source) existing.source = source;
    if (signalClass === "output" || existing.signalClass === "internal") existing.signalClass = signalClass;
    return existing;
  }
  const net = {
    id,
    source,
    sinks: [],
    signalClass
  };
  builder.nets.set(id, net);
  return net;
}

function addSink(builder, netId, sink) {
  const net = ensureNet(builder, netId);
  if (!net.sinks.includes(sink)) net.sinks.push(sink);
}

function addGate(builder, gate) {
  const normalizedGate = {
    id: gate.id,
    type: gate.type,
    inputs: gate.inputs || [],
    output: gate.output,
    stage: gate.stage ?? 0,
    target: gate.target,
    equationTarget: gate.equationTarget,
    visualInputCount: gate.visualInputCount,
    visualRole: gate.visualRole,
    inputOrder: gate.inputOrder,
    termId: gate.termId,
    termIndex: gate.termIndex
  };
  builder.gates.push(normalizedGate);
  normalizedGate.inputs.forEach((input) => addSink(builder, input, normalizedGate.id));
  ensureNet(builder, normalizedGate.output, gate.signalClass || "internal", normalizedGate.id);
  return normalizedGate;
}

function parseLiteral(rawLiteral) {
  const source = String(rawLiteral || "").trim();
  const inverted = source.endsWith("'");
  const name = inverted ? source.slice(0, -1).trim() : source;
  if (!name) return null;
  const signal = inverted ? `${name}'` : name;
  return {
    signal,
    base: name,
    name,
    inverted,
    inputOrderRank: getSignalInputOrderRank(signal)
  };
}

export function parseEquationExpression(expression) {
  const source = String(expression || "").trim();
  if (source === "0" || source === "1") {
    return { constant: source, terms: [] };
  }

  const terms = source
    .split(SUM_SPLIT_RE)
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => {
      const literals = sortLiteralsForAndGate(
        term
          .split(PRODUCT_SPLIT_RE)
          .map(parseLiteral)
          .filter(Boolean)
      );
      return { literals };
    });

  return { constant: null, terms };
}

function parsedEquationFromInput(equation) {
  const target = equation.target || equation.input || equation.output || equation.id;
  const parsed = parseEquationExpression(equation.expression ?? equation.equation);
  return {
    target,
    expression: String(equation.expression ?? equation.equation ?? "").trim(),
    terms: parsed.terms.map((term, termIndex) => ({
      id: `term-${termIndex}`,
      literals: sortLiteralsForAndGate(term.literals)
    })),
    constant: parsed.constant,
    variables: equation.variables || []
  };
}

function visualTermOutputSignal(equationKey, termIndex) {
  return `eq-${equationKey}-term-${termIndex}-visual-out`;
}

function visualTargetSignal(equationKey, target) {
  return `eq-${equationKey}-visual-target-${sanitizeId(target)}`;
}

function visualTermNode(term, equationKey, termIndex, equationTarget) {
  const termId = `eq-${equationKey}-term-${termIndex}`;
  if (!term.literals.length) {
    return {
      id: termId,
      literals: [],
      outputSignal: visualTermOutputSignal(equationKey, termIndex),
      visualGateType: "CONST",
      visualInputCount: 0,
      sourceSignals: ["CONST_1"],
      sourceTermIndex: termIndex,
      gate: {
        id: `${termId}-const-1`,
        type: "CONST",
        inputs: [],
        output: visualTermOutputSignal(equationKey, termIndex),
        visualInputCount: 0,
        equationTarget,
        stage: 1,
        termId,
        termIndex
      }
    };
  }
  if (term.literals.length === 1) {
    return {
      id: termId,
      literals: term.literals.map((literal) => ({ ...literal })),
      outputSignal: term.literals[0].signal,
      visualGateType: "WIRE",
      visualInputCount: 1,
      sourceSignals: [term.literals[0].signal],
      sourceTermIndex: termIndex,
      gate: {
        id: `${termId}-wire`,
        type: "WIRE",
        inputs: [term.literals[0].signal],
        output: term.literals[0].signal,
        visualInputCount: 1,
        equationTarget,
        stage: 1,
        termId,
        termIndex,
        inputOrder: [term.literals[0].signal]
      }
    };
  }

  const inputOrder = term.literals.map((literal) => literal.signal);
  return {
    id: termId,
    literals: term.literals.map((literal) => ({ ...literal })),
    outputSignal: visualTermOutputSignal(equationKey, termIndex),
    visualGateType: "AND",
    visualInputCount: term.literals.length,
    sourceSignals: inputOrder,
    sourceTermIndex: termIndex,
    gate: {
      id: `${termId}-and`,
      type: "AND",
      inputs: inputOrder,
      output: visualTermOutputSignal(equationKey, termIndex),
      visualInputCount: term.literals.length,
      equationTarget,
      stage: 1,
      termId,
      termIndex,
      inputOrder
    }
  };
}

export function buildVisualGatePlan(parsedEquation) {
  const equationKey = sanitizeId(parsedEquation.target);
  if (parsedEquation.constant === "0" || parsedEquation.constant === "1") {
    return {
      target: parsedEquation.target,
      productGates: [],
      finalGate: null,
      directWire: false,
      constantValue: parsedEquation.constant,
      sourceSignal: `CONST_${parsedEquation.constant}`,
      targetSignal: visualTargetSignal(equationKey, parsedEquation.target)
    };
  }

  const productTerms = parsedEquation.terms.map((term, termIndex) => visualTermNode(term, equationKey, termIndex, parsedEquation.target));
  const productGates = productTerms
    .filter((term) => term.gate.type !== "WIRE")
    .map((term) => term.gate);
  const directWire = productTerms.length === 1 && productTerms[0]?.visualGateType === "WIRE";
  const finalGate = productTerms.length > 1
    ? {
        id: `eq-${equationKey}-or`,
        type: "OR",
        inputs: productTerms.map((term) => term.outputSignal),
        output: visualTargetSignal(equationKey, parsedEquation.target),
        target: parsedEquation.target,
        visualInputCount: productTerms.length,
        equationTarget: parsedEquation.target,
        stage: 2,
        inputTerms: productTerms.map((term, index) => ({
          productTermId: term.id,
          sourceGateId: term.gate.id,
          sourceSignal: term.outputSignal,
          termIndex: index,
          equationTarget: parsedEquation.target
        }))
      }
    : null;

  return {
    target: parsedEquation.target,
    productTerms: productTerms.map(({ gate, ...term }) => term),
    productGates,
    finalGate,
    directWire,
    constantValue: null,
    sourceSignal: productTerms[0]?.outputSignal || "",
    targetSignal: finalGate?.output || productTerms[0]?.outputSignal || visualTargetSignal(equationKey, parsedEquation.target)
  };
}

function ensureLiteralSignal(builder, literal) {
  const directNet = ensureNet(
    builder,
    literal.name,
    directSignalClass(literal.name, builder.inputVariables),
    directSignalClass(literal.name, builder.inputVariables) === "input" ? `input:${literal.name}` : `feedback:${literal.name}`
  );

  if (!literal.inverted) {
    return {
      net: directNet.id,
      stage: 0,
      source: directNet.source,
      literal
    };
  }

  const invertedNetId = literalNetId(literal);
  const existing = builder.gates.find((gate) => gate.type === "NOT" && gate.output === invertedNetId);
  if (existing) {
    return {
      net: invertedNetId,
      stage: existing.stage,
      source: existing.id,
      literal
    };
  }

  const gateId = `not-${sanitizeId(literal.name)}`;
  addGate(builder, {
    id: gateId,
    type: "NOT",
    inputs: [literal.name],
    output: invertedNetId,
    stage: 0,
    signalClass: literalSignalClass(literal, builder.inputVariables)
  });

  return {
    net: invertedNetId,
    stage: 0,
    source: gateId,
    literal
  };
}

function createConstantSignal(builder, equationKey, value, target = null) {
  const gateId = target
    ? `eq-${equationKey}-const-${value}`
    : `const-${value}-${builder.counters.const++}`;
  const output = target ? `eq-${equationKey}-const-${value}-out` : `${gateId}-out`;
  addGate(builder, {
    id: gateId,
    type: "CONST",
    inputs: [],
    output,
    stage: 0,
    target: target || undefined,
    equationTarget: target || undefined,
    signalClass: target ? "output" : "constant"
  });
  return { net: output, stage: 0, source: gateId };
}

function createWireToTarget(builder, equationKey, signal, target) {
  const gateId = `eq-${equationKey}-wire-${builder.counters.wire++}`;
  const output = `eq-${equationKey}-target-wire-${builder.counters.wire}`;
  addGate(builder, {
    id: gateId,
    type: "WIRE",
    inputs: [signal.net],
    output,
    stage: signal.stage,
    target,
    equationTarget: target,
    signalClass: "output"
  });
  return { net: output, stage: signal.stage, source: gateId };
}

function buildBinaryGateTree(builder, signals, gateType, equationKey, gateLabel) {
  if (signals.length === 1) return signals[0];

  let current = signals;
  let level = 0;
  while (current.length > 1) {
    const next = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      const right = current[index + 1];
      if (!right) {
        next.push(left);
        continue;
      }

      const stage = Math.max(left.stage, right.stage) + 1;
      const gateId = `eq-${equationKey}-${gateLabel}-l${level}-g${index / 2}`;
      const output = `${gateId}-out`;
      addGate(builder, {
        id: gateId,
        type: gateType,
        inputs: [left.net, right.net],
        output,
        stage,
        visualInputCount: 2,
        signalClass: "internal"
      });
      next.push({ net: output, stage, source: gateId });
    }
    current = next;
    level += 1;
  }
  return current[0];
}

function buildTermSignal(builder, term, equationKey, termIndex) {
  if (!term.literals.length) return createConstantSignal(builder, `${equationKey}-term-${termIndex}`, "1");
  const literalSignals = term.literals.map((literal) => ensureLiteralSignal(builder, literal));
  return buildBinaryGateTree(builder, literalSignals, "AND", `${equationKey}-t${termIndex}`, "and");
}

function connectFinalTarget(builder, equationKey, signal, target) {
  const sourceGate = builder.gates.find((gate) => gate.id === signal.source);
  const finalSignal = sourceGate && sourceGate.type !== "NOT" && sourceGate.type !== "WIRE"
    ? signal
    : createWireToTarget(builder, equationKey, signal, target);
  const finalGate = builder.gates.find((gate) => gate.id === finalSignal.source);
  if (finalGate) {
    finalGate.target = target;
    finalGate.equationTarget = target;
  }
  ensureNet(builder, finalSignal.net, "output", finalSignal.source);
  addSink(builder, finalSignal.net, `target:${target}`);
  builder.targetMap[target] = finalSignal.net;
  return finalSignal;
}

function buildEquation(builder, equation) {
  const parsedEquation = parsedEquationFromInput(equation);
  const equationKey = sanitizeId(parsedEquation.target);
  const visualGatePlan = buildVisualGatePlan(parsedEquation);
  const equationModel = {
    target: parsedEquation.target,
    expression: parsedEquation.expression,
    targetSignal: visualGatePlan.targetSignal,
    terms: parsedEquation.terms.map((term) => ({
      id: term.id,
      literals: term.literals.map((literal) => ({ ...literal })),
      outputSignal: visualGatePlan.productTerms?.find((productTerm) => productTerm.id === `eq-${equationKey}-${term.id}`)?.outputSignal,
      visualGateType: visualGatePlan.productTerms?.find((productTerm) => productTerm.id === `eq-${equationKey}-${term.id}`)?.visualGateType,
      visualInputCount: term.literals.length
    })),
    visualGatePlan
  };
  builder.equations.push(equationModel);
  builder.visualGatePlans[parsedEquation.target] = visualGatePlan;

  if (parsedEquation.constant === "0" || parsedEquation.constant === "1") {
    const signal = createConstantSignal(builder, equationKey, parsedEquation.constant, parsedEquation.target);
    ensureNet(builder, signal.net, "output", signal.source);
    addSink(builder, signal.net, `target:${parsedEquation.target}`);
    builder.targetMap[parsedEquation.target] = signal.net;
    return signal;
  }

  const termSignals = parsedEquation.terms.map((term, termIndex) => buildTermSignal(builder, term, equationKey, termIndex));
  const outputSignal = termSignals.length > 1
    ? buildBinaryGateTree(builder, termSignals, "OR", equationKey, "or")
    : termSignals[0];

  return connectFinalTarget(builder, equationKey, outputSignal, parsedEquation.target);
}

export function parseEquationToGateTree(equation, options = {}) {
  const builder = createBuilder(options);
  const parsedEquation = parsedEquationFromInput(equation);
  buildEquation(builder, parsedEquation);
  return {
    parsedEquation: builder.equations[0],
    visualGatePlan: builder.equations[0]?.visualGatePlan,
    gates: builder.gates,
    nets: [...builder.nets.values()],
    targetMap: { ...builder.targetMap }
  };
}

function stateVariableOrder(result, flipFlopEquations = []) {
  if (result?.encodingInfo?.stateVariables?.length) return [...result.encodingInfo.stateVariables];
  return unique(
    flipFlopEquations
      .map((equation) => equation.input || equation.id || "")
      .map((input) => input.replace(/^[A-Z]+/, ""))
      .filter(Boolean)
      .map((suffix) => `Q${suffix}`)
  ).sort((left, right) => Number(left.slice(1)) - Number(right.slice(1)));
}

function feedbackBusOrderFor(stateVariables = []) {
  return stateVariables.flatMap((stateVariable) => [stateVariable, `${stateVariable}'`]);
}

function inputBusMetadata(builder) {
  return builder.inputVariables.map((input) => ({
    input,
    bus: input,
    invertedBus: builder.nets.has(`${input}'`) ? `${input}'` : null,
    invertedGeneratedBy: builder.gates.find((gate) => gate.type === "NOT" && gate.inputs[0] === input && gate.output === `${input}'`)?.id || null,
    primary: true
  }));
}

export function buildCircuitNetlist({ result, inputVariables = [], outputVariables = [] }) {
  const builder = createBuilder({ inputVariables, outputVariables });
  const flipFlopEquations = result?.equations || [];
  const outputEquations = result?.outputEquations || [];

  [...flipFlopEquations, ...outputEquations].forEach((equation) => {
    buildEquation(builder, {
      target: equation.input || equation.output || equation.id,
      expression: equation.equation,
      variables: equation.variables
    });
  });
  const stateVariables = stateVariableOrder(result, flipFlopEquations);
  const feedbackBusOrder = feedbackBusOrderFor(stateVariables);

  return {
    inputs: unique(inputVariables),
    outputs: unique(outputVariables),
    flipFlopInputs: flipFlopEquations.map((equation) => equation.input),
    gates: builder.gates,
    nets: [...builder.nets.values()],
    equations: builder.equations,
    visualGatePlans: { ...builder.visualGatePlans },
    targetMap: { ...builder.targetMap },
    metadata: {
      stateVariables,
      flipFlopPlacement: stateVariables.map((stateVariable, index) => ({
        stateVariable,
        role: index === 0 ? "upper" : index === 1 ? "lower" : `extra-${index}`,
        order: index
      })),
      feedbackBusOrder,
      inputOrderPriority: [...INPUT_ORDER],
      inputBuses: inputBusMetadata(builder),
      invertedInputs: inputBusMetadata(builder).filter((item) => item.invertedBus).map((item) => ({
        input: item.input,
        invertedSignal: item.invertedBus,
        notGateId: item.invertedGeneratedBy,
        generatedFromPrimaryInput: true
      }))
    }
  };
}
