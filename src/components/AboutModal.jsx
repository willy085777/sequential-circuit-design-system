export default function AboutModal({ studentInfo, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="about-title">Sequential Circuit Design Automation System</h2>
        <p><strong>Final Project</strong></p>
        <p>Author: {studentInfo.name}<br />Student ID: {studentInfo.studentId}</p>
        <p>This system generates flip-flop input equations and a sequential circuit diagram from a user-defined state table.</p>
        <button className="primary-button" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
