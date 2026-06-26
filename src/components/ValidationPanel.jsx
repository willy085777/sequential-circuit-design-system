function statusLabel(status) {
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  return "SKIPPED";
}

export default function ValidationPanel({ messages, validationReport }) {
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
        </div>
      </div>

      {(messages.errors.length > 0 || messages.warnings.length > 0) && (
        <div className="message-box validation-messages">
          {messages.errors.map((message) => <p className="error-text" key={message}>{message}</p>)}
          {messages.warnings.map((message) => <p className="warning-text" key={message}>{message}</p>)}
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
