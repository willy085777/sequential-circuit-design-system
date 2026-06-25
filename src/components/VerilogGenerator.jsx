import { useMemo, useState } from "react";

export default function VerilogGenerator({
  code,
  gateCode,
  testbenchCode,
  onDownload,
  onDownloadGate,
  onDownloadTestbench
}) {
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState("behavioral");
  const tabs = useMemo(
    () => [
      { id: "behavioral", label: "Behavioral Verilog", code, onDownload, filename: "sequential_circuit.v" },
      { id: "gate", label: "Gate-Level / Equation Netlist", code: gateCode, onDownload: onDownloadGate, filename: "sequential_circuit_equation_netlist.v" },
      { id: "testbench", label: "Testbench", code: testbenchCode, onDownload: onDownloadTestbench, filename: "sequential_circuit_tb.v" }
    ],
    [code, gateCode, testbenchCode, onDownload, onDownloadGate, onDownloadTestbench]
  );
  const selected = tabs.find((tab) => tab.id === active) || tabs[0];

  async function copyCode() {
    if (!selected.code) return;
    await navigator.clipboard.writeText(selected.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (!code) return null;

  return (
    <section className="verilog-section">
      <div className="section-title-row">
        <h3>EXTRA FEATURE: VERILOG HDL CODE</h3>
        <div>
          <button onClick={copyCode}>{copied ? "Copied" : "Copy Code"}</button>
          <button onClick={selected.onDownload}>Download {selected.id === "testbench" ? "Testbench" : ".v"}</button>
        </div>
      </div>

      <div className="verilog-tab-row">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={active === tab.id ? "active" : ""}
            onClick={() => {
              setActive(tab.id);
              setCopied(false);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="code-meta-row">
        <span>{selected.filename}</span>
        <span>ASCII identifiers preserved for simulator compatibility</span>
      </div>
      <pre className="verilog-code-panel">{selected.code}</pre>
    </section>
  );
}
