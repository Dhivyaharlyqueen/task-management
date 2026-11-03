import { db } from "../firebase";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

const ADMIN_EMAIL = "admin@hepl.com";

/**
 * Checks if the given email has Admin privileges.
 */
export function isAdminEmail(email) {
  return String(email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

/**
 * Saves or updates remarks for an employee task.
 * Enforces role-based permissions: only Admin can add or edit remarks.
 * Associates remarks with both taskId and employeeId in the database.
 */
export async function saveTaskRemarks({
  taskId,
  employeeId,
  employeeName,
  userEmail,
  remarks,
  adminEmail,
}) {
  // Backend role-based permission check
  if (!isAdminEmail(adminEmail)) {
    throw new Error("Unauthorized: Only Admin can add or edit remarks.");
  }

  if (!taskId) {
    throw new Error("Task ID is required to save remarks.");
  }

  const cleanRemarks = String(remarks ?? "").trim();
  const now = Date.now();

  const remarksPayload = {
    taskId: String(taskId),
    employeeId: String(employeeId ?? "").trim(),
    employeeName: String(employeeName ?? "").trim(),
    userEmail: String(userEmail ?? "").trim().toLowerCase(),
    remarks: cleanRemarks,
    updatedAt: now,
    updatedBy: String(adminEmail).trim().toLowerCase(),
  };

  // 1. Store in dedicated 'task_remarks' collection indexed by taskId
  await setDoc(doc(db, "task_remarks", String(taskId)), remarksPayload, { merge: true });

  // 2. Also update the main task document in 'tasks' collection for real-time propagation
  try {
    await updateDoc(doc(db, "tasks", String(taskId)), {
      remarks: cleanRemarks,
      remarksUpdatedAt: now,
      remarksBy: String(adminEmail).trim().toLowerCase(),
    });
  } catch (err) {
    console.warn("Could not update task document directly, saved in task_remarks collection:", err);
  }

  return remarksPayload;
}

/**
 * Fetches the saved remarks for a task.
 * Enforces role-based access control:
 * - Admin can view any task's remarks.
 * - Employees can only view remarks for their own tasks.
 */
export async function getTaskRemarks(taskId, requesterEmail, taskUserEmail) {
  if (!taskId) return null;

  const email = String(requesterEmail || "").trim().toLowerCase();
  const isAdmin = isAdminEmail(email);

  // Permission check for employee user
  if (!isAdmin && taskUserEmail) {
    const ownerEmail = String(taskUserEmail).trim().toLowerCase();
    if (ownerEmail && email !== ownerEmail) {
      throw new Error("Unauthorized: Employees can only view remarks for their own tasks.");
    }
  }

  try {
    const snap = await getDoc(doc(db, "task_remarks", String(taskId)));
    if (snap.exists()) {
      const data = snap.data();
      // Secondary check: verify employee matches record owner
      if (!isAdmin && data.userEmail && data.userEmail !== email) {
        throw new Error("Unauthorized: Employees can only view remarks for their own tasks.");
      }
      return data;
    }
  } catch (err) {
    if (err.message && err.message.includes("Unauthorized")) {
      throw err;
    }
    console.error("Error fetching remarks from Firestore:", err);
  }

  return null;
}

