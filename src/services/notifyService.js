import { addDoc, collection } from "firebase/firestore";
import { db } from "../firebase";

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/** Unique login emails, skipping blanks and the person who triggered the event. */
export function uniqueEmails(values, exceptEmail) {
  const skip = normalizeEmail(exceptEmail);
  const seen = new Set();
  const list = [];
  values.flat(2).forEach((value) => {
    const email = normalizeEmail(value);
    if (!email.includes("@") || email === skip || seen.has(email)) return;
    seen.add(email);
    list.push(email);
  });
  return list;
}

/** One Firestore document per recipient. Each user's bell listens for their email. */
export async function notifyRecipients(emails, payload, exceptEmail) {
  const recipients = uniqueEmails(emails, exceptEmail);
  if (!recipients.length) return;
  const createdAt = payload.createdAt || Date.now();
  await Promise.all(
    recipients.map((recipientEmail) =>
      addDoc(collection(db, "notifications"), {
        ...payload,
        recipientEmail,
        read: false,
        createdAt,
      })
    )
  );
}
