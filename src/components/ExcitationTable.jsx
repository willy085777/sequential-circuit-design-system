import { formatSubscriptLabel } from "../utils/subscriptFormatter.js";
import { excitationRowsForDisplay } from "../utils/excitationDisplayRows.js";

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

  return (
    <section className="tab-card">
      <div className="tab-section-heading">
        <div>
          <h2>Excitation Table</h2>
          <p>Generated from present state, input, next state, and selected flip-flop type.</p>
        </div>
      </div>
      <div className="table-scroll">
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
    </section>
  );
}
