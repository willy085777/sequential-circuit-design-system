import { formatSubscriptLabel } from "../utils/subscriptFormatter.js";
import { excitationRowsForDisplay } from "../utils/excitationDisplayRows.js";

const excitationRuleContent = {
  JK: {
    title: "JK Excitation Rule",
    headers: ["Q", "Q+", "J", "K"],
    rows: [
      ["0", "0", "0", "-"],
      ["0", "1", "1", "-"],
      ["1", "0", "-", "1"],
      ["1", "1", "-", "0"]
    ]
  },
  T: {
    title: "T Excitation Rule",
    headers: ["Q", "Q+", "T"],
    rows: [
      ["0", "0", "0"],
      ["0", "1", "1"],
      ["1", "0", "1"],
      ["1", "1", "0"]
    ]
  },
  D: {
    title: "D Excitation Rule",
    headers: ["Q", "Q+", "D"],
    rows: [
      ["0", "0", "0"],
      ["0", "1", "1"],
      ["1", "0", "0"],
      ["1", "1", "1"]
    ]
  }
};

const ruleDescription = "Each flip-flop input column is filled by looking up (Q, Q+) for that state bit in this rule table, then minimized with a K-map to produce the equations shown in the Boolean Expressions tab.";

function ExcitationRulePanel({ flipFlopType }) {
  const rule = excitationRuleContent[flipFlopType] || excitationRuleContent.JK;
  return (
    <aside className="excitation-rule-card" aria-label={rule.title}>
      <h3>{rule.title}</h3>
      <table className="excitation-rule-table">
        <thead>
          <tr>
            {rule.headers.map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rule.rows.map((row) => (
            <tr key={row.join("-")}>
              {row.map((cell, index) => <td key={`${row.join("-")}-${index}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p>{ruleDescription}</p>
    </aside>
  );
}

export default function ExcitationTable({ result }) {
  if (!result) {
    return (
      <section className="tab-card">
        <h2>Excitation &amp; K-Maps</h2>
        <p className="placeholder">Generate the design to view excitation rows and simplification maps.</p>
      </section>
    );
  }

  const excitationInputs = result.equations.map((equation) => equation.input);
  const displayRows = excitationRowsForDisplay(result);
  const flipFlopType = result.flipFlopType || "JK";

  return (
    <section className="tab-card">
      <div className="tab-section-heading">
        <div>
          <h2>Excitation Table</h2>
          <p>Generated from present state, input, next state, and selected flip-flop type.</p>
        </div>
      </div>
      <div className="excitation-layout">
        <div className="table-scroll excitation-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Present State</th>
                <th>Encoding</th>
                <th>Input</th>
                <th>Next State</th>
                <th>Next Encoding</th>
                <th>Output</th>
                {excitationInputs.map((input) => <th key={input}>{formatSubscriptLabel(input)}</th>)}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, index) => (
                <tr key={`${row.presentState}-${row.input}-${index}`} className={row.displayDisabled ? "disabled-state-row" : ""}>
                  <td>{row.presentState}</td>
                  <td>{row.presentCode}</td>
                  <td>{row.input}</td>
                  <td>{row.nextState}</td>
                  <td>{row.nextCode}</td>
                  <td>{row.output}</td>
                  {excitationInputs.map((input) => (
                    <td key={`${input}-${index}`}>{row.excitation[input] ?? "-"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ExcitationRulePanel flipFlopType={flipFlopType} />
      </div>
    </section>
  );
}
