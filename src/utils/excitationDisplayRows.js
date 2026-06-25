function binaryInputCombinations(inputCount) {
  const count = Math.max(1, inputCount || 1);
  return Array.from({ length: 2 ** count }, (_, index) => index.toString(2).padStart(count, "0"));
}

function groupedRowForState(groupedRows = [], state) {
  return groupedRows.find((row) => row.stateId === state || row.presentState === state);
}

function dontCareExcitation(inputs = []) {
  return Object.fromEntries(inputs.map((input) => [input, "-"]));
}

export function excitationRowsForDisplay(result) {
  if (!result) return [];
  const states = result.encodingInfo?.states || [];
  const encoding = result.encodingInfo?.encoding || {};
  const inputCombinations = binaryInputCombinations(result.inputVariables?.length || 1);
  const excitationInputs = (result.equations || []).map((equation) => equation.input);
  const generatedRows = new Map(
    (result.excitationRows || []).map((row) => [`${row.presentState}:${row.input}`, row])
  );

  return states.flatMap((state) => {
    const groupedRow = groupedRowForState(result.groupedRows, state);
    const disabledState = groupedRow?.presentState === "--";
    return inputCombinations.map((input) => {
      const generated = generatedRows.get(`${state}:${input}`);
      if (generated && !disabledState) return { ...generated, displayDisabled: false };
      return {
        presentState: state,
        presentCode: encoding[state] || "--",
        input,
        nextState: "-",
        nextCode: "--",
        output: "-",
        excitation: dontCareExcitation(excitationInputs),
        displayDisabled: true
      };
    });
  });
}
