import { useState, useEffect, useRef } from "react";
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import Snackbar, { useSnackbar } from "./component/Snackbar";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfvYsnmjMhWF7f-WRFU83vkNjrSz-lXrw5pTqlOvA42FaiHiu8bUUUuWlBqdQwtio_KA/exec";

function taskKey(row) {
  return ["Employee ID", "Employee Name", "Task Done"]
    .map((field) => String(row[field] ?? "").trim())
    .join("|");
}

function sheetRow(row) {
  const item = {
    "Employee ID": String(row["Employee ID"] ?? "").trim(),
    "Employee Name": String(row["Employee Name"] ?? "").trim(),
    "Task Done": String(row["Task Done"] ?? "").trim(),
  };
  if (!item["Employee ID"] && !item["Employee Name"] && !item["Task Done"]) return null;
  return item;
}

function fetchSheetRows() {
  return new Promise((resolve, reject) => {
    const callbackName = `onSheetRows_${Date.now()}`;
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Google Sheets did not respond"));
    }, 20000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (rows) => {
      cleanup();
      resolve(Array.isArray(rows) ? rows : []);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Could not read Google Sheets"));
    };
    script.src = `${APPS_SCRIPT_URL}?callback=${callbackName}`;
    document.body.appendChild(script);
  });
}

function App() {
  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [task, setTask] = useState("");
  const [tasks, setTasks] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const { snack, showSnack, closeSnack } = useSnackbar();
  const tasksRef = useRef([]);
  const importedRef = useRef(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    const q = query(collection(db, "tasks"), orderBy("createdAt"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      tasksRef.current = next;
      setTasks(next);
      if (!importedRef.current) {
        importedRef.current = true;
        loadFromSheets(next, true);
      }
    });
    return unsubscribe;
  }, []);

  function clearForm() {
    setEditingId(null);
    setEmpId("");
    setEmpName("");
    setTask("");
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEmpId(item["Employee ID"] ?? "");
    setEmpName(item["Employee Name"] ?? "");
    setTask(item["Task Done"] ?? "");
    setConfirmId(null);
  }

  async function addTask(e) {
    e.preventDefault();
    if (!empId.trim() || !empName.trim() || !task.trim()) {
      showSnack("Please fill all fields", "error");
      return;
    }
    const data = {
      "Employee ID": empId.trim(),
      "Employee Name": empName.trim(),
      "Task Done": task.trim(),
    };
    if (editingId) {
      await updateDoc(doc(db, "tasks", editingId), data);
      showSnack("Task updated", "success");
    } else {
      await addDoc(collection(db, "tasks"), {
        ...data,
        createdAt: Date.now(),
      });
      showSnack("Task added", "success");
    }
    clearForm();
  }

  async function removeTask(id) {
    await deleteDoc(doc(db, "tasks", id));
    if (editingId === id) clearForm();
    setConfirmId(null);
    showSnack("Task deleted", "success");
  }

  async function loadFromSheets(currentTasks = tasksRef.current, silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingSheets(true);
    try {
      const rows = await fetchSheetRows();
      const existing = new Set(currentTasks.map(taskKey));
      const fresh = [];
      rows.forEach((row) => {
        const item = sheetRow(row);
        if (!item) return;
        const key = taskKey(item);
        if (existing.has(key)) return;
        existing.add(key);
        fresh.push(item);
      });
      for (let index = 0; index < fresh.length; index += 1) {
        await addDoc(collection(db, "tasks"), {
          ...fresh[index],
          createdAt: Date.now() + index,
        });
      }
      if (fresh.length > 0) {
        showSnack(`Added ${fresh.length} new task(s) from Google Sheets.`, "success");
      } else if (!silent) {
        showSnack("No new tasks in Google Sheets.", "info");
      }
    } catch {
      if (!silent) {
        showSnack("Could not read Google Sheets. Deploy the new Apps Script version.", "error");
      }
    } finally {
      loadingRef.current = false;
      setLoadingSheets(false);
    }
  }

  async function syncToSheets() {
    if (tasks.length === 0) {
      showSnack("Please add at least one task", "error");
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
      showSnack("Sync sent. Open the Google Sheet to confirm the rows.", "success");
    } catch {
      showSnack("Failed to reach Google Sheets. Check your connection and try again.", "error");
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                <path d="M8 7h8M8 12h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </span>
            <div className="brand-text">
              <h1>Employee Task Tracker</h1>
              <span className="brand-divider" aria-hidden="true" />
              <p>Manage employee work details</p>
            </div>
          </div>
          <button type="button" className="logout-btn" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>
      </header>

      <main className="container">
        <section className="form-card">
          <h2>{editingId ? "Edit Employee Task" : "Add Employee Task"}</h2>
          <p className="subtitle">
            {editingId ? "Update the selected task, then save." : "Enter employee details and completed work."}
          </p>

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

            <div className="form-actions">
              <button className="add-btn" type="submit">
                {editingId ? "Update Task" : "+ Add Task"}
              </button>
              {editingId && (
                <button className="cancel-btn" type="button" onClick={clearForm}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="table-card">
          <div className="table-heading">
            <div>
              <h2>Employee Task List</h2>
              <p className="subtitle"><span className="count-pill">{tasks.length}</span> tasks</p>
            </div>
            <div className="sheet-actions">
              <button type="button" className="load-btn" onClick={() => loadFromSheets()} disabled={loadingSheets}>
                {loadingSheets ? "Loading..." : "Load from Google Sheets"}
              </button>
              <button type="button" className="download-btn" onClick={syncToSheets} disabled={loadingSheets}>
                Sync to Google Sheets
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Task Done</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty">No tasks added yet</td>
                  </tr>
                ) : (
                  tasks.map((item) => (
                    <tr key={item.id}>
                      <td>{item["Employee ID"]}</td>
                      <td>{item["Employee Name"]}</td>
                      <td>{item["Task Done"]}</td>
                      <td>
                        <div className="row-actions">
                          <button type="button" className="edit-btn" onClick={() => startEdit(item)}>
                            Edit
                          </button>
                          {confirmId === item.id ? (
                            <>
                              <button type="button" className="delete-btn" onClick={() => removeTask(item.id)}>
                                Confirm
                              </button>
                              <button type="button" className="cancel-btn" onClick={() => setConfirmId(null)}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button type="button" className="delete-btn" onClick={() => setConfirmId(item.id)}>
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Snackbar snack={snack} onClose={closeSnack} />
    </div>
  );
}

export default App;
