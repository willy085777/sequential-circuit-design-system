export default function Header({ studentInfo }) {
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <div className="brand-mark">SC</div>
        <div>
          <h1>Sequential Circuit Design Automation System</h1>
          <p>State table &rarr; equations, K-maps, circuit, timing, and Verilog.</p>
        </div>
      </div>
      <div className="student-card">
        <span>Name: {studentInfo.name}</span>
        <span>Student ID: {studentInfo.studentId}</span>
      </div>
    </header>
  );
}
