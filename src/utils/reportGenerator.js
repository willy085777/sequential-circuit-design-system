import { STUDENT_INFO } from "../config.js";
import { excitationRowsForDisplay } from "./excitationDisplayRows.js";
import { excitationDescription } from "./excitationTable.js";
import { escapeHtml } from "./equationFormatter.js";
import { formatSubscriptLabel } from "./subscriptFormatter.js";

function display(value) {
  return escapeHtml(formatSubscriptLabel(value));
}

function tableHtml(headers, rows) {
  return `<table><thead><tr>${headers.map((header) => `<th>${display(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${display(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function groupedStateTableHtml(groupedRows, modelType, inputVariable) {
  const input0 = `${inputVariable}=0`;
  const input1 = `${inputVariable}=1`;
  const colSpan = modelType === "Moore" ? 1 : 2;
  return `<table>
    <thead>
      <tr><th rowspan="2">Present State</th><th colspan="2">Next State</th><th colspan="${colSpan}">Output</th></tr>
      <tr><th>${display(input0)}</th><th>${display(input1)}</th>${
        modelType === "Moore" ? "<th>Moore Output</th>" : `<th>${display(input0)}</th><th>${display(input1)}</th>`
      }</tr>
    </thead>
    <tbody>
      ${groupedRows
        .map((row) => {
          const outputCells =
            modelType === "Moore"
              ? `<td>${display(row.mooreOutput || "")}</td>`
              : `<td>${display(row.outputByInput?.[0] || "")}</td><td>${display(row.outputByInput?.[1] || "")}</td>`;
          return `<tr><td>${display(row.presentState)}</td><td>${display(row.nextStateByInput?.[0] || "")}</td><td>${display(row.nextStateByInput?.[1] || "")}</td>${outputCells}</tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function stateDiagramSvg(result, modelType) {
  const states = result.encodingInfo.states;
  const width = Math.max(760, states.length * 180);
  const height = 260;
  const y = 118;
  const spacing = width / (states.length + 1);
  const positions = new Map(states.map((state, index) => [state, { x: spacing * (index + 1), y }]));
  const nodes = states
    .map((state) => {
      const position = positions.get(state);
      return `<circle cx="${position.x}" cy="${position.y}" r="38" fill="#fff" stroke="#1f66b3" stroke-width="2"/>
        <text x="${position.x}" y="${position.y - 4}" text-anchor="middle" font-size="22" font-weight="700">${display(state)}</text>
        <text x="${position.x}" y="${position.y + 18}" text-anchor="middle" font-size="12">${display(result.encodingInfo.encoding[state])}</text>`;
    })
    .join("");
  const edges = rowsForStateDiagram(result, modelType, positions)
    .map(
      (edge) =>
        `<path d="${edge.path}" fill="none" stroke="#1f66b3" stroke-width="1.8" marker-end="url(#arrow)"/>
        <text x="${edge.labelX}" y="${edge.labelY}" text-anchor="middle" font-size="12">${display(edge.label)}</text>`
    )
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6 Z" fill="#1f66b3"/></marker></defs>
    <rect width="${width}" height="${height}" fill="#fbfdff"/>
    ${edges}
    ${nodes}
  </svg>`;
}

function rowsForStateDiagram(result, modelType, positions) {
  return result.sourceRows.map((row, index) => {
    const start = positions.get(row.presentState);
    const end = positions.get(row.nextState);
    const label = modelType === "Mealy" ? `${row.input}/${row.output}` : row.input;
    if (!start || !end) return { path: "", labelX: 0, labelY: 0, label };
    if (row.presentState === row.nextState) {
      return {
        path: `M ${start.x - 16} ${start.y - 38} C ${start.x - 70} ${start.y - 105}, ${start.x + 70} ${start.y - 105}, ${start.x + 16} ${start.y - 38}`,
        labelX: start.x,
        labelY: start.y - 88,
        label
      };
    }
    const offset = (index % 2 ? 24 : -24);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2 + offset;
    return {
      path: `M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}`,
      labelX: midX,
      labelY: midY - 8,
      label
    };
  });
}

export function generateReportHtml({
  result,
  rows,
  groupedRows = [],
  modelType,
  flipFlopType,
  inputVariables,
  outputVariables,
  svg,
  verilog,
  equationNetlist = "",
  testbench = "",
  timingTrace = { rows: [] },
  validationCards = []
}) {
  const encodingRows = result.encodingInfo.states.map((state) => [state, ...result.encodingInfo.encoding[state]]);
  const equationRows = result.equations.map((equation) => [equation.flipFlop, equation.input, equation.equation]);
  const outputRows = result.outputEquations.map((equation) => [equation.output, equation.equation]);
  const excitationRows = excitationRowsForDisplay(result).map((row) => [
    row.presentState,
    row.presentCode,
    row.input,
    row.nextState,
    row.nextCode,
    row.output,
    ...result.equations.map((equation) => row.excitation[equation.input] ?? "-")
  ]);
  const timingRows = (timingTrace.rows || []).map((row) => [
    row.step,
    row.input,
    row.presentState,
    row.expectedOutput,
    row.actualOutput,
    row.expectedNextState,
    row.actualNextState,
    row.result
  ]);
  const validationRows = validationCards.map((card) => [card.title, card.status.toUpperCase(), card.detail]);
  const mapItem = result.mapItems[0];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Sequential Circuit Design Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172033; margin: 28px; line-height: 1.55; }
    h1 { color: #123e73; }
    h2 { border-bottom: 2px solid #dbe6f5; padding-bottom: 6px; color: #1f4e86; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 22px; }
    th, td { border: 1px solid #aebed2; padding: 8px; text-align: left; }
    th { background: #eaf2ff; }
    pre { background: #f5f7fb; border: 1px solid #d6e1f0; padding: 14px; overflow: auto; }
    .diagram svg { max-width: 100%; height: auto; border: 1px solid #c9d6e8; }
    .pass { color: #0f6b35; font-weight: 700; }
    .fail { color: #9b1c1c; font-weight: 700; }
  </style>
</head>
<body>
  <h1>Sequential Circuit Design Automation System</h1>
  <p><strong>Name:</strong> ${escapeHtml(STUDENT_INFO.name)}<br/><strong>Student ID:</strong> ${escapeHtml(STUDENT_INFO.studentId)}</p>
  <h2>Project Settings</h2>
  <p><strong>Model Type:</strong> ${escapeHtml(modelType)} Model<br/>
  <strong>Flip-Flop Type:</strong> ${escapeHtml(flipFlopType)} Flip-Flop<br/>
  <strong>Input Variables:</strong> ${display(inputVariables.join(", "))}<br/>
  <strong>Output Variables:</strong> ${display(outputVariables.join(", "))}</p>
  <h2>Grouped State Table</h2>
  ${groupedStateTableHtml(groupedRows, modelType, inputVariables[0] || "X")}
  <h2>State Diagram</h2>
  <div class="diagram">${stateDiagramSvg(result, modelType)}</div>
  <h2>Expanded Transition List Used Internally</h2>
  ${tableHtml(["Present State", "Input", "Next State", "Output"], rows.map((row) => [row.presentState, row.input, row.nextState, row.output]))}
  <h2>State Encoding Table</h2>
  ${tableHtml(["State", ...result.encodingInfo.encodingBitVariables], encodingRows)}
  <h2>Flip-Flop Excitation Method</h2>
  <p>${escapeHtml(excitationDescription(flipFlopType))}</p>
  <h2>Excitation Table</h2>
  ${tableHtml(["Present State", "Encoding", "Input", "Next State", "Next Encoding", "Output", ...result.equations.map((equation) => equation.input)], excitationRows)}
  <h2>Flip-Flop Input Equations</h2>
  ${tableHtml(["Flip-Flop", "Input", "Equation"], equationRows)}
  <h2>Output Equations</h2>
  ${tableHtml(["Output", "Equation"], outputRows)}
  <h2>K-map or Truth-Table Simplification</h2>
  <p>Selected equation: <strong>${display(mapItem?.id || "")}</strong></p>
  ${mapItem ? tableHtml([...mapItem.variables, "Value"], mapItem.values.map((item) => [...item.code, item.value])) : ""}
  <p><strong>Simplified result:</strong> ${display(mapItem?.equation || "")}</p>
  <h2>Sequential Circuit Diagram</h2>
  <div class="diagram">${svg}</div>
  <h2>Timing Diagram Simulation</h2>
  ${timingRows.length ? tableHtml(["Step", "X", "Present State", "Expected Z", "Actual Z", "Expected Next State", "Actual Next State", "Result"], timingRows) : "<p>Timing simulation was not available.</p>"}
  <h2>Validation Result</h2>
  ${validationRows.length ? tableHtml(["Check", "Status", "Explanation"], validationRows) : "<p>Validation was not available.</p>"}
  <h2>Extra Feature: Verilog HDL Code</h2>
  <h3>Behavioral Verilog</h3>
  <pre>${escapeHtml(verilog)}</pre>
  <h3>Gate-Level / Equation Netlist</h3>
  <pre>${escapeHtml(equationNetlist)}</pre>
  <h3>Testbench</h3>
  <pre>${escapeHtml(testbench)}</pre>
  <h2>Development Process</h2>
  <p>The development process starts by building the input interface with model selection, flip-flop selection, variable inputs, and an editable grouped state table. The system then converts grouped columns into transition rows, validates user input, and preserves the user's data when errors are found. After validation, it encodes states into binary state variables using first-appearance order and generates truth table entries from present state bits plus input variables.</p>
  <p>Next, the system generates excitation values based on the selected flip-flop type. D flip-flops use D = Qnext, T flip-flops use T = Q XOR Qnext, and JK flip-flops use the JK excitation table with don't-care values. The application then generates minterms and don't-care terms, simplifies Boolean equations with a minimization routine, and falls back to canonical SOP when needed. These equations are displayed in Output 1.</p>
  <p>Finally, the same generated equations are parsed into gate-level NOT, AND, OR, VCC, and GND elements to create Output 2, the sequential circuit diagram. The system also generates Verilog HDL code and exports this final report containing the settings, tables, equations, simplification display, diagram, source HDL, and complete production process.</p>
</body>
</html>`;
}
