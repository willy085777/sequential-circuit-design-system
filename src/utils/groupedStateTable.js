export const FIXED_STATE_ROWS = ["A", "B", "C", "D"];

function normalizeNextState(value, fallback = "A") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "-" || normalized === "--") return "--";
  if (FIXED_STATE_ROWS.includes(normalized)) return normalized;
  return fallback;
}

function normalizeOutput(value, fallback = "0") {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "-" || normalized === "--" || normalized === "*") return "-";
  if (normalized === "0" || normalized === "1") return normalized;
  return fallback;
}

export function createGroupedRow({
  stateId = "",
  presentState = "",
  next0 = "A",
  next1 = "A",
  output0 = "0",
  output1 = "0",
  mooreOutput = "0"
} = {}) {
  const fixedState = stateId || (FIXED_STATE_ROWS.includes(String(presentState).trim().toUpperCase()) ? String(presentState).trim().toUpperCase() : "");
  const activeState = String(presentState || fixedState || "").trim().toUpperCase();
  return {
    stateId: fixedState,
    presentState: activeState === "--" ? "--" : fixedState || activeState,
    nextStateByInput: {
      0: normalizeNextState(next0),
      1: normalizeNextState(next1)
    },
    outputByInput: {
      0: normalizeOutput(output0),
      1: normalizeOutput(output1)
    },
    mooreOutput: normalizeOutput(mooreOutput)
  };
}

function rowForState(rows, stateId) {
  return rows.find((row) => {
    const present = String(row.presentState || "").trim().toUpperCase();
    const fixed = String(row.stateId || "").trim().toUpperCase();
    return present === stateId || fixed === stateId;
  });
}

export function createFixedGroupedRows(rows = [], { missingDisabled = false } = {}) {
  return FIXED_STATE_ROWS.map((stateId) => {
    const source = rowForState(rows, stateId);
    if (!source) {
      return createGroupedRow({
        stateId,
        presentState: missingDisabled ? "--" : stateId,
        next0: "A",
        next1: "A",
        output0: "0",
        output1: "0",
        mooreOutput: "0"
      });
    }
    return createGroupedRow({
      stateId,
      presentState: String(source.presentState || stateId).trim().toUpperCase() === "--" ? "--" : stateId,
      next0: source.nextStateByInput?.[0] ?? "A",
      next1: source.nextStateByInput?.[1] ?? "A",
      output0: source.outputByInput?.[0] ?? "0",
      output1: source.outputByInput?.[1] ?? "0",
      mooreOutput: source.mooreOutput ?? "0"
    });
  });
}

export function groupedExampleRows() {
  return createFixedGroupedRows(
    [
      createGroupedRow({ stateId: "A", presentState: "A", next0: "A", next1: "B", output0: "0", output1: "0", mooreOutput: "0" }),
      createGroupedRow({ stateId: "B", presentState: "B", next0: "C", next1: "A", output0: "1", output1: "0", mooreOutput: "1" }),
      createGroupedRow({ stateId: "C", presentState: "C", next0: "A", next1: "C", output0: "1", output1: "1", mooreOutput: "1" })
    ],
    { missingDisabled: true }
  );
}

export function cloneGroupedRows(rows) {
  return createFixedGroupedRows(rows, { missingDisabled: true });
}

export function groupedRowsToTransitions(rows, modelType) {
  return createFixedGroupedRows(rows, { missingDisabled: true }).flatMap((row) => {
    if (row.presentState === "--") return [];
    return ["0", "1"].flatMap((inputValue) => {
      const nextState = normalizeNextState(row.nextStateByInput?.[inputValue], "--");
      const output = normalizeOutput(modelType === "Moore" ? row.mooreOutput : row.outputByInput?.[inputValue], "-");
      if (nextState === "--" || output === "-") return [];
      return [{
        presentState: row.stateId,
        input: inputValue,
        nextState,
        output
      }];
    });
  });
}
