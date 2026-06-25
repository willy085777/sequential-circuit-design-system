import { useEffect, useRef, useState } from "react";
import { FIXED_STATE_ROWS } from "../utils/groupedStateTable.js";
import { formatSubscriptLabel } from "../utils/subscriptFormatter.js";

function normalizeNextValue(value, fallback = "A") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "-" || normalized === "--") return "--";
  if (FIXED_STATE_ROWS.includes(normalized)) return normalized;
  return fallback;
}

function normalizeOutputValue(value, fallback = "0") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "-" || normalized === "--" || normalized === "*") return "-";
  if (normalized === "0" || normalized === "1") return normalized;
  return fallback;
}

function cycleNextState(value) {
  const normalized = normalizeNextValue(value, "A");
  const index = FIXED_STATE_ROWS.indexOf(normalized);
  if (index < 0) return "A";
  return FIXED_STATE_ROWS[(index + 1) % FIXED_STATE_ROWS.length];
}

function cycleOutput(value) {
  const normalized = normalizeOutputValue(value, "0");
  if (normalized === "0") return "-";
  if (normalized === "-") return "1";
  return "0";
}

function cellKey(rowIndex, field, inputValue = "") {
  return `${rowIndex}:${field}:${inputValue}`;
}

export default function InputPanel({
  modelType,
  setModelType,
  flipFlopType,
  setFlipFlopType,
  inputVariableText,
  setInputVariableText,
  outputVariableText,
  setOutputVariableText,
  rows,
  updateRow,
  clearRows,
  loadJkExample,
  loadDExample,
  generate,
  exportReport,
  downloadDiagram,
  openAbout,
  messages
}) {
  const [editingCell, setEditingCell] = useState(null);
  const [draftValue, setDraftValue] = useState("");
  const clickTimerRef = useRef(null);
  const inputVariable = inputVariableText.split(/[,\s]+/).find(Boolean) || "X";
  const input0Label = `${formatSubscriptLabel(inputVariable)}=0`;
  const input1Label = `${formatSubscriptLabel(inputVariable)}=1`;
  const isMoore = modelType === "Moore";

  useEffect(() => () => clearPendingClick(), []);

  function clearPendingClick() {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }

  function scheduleSingleClick(action) {
    clearPendingClick();
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      action();
    }, 160);
  }

  function rowStateId(row, index) {
    return row?.stateId || FIXED_STATE_ROWS[index] || "A";
  }

  function rowIsDisabled(row) {
    return row?.presentState === "--";
  }

  function isEditing(rowIndex, field, inputValue = "") {
    return editingCell?.key === cellKey(rowIndex, field, inputValue);
  }

  function startEditing(rowIndex, field, inputValue, value) {
    clearPendingClick();
    setEditingCell({ key: cellKey(rowIndex, field, inputValue), rowIndex, field, inputValue });
    setDraftValue(value);
  }

  function finishEditing(save = true) {
    if (!editingCell) return;
    const { rowIndex, field, inputValue } = editingCell;
    if (save) {
      if (field === "nextStateByInput") {
        updateRow(rowIndex, field, normalizeNextValue(draftValue, "A"), inputValue);
      } else {
        updateRow(rowIndex, field, normalizeOutputValue(draftValue, "0"), inputValue);
      }
    }
    setEditingCell(null);
    setDraftValue("");
  }

  function renderEditableCell({ row, rowIndex, field, inputValue, type }) {
    const disabled = rowIsDisabled(row);
    const rawValue = field === "mooreOutput"
      ? row?.mooreOutput
      : field === "nextStateByInput"
        ? row?.nextStateByInput?.[inputValue]
        : row?.outputByInput?.[inputValue];
    const displayValue = disabled
      ? type === "next" ? "--" : "-"
      : type === "next"
        ? normalizeNextValue(rawValue, "A")
        : normalizeOutputValue(rawValue, "0");

    if (!disabled && isEditing(rowIndex, field, inputValue)) {
      return (
        <input
          className="cell-edit-input"
          value={draftValue}
          autoFocus
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={() => finishEditing(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishEditing(true);
            if (event.key === "Escape") finishEditing(false);
          }}
          aria-label={`edit ${field} row ${rowIndex + 1}`}
        />
      );
    }

    return (
      <button
        type="button"
        className={`cycle-cell ${disabled ? "disabled-cell" : ""}`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          scheduleSingleClick(() => {
            if (type === "next") updateRow(rowIndex, field, cycleNextState(rawValue), inputValue);
            else updateRow(rowIndex, field, cycleOutput(rawValue), inputValue);
          });
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) startEditing(rowIndex, field, inputValue, displayValue);
        }}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <aside className="panel input-panel">
      <div className="panel-heading">
        <span className="panel-kicker">Left Sidebar</span>
        <h2>Input / Control Panel</h2>
      </div>

      <div className="form-section numbered-section">
        <h3><span>1</span> Model Type</h3>
        <div className="segmented-options">
          <label><input type="radio" checked={modelType === "Mealy"} onChange={() => setModelType("Mealy")} /> Mealy</label>
          <label><input type="radio" checked={modelType === "Moore"} onChange={() => setModelType("Moore")} /> Moore</label>
        </div>
      </div>

      <div className="form-section numbered-section">
        <h3><span>2</span> Flip-Flop Type</h3>
        <div className="segmented-options three-up">
          {["D", "T", "JK"].map((type) => (
            <label key={type}>
              <input type="radio" checked={flipFlopType === type} onChange={() => setFlipFlopType(type)} /> {type}
            </label>
          ))}
        </div>
      </div>

      <div className="form-section numbered-section">
        <h3><span>3</span> State Table Input</h3>
        <p className="state-table-hint">Click to cycle values. Double-click to type. Click Present State to enable/disable a state.</p>
        <label className="field-label">
          Input Variables
          <input value={inputVariableText} onChange={(event) => setInputVariableText(event.target.value)} placeholder="X or X,Y" />
        </label>
        <label className="field-label">
          Output Variables
          <input value={outputVariableText} onChange={(event) => setOutputVariableText(event.target.value)} placeholder="Z" />
        </label>
        <div className="section-title-row table-title-row">
          <h4>Grouped Editable State Table</h4>
        </div>
        <div className="table-scroll">
          <table className="state-table grouped-state-table fixed-state-table">
            <thead>
              <tr>
                <th rowSpan="2">Present State</th>
                <th colSpan="2">Next State</th>
                <th colSpan={isMoore ? 1 : 2}>Output</th>
              </tr>
              <tr>
                <th>{input0Label}</th>
                <th>{input1Label}</th>
                {isMoore ? (
                  <th>Moore Output</th>
                ) : (
                  <>
                    <th>{input0Label}</th>
                    <th>{input1Label}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {FIXED_STATE_ROWS.map((fixedState, index) => {
                const row = rows[index] || { stateId: fixedState, presentState: fixedState, nextStateByInput: { 0: "A", 1: "A" }, outputByInput: { 0: "0", 1: "0" }, mooreOutput: "0" };
                const disabled = rowIsDisabled(row);
                return (
                  <tr key={fixedState} className={disabled ? "disabled-state-row" : ""}>
                    <td>
                      <button
                        type="button"
                        className={`present-state-toggle ${disabled ? "disabled-cell" : ""}`}
                        onClick={() => updateRow(index, "togglePresentState")}
                        title={`Toggle ${fixedState} active / don't care`}
                      >
                        {rowStateId(row, index)}
                      </button>
                    </td>
                    <td>{renderEditableCell({ row, rowIndex: index, field: "nextStateByInput", inputValue: "0", type: "next" })}</td>
                    <td>{renderEditableCell({ row, rowIndex: index, field: "nextStateByInput", inputValue: "1", type: "next" })}</td>
                    {isMoore ? (
                      <td>{renderEditableCell({ row, rowIndex: index, field: "mooreOutput", inputValue: "", type: "output" })}</td>
                    ) : (
                      <>
                        <td>{renderEditableCell({ row, rowIndex: index, field: "outputByInput", inputValue: "0", type: "output" })}</td>
                        <td>{renderEditableCell({ row, rowIndex: index, field: "outputByInput", inputValue: "1", type: "output" })}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="form-section numbered-section">
        <h3><span>4</span> Examples &amp; Actions</h3>
        <div className="button-grid">
          <button onClick={loadJkExample}>Load JK Example</button>
          <button onClick={loadDExample}>Load D Example</button>
          <button className="primary-button" onClick={generate}>Generate</button>
          <button onClick={clearRows}>Clear Table</button>
        </div>
      </div>

      <div className="form-section numbered-section">
        <h3><span>5</span> Design File / Export</h3>
        <div className="button-grid">
          <button onClick={exportReport}>Export Report</button>
          <button onClick={downloadDiagram}>Download Diagram</button>
          <button onClick={openAbout}>About</button>
        </div>
      </div>

      {(messages.errors.length > 0 || messages.warnings.length > 0) && (
        <div className="message-box">
          {messages.errors.map((message) => <p className="error-text" key={message}>{message}</p>)}
          {messages.warnings.map((message) => <p className="warning-text" key={message}>{message}</p>)}
        </div>
      )}
    </aside>
  );
}
