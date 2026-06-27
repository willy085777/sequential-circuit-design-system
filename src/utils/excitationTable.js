export function excitationForBit(flipFlopType, currentBit, nextBit) {
  if (flipFlopType === "D") {
    return { D: nextBit };
  }
  if (flipFlopType === "T") {
    return { T: currentBit === nextBit ? "0" : "1" };
  }
  if (currentBit === "0" && nextBit === "0") return { J: "0", K: "-" };
  if (currentBit === "0" && nextBit === "1") return { J: "1", K: "-" };
  if (currentBit === "1" && nextBit === "0") return { J: "-", K: "1" };
  return { J: "-", K: "0" };
}

export function getFlipFlopInputs(flipFlopType) {
  if (flipFlopType === "D") return ["D"];
  if (flipFlopType === "T") return ["T"];
  return ["J", "K"];
}

export function excitationDescription(flipFlopType) {
  if (flipFlopType === "D") {
    return "D Flip-Flop excitation: D = Qnext for each state bit.";
  }
  if (flipFlopType === "T") {
    return "T Flip-Flop excitation: T = Q XOR Qnext. T=0 holds the state and T=1 toggles the state.";
  }
  return "JK Flip-Flop excitation: 0->0 gives J=0,K=-; 0->1 gives J=1,K=-; 1->0 gives J=-,K=1; 1->1 gives J=-,K=0.";
}
