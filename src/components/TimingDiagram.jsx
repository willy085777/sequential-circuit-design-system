import { useEffect, useMemo, useState } from "react";
import { createSimulationTrace, defaultInputSequence, parseInputSequence } from "../utils/simulation.js";
import { formatSubscriptLabel } from "../utils/subscriptFormatter.js";

const STEP_WIDTH = 78;
const WAVE_HEIGHT = 42;

function bitY(value) {
  return value === "1" ? 10 : 30;
}

function digitalPath(values) {
  if (!values.length) return "";
  const points = [`0,${bitY(values[0])}`];
  values.forEach((value, index) => {
    const start = index * STEP_WIDTH;
    const end = (index + 1) * STEP_WIDTH;
    const y = bitY(value);
    if (index > 0) points.push(`${start},${y}`);
    points.push(`${end},${y}`);
  });
  return points.join(" ");
}

function clockPath(count) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * STEP_WIDTH;
    const mid = start + STEP_WIDTH / 2;
    const end = start + STEP_WIDTH;
    points.push(`${start},30`, `${start},10`, `${mid},10`, `${mid},30`, `${end},30`);
  }
  return points.join(" ");
}

function laneValues(lane, rows, result) {
  if (lane === "CLK") return rows.map(() => "1");
  if (result.inputVariables.includes(lane)) {
    const index = result.inputVariables.indexOf(lane);
    return rows.map((row) => row.input[index] || "0");
  }
  if (result.encodingInfo.stateVariables.includes(lane)) {
    return rows.map((row) => row.presentValues[lane] || "0");
  }
  if (result.outputVariables.includes(lane)) {
    const index = result.outputVariables.indexOf(lane);
    return rows.map((row) => row.actualOutput[index] || "0");
  }
  return rows.map(() => "0");
}

function WaveLane({ lane, rows, result, activeStep }) {
  const width = Math.max(STEP_WIDTH * Math.max(rows.length, 1), 520);
  const values = laneValues(lane, rows, result);
  const isClock = lane === "CLK";
  return (
    <div className="timing-lane">
      <span>{formatSubscriptLabel(lane)}</span>
      <svg viewBox={`0 0 ${width} ${WAVE_HEIGHT}`} aria-label={`${lane} timing waveform`}>
        {rows.map((row, index) => (
          <g key={`${lane}-grid-${row.step}`}>
            <line x1={index * STEP_WIDTH} y1="4" x2={index * STEP_WIDTH} y2="38" className="timing-grid-line" />
            <text x={index * STEP_WIDTH + 8} y="39" className="timing-step-label">{row.step}</text>
          </g>
        ))}
        <polyline points={isClock ? clockPath(rows.length) : digitalPath(values)} className="timing-wave" />
        {values.map((value, index) => (
          <text key={`${lane}-value-${index}`} x={index * STEP_WIDTH + 30} y={bitY(value) - 4} className="timing-value-label">
            {isClock ? "" : value}
          </text>
        ))}
        {activeStep > 0 && (
          <line
            x1={Math.min(activeStep, rows.length) * STEP_WIDTH}
            y1="2"
            x2={Math.min(activeStep, rows.length) * STEP_WIDTH}
            y2="40"
            className="timing-cursor"
          />
        )}
      </svg>
    </div>
  );
}

export default function TimingDiagram({ result }) {
  const [sequenceText, setSequenceText] = useState("");
  const [activeStep, setActiveStep] = useState(0);
  const [autoRun, setAutoRun] = useState(false);
  const [speed, setSpeed] = useState(700);

  useEffect(() => {
    setSequenceText(result ? defaultInputSequence(result) : "0 1 0 1 0 1 0 1");
    setActiveStep(0);
    setAutoRun(false);
  }, [result]);

  const parsedSequence = useMemo(
    () => parseInputSequence(sequenceText, result?.inputVariables?.length || 1),
    [sequenceText, result]
  );
  const trace = useMemo(
    () => (result ? createSimulationTrace({ result, inputSequence: parsedSequence.values }) : { rows: [], errors: [] }),
    [result, parsedSequence.values]
  );
  const rows = trace.rows;
  const visibleRows = rows.length ? rows : [];
  const currentRow = rows[Math.min(Math.max(activeStep, 0), Math.max(rows.length - 1, 0))];
  const lanes = result ? ["CLK", ...result.inputVariables, ...result.encodingInfo.stateVariables, ...result.outputVariables] : [];

  useEffect(() => {
    if (!autoRun || !rows.length) return undefined;
    const timer = window.setInterval(() => {
      setActiveStep((step) => {
        if (step >= rows.length) {
          setAutoRun(false);
          return step;
        }
        return step + 1;
      });
    }, Number(speed));
    return () => window.clearInterval(timer);
  }, [autoRun, rows.length, speed]);

  function reset() {
    setAutoRun(false);
    setActiveStep(0);
  }

  function step() {
    setAutoRun(false);
    setActiveStep((value) => Math.min(value + 1, rows.length));
  }

  function runAll() {
    setAutoRun(false);
    setActiveStep(rows.length);
  }

  if (!result) {
    return (
      <section className="tab-card">
        <h2>Timing Diagram</h2>
        <p className="placeholder">Generate a design to simulate CLK, X, state bits, and output timing.</p>
      </section>
    );
  }

  return (
    <section className="tab-card">
      <div className="tab-section-heading">
        <div>
          <h2>Timing Diagram</h2>
          <p>Step-by-step simulation derived from the current state table and generated equations.</p>
        </div>
      </div>

      <div className="timing-controls">
        <label className="field-label timing-sequence-field">
          Input Sequence for {result.inputVariables.map((variable) => formatSubscriptLabel(variable)).join(", ")}
          <input value={sequenceText} onChange={(event) => { setSequenceText(event.target.value); setActiveStep(0); }} />
        </label>
        <div className="timing-button-row">
          <button onClick={reset}>Reset</button>
          <button onClick={step} disabled={!rows.length || activeStep >= rows.length}>Step</button>
          <button onClick={() => setAutoRun((value) => !value)} disabled={!rows.length}>
            {autoRun ? "Pause" : "Auto Run"}
          </button>
          <button onClick={runAll} disabled={!rows.length}>Run All</button>
          <label className="speed-control">
            Speed
            <input type="range" min="250" max="1500" step="50" value={speed} onChange={(event) => setSpeed(event.target.value)} />
            <span>{speed} ms</span>
          </label>
        </div>
      </div>

      {parsedSequence.errors.length > 0 && (
        <div className="message-box">
          {parsedSequence.errors.map((error) => <p className="error-text" key={error}>{error}</p>)}
        </div>
      )}

      {currentRow && (
        <div className="timing-summary-grid">
          <div><span>Current Step</span><strong>{Math.min(activeStep + 1, rows.length)}</strong></div>
          <div><span>Present State</span><strong>{currentRow.presentState}</strong></div>
          <div><span>Input</span><strong>{currentRow.input}</strong></div>
          <div><span>Output</span><strong>{currentRow.actualOutput}</strong></div>
          <div><span>Next State</span><strong>{currentRow.actualNextState}</strong></div>
          <div><span>Trace Result</span><strong className={currentRow.result === "PASS" ? "pass-text" : "fail-text"}>{currentRow.result}</strong></div>
        </div>
      )}

      <div className="timing-card">
        {lanes.map((lane) => (
          <WaveLane key={lane} lane={lane} rows={visibleRows} result={result} activeStep={activeStep} />
        ))}
      </div>

      <h3>Simulation Table</h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>X</th>
              <th>Present State</th>
              <th>Expected Z</th>
              <th>Actual Z</th>
              <th>Expected Next State</th>
              <th>Actual Next State</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`trace-${row.step}`} className={index < activeStep ? "trace-complete" : ""}>
                <td>{row.step}</td>
                <td>{row.input}</td>
                <td>{row.presentState}</td>
                <td>{row.expectedOutput}</td>
                <td>{row.actualOutput}</td>
                <td>{row.expectedNextState}</td>
                <td>{row.actualNextState}</td>
                <td><span className={`result-pill ${row.result.toLowerCase()}`}>{row.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
