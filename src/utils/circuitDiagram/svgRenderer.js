import { escapeHtml } from "../equationFormatter.js";
import { formatSubscriptLabel } from "../subscriptFormatter.js";

const COLORS = {
  input: "#0891b2",
  "input-inverted": "#0f766e",
  feedback: "#7c3aed",
  clock: "#2563eb",
  internal: "#475569",
  output: "#111827",
  constant: "#374151",
  gate: "#111827",
  text: "#1f2937",
  muted: "#64748b",
  grid: "#eef4fb"
};

const FONT = "Arial, Helvetica, sans-serif";

function label(value) {
  return escapeHtml(formatSubscriptLabel(value));
}

function colorFor(item) {
  return COLORS[item?.signalClass] || COLORS[item?.colorClass] || COLORS.internal;
}

function pathData(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${Math.round(point.x)} ${Math.round(point.y)}`).join(" ");
}

function componentById(layout, id) {
  return (layout.components || []).find((component) => component.id === id);
}

function andOutputBoundaryPoint(component) {
  return {
    x: Math.round(component.x + component.width * 0.715),
    y: Math.round(component.y + component.height / 2)
  };
}

function orInputBoundaryX(component, inputY) {
  const relativeY = Math.max(0, Math.min(1, (inputY - component.y) / component.height));
  return Math.round(component.x + component.width * 0.56 * relativeY * (1 - relativeY));
}

function visualWirePoints(wire, layout) {
  const points = (wire.points || []).map((point) => ({ ...point }));
  if (!points.length) return points;

  const sourceComponent = componentById(layout, wire.sourceComponentId);
  if (sourceComponent?.type === "AND" && wire.sourcePinName === "out" && points.length > 1) {
    const boundary = andOutputBoundaryPoint(sourceComponent);
    const next = points[1];
    if (Math.round(points[0].y) === Math.round(boundary.y) && Math.round(next.y) === Math.round(boundary.y)) {
      points[0] = boundary;
    }
  }

  const targetComponent = componentById(layout, wire.targetComponentId);
  if (targetComponent?.type === "OR" && /^in\d+$/.test(String(wire.targetPinName || "")) && points.length > 1) {
    const lastIndex = points.length - 1;
    const previous = points[lastIndex - 1];
    const end = points[lastIndex];
    const boundaryX = orInputBoundaryX(targetComponent, end.y);
    if (Math.round(previous.y) === Math.round(end.y) && Math.round(previous.x) <= boundaryX) {
      points[lastIndex] = { x: boundaryX, y: end.y };
    }
  }

  return points;
}

function renderGrid(width, height) {
  const step = 40;
  const vertical = [];
  const horizontal = [];
  for (let x = 0; x <= width; x += step) vertical.push(`<path d="M${x} 0 V${height}" stroke="${COLORS.grid}" stroke-width="1"/>`);
  for (let y = 0; y <= height; y += step) horizontal.push(`<path d="M0 ${y} H${width}" stroke="${COLORS.grid}" stroke-width="1"/>`);
  return `<g opacity="0.55">${vertical.join("")}${horizontal.join("")}</g>`;
}

function renderBus(bus) {
  if (bus.renderAsBus === false || bus.signalClass === "feedback") return "";
  const stroke = colorFor(bus);
  const sourceMarker = bus.signalClass === "clock"
    ? `<circle cx="${bus.start.x}" cy="${bus.start.y}" r="5" fill="${stroke}"/>`
    : "";
  const path = bus.orientation === "vertical"
    ? `M${bus.start.x} ${bus.start.y} V${bus.end.y}`
    : `M${bus.start.x} ${bus.start.y} H${bus.end.x}`;
  return `<g data-bus-id="${escapeHtml(bus.id)}">
    <path d="${path}" fill="none" stroke="${stroke}" stroke-width="3.2" stroke-linecap="round"/>
    ${sourceMarker}
  </g>`;
}

function renderWire(wire, layout) {
  return `<path data-wire-id="${escapeHtml(wire.id)}" data-net="${escapeHtml(wire.netId)}" d="${pathData(visualWirePoints(wire, layout))}" fill="none" stroke="${colorFor(wire)}" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter"/>`;
}

function renderTap(tap, layout) {
  if (tap.renderDot === false) return "";
  const bus = layout.buses.find((item) => item.id === tap.busId);
  const point = dotPointForTap(tap, bus, layout);
  if (!point) return "";
  return `<circle data-tap-id="${escapeHtml(tap.id)}" cx="${point.x}" cy="${point.y}" r="4.7" fill="${colorFor(bus)}"/>`;
}

function dotPointForTap(tap, bus, layout) {
  if (bus?.signalClass !== "input-inverted" || bus.orientation !== "vertical") return tap;
  const branchWire = (layout.wires || []).find((wire) => wire.source === tap.id || wire.id === tap.assignedWireId);
  const points = branchWire?.points || [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const startsOnTrunk = Math.round(point.x) === Math.round(bus.x);
    const leavesHorizontally = Math.round(point.y) === Math.round(next.y) && Math.round(point.x) !== Math.round(next.x);
    if (startsOnTrunk && leavesHorizontally) return point;
  }
  return null;
}

function renderAndGate(component) {
  const { x, y, width, height } = component;
  const cy = y + height / 2;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <path d="M${x} ${y} H${x + width * 0.43} Q${x + width} ${cy} ${x + width * 0.43} ${y + height} H${x} Z" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 19}" y="${cy + 5}" font-size="13" font-weight="800" font-family="${FONT}" fill="#334155">AND</text>
  </g>`;
}

function renderOrGate(component) {
  const { x, y, width, height } = component;
  const cy = y + height / 2;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <path d="M${x} ${y} Q${x + width * 0.52} ${y + height * 0.08} ${x + width} ${cy} Q${x + width * 0.52} ${y + height * 0.92} ${x} ${y + height} Q${x + width * 0.28} ${cy} ${x} ${y} Z" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 34}" y="${cy + 5}" font-size="13" font-weight="800" font-family="${FONT}" fill="#334155">OR</text>
  </g>`;
}

function renderNotGate(component) {
  const { x, y, width, height } = component;
  const cy = y + height / 2;
  const bubbleCx = x + 52;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <polygon points="${x},${cy - 20} ${x},${cy + 20} ${x + 42},${cy}" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <circle cx="${bubbleCx}" cy="${cy}" r="6.5" fill="#fff" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <path d="M${bubbleCx + 6.5} ${cy} H${x + width}" stroke="${COLORS.gate}" stroke-width="2.3"/>
    <text x="${x + 11}" y="${cy + 5}" font-size="12" font-weight="800" font-family="${FONT}" fill="#334155">NOT</text>
  </g>`;
}

function renderConstant(component) {
  const pin = component.pins.out;
  const value = component.id.includes("const-0") ? "0" : "1";
  const stubLength = 20;
  const startX = pin.x - stubLength;
  const labelX = startX - 7;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <path d="M${startX} ${pin.y} H${pin.x}" stroke="${COLORS.constant}" stroke-width="2.4"/>
    <text x="${labelX}" y="${pin.y + 5}" text-anchor="end" font-size="18" font-weight="900" font-family="${FONT}" fill="${COLORS.constant}">${value}</text>
  </g>`;
}

function renderWireConnector(component) {
  const cy = component.y + component.height / 2;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <path d="M${component.x} ${cy} H${component.x + component.width}" stroke="${COLORS.internal}" stroke-width="2.4"/>
    <circle cx="${component.x + component.width / 2}" cy="${cy}" r="3.3" fill="${COLORS.internal}"/>
  </g>`;
}

function renderGate(component) {
  if (component.type === "AND") return renderAndGate(component);
  if (component.type === "OR") return renderOrGate(component);
  if (component.type === "NOT") return renderNotGate(component);
  if (component.type === "CONST") return renderConstant(component);
  if (component.type === "WIRE") return renderWireConnector(component);
  return "";
}

function renderFlipFlop(component) {
  const { x, y, width, height } = component;
  const labelPadding = 12;
  const pinFontSize = 17;
  const clkFontSize = 14;
  const rightLabelX = x + width - labelPadding;
  const leftLabelX = x + labelPadding;
  const inputPins = Object.keys(component.pins).filter((pin) => /^[DJKT]\d+$/.test(pin));
  const inputLabels = inputPins.map((pinName) => {
    const pin = component.pins[pinName];
    return `<text x="${leftLabelX}" y="${pin.y + 6}" font-size="${pinFontSize}" font-weight="900" font-family="${FONT}" fill="${COLORS.text}">${label(pinName)}</text>`;
  }).join("");
  const clk = component.pins.CLK;
  const q = component.pins.Q;
  const qn = component.pins.QN;
  const qLabel = component.stateVariable;
  const qnLabel = `${component.stateVariable}'`;

  return `<g data-component-id="${escapeHtml(component.id)}">
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="#ffffff" stroke="${COLORS.gate}" stroke-width="2.4"/>
    ${inputLabels}
    <path d="M${clk.x - 11} ${y + height} L${clk.x} ${y + height - 13} L${clk.x + 11} ${y + height}" fill="none" stroke="${COLORS.gate}" stroke-width="2.2"/>
    <text x="${clk.x}" y="${y + height - 19}" font-size="${clkFontSize}" text-anchor="middle" font-weight="900" font-family="${FONT}" fill="${COLORS.text}">CLK</text>
    <text x="${rightLabelX}" y="${q.y + 6}" font-size="${pinFontSize}" text-anchor="end" font-weight="900" font-family="${FONT}" fill="${COLORS.text}">${label(qLabel)}</text>
    <text x="${rightLabelX}" y="${qn.y + 6}" font-size="${pinFontSize}" text-anchor="end" font-weight="900" font-family="${FONT}" fill="${COLORS.text}">${label(qnLabel)}</text>
  </g>`;
}

function renderOutput(component) {
  const pin = component.pins.in;
  return `<g data-component-id="${escapeHtml(component.id)}">
    <circle cx="${pin.x}" cy="${pin.y}" r="5" fill="${COLORS.output}"/>
    <text x="${pin.x + 22}" y="${pin.y + 7}" font-size="21" font-weight="900" font-family="${FONT}" fill="${COLORS.output}">${label(component.output)}</text>
  </g>`;
}

function renderComponent(component) {
  if (component.kind === "gate") return renderGate(component);
  if (component.kind === "flipFlop") return renderFlipFlop(component);
  if (component.kind === "output") return renderOutput(component);
  return "";
}

function renderLabel(item) {
  return `<text x="${item.x}" y="${item.y}" font-size="14" font-weight="700" font-family="${FONT}" fill="${COLORS.muted}">${label(item.text)}</text>`;
}

function renderLegend(layout) {
  const items = [
    ["X / input", COLORS.input],
    ["X' / inverted input", COLORS["input-inverted"]],
    ["Q / Q' feedback", COLORS.feedback],
    ["CLK", COLORS.clock],
    ["Internal logic", COLORS.internal],
    ["Output", COLORS.output]
  ];
  const x = Math.max(760, layout.width - 190);
  const y = 18;
  return `<g aria-label="color legend">
    ${items.map(([text, color], index) => `<g>
      <path d="M${x} ${y + index * 24} H${x + 34}" stroke="${color}" stroke-width="3"/>
      <text x="${x + 44}" y="${y + index * 24 + 5}" font-size="13" font-weight="700" font-family="${FONT}" fill="${COLORS.muted}">${label(text)}</text>
    </g>`).join("")}
  </g>`;
}

export function renderCircuitLayoutSvg(layout, options = {}) {
  const title = options.title || "Sequential Circuit Diagram";
  const subtitle = options.subtitle || `${layout.meta?.flipFlopType || "Selected"} flip-flop, stage-aligned gate-level schematic`;
  const validation = options.validation || { valid: true, errors: [] };
  const validationErrors = validation.errors || [];
  const validationStatus = validation.valid ? "valid" : `invalid - ${validationErrors.slice(0, 4).join("; ")}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="Color-coded gate-level sequential circuit diagram" data-circuit-validation="${validation.valid ? "valid" : "invalid"}" data-circuit-error-count="${validationErrors.length}">`,
    `<desc>Layout validation: ${escapeHtml(validationStatus)}. Rendered from the Phase 3 reference-style circuit layout with top feedback pullback lanes, vertical X/X' input routing, exact pins, and orthogonal wires.</desc>`,
    `<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`,
    renderGrid(layout.width, layout.height),
    `<text x="28" y="42" font-size="24" font-weight="900" font-family="${FONT}" fill="${COLORS.text}">${escapeHtml(title)}</text>`,
    `<text x="28" y="68" font-size="14" font-weight="700" font-family="${FONT}" fill="${COLORS.muted}">${escapeHtml(subtitle)}</text>`,
    ...layout.buses.map(renderBus),
    ...layout.wires.map((wire) => renderWire(wire, layout)),
    ...layout.tapPoints.map((tap) => renderTap(tap, layout)),
    ...layout.components.map(renderComponent),
    ...layout.labels.map(renderLabel),
    renderLegend(layout),
    `<text x="28" y="${layout.height - 22}" font-size="14" font-family="${FONT}" fill="${COLORS.muted}">Circuit diagram is generated from the structural netlist and deterministic layout object. Layout validation: ${validation.valid ? "passed" : "failed"}.</text>`,
    `</svg>`
  ].join("");
}
