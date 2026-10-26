import { useState, useEffect, useRef } from "react";
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import Snackbar, { useSnackbar } from "./component/Snackbar";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfvYsnmjMhWF7f-WRFU83vkNjrSz-lXrw5pTqlOvA42FaiHiu8bUUUuWlBqdQwtio_KA/exec";

function formatDate(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${date.getFullYear()}`;
  }
  if (typeof value === "object" && value.seconds) {
    return formatDate(value.seconds * 1000);
  }

  const dateString = String(value).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) return dateString;

  if (dateString.includes("T")) {
    const parsed = new Date(dateString);
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed.getTime());
  }

  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return dateString;
}

function rowIdentity(item) {
  return ["Employee ID", "Employee Name", "Task Done"]
    .map((field) => String(item[field] ?? "").trim())
    .join("|");
}

function looseKey(item) {
  return ["Employee ID", "Task Done"]
    .map((field) => String(item[field] ?? "").trim())
    .join("|");
}

function takeUniquePairs(sheetLeft, appLeft, keyFn) {
  const sheetBuckets = new Map();
  const appBuckets = new Map();
  sheetLeft.forEach((item) => {
    const key = keyFn(item);
    if (!key.replace("|", "")) return;
    if (!sheetBuckets.has(key)) sheetBuckets.set(key, []);
    sheetBuckets.get(key).push(item);
  });
  appLeft.forEach((item) => {
    const key = keyFn(item);
    if (!key.replace("|", "")) return;
    if (!appBuckets.has(key)) appBuckets.set(key, []);
    appBuckets.get(key).push(item);
  });

  const usedSheet = new Set();
  const usedApp = new Set();
  const pairs = [];
  sheetBuckets.forEach((sheetGroup, key) => {
    const appGroup = appBuckets.get(key) || [];
    if (sheetGroup.length === 1 && appGroup.length === 1) {
      pairs.push([sheetGroup[0], appGroup[0]]);
      usedSheet.add(sheetGroup[0]);
      usedApp.add(appGroup[0]);
    }
  });

  return {
    pairs,
    sheetLeft: sheetLeft.filter((item) => !usedSheet.has(item)),
    appLeft: appLeft.filter((item) => !usedApp.has(item)),
  };
}

function toInputDate(value) {
  const formatted = formatDate(value);
  const match = formatted.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function fromInputDate(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function todayInputDate() {
  return toInputDate(Date.now());
}

function sheetRow(row) {
  const item = {
    "Record ID": String(row["Record ID"] ?? "").trim(),
    Date: formatDate(row.Date),
    "Employee ID": String(row["Employee ID"] ?? "").trim(),
    "Employee Name": String(row["Employee Name"] ?? "").trim(),
    "Task Done": String(row["Task Done"] ?? "").trim(),
  };
  if (!item.Date && !item["Employee ID"] && !item["Employee Name"] && !item["Task Done"]) return null;
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
  const [taskDate, setTaskDate] = useState(todayInputDate);
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
    setTaskDate(todayInputDate());
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEmpId(item["Employee ID"] ?? "");
    setEmpName(item["Employee Name"] ?? "");
    setTask(item["Task Done"] ?? "");
    setTaskDate(toInputDate(item.Date || item.createdAt) || todayInputDate());
    setConfirmId(null);
  }

  async function addTask(e) {
    e.preventDefault();
    if (!taskDate || !empId.trim() || !empName.trim() || !task.trim()) {
      showSnack("Please fill all fields", "error");
      return;
    }
    const data = {
      Date: fromInputDate(taskDate),
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
      const sheetItems = [];
      const seenInSheet = new Set();
      rows.forEach((row) => {
        const item = sheetRow(row);
        if (!item) return;
        const identity = item["Record ID"] || rowIdentity(item);
        if (seenInSheet.has(identity)) return;
        seenInSheet.add(identity);
        sheetItems.push(item);
      });

      const groups = new Map();
      currentTasks.forEach((taskItem) => {
        const identity = rowIdentity(taskItem);
        if (!groups.has(identity)) groups.set(identity, []);
        groups.get(identity).push(taskItem);
      });

      const keepers = [];
      const duplicateIds = [];
      groups.forEach((group) => {
        group.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        keepers.push(group[0]);
        group.slice(1).forEach((extra) => duplicateIds.push(extra.id));
      });

      const byId = new Map(keepers.map((item) => [item.id, item]));
      const byIdentity = new Map(keepers.map((item) => [rowIdentity(item), item]));
      const matched = new Set();
      let updated = 0;
      let added = 0;

      async function applyToExisting(existing, data) {
        matched.add(existing.id);
        if (!data.Date) data.Date = formatDate(existing.Date || existing.createdAt);
        const changed = ["Date", "Employee ID", "Employee Name", "Task Done"].some(
          (field) => String(field === "Date" ? formatDate(existing.Date || existing.createdAt) : existing[field] ?? "").trim() !== data[field]
        );
        if (changed) {
          await updateDoc(doc(db, "tasks", existing.id), data);
          updated += 1;
        }
      }

      const pendingSheet = [];
      for (const item of sheetItems) {
        const data = {
          Date: item.Date,
          "Employee ID": item["Employee ID"],
          "Employee Name": item["Employee Name"],
          "Task Done": item["Task Done"],
        };
        const existing = item["Record ID"] && byId.has(item["Record ID"])
          ? byId.get(item["Record ID"])
          : byIdentity.get(rowIdentity(data));

        if (existing && !matched.has(existing.id)) {
          await applyToExisting(existing, data);
          continue;
        }
        if (!existing) pendingSheet.push(item);
      }

      let pendingApp = keepers.filter((item) => !matched.has(item.id));
      let paired = takeUniquePairs(pendingSheet, pendingApp, looseKey);
      for (const [item, existing] of paired.pairs) {
        await applyToExisting(existing, {
          Date: item.Date,
          "Employee ID": item["Employee ID"],
          "Employee Name": item["Employee Name"],
          "Task Done": item["Task Done"],
        });
      }
      paired = takeUniquePairs(
        paired.sheetLeft,
        paired.appLeft,
        (item) => String(item["Employee ID"] ?? "").trim()
      );
      for (const [item, existing] of paired.pairs) {
        await applyToExisting(existing, {
          Date: item.Date,
          "Employee ID": item["Employee ID"],
          "Employee Name": item["Employee Name"],
          "Task Done": item["Task Done"],
        });
      }
      if (paired.sheetLeft.length === 1 && paired.appLeft.length === 1) {
        const item = paired.sheetLeft[0];
        await applyToExisting(paired.appLeft[0], {
          Date: item.Date,
          "Employee ID": item["Employee ID"],
          "Employee Name": item["Employee Name"],
          "Task Done": item["Task Done"],
        });
        paired.sheetLeft = [];
      }

      for (const item of paired.sheetLeft) {
        await addDoc(collection(db, "tasks"), {
          Date: item.Date,
          "Employee ID": item["Employee ID"],
          "Employee Name": item["Employee Name"],
          "Task Done": item["Task Done"],
          createdAt: Date.now() + added,
        });
        added += 1;
      }

      const sheetNamesByLoose = new Map();
      const sheetCountByLoose = new Map();
      sheetItems.forEach((item) => {
        const key = looseKey(item);
        sheetCountByLoose.set(key, (sheetCountByLoose.get(key) || 0) + 1);
        if (!sheetNamesByLoose.has(key)) sheetNamesByLoose.set(key, new Set());
        sheetNamesByLoose.get(key).add(String(item["Employee Name"] ?? "").trim());
      });
      const staleIds = [];
      const appByLoose = new Map();
      keepers.forEach((item) => {
        const key = looseKey(item);
        if (!appByLoose.has(key)) appByLoose.set(key, []);
        appByLoose.get(key).push(item);
      });
      appByLoose.forEach((group, key) => {
        const surplus = group.length - (sheetCountByLoose.get(key) || 0);
        if (surplus <= 0) return;
        const names = sheetNamesByLoose.get(key) || new Set();
        group
          .filter((item) => !matched.has(item.id) && !names.has(String(item["Employee Name"] ?? "").trim()))
          .slice(0, surplus)
          .forEach((item) => staleIds.push(item.id));
      });

      const removeIds = [...new Set([...duplicateIds, ...staleIds])];
      for (const id of removeIds) {
        await deleteDoc(doc(db, "tasks", id));
      }

      if (updated > 0 || added > 0 || removeIds.length > 0) {
        const parts = [];
        if (updated > 0) parts.push(`Updated ${updated} task(s)`);
        if (added > 0) parts.push(`added ${added} new task(s)`);
        if (removeIds.length > 0) parts.push(`removed ${removeIds.length} duplicate task(s)`);
        showSnack(`${parts.join(", ")} from Google Sheets.`, "success");
      } else if (!silent) {
        showSnack("No changes in Google Sheets.", "info");
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
    const payload = tasks.map((item) => ({
      "Record ID": item.id,
      Date: item.Date || formatDate(item.createdAt),
      "Employee ID": item["Employee ID"] || "",
      "Employee Name": item["Employee Name"] || "",
      "Task Done": item["Task Done"] || "",
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
            <label htmlFor="taskDate">Date</label>
            <input
              id="taskDate"
              type="date"
              value={taskDate}
              onChange={(e) => setTaskDate(e.target.value)}
              required
            />

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
                  <th>Date</th>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Task Done</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty">No tasks added yet</td>
                  </tr>
                ) : (
                  tasks.map((item) => (
                    <tr key={item.id}>
                     <td>{formatDate(item["Date"])}</td>
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
