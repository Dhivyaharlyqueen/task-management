import { useState, useEffect, useRef, useMemo } from "react";
import ProjectsPage from "./component/ProjectsPage";
import DailyActivitiesPage from "./component/DailyActivitiesPage";
import ReportsPage from "./component/ReportsPage";
import MyReportsPage from "./component/MyReportsPage";
import SupportPage from "./component/SupportPage";
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc, where, getDocs, writeBatch } from "firebase/firestore";
import { createPortal } from "react-dom";
import { signOut } from "firebase/auth";
import { db, auth } from "./firebase";
import Snackbar, { useSnackbar } from "./component/Snackbar";
import { saveTaskRemarks, getTaskRemarks } from "./services/remarksService";
import { loadCachedNotifs, saveCachedNotifs, clearCachedNotifs, openNotifChannel } from "./services/localNotifService";
import "./App.css";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwfvYsnmjMhWF7f-WRFU83vkNjrSz-lXrw5pTqlOvA42FaiHiu8bUUUuWlBqdQwtio_KA/exec";
const ADMIN_EMAIL = "admin@hepl.com";

function isAdminEmail(email) {
  return String(email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

function notifTime(ts) {
  if (ts == null || ts === "") return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts === "object" && typeof ts.seconds === "number") return ts.seconds * 1000;
  const parsed = new Date(ts).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function timeAgoNotif(ts) {
  const at = notifTime(ts);
  if (!at) return "";
  const diff = Date.now() - at;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

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

function parseDateAny(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value.seconds) {
    const d = new Date(value.seconds * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const ymd = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function getWorkingDaysCount(startVal, endVal) {
  const start = parseDateAny(startVal);
  if (!start) return 1;
  const end = endVal ? (parseDateAny(endVal) || new Date()) : new Date();

  const [d1, d2] = start <= end ? [new Date(start), new Date(end)] : [new Date(end), new Date(start)];
  d1.setHours(0, 0, 0, 0);
  d2.setHours(0, 0, 0, 0);

  let workingDays = 0;
  const cur = new Date(d1);
  let guard = 0;
  while (cur <= d2 && guard < 1000) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) { // Monday to Friday (excluding weekends)
      workingDays++;
    }
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return Math.max(1, workingDays);
}

const DEFAULT_TASK_TYPES = [
  "Bug Fix",
  "Development",
  "Feature",
  "Testing",
  "UI/Design",
  "Documentation",
  "Meeting",
  "Support",
  "Other",
];

function getTaskType(item) {
  if (!item) return "Other";
  if (item["Task Type"]) return String(item["Task Type"]).trim();
  if (item.taskType) return String(item.taskType).trim();
  if (item.type) return String(item.type).trim();
  if (item["Type"]) return String(item["Type"]).trim();

  const text = String(item["Task Done"] || "").toLowerCase();
  if (text.includes("bug") || text.includes("fix") || text.includes("issue") || text.includes("error") || text.includes("crash")) {
    return "Bug Fix";
  }
  if (text.includes("ui") || text.includes("css") || text.includes("design") || text.includes("layout") || text.includes("style")) {
    return "UI/Design";
  }
  if (text.includes("feature") || text.includes("implement") || text.includes("integration") || text.includes("add") || text.includes("build") || text.includes("create")) {
    return "Feature";
  }
  if (text.includes("test") || text.includes("qa") || text.includes("verify") || text.includes("validat")) {
    return "Testing";
  }
  if (text.includes("doc") || text.includes("report") || text.includes("manual") || text.includes("readme")) {
    return "Documentation";
  }
  if (text.includes("meet") || text.includes("sync") || text.includes("call") || text.includes("discuss") || text.includes("standup")) {
    return "Meeting";
  }
  if (text.includes("support") || text.includes("help") || text.includes("client") || text.includes("customer")) {
    return "Support";
  }
  if (text.includes("api") || text.includes("develop") || text.includes("backend") || text.includes("code")) {
    return "Development";
  }
  return "Development";
}

function getTaskStatus(item) {
  if (!item) return "In Progress";
  const raw = String(item.status || item.Status || "").trim();
  if (!raw) return "In Progress";
  const lower = raw.toLowerCase();
  if (lower === "completed") return "Completed";
  if (lower === "pending") return "Pending";
  if (lower.includes("progress")) return "In Progress";
  return "In Progress";
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
    "Record ID": String(row["Record ID"] ?? row["Task ID"] ?? "").trim(),
    Date: formatDate(row.Date),
    Project: String(row.Project ?? "").trim(),
    "Employee ID": String(row["Employee ID"] ?? "").trim(),
    "Employee Name": String(row["Employee Name"] ?? "").trim(),
    "Task Done": String(row["Task Done"] ?? "").trim(),
    "User Email": String(row["User Email"] ?? "").trim(),
    Status: String(row.Status ?? row.status ?? "").trim(),
    Remarks: String(row.Remarks ?? row.remarks ?? "").trim(),
  };
  if (!item.Date && !item.Project && !item["Employee ID"] && !item["Employee Name"] && !item["Task Done"]) return null;
  return item;
}

function fieldsFromSheet(item) {
  const fields = {
    Date: item.Date,
    Project: item.Project,
    "Employee ID": item["Employee ID"],
    "Employee Name": item["Employee Name"],
    "Task Done": item["Task Done"],
  };
  if (item["User Email"]) fields.userEmail = item["User Email"];
  if (item.Status) fields.status = item.Status;
  if (item.Remarks) fields.remarks = item.Remarks;
  return fields;
}

function fetchSheetRows(sheet) {
  return new Promise((resolve, reject) => {
    const callbackName = `onSheetRows_${Date.now()}_${sheet || "tasks"}`;
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
    const sheetQuery = sheet ? `&sheet=${encodeURIComponent(sheet)}` : "";
    script.src = `${APPS_SCRIPT_URL}?callback=${callbackName}${sheetQuery}`;
    document.body.appendChild(script);
  });
}

async function postToSheet(body) {
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
}

function renderPieChartSvg(slices, size = 170) {
  const total = slices.reduce((sum, s) => sum + (s.value || 0), 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.44;

  if (total === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="dash-pie-svg">
        <circle cx={cx} cy={cy} r={r} fill="#f1f5f9" stroke="#e2e8f0" strokeWidth="2" />
        <text x={cx} y={cy} fill="#94a3b8" fontSize="12" fontWeight="600" textAnchor="middle" dominantBaseline="central">
          No Data
        </text>
      </svg>
    );
  }

  const validSlices = slices.filter((s) => s.value > 0);

  if (validSlices.length === 1) {
    const s = validSlices[0];
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="dash-pie-svg">
        <circle cx={cx} cy={cy} r={r} fill={s.color} />
        <text x={cx} y={cy} fill="#ffffff" fontSize="12.5" fontWeight="700" textAnchor="middle" dominantBaseline="central">
          100%
        </text>
      </svg>
    );
  }

  let currentAngle = -Math.PI / 2;
  const paths = [];

  validSlices.forEach((slice, idx) => {
    const sliceAngle = (slice.value / total) * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;
    currentAngle = endAngle;

    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);

    const largeArc = sliceAngle > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    const midAngle = (startAngle + endAngle) / 2;
    const labelRadius = r * 0.62;
    const lx = cx + labelRadius * Math.cos(midAngle);
    const ly = cy + labelRadius * Math.sin(midAngle);
    const percentVal = Math.round((slice.value / total) * 1000) / 10;

    paths.push(
      <g key={idx}>
        <path d={d} fill={slice.color} stroke="#ffffff" strokeWidth="2" />
        {percentVal >= 6 && (
          <text
            x={lx}
            y={ly}
            fill="#ffffff"
            fontSize="11"
            fontWeight="700"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {percentVal}%
          </text>
        )}
      </g>
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="dash-pie-svg">
      {paths}
    </svg>
  );
}

function App() {
  const currentUser = auth.currentUser;
  const isAdmin = isAdminEmail(currentUser?.email);
  const [empId, setEmpId] = useState("");
  const [empName, setEmpName] = useState("");
  const [task, setTask] = useState("");
  const [adminTaskType, setAdminTaskType] = useState("");
  const [project, setProject] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDetails, setProjectDetails] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectSearch, setProjectSearch] = useState("");
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const projectDropdownRef = useRef(null);
  const [adminSelectedProject, setAdminSelectedProject] = useState("");
  const [adminProjectSearch, setAdminProjectSearch] = useState("");
  const [isAdminProjectDropdownOpen, setIsAdminProjectDropdownOpen] = useState(false);
  const adminProjectDropdownRef = useRef(null);
  const [employees, setEmployees] = useState([]);
  const [userEmpId, setUserEmpId] = useState("");
  const [userEmpName, setUserEmpName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userTaskType, setUserTaskType] = useState("");
  const [taskDate, setTaskDate] = useState(todayInputDate);
  const [tasks, setTasks] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [activeNav, setActiveNav] = useState("dashboard");
  const [distribProjectFilter, setDistribProjectFilter] = useState("all");
  const [statusOverviewProjectFilter, setStatusOverviewProjectFilter] = useState("all");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [viewingTask, setViewingTask] = useState(null);
  const [remarksText, setRemarksText] = useState("");
  const [remarksPreset, setRemarksPreset] = useState("");
  const [savingRemarks, setSavingRemarks] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [notifications, setNotifications] = useState(() =>
    loadCachedNotifs(currentUser?.email)
  );
  const [supportNotifs, setSupportNotifs] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifBox, setNotifBox] = useState({ top: 76, right: 16 });
  const notifRef = useRef(null);
  const notifBtnRef = useRef(null);
  const notifDropdownRef = useRef(null);
  const notifChannelRef = useRef(null);

  // Real-time notifications listener scoped to current user
  useEffect(() => {
    if (!currentUser?.email) return;
    const email = currentUser.email.toLowerCase();

    // Open BroadcastChannel so other tabs of this browser stay in sync.
    const { broadcast, close } = openNotifChannel(email, (notifs) => {
      setNotifications(notifs);
      saveCachedNotifs(email, notifs);
    });
    notifChannelRef.current = { broadcast, close };

    const q = query(
      collection(db, 'notifications'),
      where('recipientEmail', '==', email)
    );
    const unsub = onSnapshot(q, snap => {
      const notifs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => notifTime(b.createdAt) - notifTime(a.createdAt));
      setNotifications(notifs);
      // Persist to localStorage so the next page load shows cached data
      // immediately while Firestore loads.
      saveCachedNotifs(email, notifs);
      // Broadcast to other open tabs of the same browser.
      broadcast(notifs);
    }, (err) => {
      console.error("Notification listener failed", err);
    });

    return () => {
      unsub();
      close();
    };
  }, [currentUser?.email]);

  // Every signed-in user sees a new support request. Read state stays on this browser
  // so one person marking it read does not clear it for everyone else.
  useEffect(() => {
    if (!currentUser?.email) return;
    const email = currentUser.email.toLowerCase();
    const readKey = `support_read_${email}`;
    const loadRead = () => {
      try {
        return new Set(JSON.parse(localStorage.getItem(readKey) || "[]"));
      } catch {
        return new Set();
      }
    };
    return onSnapshot(collection(db, "support_requests"), (snap) => {
      const read = loadRead();
      setSupportNotifs(
        snap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .map((item) => {
            const mine = String(item.requesterEmail || "").toLowerCase() === email;
            return {
              id: `support:${item.id}`,
              requestId: item.id,
              type: "support_request",
              requestTitle: item.title || "",
              projectName: item.projectName || "",
              requesterName: mine ? "You" : (item.requesterName || "A user"),
              requesterEmail: item.requesterEmail || "",
              createdAt: item.createdAt || 0,
              read: read.has(item.id),
            };
          })
          .sort((a, b) => notifTime(b.createdAt) - notifTime(a.createdAt))
      );
    }, (err) => {
      console.error("Support notification listener failed", err);
    });
  }, [currentUser?.email]);

  const supportIds = new Set(supportNotifs.map((item) => item.requestId).filter(Boolean));
  const bellNotifs = [
    ...notifications.filter((item) => !(item.type === "support_request" && item.requestId && supportIds.has(item.requestId))),
    ...supportNotifs,
  ].sort((a, b) => notifTime(b.createdAt) - notifTime(a.createdAt));

  function markSupportRead(ids) {
    const email = String(currentUser?.email || "").toLowerCase();
    const readKey = `support_read_${email}`;
    const read = new Set();
    try {
      JSON.parse(localStorage.getItem(readKey) || "[]").forEach((id) => read.add(id));
    } catch {
      // ignore bad cache
    }
    ids.forEach((id) => read.add(id));
    localStorage.setItem(readKey, JSON.stringify([...read]));
    setSupportNotifs((prev) => prev.map((item) => (ids.includes(item.requestId) ? { ...item, read: true } : item)));
  }

  // Close notif dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    function handleOutside(e) {
      if (notifRef.current && notifRef.current.contains(e.target)) return;
      if (notifDropdownRef.current && notifDropdownRef.current.contains(e.target)) return;
      setNotifOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [notifOpen]);

  async function markAllNotifsRead() {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length) {
      const batch = writeBatch(db);
      unread.forEach(n => batch.update(doc(db, 'notifications', n.id), { read: true }));
      await batch.commit();
      const updated = notifications.map(n => ({ ...n, read: true }));
      saveCachedNotifs(currentUser?.email, updated);
      notifChannelRef.current?.broadcast(updated);
    }
    markSupportRead(supportNotifs.filter((item) => !item.read).map((item) => item.requestId));
  }

  async function clearAllNotifs() {
    // Only allowed when every notification is already read
    if (bellNotifs.some(n => !n.read)) return;
    const email = String(currentUser?.email || '').toLowerCase();
    // Delete all Firestore notification docs belonging to this user
    if (notifications.length) {
      const batch = writeBatch(db);
      notifications.forEach(n => batch.delete(doc(db, 'notifications', n.id)));
      await batch.commit();
    }
    // Clear support notif read-state from localStorage
    localStorage.removeItem(`support_read_${email}`);
    // Clear local cache and state
    clearCachedNotifs(email);
    setNotifications([]);
    setSupportNotifs([]);
    notifChannelRef.current?.broadcast([]);
    setNotifOpen(false);
  }

  async function markNotifRead(id) {
    if (String(id).startsWith("support:")) {
      markSupportRead([id.slice("support:".length)]);
      return;
    }
    await updateDoc(doc(db, 'notifications', id), { read: true });
    const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    saveCachedNotifs(currentUser?.email, updated);
    notifChannelRef.current?.broadcast(updated);
  }

  useEffect(() => {
    document.body.style.overflow = isTaskModalOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isTaskModalOpen]);
  const [filterProject, setFilterProject] = useState("");
  const [filterTaskType, setFilterTaskType] = useState("");
  const [filterStatuses, setFilterStatuses] = useState([]);
  const [filterFromDate, setFilterFromDate] = useState("");
  const [filterToDate, setFilterToDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    project: "",
    taskType: "",
    statuses: [],
    status: "",
    fromDate: "",
    toDate: "",
  });

  function toggleFilterStatus(st) {
    setFilterStatuses((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]
    );
  }

  function openFilterModal() {
    setFilterProject(appliedFilters.project || "");
    setFilterTaskType(appliedFilters.taskType || "");
    setFilterStatuses(
      appliedFilters.statuses && appliedFilters.statuses.length > 0
        ? [...appliedFilters.statuses]
        : appliedFilters.status
        ? [appliedFilters.status]
        : []
    );
    setFilterFromDate(appliedFilters.fromDate || "");
    setFilterToDate(appliedFilters.toDate || "");
    setIsFilterModalOpen(true);
  }

  function handleApplyFilters() {
    if (filterFromDate && filterToDate && filterFromDate > filterToDate) {
      showSnack("From Date cannot be later than To Date", "error");
      return;
    }
    setAppliedFilters({
      project: filterProject,
      taskType: filterTaskType,
      statuses: [...filterStatuses],
      status: filterStatuses.length === 1 ? filterStatuses[0] : "",
      fromDate: filterFromDate,
      toDate: filterToDate,
    });
    setCurrentPage(1);
    setIsFilterModalOpen(false);
    showSnack("Filters applied successfully", "success");
  }

  function handleResetFilters() {
    setFilterProject("");
    setFilterTaskType("");
    setFilterStatuses([]);
    setFilterFromDate("");
    setFilterToDate("");
    setAppliedFilters({
      project: "",
      taskType: "",
      statuses: [],
      status: "",
      fromDate: "",
      toDate: "",
    });
    setCurrentPage(1);
    showSnack("Filters reset", "info");
  }

  function removeSingleFilter(key) {
    if (key === "project") {
      setFilterProject("");
      setAppliedFilters((prev) => ({ ...prev, project: "" }));
    } else if (key === "taskType") {
      setFilterTaskType("");
      setAppliedFilters((prev) => ({ ...prev, taskType: "" }));
    } else if (key === "status") {
      setFilterStatuses([]);
      setAppliedFilters((prev) => ({ ...prev, status: "", statuses: [] }));
    } else if (key === "date") {
      setFilterFromDate("");
      setFilterToDate("");
      setAppliedFilters((prev) => ({ ...prev, fromDate: "", toDate: "" }));
    }
    setCurrentPage(1);
  }

  function removeSingleStatusFilter(st) {
    setFilterStatuses((prev) => prev.filter((s) => s !== st));
    setAppliedFilters((prev) => {
      const nextStatuses = (prev.statuses || []).filter((s) => s !== st);
      return {
        ...prev,
        statuses: nextStatuses,
        status: nextStatuses.length === 1 ? nextStatuses[0] : "",
      };
    });
    setCurrentPage(1);
  }

  const hasActiveFilters = Boolean(
    appliedFilters.project ||
    appliedFilters.taskType ||
    (appliedFilters.statuses && appliedFilters.statuses.length > 0) ||
    appliedFilters.status ||
    appliedFilters.fromDate ||
    appliedFilters.toDate
  );

  const activeFilterCount = [
    appliedFilters.project,
    appliedFilters.taskType,
    appliedFilters.statuses && appliedFilters.statuses.length > 0
      ? appliedFilters.statuses.join(", ")
      : appliedFilters.status,
    appliedFilters.fromDate || appliedFilters.toDate,
  ].filter(Boolean).length;
  const { snack, showSnack, closeSnack } = useSnackbar();
  const tasksRef = useRef([]);
  const employeesRef = useRef([]);
  const projectsRef = useRef([]);
  const loadingRef = useRef(false);

  useEffect(() => {
    const q = query(collection(db, "project_details"), orderBy("createdAt"));
    return onSnapshot(q, snap => setProjectDetails(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    const q = query(collection(db, "project_activity"), orderBy("timestamp"));
    return onSnapshot(q, snap => setActivityLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    const q = query(collection(db, "tasks"), orderBy("createdAt"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      tasksRef.current = next;
      setTasks(next);
      if (isAdmin && !importedRef.current) {
        importedRef.current = true;
        loadFromSheets(next, true);
      }
    });
    return unsubscribe;
  }, [isAdmin]);

  useEffect(() => {
    const q = query(collection(db, "projects"), orderBy("createdAt"));
    return onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      projectsRef.current = next;
      setProjects(next);
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(event.target)) {
        setIsProjectDropdownOpen(false);
      }
      if (adminProjectDropdownRef.current && !adminProjectDropdownRef.current.contains(event.target)) {
        setIsAdminProjectDropdownOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setIsProjectDropdownOpen(false);
        setIsAdminProjectDropdownOpen(false);
      }
    }
    if (isProjectDropdownOpen || isAdminProjectDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isProjectDropdownOpen, isAdminProjectDropdownOpen]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setViewingTask(null);
        setIsFilterModalOpen(false);
        setIsTaskModalOpen(false);
      }
    }
    if (viewingTask || isFilterModalOpen || isTaskModalOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [viewingTask, isFilterModalOpen, isTaskModalOpen]);

  function openViewModal(item) {
    setViewingTask(item);
    const existing = item.remarks || item.Remarks || "";
    setRemarksText(existing);
    setRemarksPreset(existing);
  }

  useEffect(() => {
    if (!viewingTask?.id) return;

    let isMounted = true;
    getTaskRemarks(viewingTask.id, currentUser?.email, viewingTask.userEmail)
      .then((data) => {
        if (isMounted && data && typeof data.remarks === "string") {
          setRemarksText(data.remarks);
        }
      })
      .catch((err) => {
        console.warn("Could not fetch task remarks:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [viewingTask?.id, viewingTask?.userEmail, currentUser?.email]);

  useEffect(() => {
    const q = query(collection(db, "employees"), orderBy("createdAt"));
    return onSnapshot(q, (snapshot) => {
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      employeesRef.current = next;
      setEmployees(next);
    });
  }, []);

  function clearForm() {
    setEditingId(null);
    setEmpId("");
    setEmpName("");
    setTask("");
    setAdminTaskType("");
    setProject("");
    setTaskDate(todayInputDate());
    setIsProjectDropdownOpen(false);
    setProjectSearch("");
  }

  function handleOpenTaskModal() {
    clearForm();
    if (!isAdmin) {
      const matchedEmp = employees.find(
        (emp) => emp["Email ID"]?.toLowerCase() === currentUser?.email?.toLowerCase()
      );
      if (matchedEmp) {
        setEmpId(matchedEmp["Employee ID"] || "");
        setEmpName(matchedEmp["Employee Name"] || "");
      }
    }
    setIsTaskModalOpen(true);
  }

  function handleCloseTaskModal() {
    setIsTaskModalOpen(false);
    clearForm();
  }

  function startEdit(item) {
    setEditingId(item.id);
    setEmpId(item["Employee ID"] ?? "");
    setEmpName(item["Employee Name"] ?? "");
    setTask(item["Task Done"] ?? "");
    setProject(item.Project ?? "");
    setTaskDate(toInputDate(item.Date || item.createdAt) || todayInputDate());
    setConfirmId(null);
    if (isAdmin) setAdminTaskType(item["Task Type"] || "");
    setIsTaskModalOpen(true);
  }

  function cloneTask(item) {
    setEditingId(null);
    setEmpId(item["Employee ID"] ?? "");
    setEmpName(item["Employee Name"] ?? "");
    setTask(item["Task Done"] ?? "");
    setProject(item.Project ?? "");
    setTaskDate(toInputDate(item.Date || item.createdAt) || todayInputDate());
    setConfirmId(null);
    if (isAdmin) setAdminTaskType(item["Task Type"] || "");
    if (!isAdmin) setActiveNav("my-tasks");
    setIsTaskModalOpen(true);
    showSnack("Task cloned into form", "info");
  }

  async function addNewProject(rawName) {
    const name = String(rawName || "").trim();
    if (!name) {
      showSnack("Enter a project name", "error");
      return null;
    }
    const exists = projects.some(
      (item) => String(item?.name || item).trim().toLowerCase() === name.toLowerCase()
    );
    if (exists) {
      showSnack("That project already exists", "info");
      const match = projects.find(
        (item) => String(item?.name || item).trim().toLowerCase() === name.toLowerCase()
      );
      const existingName = typeof match === "string" ? match : match?.name || name;
      setProject(existingName);
      if (isAdmin) setAdminSelectedProject(existingName);
      setIsProjectDropdownOpen(false);
      setIsAdminProjectDropdownOpen(false);
      setProjectSearch("");
      setAdminProjectSearch("");
      return existingName;
    }
    try {
      await addDoc(collection(db, "projects"), {
        name,
        createdAt: Date.now(),
        createdBy: currentUser?.email || (isAdmin ? ADMIN_EMAIL : "User"),
      });
      // State will update via the onSnapshot listener — no manual setProjects needed
      setProject(name);
      if (isAdmin) setAdminSelectedProject(name);
      setIsProjectDropdownOpen(false);
      setIsAdminProjectDropdownOpen(false);
      setProjectSearch("");
      setAdminProjectSearch("");
      await syncProjects([...projectsRef.current, { name }]);
      showSnack("Project added successfully", "success");
      return name;
    } catch (err) {
      console.error("Error adding project:", err);
      showSnack("Failed to add project. Check your connection.", "error");
      return null;
    }
  }

  async function addProject(e) {
    e.preventDefault();
    const created = await addNewProject(projectName);
    if (created) {
      setProjectName("");
    }
  }

  async function handleDeleteProject(e, projectName) {
    e.stopPropagation();
    if (!isAdmin) return;
    // Only remove from the master projects list.
    // Tasks, project_details, and related data are NOT deleted here —
    // they remain intact so the project can be reused and existing
    // task assignments are preserved.
    try {
      const projSnap = await getDocs(query(collection(db, "projects"), where("name", "==", projectName.trim())));
      for (const d of projSnap.docs) await deleteDoc(d.ref);
    } catch (err) {
      console.error("Error removing project from list:", err);
    }
    if (adminSelectedProject.trim().toLowerCase() === projectName.trim().toLowerCase()) setAdminSelectedProject("");
    if (project.trim().toLowerCase() === projectName.trim().toLowerCase()) setProject("");
    showSnack("Project removed from list", "success");
  }

  const REMARKS_PRESETS = [
    "Work completed successfully.",
    "Please provide more details.",
    "Please correct the submitted work.",
    "Task requires further updates.",
    "Approved successfully.",
    "Please update the report.",
  ];

  async function handleSaveRemarks() {
    if (!isAdmin) {
      showSnack("Only Admin can save remarks", "error");
      return;
    }
    if (!viewingTask) return;
    if (!remarksText.trim()) {
      showSnack("Please select or enter a remark", "error");
      return;
    }

    setSavingRemarks(true);
    try {
      await saveTaskRemarks({
        taskId: viewingTask.id,
        employeeId: viewingTask["Employee ID"] || "",
        employeeName: viewingTask["Employee Name"] || "",
        userEmail: viewingTask.userEmail || "",
        remarks: remarksText,
        adminEmail: currentUser?.email || ADMIN_EMAIL,
      });

      // Notify the task owner
      let ownerEmail = String(viewingTask.userEmail || "").trim().toLowerCase();
      if (!ownerEmail) {
        const emp = employees.find(
          (item) => String(item["Employee ID"] || "").trim() === String(viewingTask["Employee ID"] || "").trim()
        );
        ownerEmail = String(emp?.["Email ID"] || "").trim().toLowerCase();
      }
      if (ownerEmail && ownerEmail !== ADMIN_EMAIL) {
        await addDoc(collection(db, 'notifications'), {
          type: 'task_remark',
          taskId: viewingTask.id,
          taskName: viewingTask["Task Done"] || "",
          remark: remarksText,
          adminEmail: currentUser?.email || ADMIN_EMAIL,
          recipientEmail: ownerEmail,
          read: false,
          createdAt: Date.now(),
        });
      }

      setViewingTask((prev) => (prev ? { ...prev, remarks: remarksText } : null));
      setTasks((prev) =>
        prev.map((t) => (t.id === viewingTask.id ? { ...t, remarks: remarksText } : t))
      );

      showSnack("Remarks saved successfully", "success");
    } catch (err) {
      console.error("Error saving remarks:", err);
      showSnack(err.message || "Failed to save remarks", "error");
    } finally {
      setSavingRemarks(false);
    }
  }

  async function addEmployee(e) {
    e.preventDefault();
    const employeeId = userEmpId.trim();
    const employeeName = userEmpName.trim();
    const email = userEmail.trim();
    if (!employeeId || !employeeName || !email) {
      showSnack("Enter employee ID, name, and email", "error");
      return;
    }
    const exists = employees.some((item) => String(item["Email ID"] || "").trim().toLowerCase() === email.toLowerCase());
    if (exists) {
      showSnack("That email is already added", "info");
      return;
    }
    const data = {
      "Employee ID": employeeId,
      "Employee Name": employeeName,
      "Email ID": email,
      ...(userTaskType.trim() ? { "Task Type": userTaskType.trim() } : {}),
    };
    await addDoc(collection(db, "employees"), {
      ...data,
      createdAt: Date.now(),
    });
    setUserEmpId("");
    setUserEmpName("");
    setUserEmail("");
    setUserTaskType("");
    await syncUsers([...employeesRef.current, data]);
    showSnack("User added", "success");
  }

  async function removeEmployee(id) {
    await deleteDoc(doc(db, "employees", id));
    await syncUsers(employeesRef.current.filter((item) => item.id !== id));
    showSnack("User removed", "success");
  }

  function syncUsers(list) {
    return postToSheet({
      action: "saveUsers",
      rows: list.map((item) => ({
        "Employee ID": item["Employee ID"] || "",
        "Employee Name": item["Employee Name"] || "",
        "Email ID": item["Email ID"] || "",
      })),
    });
  }

  function syncProjects(list) {
    return postToSheet({
      action: "saveProjects",
      rows: list.map((item) => ({ "Project Name": item.name || "" })),
    });
  }

  async function addTask(e) {
    e.preventDefault();
    if (!taskDate || !project || !empId.trim() || !empName.trim() || !task.trim()) {
      showSnack(projects.length === 0 ? "Please select or add a project" : "Please fill all fields", "error");
      return;
    }
    if (!isAdmin) {
      const projDet = projectDetails.find(d => String(d.name||'').trim().toLowerCase() === project.trim().toLowerCase());
      const projStatus = projDet?.projectStatus || 'Open';
      if (projStatus === 'Closed' || projStatus === 'Pre-Closed') {
        showSnack(`This project is ${projStatus}. No new tasks can be submitted.`, 'error');
        return;
      }
      if (projStatus === 'On Hold (Client)') {
        showSnack('This project is On Hold (Client). No new tasks can be submitted.', 'error');
        return;
      }
    }
    const data = {
      Date: fromInputDate(taskDate),
      Project: project,
      "Employee ID": empId.trim(),
      "Employee Name": empName.trim(),
      "Task Done": task.trim(),
      ...(taskType.trim() ? { "Task Type": taskType.trim() } : {}),
    };
    if (editingId) {
      await updateDoc(doc(db, "tasks", editingId), data);
      showSnack("Task updated", "success");
    } else {
      await addDoc(collection(db, "tasks"), {
        ...data,
        userEmail: currentUser?.email || "",
        status: "In Progress",
        createdAt: Date.now(),
      });
      showSnack("Task added", "success");
    }
    clearForm();
    setIsTaskModalOpen(false);
  }

  async function handleSubmitForReview(taskId) {
    const task = tasks.find(t => t.id === taskId);
    await updateDoc(doc(db, "tasks", taskId), { status: "Pending", submittedAt: Date.now() });
    // Notify admin
    await addDoc(collection(db, 'notifications'), {
      type: 'task_approval',
      taskId,
      taskName: task?.["Task Done"] || '',
      projectName: task?.Project || '',
      employeeName: task?.["Employee Name"] || '',
      employeeEmail: task?.userEmail || '',
      summary: 'submitted a task for review',
      actorName: task?.["Employee Name"] || currentUser?.email || '',
      recipientEmail: ADMIN_EMAIL,
      read: false,
      createdAt: Date.now(),
    });
    showSnack("Task submitted for review", "success");
  }

  async function handleApproveTask(taskId) {
    await updateDoc(doc(db, "tasks", taskId), { status: "Completed", approvedAt: Date.now() });
    setViewingTask((prev) => prev ? { ...prev, status: "Completed" } : null);
    // Notify the task owner
    const t = tasks.find(t => t.id === taskId);
    let ownerEmail = String(t?.userEmail || '').trim().toLowerCase();
    if (!ownerEmail && t) {
      const emp = employees.find(e => String(e["Employee ID"]||'').trim() === String(t["Employee ID"]||'').trim());
      ownerEmail = String(emp?.["Email ID"]||'').trim().toLowerCase();
    }
    if (ownerEmail && ownerEmail !== ADMIN_EMAIL) {
      await addDoc(collection(db, 'notifications'), {
        type: 'task_approval_result', taskId, taskName: t?.["Task Done"]||'',
        projectName: t?.Project||'', result: 'approved', actorName: 'Admin',
        summary: 'approved your task', recipientEmail: ownerEmail, read: false, createdAt: Date.now(),
      });
    }
    // Check if all tasks for this project are now completed → set Pre-Closed
    if (t?.Project) {
      const projName = t.Project.trim();
      const projTasks = tasks.filter(pt => String(pt.Project||'').trim().toLowerCase() === projName.toLowerCase());
      const allDone = projTasks.length > 0 && projTasks.every(pt => pt.id === taskId ? true : String(pt.status||'').toLowerCase() === 'completed');
      if (allDone) {
        const projDet = projectDetails.find(d => String(d.name||'').trim().toLowerCase() === projName.toLowerCase());
        if (projDet && projDet.projectStatus !== 'Closed' && projDet.projectStatus !== 'Pre-Closed') {
          await updateDoc(doc(db, 'project_details', projDet.id), { projectStatus: 'Pre-Closed', preClosedAt: Date.now() });
          await addDoc(collection(db, 'notifications'), {
            type: 'project_update', summary: 'All tasks completed — project is ready for final closure',
            actorName: 'System', projectName: projName, recipientEmail: ADMIN_EMAIL, read: false, createdAt: Date.now(),
          });
          showSnack(`All tasks in "${projName}" completed — project set to Pre-Closed`, 'success');
          return;
        }
      }
    }
    showSnack("Task approved and marked as Completed", "success");
  }

  async function handleRejectTask(taskId, reason) {
    await updateDoc(doc(db, "tasks", taskId), { status: "In Progress", rejectedAt: Date.now(), rejectReason: reason || '' });
    setViewingTask((prev) => prev ? { ...prev, status: "In Progress" } : null);
    const t = tasks.find(t => t.id === taskId);
    let ownerEmail = String(t?.userEmail || '').trim().toLowerCase();
    if (!ownerEmail && t) {
      const emp = employees.find(e => String(e["Employee ID"]||'').trim() === String(t["Employee ID"]||'').trim());
      ownerEmail = String(emp?.["Email ID"]||'').trim().toLowerCase();
    }
    if (ownerEmail && ownerEmail !== ADMIN_EMAIL) {
      await addDoc(collection(db, 'notifications'), {
        type: 'task_approval_result', taskId, taskName: t?.["Task Done"]||'',
        projectName: t?.Project||'', result: 'rejected', reason: reason||'',
        actorName: 'Admin', summary: 'rejected your task submission',
        recipientEmail: ownerEmail, read: false, createdAt: Date.now(),
      });
    }
    showSnack("Task rejected — employee notified", "success");
  }

  async function removeTask(id) {
    await deleteDoc(doc(db, "tasks", id));
    if (editingId === id) clearForm();
    setConfirmId(null);
    showSnack("Task deleted", "success");
  }

  async function importDirectories() {
    const [userRows, projectRows] = await Promise.all([
      fetchSheetRows("users"),
      fetchSheetRows("projects"),
    ]);
    let userAdded = 0;
    let projectAdded = 0;

    for (const row of userRows) {
      if (!Object.prototype.hasOwnProperty.call(row, "Email ID")) continue;
      const data = {
        "Employee ID": String(row["Employee ID"] ?? "").trim(),
        "Employee Name": String(row["Employee Name"] ?? "").trim(),
        "Email ID": String(row["Email ID"] ?? "").trim(),
      };
      if (!data["Employee ID"] && !data["Employee Name"] && !data["Email ID"]) continue;
      const match = employeesRef.current.find((item) =>
        (data["Email ID"] && String(item["Email ID"] || "").trim().toLowerCase() === data["Email ID"].toLowerCase())
        || (data["Employee ID"] && String(item["Employee ID"] || "").trim() === data["Employee ID"])
      );
      if (match) {
        const changed = ["Employee ID", "Employee Name", "Email ID"].some(
          (field) => String(match[field] || "").trim() !== data[field]
        );
        if (changed) await updateDoc(doc(db, "employees", match.id), data);
        continue;
      }
      await addDoc(collection(db, "employees"), { ...data, createdAt: Date.now() + userAdded });
      employeesRef.current = [...employeesRef.current, data];
      userAdded += 1;
    }

    for (const row of projectRows) {
      if (!Object.prototype.hasOwnProperty.call(row, "Project Name")) continue;
      const name = String(row["Project Name"] ?? "").trim();
      if (!name) continue;
      const exists = projectsRef.current.some((item) => String(item.name || "").trim().toLowerCase() === name.toLowerCase());
      if (exists) continue;
      await addDoc(collection(db, "projects"), {
        name,
        createdAt: Date.now() + projectAdded,
        createdBy: currentUser?.email || ADMIN_EMAIL,
      });
      projectsRef.current = [...projectsRef.current, { name }];
      projectAdded += 1;
    }

    return { userAdded, projectAdded };
  }

  async function loadFromSheets(currentTasks = tasksRef.current, silent = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingSheets(true);
    try {

      const directory = await importDirectories();
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
        if (!data.Project) data.Project = existing.Project || "";
        const changed = ["Date", "Project", "Employee ID", "Employee Name", "Task Done"].some(
          (field) => String(field === "Date" ? formatDate(existing.Date || existing.createdAt) : existing[field] ?? "").trim() !== data[field]
        ) || (data.userEmail && data.userEmail !== String(existing.userEmail || "").trim());
        if (changed) {
          await updateDoc(doc(db, "tasks", existing.id), data);
          updated += 1;
        }
      }

      const pendingSheet = [];
      for (const item of sheetItems) {
        const data = fieldsFromSheet(item);
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
        await applyToExisting(existing, fieldsFromSheet(item));
      }
      paired = takeUniquePairs(
        paired.sheetLeft,
        paired.appLeft,
        (item) => String(item["Employee ID"] ?? "").trim()
      );
      for (const [item, existing] of paired.pairs) {
        await applyToExisting(existing, fieldsFromSheet(item));
      }
      if (paired.sheetLeft.length === 1 && paired.appLeft.length === 1) {
        const item = paired.sheetLeft[0];
        await applyToExisting(paired.appLeft[0], fieldsFromSheet(item));
        paired.sheetLeft = [];
      }

      for (const item of paired.sheetLeft) {
        await addDoc(collection(db, "tasks"), {
          ...fieldsFromSheet(item),
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

      if (updated > 0 || added > 0 || removeIds.length > 0 || directory.userAdded > 0 || directory.projectAdded > 0) {
        const parts = [];
        if (updated > 0) parts.push(`Updated ${updated} task(s)`);
        if (added > 0) parts.push(`added ${added} new task(s)`);
        if (removeIds.length > 0) parts.push(`removed ${removeIds.length} duplicate task(s)`);
        if (directory.userAdded > 0) parts.push(`added ${directory.userAdded} user(s)`);
        if (directory.projectAdded > 0) parts.push(`added ${directory.projectAdded} project(s)`);
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
    if (tasks.length === 0 && employees.length === 0 && projects.length === 0) {
      showSnack("Add a task, user, or project first", "error");
      return;
    }
    const payload = tasks.map((item) => ({
      "Record ID": item.id,
      "Task ID": item.id,
      Date: item.Date || formatDate(item.createdAt),
      Project: item.Project || "",
      "Employee ID": item["Employee ID"] || "",
      "Employee Name": item["Employee Name"] || "",
      "Task Done": item["Task Done"] || "",
      "User Email": item.userEmail || "",
      Remarks: item.remarks || item.Remarks || "",
    }));
    try {
      await postToSheet(payload);
      await syncUsers(employees);
      await syncProjects(projects);
      showSnack("Tasks, users, and projects sent to Google Sheets.", "success");
    } catch {
      showSnack("Failed to reach Google Sheets. Check your connection and try again.", "error");
    }
  }

  const accountEmail = String(currentUser?.email || "").toLowerCase();

  const currentUserEmp = useMemo(() =>
    employees.find((emp) => emp["Email ID"]?.toLowerCase() === accountEmail),
    [employees, accountEmail]
  );

  const taskType = adminTaskType;
  const visibleTasks = isAdmin
    ? tasks
    : tasks.filter((item) => String(item.userEmail || "").toLowerCase() === accountEmail);
  const projectChoices = Array.from(
    new Map(
      projects
        .map((item) => (typeof item === "string" ? item : item?.name))
        .filter((name) => Boolean(name && String(name).trim()))
        .map((name) => [name.trim().toLowerCase(), name.trim()])
    ).values()
  );
  if (project && !projectChoices.some((name) => name.toLowerCase() === project.trim().toLowerCase())) {
    projectChoices.unshift(project.trim());
  }

  const trimmedProjectSearch = projectSearch.trim();
  const filteredProjects = projectChoices.filter((name) =>
    name.toLowerCase().includes(trimmedProjectSearch.toLowerCase())
  );
  const hasProjectExactMatch = projectChoices.some(
    (name) => name.toLowerCase() === trimmedProjectSearch.toLowerCase()
  );

  const trimmedAdminSearch = adminProjectSearch.trim();
  const filteredAdminProjects = projectChoices.filter((name) =>
    name.toLowerCase().includes(trimmedAdminSearch.toLowerCase())
  );
  const hasAdminExactMatch = projectChoices.some(
    (name) => name.toLowerCase() === trimmedAdminSearch.toLowerCase()
  );

  const availableTaskTypes = Array.from(
    new Set([
      ...DEFAULT_TASK_TYPES,
      ...tasks.map((t) => getTaskType(t)).filter(Boolean),
    ])
  );

  const statusCounts = useMemo(() => {
    const counts = { Pending: 0, "In Progress": 0, Completed: 0 };
    visibleTasks.forEach((t) => {
      const st = getTaskStatus(t);
      if (counts[st] !== undefined) {
        counts[st]++;
      }
    });
    return counts;
  }, [visibleTasks]);

  const projectCounts = useMemo(() => {
    const counts = {};
    visibleTasks.forEach((t) => {
      const p = String(t.Project ?? "").trim();
      if (p) counts[p] = (counts[p] || 0) + 1;
    });
    return counts;
  }, [visibleTasks]);

  const taskTypeCounts = useMemo(() => {
    const counts = {};
    visibleTasks.forEach((t) => {
      const type = getTaskType(t);
      if (type) counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [visibleTasks]);

  const filteredTasks = visibleTasks.filter((item) => {
    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      const id = String(item["Employee ID"] ?? "").toLowerCase();
      const name = String(item["Employee Name"] ?? "").toLowerCase();
      const projectNameValue = String(item.Project ?? "").toLowerCase();
      const taskDoneValue = String(item["Task Done"] ?? "").toLowerCase();
      const statusValue = String(item.status || item.Status || "").toLowerCase();
      const owner = String(item.userEmail ?? "").toLowerCase();
      const matchesSearch =
        id.includes(term) ||
        name.includes(term) ||
        projectNameValue.includes(term) ||
        taskDoneValue.includes(term) ||
        statusValue.includes(term) ||
        owner.includes(term);
      if (!matchesSearch) return false;
    }

    if (isAdmin) {
      if (appliedFilters.project) {
        const itemProj = String(item.Project ?? "").trim().toLowerCase();
        if (itemProj !== appliedFilters.project.trim().toLowerCase()) {
          return false;
        }
      }

      if (appliedFilters.taskType) {
        const itemType = getTaskType(item).toLowerCase();
        if (itemType !== appliedFilters.taskType.toLowerCase()) {
          return false;
        }
      }

      if (appliedFilters.statuses && appliedFilters.statuses.length > 0) {
        const itemStatus = getTaskStatus(item);
        if (!appliedFilters.statuses.includes(itemStatus)) {
          return false;
        }
      } else if (appliedFilters.status) {
        const itemStatus = getTaskStatus(item).toLowerCase();
        if (itemStatus !== appliedFilters.status.toLowerCase()) {
          return false;
        }
      }

      const itemDateStr = toInputDate(item.Date || item.createdAt);
      if (appliedFilters.fromDate) {
        if (!itemDateStr || itemDateStr < appliedFilters.fromDate) {
          return false;
        }
      }

      if (appliedFilters.toDate) {
        if (!itemDateStr || itemDateStr > appliedFilters.toDate) {
          return false;
        }
      }
    }

    return true;
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
  const isTaskCompleted = viewingTask ? getTaskStatus(viewingTask) === "Completed" : false;
  const isTaskPending = viewingTask ? getTaskStatus(viewingTask) === "Pending" : false;

  // ===== DASHBOARD DATA COMPUTATION (Real-Time from Firestore) =====
  // Scoped to current role:
  // Admin: All projects and all employees
  // Employee User: Only their assigned projects and their work details
  const loggedInEmail = currentUser?.email || "";

  const dashboardScopedTasks = useMemo(() => {
    if (isAdmin) return tasks;
    return tasks.filter((t) => {
      const ownerEmail = String(t.userEmail || "").trim().toLowerCase();
      const currentEmail = loggedInEmail.trim().toLowerCase();
      return ownerEmail === currentEmail;
    });
  }, [tasks, isAdmin, loggedInEmail]);

  const dashboardScopedProjects = useMemo(() => {
    const projSet = new Set();
    projects.forEach((p) => {
      const name = String(p?.name || p || "").trim();
      if (name) projSet.add(name);
    });
    tasks.forEach((t) => {
      const name = String(t.Project || "").trim();
      if (name) projSet.add(name);
    });

    const allList = Array.from(projSet);
    if (isAdmin) return allList;

    const userProjects = new Set();
    dashboardScopedTasks.forEach((t) => {
      const name = String(t.Project || "").trim();
      if (name) userProjects.add(name);
    });
    return allList.filter((p) => userProjects.has(p));
  }, [projects, tasks, isAdmin, dashboardScopedTasks]);

  const projectStatsList = useMemo(() => {
    return dashboardScopedProjects.map((projName) => {
      const projTasks = dashboardScopedTasks.filter(
        (t) => String(t.Project || "").trim().toLowerCase() === projName.toLowerCase()
      );

      const total = projTasks.length;
      const completed = projTasks.filter((t) => getTaskStatus(t) === "Completed").length;
      const inProgress = projTasks.filter((t) => getTaskStatus(t) === "In Progress").length;
      const pending = projTasks.filter((t) => getTaskStatus(t) === "Pending").length;
      const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);

      const empMap = new Map();
      projTasks.forEach((t) => {
        const empId = String(t["Employee ID"] || "").trim();
        const empName = String(t["Employee Name"] || "").trim();
        const key = empId || empName || t.userEmail || "unknown";
        if (!empMap.has(key)) {
          empMap.set(key, {
            id: empId,
            name: empName || empId || "Employee",
            email: t.userEmail || "",
          });
        }
      });

      let totalWorkingDays = 0;
      projTasks.forEach((t) => {
        const start = t.startDate || t.Date || t.createdAt;
        const end = t.endDate || (getTaskStatus(t) === "Completed" ? t.Date : null);
        totalWorkingDays += getWorkingDaysCount(start, end);
      });

      let latestDateObj = null;
      projTasks.forEach((t) => {
        const d = parseDateAny(t.deadline || t.endDate || t.Date || t.createdAt);
        if (d && (!latestDateObj || d > latestDateObj)) {
          latestDateObj = d;
        }
      });
      let deadlineStr = "";
      if (latestDateObj) {
        const day = String(latestDateObj.getDate()).padStart(2, "0");
        const month = String(latestDateObj.getMonth() + 1).padStart(2, "0");
        deadlineStr = `${day}-${month}-${latestDateObj.getFullYear()}`;
      } else {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, "0");
        const month = String(now.getMonth() + 1).padStart(2, "0");
        deadlineStr = `${day}-${month}-${now.getFullYear()}`;
      }

      let displayStatus = "Active";
      if (total > 0 && completed === total) {
        displayStatus = "Completed";
      } else if (inProgress > 0) {
        displayStatus = "In Progress";
      } else {
        displayStatus = "Active";
      }

      return {
        name: projName,
        totalTasks: total,
        completedTasks: completed,
        inProgressTasks: inProgress,
        pendingTasks: pending,
        progressPercent,
        employees: Array.from(empMap.values()),
        totalWorkingDays,
        status: displayStatus,
        deadline: deadlineStr,
      };
    });
  }, [dashboardScopedProjects, dashboardScopedTasks]);

  const greetingName = useMemo(() => {
    if (userEmpName) return userEmpName;
    if (currentUser?.displayName) return currentUser.displayName;
    if (currentUser?.email) {
      const part = currentUser.email.split("@")[0].split(/[._-]/)[0];
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
    return isAdmin ? "Admin" : "User";
  }, [userEmpName, currentUser?.displayName, currentUser?.email, isAdmin]);

  const summaryMetrics = useMemo(() => {
    const totalProjects = dashboardScopedProjects.length;

    const uniqueEmployees = new Set();
    if (isAdmin) {
      employees.forEach((emp) => {
        const key = String(emp["Employee ID"] || emp["Email ID"] || emp.id || "").trim();
        if (key) uniqueEmployees.add(key);
      });
      tasks.forEach((t) => {
        const key = String(t["Employee ID"] || t.userEmail || "").trim();
        if (key) uniqueEmployees.add(key);
      });
    } else {
      uniqueEmployees.add(loggedInEmail || "user");
    }

    const activeProjects = projectStatsList.filter(
      (p) => p.status !== "Completed"
    ).length;

    const completedTasksCount = dashboardScopedTasks.filter(
      (t) => getTaskStatus(t) === "Completed"
    ).length;

    const totalTasksCount = dashboardScopedTasks.length;
    const overallCompletionRate = totalTasksCount === 0 ? 0 : Math.round((completedTasksCount / totalTasksCount) * 100);

    return {
      totalProjects,
      totalEmployees: uniqueEmployees.size || (isAdmin ? 0 : 1),
      activeProjects,
      completedTasks: completedTasksCount,
      totalTasks: totalTasksCount,
      overallCompletionRate,
    };
  }, [dashboardScopedProjects, dashboardScopedTasks, employees, tasks, isAdmin, loggedInEmail, projectStatsList]);

  const projectDistributionData = useMemo(() => {
    if (distribProjectFilter === "all") {
      const activeCount = projectStatsList.filter((p) => p.status !== "Completed").length;
      const completedCount = projectStatsList.filter((p) => p.status === "Completed").length;
      const total = activeCount + completedCount;
      return {
        slices: [
          { label: "Active Projects", value: activeCount, color: "#2563eb" },
          { label: "Completed Projects", value: completedCount, color: "#7dd3fc" },
        ],
        total,
      };
    } else {
      const found = projectStatsList.find(
        (p) => p.name.toLowerCase() === distribProjectFilter.toLowerCase()
      );
      const activeCount = (found?.inProgressTasks || 0) + (found?.pendingTasks || 0);
      const completedCount = found?.completedTasks || 0;
      const total = activeCount + completedCount;
      return {
        slices: [
          { label: "Active Projects", value: activeCount, color: "#2563eb" },
          { label: "Completed Projects", value: completedCount, color: "#7dd3fc" },
        ],
        total,
      };
    }
  }, [distribProjectFilter, projectStatsList]);

  const taskStatusOverviewData = useMemo(() => {
    let targetTasks = dashboardScopedTasks;
    if (statusOverviewProjectFilter !== "all") {
      targetTasks = dashboardScopedTasks.filter(
        (t) => String(t.Project || "").trim().toLowerCase() === statusOverviewProjectFilter.toLowerCase()
      );
    }

    const pending = targetTasks.filter((t) => getTaskStatus(t) === "Pending").length;
    const inProgress = targetTasks.filter((t) => getTaskStatus(t) === "In Progress").length;
    const completed = targetTasks.filter((t) => getTaskStatus(t) === "Completed").length;
    const total = pending + inProgress + completed;

    return {
      slices: [
        { label: "Pending", value: pending, color: "#2563eb" },
        { label: "In Progress", value: inProgress, color: "#f59e0b" },
        { label: "Completed", value: completed, color: "#10b981" },
      ],
      total,
    };
  }, [dashboardScopedTasks, statusOverviewProjectFilter]);

  const renderDashboard = () => (
    <div className="dashboard-wrapper">
      {/* 1. Header Greeting */}
      <div className="dash-top-header">
        <h2 className="dash-main-title">Dashboard</h2>
        <p className="dash-welcome-sub">Welcome back, {greetingName}!</p>
      </div>

      {/* 2. Four Summary Cards */}
      <div className="dash-summary-cards-row">
        {/* Total Projects */}
        <div className="dash-summary-card card-total-projects">
          <div className="dash-card-body-top">
            <div className="dash-card-icon-box icon-box-blue">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-1.5V9a3 3 0 0 0-3-3h-3.379a3 3 0 0 1-2.121-.879L8.379 4.043A3 3 0 0 0 6.257 3.164H4.5A3 3 0 0 0 1.5 6.164v11.836A3 3 0 0 0 4.5 21z" />
              </svg>
            </div>
            <div className="dash-card-text-col">
              <span className="dash-card-label">Total Projects</span>
              <div className="dash-card-number">{summaryMetrics.totalProjects}</div>
            </div>
          </div>
          <div className="dash-card-subtext">
            <span className="bold-blue">{summaryMetrics.activeProjects} active</span> projects in progress
          </div>
        </div>

        {/* Total Employees */}
        <div className="dash-summary-card card-total-employees">
          <div className="dash-card-body-top">
            <div className="dash-card-icon-box icon-box-green">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
            </div>
            <div className="dash-card-text-col">
              <span className="dash-card-label">Total Employees</span>
              <div className="dash-card-number">{summaryMetrics.totalEmployees}</div>
            </div>
          </div>
          <div className="dash-card-subtext">
            <span>Team members</span>
          </div>
        </div>

        {/* Active Projects */}
        <div className="dash-summary-card card-active-projects">
          <div className="dash-card-body-top">
            <div className="dash-card-icon-box icon-box-purple">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            </div>
            <div className="dash-card-text-col">
              <span className="dash-card-label">Active Projects</span>
              <div className="dash-card-number">{summaryMetrics.activeProjects}</div>
            </div>
          </div>
          <div className="dash-card-subtext">
            <span className="bold-purple">{Math.max(0, summaryMetrics.totalProjects - summaryMetrics.activeProjects)} completed</span> / dormant
          </div>
        </div>

        {/* Completed Tasks */}
        <div className="dash-summary-card card-completed-tasks">
          <div className="dash-card-body-top">
            <div className="dash-card-icon-box icon-box-orange">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z" />
              </svg>
            </div>
            <div className="dash-card-text-col">
              <span className="dash-card-label">Completed Tasks</span>
              <div className="dash-card-number">{summaryMetrics.completedTasks}</div>
            </div>
          </div>
          <div className="dash-card-subtext">
            <span>{summaryMetrics.overallCompletionRate}% total resolution rate</span>
          </div>
        </div>
      </div>

      {/* 3. Two Charts Grid */}
      <div className="dash-charts-grid">
        {/* Project Distribution Chart Card */}
        <div className="dash-chart-card">
          <div className="dash-chart-card-header">
            <div className="dash-chart-title-wrap">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#1e254e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                <path d="M22 12A10 10 0 0 0 12 2v10z" />
              </svg>
              <h3 className="dash-chart-title">Project Distribution</h3>
            </div>
            <select
              value={distribProjectFilter}
              onChange={(e) => setDistribProjectFilter(e.target.value)}
              className="dash-chart-filter-select"
            >
              <option value="all">All Projects</option>
              {dashboardScopedProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="dash-chart-content">
            <div className="dash-pie-wrapper">
              {renderPieChartSvg(projectDistributionData.slices, 170)}
            </div>
            <div className="dash-pie-legend">
              {projectDistributionData.slices.map((slice, i) => (
                <div key={i} className="dash-legend-item">
                  <div className="dash-legend-label-wrap">
                    <span className="dash-legend-dot" style={{ backgroundColor: slice.color }} />
                    <span className="dash-legend-label">{slice.label}</span>
                  </div>
                  <span className="dash-legend-count">{slice.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Task Status Overview Chart Card */}
        <div className="dash-chart-card">
          <div className="dash-chart-card-header">
            <div className="dash-chart-title-wrap">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" color="#1e254e">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
              <h3 className="dash-chart-title">Task Status Overview</h3>
            </div>
            <select
              value={statusOverviewProjectFilter}
              onChange={(e) => setStatusOverviewProjectFilter(e.target.value)}
              className="dash-chart-filter-select"
            >
              <option value="all">All Projects</option>
              {dashboardScopedProjects.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="dash-chart-content">
            <div className="dash-pie-wrapper">
              {renderPieChartSvg(taskStatusOverviewData.slices, 170)}
            </div>
            <div className="dash-pie-legend">
              {taskStatusOverviewData.slices.map((slice, i) => (
                <div key={i} className="dash-legend-item">
                  <div className="dash-legend-label-wrap">
                    <span className="dash-legend-dot" style={{ backgroundColor: slice.color }} />
                    <span className="dash-legend-label">{slice.label}</span>
                  </div>
                  <span className="dash-legend-count">{slice.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Projects Overview Table Card */}
      <div className="dash-projects-table-card">
        <div className="dash-table-card-header">
          <div className="dash-table-title-wrap">
            <span className="dash-briefcase-icon" aria-hidden="true"></span>
            <h3 className="dash-table-card-title">Projects Overview</h3>
          </div>
          <button
            type="button"
            className="dash-view-all-projects-btn"
            onClick={() => setActiveNav("my-tasks")}
          >
            <span>View All Projects</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>

        <div className="dash-table-responsive-wrapper">
          <table className="dash-projects-overview-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Employees</th>
                <th>Working Days</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Deadline</th>
              </tr>
            </thead>
            <tbody>
              {projectStatsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="dash-no-projects-cell">
                    No projects found. Add tasks and projects to see statistics here.
                  </td>
                </tr>
              ) : (
                projectStatsList.map((p) => {
                  const primaryEmp = p.employees[0];
                  return (
                    <tr key={p.name}>
                      <td className="td-proj-name">{p.name}</td>
                      <td className="td-proj-emp">
                        {primaryEmp ? (
                          <div className="dash-emp-inline">
                            <span className="dash-emp-round-initial">
                              {(primaryEmp.name || "E").charAt(0).toUpperCase()}
                            </span>
                            <span className="dash-emp-name-id">
                              {primaryEmp.name} {primaryEmp.id ? `(${primaryEmp.id})` : ""}
                            </span>
                          </div>
                        ) : (
                          <span className="dash-no-emp-text"></span>
                        )}
                      </td>
                      <td className="td-proj-days">{p.totalWorkingDays} Days</td>
                      <td className="td-proj-progress">
                        <div className="dash-inline-progress-wrap">
                          <div className="dash-inline-progress-track">
                            <div
                              className={`dash-inline-progress-fill ${
                                p.progressPercent === 100
                                  ? "fill-complete"
                                  : p.progressPercent >= 60
                                  ? "fill-high"
                                  : "fill-medium"
                              }`}
                              style={{ width: `${Math.min(100, Math.max(0, p.progressPercent))}%` }}
                            />
                          </div>
                          <span className="dash-inline-progress-text">{p.progressPercent}%</span>
                        </div>
                      </td>
                      <td className="td-proj-status">
                        <span className={`dash-status-pill ${p.status.toLowerCase().replace(/\s+/g, "-")}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="td-proj-deadline">{p.deadline}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderTaskForm = (isModal = false) => (
    <form onSubmit={addTask} className={`task-form ${isModal ? "modal-task-form" : ""}`}>
      {isModal ? (
        <div className="user-modal-form-grid">
          {/* Field 1: Employee ID */}
          <div className="form-group">
            <label htmlFor={isModal ? "modalEmpId" : "empId"} className="form-label">
              <svg className="field-icon emp-id-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Employee ID</span>
            </label>
            <input
              id={isModal ? "modalEmpId" : "empId"}
              type="text"
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              placeholder="Enter employee ID"
              className="form-input"
              required
            />
          </div>

          {/* Field 2: Employee Name */}
          <div className="form-group">
            <label htmlFor={isModal ? "modalEmpName" : "empName"} className="form-label">
              <svg className="field-icon emp-name-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>Employee Name</span>
            </label>
            <input
              id={isModal ? "modalEmpName" : "empName"}
              type="text"
              value={empName}
              onChange={(e) => setEmpName(e.target.value)}
              placeholder="Enter employee name"
              className="form-input"
              required
            />
          </div>
        </div>
      ) : (
        <>
          {/* Field 1: Employee ID */}
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

          {/* Field 2: Employee Name */}
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
        </>
      )}

      {/* Field 3: Project Name (Custom Searchable Dropdown) */}
      <div className="form-group project-dropdown-group" ref={projectDropdownRef}>
        <label htmlFor={isModal ? "modal-project-trigger" : "project-trigger"} className="form-label">
          <svg
            className="field-icon project-icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          <span>
            Project Name <span className="required-asterisk">*</span>
          </span>
        </label>

        <button
          type="button"
          id={isModal ? "modal-project-trigger" : "project-trigger"}
          className={`project-dropdown-trigger ${isProjectDropdownOpen ? "active" : ""} ${!project ? "placeholder" : ""}`}
          onClick={() => {
            setIsProjectDropdownOpen((prev) => !prev);
            setProjectSearch("");
          }}
          aria-haspopup="listbox"
          aria-expanded={isProjectDropdownOpen}
        >
          <span className="project-trigger-text">
            {project || "Select a project"}
          </span>
          <svg
            className="project-dropdown-arrow"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points={isProjectDropdownOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
          </svg>
        </button>

        {isProjectDropdownOpen && (
          <div className="project-dropdown-menu" role="listbox">
            <div className="project-search-wrapper">
              <svg
                className="project-search-icon"
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="project-search-input"
                placeholder="Search or enter project name..."
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (trimmedProjectSearch && !hasProjectExactMatch) {
                      addNewProject(trimmedProjectSearch);
                    } else if (filteredProjects.length === 1) {
                      setProject(filteredProjects[0]);
                      setIsProjectDropdownOpen(false);
                      setProjectSearch("");
                    }
                  }
                }}
                autoFocus
              />
            </div>

            <div className="project-options-list">
              {filteredProjects.length === 0 ? (
                <div className="project-empty-item">
                  {trimmedProjectSearch
                    ? `No existing projects match "${trimmedProjectSearch}"`
                    : "No projects found"}
                </div>
              ) : (
                filteredProjects.map((name) => (
                  <div
                    key={name}
                    className={`project-option-row ${project.toLowerCase() === name.toLowerCase() ? "selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="project-option-name"
                      onClick={() => {
                        setProject(name);
                        setIsProjectDropdownOpen(false);
                        setProjectSearch("");
                      }}
                      role="option"
                      aria-selected={project.toLowerCase() === name.toLowerCase()}
                    >
                      {name}
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="project-option-delete-btn"
                        onClick={(e) => handleDeleteProject(e, name)}
                        title={`Delete ${name}`}
                        aria-label={`Delete ${name}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))
              )}

              {trimmedProjectSearch && !hasProjectExactMatch && (
                <button
                  type="button"
                  className="project-add-option-btn"
                  onClick={() => addNewProject(trimmedProjectSearch)}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Add New Project: <strong>&ldquo;{trimmedProjectSearch}&rdquo;</strong></span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Field 4: Date */}
      <div className="form-group">
        <label htmlFor={isModal ? "modalTaskDate" : "taskDate"} className="form-label">
          <svg className="field-icon date-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span>Date</span>
        </label>
        <input
          id={isModal ? "modalTaskDate" : "taskDate"}
          type="date"
          value={taskDate}
          onChange={(e) => setTaskDate(e.target.value)}
          className="form-input"
          required
        />
      </div>

      {/* Field 5: Task Type */}
      <div className="form-group">
        <label htmlFor={isModal ? "modalTaskType" : "taskType"} className="form-label">
          <svg className="field-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          <span>Task Type</span>
        </label>
        <select
          id={isModal ? "modalTaskType" : "taskType"}
          value={taskType}
          onChange={(e) => setAdminTaskType(e.target.value)}
          className="form-input"
        >
          <option value="">Select task type</option>
          {DEFAULT_TASK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Field 6: Task Done */}
      <div className="form-group">
        <label htmlFor={isModal ? "modalTask" : "task"} className="form-label">
          <svg className="field-icon task-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Task Done</span>
        </label>
        <textarea
          id={isModal ? "modalTask" : "task"}
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="Describe the completed task"
          rows={isModal ? 3 : 4}
          className="form-textarea"
          required
        />
      </div>

      {isModal ? (
        <div className="user-modal-footer">
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={handleCloseTaskModal}
          >
            Cancel
          </button>
          <button className="btn-modal-submit" type="submit">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>{editingId ? "Update Task" : "Add Task"}</span>
          </button>
        </div>
      ) : (
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
      )}
    </form>
  );

  const renderMainCards = () => (
    <main className="container">
      {/* Right Panel  Employee Task List */}
      <section className="table-card">
        <div className="table-header">
          <div className="table-header-top-row">
            <div className="table-header-left">
              <button
                type="button"
                className="btn-add-employee-task"
                onClick={handleOpenTaskModal}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Employee Task</span>
              </button>
            </div>

            {isAdmin ? (
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
                <button
                  type="button"
                  className={`btn-sheets btn-sheets-filter ${hasActiveFilters ? "has-filters" : ""}`}
                  onClick={openFilterModal}
                  title="Filter Tasks"
                  aria-haspopup="dialog"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <span className="filters-count-badge">{activeFilterCount}</span>
                  )}
                </button>
              </div>
            ) : (
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
                  placeholder="Search by Task or Project..."
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
            )}
          </div>

          {isAdmin && (
            <div className="table-search-row">
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
          )}
        </div>

          {/* Active Filter Chips Bar (Shown above table only when filters are applied) */}
          {isAdmin && hasActiveFilters && (
            <div className="admin-active-chips-bar">
              <span className="admin-active-chips-label">Active:</span>
              {appliedFilters.project && (
                <div className="admin-chip">
                  <span>Project: <strong>{appliedFilters.project}</strong></span>
                  <button
                    type="button"
                    className="admin-chip-remove"
                    onClick={() => removeSingleFilter("project")}
                    aria-label="Remove project filter"
                    title="Remove project filter"
                  >
                    ✕
                  </button>
                </div>
              )}
              {appliedFilters.taskType && (
                <div className="admin-chip">
                  <span>Type: <strong>{appliedFilters.taskType}</strong></span>
                  <button
                    type="button"
                    className="admin-chip-remove"
                    onClick={() => removeSingleFilter("taskType")}
                    aria-label="Remove task type filter"
                    title="Remove task type filter"
                  >
                    ✕
                  </button>
                </div>
              )}
              {appliedFilters.statuses && appliedFilters.statuses.length > 0 ? (
                appliedFilters.statuses.map((st) => (
                  <div key={st} className="admin-chip">
                    <span>Status: <strong>{st}</strong></span>
                    <button
                      type="button"
                      className="admin-chip-remove"
                      onClick={() => removeSingleStatusFilter(st)}
                      aria-label={`Remove ${st} filter`}
                      title={`Remove ${st} filter`}
                    >
                      ✕
                    </button>
                  </div>
                ))
              ) : appliedFilters.status ? (
                <div className="admin-chip">
                  <span>Status: <strong>{appliedFilters.status}</strong></span>
                  <button
                    type="button"
                    className="admin-chip-remove"
                    onClick={() => removeSingleFilter("status")}
                    aria-label="Remove status filter"
                    title="Remove status filter"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              {(appliedFilters.fromDate || appliedFilters.toDate) && (
                <div className="admin-chip">
                  <span>
                    Date: <strong>{appliedFilters.fromDate ? formatDate(appliedFilters.fromDate) : "Any"}  {appliedFilters.toDate ? formatDate(appliedFilters.toDate) : "Any"}</strong>
                  </span>
                  <button
                    type="button"
                    className="admin-chip-remove"
                    onClick={() => removeSingleFilter("date")}
                    aria-label="Remove date range filter"
                    title="Remove date range filter"
                  >
                    ✕
                  </button>
                </div>
              )}
              <button
                type="button"
                className="admin-chip-clear-link"
                onClick={handleResetFilters}
                title="Clear all active filters"
              >
                Clear all
              </button>
            </div>
          )}

          <div className="table-wrapper">
            <table className="task-table">
              <thead>
                {isAdmin ? (
                  <tr>
                    <th className="th-sno">S.NO</th>
                    <th>Employee ID</th>
                    <th>Employee Name</th>
                    <th>Project</th>
                    <th>Task Done</th>
                    <th>Date</th>
                    <th>User</th>
                    <th className="th-actions">Actions</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="th-sno">S.NO</th>
                    <th>TASK</th>
                    <th>PROJECT</th>
                    <th>DATE</th>
                    <th>STATUS</th>
                    <th className="th-actions">ACTIONS</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {currentTasks.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 6} className="empty-state">
                      {searchTerm.trim() || (isAdmin && hasActiveFilters)
                        ? "No tasks found"
                        : "No tasks added yet"}
                    </td>
                  </tr>
                ) : (
                  currentTasks.map((item, index) => {
                    const avatarPalette = AVATAR_PALETTES[(startIndex + index) % AVATAR_PALETTES.length];
                    const initialChar = (item["Employee ID"] || "E").trim().charAt(0).toUpperCase();

                    if (!isAdmin) {
                      const taskStatus = getTaskStatus(item);
                      let statusBadgeClass = "status-badge-progress";
                      if (taskStatus === "Completed") statusBadgeClass = "status-badge-completed";
                      else if (taskStatus === "Pending") statusBadgeClass = "status-badge-pending";
                      const isLocked = taskStatus === "Pending" || taskStatus === "Completed";
                      const isOwner = String(item.userEmail || "").toLowerCase() === accountEmail;

                      return (
                        <tr key={item.id} className="task-row">
                          <td className="sno-cell">{startIndex + index + 1}</td>
                          <td className="task-done-cell font-medium">{item["Task Done"]}</td>
                          <td className="project-cell">{item.Project || ""}</td>
                          <td>
                            <div className="date-cell">
                              <span>{formatDate(item["Date"])}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`status-badge ${statusBadgeClass}`}>{taskStatus}</span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="action-btn view-btn"
                                onClick={() => openViewModal(item)}
                                title="View Task Details"
                                aria-label="View Task Details"
                              >
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                  <circle cx="12" cy="12" r="3" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="action-btn clone-btn"
                                onClick={() => cloneTask(item)}
                                title="Clone Task"
                                aria-label="Clone Task"
                              >
                                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              </button>
                              {!isLocked && (
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
                              )}
                              {isOwner && taskStatus === "In Progress" && (
                                <button
                                  type="button"
                                  className="action-btn btn-submit-review"
                                  onClick={() => handleSubmitForReview(item.id)}
                                  title="Submit for Review"
                                  aria-label="Submit for Review"
                                >
                                  Submit
                                </button>
                              )}
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
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }

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
                        <td className="project-cell">{item.Project || ""}</td>
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
                        {isAdmin && <td className="user-cell">{item.userEmail || ""}</td>}
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn view-btn"
                              onClick={() => openViewModal(item)}
                              title="View Task Details"
                              aria-label="View Task Details"
                            >
                              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>
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
              Showing {totalRecords === 0 ? "0" : `${startIndex + 1}${endIndex}`} of {totalRecords}
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
  );

  return (
    <div className="app">
      {/* 1. Header */}
      <header className="header">
        <div className="header-inner">
          <div className="brand">
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              title="Toggle sidebar"
              aria-label="Toggle navigation menu"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
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

          <div className="header-nav-pills">
            <button
              type="button"
              className={`header-nav-pill ${activeNav === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveNav("dashboard")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
              </svg>
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              className={`header-nav-pill ${activeNav === "my-tasks" ? "active" : ""}`}
              onClick={() => setActiveNav("my-tasks")}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                <path fillRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.2 14.6l-4.2-4.2 1.4-1.4 2.8 2.8 6.4-6.4 1.4 1.4-7.8 7.8z" clipRule="evenodd" />
              </svg>
              <span>{isAdmin ? "Task Manager" : "My Tasks"}</span>
            </button>
          </div>

          <div className="header-right">
            <div className="user-profile">
              <div className="user-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <span className="user-meta">
                <span className="user-name">{isAdmin ? "Admin" : currentUser?.email}</span>
                <span className="role-pill">{isAdmin ? "Admin portal" : "USER PORTAL"}</span>
              </span>
            </div>

            {/* Notification Bell */}
            <div className="notif-bell-wrap" ref={notifRef}>
              <button
                type="button"
                ref={notifBtnRef}
                className="notif-bell-btn"
                onClick={() => {
                  const rect = notifBtnRef.current?.getBoundingClientRect();
                  if (rect) {
                    setNotifBox({
                      top: rect.bottom + 8,
                      right: Math.max(8, window.innerWidth - rect.right),
                    });
                  }
                  setNotifOpen((open) => !open);
                }}
                aria-label="Notifications"
                title="Notifications"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {bellNotifs.filter(n => !n.read).length > 0 && (
                  <span className="notif-badge">
                    {bellNotifs.filter(n => !n.read).length > 9 ? '9+' : bellNotifs.filter(n => !n.read).length}
                  </span>
                )}
              </button>

              {notifOpen && createPortal(
                <div
                  className="notif-dropdown"
                  ref={notifDropdownRef}
                  style={{ top: notifBox.top, right: notifBox.right }}
                >
                  <div className="notif-dropdown-header">
                    <span className="notif-dropdown-title">Notifications</span>
                    <div className="notif-header-actions">
                      {bellNotifs.some(n => !n.read) && (
                        <button className="notif-mark-all" onClick={markAllNotifsRead}>Mark all as read</button>
                      )}
                      {bellNotifs.length > 0 && (
                        <button
                          className="notif-clear-all"
                          onClick={clearAllNotifs}
                          disabled={bellNotifs.some(n => !n.read)}
                          title={bellNotifs.some(n => !n.read) ? 'Read all notifications to enable Clear All' : 'Clear all notifications'}
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="notif-list">
                    {bellNotifs.length === 0 ? (
                      <div className="notif-empty">No notifications yet</div>
                    ) : (
                      bellNotifs.map(n => {
                        const isProjectReq = n.type === 'project_request';
                        const isProjMsg = n.type === 'project_message';
                        const isTaskRemark = n.type === 'task_remark';
                        const isProjectUpdate = n.type === 'project_update';
                        const isTaskApproval = n.type === 'task_approval';
                        const isTaskResult = n.type === 'task_approval_result';
                        const avatarBg = isProjectReq ? '#2563eb' : isProjMsg ? '#0891b2' : isTaskRemark ? '#0f766e' : isTaskApproval ? '#7c3aed' : isTaskResult ? (n.result==='approved'?'#15803d':'#be185d') : '#7c3aed';
                        const avatarInitial = isTaskRemark
                          ? (n.adminEmail || 'A').charAt(0).toUpperCase()
                          : (n.requesterName || n.senderName || n.actorName || n.employeeName || '?').charAt(0).toUpperCase();
                        return (
                          <div key={n.id} className={`notif-item${n.read ? '' : ' notif-unread'}`}>
                            <div className="notif-item-avatar" style={{ background: avatarBg }}>
                              {avatarInitial}
                            </div>
                            <div className="notif-item-body">
                              {isProjectReq ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>{n.requesterName}</strong> raised a project request
                                  </p>
                                  <p className="notif-item-title">"{n.projectName}"</p>
                                  <p className="notif-item-meta">{n.requesterEmail} · {timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('projects'); }}
                                  >View Project</button>
                                </>
                              ) : isProjMsg ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>{n.senderName}</strong> posted in <strong>{n.projectName}</strong>
                                  </p>
                                  <p className="notif-item-title">"{n.messagePreview}"</p>
                                  <p className="notif-item-meta">{n.senderEmail} · {timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('projects'); }}
                                  >View Project</button>
                                </>
                              ) : isProjectUpdate ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>{n.actorName || "Admin"}</strong> {n.summary || "updated a project"}
                                  </p>
                                  <p className="notif-item-title">"{n.projectName}"</p>
                                  <p className="notif-item-meta">{timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav("projects"); }}
                                  >View Project</button>
                                </>
                              ) : isTaskRemark ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>Admin</strong> added a remark on your task
                                  </p>
                                  <p className="notif-item-title">"{n.remark}"</p>
                                  <p className="notif-item-meta">{timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('my-tasks'); }}
                                  >View Task</button>
                                </>
                              ) : isTaskApproval ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>{n.employeeName || n.actorName}</strong> submitted a task for review
                                  </p>
                                  <p className="notif-item-title">"{n.taskName}"</p>
                                  <p className="notif-item-meta">{n.projectName} · {timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('my-tasks'); }}
                                  >Review Task</button>
                                </>
                              ) : isTaskResult ? (
                                <>
                                  <p className="notif-item-text">
                                    <strong>Admin</strong> {n.result === 'approved' ? 'approved' : 'rejected'} your task
                                  </p>
                                  <p className="notif-item-title">"{n.taskName}"</p>
                                  <p className="notif-item-meta">{n.projectName} · {timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('my-tasks'); }}
                                  >View Task</button>
                                </>
                              ) : (
                                <>
                                  <p className="notif-item-text">
                                    <strong>{n.requesterName}</strong> posted a support request
                                  </p>
                                  <p className="notif-item-title">"{n.requestTitle}"</p>
                                  <p className="notif-item-meta">{n.requesterEmail} · {timeAgoNotif(n.createdAt)}</p>
                                  <button
                                    className="notif-view-btn"
                                    onClick={() => { markNotifRead(n.id); setNotifOpen(false); setActiveNav('support'); }}
                                  >View Request</button>
                                </>
                              )}
                            </div>
                            {!n.read && <span className="notif-unread-dot" />}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>,
                document.body
              )}
            </div>

            <button type="button" className="logout-btn" onClick={() => { clearCachedNotifs(currentUser?.email); signOut(auth); }}>
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

      {/* Main Content Layout */}
      <div className="portal-layout">
        <aside className={`user-sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
          <div className="sidebar-nav">
            <button
              type="button"
              className={`sidebar-nav-item ${activeNav === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveNav("dashboard")}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              <span className="sidebar-label">Dashboard</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${activeNav === "my-tasks" ? "active" : ""}`}
              onClick={() => setActiveNav("my-tasks")}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="currentColor">
                <path fillRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.2 14.6l-4.2-4.2 1.4-1.4 2.8 2.8 6.4-6.4 1.4 1.4-7.8 7.8z" clipRule="evenodd" />
              </svg>
              <span className="sidebar-label">{isAdmin ? "Task Manager" : "My Tasks"}</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${activeNav === "projects" ? "active" : ""}`}
              onClick={() => setActiveNav("projects")}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span className="sidebar-label">Projects</span>
            </button>

            <button
              type="button"
              className={`sidebar-nav-item ${activeNav === "daily-activities" ? "active" : ""}`}
              onClick={() => setActiveNav("daily-activities")}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span className="sidebar-label">Daily Activities</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeNav === "reports" ? "active" : ""}`}
                onClick={() => setActiveNav("reports")}
              >
                <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                <span className="sidebar-label">Reports</span>
              </button>
            )}

            {!isAdmin && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeNav === "my-reports" ? "active" : ""}`}
                onClick={() => setActiveNav("my-reports")}
              >
                <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <span className="sidebar-label">My Reports</span>
              </button>
            )}

            <button
              type="button"
              className={`sidebar-nav-item ${activeNav === "support" ? "active" : ""}`}
              onClick={() => setActiveNav("support")}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <span className="sidebar-label">Support Hub</span>
            </button>

          </div>

          <div className="sidebar-bottom">
            <button
              type="button"
              className="sidebar-nav-item sidebar-logout"
              onClick={() => { clearCachedNotifs(currentUser?.email); signOut(auth); }}
            >
              <svg className="sidebar-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="sidebar-label">Logout</span>
            </button>
          </div>
        </aside>

        <div className={`portal-content${activeNav === 'support' ? ' portal-dark' : ''}`}>
          {activeNav === "dashboard" ? (
            renderDashboard()
          ) : activeNav === "my-tasks" ? (
            renderMainCards()
          ) : activeNav === "projects" ? (
            <ProjectsPage
              currentUser={currentUser}
              employees={employees}
              tasks={tasks}
              projects={projects}
              isAdmin={isAdmin}
              showSnack={showSnack}
            />
          ) : activeNav === "daily-activities" ? (
            <DailyActivitiesPage
              currentUser={currentUser}
              employees={employees}
              tasks={tasks}
              projects={projects}
              projectDetails={projectDetails}
              activityLogs={activityLogs}
              isAdmin={isAdmin}
              showSnack={showSnack}
            />
          ) : activeNav === "reports" ? (
            <ReportsPage
              currentUser={currentUser}
              employees={employees}
              tasks={tasks}
              projects={projects}
              projectDetails={projectDetails}
              activityLogs={activityLogs}
              isAdmin={isAdmin}
              showSnack={showSnack}
            />
          ) : activeNav === "my-reports" ? (
            <MyReportsPage
              currentUser={currentUser}
              tasks={tasks}
              projectDetails={projectDetails}
              activityLogs={activityLogs}
              showSnack={showSnack}
            />
          ) : activeNav === "support" ? (
            <SupportPage
              currentUser={currentUser}
              employees={employees}
              showSnack={showSnack}
            />
          ) : (
            <div className="portal-section-placeholder">
              <div className="placeholder-card">
                <div className="placeholder-icon">
                  <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h2>{activeNav.charAt(0).toUpperCase() + activeNav.slice(1).replace(/-/g, " ")}</h2>
                <p>This module is coming soon. Please select <strong>Dashboard</strong> or <strong>{isAdmin ? "Task Manager" : "My Tasks"}</strong>.</p>
                <button type="button" className="btn-return-tasks" onClick={() => setActiveNav("dashboard")}>
                  Go to Dashboard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isAdmin && (
        <footer className="footer">
          <p className="footer-tagline"></p>
        </footer>
      )}

      {/* 6. Read-Only Task Details Modal */}
      {viewingTask && (
        <div className="modal-overlay" onClick={() => setViewingTask(null)}>
          <div
            className="task-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-details-title"
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </div>
                <div>
                  <h3 id="task-details-title">Task Details</h3>
                  <span className="modal-subtitle">Read-only view</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setViewingTask(null)}
                title="Close"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-grid">
                <div className="modal-field">
                  <span className="modal-label">Employee ID</span>
                  <div className="modal-value-with-icon">
                    <span className="emp-avatar small-avatar" style={{ backgroundColor: "#eff6ff", color: "#2563eb" }}>
                      {(viewingTask["Employee ID"] || "E").trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="modal-value-strong">{viewingTask["Employee ID"] || ""}</span>
                  </div>
                </div>

                <div className="modal-field">
                  <span className="modal-label">Employee Name</span>
                  <span className="modal-value-text">{viewingTask["Employee Name"] || ""}</span>
                </div>

                <div className="modal-field">
                  <span className="modal-label">Project</span>
                  <span className="modal-project-badge">{viewingTask.Project || ""}</span>
                </div>

                <div className="modal-field">
                  <span className="modal-label">Date</span>
                  <div className="modal-value-with-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>{formatDate(viewingTask["Date"]) || viewingTask["Date"] || ""}</span>
                  </div>
                </div>

                {viewingTask.userEmail && (
                  <div className="modal-field full-width">
                    <span className="modal-label">User Email</span>
                    <span className="modal-value-text">{viewingTask.userEmail}</span>
                  </div>
                )}

                <div className="modal-field full-width">
                  <span className="modal-label">Task Done</span>
                  <div className="modal-task-box">
                    {viewingTask["Task Done"] || "No description provided."}
                  </div>
                </div>

                {/* Remarks Field (Below Task Done) */}
                <div className="modal-field full-width modal-remarks-section">
                  <div className="modal-remarks-header">
                    <span className="modal-label">Remarks</span>
                    {(() => {
                      const st = getTaskStatus(viewingTask);
                      let badgeClass = "status-in-progress";
                      if (st === "Completed") badgeClass = "status-completed";
                      else if (st === "Pending") badgeClass = "status-pending-badge";
                      return (
                        <span className={`modal-status-badge ${badgeClass}`}>{st}</span>
                      );
                    })()}
                  </div>

                  {isAdmin ? (
                    isTaskCompleted ? (
                      <div className="modal-remarks-box read-only">
                        {remarksText ? (
                          <p className="modal-remarks-text">{remarksText}</p>
                        ) : (
                          <span className="modal-empty-remarks">No remarks provided.</span>
                        )}
                      </div>
                    ) : (
                      <div className="modal-remarks-edit-wrap">
                        <div className="remarks-select-wrap">
                          <select
                            className="remarks-preset-select"
                            value={remarksPreset}
                            onChange={e => {
                              const val = e.target.value;
                              setRemarksPreset(val);
                              if (val !== '__other__') setRemarksText(val);
                              else setRemarksText('');
                            }}
                          >
                            <option value="">— Select a remark —</option>
                            {REMARKS_PRESETS.map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                            <option value="__other__">Other (custom remark)…</option>
                          </select>
                        </div>
                        {remarksPreset === '__other__' && (
                          <textarea
                            className="modal-remarks-textarea"
                            rows={3}
                            value={remarksText}
                            onChange={e => setRemarksText(e.target.value)}
                            placeholder="Type a custom remark..."
                            autoFocus
                          />
                        )}
                        <div className="modal-remarks-actions">
                          <button
                            type="button"
                            className="btn-save-remarks"
                            onClick={handleSaveRemarks}
                            disabled={savingRemarks}
                          >
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                              <polyline points="17 21 17 13 7 13 7 21" />
                              <polyline points="7 3 7 8 15 8" />
                            </svg>
                            <span>{savingRemarks ? "Saving..." : "Save Remarks"}</span>
                          </button>
                          {isTaskPending && (
                            <>
                              <button
                                type="button"
                                className="btn-approve-task"
                                onClick={() => handleApproveTask(viewingTask.id)}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                <span>Approve</span>
                              </button>
                              <button
                                type="button"
                                className="btn-reject-task"
                                onClick={() => handleRejectTask(viewingTask.id, remarksText)}
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                                <span>Reject</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    /* Employee User Portal - Read-Only View */
                    <div className="modal-remarks-box read-only">
                      {remarksText ? (
                        <p className="modal-remarks-text">{remarksText}</p>
                      ) : (
                        <span className="modal-empty-remarks">No remarks from admin yet.</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-footer-btn"
                onClick={() => setViewingTask(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Task Filters Modal Popup */}
      {isAdmin && isFilterModalOpen && (
        <div className="modal-overlay" onClick={() => setIsFilterModalOpen(false)}>
          <div
            className="task-modal filters-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="filters-modal-title"
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge filters-modal-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="4" y1="21" x2="4" y2="14" />
                    <line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" />
                    <line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" />
                    <line x1="9" y1="8" x2="15" y2="8" />
                    <line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                </div>
                <div>
                  <h3 id="filters-modal-title">Filters</h3>
                  <span className="modal-subtitle">Filter and find employee tasks.</span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setIsFilterModalOpen(false)}
                title="Close"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className="modal-body filters-modal-body">
              <div className="filters-modal-fields-list">
                {/* 1. Project Dropdown */}
                <div className="filters-modal-field">
                  <label htmlFor="modal-filter-project" className="filters-modal-label">
                    Project
                  </label>
                  <div className="filters-modal-select-wrap">
                    <select
                      id="modal-filter-project"
                      className="filters-modal-select"
                      value={filterProject}
                      onChange={(e) => setFilterProject(e.target.value)}
                    >
                      <option value="">All Projects</option>
                      {projectChoices.map((p) => {
                        const count = projectCounts[p] || 0;
                        return (
                          <option key={p} value={p}>
                            {p} {count > 0 ? `(${count})` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <svg className="filters-modal-select-arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* 2. Task Type Dropdown */}
                <div className="filters-modal-field">
                  <label htmlFor="modal-filter-task-type" className="filters-modal-label">
                    Task Type
                  </label>
                  <div className="filters-modal-select-wrap">
                    <select
                      id="modal-filter-task-type"
                      className="filters-modal-select"
                      value={filterTaskType}
                      onChange={(e) => setFilterTaskType(e.target.value)}
                    >
                      <option value="">All Task Types</option>
                      {availableTaskTypes.map((t) => {
                        const count = taskTypeCounts[t] || 0;
                        return (
                          <option key={t} value={t}>
                            {t} {count > 0 ? `(${count})` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <svg className="filters-modal-select-arrow" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* 3. Task Status (Selectable Colored Status Badges) */}
                <div className="filters-modal-field">
                  <label className="filters-modal-label">
                    Task Status
                  </label>
                  <div className="filters-status-badges-group">
                    {[
                      { label: "Pending", badgeClass: "status-badge-pending" },
                      { label: "In Progress", badgeClass: "status-badge-progress" },
                      { label: "Completed", badgeClass: "status-badge-completed" },
                    ].map(({ label, badgeClass }) => {
                      const isSelected = filterStatuses.includes(label);
                      return (
                        <button
                          key={label}
                          type="button"
                          className={`filters-status-badge-btn ${badgeClass} ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleFilterStatus(label)}
                          aria-pressed={isSelected}
                        >
                          {isSelected && (
                            <svg className="filters-status-check-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          <span>{label}</span>
                          {statusCounts[label] > 0 && (
                            <span className="filters-status-count-tag">
                              ({statusCounts[label]})
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4. Date Range */}
                <div className="filters-modal-field">
                  <label className="filters-modal-label">
                    Date Range
                  </label>
                  <div className="filters-modal-date-grid">
                    <div className="filters-modal-date-item">
                      <span className="filters-modal-date-caption">From Date</span>
                      <div className="filters-modal-date-box">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <input
                          id="modal-filter-from-date"
                          type="date"
                          className="filters-modal-date-input"
                          value={filterFromDate}
                          onChange={(e) => setFilterFromDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="filters-modal-date-item">
                      <span className="filters-modal-date-caption">To Date</span>
                      <div className="filters-modal-date-box">
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <input
                          id="modal-filter-to-date"
                          type="date"
                          className="filters-modal-date-input"
                          value={filterToDate}
                          min={filterFromDate || undefined}
                          onChange={(e) => setFilterToDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="modal-footer filters-modal-footer">
              <button
                type="button"
                className="btn-filters-modal-reset"
                onClick={handleResetFilters}
                title="Reset all filters"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span>Reset</span>
              </button>
              <button
                type="button"
                className="btn-filters-modal-apply"
                onClick={handleApplyFilters}
                title="Apply selected filters"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Apply Filters</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Add Employee Task Modal (Admin & User) */}
      {isTaskModalOpen && (
        <div className="modal-overlay" onClick={handleCloseTaskModal}>
          <div
            className={`task-modal ${isAdmin ? "admin-task-modal" : "user-task-modal"}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-title-wrap">
                <div className="modal-icon-badge user-modal-icon-badge" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <div>
                  <h3 id="task-modal-title">
                    {editingId ? "Edit Employee Task" : "Add Employee Task"}
                  </h3>
                  <span className="modal-subtitle">
                    {isAdmin
                      ? (editingId ? "Update employee task details." : "Add users, projects, and record employee tasks.")
                      : (editingId ? "Update your task details below." : "Choose a project and record your own task.")}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={handleCloseTaskModal}
                title="Close"
                aria-label="Close modal"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <div className={`modal-body ${isAdmin ? "admin-modal-body" : "user-modal-body"}`}>
              {isAdmin && (
                <>
                  {/* Admin User Details Subform */}
                  <form onSubmit={addEmployee} className="project-form admin-modal-subform">
                    <label className="form-label" htmlFor="userEmpId">
                      <svg className="field-icon emp-name-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="8.5" cy="7" r="4" />
                        <line x1="20" y1="8" x2="20" y2="14" />
                        <line x1="23" y1="11" x2="17" y2="11" />
                      </svg>
                      <span>User Details (Add New User)</span>
                    </label>
                    <div className="admin-user-inputs-grid">
                      <input
                        id="userEmpId"
                        type="text"
                        value={userEmpId}
                        onChange={(e) => setUserEmpId(e.target.value)}
                        placeholder="Employee ID"
                        className="form-input"
                      />
                      <input
                        id="userEmpName"
                        type="text"
                        value={userEmpName}
                        onChange={(e) => setUserEmpName(e.target.value)}
                        placeholder="Employee name"
                        className="form-input"
                      />
                    </div>
                    <div className="project-add-row">
                      <input
                        id="userEmail"
                        type="email"
                        value={userEmail}
                        onChange={(e) => setUserEmail(e.target.value)}
                        placeholder="Email ID"
                        className="form-input"
                      />
                      <div className="filters-modal-select-wrap" style={{flex:"0 0 160px"}}>
                        <select
                          id="userTaskType"
                          value={userTaskType}
                          onChange={(e) => setUserTaskType(e.target.value)}
                          className="form-input"
                          style={{height:"38px",paddingRight:"28px"}}
                        >
                          <option value="">Task Type</option>
                          {DEFAULT_TASK_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <button className="project-add-btn" type="submit">Add User</button>
                    </div>
                    {employees.length > 0 && (
                      <div className="project-list">
                        {employees.map((item) => (
                          <span key={item.id} className="project-chip">
                            {item["Employee Name"]} · {item["Email ID"]}
                            <button type="button" onClick={() => removeEmployee(item.id)} aria-label={`Remove ${item["Employee Name"]}`}>
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </form>

                  {/* Admin Project Subform */}
                  <form onSubmit={addProject} className="project-form admin-modal-subform">
                    <label htmlFor="projectName" className="form-label">
                      <svg className="field-icon project-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <span>Project Details (Add / Select Project)</span>
                    </label>
                    <div className="project-add-row">
                      <input
                        id="projectName"
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="Enter project name"
                        className="form-input"
                      />
                      <button className="project-add-btn" type="submit">Add Project</button>
                    </div>
                    <div className="project-dropdown-group" ref={adminProjectDropdownRef}>
                      <button
                        type="button"
                        id="admin-project-trigger"
                        className={`project-dropdown-trigger ${isAdminProjectDropdownOpen ? "active" : ""} ${!adminSelectedProject ? "placeholder" : ""}`}
                        onClick={() => {
                          setIsAdminProjectDropdownOpen((prev) => !prev);
                          setAdminProjectSearch("");
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={isAdminProjectDropdownOpen}
                      >
                        <span className="project-trigger-text">
                          {adminSelectedProject || "Select a project"}
                        </span>
                        <svg
                          className="project-dropdown-arrow"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points={isAdminProjectDropdownOpen ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                        </svg>
                      </button>

                      {isAdminProjectDropdownOpen && (
                        <div className="project-dropdown-menu" role="listbox">
                          <div className="project-search-wrapper">
                            <svg
                              className="project-search-icon"
                              viewBox="0 0 24 24"
                              width="15"
                              height="15"
                              fill="none"
                              stroke="#94a3b8"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                              type="text"
                              className="project-search-input"
                              placeholder="Search or enter project name..."
                              value={adminProjectSearch}
                              onChange={(e) => setAdminProjectSearch(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  if (trimmedAdminSearch && !hasAdminExactMatch) {
                                    addNewProject(trimmedAdminSearch);
                                  } else if (filteredAdminProjects.length === 1) {
                                    setAdminSelectedProject(filteredAdminProjects[0]);
                                    setProject(filteredAdminProjects[0]);
                                    setIsAdminProjectDropdownOpen(false);
                                    setAdminProjectSearch("");
                                  }
                                }
                              }}
                              autoFocus
                            />
                          </div>

                          <div className="project-options-list">
                            {filteredAdminProjects.length === 0 ? (
                              <div className="project-empty-item">
                                {trimmedAdminSearch
                                  ? `No existing projects match "${trimmedAdminSearch}"`
                                  : "No projects found"}
                              </div>
                            ) : (
                              filteredAdminProjects.map((name) => (
                                <div
                                  key={name}
                                  className={`project-option-row ${adminSelectedProject.toLowerCase() === name.toLowerCase() ? "selected" : ""}`}
                                >
                                  <button
                                    type="button"
                                    className="project-option-name"
                                    onClick={() => {
                                      setAdminSelectedProject(name);
                                      setProject(name);
                                      setIsAdminProjectDropdownOpen(false);
                                      setAdminProjectSearch("");
                                    }}
                                    role="option"
                                    aria-selected={adminSelectedProject.toLowerCase() === name.toLowerCase()}
                                  >
                                    {name}
                                  </button>
                                  {isAdmin && (
                                    <button
                                      type="button"
                                      className="project-option-delete-btn"
                                      onClick={(e) => handleDeleteProject(e, name)}
                                      title={`Delete ${name}`}
                                      aria-label={`Delete ${name}`}
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        width="12"
                                        height="12"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2.4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      >
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                              ))
                            )}

                            {trimmedAdminSearch && !hasAdminExactMatch && (
                              <button
                                type="button"
                                className="project-add-option-btn"
                                onClick={() => addNewProject(trimmedAdminSearch)}
                              >
                                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="12" y1="5" x2="12" y2="19" />
                                  <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                                <span>Add New Project: <strong>&ldquo;{trimmedAdminSearch}&rdquo;</strong></span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </form>
                </>
              )}

              {renderTaskForm(true)}
            </div>
          </div>
        </div>
      )}

      <Snackbar snack={snack} onClose={closeSnack} />
    </div>
  );
}

export default App;
