import { useEffect, useMemo, useState } from "react";
import { parseSopExpression } from "../utils/expressionParser.js";
import { formatLabels, formatSubscriptLabel } from "../utils/subscriptFormatter.js";

const gray = {
  0: [""],
  1: ["0", "1"],
  2: ["00", "01", "11", "10"]
};

const groupColors = ["#00a7c8", "#e06b00", "#6f42c1", "#238636", "#c8326f", "#2563eb"];

export default function KMap({ result }) {
  const [selectedId, setSelectedId] = useState("");
  const mapItems = result?.mapItems || [];

  useEffect(() => {
    setSelectedId(mapItems[0]?.id || "");
  }, [result]);

  const selected = useMemo(() => mapItems.find((item) => item.id === selectedId) || mapItems[0], [mapItems, selectedId]);

  if (!result) return null;
  if (!selected) return <section className="kmap-section"><h3>K-map / Truth-Table Simplification</h3><p>No equations available.</p></section>;

  const variableCount = selected.variables.length;
  const valueMap = new Map(selected.values.map((item) => [item.code, item.value]));
  const groups = parseSopExpression(selected.equation, selected.variables);

  function cellGroups(code) {
    return groups
      .map((group, index) => ({ ...group, index }))
      .filter((group) => group.coveredCodes.includes(code));
  }

  if (variableCount >= 2 && variableCount <= 4) {
    const fixedAxisMap = selected.kmap;
    const rowCount = Math.floor(variableCount / 2);
    const colCount = variableCount - rowCount;
    const rowCodes = fixedAxisMap?.rowCodes || gray[rowCount];
    const colCodes = fixedAxisMap?.columnCodes || gray[colCount];
    const axisCellMap = new Map(
      (fixedAxisMap?.cells || []).map((cell) => [`${cell.rowCode}:${cell.columnCode}`, cell])
    );
    const headerLabel = fixedAxisMap?.header
      || `${formatLabels(selected.variables.slice(0, rowCount), "")}\\${formatLabels(selected.variables.slice(rowCount), "")}`;
    return (
      <section className="kmap-section">
        <h3>K-map / Truth-Table Simplification</h3>
        <label className="field-label compact">
          Inspect Equation
          <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
            {mapItems.map((item) => <option key={item.id} value={item.id}>{formatSubscriptLabel(item.id)}</option>)}
          </select>
        </label>
        <table className="kmap-table">
          <thead>
            <tr>
              <th>{headerLabel}</th>
              {colCodes.map((code) => <th key={code}>{code || "-"}</th>)}
            </tr>
          </thead>
          <tbody>
            {rowCodes.map((rowCode) => (
              <tr key={rowCode || "single"}>
                <th>{rowCode || "-"}</th>
                {colCodes.map((colCode) => {
                  const axisCell = axisCellMap.get(`${rowCode}:${colCode}`);
                  const code = axisCell?.code || `${rowCode}${colCode}`;
                  const groupsForCell = cellGroups(code);
                  return (
                    <td key={code} className="kmap-cell">
                      <span className="kmap-value">{axisCell?.value ?? valueMap.get(code) ?? "0"}</span>
                      {groupsForCell.map((group) => (
                        <span
                          key={`${code}-${group.index}`}
                          className="kmap-loop"
                          style={{
                            borderColor: groupColors[group.index % groupColors.length],
                            inset: `${4 + group.index * 4}px`
                          }}
                          title={formatSubscriptLabel(group.label)}
                        />
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length > 0 && (
          <div className="kmap-groups">
            {groups.map((group, index) => (
              <span key={`${group.label}-${index}`} style={{ color: groupColors[index % groupColors.length] }}>
                Group {index + 1}: {formatSubscriptLabel(group.label)}
              </span>
            ))}
          </div>
        )}
        <p className="simplified-result">
          <strong>Simplified result:</strong> {formatSubscriptLabel(selected.id)} = {formatSubscriptLabel(selected.equation)}
        </p>
      </section>
    );
  }

  return (
    <section className="kmap-section">
      <h3>K-map / Truth-Table Simplification</h3>
      <label className="field-label compact">
        Inspect Equation
        <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
          {mapItems.map((item) => <option key={item.id} value={item.id}>{formatSubscriptLabel(item.id)}</option>)}
        </select>
      </label>
      <div className="table-scroll tight">
        <table>
          <thead><tr>{selected.variables.map((variable) => <th key={variable}>{formatSubscriptLabel(variable)}</th>)}<th>Value</th></tr></thead>
          <tbody>
            {selected.values.map((item) => (
              <tr key={item.code}>{[...item.code].map((bit, index) => <td key={`${item.code}-${index}`}>{bit}</td>)}<td>{item.value}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="simplified-result">
        <strong>Simplified result:</strong> {formatSubscriptLabel(selected.id)} = {formatSubscriptLabel(selected.equation)}
      </p>
    </section>
  );
}
