import { useState, useEffect, useRef } from "react";
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import Snackbar, { useSnackbar } from "./component/Snackbar";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfvYsnmjMhWF7f-WRFU83vkNjrSz-lXrw5pTqlOvA42FaiHiu8bUUUuWlBqdQwtio_KA/exec";

const AVATAR_PALETTES = [
  { bg: "#e0f2fe", color: "#0284c7" }, // Blue
  { bg: "#dcfce7", color: "#16a34a" }, // Green
  { bg: "#f3e8ff", color: "#9333ea" }, // Purple
  { bg: "#ccfbf1", color: "#0d9488" }, // Teal/Cyan
  { bg: "#ffedd5", color: "#ea580c" }, // Orange
  { bg: "#ffe4e6", color: "#e11d48" }, // Pink
];

const PAGE_SIZE = 5;

function getPageList(current, total) {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - 1 && i <= current + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }
  return pages;
}

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
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
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

  const filteredTasks = tasks.filter((item) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    const id = String(item["Employee ID"] ?? "").toLowerCase();
    const name = String(item["Employee Name"] ?? "").toLowerCase();
    return id.includes(term) || name.includes(term);
  });

  const totalRecords = filteredTasks.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  if (currentPage > totalPages) {
    setCurrentPage(totalPages);
  }
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalRecords);
  const currentTasks = filteredTasks.slice(startIndex, endIndex);

  return (
    <div className="app">
      {/* 1. Header */}
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-logo" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3.5" width="16" height="17" rx="3" strokeWidth="1.8" />
                <path d="M9 3v2M15 3v2M9 4.5h6" strokeWidth="1.8" strokeLinecap="round" />
                <path d="m8.5 10 1.5 1.5 3-3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M14.5 10h1.5M14.5 15h1.5" strokeWidth="1.8" strokeLinecap="round" />
                <path d="m8.5 15 1.5 1.5 3-3" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="brand-text">
              <h1 className="brand-title">
                Employee <span className="brand-title-accent">Task Tracker</span>
              </h1>
              <p className="brand-subtitle">Track • Manage • Grow Together</p>
            </div>
          </div>

          <div className="header-right">
            <div className="user-profile">
              <div className="user-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <span className="user-name">Hello, Team</span>
              <svg className="chevron-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            <button type="button" className="logout-btn" onClick={() => signOut(auth)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="container">
        {/* 2. Left Panel — Add Employee Task */}
        <section className="form-card">
          <div className="card-corner-shape" aria-hidden="true" />
          <div className="card-header">
            <div className="card-header-icon add-icon-badge" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <div className="card-header-text">
              <h2>{editingId ? "Edit Employee Task" : "Add Employee Task"}</h2>
              <p className="subtitle">
                {editingId ? "Update the selected task, then save." : "Enter employee details and completed work."}
              </p>
            </div>
          </div>

          <form onSubmit={addTask} className="task-form">
            {/* Field 1: Date */}
            <div className="form-group">
              <label htmlFor="taskDate" className="form-label">
                <svg className="field-icon date-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Date</span>
              </label>
              <input
                id="taskDate"
                type="date"
                value={taskDate}
                onChange={(e) => setTaskDate(e.target.value)}
                className="form-input"
                required
              />
            </div>

            {/* Field 2: Employee ID */}
            <div className="form-group">
              <label htmlFor="empId" className="form-label">
                <svg className="field-icon emp-id-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>Employee ID</span>
              </label>
              <input
                id="empId"
                type="text"
                value={empId}
                onChange={(e) => setEmpId(e.target.value)}
                placeholder="Enter employee ID"
                className="form-input"
                required
              />
            </div>

            {/* Field 3: Employee Name */}
            <div className="form-group">
              <label htmlFor="empName" className="form-label">
                <svg className="field-icon emp-name-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>Employee Name</span>
              </label>
              <input
                id="empName"
                type="text"
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                placeholder="Enter employee name"
                className="form-input"
                required
              />
            </div>

            {/* Field 4: Task Done */}
            <div className="form-group">
              <label htmlFor="task" className="form-label">
                <svg className="field-icon task-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span>Task Done</span>
              </label>
              <textarea
                id="task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe the completed task"
                rows={4}
                className="form-textarea"
                required
              />
            </div>

            <div className="form-actions">
              <button className="submit-btn" type="submit">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
                <span>{editingId ? "Update Task" : "Add Task"}</span>
              </button>
              {editingId && (
                <button className="cancel-edit-btn" type="button" onClick={clearForm}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        {/* 3. Right Panel — Employee Task List */}
        <section className="table-card">
          <div className="table-header">
            <div className="table-header-left">
           
            </div>

            <div className="sheet-actions">
              <button
                type="button"
                className="btn-sheets btn-sheets-load"
                onClick={() => loadFromSheets()}
                disabled={loadingSheets}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                <span>{loadingSheets ? "Loading..." : "Load from Google Sheets"}</span>
              </button>
              <button
                type="button"
                className="btn-sheets btn-sheets-sync"
                onClick={syncToSheets}
                disabled={loadingSheets}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                  <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                  <path d="M16 21h5v-5" />
                </svg>
                <span>Sync to Google Sheets</span>
              </button>
            </div>
             <div className="search-input-wrapper">
              <svg className="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by Employee ID or Name..."
                className="search-input"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => {
                    setSearchTerm("");
                    setCurrentPage(1);
                  }}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Search bar above the Employee Task List table */}
          {/* <div className="table-search-row">
            <div className="search-input-wrapper">
              <svg className="search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by Employee ID or Name..."
                className="search-input"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => {
                    setSearchTerm("");
                    setCurrentPage(1);
                  }}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div> */}

          <div className="table-wrapper">
            <table className="task-table">
              <thead>
                <tr>
                  <th className="th-sno">S.NO</th>
                  <th>Employee ID</th>
                  <th>Employee Name</th>
                  <th>Task Done</th>
                  <th>Date</th>
                  <th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentTasks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      {searchTerm.trim() ? "No matching tasks found" : "No tasks added yet"}
                    </td>
                  </tr>
                ) : (
                  currentTasks.map((item, index) => {
                    const avatarPalette = AVATAR_PALETTES[(startIndex + index) % AVATAR_PALETTES.length];
                    const initialChar = (item["Employee ID"] || "E").trim().charAt(0).toUpperCase();

                    return (
                      <tr key={item.id} className="task-row">
                        <td className="sno-cell">{startIndex + index + 1}</td>
                        <td>
                          <div className="emp-id-cell">
                            <span
                              className="emp-avatar"
                              style={{
                                backgroundColor: avatarPalette.bg,
                                color: avatarPalette.color,
                              }}
                            >
                              {initialChar}
                            </span>
                            <span className="emp-id-text">{item["Employee ID"]}</span>
                          </div>
                        </td>
                        <td className="emp-name-cell">{item["Employee Name"]}</td>
                        <td className="task-done-cell">{item["Task Done"]}</td>
                        <td>
                          <div className="date-cell">
                            <svg className="table-calendar-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            <span>{formatDate(item["Date"])}</span>
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn edit-btn"
                              onClick={() => startEdit(item)}
                              title="Edit Task"
                              aria-label="Edit Task"
                            >
                              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                              </svg>
                            </button>
                            {confirmId === item.id ? (
                              <>
                                <button
                                  type="button"
                                  className="action-btn confirm-delete-btn"
                                  onClick={() => removeTask(item.id)}
                                >
                                  Confirm
                                </button>
                                <button
                                  type="button"
                                  className="action-btn cancel-btn"
                                  onClick={() => setConfirmId(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="action-btn delete-btn"
                                onClick={() => setConfirmId(item.id)}
                                title="Delete Task"
                                aria-label="Delete Task"
                              >
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <line x1="10" y1="11" x2="10" y2="17" />
                                  <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination controls at bottom-right */}
          <div className="table-pagination">
            <span className="pagination-info">
              Showing {totalRecords === 0 ? "0" : `${startIndex + 1}–${endIndex}`} of {totalRecords}
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="pagination-btn pagination-nav-btn"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={safePage <= 1 || totalRecords === 0}
              >
                Previous
              </button>
              {getPageList(safePage, totalPages).map((p, i) =>
                p === "..." ? (
                  <span key={`ellipsis-${i}`} className="pagination-ellipsis">
                    ...
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`pagination-btn pagination-page-btn ${safePage === p ? "active" : ""}`}
                    onClick={() => setCurrentPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                className="pagination-btn pagination-nav-btn"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={safePage >= totalPages || totalRecords === 0}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* 5. Footer */}
      <footer className="footer">
        <p className="footer-tagline">
         
        </p>
      </footer>

      <Snackbar snack={snack} onClose={closeSnack} />
    </div>
  );
}

export default App;
