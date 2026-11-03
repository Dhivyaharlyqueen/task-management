/**
 * localNotifService.js
 *
 * localStorage-based notification cache + BroadcastChannel tab sync.
 *
 * IMPORTANT LIMITATION:
 *   localStorage and BroadcastChannel are scoped to a single browser on a
 *   single device. They cannot deliver notifications to another employee's
 *   computer. Cross-device delivery requires the existing Firestore backend.
 *
 * This module is used as a:
 *   1. Offline cache — notifications survive a page refresh without waiting
 *      for Firestore's first snapshot.
 *   2. Same-browser tab sync — when one tab marks a notification read, all
 *      other open tabs of the same browser update immediately via
 *      BroadcastChannel (no extra Firestore round-trip needed in the UI).
 */

const CHANNEL_NAME = 'task_tracker_notifs';
const storageKey = (email) => `notifs_${String(email || '').toLowerCase()}`;

// ── localStorage helpers ──────────────────────────────────────────────────────

/** Read cached notifications for a user from localStorage. */
export function loadCachedNotifs(email) {
  try {
    const raw = localStorage.getItem(storageKey(email));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Persist the current notification list to localStorage. */
export function saveCachedNotifs(email, notifs) {
  try {
    localStorage.setItem(storageKey(email), JSON.stringify(notifs));
  } catch {
    // Quota exceeded or private-browsing restriction — silently ignore.
  }
}

/** Clear cached notifications for a user (e.g. on logout). */
export function clearCachedNotifs(email) {
  try {
    localStorage.removeItem(storageKey(email));
  } catch {
    // ignore
  }
}

// ── BroadcastChannel tab-sync ─────────────────────────────────────────────────

/**
 * Open a BroadcastChannel for notification sync across tabs of the same
 * browser. Returns { channel, close }.
 *
 * Message shape posted to the channel:
 *   { type: 'NOTIFS_UPDATED', email: string, notifs: Notification[] }
 *
 * @param {string}   email      - The logged-in user's email (used to scope messages).
 * @param {Function} onUpdate   - Called with the new notifs array when another
 *                                tab broadcasts an update.
 * @returns {{ broadcast: Function, close: Function }}
 */
export function openNotifChannel(email, onUpdate) {
  if (typeof BroadcastChannel === 'undefined') {
    // BroadcastChannel not supported (e.g. Safari < 15.4) — no-op.
    return { broadcast: () => {}, close: () => {} };
  }

  const channel = new BroadcastChannel(CHANNEL_NAME);

  channel.onmessage = (event) => {
    const { type, email: msgEmail, notifs } = event.data || {};
    if (type === 'NOTIFS_UPDATED' && msgEmail === String(email || '').toLowerCase()) {
      onUpdate(notifs);
    }
  };

  /**
   * Broadcast the latest notification list to all other tabs.
   * Call this whenever the Firestore snapshot updates the local state.
   */
  function broadcast(notifs) {
    try {
      channel.postMessage({
        type: 'NOTIFS_UPDATED',
        email: String(email || '').toLowerCase(),
        notifs,
      });
    } catch {
      // ignore
    }
  }

  function close() {
    channel.close();
  }

  return { broadcast, close };
}
