const NODE_RADIUS_MEALY = 52;
const NODE_RADIUS_MOORE = 68;
const ANCHOR_OFFSETS = [0, -0.3, 0.3, -0.6, 0.6, -0.86, 0.86];

function edgeKey(row, index) {
  return `${row.presentState}-${row.input}-${row.nextState}-${row.output}-${index}`;
}

function estimateLabelWidth(label) {
  return Math.max(38, String(label).length * 9 + 18);
}

function rectsOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function normalize(dx, dy) {
  const length = Math.max(1, Math.hypot(dx, dy));
  return { x: dx / length, y: dy / length };
}

function anchorPoint(position, radius, angle) {
  return {
    x: position.x + Math.cos(angle) * radius,
    y: position.y + Math.sin(angle) * radius
  };
}

function nextAnchorOffset(anchorSeen, key) {
  const count = anchorSeen.get(key) || 0;
  anchorSeen.set(key, count + 1);
  return ANCHOR_OFFSETS[count % ANCHOR_OFFSETS.length] + Math.floor(count / ANCHOR_OFFSETS.length) * 0.18;
}

function nodeOutputValue(result, state) {
  const values = [...new Set((result.sourceRows || []).filter((row) => row.presentState === state).map((row) => row.output))];
  if (!values.length) return "-";
  return values.length === 1 ? values[0] : values.join("/");
}

function transitionLabel(row, modelType) {
  return modelType === "Moore" ? row.input : `${row.input}/${row.output}`;
}

function buildPositions(states, width, height, radius) {
  const centerX = width / 2;
  const centerY = height / 2 + 22;
  const orbitX = Math.max(220, width / 2 - 160);
  const orbitY = Math.max(145, height / 2 - 130);
  return new Map(
    states.map((state, index) => {
      if (states.length === 1) return [state, { x: centerX, y: centerY, angle: -Math.PI / 2 }];
      const angle = -Math.PI / 2 + (index / states.length) * Math.PI * 2;
      return [
        state,
        {
          x: centerX + Math.cos(angle) * orbitX,
          y: centerY + Math.sin(angle) * orbitY,
          angle
        }
      ];
    })
  );
}

function buildEdgeLayout({ row, index, positions, radius, modelType, orderedSeen, pairSeen, selfSeen, anchorSeen, attempt }) {
  const start = positions.get(row.presentState);
  const end = positions.get(row.nextState);
  const label = transitionLabel(row, modelType);
  if (!start || !end) return null;

  if (row.presentState === row.nextState) {
    const selfIndex = selfSeen.get(row.presentState) || 0;
    selfSeen.set(row.presentState, selfIndex + 1);
    const outward = normalize(Math.cos(start.angle), Math.sin(start.angle));
    const tangent = normalize(-outward.y, outward.x);
    const loopSpread = 50 + attempt * 6;
    const loopRadius = radius + 78 + selfIndex * loopSpread;
    const anchorA = {
      x: start.x + outward.x * (radius + 7) + tangent.x * 26,
      y: start.y + outward.y * (radius + 7) + tangent.y * 26
    };
    const anchorB = {
      x: start.x + outward.x * (radius + 7) - tangent.x * 26,
      y: start.y + outward.y * (radius + 7) - tangent.y * 26
    };
    const c1 = {
      x: start.x + outward.x * loopRadius + tangent.x * loopRadius,
      y: start.y + outward.y * loopRadius + tangent.y * loopRadius
    };
    const c2 = {
      x: start.x + outward.x * loopRadius - tangent.x * loopRadius,
      y: start.y + outward.y * loopRadius - tangent.y * loopRadius
    };
    const labelPoint = {
      x: start.x + outward.x * (loopRadius + 22),
      y: start.y + outward.y * (loopRadius + 22) + selfIndex * 12
    };
    return {
      id: edgeKey(row, index),
      type: "self",
      label,
      path: `M ${anchorA.x} ${anchorA.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${anchorB.x} ${anchorB.y}`,
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      labelBox: labelBox(label, labelPoint.x, labelPoint.y),
      controlSignature: `${Math.round(c1.x)},${Math.round(c1.y)}-${Math.round(c2.x)},${Math.round(c2.y)}`,
      arrowPoint: anchorB,
      startPoint: anchorA
    };
  }

  const orderedKey = `${row.presentState}->${row.nextState}`;
  const pairKey = [row.presentState, row.nextState].sort().join("<->");
  const orderedIndex = orderedSeen.get(orderedKey) || 0;
  const pairIndex = pairSeen.get(pairKey) || 0;
  orderedSeen.set(orderedKey, orderedIndex + 1);
  pairSeen.set(pairKey, pairIndex + 1);

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const unit = normalize(dx, dy);
  const normal = { x: -unit.y, y: unit.x };
  const directionSign = row.presentState < row.nextState ? 1 : -1;
  const parallelOffset = (orderedIndex - 0.5) * 34;
  const pairOffset = directionSign * (76 + attempt * 9 + pairIndex * 24) + parallelOffset;
  const startAngle = Math.atan2(dy, dx) + nextAnchorOffset(anchorSeen, `${row.presentState}:out:${row.nextState}`);
  const endAngle = Math.atan2(-dy, -dx) + nextAnchorOffset(anchorSeen, `${row.nextState}:in:${row.presentState}`);
  const startPoint = anchorPoint(start, radius + 4, startAngle);
  const endPoint = anchorPoint(end, radius + 10, endAngle);
  const control = {
    x: (startPoint.x + endPoint.x) / 2 + normal.x * pairOffset,
    y: (startPoint.y + endPoint.y) / 2 + normal.y * pairOffset
  };
  const labelPoint = {
    x: (startPoint.x + 2 * control.x + endPoint.x) / 4 + normal.x * 18,
    y: (startPoint.y + 2 * control.y + endPoint.y) / 4 + normal.y * 18
  };
  return {
    id: edgeKey(row, index),
    type: "edge",
    label,
    path: `M ${startPoint.x} ${startPoint.y} Q ${control.x} ${control.y} ${endPoint.x} ${endPoint.y}`,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    labelBox: labelBox(label, labelPoint.x, labelPoint.y),
    controlSignature: `${Math.round(control.x)},${Math.round(control.y)}`,
    arrowPoint: endPoint,
    startPoint
  };
}

function labelBox(label, x, y) {
  const width = estimateLabelWidth(label);
  const height = 24;
  return { x: x - width / 2, y: y - height + 7, width, height };
}

function adjustLabels(edges, positions, radius, width, height) {
  const adjusted = edges.map((edge) => ({ ...edge, labelBox: { ...edge.labelBox } }));
  for (let pass = 0; pass < 8; pass += 1) {
    adjusted.forEach((edge, index) => {
      for (let otherIndex = index + 1; otherIndex < adjusted.length; otherIndex += 1) {
        const other = adjusted[otherIndex];
        if (rectsOverlap(edge.labelBox, other.labelBox)) {
          edge.labelY -= 13;
          other.labelY += 13;
          edge.labelBox = labelBox(edge.label, edge.labelX, edge.labelY);
          other.labelBox = labelBox(other.label, other.labelX, other.labelY);
        }
      }
      positions.forEach((position) => {
        const center = {
          x: edge.labelBox.x + edge.labelBox.width / 2,
          y: edge.labelBox.y + edge.labelBox.height / 2
        };
        if (distance(center, position) < radius + 24) {
          const outward = normalize(center.x - position.x, center.y - position.y);
          edge.labelX += outward.x * 18;
          edge.labelY += outward.y * 18;
          edge.labelBox = labelBox(edge.label, edge.labelX, edge.labelY);
        }
      });
      edge.labelX = Math.max(40, Math.min(width - 40, edge.labelX));
      edge.labelY = Math.max(48, Math.min(height - 34, edge.labelY));
      edge.labelBox = labelBox(edge.label, edge.labelX, edge.labelY);
    });
  }
  return adjusted;
}

function validateStateDiagramLayout({ edges, positions, radius, modelType, states, mooreOutputs }) {
  const errors = [];
  const signatures = new Set();
  edges.forEach((edge) => {
    if (signatures.has(edge.controlSignature)) errors.push(`Duplicate edge curve detected for ${edge.id}`);
    signatures.add(edge.controlSignature);
  });
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      if (rectsOverlap(edges[leftIndex].labelBox, edges[rightIndex].labelBox)) {
        errors.push(`Edge labels overlap: ${edges[leftIndex].id} and ${edges[rightIndex].id}`);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      if (distance(edges[leftIndex].arrowPoint, edges[rightIndex].arrowPoint) < 18) {
        errors.push(`Arrowheads are too close: ${edges[leftIndex].id} and ${edges[rightIndex].id}`);
      }
      if (distance(edges[leftIndex].startPoint, edges[rightIndex].startPoint) < 14) {
        errors.push(`Outgoing anchors are too close: ${edges[leftIndex].id} and ${edges[rightIndex].id}`);
      }
    }
  }
  edges.forEach((edge) => {
    positions.forEach((position, state) => {
      const center = {
        x: edge.labelBox.x + edge.labelBox.width / 2,
        y: edge.labelBox.y + edge.labelBox.height / 2
      };
      if (distance(center, position) < radius + 10) errors.push(`Label ${edge.id} is too close to state ${state}`);
    });
  });
  if (modelType === "Moore") {
    states.forEach((state) => {
      if (!mooreOutputs.get(state)) errors.push(`Moore state ${state} is missing node output`);
    });
    edges.forEach((edge) => {
      if (edge.label.includes("/")) errors.push(`Moore edge ${edge.id} incorrectly contains output text`);
    });
  } else {
    edges.forEach((edge) => {
      if (!edge.label.includes("/")) errors.push(`Mealy edge ${edge.id} is missing input/output text`);
    });
  }
  return { valid: errors.length === 0, errors };
}

function buildLayout(result, modelType) {
  const states = result.encodingInfo.states;
  const transitions = result.sourceRows || [];
  const radius = modelType === "Moore" ? NODE_RADIUS_MOORE : NODE_RADIUS_MEALY;
  let lastLayout = null;

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const width = Math.max(900 + attempt * 90, states.length * (260 + attempt * 24));
    const height = Math.max(570 + attempt * 46, 530);
    const positions = buildPositions(states, width, height, radius);
    const orderedSeen = new Map();
    const pairSeen = new Map();
    const selfSeen = new Map();
    const anchorSeen = new Map();
    const edges = transitions
      .map((row, index) =>
        buildEdgeLayout({ row, index, positions, radius, modelType, orderedSeen, pairSeen, selfSeen, anchorSeen, attempt })
      )
      .filter(Boolean);
    const adjustedEdges = adjustLabels(edges, positions, radius, width, height);
    const mooreOutputs = new Map(states.map((state) => [state, nodeOutputValue(result, state)]));
    const validation = validateStateDiagramLayout({
      edges: adjustedEdges,
      positions,
      radius,
      modelType,
      states,
      mooreOutputs
    });
    lastLayout = { width, height, positions, edges: adjustedEdges, radius, mooreOutputs, validation };
    if (validation.valid) return lastLayout;
  }

  return lastLayout;
}

export default function StateDiagram({ result, modelType }) {
  if (!result) {
    return (
      <section className="tab-card">
        <h2>State Diagram</h2>
        <p className="placeholder">Generate the design to view the state transition graph.</p>
      </section>
    );
  }

  const states = result.encodingInfo.states;
  const layout = buildLayout(result, modelType);
  const initial = layout.positions.get(states[0]);
  const isMoore = modelType === "Moore";

  return (
    <section className="tab-card">
      <div className="tab-section-heading">
        <div>
          <h2>State Diagram</h2>
          <p>
            {isMoore
              ? "Moore nodes show state name, encoding, and output; edges show input only."
              : "Mealy nodes show state name and encoding; edges show input/output."}
          </p>
        </div>
        <span className={`mini-badge ${layout.validation.valid ? "state-valid" : "state-warning"}`}>
          {layout.validation.valid ? "State layout validated" : "Layout adjusted"}
        </span>
      </div>
      <div className="state-diagram-card">
        <svg
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`${modelType} state transition diagram`}
          className="state-diagram-svg"
        >
          <defs>
            <marker id="state-arrow" markerWidth="13" markerHeight="13" refX="10" refY="4" orient="auto">
              <path d="M 0 0 L 10 4 L 0 8 Z" fill="#1f66b3" />
            </marker>
            <marker id="state-start-arrow" markerWidth="13" markerHeight="13" refX="10" refY="4" orient="auto">
              <path d="M 0 0 L 10 4 L 0 8 Z" fill="#0f8a49" />
            </marker>
          </defs>
          <rect x="10" y="10" width={layout.width - 20} height={layout.height - 20} rx="18" className="state-diagram-bg" />
          {initial && (
            <g>
              <path
                d={`M ${initial.x - layout.radius - 112} ${initial.y - 14} Q ${initial.x - layout.radius - 64} ${initial.y - 46} ${initial.x - layout.radius - 8} ${initial.y - 5}`}
                className="state-edge initial-edge"
                markerEnd="url(#state-start-arrow)"
              />
              <text x={initial.x - layout.radius - 118} y={initial.y - 42} className="state-edge-label initial-label">start</text>
            </g>
          )}

          {layout.edges.map((edge) => (
            <g key={edge.id}>
              <path d={edge.path} className={edge.type === "self" ? "state-edge state-self-edge" : "state-edge"} markerEnd="url(#state-arrow)" />
              <rect
                x={edge.labelBox.x}
                y={edge.labelBox.y}
                width={edge.labelBox.width}
                height={edge.labelBox.height}
                rx="10"
                className="state-edge-label-bg"
              />
              <text x={edge.labelX} y={edge.labelY} className="state-edge-label">{edge.label}</text>
            </g>
          ))}

          {states.map((state) => {
            const position = layout.positions.get(state);
            const encoding = result.encodingInfo.encoding[state];
            const output = layout.mooreOutputs.get(state);
            return (
              <g key={state}>
                <circle cx={position.x} cy={position.y} r={layout.radius} className={isMoore ? "state-node moore-node" : "state-node"} />
                <text x={position.x} y={position.y - (isMoore ? 18 : 8)} className="state-name">{state}</text>
                <text x={position.x} y={position.y + (isMoore ? 6 : 18)} className="state-code">{encoding}</text>
                {isMoore && (
                  <>
                    <line
                      x1={position.x - 36}
                      y1={position.y + 21}
                      x2={position.x + 36}
                      y2={position.y + 21}
                      className="state-output-separator"
                    />
                    <text x={position.x} y={position.y + 45} className="state-output">{output}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}
