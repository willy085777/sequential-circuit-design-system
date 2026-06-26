import { useMemo, useState } from "react";
import Header from "./components/Header.jsx";
import InputPanel from "./components/InputPanel.jsx";
import OutputEquations from "./components/OutputEquations.jsx";
import KMap from "./components/KMap.jsx";
import CircuitDiagram from "./components/CircuitDiagram.jsx";
import VerilogGenerator from "./components/VerilogGenerator.jsx";
import StateDiagram from "./components/StateDiagram.jsx";
import ExcitationTable from "./components/ExcitationTable.jsx";
import TimingDiagram from "./components/TimingDiagram.jsx";
import ValidationPanel from "./components/ValidationPanel.jsx";
import AboutModal from "./components/AboutModal.jsx";
import { STUDENT_INFO } from "./config.js";
import { D_EXAMPLE, JK_EXAMPLE } from "./utils/examples.js";
import { parseVariables, validateStateTable } from "./utils/validation.js";
import { encodeStates } from "./utils/stateEncoding.js";
import { generateCircuitAnalysis } from "./utils/truthTable.js";
import { generateDiagramSvg } from "./utils/diagramGenerator.js";
import { generateEquationNetlistVerilog, generateTestbench, generateVerilog } from "./utils/verilogGenerator.js";
import { generateReportHtml } from "./utils/reportGenerator.js";
import { buildValidationCards, createSimulationTrace, defaultInputSequence } from "./utils/simulation.js";
import { cloneGroupedRows, createFixedGroupedRows, groupedExampleRows, groupedRowsToTransitions } from "./utils/groupedStateTable.js";

function downloadText(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadSvgAsPng(filename, svgContent) {
  return new Promise((resolve, reject) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svgElement = doc.querySelector("svg");
    const viewBox = svgElement?.getAttribute("viewBox")?.split(/\s+/).map(Number) || [];
    const width = Number(svgElement?.getAttribute("width")) || viewBox[2] || 1400;
    const height = Number(svgElement?.getAttribute("height")) || viewBox[3] || 850;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) {
          reject(new Error("PNG export failed."));
          return;
        }
        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement("a");
        link.href = pngUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(pngUrl);
        resolve();
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("PNG export failed."));
    };
    image.src = url;
  });
}

const initialRows = groupedExampleRows();

const tabs = [
  { id: "state", label: "State Diagram" },
  { id: "excitation", label: "Excitation & K-Maps" },
  { id: "boolean", label: "Boolean Expressions" },
  { id: "circuit", label: "Circuit Diagram" },
  { id: "timing", label: "Timing Diagram" },
  { id: "verilog", label: "Verilog Code" },
  { id: "validation", label: "Validation" }
];

export default function App() {
  const [modelType, setModelType] = useState("Mealy");
  const [flipFlopType, setFlipFlopType] = useState("JK");
  const [inputVariableText, setInputVariableText] = useState("X");
  const [outputVariableText, setOutputVariableText] = useState("Z");
  const [rows, setRows] = useState(initialRows);
  const [messages, setMessages] = useState({ errors: [], warnings: [] });
  const [result, setResult] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
  const [activeTab, setActiveTab] = useState("state");

  const generatedDiagramSvg = useMemo(() => {
    if (!result) return "";
    return generateDiagramSvg({
      result,
      modelType,
      flipFlopType,
      inputVariables: result.inputVariables,
      outputVariables: result.outputVariables
    });
  }, [result, modelType, flipFlopType]);
  const diagramSvg = generatedDiagramSvg;

  const verilogCode = useMemo(() => {
    if (!result) return "";
    return generateVerilog({
      result,
      flipFlopType,
      inputVariables: result.inputVariables,
      outputVariables: result.outputVariables
    });
  }, [result, flipFlopType]);

  const equationNetlistCode = useMemo(() => {
    if (!result) return "";
    return generateEquationNetlistVerilog({
      result,
      inputVariables: result.inputVariables,
      outputVariables: result.outputVariables
    });
  }, [result]);

  const testbenchCode = useMemo(() => {
    if (!result) return "";
    return generateTestbench({
      result,
      inputVariables: result.inputVariables,
      outputVariables: result.outputVariables
    });
  }, [result]);

  const defaultTimingTrace = useMemo(() => {
    if (!result) return { rows: [], errors: [] };
    return createSimulationTrace({ result, inputSequence: defaultInputSequence(result) });
  }, [result]);

  const validationReport = useMemo(
    () => buildValidationCards({ result, messages, diagramSvg, timingTrace: defaultTimingTrace }),
    [result, messages, diagramSvg, defaultTimingTrace]
  );

  function loadExample(example) {
    setModelType(example.modelType);
    setFlipFlopType(example.flipFlopType);
    setInputVariableText(example.inputVariables);
    setOutputVariableText(example.outputVariables);
    setRows(cloneGroupedRows(example.rows));
    setMessages({ errors: [], warnings: [] });
    setResult(null);
  }

  function updateRow(index, field, value, inputValue) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (field === "togglePresentState") {
          const stateId = row.stateId || ["A", "B", "C", "D"][index] || "A";
          return { ...row, stateId, presentState: row.presentState === "--" ? stateId : "--" };
        }
        if (field === "nextStateByInput") {
          return { ...row, nextStateByInput: { ...row.nextStateByInput, [inputValue]: value } };
        }
        if (field === "outputByInput") {
          return { ...row, outputByInput: { ...row.outputByInput, [inputValue]: value } };
        }
        return { ...row, [field]: value };
      })
    );
  }

  function generate() {
    const parsedInputs = parseVariables(inputVariableText, "Input Variables");
    const parsedOutputs = parseVariables(outputVariableText, "Output Variables");
    const groupedTableErrors = parsedInputs.variables.length === 1 ? [] : ["The grouped table currently supports one input variable only."];
    const trimmedRows = groupedRowsToTransitions(rows, modelType);
    const tableValidation = validateStateTable(trimmedRows, parsedInputs.variables, parsedOutputs.variables, modelType);
    const errors = [...parsedInputs.errors, ...parsedOutputs.errors, ...groupedTableErrors, ...tableValidation.errors];
    const warnings = tableValidation.warnings;

    if (errors.length) {
      setMessages({ errors, warnings });
      setResult(null);
      return;
    }

    const encodingInfo = encodeStates(trimmedRows);
    const analysis = generateCircuitAnalysis({
      rows: trimmedRows,
      modelType,
      flipFlopType,
      inputVariables: parsedInputs.variables,
      outputVariables: parsedOutputs.variables,
      encodingInfo
    });

    setResult({
      ...analysis,
      encodingInfo,
      modelType,
      flipFlopType,
      inputVariables: parsedInputs.variables,
      outputVariables: parsedOutputs.variables,
      sourceRows: trimmedRows,
      groupedRows: cloneGroupedRows(rows)
    });
    setMessages({ errors: [], warnings });
    setActiveTab("boolean");
  }

  function exportReport() {
    if (!result) {
      setMessages({ errors: ["Generate results before exporting the report."], warnings: [] });
      return;
    }
    const html = generateReportHtml({
      result,
      rows: result.sourceRows,
      groupedRows: result.groupedRows,
      modelType,
      flipFlopType,
      inputVariables: result.inputVariables,
      outputVariables: result.outputVariables,
      svg: diagramSvg,
      verilog: verilogCode,
      equationNetlist: equationNetlistCode,
      testbench: testbenchCode,
      timingTrace: defaultTimingTrace,
      validationCards: validationReport.cards
    });
    downloadText("sequential-circuit-design-report.html", html, "text/html");
  }

  function downloadDiagram() {
    if (!diagramSvg) {
      setMessages({ errors: ["Generate results before downloading the diagram."], warnings: [] });
      return;
    }
    downloadText("sequential-circuit-diagram.svg", diagramSvg, "image/svg+xml");
  }

  async function downloadDiagramPng() {
    if (!diagramSvg) {
      setMessages({ errors: ["Generate results before downloading the diagram."], warnings: [] });
      return;
    }
    try {
      await downloadSvgAsPng("sequential-circuit-diagram.png", diagramSvg);
    } catch (error) {
      setMessages({ errors: [error.message], warnings: [] });
    }
  }

  function downloadVerilog() {
    if (!verilogCode) return;
    downloadText("sequential_circuit.v", verilogCode, "text/plain");
  }

  function downloadEquationNetlist() {
    if (!equationNetlistCode) return;
    downloadText("sequential_circuit_equation_netlist.v", equationNetlistCode, "text/plain");
  }

  function downloadTestbench() {
    if (!testbenchCode) return;
    downloadText("sequential_circuit_tb.v", testbenchCode, "text/plain");
  }

  const validationState = messages.errors.length
    ? { label: "Issues Found", tone: "invalid" }
    : result
      ? validationReport.allCriticalPass
        ? { label: "Validated", tone: "valid" }
        : { label: "Issues Found", tone: "invalid" }
      : { label: "Not validated", tone: "idle" };

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label || "State Diagram";

  function renderActiveTab() {
    if (activeTab === "state") {
      return <StateDiagram result={result} modelType={modelType} />;
    }
    if (activeTab === "excitation") {
      return (
        <>
          <ExcitationTable result={result} />
          <KMap result={result} />
        </>
      );
    }
    if (activeTab === "boolean") {
      return (
        <section className="tab-card">
          <OutputEquations result={result} />
        </section>
      );
    }
    if (activeTab === "circuit") {
      return (
        <section className="tab-card circuit-tab">
          <div className="tab-section-heading">
            <div>
              <h2>OUTPUT 2: SEQUENTIAL CIRCUIT DIAGRAM</h2>
              <p>Zoom, pan, fullscreen, and SVG download remain available.</p>
            </div>
            <div className="diagram-export-actions">
              <span className={`mini-badge ${diagramSvg.includes("Layout validation: valid") ? "success" : "warning"}`}>
                Circuit Graph {diagramSvg.includes("Layout validation: valid") ? "PASS" : "CHECK"}
              </span>
              <button onClick={downloadDiagram}>Download SVG</button>
              <button onClick={downloadDiagramPng}>Download PNG</button>
            </div>
          </div>
          <CircuitDiagram svg={diagramSvg} />
          <p className="diagram-note">Circuit diagram is generated based on simplified equations.</p>
        </section>
      );
    }
    if (activeTab === "timing") {
      return <TimingDiagram result={result} />;
    }
    if (activeTab === "verilog") {
      return (
        <section className="tab-card">
          <div className="tab-section-heading">
            <div>
              <h2>Verilog Code</h2>
              <p>Generated HDL keeps ASCII identifiers for simulator compatibility.</p>
            </div>
          </div>
          {verilogCode ? (
            <VerilogGenerator
              code={verilogCode}
              gateCode={equationNetlistCode}
              testbenchCode={testbenchCode}
              onDownload={downloadVerilog}
              onDownloadGate={downloadEquationNetlist}
              onDownloadTestbench={downloadTestbench}
            />
          ) : (
            <p className="placeholder">Generate the design to view Verilog HDL code.</p>
          )}
        </section>
      );
    }
    return (
      <ValidationPanel
        result={result}
        messages={messages}
        diagramSvg={diagramSvg}
        verilogCode={verilogCode}
        validationReport={validationReport}
      />
    );
  }

  return (
    <div className="app-shell">
      <Header studentInfo={STUDENT_INFO} />
      <main className="design-workspace">
        <InputPanel
          modelType={modelType}
          setModelType={setModelType}
          flipFlopType={flipFlopType}
          setFlipFlopType={setFlipFlopType}
          inputVariableText={inputVariableText}
          setInputVariableText={setInputVariableText}
          outputVariableText={outputVariableText}
          setOutputVariableText={setOutputVariableText}
          rows={rows}
          updateRow={updateRow}
          clearRows={() => {
            setRows(createFixedGroupedRows());
            setResult(null);
          }}
          loadJkExample={() => loadExample(JK_EXAMPLE)}
          loadDExample={() => loadExample(D_EXAMPLE)}
          generate={generate}
          exportReport={exportReport}
          downloadDiagram={downloadDiagram}
          openAbout={() => setShowAbout(true)}
          messages={messages}
        />
        <section className="panel main-panel">
          <div className="main-topbar">
            <div>
              <span className="panel-kicker">Main Workspace</span>
              <h2>{activeTabLabel}</h2>
            </div>
            <div className={`validation-pill ${validationState.tone}`}>
              <span className="status-dot" />
              {validationState.label}
            </div>
          </div>
          <nav className="tab-nav" aria-label="Main content tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? "active" : ""}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="tab-content">
            {renderActiveTab()}
          </div>
        </section>
      </main>
      {showAbout && <AboutModal studentInfo={STUDENT_INFO} onClose={() => setShowAbout(false)} />}
    </div>
  );
}
