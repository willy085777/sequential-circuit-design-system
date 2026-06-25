import { groupedExampleRows } from "./groupedStateTable.js";

const exampleRows = groupedExampleRows();

export const JK_EXAMPLE = {
  modelType: "Mealy",
  flipFlopType: "JK",
  inputVariables: "X",
  outputVariables: "Z",
  rows: exampleRows
};

export const D_EXAMPLE = {
  modelType: "Mealy",
  flipFlopType: "D",
  inputVariables: "X",
  outputVariables: "Z",
  rows: exampleRows
};
