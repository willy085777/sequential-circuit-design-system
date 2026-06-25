function statusLabel(status) {
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  return "SKIPPED";
}

export default function ValidationPanel({ messages, validationReport, onAutoDebug, autoDebugResult }) {
  const cards = validationReport?.cards || [];

  return (
    <section className="tab-card">
      <div className="tab-section-heading">
        <div>
          <h2>Validation</h2>
          <p>Real project readiness checks from the state table, equations, timing simulator, and circuit graph.</p>
        </div>
        <div className="validation-actions">
          <span className={`validation-summary-pill ${validationReport?.allCriticalPass ? "pass" : "fail"}`}>
            {validationReport?.allCriticalPass ? "All Critical Checks Pass" : "Review Required"}
          </span>
          <button type="button" onClick={onAutoDebug}>Auto Debug</button>
        </div>
      </div>

      {(messages.errors.length > 0 || messages.warnings.length > 0) && (
        <div className="message-box validation-messages">
          {messages.errors.map((message) => <p className="error-text" key={message}>{message}</p>)}
          {messages.warnings.map((message) => <p className="warning-text" key={message}>{message}</p>)}
        </div>
      )}

      {autoDebugResult && (
        <div className={`auto-debug-result ${autoDebugResult.passed ? "pass" : "fail"}`}>
          <div className="auto-debug-head">
            <strong>Auto Debug Result: {autoDebugResult.passed ? "PASS" : "FAIL"}</strong>
            <span>Attempts: {autoDebugResult.attemptsUsed}</span>
          </div>
          <div className="auto-debug-columns">
            <div>
              <h3>Fixed / Attempted</h3>
              <ul>
                {(autoDebugResult.fixes || []).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div>
              <h3>Before</h3>
              {(autoDebugResult.errorsBefore || []).length ? (
                <ul>
                  {autoDebugResult.errorsBefore.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p>No layout errors found before retry.</p>
              )}
            </div>
            <div>
              <h3>After</h3>
              {(autoDebugResult.errorsAfter || []).length ? (
                <ul>
                  {autoDebugResult.errorsAfter.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : (
                <p>Remaining critical layout errors: 0.</p>
              )}
              {(autoDebugResult.warnings || []).length > 0 && (
                <p className="warning-text">{autoDebugResult.warnings.slice(0, 2).join(" ")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="validation-grid">
        {cards.map((card) => (
          <article className={`validation-card ${card.status}`} key={card.title}>
            <span className="validation-status">{statusLabel(card.status)}</span>
            <h3>{card.title}</h3>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
