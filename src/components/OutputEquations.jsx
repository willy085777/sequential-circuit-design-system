import { formatLabels, formatSubscriptLabel } from "../utils/subscriptFormatter.js";

export default function OutputEquations({ result }) {
  return (
    <div>
      <h2>OUTPUT 1: FLIP-FLOP INPUT EQUATIONS</h2>
      {!result ? (
        <p className="placeholder">Load an example or enter a state table, then click Generate.</p>
      ) : (
        <>
          <div className="summary-line">
            <strong>State Variables:</strong> {formatLabels(result.encodingInfo.stateVariables, " ")}
            <span className="bit-order-note"> Q₀ is the least significant state bit.</span>
          </div>

          <h3>State Encoding Table</h3>
          <table>
            <thead>
              <tr>
                <th>State</th>
                {result.encodingInfo.encodingBitVariables.map((variable) => (
                  <th key={variable}>{formatSubscriptLabel(variable)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.encodingInfo.states.map((state) => (
                <tr key={state}>
                  <td>{state}</td>
                  {[...result.encodingInfo.encoding[state]].map((bit, index) => (
                    <td key={`${state}-${index}`}>{bit}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Flip-Flop Input Equations</h3>
          <table>
            <thead><tr><th>Flip-Flop</th><th>Input</th><th>Equation</th></tr></thead>
            <tbody>
              {result.equations.map((equation) => (
                <tr key={equation.id}>
                  <td>{formatSubscriptLabel(equation.flipFlop)}</td>
                  <td>{formatSubscriptLabel(equation.input)}</td>
                  <td className="equation-cell">{formatSubscriptLabel(equation.equation)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Output Equation Section</h3>
          <table>
            <thead><tr><th>Output</th><th>Equation</th><th>Variables</th></tr></thead>
            <tbody>
              {result.outputEquations.map((equation) => (
                <tr key={equation.output}>
                  <td>{formatSubscriptLabel(equation.output)}</td>
                  <td className="equation-cell">{formatSubscriptLabel(equation.equation)}</td>
                  <td>{formatLabels(equation.variables)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
