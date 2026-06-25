import { buildCircuitNetlist, getSignalInputOrderRank } from "./netlistBuilder.js";

const DEFAULT_LAYOUT = {
  canvasPadding: 80,
  sourceRegionX: 80,
  feedbackRegionX: 180,
  inputBusRegionX: 300,
  andStageX: 560,
  orStageX: 740,
  ffStageX: 940,
  outputStageX: 1120,
  inputBusTopY: 238,
  inputBusBottomPadding: 132,
  inputBusSpacing: 66,
  gateVerticalSpacing: 72,
  andGateIntraGroupGap: 52,
  andGateInterGroupGap: 96,
  equationGroupSpacing: 110,
  feedbackBusSpacing: 42,
  tapPointSpacing: 40,
  branchLaneSpacing: 24,
  componentClearance: 24,
  gateColumnSpacing: 200,
  gateToFlipFlopSpacing: 140,
  ffWidth: 106,
  ffHeight: 109,
  ffVerticalSpacing: 210,
  ffTopY: 363,
  outputRegionGap: 104,
  clkBusYMargin: 90
};

const INPUT_ORDER = ["Q0", "Q0'", "Q1", "Q1'", "X", "X'"];
const OR_DIRECT_ORDER = ["Q1'", "Q1", "Q0'", "Q0"];

function mergeLayoutConfig(config = {}) {
  return { ...DEFAULT_LAYOUT, ...config };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sanitizeId(value) {
  return String(value || "node")
    .replace(/'/g, "-prime")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "node";
}

function numericSuffix(value) {
  const match = String(value || "").match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function sortStateVariables(values = []) {
  return unique(values).sort((left, right) => numericSuffix(left) - numericSuffix(right));
}

function stateVariablesFor(result, netlist) {
  const placement = netlist?.metadata?.flipFlopPlacement;
  if (placement?.length) {
    return [...placement]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((item) => item.stateVariable);
  }
  if (netlist?.metadata?.stateVariables?.length) return sortStateVariables(netlist.metadata.stateVariables);
  if (result?.encodingInfo?.stateVariables?.length) return sortStateVariables(result.encodingInfo.stateVariables);
  return sortStateVariables((netlist?.flipFlopInputs || []).map((input) => `Q${numericSuffix(input)}`));
}

function bbox(x, y, width, height) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

function inflateBox(box, margin) {
  return {
    x: box.x - margin,
    y: box.y - margin,
    width: box.width + margin * 2,
    height: box.height + margin * 2,
    left: box.left - margin,
    top: box.top - margin,
    right: box.right + margin,
    bottom: box.bottom + margin
  };
}

function centerY(component) {
  return component.y + component.height / 2;
}

function outputTargets(netlist, outputVariables) {
  return unique([
    ...outputVariables,
    ...Object.keys(netlist.targetMap || {}).filter((target) => outputVariables.includes(target) || /^Z\d*$/.test(target))
  ]);
}

function targetSortRank(target, outputVariables) {
  if (outputVariables.includes(target) || /^Z\d*$/.test(target)) return 1000 + numericSuffix(target);
  const letter = String(target || "").replace(/\d+$/, "");
  const suffix = numericSuffix(target);
  const letterRank = { D: 0, T: 0, J: 0, K: 1 }[letter] ?? 5;
  return suffix * 10 + letterRank;
}

function targetOrderFor(netlist, outputVariables) {
  return unique([
    ...(netlist.flipFlopInputs || []),
    ...outputTargets(netlist, outputVariables),
    ...Object.keys(netlist.targetMap || {})
  ]).sort((left, right) => targetSortRank(left, outputVariables) - targetSortRank(right, outputVariables));
}

function signalClassForSignal(signal, inputVariables = [], outputVariables = []) {
  if (signal === "CLK") return "clock";
  if (String(signal).startsWith("CONST_") || String(signal).startsWith("CONST:")) return "constant";
  if (outputVariables.includes(signal) || /^Z\d*$/.test(signal)) return "output";
  const raw = String(signal).endsWith("'") ? String(signal).slice(0, -1) : String(signal);
  if (inputVariables.includes(raw)) return String(signal).endsWith("'") ? "input-inverted" : "input";
  if (/^Q\d+$/.test(raw)) return "feedback";
  return "internal";
}

function colorClassForSignal(signalClass) {
  if (signalClass === "input" || signalClass === "input-inverted") return "input";
  if (signalClass === "feedback") return "feedback";
  if (signalClass === "clock") return "clock";
  if (signalClass === "output") return "output";
  if (signalClass === "constant") return "constant";
  return "internal";
}

function gateSize(type, visualInputCount = 2) {
  if (type === "NOT") return { width: 68, height: 50 };
  if (type === "CONST") return { width: 68, height: 50 };
  if (type === "WIRE") return { width: 54, height: 28 };
  return {
    width: type === "OR" ? 92 : 86,
    height: 76
  };
}

function multiInputPins(x, y, width, height, visualInputCount = 2) {
  const count = Math.max(2, visualInputCount || 2);
  const pins = {};
  for (let index = 0; index < count; index += 1) {
    pins[`in${index}`] = {
      x,
      y: Math.round(y + ((index + 1) * height) / (count + 1))
    };
  }
  pins.out = { x: x + width, y: Math.round(y + height / 2) };
  return pins;
}

function gatePins(type, x, y, width, height, visualInputCount = 2) {
  const cy = Math.round(y + height / 2);
  if (type === "NOT") {
    return {
      in0: { x, y: cy },
      out: { x: x + width, y: cy }
    };
  }
  if (type === "CONST") {
    return {
      out: { x: x + width, y: cy }
    };
  }
  if (type === "WIRE") {
    return {
      in0: { x, y: cy },
      out: { x: x + width, y: cy }
    };
  }
  return multiInputPins(x, y, width, height, visualInputCount);
}

function flipFlopPins(stateVariable, flipFlopType, x, y, width, height) {
  const suffix = stateVariable.slice(1);
  const pins = {
    CLK: { x: x + Math.round(width * 0.5), y: y + height },
    Q: { x: x + width, y: y + Math.round(height * 0.28) },
    QN: { x: x + width, y: y + Math.round(height * 0.72) }
  };
  if (flipFlopType === "JK") {
    pins[`J${suffix}`] = { x, y: y + Math.round(height * 0.28) };
    pins[`K${suffix}`] = { x, y: y + Math.round(height * 0.72) };
    return pins;
  }
  const inputName = `${flipFlopType}${suffix}`;
  pins[inputName] = { x, y: y + Math.round(height * 0.36) };
  return pins;
}

function offsetPoints(points) {
  return points.map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }));
}

function manhattanWirePoints(source, target, preferredX = null) {
  const start = { x: Math.round(source.x), y: Math.round(source.y) };
  const end = { x: Math.round(target.x), y: Math.round(target.y) };
  if (start.x === end.x || start.y === end.y) return [start, end];
  const midX = preferredX ?? Math.round((start.x + end.x) / 2);
  return offsetPoints([start, { x: midX, y: start.y }, { x: midX, y: end.y }, end]);
}

function inputOrderRank(signal) {
  if (typeof getSignalInputOrderRank === "function") return getSignalInputOrderRank(signal);
  const index = INPUT_ORDER.indexOf(signal);
  return index >= 0 ? index : INPUT_ORDER.length + 100;
}

function sortSignalsForAnd(signals = []) {
  return [...signals].sort((left, right) => {
    const rankDelta = inputOrderRank(left) - inputOrderRank(right);
    return rankDelta || left.localeCompare(right);
  });
}

function isFeedbackSignal(signal) {
  return /^Q\d+'?$/.test(String(signal || ""));
}

function orInputRank(ref) {
  if (ref?.kind === "direct" && isFeedbackSignal(ref.sourceSignal)) {
    const index = OR_DIRECT_ORDER.indexOf(ref.sourceSignal);
    return index >= 0 ? index : OR_DIRECT_ORDER.length;
  }
  return 100 + (ref?.sourceY ?? 0) / 10000;
}

function makeProtectedBox(component, config) {
  const margin = component.kind === "flipFlop"
    ? config.componentClearance + 8
    : component.kind === "gate"
      ? config.componentClearance
      : 8;
  return inflateBox(component.bbox, margin);
}

function addComponent(layout, component) {
  const normalized = {
    ...component,
    bbox: bbox(component.x, component.y, component.width, component.height)
  };
  normalized.protectedBox = makeProtectedBox(normalized, layout.config);
  layout.components.push(normalized);
  layout.componentById.set(normalized.id, normalized);
  Object.entries(normalized.pins || {}).forEach(([pinName, pin]) => {
    layout.pins[`${normalized.id}.${pinName}`] = {
      ...pin,
      componentId: normalized.id,
      pinName
    };
  });
  if (normalized.kind === "gate") layout.gates.push(normalized);
  if (normalized.kind === "flipFlop") layout.flipFlops.push(normalized);
  return normalized;
}

function updateComponentGeometry(layout, component, x, y) {
  const dx = Math.round(x - component.x);
  const dy = Math.round(y - component.y);
  component.x = Math.round(x);
  component.y = Math.round(y);
  component.bbox = bbox(component.x, component.y, component.width, component.height);
  component.protectedBox = makeProtectedBox(component, layout.config);
  Object.entries(component.pins || {}).forEach(([pinName, pin]) => {
    pin.x += dx;
    pin.y += dy;
    layout.pins[`${component.id}.${pinName}`] = {
      ...pin,
      componentId: component.id,
      pinName
    };
  });
}

function addLabel(layout, label) {
  layout.labels.push({
    ...label,
    bbox: bbox(label.x, label.y - 16, Math.max(34, String(label.text || "").length * 8), 20)
  });
}

function createBus(layout, { id, signal, signalClass, orientation = "horizontal", x = 0, y = 0, start, end, orderIndex = 0, region = "" }) {
  const busX = orientation === "vertical" ? start.x : x;
  const busY = orientation === "horizontal" ? start.y : y;
  const bus = {
    id,
    signal,
    netId: signal,
    signalClass,
    colorClass: colorClassForSignal(signalClass),
    orientation,
    x: busX,
    y: busY,
    start,
    end,
    orderIndex,
    region,
    tapPoints: []
  };
  layout.buses.push(bus);
  layout.busBySignal.set(signal, bus);
  return bus;
}

function addWire(layout, wire) {
  const signal = wire.signal || wire.netId;
  const signalClass = wire.signalClass || signalClassForSignal(signal, layout.meta.inputVariables, layout.meta.outputVariables);
  const points = compactPoints(wire.points || []);
  const normalized = {
    ...wire,
    signal,
    netId: wire.netId || signal,
    signalClass,
    colorClass: wire.colorClass || colorClassForSignal(signalClass),
    points,
    sourceX: wire.sourceX ?? points[0]?.x,
    sourceY: wire.sourceY ?? points[0]?.y,
    targetX: wire.targetX ?? points[points.length - 1]?.x,
    targetY: wire.targetY ?? points[points.length - 1]?.y
  };
  layout.wires.push(normalized);
  return normalized;
}

function compactPoints(points = []) {
  const rounded = offsetPoints(points);
  return rounded.filter((point, index) => index === 0 || point.x !== rounded[index - 1].x || point.y !== rounded[index - 1].y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function allocateTap(layout, bus, preferredCoordinate, assignedWireId, options = {}) {
  const defaultSpacing = (bus.signalClass === "input" || bus.signalClass === "input-inverted")
    ? Math.min(16, layout.config.tapPointSpacing)
    : layout.config.tapPointSpacing;
  const spacing = options.minSpacing ?? defaultSpacing;
  if (bus.orientation === "vertical") {
    const top = Math.min(bus.start.y, bus.end.y);
    const bottom = Math.max(bus.start.y, bus.end.y);
    const allowEndpointTap = bus.signalClass === "input" || bus.signalClass === "input-inverted" || options.allowEndpoint;
    const minY = Math.max(top + (allowEndpointTap ? 0 : spacing), options.minY ?? -Infinity);
    const maxY = Math.min(bottom - (allowEndpointTap ? 0 : spacing), options.maxY ?? Infinity);
    const center = clamp(Math.round(preferredCoordinate), minY, maxY);
    const candidates = [center];
    for (let step = 1; step <= 30; step += 1) {
      candidates.push(center - step * spacing, center + step * spacing);
    }
    const y = candidates
      .map((candidate) => clamp(candidate, minY, maxY))
      .find((candidate) => !bus.tapPoints.some((tap) => Math.abs(tap.y - candidate) < spacing)) ?? center;
    const tap = {
      id: `${bus.id}-tap-${bus.tapPoints.length}`,
      busId: bus.id,
      signal: bus.signal,
      netId: bus.signal,
      x: bus.x,
      y,
      assignedWireId,
      minSpacing: spacing
    };
    bus.tapPoints.push(tap);
    layout.tapPoints.push(tap);
    return tap;
  }

  const left = Math.min(bus.start.x, bus.end.x);
  const right = Math.max(bus.start.x, bus.end.x);
  const minX = Math.max(left + spacing, options.minX ?? -Infinity);
  const maxX = Math.min(right - spacing, options.maxX ?? Infinity);
  const center = clamp(Math.round(preferredCoordinate), minX, maxX);
  const candidates = [center];
  for (let step = 1; step <= 30; step += 1) {
    candidates.push(center - step * spacing, center + step * spacing);
  }
  const x = candidates
    .map((candidate) => clamp(candidate, minX, maxX))
    .find((candidate) => !bus.tapPoints.some((tap) => Math.abs(tap.x - candidate) < spacing)) ?? center;
  const tap = {
    id: `${bus.id}-tap-${bus.tapPoints.length}`,
    busId: bus.id,
    signal: bus.signal,
    netId: bus.signal,
    x,
    y: bus.y,
    assignedWireId,
    minSpacing: spacing
  };
  bus.tapPoints.push(tap);
  layout.tapPoints.push(tap);
  return tap;
}

function addFeedbackTap(layout, bus, point, assignedWireId, section) {
  const tap = {
    id: `${bus.id}-${section}-tap-${bus.tapPoints.length}`,
    busId: bus.id,
    signal: bus.signal,
    netId: bus.signal,
    x: Math.round(point.x),
    y: Math.round(point.y),
    assignedWireId,
    minSpacing: layout.config.tapPointSpacing,
    section
  };
  bus.tapPoints.push(tap);
  if (section === "upper") bus.upperTapPoints.push(tap);
  if (section === "return") bus.returnTapPoints.push(tap);
  layout.tapPoints.push(tap);
  return tap;
}

function addFeedbackToPinWire(layout, signal, targetComponent, pinName, metadata = {}) {
  const bus = layout.busBySignal.get(signal);
  const targetPin = targetComponent.pins[pinName];
  if (!bus || !targetPin) return null;
  const wireId = metadata.id || `wire-${sanitizeId(signal)}-to-${targetComponent.id}-${pinName}`;
  const section = targetComponent.type === "OR" ? "upper" : "return";
  const tap = section === "upper"
    ? addFeedbackTap(
        layout,
        bus,
        {
          x: clamp(
            targetPin.x - 34 - bus.orderIndex * 18 - bus.upperTapPoints.length * Math.max(10, Math.round(layout.config.branchLaneSpacing * 0.5)),
            bus.returnX + layout.config.tapPointSpacing,
            bus.riseX - layout.config.tapPointSpacing
          ),
          y: bus.topY
        },
        wireId,
        section
      )
    : addFeedbackTap(layout, bus, { x: bus.returnX, y: targetPin.y }, wireId, section);
  const points = section === "upper"
    ? [tap, { x: tap.x, y: targetPin.y }, targetPin]
    : [tap, targetPin];
  return addWire(layout, {
    id: wireId,
    signal,
    source: tap.id,
    target: targetReference(targetComponent, pinName),
    fromPin: tap,
    toPin: targetPin,
    points,
    equationTarget: metadata.equationTarget,
    routingRole: section === "upper" ? "feedback-upper-to-or-input" : "feedback-return-to-and-input",
    sourceComponentId: bus.id,
    targetComponentId: targetComponent.id,
    targetPinName: pinName,
    comesFromBusTap: true,
    feedbackSection: section,
    preferredRouteDirection: section === "upper" ? "vertical-drop" : "horizontal-branch"
  });
}

function nextTapX(layout, bus, targetPin, role = "input") {
  if (role === "feedback-source") {
    return bus.end.x - (bus.tapPoints.length + 1) * layout.config.tapPointSpacing;
  }
  if (role === "clock") return targetPin.x;
  const serialX = bus.start.x + (bus.tapPoints.length + 1) * layout.config.tapPointSpacing;
  return Math.min(targetPin.x - layout.config.tapPointSpacing * 2, serialX);
}

function nextTapCoordinate(layout, bus, targetPin, role = "input", targetComponent = null) {
  if (bus.orientation === "vertical") {
    if (bus.signalClass === "input" || bus.signalClass === "input-inverted") {
      return clamp(targetPin.y, bus.start.y, bus.end.y);
    }
    const serialY = bus.start.y + (bus.tapPoints.length + 1) * layout.config.tapPointSpacing;
    return clamp(targetPin.y, serialY, bus.end.y - layout.config.tapPointSpacing);
  }
  if (bus.signalClass === "feedback" && role !== "feedback-source") {
    if (targetComponent?.type === "OR") {
      const orLaneIndex = layout.feedbackOrBranchCursor || 0;
      layout.feedbackOrBranchCursor = orLaneIndex + 1;
      const laneX = targetPin.x - 22 - (orLaneIndex % 3) * 18;
      const leftLimit = layout.config.andStageX + gateSize("AND").width + 34;
      return clamp(laneX, leftLimit, targetPin.x - 18);
    }
    const laneIndex = layout.feedbackBranchCursor || 0;
    layout.feedbackBranchCursor = laneIndex + 1;
    const laneX = targetPin.x - 36 - laneIndex * Math.max(14, Math.round(layout.config.tapPointSpacing * 0.35));
    const leftLimit = layout.config.inputBusRegionX + layout.config.inputBusSpacing * 2 + 28;
    return clamp(laneX, leftLimit, targetPin.x - 18);
  }
  return nextTapX(layout, bus, targetPin, role);
}

function targetReference(component, pinName) {
  return `${component.id}.${pinName}`;
}

function addBusToPinWire(layout, signal, targetComponent, pinName, metadata = {}) {
  const bus = layout.busBySignal.get(signal);
  const targetPin = targetComponent.pins[pinName];
  if (!bus || !targetPin) return null;
  if (bus.signalClass === "feedback") {
    return addFeedbackToPinWire(layout, signal, targetComponent, pinName, metadata);
  }
  const wireId = metadata.id || `wire-${sanitizeId(signal)}-to-${targetComponent.id}-${pinName}`;
  const tap = allocateTap(layout, bus, nextTapCoordinate(layout, bus, targetPin, metadata.routingRole || "input", targetComponent), wireId);
  let points;
  if (targetComponent.kind === "flipFlop") {
    const approachX = targetPin.x - 54;
    const targetCenter = centerY(targetComponent);
    const safeY = targetPin.y >= targetCenter ? targetPin.y + 70 : targetPin.y - 70;
    points = [
      tap,
      { x: tap.x, y: safeY },
      { x: approachX, y: safeY },
      { x: approachX, y: targetPin.y },
      targetPin
    ];
  } else if (bus.orientation === "vertical") {
    const laneX = Math.round((tap.x + targetPin.x) / 2);
    points = tap.y === targetPin.y
      ? [tap, targetPin]
      : [tap, { x: laneX, y: tap.y }, { x: laneX, y: targetPin.y }, targetPin];
  } else {
    const laneX = tap.x;
    points = laneX === targetPin.x
      ? [tap, targetPin]
      : [tap, { x: laneX, y: targetPin.y }, targetPin];
  }
  return addWire(layout, {
    id: wireId,
    signal,
    source: tap.id,
    target: targetReference(targetComponent, pinName),
    fromPin: tap,
    toPin: targetPin,
    points,
    equationTarget: metadata.equationTarget,
    routingRole: metadata.routingRole || "bus-to-pin",
    sourceComponentId: bus.id,
    targetComponentId: targetComponent.id,
    targetPinName: pinName,
    comesFromBusTap: true,
    preferredRouteDirection: "vertical-branch"
  });
}

function addPinToPinWire(layout, signal, sourceComponent, sourcePinName, targetComponent, targetPinName, metadata = {}) {
  const sourcePin = sourceComponent.pins[sourcePinName];
  const targetPin = targetComponent.pins[targetPinName];
  if (!sourcePin || !targetPin) return null;
  const preferredX = metadata.preferredX ?? Math.round((sourcePin.x + targetPin.x) / 2);
  const wireId = metadata.id || `wire-${sourceComponent.id}-${sourcePinName}-to-${targetComponent.id}-${targetPinName}`;
  return addWire(layout, {
    id: wireId,
    signal,
    source: targetReference(sourceComponent, sourcePinName),
    target: targetReference(targetComponent, targetPinName),
    fromPin: sourcePin,
    toPin: targetPin,
    points: manhattanWirePoints(sourcePin, targetPin, preferredX),
    equationTarget: metadata.equationTarget,
    routingRole: metadata.routingRole || "pin-to-pin",
    sourceComponentId: sourceComponent.id,
    sourcePinName,
    targetComponentId: targetComponent.id,
    targetPinName,
    preferredRouteDirection: "horizontal-then-vertical"
  });
}

function createLayoutShell(netlist, result, options) {
  const config = mergeLayoutConfig(options.config);
  const inputVariables = unique(options.inputVariables?.length ? options.inputVariables : netlist.inputs || []);
  const outputVariables = unique(options.outputVariables?.length ? options.outputVariables : netlist.outputs || []);
  const stateVariables = stateVariablesFor(result, netlist);
  const metadata = {
    phase: "phase-2-deterministic-layout",
    inputVariables,
    outputVariables,
    stateVariables,
    flipFlopType: options.flipFlopType || result?.flipFlopType || "D",
    feedbackBusOrder: netlist.metadata?.feedbackBusOrder?.length
      ? netlist.metadata.feedbackBusOrder
      : stateVariables.flatMap((stateVariable) => [stateVariable, `${stateVariable}'`]),
    flipFlopPlacement: netlist.metadata?.flipFlopPlacement || stateVariables.map((stateVariable, index) => ({
      stateVariable,
      role: index === 0 ? "upper" : index === 1 ? "lower" : `extra-${index}`,
      order: index
    })),
    inputOrderPriority: netlist.metadata?.inputOrderPriority || [...INPUT_ORDER],
    inputBuses: netlist.metadata?.inputBuses || [],
    invertedInputs: netlist.metadata?.invertedInputs || [],
    targetMap: { ...(netlist.targetMap || {}) },
    layoutIntent: "fixed regions, fixed feedback bus order, visual SOP AND/OR stages"
  };

  return {
    width: 0,
    height: 0,
    regions: {},
    components: [],
    gates: [],
    flipFlops: [],
    buses: [],
    tapPoints: [],
    wires: [],
    labels: [],
    pins: {},
    metadata,
    meta: metadata,
    config,
    validationHints: {
      minTapPointSpacing: config.tapPointSpacing,
      stageColumns: {
        inputPreprocess: config.inputBusRegionX,
        and: config.andStageX,
        or: config.orStageX,
        flipFlop: config.ffStageX,
        output: config.outputStageX
      },
      feedbackBusOrder: metadata.feedbackBusOrder,
      directionAwareSpacing: {
        horizontalConflict: "increase vertical spacing first",
        verticalConflict: "increase horizontal spacing first"
      }
    },
    busBySignal: new Map(),
    componentById: new Map(),
    targetPins: new Map(),
    sourceBySignal: new Map(),
    feedbackBranchCursor: 0,
    feedbackOrBranchCursor: 0,
    equationLayouts: [],
    targetConnections: []
  };
}

function defineRegions(layout, dimensions) {
  const { config } = layout;
  layout.regions = {
    source: { x: config.sourceRegionX, y: dimensions.feedbackStartY - 28, width: 90, height: dimensions.logicBottomY - dimensions.feedbackStartY },
    feedback: {
      x: config.feedbackRegionX,
      y: dimensions.feedbackStartY,
      width: dimensions.feedbackEndX - config.feedbackRegionX,
      height: dimensions.feedbackBusCount * config.feedbackBusSpacing
    },
    inputBus: { x: config.inputBusRegionX, y: dimensions.feedbackStartY, width: config.andStageX - config.inputBusRegionX, height: dimensions.logicBottomY - dimensions.feedbackStartY },
    andStage: { x: config.andStageX, y: 170, width: 120, height: dimensions.logicBottomY - 170 },
    orStage: { x: config.orStageX, y: 170, width: 130, height: dimensions.logicBottomY - 170 },
    flipFlop: { x: config.ffStageX, y: config.ffTopY, width: config.ffWidth, height: dimensions.ffBottomY - config.ffTopY },
    output: { x: config.outputStageX, y: dimensions.outputStartY - 60, width: 120, height: 150 },
    clk: { x: config.sourceRegionX, y: dimensions.clockY - 22, width: dimensions.feedbackEndX - config.sourceRegionX, height: 44 }
  };
}

function createInputBuses(layout, netlist, dimensions) {
  const { config, meta } = layout;
  const inputSignal = meta.inputVariables[0] || "X";
  const xBusX = config.inputBusRegionX;
  const xPrimeBusX = config.andStageX - 54;
  const busTopY = config.inputBusTopY;
  const busBottomY = dimensions.clockY + config.canvasPadding * 6;
  const xBus = createBus(layout, {
    id: "bus-X",
    signal: inputSignal,
    signalClass: "input",
    orientation: "vertical",
    x: xBusX,
    start: { x: xBusX, y: busTopY },
    end: { x: xBusX, y: busBottomY },
    region: "input"
  });
  addLabel(layout, { id: `${xBus.id}-label`, text: xBus.signal, x: xBus.start.x - 28, y: xBus.start.y - 16, busId: xBus.id });

  const invertedSignals = unique([
    ...(netlist.metadata?.invertedInputs || []).map((item) => item.invertedSignal),
    ...meta.inputVariables.map((input) => `${input}'`).filter((signal) => netlist.nets?.some((net) => net.id === signal))
  ]);

  invertedSignals.forEach((signal, index) => {
    const input = signal.slice(0, -1);
    const notSize = gateSize("NOT", 1);
    const y = busTopY + 10 + index * config.inputBusSpacing;
    const notGate = addComponent(layout, {
      id: `not-${sanitizeId(input)}`,
      kind: "gate",
      type: "NOT",
      x: xBusX + 34,
      y: Math.round(y - notSize.height / 2),
      width: notSize.width,
      height: notSize.height,
      pins: gatePins("NOT", xBusX + 34, Math.round(y - notSize.height / 2), notSize.width, notSize.height, 1),
      stage: 0,
      signal,
      outputSignal: signal,
      visualInputCount: 1,
      routingRole: "input-inverter"
    });
    layout.sourceBySignal.set(signal, { kind: "pin", componentId: notGate.id, pinName: "out", signal });

    const bus = createBus(layout, {
      id: `bus-${sanitizeId(signal)}`,
      signal,
      signalClass: "input-inverted",
      orientation: "vertical",
      x: xPrimeBusX,
      start: { x: xPrimeBusX, y },
      end: { x: xPrimeBusX, y: busBottomY },
      region: "input-inverted"
    });
    const tap = allocateTap(layout, xBus, notGate.pins.in0.y, `wire-${xBus.signal}-to-${notGate.id}-in0`, {
      minSpacing: 0,
      minY: notGate.pins.in0.y,
      maxY: notGate.pins.in0.y
    });
    addWire(layout, {
      id: `wire-${xBus.signal}-to-${notGate.id}-in0`,
      signal: xBus.signal,
      source: tap.id,
      target: `${notGate.id}.in0`,
      fromPin: tap,
      toPin: notGate.pins.in0,
      points: [tap, notGate.pins.in0],
      targetComponentId: notGate.id,
      targetPinName: "in0",
      routingRole: "input-bus-to-inverter",
      comesFromBusTap: true
    });
    addWire(layout, {
      id: `wire-${notGate.id}-to-${bus.id}`,
      signal,
      source: `${notGate.id}.out`,
      target: bus.id,
      fromPin: notGate.pins.out,
      toPin: bus.start,
      points: [notGate.pins.out, { x: bus.start.x, y: notGate.pins.out.y }, bus.start],
      sourceComponentId: notGate.id,
      sourcePinName: "out",
      routingRole: "inverter-to-inverted-bus"
    });
  });

  layout.meta.xBusCount = 1;
  layout.meta.xInverterCount = invertedSignals.length;
  layout.meta.inputBusRegionEndX = dimensions.inputBusEndX;
}

function createFlipFlops(layout) {
  const { config, meta } = layout;
  meta.stateVariables.forEach((stateVariable, index) => {
    const y = config.ffTopY + index * config.ffVerticalSpacing;
    const ff = addComponent(layout, {
      id: `ff-${stateVariable}`,
      kind: "flipFlop",
      type: `${meta.flipFlopType}-FF`,
      stateVariable,
      x: config.ffStageX,
      y,
      width: config.ffWidth,
      height: config.ffHeight,
      pins: flipFlopPins(stateVariable, meta.flipFlopType, config.ffStageX, y, config.ffWidth, config.ffHeight),
      orderIndex: index,
      role: index === 0 ? "upper" : index === 1 ? "lower" : `extra-${index}`
    });
    Object.entries(ff.pins).forEach(([pinName, pin]) => {
      if (/^[DJKT]\d+$/.test(pinName)) {
        layout.targetPins.set(pinName, { ...pin, componentId: ff.id, pinName });
      }
    });
  });
}

function createFeedbackBuses(layout, dimensions) {
  const { config, meta } = layout;
  const order = meta.feedbackBusOrder.length
    ? meta.feedbackBusOrder
    : meta.stateVariables.flatMap((stateVariable) => [stateVariable, `${stateVariable}'`]);

  order.forEach((signal, index) => {
    const y = dimensions.feedbackStartY + index * config.feedbackBusSpacing;
    const returnX = config.andStageX - 140 + index * 18;
    const riseX = config.ffStageX + config.ffWidth + 62 + index * 24;
    const bus = createBus(layout, {
      id: `bus-feedback-${sanitizeId(signal)}`,
      signal,
      signalClass: "feedback",
      orientation: "vertical",
      x: returnX,
      y,
      start: { x: returnX, y },
      end: { x: returnX, y },
      orderIndex: index,
      region: "feedback-pullback"
    });
    bus.renderAsBus = false;
    bus.topY = y;
    bus.returnX = returnX;
    bus.riseX = riseX;
    bus.upperStart = { x: returnX, y };
    bus.upperEnd = { x: riseX, y };
    bus.returnTapPoints = [];
    bus.upperTapPoints = [];
  });
  layout.meta.feedbackNets = order;
}

function createClockBus(layout, dimensions) {
  const { config } = layout;
  const bus = createBus(layout, {
    id: "bus-CLK",
    signal: "CLK",
    signalClass: "clock",
    y: dimensions.clockY,
    start: { x: config.sourceRegionX, y: dimensions.clockY },
    end: { x: dimensions.feedbackEndX, y: dimensions.clockY },
    region: "clock"
  });
  addLabel(layout, { id: "bus-CLK-label", text: "CLK", x: bus.start.x, y: bus.y - 18, busId: bus.id });
}

function createOutputPins(layout, outputVariables, dimensions) {
  outputVariables.forEach((output, index) => {
    const y = dimensions.outputStartY + index * layout.config.equationGroupSpacing;
    const component = addComponent(layout, {
      id: `output-${output}`,
      kind: "output",
      type: "OUTPUT_PIN",
      x: layout.config.outputStageX,
      y: y - 22,
      width: 82,
      height: 44,
      pins: {
        in: { x: layout.config.outputStageX, y }
      },
      output,
      stage: "output",
      signal: output
    });
    layout.targetPins.set(output, { ...component.pins.in, componentId: component.id, pinName: "in" });
  });
}

function sourceYForSignal(layout, signal, fallbackY) {
  const bus = layout.busBySignal.get(signal);
  if (bus) return bus.y;
  const source = layout.sourceBySignal.get(signal);
  if (source?.componentId) {
    const component = layout.componentById.get(source.componentId);
    return component?.pins[source.pinName]?.y ?? fallbackY;
  }
  return fallbackY;
}

function createGateComponent(layout, { id, type, x, centerYValue, visualInputCount, stage, equationTarget, signal, inputOrder = [], sourceTermIndex = null, sourceSignal = null }) {
  const size = gateSize(type, visualInputCount);
  const y = Math.round(centerYValue - size.height / 2);
  const component = addComponent(layout, {
    id,
    kind: "gate",
    type,
    x,
    y,
    width: size.width,
    height: size.height,
    pins: gatePins(type, x, y, size.width, size.height, visualInputCount),
    stage,
    equationTarget,
    signal,
    outputSignal: signal,
    visualInputCount,
    inputOrder,
    sourceTermIndex,
    sourceSignal,
    routingRole: type === "AND" ? "product-term" : type === "OR" ? "sum-of-products" : "source"
  });
  if (signal) {
    layout.sourceBySignal.set(signal, { kind: "pin", componentId: component.id, pinName: "out", signal });
  }
  return component;
}

function targetRowFor(layout, target, dimensions) {
  const pin = layout.targetPins.get(target);
  if (pin) return pin.y;
  return dimensions.outputStartY;
}

function constantSourceXFor(layout, target) {
  const targetPin = layout.targetPins.get(target);
  if (!targetPin) return layout.config.andStageX;
  const targetComponent = layout.componentById.get(targetPin.componentId);
  if (targetComponent?.kind === "flipFlop") return targetPin.x - 134;
  if (targetComponent?.kind === "output") return targetPin.x - 108;
  return layout.config.andStageX;
}

function termsForPlan(plan) {
  if (plan?.productTerms?.length) return plan.productTerms;
  return [];
}

function createProductTermLayouts(layout, equations, dimensions) {
  equations.forEach((equation) => {
    const plan = equation.visualGatePlan;
    const target = equation.target;
    const targetRow = targetRowFor(layout, target, dimensions);
    const andTerms = termsForPlan(plan).filter((term) => term.visualGateType === "AND");
    const andTermIndex = new Map(andTerms.map((term, index) => [term.id, index]));
    const andCenterOffset = (andTerms.length - 1) / 2;
    const termRefs = termsForPlan(plan).map((term) => {
      if (term.visualGateType === "AND") {
        const orderedSignals = sortSignalsForAnd(term.sourceSignals || term.literals?.map((literal) => literal.signal) || []);
        const index = andTermIndex.get(term.id) || 0;
        const center = targetRow + (index - andCenterOffset) * layout.config.gateVerticalSpacing;
        const gate = createGateComponent(layout, {
          id: `${term.id}-and`,
          type: "AND",
          x: layout.config.andStageX,
          centerYValue: center,
          visualInputCount: term.visualInputCount,
          stage: 1,
          equationTarget: target,
          signal: term.outputSignal,
          inputOrder: orderedSignals,
          sourceTermIndex: term.sourceTermIndex,
          sourceSignal: term.outputSignal
        });
        return {
          termId: term.id,
          kind: "and",
          componentId: gate.id,
          sourceSignal: term.outputSignal,
          sourceTermIndex: term.sourceTermIndex,
          sourceY: centerY(gate),
          sourceX: gate.pins.out.x,
          equationTarget: target,
          inputSignals: orderedSignals
        };
      }

      if (term.visualGateType === "CONST") {
        const value = term.sourceSignals?.[0]?.replace("CONST_", "") || "1";
        const gate = createGateComponent(layout, {
          id: `${term.id}-const-${value}`,
          type: "CONST",
          x: constantSourceXFor(layout, target),
          centerYValue: targetRow,
          visualInputCount: 0,
          stage: 1,
          equationTarget: target,
          signal: term.outputSignal,
          inputOrder: [],
          sourceTermIndex: term.sourceTermIndex,
          sourceSignal: term.outputSignal
        });
        gate.constantValue = value;
        return {
          termId: term.id,
          kind: "const",
          componentId: gate.id,
          sourceSignal: term.outputSignal,
          sourceTermIndex: term.sourceTermIndex,
          sourceY: centerY(gate),
          sourceX: gate.pins.out.x,
          equationTarget: target
        };
      }

      const sourceSignal = term.sourceSignals?.[0] || term.outputSignal;
      return {
        termId: term.id,
        kind: "direct",
        sourceSignal,
        sourceTermIndex: term.sourceTermIndex,
        sourceY: sourceYForSignal(layout, sourceSignal, targetRow),
        sourceX: layout.busBySignal.get(sourceSignal)?.start?.x ?? layout.config.feedbackRegionX,
        equationTarget: target,
        inputSignals: [sourceSignal]
      };
    });

    if (plan?.constantValue === "0" || plan?.constantValue === "1") {
      const gate = createGateComponent(layout, {
        id: `eq-${sanitizeId(target)}-const-${plan.constantValue}`,
        type: "CONST",
        x: constantSourceXFor(layout, target),
        centerYValue: targetRow,
        visualInputCount: 0,
        stage: 1,
        equationTarget: target,
        signal: plan.sourceSignal,
        inputOrder: [],
        sourceSignal: plan.sourceSignal
      });
      gate.constantValue = plan.constantValue;
      termRefs.push({
        termId: `eq-${sanitizeId(target)}-const`,
        kind: "const",
        componentId: gate.id,
        sourceSignal: plan.sourceSignal,
        sourceY: centerY(gate),
        sourceX: gate.pins.out.x,
        equationTarget: target
      });
    }

    layout.equationLayouts.push({
      target,
      targetRow,
      visualGatePlan: plan,
      termRefs,
      finalSourceRef: null,
      orComponentId: null
    });
  });
}

function spreadStage(layout, stage, minGap = null) {
  const gates = layout.gates
    .filter((gate) => gate.stage === stage && !["NOT", "CONST", "WIRE"].includes(gate.type))
    .sort((left, right) => centerY(left) - centerY(right));
  const gap = minGap ?? layout.config.gateVerticalSpacing;
  let cursorBottom = -Infinity;
  gates.forEach((gate) => {
    if (gate.y <= cursorBottom + gap) {
      updateComponentGeometry(layout, gate, gate.x, cursorBottom + gap);
    }
    cursorBottom = gate.y + gate.height;
  });
}

function spreadAndStageByGroups(layout) {
  const gates = layout.gates
    .filter((gate) => gate.stage === 1 && gate.type === "AND")
    .sort((left, right) => centerY(left) - centerY(right));
  let cursorBottom = -Infinity;
  let previousTarget = null;
  gates.forEach((gate) => {
    const gap = previousTarget === gate.equationTarget
      ? layout.config.andGateIntraGroupGap
      : layout.config.andGateInterGroupGap;
    if (gate.y <= cursorBottom + gap) {
      updateComponentGeometry(layout, gate, gate.x, cursorBottom + gap);
    }
    cursorBottom = gate.y + gate.height;
    previousTarget = gate.equationTarget;
  });
}

function refSourcePoint(layout, ref) {
  if (ref.kind === "and" || ref.kind === "or" || ref.kind === "const") {
    const component = layout.componentById.get(ref.componentId);
    return component?.pins.out || null;
  }
  const bus = layout.busBySignal.get(ref.sourceSignal);
  if (bus) return { x: bus.start.x, y: bus.y };
  return { x: ref.sourceX, y: ref.sourceY };
}

function isOutputTarget(layout, target) {
  return layout.meta.outputVariables.includes(target) || /^Z\d*$/.test(target);
}

function centeredOrY(layout, equationLayout, refs) {
  const andRefs = refs
    .filter((ref) => ref.kind === "and")
    .map((ref) => refSourcePoint(layout, ref))
    .filter(Boolean);
  if (andRefs.length === 0) return equationLayout.targetRow;
  const centroid = Math.round(andRefs.reduce((total, point) => total + point.y, 0) / andRefs.length);
  if (!isOutputTarget(layout, equationLayout.target)) return centroid;
  const gateHeight = gateSize("OR", refs.length).height;
  const flipFlopBottom = Math.max(0, ...(layout.flipFlops || []).map((ff) => ff.y + ff.height));
  const minCenter = flipFlopBottom + 80 + gateHeight / 2;
  return Math.round(Math.max(centroid, minCenter));
}

function alignOutputTargetToY(layout, target, y) {
  if (!isOutputTarget(layout, target)) return;
  const targetPin = layout.targetPins.get(target);
  const component = targetPin ? layout.componentById.get(targetPin.componentId) : null;
  if (!component || component.kind !== "output") return;
  updateComponentGeometry(layout, component, component.x, Math.round(y - component.height / 2));
  layout.targetPins.set(target, { ...component.pins.in, componentId: component.id, pinName: "in" });
}

function preferredFinalTargetLaneX(layout, sourceRef, targetComponent) {
  if (targetComponent?.kind === "output") {
    return Math.round((layout.config.orStageX + layout.config.outputStageX) / 2);
  }
  if (sourceRef?.kind === "or") {
    const sourceComponent = layout.componentById.get(sourceRef.componentId);
    if (sourceComponent?.protectedBox) {
      return sourceComponent.protectedBox.right + layout.config.componentClearance + 8;
    }
  }
  return Math.round((layout.config.orStageX + layout.config.ffStageX) / 2);
}

function createOrStages(layout) {
  layout.equationLayouts.forEach((equationLayout) => {
    const plan = equationLayout.visualGatePlan;
    if (!plan?.finalGate || equationLayout.termRefs.length < 2) {
      equationLayout.finalSourceRef = equationLayout.termRefs[0] || null;
      return;
    }

    const sortedRefs = [...equationLayout.termRefs]
      .map((ref) => {
        const point = refSourcePoint(layout, ref);
        return {
          ...ref,
          sourceX: point?.x ?? ref.sourceX,
          sourceY: point?.y ?? ref.sourceY
        };
      })
      .sort((left, right) => {
        const rankDelta = orInputRank(left) - orInputRank(right);
        return rankDelta || (left.sourceY - right.sourceY) || (left.sourceTermIndex ?? 0) - (right.sourceTermIndex ?? 0);
      });

    const centerYValue = centeredOrY(layout, equationLayout, sortedRefs);
    alignOutputTargetToY(layout, equationLayout.target, centerYValue);

    const gate = createGateComponent(layout, {
      id: plan.finalGate.id,
      type: "OR",
      x: layout.config.orStageX,
      centerYValue,
      visualInputCount: plan.finalGate.visualInputCount,
      stage: 2,
      equationTarget: equationLayout.target,
      signal: plan.finalGate.output,
      inputOrder: sortedRefs.map((ref) => ref.sourceSignal),
      sourceSignal: plan.finalGate.output
    });
    gate.inputTerms = sortedRefs.map((ref, index) => ({
      termId: ref.termId,
      sourceSignal: ref.sourceSignal,
      sourceY: ref.sourceY,
      sourceX: ref.sourceX,
      pinName: `in${index}`,
      sourceTermIndex: ref.sourceTermIndex
    }));
    gate.target = equationLayout.target;
    equationLayout.orComponentId = gate.id;
    equationLayout.finalSourceRef = {
      kind: "or",
      componentId: gate.id,
      sourceSignal: gate.outputSignal,
      sourceY: gate.pins.out.y,
      sourceX: gate.pins.out.x,
      equationTarget: equationLayout.target
    };
  });
}

function createSourceWires(layout) {
  const inputBus = layout.busBySignal.get(layout.meta.inputVariables[0] || "X");
  if (inputBus) {
    addWire(layout, {
      id: `wire-source-${sanitizeId(inputBus.signal)}-bus`,
      signal: inputBus.signal,
      source: `source:${inputBus.signal}`,
      target: inputBus.id,
      points: [inputBus.start, inputBus.end],
      routingRole: "input-main-bus",
      preferredRouteDirection: "horizontal"
    });
  }

  const clkBus = layout.busBySignal.get("CLK");
  if (clkBus) {
    addWire(layout, {
      id: "wire-source-CLK-bus",
      signal: "CLK",
      source: "source:CLK",
      target: clkBus.id,
      points: [clkBus.start, clkBus.end],
      routingRole: "clock-main-bus",
      preferredRouteDirection: "horizontal"
    });
  }
}

function finalizeInputBusExtents(layout) {
  (layout.buses || [])
    .filter((bus) => (bus.signalClass === "input" || bus.signalClass === "input-inverted") && bus.orientation === "vertical")
    .forEach((bus) => {
      const taps = bus.tapPoints || [];
      if (!taps.length) return;
      const logicTaps = taps.filter((tap) => !String(tap.assignedWireId || "").includes("-to-not-"));
      if (bus.signalClass === "input" && logicTaps.length === 0) {
        const tap = taps[0];
        bus.renderAsBus = false;
        bus.onlyInverterBranch = true;
        bus.start = { x: bus.x - 44, y: tap.y };
        bus.end = { x: bus.x, y: tap.y };
        return;
      }
      const lastTapY = Math.max(...taps.map((tap) => tap.y));
      if (bus.signalClass === "input") {
        const firstTapY = Math.min(...taps.map((tap) => tap.y));
        bus.start = { x: bus.x, y: firstTapY };
      }
      bus.end = { x: bus.x, y: lastTapY };
    });
}

function createFeedbackPullbackWires(layout) {
  layout.flipFlops.forEach((ff) => {
    [
      { signal: ff.stateVariable, pinName: "Q" },
      { signal: `${ff.stateVariable}'`, pinName: "QN" }
    ].forEach((item) => {
      const bus = layout.busBySignal.get(item.signal);
      const sourcePin = ff.pins[item.pinName];
      if (!bus || !sourcePin) return;
      const returnTaps = bus.returnTapPoints || [];
      const upperTaps = bus.upperTapPoints || [];
      if (!returnTaps.length && !upperTaps.length) {
        bus.unused = true;
        bus.start = { x: bus.returnX, y: bus.topY };
        bus.end = { x: bus.returnX, y: bus.topY };
        return;
      }
      const finalUpperX = upperTaps.length
        ? Math.min(...upperTaps.map((tap) => tap.x))
        : bus.returnX;
      const usesReturn = returnTaps.length > 0;
      const finalX = usesReturn ? bus.returnX : finalUpperX;
      const finalY = usesReturn ? Math.max(...returnTaps.map((tap) => tap.y)) : bus.topY;
      bus.start = { x: finalX, y: bus.topY };
      bus.end = { x: finalX, y: finalY };
      const points = [
        sourcePin,
        { x: bus.riseX, y: sourcePin.y },
        { x: bus.riseX, y: bus.topY },
        { x: finalX, y: bus.topY }
      ];
      if (usesReturn && finalY > bus.topY) points.push({ x: finalX, y: finalY });
      addWire(layout, {
        id: `wire-${ff.id}-${item.pinName}-feedback-pullback`,
        signal: item.signal,
        source: `${ff.id}.${item.pinName}`,
        target: bus.id,
        fromPin: sourcePin,
        toPin: bus.end,
        points: compactPoints(points),
        routingRole: "feedback-closed-pullback",
        sourceComponentId: ff.id,
        sourcePinName: item.pinName,
        targetComponentId: bus.id,
        preferredRouteDirection: usesReturn ? "right-up-left-down" : "right-up-left-to-or-branch",
        feedbackOrderIndex: bus.orderIndex
      });
    });
  });
}

function finalizeTapRendering(layout) {
  const branchWireByTap = new Map();
  (layout.wires || []).forEach((wire) => {
    if (!wire.comesFromBusTap) return;
    const count = branchWireByTap.get(wire.source) || 0;
    branchWireByTap.set(wire.source, count + 1);
  });

  (layout.tapPoints || []).forEach((tap) => {
    const bus = layout.busBySignal.get(tap.signal);
    const branchCount = branchWireByTap.get(tap.id) || 0;
    const isInputToInverter = String(tap.assignedWireId || "").includes("-to-not-");
    if (bus?.signalClass === "clock") {
      tap.renderDot = branchCount > 0;
    } else if (bus?.signalClass === "feedback") {
      if (tap.section === "upper") {
        const minX = Math.min(bus.riseX ?? tap.x, bus.start?.x ?? tap.x);
        const maxX = Math.max(bus.riseX ?? tap.x, bus.start?.x ?? tap.x);
        tap.renderDot = branchCount > 0 && tap.x > minX && tap.x < maxX;
      } else if (tap.section === "return") {
        const minY = Math.min(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
        const maxY = Math.max(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
        tap.renderDot = branchCount > 0 && tap.y > minY && tap.y < maxY;
      } else {
        tap.renderDot = branchCount > 0;
      }
    } else if (bus?.signalClass === "input" || bus?.signalClass === "input-inverted") {
      const minY = Math.min(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
      const maxY = Math.max(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
      const isTrueMidTrunkBranch = tap.y > minY && tap.y < maxY;
      tap.renderDot = branchCount > 0 && !isInputToInverter && isTrueMidTrunkBranch;
    } else {
      tap.renderDot = branchCount > 0;
    }
  });
}

function ensureClockBaselineClearance(layout) {
  const clkBus = layout.busBySignal.get("CLK");
  if (!clkBus) return;
  const nonClockComponentBottom = Math.max(
    0,
    ...(layout.components || [])
      .filter((component) => component.signal !== "CLK")
      .map((component) => component.y + component.height)
  );
  const nonClockWireBottom = Math.max(
    0,
    ...(layout.wires || [])
      .filter((wire) => wire.signal !== "CLK")
      .flatMap((wire) => wire.points || [])
      .map((point) => point.y)
  );
  const requiredY = Math.max(nonClockComponentBottom, nonClockWireBottom) + 90;
  if (clkBus.y >= requiredY) return;
  const dy = Math.ceil(requiredY - clkBus.y);
  clkBus.y += dy;
  clkBus.start = { x: clkBus.start.x, y: clkBus.start.y + dy };
  clkBus.end = { x: clkBus.end.x, y: clkBus.end.y + dy };
  layout.labels
    .filter((label) => label.busId === clkBus.id)
    .forEach((label) => {
      label.y += dy;
      label.bbox = bbox(label.x, label.y - 16, Math.max(34, String(label.text || "").length * 8), 20);
    });
  layout.regions.clk = {
    ...layout.regions.clk,
    y: clkBus.y - 22
  };
  layout.height = Math.max(layout.height + dy, clkBus.y + layout.config.canvasPadding);
}

function sourceToPin(layout, sourceRef, targetComponent, targetPinName, metadata = {}) {
  if (!sourceRef || !targetComponent?.pins?.[targetPinName]) return null;
  if (sourceRef.kind === "direct") {
    return addBusToPinWire(layout, sourceRef.sourceSignal, targetComponent, targetPinName, {
      ...metadata,
      routingRole: metadata.routingRole || "direct-source-to-pin"
    });
  }
  const component = layout.componentById.get(sourceRef.componentId);
  if (component) {
    return addPinToPinWire(layout, sourceRef.sourceSignal || component.outputSignal, component, "out", targetComponent, targetPinName, metadata);
  }
  return addBusToPinWire(layout, sourceRef.sourceSignal, targetComponent, targetPinName, metadata);
}

function verticalRangeForSourceToPin(layout, ref, targetComponent, targetPinName) {
  const sourcePoint = refSourcePoint(layout, ref);
  const targetPin = targetComponent?.pins?.[targetPinName];
  if (!sourcePoint || !targetPin) return null;
  return {
    top: Math.min(sourcePoint.y, targetPin.y),
    bottom: Math.max(sourcePoint.y, targetPin.y),
    sourceY: sourcePoint.y
  };
}

function shouldStaggerOrInputColumns(layout, refs, targetComponent) {
  const componentRefs = refs
    .map((ref, index) => ({ ref, index, range: verticalRangeForSourceToPin(layout, ref, targetComponent, `in${index}`) }))
    .filter((entry) => entry.ref.kind === "and" && entry.range);
  for (let leftIndex = 0; leftIndex < componentRefs.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < componentRefs.length; rightIndex += 1) {
      const left = componentRefs[leftIndex].range;
      const right = componentRefs[rightIndex].range;
      if (Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0) return true;
    }
  }
  return false;
}

function staggeredPreferredXForOrInput(layout, ref, refs, targetComponent) {
  if (ref.kind !== "and") return undefined;
  if (!shouldStaggerOrInputColumns(layout, refs, targetComponent)) return undefined;
  const sourcePoint = refSourcePoint(layout, ref);
  const sourceComponent = layout.componentById.get(ref.componentId);
  if (!sourcePoint || !sourceComponent?.pins?.out) return undefined;
  const andRefs = refs
    .filter((entry) => entry.kind === "and")
    .sort((left, right) => {
      const leftPoint = refSourcePoint(layout, left);
      const rightPoint = refSourcePoint(layout, right);
      return (leftPoint?.y ?? 0) - (rightPoint?.y ?? 0);
    });
  const orderIndex = Math.max(0, andRefs.findIndex((entry) => entry.termId === ref.termId));
  const middleIndex = Math.floor(andRefs.length / 2);
  if (andRefs.length % 2 === 1 && orderIndex === middleIndex) return undefined;
  const minLaneX = sourceComponent.pins.out.x + 34;
  const maxLaneX = Math.max(minLaneX, (targetComponent.protectedBox?.left ?? targetComponent.x) - 12);
  const pairDepth = Math.min(orderIndex, andRefs.length - 1 - orderIndex);
  const maxPairDepth = Math.max(0, Math.floor((andRefs.length - 1) / 2));
  const ratio = maxPairDepth === 0 ? 1 : (maxPairDepth - pairDepth) / maxPairDepth;
  return Math.round(minLaneX + (maxLaneX - minLaneX) * ratio);
}

function createEquationWires(layout) {
  layout.equationLayouts.forEach((equationLayout) => {
    equationLayout.termRefs.forEach((ref) => {
      if (ref.kind !== "and") return;
      const gate = layout.componentById.get(ref.componentId);
      ref.inputSignals.forEach((signal, index) => {
        addBusToPinWire(layout, signal, gate, `in${index}`, {
          id: `wire-${sanitizeId(signal)}-to-${gate.id}-in${index}`,
          equationTarget: equationLayout.target,
          routingRole: "bus-to-and-input"
        });
      });
    });

    if (equationLayout.orComponentId) {
      const orGate = layout.componentById.get(equationLayout.orComponentId);
      const orderedRefs = orGate.inputTerms.map((term) =>
        equationLayout.termRefs.find((ref) => ref.termId === term.termId)
      );
      orderedRefs.forEach((ref, index) => {
        const preferredX = staggeredPreferredXForOrInput(layout, ref, orderedRefs, orGate);
        sourceToPin(layout, ref, orGate, `in${index}`, {
          id: `wire-${sanitizeId(ref.sourceSignal)}-to-${orGate.id}-in${index}`,
          equationTarget: equationLayout.target,
          routingRole: "term-to-or-input",
          preferredX
        });
      });
    }

    const targetPin = layout.targetPins.get(equationLayout.target);
    const targetComponent = targetPin ? layout.componentById.get(targetPin.componentId) : null;
    if (targetComponent && equationLayout.finalSourceRef) {
      const targetPinName = targetPin.pinName;
      const wire = sourceToPin(layout, equationLayout.finalSourceRef, targetComponent, targetPinName, {
        id: `wire-${sanitizeId(equationLayout.finalSourceRef.sourceSignal)}-to-target-${sanitizeId(equationLayout.target)}`,
        equationTarget: equationLayout.target,
        routingRole: targetComponent.kind === "output" ? "equation-to-output" : "equation-to-ff-input",
        preferredX: preferredFinalTargetLaneX(layout, equationLayout.finalSourceRef, targetComponent)
      });
      if (wire) {
        layout.targetConnections.push({
          equationTarget: equationLayout.target,
          source: equationLayout.finalSourceRef.sourceSignal,
          target: targetReference(targetComponent, targetPinName),
          wireId: wire.id,
          targetPin,
          sourceKind: equationLayout.finalSourceRef.kind
        });
      }
    }
  });
}

function createClockBranches(layout) {
  const clkBus = layout.busBySignal.get("CLK");
  if (!clkBus) return;
  layout.flipFlops.forEach((ff, index) => {
    const targetPin = ff.pins.CLK;
    const wireId = `wire-CLK-to-${ff.id}`;
    const nextFlipFlop = layout.flipFlops[index + 1];
    const needsCenteredUpperEntry = Boolean(index === 0 && nextFlipFlop);
    const isLastFlipFlop = index === layout.flipFlops.length - 1;
    const branchX = needsCenteredUpperEntry ? ff.x - 34 : isLastFlipFlop ? targetPin.x : ff.x - 34 - index * 18;
    const tap = allocateTap(layout, clkBus, branchX, wireId);
    const entryY = needsCenteredUpperEntry
      ? Math.min(targetPin.y + 34, nextFlipFlop.y - layout.config.componentClearance)
      : targetPin.y;
    const points = needsCenteredUpperEntry
      ? [tap, { x: tap.x, y: entryY }, { x: targetPin.x, y: entryY }, targetPin]
      : tap.x === targetPin.x
        ? [tap, targetPin]
        : [tap, { x: tap.x, y: targetPin.y }, targetPin];
    addWire(layout, {
      id: wireId,
      signal: "CLK",
      source: tap.id,
      target: `${ff.id}.CLK`,
      fromPin: tap,
      toPin: targetPin,
      points,
      routingRole: "clock-branch",
      targetComponentId: ff.id,
      targetPinName: "CLK",
      comesFromBusTap: true,
      centeredClockEntry: needsCenteredUpperEntry,
      preferredRouteDirection: "vertical-branch"
    });
  });
  layout.meta.clkBranchCount = layout.flipFlops.length;
}

function layoutDimensions(layout, targetOrder) {
  const { config, meta } = layout;
  const ffCount = Math.max(1, meta.stateVariables.length);
  const ffBottomY = config.ffTopY + (ffCount - 1) * config.ffVerticalSpacing + config.ffHeight;
  const feedbackBusCount = Math.max(4, meta.feedbackBusOrder.length);
  const feedbackStartY = 56;
  const outputStartY = ffBottomY + 118;
  const outputRows = Math.max(1, targetOrder.filter((target) => meta.outputVariables.includes(target) || /^Z\d*$/.test(target)).length);
  const logicBottomY = outputStartY + (outputRows - 1) * config.equationGroupSpacing + 90;
  const clockY = logicBottomY + config.clkBusYMargin;
  const feedbackEndX = config.ffStageX + config.ffWidth + 250;
  const inputBusEndX = config.andStageX - 64;
  const width = Math.max(1240, config.outputStageX + 180 + config.canvasPadding);
  const height = Math.max(820, clockY + config.canvasPadding);
  return {
    ffBottomY,
    feedbackBusCount,
    feedbackStartY,
    outputStartY,
    logicBottomY,
    clockY,
    feedbackEndX,
    inputBusEndX,
    width,
    height
  };
}

function makeSerializableLayout(layout) {
  const { busBySignal, componentById, targetPins, sourceBySignal, ...serializable } = layout;
  serializable.equationLayouts = layout.equationLayouts.map((entry) => ({
    target: entry.target,
    targetRow: entry.targetRow,
    orComponentId: entry.orComponentId,
    finalSourceRef: entry.finalSourceRef,
    termRefs: entry.termRefs
  }));
  return serializable;
}

export function buildCircuitLayout({ netlist, result = null, inputVariables = [], outputVariables = [], flipFlopType = "D", config = {} }) {
  const actualNetlist = netlist || buildCircuitNetlist({ result, inputVariables, outputVariables });
  const layout = createLayoutShell(actualNetlist, result, { inputVariables, outputVariables, flipFlopType, config });
  const targetOrder = targetOrderFor(actualNetlist, layout.meta.outputVariables);
  const dimensions = layoutDimensions(layout, targetOrder);

  layout.width = dimensions.width;
  layout.height = dimensions.height;
  layout.validationHints.targetOrder = targetOrder;
  layout.validationHints.targetRows = {};
  defineRegions(layout, dimensions);

  createInputBuses(layout, actualNetlist, dimensions);
  createFlipFlops(layout);
  createFeedbackBuses(layout, dimensions);
  createClockBus(layout, dimensions);
  createOutputPins(layout, layout.meta.outputVariables, dimensions);

  targetOrder.forEach((target) => {
    layout.validationHints.targetRows[target] = targetRowFor(layout, target, dimensions);
  });

  createProductTermLayouts(layout, actualNetlist.equations || [], dimensions);
  spreadAndStageByGroups(layout);
  createOrStages(layout);
  spreadStage(layout, 2, layout.config.gateVerticalSpacing);

  createEquationWires(layout);
  finalizeInputBusExtents(layout);
  createFeedbackPullbackWires(layout);
  ensureClockBaselineClearance(layout);
  createSourceWires(layout);
  createClockBranches(layout);
  finalizeTapRendering(layout);

  return makeSerializableLayout(layout);
}

export function buildCircuitLayoutFromResult({ result, inputVariables = [], outputVariables = [], flipFlopType = "D", config = {} }) {
  const netlist = buildCircuitNetlist({ result, inputVariables, outputVariables });
  return buildCircuitLayout({ netlist, result, inputVariables, outputVariables, flipFlopType, config });
}
