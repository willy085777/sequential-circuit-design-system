import { escapeHtml } from "./equationFormatter.js";
import { parseSopExpression } from "./expressionParser.js";
import { formatSubscriptLabel } from "./subscriptFormatter.js";
import { buildCircuitNetlist } from "./circuitDiagram/netlistBuilder.js";
import { buildCircuitLayoutFromResult } from "./circuitDiagram/layoutEngine.js";
import { renderCircuitLayoutSvg } from "./circuitDiagram/svgRenderer.js";
import {
  validateCircuitGraph as validateNewCircuitGraph,
  validateConnections as validateNewConnections,
  validateDiagramLayout as validateNewDiagramLayout
} from "./circuitDiagram/validator.js";
export { buildCircuitNetlist, parseEquationExpression, parseEquationToGateTree } from "./circuitDiagram/netlistBuilder.js";
export { buildCircuitLayout, buildCircuitLayoutFromResult } from "./circuitDiagram/layoutEngine.js";
export { renderCircuitLayoutSvg } from "./circuitDiagram/svgRenderer.js";
export { validateCircuitGraph } from "./circuitDiagram/validator.js";

const COLORS = {
  gate: "#111827",
  internal: "#475569",
  output: "#111827",
  input: "#0891b2",
  inputInverted: "#0f766e",
  feedback: ["#7c3aed", "#9333ea", "#6d28d9", "#8b5cf6"],
  feedbackInverted: ["#a855f7", "#c084fc", "#9333ea", "#b794f4"],
  clk: "#2563eb",
  const: "#374151",
  dot: "#111827"
};

const SIZES = {
  title: 26,
  subtitle: 16,
  net: 16,
  gate: 14,
  ffTitle: 18,
  ffPin: 15,
  ffState: 28,
  output: 22,
  note: 14,
  constant: 18
};

const BASE_LAYOUT_CONFIG = {
  verticalLaneSpacing: 18,
  horizontalLaneSpacing: 18,
  gateVerticalSpacing: 48,
  gateColumnSpacing: 140,
  wireLaneSpacing: 18,
  branchPointSpacing: 36,
  componentClearance: 20,
  flipFlopClearance: 28,
  canvasPadding: 80,
  canvasExtraWidth: 0,
  canvasExtraHeight: 0
};

const SVG_FONT = "Arial, Helvetica, sans-serif";

function html(value) {
  return escapeHtml(formatSubscriptLabel(value));
}

function point(x, y) {
  return { x: Math.round(x), y: Math.round(y) };
}

function normalizeLayoutConfig(config = {}) {
  const merged = { ...BASE_LAYOUT_CONFIG, ...config };
  const verticalLaneSpacing = merged.verticalLaneSpacing ?? merged.wireLaneSpacing;
  const horizontalLaneSpacing = merged.horizontalLaneSpacing ?? merged.wireLaneSpacing;
  const normalizedVerticalLaneSpacing = clamp(verticalLaneSpacing, 18, 96);
  const normalizedHorizontalLaneSpacing = clamp(horizontalLaneSpacing, 18, 96);
  const normalizedBranchPointSpacing = clamp(merged.branchPointSpacing, 32, 96);
  return {
    ...merged,
    gateVerticalSpacing: clamp(merged.gateVerticalSpacing, 48, 220),
    gateColumnSpacing: clamp(merged.gateColumnSpacing, 140, 300),
    verticalLaneSpacing: normalizedVerticalLaneSpacing,
    horizontalLaneSpacing: normalizedHorizontalLaneSpacing,
    wireLaneSpacing: Math.max(normalizedVerticalLaneSpacing, normalizedHorizontalLaneSpacing),
    branchPointSpacing: normalizedBranchPointSpacing,
    componentClearance: clamp(merged.componentClearance, 20, 32),
    flipFlopClearance: clamp(merged.flipFlopClearance, 28, 104)
  };
}

function layoutConfigSummary(config) {
  return `vertical lanes ${config.verticalLaneSpacing}px, horizontal lanes ${config.horizontalLaneSpacing}px, branch spacing ${config.branchPointSpacing}px, gate vertical ${config.gateVerticalSpacing}px, columns ${config.gateColumnSpacing}px, component clearance ${config.componentClearance}px, FF clearance ${config.flipFlopClearance}px`;
}

function estimateTextWidth(text, fontSize, weight = 400) {
  const factor = weight >= 700 ? 0.68 : 0.6;
  return Math.max(fontSize * 2.2, String(text).length * fontSize * factor);
}

function rectRight(rect) {
  return rect.x + rect.width;
}

function rectBottom(rect) {
  return rect.y + rect.height;
}

function inflateRect(rect, margin) {
  return {
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2
  };
}

function rectsOverlap(left, right) {
  return left.x < rectRight(right) && rectRight(left) > right.x && left.y < rectBottom(right) && rectBottom(left) > right.y;
}

function pointEquals(left, right) {
  return Boolean(left && right) && Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function segmentBounds(segment) {
  const [a, b] = segment;
  return {
    x1: Math.min(a.x, b.x),
    x2: Math.max(a.x, b.x),
    y1: Math.min(a.y, b.y),
    y2: Math.max(a.y, b.y),
    horizontal: a.y === b.y,
    vertical: a.x === b.x
  };
}

function wireSegments(wire) {
  const segments = [];
  for (let index = 0; index < wire.points.length - 1; index += 1) {
    const from = wire.points[index];
    const to = wire.points[index + 1];
    if (from.x !== to.x || from.y !== to.y) segments.push([from, to]);
  }
  return segments;
}

function segmentIntersectsRect(segment, rect) {
  const bounds = segmentBounds(segment);
  if (bounds.horizontal) {
    return bounds.y1 >= rect.y && bounds.y1 <= rectBottom(rect) && bounds.x2 >= rect.x && bounds.x1 <= rectRight(rect);
  }
  if (bounds.vertical) {
    return bounds.x1 >= rect.x && bounds.x1 <= rectRight(rect) && bounds.y2 >= rect.y && bounds.y1 <= rectBottom(rect);
  }
  return false;
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0;
}

function collinearOverlap(leftSegment, rightSegment) {
  const left = segmentBounds(leftSegment);
  const right = segmentBounds(rightSegment);
  if (left.horizontal && right.horizontal && left.y1 === right.y1) {
    return Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1) > 0;
  }
  if (left.vertical && right.vertical && left.x1 === right.x1) {
    return Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1) > 0;
  }
  return false;
}

function segmentOrientation(segment) {
  const bounds = segmentBounds(segment);
  if (bounds.horizontal) return "horizontal";
  if (bounds.vertical) return "vertical";
  return "diagonal";
}

function protectedRect(component) {
  return inflateRect(component.rect, component.margin || 0);
}

function addComponent(layout, component) {
  layout.components.push(component);
  return component;
}

function addWire(layout, wire) {
  const cleanPoints = wire.points.filter((item, index, list) => index === 0 || !pointEquals(item, list[index - 1]));
  if (cleanPoints.length >= 2) {
    const cleanWire = { ...wire, points: cleanPoints };
    layout.wires.push(cleanWire);
    return cleanWire;
  }
  return null;
}

function addDot(layout, x, y, color = COLORS.dot) {
  const dot = { x: Math.round(x), y: Math.round(y), color };
  const existing = layout.dots.find((item) => pointEquals(item, dot));
  if (existing) return existing;
  layout.dots.push(dot);
  return dot;
}

function makePin(component, name, x, y, role = "bidirectional") {
  const pin = { x: Math.round(x), y: Math.round(y), name, componentId: component.id, role };
  component.pins.push(pin);
  component.pinMap[name] = pin;
  return pin;
}

function allPins(layout) {
  return layout.components.flatMap((component) => component.pins.map((pin) => ({ ...pin, component })));
}

function endpointIsKnown(layout, endpoint) {
  return allPins(layout).some((pin) => pointEquals(pin, endpoint)) || layout.dots.some((dot) => pointEquals(dot, endpoint));
}

function wireEndpointConnected(layout, pin) {
  return layout.wires.some((wire) => {
    const first = wire.points[0];
    const last = wire.points[wire.points.length - 1];
    return pointEquals(first, pin) || pointEquals(last, pin);
  });
}

function wireStartsAtPin(layout, pin) {
  return layout.wires.some((wire) => pointEquals(wire.points[0], pin));
}

function wireEndsAtPin(layout, pin) {
  return layout.wires.some((wire) => pointEquals(wire.points[wire.points.length - 1], pin));
}

function segmentTouchesComponentPin(segment, component) {
  return component.pins.some((pin) => pointEquals(segment[0], pin) || pointEquals(segment[1], pin));
}

function isAllowedWireComponentContact(segment, component) {
  if (segmentTouchesComponentPin(segment, component)) return true;
  return false;
}

function pathIntersections(layout, points) {
  const intersections = [];
  wireSegments({ points }).forEach((segment) => {
    layout.components.forEach((component) => {
      if (component.hidden) return;
      if (!segmentIntersectsRect(segment, protectedRect(component))) return;
      if (isAllowedWireComponentContact(segment, component)) return;
      intersections.push({ segment, component });
    });
  });
  return intersections;
}

function pathIsClear(layout, points) {
  return pathIntersections(layout, points).length === 0;
}

function pathOverlapsExistingWire(layout, points, net) {
  const candidateSegments = wireSegments({ points });
  return layout.wires.some((wire) => {
    if (wire.net === net) return false;
    return candidateSegments.some((candidateSegment) =>
      wireSegments(wire).some((existingSegment) => collinearOverlap(candidateSegment, existingSegment))
    );
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function addAutoFix(layout, message) {
  if (!layout.meta.autoFixes.includes(message)) layout.meta.autoFixes.push(message);
}

function validationError(type, message) {
  return `${type}: ${message}`;
}

function validationIssue(type, message, metadata = {}) {
  return { type, message, ...metadata };
}

function validationType(error) {
  const match = String(error).match(/^([A-Z_]+):/);
  return match?.[1] || "UNCLASSIFIED_LAYOUT_ERROR";
}

function componentFamily(component) {
  if (component.type === "ff") return "ff";
  if (component.type === "label" || component.type === "pin" || component.type === "output") return "label";
  if (component.type === "and" || component.type === "or" || component.type === "not" || component.type === "constant") return "gate";
  return "component";
}

function componentOverlapType(left, right) {
  const families = [componentFamily(left), componentFamily(right)];
  if (families.includes("label")) return "LABEL_OVERLAP";
  if (families.includes("ff") && families.includes("gate")) return "GATE_FF_COLLISION";
  if (families[0] === "gate" && families[1] === "gate") return "GATE_GATE_COLLISION";
  if (families[0] === "ff" && families[1] === "ff") return "GATE_FF_COLLISION";
  return "COMPONENT_OVERLAP";
}

function wireComponentCollisionType(component) {
  if (component.type === "ff") return "WIRE_FF_COLLISION";
  if (component.type === "label" || component.type === "pin" || component.type === "output") return "LABEL_OVERLAP";
  return "WIRE_GATE_COLLISION";
}

function route(layout, id, net, points, color = null, width = 2.4) {
  return addWire(layout, {
    id,
    net,
    color: color || colorForNet(layout, net),
    width,
    points
  });
}

function colorForNet(layout, net) {
  if (net === "CLK") return COLORS.clk;
  if (net.startsWith("OUT:")) return COLORS.output;
  if (net.startsWith("CONST:")) return COLORS.const;
  if (net.startsWith("INT:")) return COLORS.internal;
  if (net.startsWith("IN:") && net.endsWith("'")) return COLORS.inputInverted;
  if (net.startsWith("IN:")) return COLORS.input;
  if (net.startsWith("FB:")) {
    const raw = net.slice(3);
    const inverted = raw.endsWith("'");
    const variable = inverted ? raw.slice(0, -1) : raw;
    const index = Number(variable.replace(/^Q/, "")) || 0;
    const palette = inverted ? COLORS.feedbackInverted : COLORS.feedback;
    return palette[index % palette.length];
  }
  return layout?.netColors?.get(net) || COLORS.internal;
}

function makeLabel(layout, id, text, x, baselineY, fontSize, options = {}) {
  const width = options.width ?? estimateTextWidth(text, fontSize, options.weight || 400);
  const height = options.height ?? fontSize * 1.35;
  addComponent(layout, {
    id,
    type: "label",
    rect: {
      x,
      y: baselineY - height + 3,
      width,
      height
    },
    margin: options.margin ?? 8,
    pins: [],
    pinMap: {},
    text,
    fontSize,
    weight: options.weight || 400,
    fill: options.fill || "#334155",
    render: options.render !== false
  });
}

function makeExternalPin(layout, id, text, x, y, role = "source", color = COLORS.input) {
  const isTarget = role === "target";
  const fontSize = isTarget ? SIZES.output : SIZES.net;
  const textWidth = text ? estimateTextWidth(text, fontSize, isTarget ? 700 : 600) : 18;
  const rect = isTarget
    ? { x: x - 10, y: y - 26, width: textWidth + 88, height: 52 }
    : { x: x - textWidth - 28, y: y - 25, width: textWidth + 38, height: 50 };
  const component = addComponent(layout, {
    id,
    type: isTarget ? "output" : "pin",
    rect,
    margin: 8,
    pins: [],
    pinMap: {},
    text,
    color
  });
  makePin(component, isTarget ? "in" : "out", x, y, role);
  return component.pinMap[isTarget ? "in" : "out"];
}

function makeBusTerminator(layout, id, x, y, net) {
  const component = addComponent(layout, {
    id,
    type: "bus-end",
    rect: { x: x - 4, y: y - 4, width: 8, height: 8 },
    margin: 0,
    pins: [],
    pinMap: {},
    hidden: true
  });
  makePin(component, "in", x, y, "target");
  addDot(layout, x, y, colorForNet(layout, net));
  return component.pinMap.in;
}

function makeConstant(layout, id, value, x, y) {
  const component = addComponent(layout, {
    id,
    type: "constant",
    rect: { x: x - 50, y: y - 44, width: 76, height: 88 },
    margin: 14,
    pins: [],
    pinMap: {},
    value,
    color: COLORS.const
  });
  makePin(component, "out", x + 22, y, "source");
  return component.pinMap.out;
}

function makeNot(layout, id, x, y) {
  const component = addComponent(layout, {
    id,
    type: "not",
    rect: { x, y: y - 25, width: 70, height: 50 },
    margin: layout.config?.componentClearance || 18,
    pins: [],
    pinMap: {}
  });
  makePin(component, "in", x, y, "input");
  makePin(component, "out", x + 70, y, "output");
  return component;
}

function makeAnd(layout, id, x, y) {
  const component = addComponent(layout, {
    id,
    type: "and",
    rect: { x, y: y - 30, width: 82, height: 60 },
    margin: layout.config?.componentClearance || 18,
    pins: [],
    pinMap: {},
    inputPins: [],
    expectedInputs: 2
  });
  component.inputPins.push(makePin(component, "in0", x, y - 17, "input"));
  component.inputPins.push(makePin(component, "in1", x, y + 17, "input"));
  makePin(component, "out", x + 82, y, "output");
  return component;
}

function makeOr(layout, id, x, y) {
  const component = addComponent(layout, {
    id,
    type: "or",
    rect: { x, y: y - 32, width: 92, height: 64 },
    margin: layout.config?.componentClearance || 18,
    pins: [],
    pinMap: {},
    inputPins: [],
    expectedInputs: 2
  });
  component.inputPins.push(makePin(component, "in0", x, y - 18, "input"));
  component.inputPins.push(makePin(component, "in1", x, y + 18, "input"));
  makePin(component, "out", x + 92, y, "output");
  return component;
}

function ffInputPins(flipFlopType, suffix) {
  if (flipFlopType === "JK") return [`J${suffix}`, `K${suffix}`];
  if (flipFlopType === "T") return [`T${suffix}`];
  return [`D${suffix}`];
}

function makeFlipFlop(layout, stateVariable, flipFlopType, x, y, width, height) {
  const suffix = stateVariable.slice(1);
  const inputs = ffInputPins(flipFlopType, suffix);
  const component = addComponent(layout, {
    id: `ff-${stateVariable}`,
    type: "ff",
    rect: { x, y, width, height },
    margin: layout.config?.flipFlopClearance || 28,
    pins: [],
    pinMap: {},
    stateVariable,
    flipFlopType,
    inputLabels: inputs
  });

  if (flipFlopType === "JK") {
    makePin(component, inputs[0], x, y + 46, "input");
    makePin(component, "J", x, y + 46, "input");
    makePin(component, inputs[1], x, y + height - 46, "input");
    makePin(component, "K", x, y + height - 46, "input");
    makePin(component, "CLK", x, y + Math.round(height / 2), "input");
  } else {
    const inputName = inputs[0];
    makePin(component, inputName, x, y + 50, "input");
    makePin(component, flipFlopType, x, y + 50, "input");
    makePin(component, "CLK", x, y + height - 48, "input");
  }

  makePin(component, "Q", x + width, y + 50, "output");
  makePin(component, "QN", x + width, y + height - 50, "output");
  return component;
}

function gatherLiteralNeeds(result, inputVariables) {
  const needs = {
    inputDirect: new Set(),
    inputInverted: new Set(),
    stateDirect: new Set(),
    stateInverted: new Set()
  };
  [...result.equations, ...result.outputEquations].forEach((equation) => {
    parseSopExpression(equation.equation, equation.variables).forEach((term) => {
      term.factors.forEach((factor) => {
        if (inputVariables.includes(factor.variable)) {
          if (factor.inverted) needs.inputInverted.add(factor.variable);
          else needs.inputDirect.add(factor.variable);
        } else if (factor.inverted) {
          needs.stateInverted.add(factor.variable);
        } else {
          needs.stateDirect.add(factor.variable);
        }
      });
    });
  });
  inputVariables.forEach((variable) => needs.inputDirect.add(variable));
  result.encodingInfo.stateVariables.forEach((variable) => {
    needs.stateDirect.add(variable);
    needs.stateInverted.add(variable);
  });
  return needs;
}

function createInputBuses(layout, inputVariables, needs, settings) {
  const buses = new Map();
  inputVariables.forEach((variable, index) => {
    const y = settings.inputBusY + index * settings.inputBusGap;
    const net = `IN:${variable}`;
    const source = makeExternalPin(layout, `input-${variable}`, variable, settings.inputSourceX, y, "source", colorForNet(layout, net));
    const end = makeBusTerminator(layout, `input-${variable}-bus-end`, settings.busRightX, y, net);
    route(layout, `input-${variable}-bus`, net, [source, end], colorForNet(layout, net), 3);
    makeLabel(layout, `input-${variable}-bus-label`, `${variable} bus`, settings.inputSourceX + 34, y - 15, SIZES.net, {
      weight: 700,
      fill: colorForNet(layout, net),
      margin: 5
    });
    buses.set(net, { net, y, leftX: settings.inputSourceX, rightX: settings.busRightX });

    if (needs.inputInverted.has(variable)) {
      const notY = y + settings.inputBusGap;
      const notGate = makeNot(layout, `input-${variable}-not`, settings.inputNotX, notY);
      const tap = addDot(layout, settings.inputNotX - 46, y, colorForNet(layout, net));
      registerBranchPoint(layout, net, y, tap.x, `input-${variable}-not-feed`);
      route(
        layout,
        `input-${variable}-not-feed`,
        net,
        [tap, point(tap.x, notGate.pinMap.in.y), notGate.pinMap.in],
        colorForNet(layout, net),
        2.4
      );
      const invertedNet = `IN:${variable}'`;
      const invertedEnd = makeBusTerminator(layout, `input-${variable}-inverted-bus-end`, settings.busRightX, notY, invertedNet);
      route(layout, `input-${variable}-inverted-bus`, invertedNet, [notGate.pinMap.out, invertedEnd], colorForNet(layout, invertedNet), 3);
      makeLabel(layout, `input-${variable}-inverted-bus-label`, `${variable}' bus`, 26, notY - 15, SIZES.net, {
        weight: 700,
        fill: colorForNet(layout, invertedNet),
        margin: 5
      });
      buses.set(invertedNet, { net: invertedNet, y: notY, leftX: notGate.pinMap.out.x, rightX: settings.busRightX });
    }
  });
  return buses;
}

function createFeedbackBuses(layout, ffMap, stateVariables, settings) {
  const buses = new Map();
  stateVariables.forEach((variable, index) => {
    const ff = ffMap.get(variable);
    const directNet = `FB:${variable}`;
    const invertedNet = `FB:${variable}'`;
    const directY = settings.feedbackBaseY + index * settings.feedbackBusGap;
    const invertedY = directY + settings.feedbackPairGap;
    const directPullX = ff.pinMap.Q.x + settings.feedbackPulloutGap + index * 10;
    const invertedPullX = ff.pinMap.QN.x + settings.feedbackPulloutGap + index * 10 + 18;
    const directLeft = addDot(layout, settings.feedbackLeftX, directY, colorForNet(layout, directNet));
    const invertedLeft = addDot(layout, settings.feedbackLeftX, invertedY, colorForNet(layout, invertedNet));
    const directPull = addDot(layout, directPullX, directY, colorForNet(layout, directNet));
    const invertedPull = addDot(layout, invertedPullX, invertedY, colorForNet(layout, invertedNet));
    const directRight = makeBusTerminator(layout, `feedback-${variable}-right-end`, settings.busRightX, directY, directNet);
    const invertedRight = makeBusTerminator(layout, `feedback-${variable}-n-right-end`, settings.busRightX, invertedY, invertedNet);

    route(layout, `feedback-${variable}`, directNet, [directLeft, directRight], colorForNet(layout, directNet), 3);
    route(layout, `feedback-${variable}-stub`, directNet, [ff.pinMap.Q, point(directPullX, ff.pinMap.Q.y), directPull], colorForNet(layout, directNet), 3);
    route(
      layout,
      `feedback-${variable}-n`,
      invertedNet,
      [invertedLeft, invertedRight],
      colorForNet(layout, invertedNet),
      3
    );
    route(
      layout,
      `feedback-${variable}-n-stub`,
      invertedNet,
      [ff.pinMap.QN, point(invertedPullX, ff.pinMap.QN.y), invertedPull],
      colorForNet(layout, invertedNet),
      3
    );

    makeLabel(layout, `feedback-${variable}-label`, `${variable} feedback`, 26, directY - 12, SIZES.net, {
      weight: 700,
      fill: colorForNet(layout, directNet),
      margin: 5
    });
    makeLabel(layout, `feedback-${variable}-n-label`, `${variable}' feedback`, 26, invertedY - 12, SIZES.net, {
      weight: 700,
      fill: colorForNet(layout, invertedNet),
      margin: 5
    });
    buses.set(directNet, { net: directNet, y: directY, leftX: settings.feedbackLeftX, rightX: settings.busRightX });
    buses.set(invertedNet, { net: invertedNet, y: invertedY, leftX: settings.feedbackLeftX, rightX: settings.busRightX });
  });
  return buses;
}

function literalNet(factor, inputVariables) {
  if (inputVariables.includes(factor.variable)) return `IN:${factor.variable}${factor.inverted ? "'" : ""}`;
  return `FB:${factor.variable}${factor.inverted ? "'" : ""}`;
}

function branchKey(net, busY) {
  return `${net}@${Math.round(busY)}`;
}

function branchBusName(net) {
  if (net === "CLK") return "CLK bus";
  if (net.startsWith("IN:")) return `${net.slice(3)} bus`;
  if (net.startsWith("FB:")) return `${net.slice(3)} feedback bus`;
  return `${net} bus`;
}

function branchSpacing(layout) {
  return layout.config?.branchPointSpacing || BASE_LAYOUT_CONFIG.branchPointSpacing;
}

function branchPointIsSeparated(layout, net, busY, tapX, id) {
  const minimum = branchSpacing(layout);
  return (layout.branchPoints || [])
    .filter((item) => item.key === branchKey(net, busY) && item.id !== id)
    .every((item) => Math.abs(item.x - Math.round(tapX)) >= minimum);
}

function registerBranchPoint(layout, net, busY, tapX, id) {
  if (!layout.branchPoints) layout.branchPoints = [];
  const roundedX = Math.round(tapX);
  const roundedY = Math.round(busY);
  const branchPoint = {
    id,
    net,
    busName: branchBusName(net),
    x: roundedX,
    y: roundedY,
    key: branchKey(net, busY)
  };
  layout.branchPoints.push(branchPoint);
  return branchPoint;
}

function candidateBranchLanes(layout, preferredX, minX, maxX, startY, targetY) {
  const laneSpacing = layout.config?.horizontalLaneSpacing || BASE_LAYOUT_CONFIG.horizontalLaneSpacing;
  const tapSpacing = branchSpacing(layout);
  const spacing = Math.max(laneSpacing, tapSpacing);
  const clearance = layout.config?.componentClearance || BASE_LAYOUT_CONFIG.componentClearance;
  const candidates = new Set([clamp(preferredX, minX, maxX)]);
  const y1 = Math.min(startY, targetY);
  const y2 = Math.max(startY, targetY);

  layout.components.forEach((component) => {
    if (component.hidden) return;
    const rect = protectedRect(component);
    if (preferredX >= rect.x && preferredX <= rectRight(rect) && rangesOverlap(y1, y2, rect.y, rectBottom(rect))) {
      candidates.add(clamp(rect.x - clearance - spacing, minX, maxX));
      candidates.add(clamp(rectRight(rect) + clearance + spacing, minX, maxX));
    }
  });

  [1, 2, 3, 4, 6, 8, 11, 14, 18, 24].forEach((multiplier) => {
    const offset = spacing * multiplier;
    candidates.add(clamp(preferredX - offset, minX, maxX));
    candidates.add(clamp(preferredX + offset, minX, maxX));
  });

  return [...candidates].sort((left, right) => Math.abs(left - preferredX) - Math.abs(right - preferredX));
}

function routeBranchCandidate(layout, net, busY, targetPin, tapX) {
  return [point(tapX, busY), point(tapX, targetPin.y), targetPin];
}

function branchFromBus(layout, net, bus, targetPin, id, laneX) {
  const minX = bus.leftX + 24;
  const maxX = Math.max(minX, Math.min(bus.rightX - 24, targetPin.x - 24));
  const preferredTapX = clamp(laneX, minX, maxX);
  const preferredPath = routeBranchCandidate(layout, net, bus.y, targetPin, preferredTapX);
  const preferredBlockers = pathIntersections(layout, preferredPath).map((item) => item.component.id);
  const candidates = candidateBranchLanes(layout, preferredTapX, minX, maxX, bus.y, targetPin.y);
  let clearButCrowded = null;

  for (const tapX of candidates) {
    const points = routeBranchCandidate(layout, net, bus.y, targetPin, tapX);
    if (!pathIsClear(layout, points)) continue;
    if (pathOverlapsExistingWire(layout, points, net)) continue;
    if (!branchPointIsSeparated(layout, net, bus.y, tapX, id)) {
      if (!clearButCrowded) clearButCrowded = { tapX, points };
      continue;
    }
    const tap = addDot(layout, tapX, bus.y, colorForNet(layout, net));
    if (tapX !== preferredTapX && preferredBlockers.length) {
      addAutoFix(layout, `rerouted wire ${id} around ${[...new Set(preferredBlockers)].join(", ")}`);
    }
    if (tapX !== preferredTapX) {
      addAutoFix(layout, `moved branch point for ${id} on ${branchBusName(net)} to x=${Math.round(tapX)}`);
    }
    registerBranchPoint(layout, net, bus.y, tapX, id);
    return route(layout, id, net, [tap, ...points.slice(1)], colorForNet(layout, net), 2.4);
  }

  if (clearButCrowded) {
    const tap = addDot(layout, clearButCrowded.tapX, bus.y, colorForNet(layout, net));
    registerBranchPoint(layout, net, bus.y, clearButCrowded.tapX, id);
    addAutoFix(layout, `used closest clear tap for ${id}; validation may request wider ${branchBusName(net)} branch spacing`);
    return route(layout, id, net, [tap, ...clearButCrowded.points.slice(1)], colorForNet(layout, net), 2.4);
  }

  const fallbackTapX = candidates.find((candidate) => branchPointIsSeparated(layout, net, bus.y, candidate, id)) ?? preferredTapX;
  const clearY = Math.max(96, Math.min(bus.y, targetPin.y) - 46);
  const fallbackPoints = [point(fallbackTapX, bus.y), point(fallbackTapX, clearY), point(maxX, clearY), point(maxX, targetPin.y), targetPin];
  const tap = addDot(layout, fallbackTapX, bus.y, colorForNet(layout, net));
  registerBranchPoint(layout, net, bus.y, fallbackTapX, id);
  addAutoFix(layout, `attempted detour for wire ${id} around ${[...new Set(preferredBlockers)].join(", ") || "protected components"}`);
  return route(layout, id, net, [tap, ...fallbackPoints.slice(1)], colorForNet(layout, net), 2.4);
}

function connectSignalToPin(layout, signal, targetPin, context, inputIndex = 0) {
  if (signal.kind === "literal") {
    const bus = context.buses.get(signal.net);
    const laneX = context.reserveSourceLane(targetPin.x, inputIndex, context.termIndex || 0);
    branchFromBus(layout, signal.net, bus, targetPin, `${context.idPrefix}-${signal.id}-to-${targetPin.componentId}-${targetPin.name}`, laneX);
    return;
  }
  if (signal.kind === "constant") {
    const viaX = Math.round((signal.pin.x + targetPin.x) / 2);
    route(
      layout,
      `${context.idPrefix}-${signal.id}-const-to-${targetPin.componentId}-${targetPin.name}`,
      signal.net,
      [signal.pin, point(viaX, signal.pin.y), point(viaX, targetPin.y), targetPin],
      colorForNet(layout, signal.net),
      2.4
    );
    return;
  }
  const viaX = Math.round((signal.pin.x + targetPin.x) / 2);
  route(
    layout,
    `${context.idPrefix}-${signal.id}-to-${targetPin.componentId}-${targetPin.name}`,
    signal.net,
    [signal.pin, point(viaX, signal.pin.y), point(viaX, targetPin.y), targetPin],
    colorForNet(layout, signal.net),
    2.4
  );
}

function factorOffsets(count, spacing) {
  if (count <= 1) return [0];
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => Math.round((index - center) * spacing));
}

function buildStageColumns(startX, gap, count = 6) {
  return Array.from({ length: count }, (_, index) => Math.round(startX + index * gap));
}

function gateStageKey(context, gateType, level) {
  const prefix = context.stageKeyPrefix || context.idPrefix || "logic";
  return `${prefix}:${gateType}:stage-${level}`;
}

function stageColumn(context, gateType, level) {
  const columns = context.stageColumns?.[gateType];
  if (columns && Number.isFinite(columns[level])) return columns[level];
  return Math.round(context.gateStartX + level * context.stageGap);
}

function makeLiteralSignals(term, equation, inputVariables, centerY, context) {
  const offsets = factorOffsets(term.factors.length, context.literalGap);
  return term.factors.map((factor, index) => {
    const net = literalNet(factor, inputVariables);
    return {
      kind: "literal",
      id: `${equation.id}-term-${context.termIndex}-literal-${index}`,
      net,
      y: centerY + offsets[index]
    };
  });
}

function buildBinaryTree(layout, signals, makeGate, gateType, context) {
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
      const gateY = Math.round((left.y + right.y) / 2);
      const gateX = stageColumn(context, gateType, level);
      const gate = makeGate(layout, `${context.idPrefix}-${gateType}-l${level}-g${Math.floor(index / 2)}`, gateX, gateY);
      gate.stage = level;
      gate.stageKey = gateStageKey(context, gateType, level);
      gate.inputGroup = context.inputGroup || gate.stageKey;
      gate.logicKind = gateType;
      connectSignalToPin(layout, left, gate.inputPins[0], context, index + level * 4);
      connectSignalToPin(layout, right, gate.inputPins[1], context, index + 1 + level * 4);
      next.push({
        kind: "intermediate",
        id: gate.id,
        net: `INT:${gate.id}`,
        pin: gate.pinMap.out,
        y: gate.pinMap.out.y
      });
    }
    current = next;
    level += 1;
  }
  return current[0];
}

function serializePin(pin) {
  if (!pin) return null;
  return {
    x: pin.x,
    y: pin.y,
    name: pin.name,
    componentId: pin.componentId
  };
}

function recordTargetConnection(layout, context, wire, signal, targetPin) {
  if (!context.equationTarget || !wire) return;
  layout.targetConnections.push({
    equationId: context.equationTarget.equationId,
    targetLabel: context.equationTarget.targetLabel,
    targetPin: serializePin(targetPin),
    sourcePin: serializePin(signal.pin),
    wireId: wire.id,
    net: wire.net
  });
}

function connectToTarget(layout, signal, targetPin, context) {
  if (signal.kind === "literal") {
    const bus = context.buses.get(signal.net);
    const wire = branchFromBus(layout, signal.net, bus, targetPin, `${context.idPrefix}-${signal.id}-direct-to-target`, context.targetLaneX);
    recordTargetConnection(layout, context, wire, signal, targetPin);
    return;
  }
  if (signal.net.startsWith("CONST:") && context.constantDirect) {
    const wire = route(
      layout,
      `${context.idPrefix}-${signal.id}-to-target`,
      signal.net,
      [signal.pin, targetPin],
      colorForNet(layout, signal.net),
      2.4
    );
    recordTargetConnection(layout, context, wire, signal, targetPin);
    return;
  }
  if (context.escapeY) {
    const launchX = Math.max(signal.pin.x + 34, context.logicExitX);
    const viaX = context.targetLaneX;
    const wire = route(
      layout,
      `${context.idPrefix}-${signal.id}-to-target`,
      signal.net,
      [
        signal.pin,
        point(launchX, signal.pin.y),
        point(launchX, context.escapeY),
        point(viaX, context.escapeY),
        point(viaX, targetPin.y),
        targetPin
      ],
      colorForNet(layout, signal.net),
      signal.net.startsWith("OUT:") ? 2.8 : 2.4
    );
    recordTargetConnection(layout, context, wire, signal, targetPin);
    return;
  }
  const viaX = context.targetLaneX;
  const safeViaX = Math.max(viaX, signal.pin.x + (layout.config?.componentClearance || BASE_LAYOUT_CONFIG.componentClearance) + (layout.config?.horizontalLaneSpacing || BASE_LAYOUT_CONFIG.horizontalLaneSpacing));
  if (signal.pin.y === targetPin.y) {
    const wire = route(
      layout,
      `${context.idPrefix}-${signal.id}-to-target`,
      signal.net,
      [signal.pin, targetPin],
      colorForNet(layout, signal.net),
      signal.net.startsWith("OUT:") ? 2.8 : 2.4
    );
    recordTargetConnection(layout, context, wire, signal, targetPin);
    return;
  }
  const wire = route(
    layout,
    `${context.idPrefix}-${signal.id}-to-target`,
    signal.net,
    [signal.pin, point(safeViaX, signal.pin.y), point(safeViaX, targetPin.y), targetPin],
    colorForNet(layout, signal.net),
    signal.net.startsWith("OUT:") ? 2.8 : 2.4
  );
  recordTargetConnection(layout, context, wire, signal, targetPin);
}

function renderEquationNetwork(layout, equation, targetPin, baseContext) {
  const terms = parseSopExpression(equation.equation, equation.variables);
  const context = {
    ...baseContext,
    idPrefix: `eq-${equation.id.replace(/[^A-Za-z0-9]/g, "-")}`,
    equationTarget: {
      equationId: equation.id,
      targetLabel: equation.isOutput ? equation.output : equation.input
    }
  };
  if (equation.equation === "0" || equation.equation === "1") {
    const source = makeConstant(
      layout,
      `${context.idPrefix}-const-${equation.equation}`,
      equation.equation,
      context.constantX ?? context.sourceX,
      targetPin.y
    );
    connectToTarget(
      layout,
      { kind: "intermediate", id: `const-${equation.equation}`, net: `CONST:${equation.equation}`, pin: source, y: source.y },
      targetPin,
      context
    );
    return;
  }

  const termOffsets = factorOffsets(terms.length, context.termGap);
  const termSignals = terms.map((term, termIndex) => {
    const termY = context.rowY + termOffsets[termIndex];
    const termContext = {
      ...context,
      idPrefix: `${context.idPrefix}-t${termIndex}`,
      termIndex,
      gateStartX: context.andStartX,
      stageGap: context.andStageGap
    };
    if (term.label === "1") {
      const source = makeConstant(layout, `${context.idPrefix}-term-${termIndex}-const`, "1", context.sourceX, termY);
      return { kind: "intermediate", id: `term-${termIndex}-const`, net: "CONST:1", pin: source, y: source.y };
    }
    const literalSignals = makeLiteralSignals(term, equation, context.inputVariables, termY, termContext);
    return buildBinaryTree(layout, literalSignals, makeAnd, "and", termContext);
  });

  const outputSignal =
    termSignals.length > 1
      ? buildBinaryTree(
          layout,
          termSignals,
          makeOr,
          "or",
          {
            ...context,
            gateStartX: context.orStartX,
            stageGap: context.orStageGap
          }
        )
      : termSignals[0];

  connectToTarget(layout, outputSignal, targetPin, context);
}

function makeOutputTarget(layout, variable, x, y) {
  const pin = makeExternalPin(layout, `output-${variable}`, variable, x, y, "target", COLORS.output);
  return pin;
}

function connectClock(layout, ffComponents, settings) {
  const source = makeExternalPin(layout, "clk-source", "CLK", settings.clkSourceX, settings.clkY, "source", COLORS.clk);
  const end = makeBusTerminator(layout, "clk-bus-end", settings.clkRightX, settings.clkY, "CLK");
  route(layout, "clk-main-bus", "CLK", [source, end], COLORS.clk, 3.2);
  makeLabel(layout, "clk-bus-label", "CLK bus", settings.clkSourceX + 34, settings.clkY - 14, SIZES.net, {
    weight: 700,
    fill: COLORS.clk,
    margin: 5
  });
  ffComponents.forEach((ff, index) => {
    const ffProtected = protectedRect(ff);
    const laneSpacing = Math.max(layout.config?.horizontalLaneSpacing || BASE_LAYOUT_CONFIG.horizontalLaneSpacing, branchSpacing(layout));
    const branchX = Math.round(ffProtected.x - laneSpacing - index * Math.max(12, Math.round(laneSpacing / 3)));
    const tap = addDot(layout, branchX, settings.clkY, COLORS.clk);
    registerBranchPoint(layout, "CLK", settings.clkY, branchX, `clk-branch-${ff.stateVariable}`);
    route(layout, `clk-branch-${ff.stateVariable}`, "CLK", [tap, point(branchX, ff.pinMap.CLK.y), ff.pinMap.CLK], COLORS.clk, 2.8);
  });
}

function addOutputStubs(layout, ffComponents) {
  ffComponents.forEach((ff) => {
    const qNet = `FB:${ff.stateVariable}`;
    const qnNet = `FB:${ff.stateVariable}'`;
    makeLabel(layout, `${ff.id}-q-pin-label`, ff.stateVariable, ff.pinMap.Q.x + 12, ff.pinMap.Q.y - 11, SIZES.net, {
      weight: 700,
      fill: colorForNet(layout, qNet),
      margin: 4
    });
    makeLabel(layout, `${ff.id}-qn-pin-label`, `${ff.stateVariable}'`, ff.pinMap.QN.x + 12, ff.pinMap.QN.y - 11, SIZES.net, {
      weight: 700,
      fill: colorForNet(layout, qnNet),
      margin: 4
    });
  });
}

function targetPinForEquation(equation, ffMap, outputTargets) {
  if (equation.isOutput) return outputTargets.get(equation.output);
  const suffix = equation.input.replace(/^[A-Z]+/, "");
  const ff = ffMap.get(`Q${suffix}`);
  return ff.pinMap[equation.input];
}

function buildLayout({ result, modelType, flipFlopType, inputVariables, outputVariables, attempt, config: rawConfig = {} }) {
  const config = normalizeLayoutConfig(rawConfig);
  const stateVariables = result.encodingInfo.stateVariables;
  const ffWidth = 204 + Math.round(config.flipFlopClearance * 0.8);
  const ffHeight = (flipFlopType === "JK" ? 184 : 176) + Math.round(config.flipFlopClearance * 0.35);
  const leftX = 88;
  const logicLeftX = 350 + config.canvasPadding + Math.round(config.gateColumnSpacing * 0.25);
  const ffStartX = logicLeftX + config.gateColumnSpacing * 5 + config.componentClearance * 4 + config.canvasExtraWidth;
  const ffGap = 300 + Math.round(config.gateColumnSpacing * 0.55) + config.flipFlopClearance * 2;
  const ffY = 410 + Math.round(config.gateVerticalSpacing * 0.45);
  const lastFfX = ffStartX + Math.max(0, stateVariables.length - 1) * ffGap;
  const outputLogicX = lastFfX + ffWidth + config.gateColumnSpacing + config.componentClearance * 4;
  const outputX = outputLogicX + config.gateColumnSpacing * 4 + config.canvasPadding;
  const busRightX = outputX + config.canvasPadding + 40;
  const feedbackBaseY = ffY + ffHeight + config.flipFlopClearance * 3 + config.verticalLaneSpacing * 3;
  const feedbackBusGap = 62 + config.verticalLaneSpacing + Math.round(config.gateVerticalSpacing * 0.35);
  const feedbackPairGap = 32 + Math.round(config.verticalLaneSpacing * 0.65);
  const bottomOfFeedback = feedbackBaseY + Math.max(1, stateVariables.length) * feedbackBusGap + 40;
  const outputRowsHeight = Math.max(1, outputVariables.length) * 120;
  const clkY = Math.max(bottomOfFeedback + config.canvasPadding + 25, ffY + ffHeight + 220 + config.flipFlopClearance);
  const width = Math.max(1500 + config.canvasExtraWidth, busRightX + config.canvasPadding);
  const height = Math.max(850 + config.canvasExtraHeight, clkY + config.canvasPadding + outputRowsHeight);

  const layout = {
    width,
    height,
    components: [],
    wires: [],
    dots: [],
    branchPoints: [],
    targetConnections: [],
    netColors: new Map(),
    config,
    meta: {
      modelType,
      flipFlopType,
      attempt,
      xBusCount: 0,
      xInverterCount: 0,
      feedbackNets: [],
      clkBranchCount: 0,
      autoFixes: []
    }
  };

  makeLabel(layout, "diagram-title-label", "Sequential Circuit Diagram", 26, 42, SIZES.title, {
    weight: 700,
    fill: "#111827",
    margin: 8
  });
  makeLabel(
    layout,
    "diagram-subtitle-label",
    `${modelType} Model, ${flipFlopType} Flip-Flop, color-coded validated gate-level schematic`,
    26,
    82,
    SIZES.subtitle,
    fillSubtitle()
  );

  const needs = gatherLiteralNeeds(result, inputVariables);
  const settings = {
    inputSourceX: leftX,
    inputNotX: leftX + config.canvasPadding + config.componentClearance,
    inputBusY: 146,
    inputBusGap: 56 + config.verticalLaneSpacing,
    busRightX,
    feedbackBaseY,
    feedbackBusGap,
    feedbackPairGap,
    feedbackLeftX: 150,
    feedbackPulloutGap: 60 + config.flipFlopClearance,
    clkSourceX: leftX,
    clkRightX: lastFfX + ffWidth + 120,
    clkY
  };

  const inputBuses = createInputBuses(layout, inputVariables, needs, settings);

  const ffMap = new Map();
  stateVariables.forEach((stateVariable, index) => {
    const ff = makeFlipFlop(layout, stateVariable, flipFlopType, ffStartX + index * ffGap, ffY, ffWidth, ffHeight);
    ffMap.set(stateVariable, ff);
  });

  const feedbackBuses = createFeedbackBuses(layout, ffMap, stateVariables, settings);
  const buses = new Map([...inputBuses, ...feedbackBuses]);

  const outputTargets = new Map();
  outputVariables.forEach((variable, index) => {
    outputTargets.set(variable, makeOutputTarget(layout, variable, outputX, ffY + 48 + index * 120));
  });

  const ffStageColumns = {
    and: buildStageColumns(logicLeftX, config.gateColumnSpacing + 36),
    or: buildStageColumns(logicLeftX + config.gateColumnSpacing * 3 + config.componentClearance * 2, config.gateColumnSpacing + 40)
  };
  const outputStageColumns = {
    and: buildStageColumns(outputLogicX, config.gateColumnSpacing + 36),
    or: buildStageColumns(outputLogicX + config.gateColumnSpacing * 3, config.gateColumnSpacing + 40)
  };
  const inputLogicRowBaseY = Math.round(340 + config.verticalLaneSpacing * 1.4 + config.gateVerticalSpacing * 0.4);
  const sourceLaneSpacing = Math.max(config.horizontalLaneSpacing, config.branchPointSpacing);

  result.equations.forEach((equation, index) => {
    const target = targetPinForEquation(equation, ffMap, outputTargets);
    const targetFf = ffMap.get(`Q${equation.input.replace(/^[A-Z]+/, "")}`);
    const targetSuffix = Number(equation.input.replace(/^[A-Z]+/, "")) || 0;
    const previousFf = targetSuffix > 0 ? ffMap.get(`Q${targetSuffix - 1}`) : null;
    const targetProtected = protectedRect(targetFf);
    const targetApproachX = targetProtected.x - config.componentClearance - sourceLaneSpacing * Math.max(1, index + 1);
    const previousProtected = previousFf ? protectedRect(previousFf) : null;
    const betweenFlipFlopLaneX = previousProtected
      ? Math.round((rectRight(previousProtected) + targetProtected.x) / 2)
      : targetApproachX;
    const targetLaneX = previousFf && rectRight(previousProtected) + sourceLaneSpacing < targetProtected.x
      ? betweenFlipFlopLaneX
      : targetApproachX;
    const context = {
      inputVariables,
      buses,
      rowY: inputLogicRowBaseY + index * (config.gateVerticalSpacing + 90),
      sourceX: logicLeftX - 230,
      constantX: targetFf.rect.x - config.gateColumnSpacing - config.componentClearance - index * config.horizontalLaneSpacing,
      constantDirect: true,
      andStartX: ffStageColumns.and[0],
      andStageGap: config.gateColumnSpacing,
      orStartX: ffStageColumns.or[0],
      orStageGap: config.gateColumnSpacing,
      stageColumns: ffStageColumns,
      stageKeyPrefix: "ff-input",
      inputGroup: "ff-input-products",
      targetLaneX,
      logicExitX: ffStartX - config.gateColumnSpacing * 2 - index * config.horizontalLaneSpacing,
      escapeY: ffY - config.flipFlopClearance - config.verticalLaneSpacing * (index + 3),
      termGap: config.gateVerticalSpacing + 32,
      literalGap: Math.max(42, config.verticalLaneSpacing * 2 + 6),
      sameLevelGateOffset: 0,
      reserveSourceLane: (_pinX, inputIndex, termIndex) =>
        logicLeftX - config.componentClearance - (index * 4 + termIndex * 2 + inputIndex + 1) * sourceLaneSpacing
    };
    renderEquationNetwork(layout, equation, target, context);
  });

  result.outputEquations.forEach((equation, index) => {
    const target = outputTargets.get(equation.output);
    const context = {
      inputVariables,
      buses,
      rowY: target.y,
      sourceX: outputLogicX - 170,
      constantX: outputLogicX - config.gateColumnSpacing,
      constantDirect: false,
      andStartX: outputStageColumns.and[0],
      andStageGap: config.gateColumnSpacing,
      orStartX: outputStageColumns.or[0],
      orStageGap: config.gateColumnSpacing,
      stageColumns: outputStageColumns,
      stageKeyPrefix: "output-logic",
      inputGroup: "output-products",
      targetLaneX: outputX - config.gateColumnSpacing + index * -config.horizontalLaneSpacing,
      termGap: config.gateVerticalSpacing + 34,
      literalGap: Math.max(44, config.verticalLaneSpacing * 2 + 6),
      sameLevelGateOffset: 0,
      reserveSourceLane: (_pinX, inputIndex, termIndex) =>
        outputLogicX - config.componentClearance - (index * 4 + termIndex * 2 + inputIndex + 1) * sourceLaneSpacing
    };
    renderEquationNetwork(layout, { ...equation, isOutput: true }, target, context);
  });

  connectClock(layout, Array.from(ffMap.values()), settings);

  layout.meta.xBusCount = inputBuses.has("IN:X") ? 1 : 0;
  layout.meta.xInverterCount = layout.components.filter((component) => component.type === "not" && component.id.startsWith("input-X-not")).length;
  layout.meta.feedbackNets = Array.from(feedbackBuses.keys());
  layout.meta.clkBranchCount = stateVariables.length;

  makeLabel(
    layout,
    "diagram-note-label",
    "Circuit diagram is generated based on simplified equations.",
    26,
    height - 22,
    SIZES.note,
    { margin: 8, fill: "#475569" }
  );
  return layout;
}

function fillSubtitle() {
  return { margin: 8, fill: "#475569" };
}

function bumpConfigValue(config, key, amount, fixes, message) {
  const before = config[key];
  config[key] = before + amount;
  fixes.push(`${message} from ${before}px to ${config[key]}px`);
}

function adaptLayoutConfig(config, validation, attempt) {
  const next = normalizeLayoutConfig(config);
  const fixes = [];
  const types = new Set((validation?.errors || []).map(validationType));
  const issues = validation?.details?.issues || [];
  const hasIssue = (type, orientation = null) =>
    issues.some((issue) => issue.type === type && (!orientation || issue.orientation === orientation));

  if (hasIssue("WIRE_WIRE_OVERLAP", "horizontal")) {
    bumpConfigValue(next, "verticalLaneSpacing", 8, fixes, "increased vertical lane spacing for horizontal wire overlap");
  }
  if (hasIssue("WIRE_WIRE_OVERLAP", "vertical")) {
    bumpConfigValue(next, "horizontalLaneSpacing", 8, fixes, "increased horizontal lane spacing for vertical wire overlap");
  }
  if (types.has("WIRE_WIRE_OVERLAP") && !hasIssue("WIRE_WIRE_OVERLAP", "horizontal") && !hasIssue("WIRE_WIRE_OVERLAP", "vertical")) {
    bumpConfigValue(next, "verticalLaneSpacing", 6, fixes, "increased vertical lane spacing for wire overlap");
  }

  if (hasIssue("WIRE_GATE_COLLISION", "horizontal") || hasIssue("LABEL_OVERLAP", "horizontal")) {
    bumpConfigValue(next, "verticalLaneSpacing", 8, fixes, "moved horizontal wire lanes vertically around components");
    bumpConfigValue(next, "gateVerticalSpacing", 8, fixes, "increased vertical gate clearance around horizontal wire collision");
  }
  if (hasIssue("WIRE_GATE_COLLISION", "vertical") || hasIssue("LABEL_OVERLAP", "vertical")) {
    bumpConfigValue(next, "horizontalLaneSpacing", 8, fixes, "moved vertical wire lanes horizontally around components");
    bumpConfigValue(next, "gateColumnSpacing", 12, fixes, "increased horizontal gate clearance around vertical wire collision");
  }
  if (types.has("WIRE_GATE_COLLISION") && !hasIssue("WIRE_GATE_COLLISION", "horizontal") && !hasIssue("WIRE_GATE_COLLISION", "vertical")) {
    bumpConfigValue(next, "componentClearance", 4, fixes, "increased component clearance for wire-gate collision");
  }
  if (hasIssue("WIRE_FF_COLLISION", "horizontal")) {
    bumpConfigValue(next, "verticalLaneSpacing", 10, fixes, "moved horizontal wire lanes vertically around flip-flops");
    bumpConfigValue(next, "flipFlopClearance", 8, fixes, "increased flip-flop clearance for horizontal wire collision");
  }
  if (hasIssue("WIRE_FF_COLLISION", "vertical")) {
    bumpConfigValue(next, "horizontalLaneSpacing", 10, fixes, "moved vertical wire lanes horizontally around flip-flops");
    bumpConfigValue(next, "flipFlopClearance", 16, fixes, "increased flip-flop clearance");
    bumpConfigValue(next, "gateColumnSpacing", 16, fixes, "moved FF columns horizontally only for vertical collision");
  }
  if (hasIssue("GATE_GATE_COLLISION", "same-column") || types.has("SAME_GROUP_SPACING_ERROR")) {
    bumpConfigValue(next, "gateVerticalSpacing", 12, fixes, "increased same-column vertical gate spacing");
  }
  if (hasIssue("GATE_GATE_COLLISION", "adjacent-column")) {
    bumpConfigValue(next, "gateColumnSpacing", 16, fixes, "increased adjacent-column gate spacing");
  }
  if (types.has("GATE_GATE_COLLISION") && !hasIssue("GATE_GATE_COLLISION", "same-column") && !hasIssue("GATE_GATE_COLLISION", "adjacent-column")) {
    bumpConfigValue(next, "gateVerticalSpacing", 10, fixes, "increased generic gate spacing");
  }
  if (types.has("GATE_FF_COLLISION")) {
    bumpConfigValue(next, "gateColumnSpacing", 16, fixes, "separated gate and flip-flop columns");
    bumpConfigValue(next, "flipFlopClearance", 12, fixes, "increased flip-flop protected clearance");
  }
  if (types.has("LABEL_OVERLAP")) {
    bumpConfigValue(next, "verticalLaneSpacing", 6, fixes, "increased local label vertical spacing");
  }
  if (types.has("DANGLING_PIN_CONNECTION")) {
    bumpConfigValue(next, "horizontalLaneSpacing", 4, fixes, "increased horizontal lane spacing for exact pin snaps");
  }
  if (types.has("WRONG_OR_INPUT_COUNT") || types.has("WRONG_TARGET_CONNECTION")) {
    bumpConfigValue(next, "gateColumnSpacing", 12, fixes, "expanded OR/output routing columns");
  }
  if (types.has("SAME_STAGE_ALIGNMENT_ERROR")) {
    fixes.push("regenerated stage columns using deterministic same-x alignment");
  }
  if (types.has("BRANCH_POINT_TOO_CLOSE")) {
    bumpConfigValue(next, "branchPointSpacing", 8, fixes, "moved shared bus branch points farther apart");
    bumpConfigValue(next, "horizontalLaneSpacing", 4, fixes, "spread vertical branch lanes horizontally");
  }

  if (attempt > 6 && attempt % 4 === 3) {
    if (hasIssue("WIRE_WIRE_OVERLAP", "horizontal") || hasIssue("WIRE_GATE_COLLISION", "horizontal")) {
      bumpConfigValue(next, "canvasExtraHeight", 80, fixes, "expanded canvas height after repeated horizontal-lane failures");
    }
    if (hasIssue("WIRE_WIRE_OVERLAP", "vertical") || hasIssue("WIRE_FF_COLLISION", "vertical")) {
      bumpConfigValue(next, "canvasExtraWidth", 80, fixes, "expanded canvas width after repeated vertical-lane failures");
    }
  }

  if (!fixes.length) {
    bumpConfigValue(next, "verticalLaneSpacing", 4, fixes, "applied compact vertical retry");
    bumpConfigValue(next, "horizontalLaneSpacing", 4, fixes, "applied compact horizontal retry");
  }

  return { config: next, fixes, types: [...types] };
}

function safeFallbackConfig(config) {
  const current = normalizeLayoutConfig(config);
  return {
    ...current,
    gateVerticalSpacing: Math.max(current.gateVerticalSpacing, 132),
    gateColumnSpacing: Math.max(current.gateColumnSpacing, 240),
    verticalLaneSpacing: Math.max(current.verticalLaneSpacing, 56),
    horizontalLaneSpacing: Math.max(current.horizontalLaneSpacing, 42),
    branchPointSpacing: Math.max(current.branchPointSpacing, 64),
    wireLaneSpacing: Math.max(current.verticalLaneSpacing, current.horizontalLaneSpacing, 56),
    componentClearance: Math.max(current.componentClearance, 32),
    flipFlopClearance: Math.max(current.flipFlopClearance, 72),
    canvasExtraWidth: current.canvasExtraWidth + 280,
    canvasExtraHeight: current.canvasExtraHeight + 620
  };
}

function runAdaptiveLayout(args, maxAttempts = 20) {
  let config = normalizeLayoutConfig(args.config);
  let firstValidation = null;
  let lastLayout = null;
  let lastValidation = null;
  const history = [];
  const fixes = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const layout = buildLayout({ ...args, attempt, config });
    const validation = validateDiagramLayout(layout);
    if (!firstValidation) firstValidation = validation;
    lastLayout = layout;
    lastValidation = validation;
    history.push({
      attempt: attempt + 1,
      valid: validation.valid,
      errorTypes: validation.details.errorTypes,
      config: { ...config }
    });

    if (validation.valid) {
      return {
        layout,
        validation,
        attemptsUsed: attempt + 1,
        firstValidation,
        history,
        fixes: [...new Set([...fixes, ...(layout.meta.autoFixes || [])])],
        usedFallback: false
      };
    }

    const adaptation = adaptLayoutConfig(config, validation, attempt);
    fixes.push(...adaptation.fixes);
    config = adaptation.config;
  }

  const fallbackConfig = safeFallbackConfig(config);
  const fallback = buildSafeFallbackLayout(args, maxAttempts, fallbackConfig);
  const fallbackValidation = validateDiagramLayout(fallback);
  history.push({
    attempt: maxAttempts + 1,
    valid: fallbackValidation.valid,
    errorTypes: fallbackValidation.details.errorTypes,
    config: { ...fallbackConfig },
    fallback: true
  });

  return {
    layout: fallbackValidation.valid ? fallback : lastLayout,
    validation: fallbackValidation.valid ? fallbackValidation : lastValidation,
    attemptsUsed: fallbackValidation.valid ? maxAttempts + 1 : maxAttempts,
    firstValidation,
    history,
    fixes: [
      ...new Set([
        ...fixes,
        ...(fallback.meta.autoFixes || []),
        fallbackValidation.valid
          ? `used safe fallback layout with ${layoutConfigSummary(fallbackConfig)}`
          : `safe fallback still failed with ${fallbackValidation.errors.length} error(s)`
      ])
    ],
    usedFallback: fallbackValidation.valid
  };
}

function buildValidatedLayout(args) {
  const run = runAdaptiveLayout(args, 20);
  return { layout: run.layout, validation: run.validation };
}

const PHASE5_AUTO_DEBUG_BASE = {
  verticalLaneSpacing: 18,
  horizontalLaneSpacing: 18,
  gateVerticalSpacing: 60,
  gateColumnSpacing: 140,
  componentClearance: 20,
  branchPointSpacing: 36,
  canvasExtraWidth: 0,
  canvasExtraHeight: 0
};

function phase5LayoutConfig(debugConfig) {
  const verticalLaneSpacing = clamp(debugConfig.verticalLaneSpacing, 18, 120);
  const horizontalLaneSpacing = clamp(debugConfig.horizontalLaneSpacing, 18, 120);
  const gateVerticalSpacing = clamp(debugConfig.gateVerticalSpacing, 60, 220);
  const gateColumnSpacing = clamp(debugConfig.gateColumnSpacing, 140, 260);
  const branchPointSpacing = clamp(debugConfig.branchPointSpacing, 36, 96);
  return {
    gateVerticalSpacing,
    gateColumnSpacing,
    branchPointSpacing,
    branchLaneSpacing: clamp(horizontalLaneSpacing, 18, 28),
    feedbackBusGap: Math.max(38, verticalLaneSpacing * 2),
    equationRowSpacing: Math.max(150, gateVerticalSpacing + verticalLaneSpacing * 4),
    gateToFlipFlopSpacing: Math.max(120, gateColumnSpacing - 20),
    canvasPadding: 72 + Math.round((debugConfig.componentClearance - 20) / 2),
    canvasExtraWidth: debugConfig.canvasExtraWidth || 0,
    canvasExtraHeight: debugConfig.canvasExtraHeight || 0
  };
}

function phase5ConfigSummary(config) {
  return `vertical lanes ${config.verticalLaneSpacing}px, horizontal lanes ${config.horizontalLaneSpacing}px, branch spacing ${config.branchPointSpacing}px, gate vertical ${config.gateVerticalSpacing}px, columns ${config.gateColumnSpacing}px, component clearance ${config.componentClearance}px`;
}

function phase5Issues(validation) {
  return validation?.details?.issues || [];
}

function phase5HasIssue(issues, type, orientation = null) {
  return issues.some((issue) => issue.type === type && (!orientation || issue.orientation === orientation));
}

function phase5IssueTypes(issues) {
  return new Set(issues.map((issue) => issue.type));
}

function phase5Bump(config, key, amount, fixes, message, max = 260) {
  const previous = config[key] ?? PHASE5_AUTO_DEBUG_BASE[key] ?? 0;
  const next = Math.min(max, previous + amount);
  if (next !== previous) {
    config[key] = next;
    fixes.push(`${message} (${key}: ${previous}px -> ${next}px)`);
  }
}

function phase5AdaptConfig(currentConfig, validation, attempt) {
  const next = { ...currentConfig };
  const issues = phase5Issues(validation);
  const types = phase5IssueTypes(issues);
  const fixes = [];

  if (phase5HasIssue(issues, "WIRE_WIRE_OVERLAP", "horizontal")) {
    phase5Bump(next, "verticalLaneSpacing", 8, fixes, "separated horizontal wire overlap by moving y-lanes", 120);
    phase5Bump(next, "gateVerticalSpacing", 8, fixes, "increased same-column gate clearance for horizontal overlap", 220);
  }
  if (phase5HasIssue(issues, "WIRE_WIRE_OVERLAP", "vertical")) {
    phase5Bump(next, "horizontalLaneSpacing", 8, fixes, "separated vertical wire overlap by moving x-lanes", 120);
    phase5Bump(next, "branchPointSpacing", 4, fixes, "spread bus tap points for vertical branch wires", 96);
  }
  if (types.has("BRANCH_POINT_TOO_CLOSE")) {
    phase5Bump(next, "branchPointSpacing", 8, fixes, "moved shared bus tap points farther apart", 96);
    phase5Bump(next, "horizontalLaneSpacing", 4, fixes, "assigned wider branch x-lanes", 120);
  }
  if (phase5HasIssue(issues, "WIRE_COMPONENT_COLLISION", "horizontal")) {
    phase5Bump(next, "verticalLaneSpacing", 8, fixes, "rerouted horizontal wire around protected component by changing y-lane", 120);
    phase5Bump(next, "componentClearance", 4, fixes, "increased component clearance for horizontal collision", 48);
  }
  if (phase5HasIssue(issues, "WIRE_COMPONENT_COLLISION", "vertical")) {
    phase5Bump(next, "horizontalLaneSpacing", 8, fixes, "rerouted vertical wire around protected component by changing x-lane", 120);
    phase5Bump(next, "componentClearance", 4, fixes, "increased component clearance for vertical collision", 48);
  }
  if (types.has("GATE_GATE_COLLISION") || types.has("SAME_GROUP_SPACING_ERROR")) {
    phase5Bump(next, "gateVerticalSpacing", 12, fixes, "redistributed same-stage gates with more vertical spacing", 220);
  }
  if (types.has("GATE_FF_COLLISION") || types.has("COMPONENT_OVERLAP")) {
    phase5Bump(next, "gateColumnSpacing", 16, fixes, "separated adjacent component columns", 260);
    phase5Bump(next, "gateVerticalSpacing", 8, fixes, "increased component row clearance", 220);
  }
  if (types.has("SAME_STAGE_ALIGNMENT_ERROR")) {
    fixes.push("realigned same-stage gates by regenerating deterministic stage columns");
  }
  if (types.has("DANGLING_PIN_CONNECTION") || types.has("NEAR_MISS_PIN_CONNECTION")) {
    fixes.push("snapped wire endpoints to exact gate and flip-flop pin coordinates during regeneration");
    phase5Bump(next, "horizontalLaneSpacing", 2, fixes, "added small x-lane clearance for exact pin snapping", 120);
  }
  if (types.has("WRONG_OR_INPUT_COUNT") || types.has("OR_INPUTS_MERGED")) {
    fixes.push("rebuilt OR logic from the 2-input netlist tree and separated OR input pins");
    phase5Bump(next, "gateColumnSpacing", 8, fixes, "expanded OR tree column spacing", 260);
  }
  if (types.has("WRONG_TARGET_CONNECTION")) {
    fixes.push("reconnected final gate outputs to recorded equation target pins");
    phase5Bump(next, "gateColumnSpacing", 8, fixes, "expanded final target routing lane", 260);
  }

  if (attempt > 8 && (phase5HasIssue(issues, "WIRE_WIRE_OVERLAP", "vertical") || phase5HasIssue(issues, "WIRE_COMPONENT_COLLISION", "vertical"))) {
    phase5Bump(next, "gateColumnSpacing", 8, fixes, "used later-attempt horizontal column expansion after local x-lane fixes", 260);
  }
  if (attempt > 10 && (phase5HasIssue(issues, "WIRE_WIRE_OVERLAP", "horizontal") || phase5HasIssue(issues, "WIRE_COMPONENT_COLLISION", "horizontal"))) {
    phase5Bump(next, "canvasExtraHeight", 80, fixes, "expanded canvas height after repeated y-lane conflicts", 640);
  }
  if (attempt > 14 && validation?.errors?.length) {
    phase5Bump(next, "canvasExtraWidth", 80, fixes, "expanded canvas width only after local routing fixes were exhausted", 480);
  }

  if (!fixes.length) {
    phase5Bump(next, "verticalLaneSpacing", 4, fixes, "made a compact vertical retry adjustment", 120);
    phase5Bump(next, "horizontalLaneSpacing", 4, fixes, "made a compact horizontal retry adjustment", 120);
  }

  return { config: next, fixes };
}

function phase5FallbackConfig(config) {
  return {
    ...config,
    verticalLaneSpacing: Math.max(config.verticalLaneSpacing, 56),
    horizontalLaneSpacing: Math.max(config.horizontalLaneSpacing, 48),
    gateVerticalSpacing: Math.max(config.gateVerticalSpacing, 132),
    gateColumnSpacing: Math.max(config.gateColumnSpacing, 220),
    branchPointSpacing: Math.max(config.branchPointSpacing, 64),
    componentClearance: Math.max(config.componentClearance, 32),
    canvasExtraWidth: Math.max(config.canvasExtraWidth || 0, 180),
    canvasExtraHeight: Math.max(config.canvasExtraHeight || 0, 480)
  };
}

function renderNewDebugSvg({ layout, validation, modelType, flipFlopType }) {
  return renderCircuitLayoutSvg(layout, {
    title: "Sequential Circuit Diagram",
    subtitle: `${modelType} Model, ${flipFlopType}-FF, Auto Debug validated layout`,
    validation
  });
}

export function autoDebugCircuitLayout({ result, modelType, flipFlopType, inputVariables, outputVariables }) {
  if (!result) {
    return {
      passed: false,
      attemptsUsed: 0,
      errorsBefore: ["Generate a design before running Auto Debug."],
      errorsAfter: ["No generated result is available."],
      warnings: [],
      fixes: [],
      svg: ""
    };
  }

  const netlist = buildCircuitNetlist({ result, inputVariables, outputVariables });
  let debugConfig = { ...PHASE5_AUTO_DEBUG_BASE };
  let firstValidation = null;
  let finalValidation = null;
  let finalLayout = null;
  let attemptsUsed = 0;
  const history = [];
  const fixes = [
    "read circuit graph validation metadata before regenerating layout",
    "preserved 2-input AND / OR trees from the structural netlist",
    "checked final gate outputs against recorded equation targets"
  ];

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const layoutConfig = phase5LayoutConfig(debugConfig);
    const layout = buildCircuitLayoutFromResult({ result, inputVariables, outputVariables, flipFlopType, config: layoutConfig });
    const validation = validateNewCircuitGraph(layout, netlist);
    if (!firstValidation) firstValidation = validation;
    finalValidation = validation;
    finalLayout = layout;
    attemptsUsed = attempt;
    history.push({
      attempt,
      valid: validation.valid,
      errorTypes: validation.details?.errorTypes || [],
      config: { ...debugConfig }
    });
    if (validation.valid) {
      if (attempt === 1) fixes.push("initial compact Auto Debug layout already passed validation; no reroute was required");
      break;
    }

    const adaptation = phase5AdaptConfig(debugConfig, validation, attempt);
    fixes.push(...adaptation.fixes);
    debugConfig = adaptation.config;
  }

  if (!finalValidation?.valid) {
    const fallbackDebugConfig = phase5FallbackConfig(debugConfig);
    const fallbackLayout = buildCircuitLayoutFromResult({
      result,
      inputVariables,
      outputVariables,
      flipFlopType,
      config: phase5LayoutConfig(fallbackDebugConfig)
    });
    const fallbackValidation = validateNewCircuitGraph(fallbackLayout, netlist);
    history.push({
      attempt: attemptsUsed + 1,
      valid: fallbackValidation.valid,
      errorTypes: fallbackValidation.details?.errorTypes || [],
      config: { ...fallbackDebugConfig },
      fallback: true
    });
    fixes.push("generated safe fallback layout with wider row spacing, tap spacing, and lane spacing");
    if (fallbackValidation.valid) {
      finalLayout = fallbackLayout;
      finalValidation = fallbackValidation;
      debugConfig = fallbackDebugConfig;
    }
  }

  if (!finalValidation?.valid) {
    const deterministicLayout = buildCircuitLayoutFromResult({
      result,
      inputVariables,
      outputVariables,
      flipFlopType
    });
    const deterministicValidation = validateNewCircuitGraph(deterministicLayout, netlist);
    history.push({
      attempt: attemptsUsed + 1,
      valid: deterministicValidation.valid,
      errorTypes: deterministicValidation.details?.errorTypes || [],
      config: "deterministic-renderer-default",
      fallback: true
    });
    fixes.push("validated deterministic safe layout used by the Circuit Diagram tab");
    if (deterministicValidation.valid) {
      finalLayout = deterministicLayout;
      finalValidation = deterministicValidation;
    }
  }

  const svg = finalLayout
    ? renderNewDebugSvg({ layout: finalLayout, validation: finalValidation, modelType, flipFlopType })
    : "";

  return {
    passed: Boolean(finalValidation?.valid),
    attemptsUsed,
    errorsBefore: firstValidation?.errors || [],
    errorsAfter: finalValidation?.errors || [],
    warnings: finalValidation?.warnings || [],
    fixes: [
      ...new Set([
        ...fixes,
        ...fixesFromValidationErrors(firstValidation),
        `final spacing: ${phase5ConfigSummary(debugConfig)}`
      ])
    ],
    history,
    svg
  };
}

function buildSafeFallbackLayout(args, attempt, config) {
  return buildLayout({ ...args, attempt, config: config || safeFallbackConfig(args.config) });
}

function fixesFromValidationErrors(validation) {
  const fixes = [];
  (validation?.errors || []).forEach((error) => {
    const match = String(error).match(/(?:horizontal|vertical|diagonal)?\s*wire (.+) intersects protected component (.+)$/i);
    if (match) fixes.push(`detected ${match[1]} crossing ${match[2]} and regenerated with obstacle-aware lanes`);
  });
  return fixes;
}

function isNewCircuitLayout(layout) {
  return Array.isArray(layout?.flipFlops) && Array.isArray(layout?.buses) && Array.isArray(layout?.tapPoints);
}

export function validateConnections(layout) {
  if (isNewCircuitLayout(layout)) return validateNewConnections(layout);
  const errors = [];
  const pins = allPins(layout);

  layout.components.forEach((component) => {
    if (component.hidden) return;
    component.pins
      .filter((pin) => pin.role !== "decorative")
      .forEach((pin) => {
        if (pin.role === "output" || pin.role === "source") {
          if (!wireStartsAtPin(layout, pin)) {
            errors.push(validationError("DANGLING_PIN_CONNECTION", `Pin ${component.id}.${pin.name} output/source has no wire starting exactly at the pin`));
          }
          return;
        }
        if (pin.role === "input" || pin.role === "target") {
          if (!wireEndsAtPin(layout, pin)) {
            errors.push(validationError("DANGLING_PIN_CONNECTION", `Pin ${component.id}.${pin.name} input/target has no wire ending exactly at the pin`));
          }
          return;
        }
        if (!wireEndpointConnected(layout, pin)) {
          errors.push(validationError("DANGLING_PIN_CONNECTION", `Pin ${component.id}.${pin.name} is not connected by an exact wire endpoint`));
        }
      });
  });

  layout.wires.forEach((wire) => {
    const endpoints = [wire.points[0], wire.points[wire.points.length - 1]];
    endpoints.forEach((endpoint) => {
      if (!endpointIsKnown(layout, endpoint)) {
        errors.push(validationError("DANGLING_PIN_CONNECTION", `Wire ${wire.id} has dangling endpoint at ${endpoint.x},${endpoint.y}`));
      }
      pins.forEach((pin) => {
        const gap = distance(endpoint, pin);
        if (gap > 0 && gap <= 10) {
          errors.push(validationError("DANGLING_PIN_CONNECTION", `Wire ${wire.id} nearly touches ${pin.componentId}.${pin.name} but leaves a ${gap.toFixed(1)}px gap`));
        }
      });
    });
  });

  return { valid: errors.length === 0, errors };
}

function validateOrInputs(layout, errors) {
  layout.components
    .filter((component) => component.type === "or")
    .forEach((component) => {
      const visibleInputs = new Map();
      layout.wires.forEach((wire) => {
        component.inputPins.forEach((pin, index) => {
          const connected = wire.points.some((endpoint) => pointEquals(endpoint, pin));
          if (connected) visibleInputs.set(index, wire.net);
        });
      });
      if (visibleInputs.size !== 2) {
        errors.push(validationError("WRONG_OR_INPUT_COUNT", `OR gate ${component.id} expected 2 independent visible inputs, saw ${visibleInputs.size}`));
      }
      if (visibleInputs.size === 2) {
        const nets = Array.from(visibleInputs.values());
        if (nets[0] === nets[1]) errors.push(validationError("WRONG_OR_INPUT_COUNT", `OR gate ${component.id} has merged input net ${nets[0]}`));
      }
    });
}

function validateBuses(layout, errors) {
  const xBusCount = layout.wires.filter((wire) => wire.id === "input-X-bus").length;
  if (layout.meta.xBusCount && xBusCount !== 1) errors.push(validationError("X_BUS_ERROR", `Expected one X bus, saw ${xBusCount}`));
  if (layout.meta.xInverterCount > 1) errors.push(validationError("X_BUS_ERROR", `Expected at most one X inverter, saw ${layout.meta.xInverterCount}`));
  layout.meta.feedbackNets.forEach((net) => {
    const raw = net.slice(3);
    const mainId = raw.endsWith("'") ? `feedback-${raw.slice(0, -1)}-n` : `feedback-${raw}`;
    const matching = layout.wires.filter((wire) => wire.net === net && wire.id === mainId);
    if (matching.length !== 1) errors.push(validationError("FEEDBACK_ROUTE_ERROR", `Feedback net ${net} should have exactly one main pullback lane`));
  });
  const clkBranches = layout.wires.filter((wire) => wire.id.startsWith("clk-branch-")).length;
  if (clkBranches !== layout.meta.clkBranchCount) errors.push(validationError("CLK_ROUTE_ERROR", `Expected ${layout.meta.clkBranchCount} CLK branches, saw ${clkBranches}`));
}

function validateBranchPointSpacing(layout, errors, issues) {
  const minimumDistance = branchSpacing(layout);
  const branchesByBus = new Map();
  (layout.branchPoints || []).forEach((branch) => {
    const branches = branchesByBus.get(branch.key) || [];
    branches.push(branch);
    branchesByBus.set(branch.key, branches);
  });

  branchesByBus.forEach((branches) => {
    const sorted = [...branches].sort((left, right) => left.x - right.x);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const left = sorted[index];
      const right = sorted[index + 1];
      const distanceBetweenBranches = Math.abs(right.x - left.x);
      if (distanceBetweenBranches >= minimumDistance) continue;
      const message = `${left.busName} branch points ${left.id} and ${right.id} are ${distanceBetweenBranches}px apart; minimum is ${minimumDistance}px`;
      errors.push(validationError("BRANCH_POINT_TOO_CLOSE", message));
      issues.push(validationIssue("BRANCH_POINT_TOO_CLOSE", message, {
        busName: left.busName,
        branchA: left.id,
        branchB: right.id,
        distance: distanceBetweenBranches,
        minimumDistance,
        orientation: "vertical"
      }));
    }
  });
}

function validateStageAlignment(layout, errors, warnings) {
  const stages = new Map();
  layout.components
    .filter((component) => (component.type === "and" || component.type === "or") && component.stageKey)
    .forEach((component) => {
      const group = stages.get(component.stageKey) || [];
      group.push(component);
      stages.set(component.stageKey, group);
    });

  stages.forEach((components, stageKey) => {
    const xs = components.map((component) => component.rect.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (maxX - minX > 2) {
      errors.push(validationError("SAME_STAGE_ALIGNMENT_ERROR", `Stage alignment failed for ${stageKey}: x positions differ by ${maxX - minX}px`));
    }

    if (components.length < 3) return;
    const sorted = [...components].sort((left, right) => left.rect.y - right.rect.y);
    const gaps = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      gaps.push(sorted[index + 1].rect.y - sorted[index].rect.y);
    }
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    if (minGap < 40) {
      errors.push(validationError("SAME_GROUP_SPACING_ERROR", `Gate spacing failed for ${stageKey}: minimum vertical gap is ${minGap}px`));
    } else if (maxGap - minGap > 72) {
      warnings.push(`Gate spacing warning for ${stageKey}: adjacent gaps range from ${minGap}px to ${maxGap}px`);
    }
  });
}

function validateTargetConnections(layout, errors) {
  (layout.targetConnections || []).forEach((connection) => {
    const wire = layout.wires.find((item) => item.id === connection.wireId);
    if (!wire) {
      errors.push(validationError("WRONG_TARGET_CONNECTION", `Equation ${connection.equationId} has no final wire for target ${connection.targetLabel}`));
      return;
    }

    const start = wire.points[0];
    const end = wire.points[wire.points.length - 1];
    if (!pointEquals(end, connection.targetPin)) {
      errors.push(validationError("WRONG_TARGET_CONNECTION", `Equation ${connection.equationId} output ends at ${end.x},${end.y} instead of ${connection.targetLabel} pin ${connection.targetPin.x},${connection.targetPin.y}`));
    }
    if (connection.sourcePin && !pointEquals(start, connection.sourcePin)) {
      errors.push(validationError("DANGLING_PIN_CONNECTION", `Equation ${connection.equationId} final wire does not start exactly at its source pin`));
    }
  });
}

export function validateDiagramLayout(layout) {
  if (isNewCircuitLayout(layout)) return validateNewDiagramLayout(layout);
  const errors = [];
  const warnings = [];
  const issues = [];

  for (let leftIndex = 0; leftIndex < layout.components.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.components.length; rightIndex += 1) {
      const left = layout.components[leftIndex];
      const right = layout.components[rightIndex];
      if (left.hidden || right.hidden) continue;
      if (rectsOverlap(protectedRect(left), protectedRect(right))) {
        const type = componentOverlapType(left, right);
        const relation = Math.abs(left.rect.x - right.rect.x) < 6 ? "same-column" : "adjacent-column";
        const message = `Component overlap: ${left.id} with ${right.id}`;
        errors.push(validationError(type, message));
        issues.push(validationIssue(type, message, { componentA: left.id, componentB: right.id, orientation: relation }));
      }
    }
  }

  layout.wires.forEach((wire) => {
    wireSegments(wire).forEach((segment) => {
      layout.components.forEach((component) => {
        if (component.hidden) return;
        if (!segmentIntersectsRect(segment, protectedRect(component))) return;
        if (isAllowedWireComponentContact(segment, component)) return;
        const type = wireComponentCollisionType(component);
        const orientation = segmentOrientation(segment);
        const message = `${orientation} wire ${wire.id} intersects protected component ${component.id}`;
        errors.push(validationError(type, message));
        issues.push(validationIssue(type, message, { wire: wire.id, componentId: component.id, orientation }));
      });
    });
  });

  for (let leftIndex = 0; leftIndex < layout.wires.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.wires.length; rightIndex += 1) {
      const left = layout.wires[leftIndex];
      const right = layout.wires[rightIndex];
      if (left.net === right.net) continue;
      wireSegments(left).forEach((leftSegment) => {
        wireSegments(right).forEach((rightSegment) => {
          if (collinearOverlap(leftSegment, rightSegment)) {
            const orientation = segmentOrientation(leftSegment);
            const message = `${orientation} unrelated wires overlap: ${left.id} with ${right.id}`;
            errors.push(validationError("WIRE_WIRE_OVERLAP", message));
            issues.push(validationIssue("WIRE_WIRE_OVERLAP", message, { wireA: left.id, wireB: right.id, orientation }));
          }
        });
      });
    }
  }

  validateOrInputs(layout, errors);
  validateBuses(layout, errors);
  validateBranchPointSpacing(layout, errors, issues);
  validateStageAlignment(layout, errors, warnings);
  validateTargetConnections(layout, errors);
  const connectionValidation = validateConnections(layout);
  errors.push(...connectionValidation.errors);
  const derivedIssues = errors.map((error) => {
    const type = validationType(error);
    const message = String(error).replace(/^[A-Z_]+:\s*/, "");
    return validationIssue(type, message);
  });
  const uniqueIssues = new Map();
  [...issues, ...derivedIssues].forEach((issue) => {
    uniqueIssues.set(`${issue.type}:${issue.message}:${issue.orientation || ""}`, issue);
  });
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    details: {
      attempt: layout.meta.attempt,
      config: layout.config,
      errorTypes: [...new Set(errors.map(validationType))],
      issues: [...uniqueIssues.values()],
      componentCount: layout.components.length,
      wireCount: layout.wires.length,
      branchPointCount: layout.branchPoints?.length || 0,
      targetConnectionCount: layout.targetConnections?.length || 0,
      autoFixes: layout.meta.autoFixes || []
    }
  };
}

function pathData(points) {
  return points.map((item, index) => `${index === 0 ? "M" : "L"}${item.x} ${item.y}`).join(" ");
}

function renderWire(wire) {
  return `<path data-wire-id="${escapeHtml(wire.id)}" data-net="${escapeHtml(wire.net)}" d="${pathData(wire.points)}" fill="none" stroke="${wire.color}" stroke-width="${wire.width}" stroke-linecap="square" stroke-linejoin="miter"/>`;
}

function renderPin(component) {
  if (component.hidden || !component.text) return "";
  const pin = component.pinMap.out || component.pinMap.in;
  const isOutput = component.type === "output";
  const textX = isOutput ? pin.x + 26 : component.rect.x + 6;
  return `<circle cx="${pin.x}" cy="${pin.y}" r="4.8" fill="${component.color || COLORS.input}"/>
    <text x="${textX}" y="${pin.y + 6}" font-size="${isOutput ? SIZES.output : SIZES.net}" font-weight="${isOutput ? 800 : 700}" font-family="${SVG_FONT}" fill="${component.color || COLORS.input}">${html(component.text)}</text>`;
}

function renderConstant(component) {
  const pin = component.pinMap.out;
  const value = component.value === "0" ? "0" : "1";
  const stubLength = 20;
  const startX = pin.x - stubLength;
  const labelX = startX - 7;
  return `<path d="M${startX} ${pin.y} H${pin.x}" stroke="${COLORS.const}" stroke-width="2.4"/>
    <text x="${labelX}" y="${pin.y + 5}" text-anchor="end" font-size="${SIZES.constant}" font-weight="800" font-family="${SVG_FONT}" fill="${COLORS.const}">${value}</text>`;
}

function renderNot(component) {
  const { x, y, width, height } = component.rect;
  const centerY = y + height / 2;
  return `<polygon points="${x},${centerY - 19} ${x},${centerY + 19} ${x + 42},${centerY}" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <circle cx="${x + 52}" cy="${centerY}" r="6.5" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 13}" y="${centerY + 5}" font-size="${SIZES.gate}" font-weight="800" font-family="${SVG_FONT}" fill="#334155">NOT</text>`;
}

function renderAnd(component) {
  const { x, y, width, height } = component.rect;
  const centerY = y + height / 2;
  return `<path d="M${x} ${y} H${x + width * 0.43} Q${x + width} ${centerY} ${x + width * 0.43} ${y + height} H${x} Z" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 20}" y="${centerY + 5}" font-size="${SIZES.gate}" font-weight="800" font-family="${SVG_FONT}" fill="#334155">AND</text>`;
}

function renderOr(component) {
  const { x, y, width, height } = component.rect;
  const centerY = y + height / 2;
  return `<path d="M${x} ${y} Q${x + width * 0.53} ${y + height * 0.08} ${x + width} ${centerY} Q${x + width * 0.53} ${y + height * 0.92} ${x} ${y + height} Q${x + width * 0.27} ${centerY} ${x} ${y} Z" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 34}" y="${centerY + 5}" font-size="${SIZES.gate}" font-weight="800" font-family="${SVG_FONT}" fill="#334155">OR</text>`;
}

function renderFlipFlop(component) {
  const { x, y, width, height } = component.rect;
  const inputLabels = component.inputLabels
    .map((input) => `<text x="${x + 16}" y="${component.pinMap[input].y + 5}" font-size="${SIZES.ffPin}" font-weight="800" font-family="${SVG_FONT}" fill="#111827">${html(input)}</text>`)
    .join("");
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="8" fill="#ffffff" stroke="${COLORS.gate}" stroke-width="2.5"/>
    <text x="${x + 34}" y="${y + 30}" font-size="${SIZES.ffTitle}" font-weight="800" font-family="${SVG_FONT}" fill="#111827">${escapeHtml(component.flipFlopType)} Flip-Flop</text>
    ${inputLabels}
    <path d="M${x} ${component.pinMap.CLK.y - 9} L${x + 15} ${component.pinMap.CLK.y} L${x} ${component.pinMap.CLK.y + 9}" fill="none" stroke="${COLORS.gate}" stroke-width="2"/>
    <text x="${x + 17}" y="${component.pinMap.CLK.y + 5}" font-size="${SIZES.ffPin}" font-weight="800" font-family="${SVG_FONT}" fill="#111827">CLK</text>
    <text x="${x + width / 2 - 22}" y="${y + height / 2 + 11}" font-size="${SIZES.ffState}" font-weight="900" font-family="${SVG_FONT}" fill="#111827">${html(component.stateVariable)}</text>
    <text x="${x + width - 45}" y="${component.pinMap.Q.y + 5}" font-size="${SIZES.ffPin}" font-weight="800" font-family="${SVG_FONT}" fill="#111827">Q</text>
    <text x="${x + width - 50}" y="${component.pinMap.QN.y + 5}" font-size="${SIZES.ffPin}" font-weight="800" font-family="${SVG_FONT}" fill="#111827">Q'</text>`;
}

function renderLabel(component) {
  if (component.render === false) return "";
  return `<text x="${component.rect.x}" y="${component.rect.y + component.rect.height - 4}" font-size="${component.fontSize || SIZES.net}" font-weight="${component.weight || 400}" font-family="${SVG_FONT}" fill="${component.fill || "#334155"}">${html(component.text)}</text>`;
}

function renderComponent(component) {
  if (component.type === "label") return renderLabel(component);
  if (component.type === "pin" || component.type === "output" || component.type === "bus-end") return renderPin(component);
  if (component.type === "constant") return renderConstant(component);
  if (component.type === "not") return renderNot(component);
  if (component.type === "and") return renderAnd(component);
  if (component.type === "or") return renderOr(component);
  if (component.type === "ff") return renderFlipFlop(component);
  return "";
}

function renderLegend(layout) {
  const items = [
    ["X / input buses", COLORS.input],
    ["X' / inverted input", COLORS.inputInverted],
    ["Q / Q' feedback", COLORS.feedback[0]],
    ["CLK", COLORS.clk],
    ["Internal logic", COLORS.internal],
    ["Output path", COLORS.output]
  ];
  const x = layout.width - 360;
  const y = 28;
  const rows = items
    .map(
      ([text, color], index) =>
        `<g><line x1="${x}" y1="${y + index * 24}" x2="${x + 34}" y2="${y + index * 24}" stroke="${color}" stroke-width="3"/>
        <text x="${x + 44}" y="${y + index * 24 + 5}" font-size="13" font-weight="700" font-family="${SVG_FONT}" fill="#334155">${html(text)}</text></g>`
    )
    .join("");
  return `<g aria-label="diagram color legend">${rows}</g>`;
}

function renderLayout(layout, validation) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Validated color-coded gate-level sequential circuit diagram">`,
    `<desc>Layout validation: ${validation.valid ? "valid" : `invalid - ${validation.errors.join("; ")}`}</desc>`,
    `<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`,
    ...layout.wires.map(renderWire),
    ...layout.dots.map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="4.8" fill="${dot.color}"/>`),
    ...layout.components.map(renderComponent),
    renderLegend(layout),
    `<text x="26" y="${layout.height - 22}" font-size="${SIZES.note}" font-family="${SVG_FONT}" fill="#475569">Circuit diagram is generated based on simplified equations. Layout validation: ${validation.valid ? "passed" : "failed"}.</text>`,
    `</svg>`
  ].join("");
}

export function generateDiagramSvg({ result, modelType, flipFlopType, inputVariables, outputVariables }) {
  if (!result) return "";
  const netlist = buildCircuitNetlist({ result, inputVariables, outputVariables });
  const layout = buildCircuitLayoutFromResult({ result, inputVariables, outputVariables, flipFlopType });
  const validation = validateNewCircuitGraph(layout, netlist);
  return renderCircuitLayoutSvg(layout, {
    title: "Sequential Circuit Diagram",
    subtitle: `${modelType} Model, ${flipFlopType}-FF, color-coded gate-level schematic`,
    validation
  });
}
