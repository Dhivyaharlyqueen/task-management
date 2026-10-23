import { useState, useEffect } from "react";
import { collection, addDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfvYsnmjMhWF7f-WRFU83vkNjrSz-lXrw5pTqlOvA42FaiHiu8bUUUuWlBqdQwtio_KA/exec";

function App() {
  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [task, setTask] = useState("");
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "tasks"), orderBy("createdAt"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, []);

  async function addTask(e) {
    e.preventDefault();
    if (!empId.trim() || !empName.trim() || !task.trim()) {
      alert("Please fill all fields");
      return;
    }
    await addDoc(collection(db, "tasks"), {
      "Employee ID": empId.trim(),
      "Employee Name": empName.trim(),
      "Task Done": task.trim(),
      createdAt: Date.now(),
    });
    setEmpId("");
    setEmpName("");
    setTask("");
  }

  async function syncToSheets() {
    if (tasks.length === 0) {
      alert("Please add at least one task");
      return;
    }
    const payload = tasks.map(({ "Employee ID": id, "Employee Name": name, "Task Done": done }) => ({
      "Employee ID": id,
      "Employee Name": name,
      "Task Done": done,
    }));
    try {
      // text/plain keeps this a simple request. Apps Script rejects the
      // CORS preflight that application/json would trigger, and no-cors
      // lets the browser follow Google's redirect.
      await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      alert("Sync sent. Open the Google Sheet to confirm the rows. If nothing was added, redeploy the Apps Script web app with Execute as: Me and Who has access: Anyone, then replace the /exec URL in the app.");
    } catch {
      alert("Failed to reach Google Sheets. Check your connection and try again.");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Employee Task Tracker</h1>
          <p>Manage employee work details</p>
        </div>
        <button
          onClick={() => signOut(auth)}
          style={{ padding: "8px 18px", cursor: "pointer", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff", fontWeight: 600 }}
        >
          Logout
        </button>
      </header>

      <main className="container">
        <section className="form-card">
          <h2>Add Employee Task</h2>
          <p className="subtitle">Enter employee details and completed work.</p>

          <form onSubmit={addTask}>
            <label htmlFor="empId">Employee ID</label>
            <input
              id="empId"
              type="text"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="Enter employee ID"
              required
            />

            <label htmlFor="empName">Employee Name</label>
            <input
              id="empName"
              type="text"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              placeholder="Enter employee name"
              required
            />

            <label htmlFor="task">Task Done</label>
            <textarea
              id="task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe the completed task"
              rows={4}
              required
            />

            <button className="add-btn" type="submit">
              + Add Task
            </button>
          </form>
        </section>

        <section className="table-card">
          <div className="table-heading">
            <div>
              <h2>Employee Task List</h2>
              <p className="subtitle">Total tasks: {tasks.length}</p>
            </div>
            <button type="button" className="download-btn" onClick={syncToSheets}>
              Sync to Google Sheets
            </button>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Task Done</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="empty">No tasks added yet</td>
                  </tr>
                ) : (
                  tasks.map((item) => (
                    <tr key={item.id}>
                      <td>{item["Employee ID"]}</td>
                      <td>{item["Employee Name"]}</td>
                      <td>{item["Task Done"]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
