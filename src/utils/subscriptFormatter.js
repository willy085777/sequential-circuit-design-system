const subscriptDigits = {
  0: "\u2080",
  1: "\u2081",
  2: "\u2082",
  3: "\u2083",
  4: "\u2084",
  5: "\u2085",
  6: "\u2086",
  7: "\u2087",
  8: "\u2088",
  9: "\u2089"
};

export function formatSubscriptLabel(value) {
  return String(value).replace(/\b([A-Za-z]+)(\d+)\b/g, (_, prefix, digits) => {
    return `${prefix}${[...digits].map((digit) => subscriptDigits[digit] || digit).join("")}`;
  });
}

export function formatLabels(values, separator = ", ") {
  return values.map((value) => formatSubscriptLabel(value)).join(separator);
}
