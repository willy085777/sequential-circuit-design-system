import { normalizeEquationForVerilog } from "./equationFormatter.js";
import { bitForStateVariable } from "./stateEncoding.js";

function portList(names) {
  return names.join(", ");
}

export function generateVerilog({ result, flipFlopType, inputVariables, outputVariables }) {
  if (!result) return "";
  const stateVariables = result.encodingInfo.stateVariables;
  const allVariables = [...stateVariables, ...inputVariables];
  const resetCode = result.encodingInfo.encoding[result.encodingInfo.states[0]] || "0".repeat(stateVariables.length);
  const ffEquations = result.equations
    .map((equation) => `wire ${equation.input} = ${normalizeEquationForVerilog(equation.equation, allVariables)};`)
    .join("\n");
  const outputAssignments = result.outputEquations
    .map((equation) => `assign ${equation.output} = ${normalizeEquationForVerilog(equation.equation, equation.variables)};`)
    .join("\n");

  const resetAssignments = stateVariables
    .map((stateVariable) => `      ${stateVariable} <= 1'b${bitForStateVariable(resetCode, stateVariable)};`)
    .join("\n");

  const updateAssignments = stateVariables
    .map((stateVariable) => {
      const suffix = stateVariable.slice(1);
      if (flipFlopType === "D") return `      ${stateVariable} <= D${suffix};`;
      if (flipFlopType === "T") return `      if (T${suffix}) ${stateVariable} <= ~${stateVariable};`;
      return `      case ({J${suffix}, K${suffix}})
        2'b00: ${stateVariable} <= ${stateVariable};
        2'b01: ${stateVariable} <= 1'b0;
        2'b10: ${stateVariable} <= 1'b1;
        2'b11: ${stateVariable} <= ~${stateVariable};
      endcase`;
    })
    .join("\n");

  return `module sequential_circuit(
  input CLK,
  input RESET,
  input ${portList(inputVariables)},
  output ${portList(outputVariables)}
);

reg ${portList(stateVariables)};

${ffEquations}
${outputAssignments}

always @(posedge CLK or posedge RESET) begin
  if (RESET) begin
${resetAssignments}
  end else begin
${updateAssignments}
  end
end

endmodule
`;
}

export function generateEquationNetlistVerilog({ result, inputVariables, outputVariables }) {
  if (!result) return "";
  const stateVariables = result.encodingInfo.stateVariables;
  const equationOutputs = result.equations.map((equation) => equation.input);
  const allVariables = [...stateVariables, ...inputVariables];
  const inputPorts = [...stateVariables, ...inputVariables];
  const outputPorts = [...equationOutputs, ...outputVariables];
  const ffAssignments = result.equations
    .map((equation) => `assign ${equation.input} = ${normalizeEquationForVerilog(equation.equation, allVariables)};`)
    .join("\n");
  const outputAssignments = result.outputEquations
    .map((equation) => `assign ${equation.output} = ${normalizeEquationForVerilog(equation.equation, equation.variables)};`)
    .join("\n");

  return `module sequential_circuit_equation_netlist(
  input ${portList(inputPorts)},
  output ${portList(outputPorts)}
);

${ffAssignments}
${outputAssignments}

endmodule
`;
}

export function generateTestbench({ result, inputVariables, outputVariables }) {
  if (!result) return "";
  const stimulus = result.sourceRows
    .slice(0, Math.min(result.sourceRows.length, 12))
    .map((row, index) => {
      const inputAssignments = inputVariables
        .map((variable, variableIndex) => `${variable} = 1'b${row.input[variableIndex] || "0"};`)
        .join(" ");
      return `    // Step ${index + 1}: ${row.presentState} + input ${row.input} => ${row.nextState}, expected ${outputVariables.join(",")}=${row.output}
    ${inputAssignments} #20;`;
    })
    .join("\n");
  const inputRegs = inputVariables.map((variable) => `reg ${variable};`).join("\n");
  const outputWires = outputVariables.map((variable) => `wire ${variable};`).join("\n");
  const monitorInputs = inputVariables.map((variable) => `${variable}=%b`).join(" ");
  const monitorOutputs = outputVariables.map((variable) => `${variable}=%b`).join(" ");
  const dumpArgs = outputVariables.join(", ");

  return `module sequential_circuit_tb;
reg CLK;
reg RESET;
${inputRegs}
${outputWires}

sequential_circuit dut(
  .CLK(CLK),
  .RESET(RESET),
${inputVariables.map((variable) => `  .${variable}(${variable}),`).join("\n")}
${outputVariables.map((variable, index) => `  .${variable}(${variable})${index === outputVariables.length - 1 ? "" : ","}`).join("\n")}
);

initial begin
  CLK = 1'b0;
  forever #5 CLK = ~CLK;
end

initial begin
  RESET = 1'b1;
${inputVariables.map((variable) => `  ${variable} = 1'b0;`).join("\n")}
  #12 RESET = 1'b0;
${stimulus}
  #30 $finish;
end

initial begin
  $monitor("time=%0t ${monitorInputs} -> ${monitorOutputs}", $time, ${[
    ...inputVariables,
    dumpArgs
  ].filter(Boolean).join(", ")});
end

endmodule
`;
}
