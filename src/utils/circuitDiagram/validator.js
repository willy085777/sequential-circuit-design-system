function pointKey(point) {
  return `${Math.round(point.x)},${Math.round(point.y)}`;
}

const AND_INPUT_ORDER = ["Q0", "Q0'", "Q1", "Q1'", "X", "X'"];
const OR_DIRECT_ORDER = ["Q1'", "Q1", "Q0'", "Q0"];

function orderRank(order, signal) {
  const index = order.indexOf(signal);
  return index >= 0 ? index : order.length + 100;
}

function isFeedbackSignal(signal) {
  return /^Q\d+'?$/.test(String(signal || ""));
}

function pointsEqual(left, right) {
  return Boolean(left && right) && Math.round(left.x) === Math.round(right.x) && Math.round(left.y) === Math.round(right.y);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
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

function componentRect(component) {
  const rect = component.bbox || {
    x: component.x,
    y: component.y,
    width: component.width,
    height: component.height
  };
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function protectedRectFor(component) {
  if (component.type === "CONST") return inflateRect(visibleComponentRect(component), 2);
  const margin = component.kind === "flipFlop"
    ? 18
    : component.type === "OR"
      ? 2
    : component.type === "NOT"
      ? 6
      : component.kind === "gate"
        ? 12
        : 8;
  return inflateRect(componentRect(component), margin);
}

function constantVisibleRect(component) {
  const pin = component.pins?.out || { x: component.x + component.width, y: component.y + component.height / 2 };
  return {
    x: pin.x - 38,
    y: pin.y - 16,
    width: 37,
    height: 22
  };
}

function orVisibleRect(component) {
  const rect = componentRect(component);
  return {
    x: rect.x + rect.width * 0.02,
    y: rect.y,
    width: rect.width * 0.98,
    height: rect.height
  };
}

function visibleComponentRect(component) {
  if (component.type === "CONST") return constantVisibleRect(component);
  if (component.type === "OR") return orVisibleRect(component);
  return componentRect(component);
}

function labelRect(label) {
  const text = String(label.text || "");
  return {
    x: label.x,
    y: label.y - 15,
    width: Math.max(28, text.length * 8.2),
    height: 20
  };
}

function segmentBounds(segment) {
  const [from, to] = segment;
  return {
    x1: Math.min(from.x, to.x),
    x2: Math.max(from.x, to.x),
    y1: Math.min(from.y, to.y),
    y2: Math.max(from.y, to.y),
    horizontal: Math.round(from.y) === Math.round(to.y),
    vertical: Math.round(from.x) === Math.round(to.x)
  };
}

function segmentOrientation(segment) {
  const bounds = segmentBounds(segment);
  if (bounds.horizontal) return "horizontal";
  if (bounds.vertical) return "vertical";
  return "diagonal";
}

function wireSegments(wire) {
  const points = wire.points || [];
  const segments = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    if (!pointsEqual(points[index], points[index + 1])) segments.push([points[index], points[index + 1]]);
  }
  return segments;
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  return Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart) > 0;
}

function collinearOverlap(leftSegment, rightSegment) {
  const left = segmentBounds(leftSegment);
  const right = segmentBounds(rightSegment);
  if (left.horizontal && right.horizontal && Math.round(left.y1) === Math.round(right.y1)) {
    return rangesOverlap(left.x1, left.x2, right.x1, right.x2);
  }
  if (left.vertical && right.vertical && Math.round(left.x1) === Math.round(right.x1)) {
    return rangesOverlap(left.y1, left.y2, right.y1, right.y2);
  }
  return false;
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

function orGateHorizontalBodySpan(component, y) {
  const rect = componentRect(component);
  const relativeY = (y - rect.y) / rect.height;
  if (relativeY < -0.03 || relativeY > 1.03) return null;

  const centerDistance = Math.min(1, Math.abs(relativeY - 0.5) * 2);
  const leftCurve = rect.x + rect.width * (0.02 + 0.26 * (1 - centerDistance));
  const rightCurve = rect.x + rect.width * (1 - 0.42 * centerDistance);
  const padding = 3;
  return {
    left: leftCurve - padding,
    right: rightCurve + padding
  };
}

function segmentIntersectsOrGateBody(segment, component) {
  const bounds = segmentBounds(segment);
  const rect = componentRect(component);
  if (bounds.horizontal) {
    const span = orGateHorizontalBodySpan(component, bounds.y1);
    if (!span) return false;
    return bounds.x2 >= span.left && bounds.x1 <= span.right;
  }

  if (bounds.vertical) {
    if (bounds.x1 < rect.x - 3 || bounds.x1 > rectRight(rect) + 3) return false;
    const top = Math.max(bounds.y1, rect.y - 3);
    const bottom = Math.min(bounds.y2, rectBottom(rect) + 3);
    for (let y = top; y <= bottom; y += 4) {
      const span = orGateHorizontalBodySpan(component, y);
      if (span && bounds.x1 >= span.left && bounds.x1 <= span.right) return true;
    }
    const bottomSpan = orGateHorizontalBodySpan(component, bottom);
    return Boolean(bottomSpan && bounds.x1 >= bottomSpan.left && bounds.x1 <= bottomSpan.right);
  }

  return false;
}

function segmentIntersectsProtectedComponent(segment, component, rect) {
  if (component.type === "OR") return segmentIntersectsOrGateBody(segment, component);
  return segmentIntersectsRect(segment, rect);
}

function issue(type, message, metadata = {}) {
  return { type, message, ...metadata };
}

function pushIssue(errors, type, message, metadata = {}) {
  const entry = issue(type, message, metadata);
  errors.push(entry);
  return entry;
}

function pushWarning(warnings, type, message, metadata = {}) {
  const entry = issue(type, message, metadata);
  warnings.push(entry);
  return entry;
}

function publicResult(errors, warnings, details = {}) {
  return {
    valid: errors.length === 0,
    errors: errors.map((entry) => `${entry.type}: ${entry.message}`),
    warnings: warnings.map((entry) => `${entry.type}: ${entry.message}`),
    details: {
      ...details,
      issues: errors,
      warningIssues: warnings,
      errorTypes: [...new Set(errors.map((entry) => entry.type))]
    }
  };
}

function allPins(layout) {
  return (layout.components || []).flatMap((component) =>
    Object.entries(component.pins || {}).map(([pinName, pin]) => ({
      ...pin,
      pinName,
      componentId: component.id,
      component
    }))
  );
}

function pinMatchesEndpoint(pin, endpoint) {
  return pointsEqual(pin, endpoint);
}

function wireHasEndpointAt(wire, point) {
  const points = wire.points || [];
  return points.some((endpoint) => pointsEqual(endpoint, point));
}

function wireStartsAt(wire, point) {
  return pointsEqual((wire.points || [])[0], point);
}

function wireEndsAt(wire, point) {
  const points = wire.points || [];
  return pointsEqual(points[points.length - 1], point);
}

function segmentTouchesComponentPin(segment, component) {
  return Object.values(component.pins || {}).some((pin) => pointsEqual(segment[0], pin) || pointsEqual(segment[1], pin));
}

function endpointIsLegal(layout, endpoint) {
  if (allPins(layout).some((pin) => pointsEqual(pin, endpoint))) return true;
  if ((layout.tapPoints || []).some((tap) => pointsEqual(tap, endpoint))) return true;
  if ((layout.buses || []).some((bus) => pointsEqual(bus.start, endpoint) || pointsEqual(bus.end, endpoint))) return true;
  return false;
}

function componentCollisionType(left, right) {
  const kinds = [left.kind, right.kind];
  if (kinds.includes("gate") && kinds.includes("gate")) return "GATE_GATE_COLLISION";
  if (kinds.includes("gate") && kinds.includes("flipFlop")) return "GATE_FF_COLLISION";
  if (kinds.includes("label")) return "LABEL_OVERLAP";
  return "COMPONENT_OVERLAP";
}

function visibleComponents(layout) {
  return [
    ...(layout.components || []),
    ...(layout.labels || []).map((label) => ({
      id: label.id,
      kind: "label",
      type: "LABEL",
      x: labelRect(label).x,
      y: labelRect(label).y,
      width: labelRect(label).width,
      height: labelRect(label).height,
      bbox: labelRect(label),
      pins: {}
    }))
  ];
}

function gateInputPinNames(gate) {
  if (gate.type === "CONST") return [];
  if (gate.type === "NOT" || gate.type === "WIRE") return ["in0"];
  return Object.keys(gate.pins || {})
    .filter((pinName) => /^in\d+$/.test(pinName))
    .sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
}

function busForSignal(layout, signal) {
  return (layout.buses || []).find((bus) => bus.signal === signal);
}

function feedbackSignalIsUsed(layout, signal) {
  const bus = busForSignal(layout, signal);
  return Boolean(bus?.tapPoints?.length);
}

export function validateConnections(layout) {
  const errors = [];
  const warnings = [];
  const pins = allPins(layout);
  const wires = layout.wires || [];
  const componentsById = new Map((layout.components || []).map((component) => [component.id, component]));

  (layout.gates || []).forEach((gate) => {
    const inputPinNames = gateInputPinNames(gate);
    inputPinNames.forEach((pinName) => {
      const pin = gate.pins?.[pinName];
      if (!pin || !wires.some((wire) => wireEndsAt(wire, pin))) {
        pushIssue(errors, "DANGLING_PIN_CONNECTION", `${gate.id}.${pinName} has no wire ending exactly at its input pin`, {
          component: gate.id,
          pin: pinName
        });
      }
    });
    if (gate.pins?.out && !wires.some((wire) => wireStartsAt(wire, gate.pins.out))) {
      pushIssue(errors, "DANGLING_PIN_CONNECTION", `${gate.id}.out has no wire starting exactly at the output pin`, {
        component: gate.id,
        pin: "out"
      });
    }
  });

  (layout.flipFlops || []).forEach((ff) => {
    Object.entries(ff.pins || {}).forEach(([pinName, pin]) => {
      if (/^[DJKT]\d+$/.test(pinName) || pinName === "CLK") {
        if (!wires.some((wire) => wireEndsAt(wire, pin))) {
          pushIssue(errors, "DANGLING_PIN_CONNECTION", `${ff.id}.${pinName} has no exact input wire endpoint`, {
            component: ff.id,
            pin: pinName
          });
        }
      }
      if (pinName === "Q" || pinName === "QN") {
        const signal = pinName === "Q" ? ff.stateVariable : `${ff.stateVariable}'`;
        if (feedbackSignalIsUsed(layout, signal) && !wires.some((wire) => wireStartsAt(wire, pin))) {
          pushIssue(errors, "DANGLING_PIN_CONNECTION", `${ff.id}.${pinName} output does not start a feedback wire`, {
            component: ff.id,
            pin: pinName,
            signal
          });
        }
      }
    });
  });

  wires.forEach((wire) => {
    const endpoints = [wire.points?.[0], wire.points?.[wire.points.length - 1]].filter(Boolean);
    endpoints.forEach((endpoint) => {
      if (!endpointIsLegal(layout, endpoint)) {
        pushIssue(errors, "DANGLING_PIN_CONNECTION", `${wire.id} has dangling endpoint at ${pointKey(endpoint)}`, {
          wire: wire.id,
          endpoint
        });
      }
      pins.forEach((pin) => {
        const gap = distance(endpoint, pin);
        if (gap > 0 && gap <= 10) {
          pushIssue(errors, "NEAR_MISS_PIN_CONNECTION", `${wire.id} endpoint is ${gap.toFixed(1)}px from ${pin.componentId}.${pin.pinName}`, {
            wire: wire.id,
            component: pin.componentId,
            pin: pin.pinName,
            distance: gap
          });
        }
      });
    });
  });

  (layout.gates || [])
    .filter((gate) => gate.target)
    .forEach((gate) => {
      const targetWire = wires.find((wire) => wire.source === `${gate.id}.out` && wire.target?.includes(gate.target));
      if (!targetWire) {
        pushIssue(errors, "WRONG_TARGET_CONNECTION", `${gate.id} final output is not connected to target ${gate.target}`, {
          component: gate.id,
          target: gate.target
        });
      }
    });

  (layout.wires || [])
    .filter((wire) => wire.source && wire.source.includes("."))
    .forEach((wire) => {
      const [componentId, pinName] = wire.source.split(".");
      const component = componentsById.get(componentId);
      const pin = component?.pins?.[pinName];
      if (pin && !wireStartsAt(wire, pin)) {
        pushIssue(errors, "DANGLING_PIN_CONNECTION", `${wire.id} source metadata says ${wire.source}, but first point is not that pin`, {
          wire: wire.id,
          component: componentId,
          pin: pinName
        });
      }
    });

  return publicResult(errors, warnings, {
    checkedPins: pins.length,
    checkedWires: wires.length
  });
}

function validateWireOverlap(layout, errors) {
  const wires = layout.wires || [];
  for (let leftIndex = 0; leftIndex < wires.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < wires.length; rightIndex += 1) {
      const left = wires[leftIndex];
      const right = wires[rightIndex];
      if (left.netId === right.netId) continue;
      wireSegments(left).forEach((leftSegment) => {
        wireSegments(right).forEach((rightSegment) => {
          if (!collinearOverlap(leftSegment, rightSegment)) return;
          const orientation = segmentOrientation(leftSegment);
          pushIssue(errors, "WIRE_WIRE_OVERLAP", `${orientation} unrelated wires overlap: ${left.id} (${left.netId}) with ${right.id} (${right.netId})`, {
            orientation,
            wireA: left.id,
            wireB: right.id,
            netA: left.netId,
            netB: right.netId
          });
        });
      });
    }
  }
}

function validateManhattanWires(layout, errors) {
  (layout.wires || []).forEach((wire) => {
    wireSegments(wire).forEach((segment) => {
      const orientation = segmentOrientation(segment);
      if (orientation !== "diagonal") return;
      pushIssue(errors, "DIAGONAL_WIRE_ERROR", `${wire.id} contains a diagonal segment; circuit routing must be Manhattan-style`, {
        wire: wire.id,
        segment
      });
    });
  });
}

function validateWireComponentCollisions(layout, errors) {
  const components = visibleComponents(layout);
  (layout.wires || []).forEach((wire) => {
    wireSegments(wire).forEach((segment) => {
      components.forEach((component) => {
        if (component.type === "CONST" && (wire.sourceComponentId === component.id || wire.source === `${component.id}.out`)) return;
        const rect = protectedRectFor(component);
        if (!segmentIntersectsProtectedComponent(segment, component, rect)) return;
        if (segmentTouchesComponentPin(segment, component)) return;
        pushIssue(errors, "WIRE_COMPONENT_COLLISION", `${segmentOrientation(segment)} wire ${wire.id} intersects protected component ${component.id}`, {
          wire: wire.id,
          component: component.id,
          orientation: segmentOrientation(segment),
          segment,
          segmentBounds: segmentBounds(segment),
          componentBox: componentRect(component),
          protectedBox: rect,
          componentType: component.type
        });
      });
    });
  });
}

function validateComponentOverlap(layout, errors) {
  const components = visibleComponents(layout);
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const left = components[leftIndex];
      const right = components[rightIndex];
      if (!rectsOverlap(visibleComponentRect(left), visibleComponentRect(right))) continue;
      const type = componentCollisionType(left, right);
      pushIssue(errors, type, `Component ${left.id} overlaps ${right.id}`, {
        componentA: left.id,
        componentB: right.id,
        componentTypeA: left.type,
        componentTypeB: right.type,
        componentBoxA: visibleComponentRect(left),
        componentBoxB: visibleComponentRect(right)
      });
    }
  }
}

function validateBranchSpacing(layout, errors) {
  const minimumDistance = layout.validationHints?.minTapPointSpacing || layout.config?.branchPointSpacing || 36;
  (layout.buses || []).forEach((bus) => {
    const groups = bus.signalClass === "feedback"
      ? [
          { taps: (bus.tapPoints || []).filter((tap) => tap.section === "return"), axis: "y" },
          { taps: (bus.tapPoints || []).filter((tap) => tap.section === "upper"), axis: "y" }
        ]
      : [{ taps: bus.tapPoints || [], axis: bus.orientation === "vertical" ? "y" : "x" }];
    groups.forEach(({ taps, axis }) => {
      const sorted = [...taps].sort((left, right) => left[axis] - right[axis]);
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const left = sorted[index];
        const right = sorted[index + 1];
        const gap = Math.abs(right[axis] - left[axis]);
        const requiredDistance = Math.min(minimumDistance, left.minSpacing ?? minimumDistance, right.minSpacing ?? minimumDistance);
        if (gap >= requiredDistance) continue;
        pushIssue(errors, "BRANCH_POINT_TOO_CLOSE", `${bus.id} tap points ${left.id} and ${right.id} are ${gap}px apart; minimum is ${requiredDistance}px`, {
          busName: bus.id,
          branchA: left.id,
          branchB: right.id,
          distance: gap,
          minimumDistance: requiredDistance
        });
      }
    });
  });
}

function validateStageAlignment(layout, errors, warnings) {
  const byStage = new Map();
  (layout.gates || []).forEach((gate) => {
    if (gate.type === "CONST" || gate.type === "WIRE") return;
    const entries = byStage.get(gate.stage) || [];
    entries.push(gate);
    byStage.set(gate.stage, entries);
  });
  byStage.forEach((gates, stage) => {
    const xs = gates.map((gate) => gate.x);
    if (Math.max(...xs) - Math.min(...xs) > 4) {
      pushIssue(errors, "SAME_STAGE_ALIGNMENT_ERROR", `Stage ${stage} gates are not aligned to one x-column`, {
        stage,
        xValues: xs
      });
    }
    const sorted = [...gates].sort((left, right) => left.y - right.y);
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const gap = sorted[index + 1].y - rectBottom(sorted[index]);
      if (gap < 20) {
        pushIssue(errors, "SAME_GROUP_SPACING_ERROR", `Stage ${stage} gates ${sorted[index].id} and ${sorted[index + 1].id} are only ${gap}px apart`, {
          stage,
          gateA: sorted[index].id,
          gateB: sorted[index + 1].id,
          gap
        });
      }
    }
    if (sorted.length >= 3) {
      const gaps = [];
      for (let index = 0; index < sorted.length - 1; index += 1) gaps.push(sorted[index + 1].y - sorted[index].y);
      const minGap = Math.min(...gaps);
      const maxGap = Math.max(...gaps);
      if (maxGap - minGap > 96) {
        pushWarning(warnings, "SAME_GROUP_SPACING_ERROR", `Stage ${stage} gate spacing varies from ${minGap}px to ${maxGap}px`, {
          stage,
          minGap,
          maxGap
        });
      }
    }
  });
}

function validateCanvas(layout, warnings, errors) {
  (layout.components || []).forEach((component) => {
    const rect = componentRect(component);
    if (rect.x < 0 || rect.y < 0 || rectRight(rect) > layout.width || rectBottom(rect) > layout.height) {
      pushIssue(errors, "CANVAS_BOUNDS_ERROR", `${component.id} is outside the SVG canvas`, {
        component: component.id,
        rect
      });
    }
  });
  (layout.wires || []).forEach((wire) => {
    (wire.points || []).forEach((point) => {
      if (point.x < 0 || point.y < 0 || point.x > layout.width || point.y > layout.height) {
        pushIssue(errors, "CANVAS_BOUNDS_ERROR", `${wire.id} has point outside canvas at ${pointKey(point)}`, {
          wire: wire.id,
          point
        });
      }
    });
  });
  if (layout.width > 2200) {
    pushWarning(warnings, "EXCESSIVE_WIDTH_WARNING", `Circuit layout width is ${layout.width}px; consider local rerouting before expanding width`, {
      width: layout.width
    });
  }
}

function legendRectForLayout(layout) {
  return {
    x: Math.max(760, layout.width - 190),
    y: 18,
    width: 170,
    height: 150
  };
}

function validateLegendPlacement(layout, errors) {
  const legendRect = legendRectForLayout(layout);
  visibleComponents(layout).forEach((component) => {
    if (!rectsOverlap(legendRect, protectedRectFor(component))) return;
    pushIssue(errors, "LEGEND_OVERLAP", `Legend overlaps protected component ${component.id}`, {
      component: component.id,
      legendRect
    });
  });
  (layout.wires || []).forEach((wire) => {
    wireSegments(wire).forEach((segment) => {
      if (!segmentIntersectsRect(segment, legendRect)) return;
      pushIssue(errors, "LEGEND_OVERLAP", `Legend overlaps wire ${wire.id}`, {
        wire: wire.id,
        legendRect
      });
    });
  });
}

function validateAndOutputStagger(layout, errors) {
  (layout.gates || [])
    .filter((gate) => gate.type === "OR")
    .forEach((gate) => {
      const inputWires = (layout.wires || [])
        .filter((wire) => wire.routingRole === "term-to-or-input" && wire.targetComponentId === gate.id)
        .map((wire) => {
          const sourceComponent = (layout.components || []).find((component) => component.id === wire.sourceComponentId);
          const points = wire.points || [];
          const initialLength = points.length > 1 && points[0].y === points[1].y
            ? Math.max(0, points[1].x - points[0].x)
            : 0;
          return { wire, sourceComponent, initialLength };
        })
        .filter((entry) => entry.sourceComponent?.type === "AND")
        .sort((left, right) => left.sourceComponent.pins.out.y - right.sourceComponent.pins.out.y);
      if (inputWires.length < 2) return;
      let previousPairLength = Infinity;
      for (let index = 0; index < Math.floor(inputWires.length / 2); index += 1) {
        const upper = inputWires[index];
        const lower = inputWires[inputWires.length - 1 - index];
        if (Math.abs(upper.initialLength - lower.initialLength) > 2) {
          pushIssue(errors, "AND_OUTPUT_STAGGER_ERROR", `Symmetric AND outputs feeding ${gate.id} must use matching initial horizontal lengths`, {
            gate: gate.id,
            upperWire: upper.wire.id,
            lowerWire: lower.wire.id,
            upperLength: upper.initialLength,
            lowerLength: lower.initialLength
          });
        }
        const pairLength = Math.max(upper.initialLength, lower.initialLength);
        if (pairLength > previousPairLength + 2) {
          pushIssue(errors, "AND_OUTPUT_STAGGER_ERROR", `Outer AND-output pairs feeding ${gate.id} must extend farther than inner pairs`, {
            gate: gate.id,
            outerPairIndex: index - 1,
            innerPairIndex: index,
            previousPairLength,
            pairLength
          });
        }
        previousPairLength = pairLength;
      }
      if (inputWires.length % 2 === 1) {
        const middle = inputWires[Math.floor(inputWires.length / 2)];
        const middleWireHasVertical = wireSegments(middle.wire).some((segment) => segmentOrientation(segment) === "vertical");
        if (middleWireHasVertical) {
          pushIssue(errors, "AND_OUTPUT_STAGGER_ERROR", `Middle AND output feeding ${gate.id} should route directly without a vertical detour`, {
            gate: gate.id,
            middleWire: middle.wire.id
          });
        }
      }
    });
}

function validateAndToOrRoutingStyle(layout, errors) {
  (layout.wires || [])
    .filter((wire) => wire.routingRole === "term-to-or-input")
    .forEach((wire) => {
      const sourceComponent = (layout.components || []).find((component) => component.id === wire.sourceComponentId);
      const targetComponent = (layout.components || []).find((component) => component.id === wire.targetComponentId);
      if (sourceComponent?.type !== "AND" || targetComponent?.type !== "OR") return;
      const points = wire.points || [];
      if (points.length < 2) return;
      const firstSegment = [points[0], points[1]];
      if (segmentOrientation(firstSegment) === "horizontal" && points[1].x > points[0].x) return;
      pushIssue(errors, "AND_OR_ROUTING_STYLE_ERROR", `${wire.id} must leave the AND output with a short horizontal segment before turning`, {
        wire: wire.id,
        sourceComponent: sourceComponent.id,
        targetComponent: targetComponent.id,
        points
      });
    });
}

function validateOrGroupPlacement(layout, errors) {
  (layout.gates || [])
    .filter((gate) => gate.type === "OR")
    .forEach((gate) => {
      const andSources = (layout.wires || [])
        .filter((wire) => wire.routingRole === "term-to-or-input" && wire.targetComponentId === gate.id)
        .map((wire) => (layout.components || []).find((component) => component.id === wire.sourceComponentId))
        .filter((component) => component?.type === "AND");
      if (!andSources.length) return;
      const expectedCenter = Math.round(andSources.reduce((total, component) => total + component.pins.out.y, 0) / andSources.length);
      const actualCenter = Math.round(gate.y + gate.height / 2);
      if (Math.abs(actualCenter - expectedCenter) <= 4) return;
      pushIssue(errors, "OR_GROUP_ALIGNMENT_ERROR", `${gate.id} should be vertically centered on its feeding AND gate group`, {
        gate: gate.id,
        expectedCenter,
        actualCenter
      });
    });
}

function validateReferenceStyle(layout, errors, warnings) {
  const feedbackBuses = (layout.buses || [])
    .filter((bus) => bus.signalClass === "feedback")
    .sort((left, right) => left.y - right.y);
  const feedbackSignalCounts = new Map();
  feedbackBuses.forEach((bus) => {
    feedbackSignalCounts.set(bus.signal, (feedbackSignalCounts.get(bus.signal) || 0) + 1);
  });
  feedbackSignalCounts.forEach((count, signal) => {
    if (count > 1) {
      pushIssue(errors, "DUPLICATE_FEEDBACK_TRUNK", `${signal} has ${count} feedback trunks; each Q/Q' signal must use one shared trunk`, {
        signal,
        count
      });
    }
  });
  const expectedFeedbackOrder = layout.meta?.feedbackBusOrder || ["Q0", "Q0'", "Q1", "Q1'"];
  const actualOrder = feedbackBuses.map((bus) => bus.signal);
  if (expectedFeedbackOrder.length && actualOrder.join("|") !== expectedFeedbackOrder.join("|")) {
    pushIssue(errors, "FEEDBACK_ORDER_ERROR", `Feedback bus order is ${actualOrder.join(", ")}; expected ${expectedFeedbackOrder.join(", ")}`, {
      actualOrder,
      expectedFeedbackOrder
    });
  }
  feedbackBuses.forEach((bus) => {
    if (bus.renderAsBus !== false || bus.orientation !== "vertical") {
      pushIssue(errors, "FEEDBACK_STYLE_ERROR", `${bus.id} must be internal vertical tap scaffolding, not a rendered horizontal feedback bus`, {
        bus: bus.id,
        renderAsBus: bus.renderAsBus,
        orientation: bus.orientation
      });
    }
    const pullbackWire = (layout.wires || []).find((wire) => wire.routingRole === "feedback-closed-pullback" && wire.signal === bus.signal);
    const returnTaps = (bus.tapPoints || []).filter((tap) => tap.section === "return");
    const upperTaps = (bus.tapPoints || []).filter((tap) => tap.section === "upper");
    if (!bus.tapPoints?.length && pullbackWire) {
      pushIssue(errors, "UNUSED_FEEDBACK_PATH", `${bus.signal} is not used by any gate but still has a feedback pullback wire`, {
        signal: bus.signal,
        wire: pullbackWire.id
      });
    }
    if (bus.tapPoints?.length && !pullbackWire) {
      pushIssue(errors, "MISSING_FEEDBACK_PATH", `${bus.signal} is used by gates but has no feedback pullback wire`, {
        signal: bus.signal
      });
    }
    const pullbackCount = (layout.wires || []).filter((wire) => wire.routingRole === "feedback-closed-pullback" && wire.signal === bus.signal).length;
    if (pullbackCount > 1) {
      pushIssue(errors, "DUPLICATE_FEEDBACK_TRUNK", `${bus.signal} has ${pullbackCount} pullback paths; it must use one shared distribution path`, {
        signal: bus.signal,
        pullbackCount
      });
    }
    const orTrunkWires = (layout.wires || []).filter((wire) => wire.routingRole === "feedback-or-trunk" && wire.signal === bus.signal);
    if (orTrunkWires.length > 1) {
      pushIssue(errors, "DUPLICATE_FEEDBACK_OR_TRUNK", `${bus.signal} has ${orTrunkWires.length} OR-stage pull-down trunks; OR gates must share one Q trunk`, {
        signal: bus.signal,
        count: orTrunkWires.length
      });
    }
    if (upperTaps.length) {
      const uniqueUpperXs = [...new Set(upperTaps.map((tap) => Math.round(tap.x)))];
      if (uniqueUpperXs.length > 1) {
        pushIssue(errors, "DUPLICATE_FEEDBACK_OR_TRUNK", `${bus.signal} OR-stage branches use multiple x trunks (${uniqueUpperXs.join(", ")})`, {
          signal: bus.signal,
          xPositions: uniqueUpperXs
        });
      }
      const lowestUpperTapY = Math.max(...upperTaps.map((tap) => tap.y));
      if (lowestUpperTapY > bus.topY && orTrunkWires.length !== 1) {
        pushIssue(errors, "MISSING_FEEDBACK_OR_TRUNK", `${bus.signal} OR-stage branches need exactly one shared vertical pull-down trunk`, {
          signal: bus.signal,
          expectedTrunks: 1,
          actualTrunks: orTrunkWires.length
        });
      }
    }
    if (pullbackWire && upperTaps.length && !returnTaps.length) {
      const finalPoint = (pullbackWire.points || [])[pullbackWire.points.length - 1];
      const expectedX = Math.min(...upperTaps.map((tap) => tap.x));
      if (!finalPoint || finalPoint.x !== expectedX || finalPoint.y !== bus.topY || pullbackWire.points.length !== 4) {
        pushIssue(errors, "UNUSED_FEEDBACK_TAIL", `${bus.signal} is OR-only and must stop at the upper OR branch without a return tail`, {
          signal: bus.signal,
          wire: pullbackWire.id,
          points: pullbackWire.points,
          expectedX
        });
      }
    }
    if (pullbackWire && returnTaps.length) {
      const finalPoint = (pullbackWire.points || [])[pullbackWire.points.length - 1];
      const expectedY = Math.max(...returnTaps.map((tap) => tap.y));
      if (!finalPoint || finalPoint.x !== bus.returnX || finalPoint.y !== expectedY) {
        pushIssue(errors, "UNUSED_FEEDBACK_TAIL", `${bus.signal} return section must stop at the final AND branch`, {
          signal: bus.signal,
          wire: pullbackWire.id,
          points: pullbackWire.points,
          expectedY
        });
      }
    }
  });
  const usedOrTrunkBuses = feedbackBuses
    .filter((bus) => (bus.upperTapPoints || []).length)
    .sort((left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0));
  for (let index = 0; index < usedOrTrunkBuses.length - 1; index += 1) {
    const current = usedOrTrunkBuses[index];
    const next = usedOrTrunkBuses[index + 1];
    const currentX = current.upperTapPoints?.[0]?.x;
    const nextX = next.upperTapPoints?.[0]?.x;
    if (Number.isFinite(currentX) && Number.isFinite(nextX) && currentX >= nextX) {
      pushIssue(errors, "FEEDBACK_OR_TRUNK_ORDER_ERROR", "OR-stage Q pull-down trunks must be ordered left-to-right as Q0, Q0', Q1, Q1'", {
        current: current.signal,
        next: next.signal,
        currentX,
        nextX
      });
    }
  }
  for (let index = 0; index < feedbackBuses.length - 1; index += 1) {
    const current = feedbackBuses[index];
    const next = feedbackBuses[index + 1];
    if ((current.topY ?? current.y) >= (next.topY ?? next.y) || current.returnX >= next.returnX || current.riseX >= next.riseX) {
      pushIssue(errors, "FEEDBACK_ORDER_ERROR", "Feedback pullback lanes must keep Q0, Q0', Q1, Q1' order in top, return, and rise sections", {
        current: current.id,
        next: next.id
      });
    }
  }
  const topFlipFlopY = Math.min(...(layout.flipFlops || []).map((ff) => ff.y));
  feedbackBuses.forEach((bus) => {
    if (Number.isFinite(topFlipFlopY) && bus.y >= topFlipFlopY) {
      pushIssue(errors, "BOTTOM_FEEDBACK_BUS_ERROR", `${bus.id} is below the flip-flop top; feedback must use top/right pullback lanes`, {
        bus: bus.id,
        y: bus.y,
        topFlipFlopY
      });
    }
  });
  (layout.wires || [])
    .filter((wire) => wire.routingRole === "feedback-closed-pullback")
    .forEach((wire) => {
      const points = wire.points || [];
      const [start, right, topRight, topLeft, finalPoint = topLeft] = points;
      const hasShape = points.length >= 4
        && points.length <= 5
        && start
        && right
        && topRight
        && topLeft
        && right.y === start.y
        && right.x > start.x
        && topRight.x === right.x
        && topRight.y < right.y
        && topLeft.y === topRight.y
        && topLeft.x < topRight.x
        && finalPoint.x === topLeft.x
        && finalPoint.y >= topLeft.y;
      if (!hasShape) {
        pushIssue(errors, "FEEDBACK_PULLBACK_SHAPE_ERROR", `${wire.id} must route right, up, left, then down`, {
          wire: wire.id,
          points
        });
      }
    });
  (layout.wires || [])
    .filter((wire) => wire.signalClass === "feedback" && wire.routingRole !== "feedback-closed-pullback")
    .forEach((wire) => {
      const component = (layout.components || []).find((item) => item.id === wire.targetComponentId);
      if (component?.type === "AND" && wire.feedbackSection !== "return") {
        pushIssue(errors, "FEEDBACK_SOURCE_SECTION_ERROR", `${wire.id} feeds an AND gate but does not branch from the left return section`, {
          wire: wire.id,
          component: component.id,
          feedbackSection: wire.feedbackSection
        });
      }
      if (component?.type === "OR" && wire.feedbackSection !== "upper") {
        pushIssue(errors, "FEEDBACK_SOURCE_SECTION_ERROR", `${wire.id} feeds an OR gate but does not branch from the upper pullback section`, {
          wire: wire.id,
          component: component.id,
          feedbackSection: wire.feedbackSection
        });
      }
    });

  const xBus = (layout.buses || []).find((bus) => bus.signal === "X" || layout.meta?.inputVariables?.includes(bus.signal));
  const inputTrunkCounts = new Map();
  (layout.buses || [])
    .filter((bus) => bus.signalClass === "input" || bus.signalClass === "input-inverted")
    .forEach((bus) => {
      inputTrunkCounts.set(bus.signal, (inputTrunkCounts.get(bus.signal) || 0) + 1);
    });
  inputTrunkCounts.forEach((count, signal) => {
    if (count > 1) {
      pushIssue(errors, "DUPLICATE_INPUT_TRUNK", `${signal} has ${count} input distribution trunks; each input signal must use one shared trunk`, {
        signal,
        count
      });
    }
  });
  if (xBus && xBus.orientation !== "vertical") {
    pushIssue(errors, "X_BUS_LAYOUT_ERROR", `${xBus.id} is ${xBus.orientation}; X must be a left-side vertical bus`, {
      bus: xBus.id,
      orientation: xBus.orientation
    });
  }
  if (xBus) {
    const logicTaps = (xBus.tapPoints || []).filter((tap) => !String(tap.assignedWireId || "").includes("-to-not-"));
    if (logicTaps.length === 0 && xBus.renderAsBus !== false) {
      pushIssue(errors, "UNUSED_X_TRUNK", "X only feeds the inverter, so it must not render an unused vertical trunk", {
        bus: xBus.id
      });
    }
  }
  (layout.buses || [])
    .filter((bus) => bus.signalClass === "input-inverted")
    .forEach((bus) => {
      const inverterComponents = (layout.components || []).filter((component) =>
        component.type === "NOT" && component.outputSignal === bus.signal
      );
      if (inverterComponents.length !== 1) {
        pushIssue(errors, "X_PRIME_GENERATION_ERROR", `${bus.signal} must be generated by exactly one NOT gate`, {
          signal: bus.signal,
          inverterCount: inverterComponents.length
        });
      }
      const sourceWire = (layout.wires || []).find((wire) => wire.routingRole === "inverter-to-inverted-bus" && wire.signal === bus.signal);
      if (!sourceWire) {
        pushIssue(errors, "X_PRIME_GENERATION_ERROR", `${bus.signal} has no NOT-output-to-trunk connection`, {
          signal: bus.signal,
          bus: bus.id
        });
      }
    });
  (layout.wires || [])
    .filter((wire) => (wire.signalClass === "input" || wire.signalClass === "input-inverted") && wire.routingRole === "bus-to-and-input")
    .forEach((wire) => {
      const points = wire.points || [];
      if (points.length === 2 && points[0].y === points[1].y && points[1].x > points[0].x) return;
      pushIssue(errors, "INPUT_TRUNK_BRANCH_ERROR", `${wire.id} must branch directly and horizontally from the shared X/X' trunk`, {
        wire: wire.id,
        points
      });
    });

  const branchCounts = new Map();
  (layout.wires || []).forEach((wire) => {
    if (!wire.comesFromBusTap) return;
    branchCounts.set(wire.source, (branchCounts.get(wire.source) || 0) + 1);
  });
  (layout.tapPoints || []).forEach((tap) => {
    const branchCount = branchCounts.get(tap.id) || 0;
    if (tap.renderDot !== false && branchCount === 0) {
      pushIssue(errors, "UNUSED_JUNCTION_DOT", `${tap.id} is rendered as a junction dot but has no outgoing branch`, {
        tap: tap.id
      });
    }
    const bus = (layout.buses || []).find((item) => item.id === tap.busId);
    if (tap.renderDot !== false && (bus?.signalClass === "input" || bus?.signalClass === "input-inverted") && bus.orientation === "vertical") {
      const minY = Math.min(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
      const maxY = Math.max(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
      if (tap.y <= minY || tap.y >= maxY) {
        pushIssue(errors, "UNUSED_JUNCTION_DOT", `${tap.id} is on an input trunk endpoint; endpoint bends must not render junction dots`, {
          tap: tap.id,
          bus: bus.id
        });
      }
    }
    if (tap.renderDot !== false && bus?.signalClass === "feedback") {
      if (tap.section === "upper") {
        const sameTrunkTaps = (bus.upperTapPoints || [])
          .filter((item) => Math.round(item.x) === Math.round(tap.x))
          .sort((left, right) => left.y - right.y);
        const lowestTapY = sameTrunkTaps.length ? Math.max(...sameTrunkTaps.map((item) => item.y)) : tap.y;
        if (sameTrunkTaps.length <= 1 || tap.y >= lowestTapY) {
          pushIssue(errors, "UNUSED_JUNCTION_DOT", `${tap.id} is on a feedback OR trunk final bend; final turns must not render junction dots`, {
            tap: tap.id,
            bus: bus.id
          });
        }
      }
      if (tap.section === "return") {
        const minY = Math.min(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
        const maxY = Math.max(bus.start?.y ?? tap.y, bus.end?.y ?? tap.y);
        if (tap.y <= minY || tap.y >= maxY) {
          pushIssue(errors, "UNUSED_JUNCTION_DOT", `${tap.id} is on a feedback return endpoint; final bends must not render junction dots`, {
            tap: tap.id,
            bus: bus.id
          });
        }
      }
    }
  });

  const clkBus = (layout.buses || []).find((bus) => bus.signal === "CLK");
  if (clkBus) {
    const maxNonClockComponentBottom = Math.max(
      0,
      ...(layout.components || [])
        .filter((component) => component.signal !== "CLK")
        .map((component) => rectBottom(componentRect(component)))
    );
    if (clkBus.y < maxNonClockComponentBottom + 40) {
      pushIssue(errors, "CLK_BASELINE_ERROR", `CLK baseline at y=${clkBus.y} is too close to logic ending at y=${maxNonClockComponentBottom}`, {
        clkY: clkBus.y,
        maxNonClockComponentBottom
      });
    }
    (layout.wires || [])
      .filter((wire) => wire.signal === "CLK" && wire.id !== "wire-source-CLK-bus")
      .forEach((wire) => {
        const points = wire.points || [];
        const isCenteredClockEntry = Boolean(wire.centeredClockEntry);
        const last = points[points.length - 1];
        const beforeLast = points[points.length - 2];
        const hasCenteredVerticalEntry = isCenteredClockEntry
          && last
          && beforeLast
          && last.x === beforeLast.x
          && wire.toPin
          && last.x === wire.toPin.x
          && last.y === wire.toPin.y;
        if (isCenteredClockEntry && !hasCenteredVerticalEntry) {
          pushIssue(errors, "CLK_ROUTE_ERROR", `${wire.id} must enter the upper FF CLK pin with a centered vertical final segment`, {
            wire: wire.id,
            points
          });
        }
        if (points.length > 3 && !hasCenteredVerticalEntry) {
          pushIssue(errors, "CLK_ROUTE_ERROR", `${wire.id} has unnecessary detours; CLK branches should be simple`, {
            wire: wire.id,
            pointCount: points.length
          });
        }
      });
    const clkLaneRect = {
      x: Math.min(clkBus.start.x, clkBus.end.x),
      y: clkBus.y - 3,
      width: Math.abs(clkBus.end.x - clkBus.start.x),
      height: 6
    };
    (layout.wires || [])
      .filter((wire) => wire.signal !== "CLK")
      .forEach((wire) => {
        wireSegments(wire).forEach((segment) => {
          if (!segmentIntersectsRect(segment, clkLaneRect)) return;
          pushIssue(errors, "CLK_BASELINE_INTERSECTION", `${wire.id} touches or crosses the CLK baseline`, {
            wire: wire.id,
            clkY: clkBus.y
          });
        });
      });
  }

  ["AND", "OR"].forEach((type) => {
    const gates = (layout.gates || []).filter((gate) => gate.type === type);
    if (gates.length < 2) return;
    const first = gates[0];
    gates.slice(1).forEach((gate) => {
      if (gate.width !== first.width || gate.height !== first.height) {
        pushIssue(errors, "GATE_SIZE_ERROR", `${type} gate ${gate.id} size differs from ${first.id}`, {
          gate: gate.id,
          type,
          width: gate.width,
          height: gate.height,
          expectedWidth: first.width,
          expectedHeight: first.height
        });
      }
    });
  });

  (layout.gates || []).filter((gate) => gate.type === "OR" && gate.inputTerms?.length > 1).forEach((gate) => {
    const terms = gate.inputTerms;
    for (let index = 0; index < terms.length - 1; index += 1) {
      const leftRank = isFeedbackSignal(terms[index].sourceSignal)
        ? orderRank(OR_DIRECT_ORDER, terms[index].sourceSignal)
        : OR_DIRECT_ORDER.length + 100 + (terms[index].sourceY || 0) / 10000;
      const rightRank = isFeedbackSignal(terms[index + 1].sourceSignal)
        ? orderRank(OR_DIRECT_ORDER, terms[index + 1].sourceSignal)
        : OR_DIRECT_ORDER.length + 100 + (terms[index + 1].sourceY || 0) / 10000;
      if (leftRank > rightRank) {
        pushIssue(errors, "OR_INPUT_ORDER_ERROR", `${gate.id} input terms violate the direct-Q / source-height order`, {
          gate: gate.id,
          terms
        });
        break;
      }
    }
  });
  (layout.gates || []).filter((gate) => gate.type === "AND" && gate.inputOrder?.length > 1).forEach((gate) => {
    for (let index = 0; index < gate.inputOrder.length - 1; index += 1) {
      if (orderRank(AND_INPUT_ORDER, gate.inputOrder[index]) > orderRank(AND_INPUT_ORDER, gate.inputOrder[index + 1])) {
        pushIssue(errors, "AND_INPUT_ORDER_ERROR", `${gate.id} input order must be Q0, Q0', Q1, Q1', X, X'`, {
          gate: gate.id,
          inputOrder: gate.inputOrder
        });
        break;
      }
    }
  });
}

export function validateDiagramLayout(layout) {
  const errors = [];
  const warnings = [];
  validateManhattanWires(layout, errors);
  validateWireOverlap(layout, errors);
  validateWireComponentCollisions(layout, errors);
  validateComponentOverlap(layout, errors);
  validateBranchSpacing(layout, errors);
  validateStageAlignment(layout, errors, warnings);
  validateCanvas(layout, warnings, errors);
  validateLegendPlacement(layout, errors);
  validateAndOutputStagger(layout, errors);
  validateAndToOrRoutingStyle(layout, errors);
  validateOrGroupPlacement(layout, errors);
  validateReferenceStyle(layout, errors, warnings);
  return publicResult(errors, warnings, {
    componentCount: layout.components?.length || 0,
    wireCount: layout.wires?.length || 0,
    busCount: layout.buses?.length || 0,
    tapPointCount: layout.tapPoints?.length || 0
  });
}

function validateOrGates(layout, netlist, errors) {
  const wires = layout.wires || [];
  (layout.gates || [])
    .filter((gate) => gate.type === "OR")
    .forEach((gate) => {
      const inputPinNames = gateInputPinNames(gate);
      const inputWires = inputPinNames.map((pinName) =>
        wires.find((wire) => wire.target === `${gate.id}.${pinName}` && wireEndsAt(wire, gate.pins[pinName]))
      );
      const visibleCount = inputWires.filter(Boolean).length;
      const expectedCount = gate.visualInputCount || inputPinNames.length;
      if (visibleCount !== expectedCount) {
        pushIssue(errors, "WRONG_OR_INPUT_COUNT", `${gate.id} expected ${expectedCount} visible input wires, saw ${visibleCount}`, {
          gate: gate.id,
          expectedCount,
          visibleCount
        });
      }
      const seenNets = new Set();
      inputWires.filter(Boolean).forEach((wire) => {
        if (seenNets.has(wire.netId)) {
          pushIssue(errors, "OR_INPUTS_MERGED", `${gate.id} has repeated OR input net ${wire.netId}`, {
            gate: gate.id,
            net: wire.netId
          });
        }
        seenNets.add(wire.netId);
      });
      for (let index = 0; index < inputWires.length - 1; index += 1) {
        const upperWire = inputWires[index];
        const lowerWire = inputWires[index + 1];
        if (upperWire && lowerWire && upperWire.sourceY > lowerWire.sourceY) {
          pushIssue(errors, "OR_INPUT_ORDER_ERROR", `${gate.id} OR inputs violate source-height ordering`, {
            gate: gate.id,
            upperWire: upperWire.id,
            lowerWire: lowerWire.id
          });
        }
      }
      const sourceWire = wires.find((wire) => wire.source === `${gate.id}.out`);
      if (!sourceWire || !wireStartsAt(sourceWire, gate.pins.out)) {
        pushIssue(errors, "DANGLING_PIN_CONNECTION", `${gate.id}.out has no exact output wire`, {
          gate: gate.id
        });
      }
    });

  const visualOrGateIds = new Set(
    Object.values(netlist?.visualGatePlans || {})
      .map((plan) => plan?.finalGate?.id)
      .filter(Boolean)
  );
  const orGateIdsInNetlist = new Set([
    ...(netlist?.gates || []).filter((gate) => gate.type === "OR").map((gate) => gate.id),
    ...visualOrGateIds
  ]);
  (layout.gates || [])
    .filter((gate) => gate.type === "OR" && !orGateIdsInNetlist.has(gate.id))
    .forEach((gate) => {
      pushIssue(errors, "WRONG_OR_INPUT_COUNT", `${gate.id} is rendered but is not present in the netlist OR tree`, {
        gate: gate.id
      });
    });
}

export function validateCircuitGraph(layout, netlist) {
  const layoutValidation = validateDiagramLayout(layout);
  const connectionValidation = validateConnections(layout);
  const errors = [
    ...(layoutValidation.details.issues || []),
    ...(connectionValidation.details.issues || [])
  ];
  const warnings = [
    ...(layoutValidation.details.warningIssues || []),
    ...(connectionValidation.details.warningIssues || [])
  ];
  validateOrGates(layout, netlist, errors);

  const targetMap = netlist?.targetMap || {};
  Object.entries(targetMap).forEach(([target, netId]) => {
    if ((layout.targetConnections || []).some((connection) => connection.equationTarget === target || connection.target?.includes(target))) {
      return;
    }
    const gate = (layout.gates || []).find((candidate) => candidate.netlistGate?.output === netId || candidate.netlistGate?.target === target);
    const targetWire = (layout.wires || []).find((wire) => wire.target?.includes(target) && wire.netId === netId);
    if (!gate && !targetWire) {
      pushIssue(errors, "WRONG_TARGET_CONNECTION", `Target ${target} is not represented by a final layout wire`, {
        target,
        netId
      });
    }
  });

  return publicResult(errors, warnings, {
    layout: layoutValidation.details,
    connections: connectionValidation.details,
    netlistGateCount: netlist?.gates?.length || 0,
    netlistNetCount: netlist?.nets?.length || 0
  });
}
