const FIXED_STATES = ["A", "B", "C", "D"];
const FIXED_ENCODING = {
  A: "00",
  B: "01",
  C: "10",
  D: "11"
};

export function collectStates(rows) {
  const states = [];
  rows.forEach((row) => {
    [row.presentState, row.nextState].forEach((state) => {
      const value = String(state || "").trim();
      if (value && !states.includes(value)) states.push(value);
    });
  });
  return states;
}

export function getStateVariables(bitCount) {
  return Array.from({ length: bitCount }, (_, index) => `Q${index}`);
}

export function getEncodingBitVariables(bitCount) {
  return Array.from({ length: bitCount }, (_, index) => `Q${bitCount - 1 - index}`);
}

export function bitForStateVariable(stateCode, stateVariable) {
  const bitIndexFromLeft = Number(stateVariable.slice(1));
  return stateCode[bitIndexFromLeft] || "0";
}

export function codeInVariableOrder(stateCode, stateVariables) {
  return stateVariables.map((stateVariable) => bitForStateVariable(stateCode, stateVariable)).join("");
}

export function encodeStates(rows) {
  const activeStates = collectStates(rows).filter((state) => FIXED_STATES.includes(state));
  const states = [...FIXED_STATES];
  const bitCount = 2;
  const stateVariables = getStateVariables(bitCount);
  const encodingBitVariables = getEncodingBitVariables(bitCount);
  const encoding = { ...FIXED_ENCODING };
  const usedCodes = new Set(Object.values(encoding));
  const allCodes = Array.from({ length: 2 ** bitCount }, (_, index) =>
    index.toString(2).padStart(bitCount, "0")
  );
  const unusedCodes = allCodes.filter((code) => !usedCodes.has(code));
  return { states, activeStates, bitCount, stateVariables, encodingBitVariables, encoding, allCodes, unusedCodes };
}
