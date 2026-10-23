import { useCallback, useEffect, useRef, useState } from "react";
import "../style/Snackbar.css";

export function useSnackbar() {
  const [snack, setSnack] = useState(null);
  const timer = useRef(null);

  const closeSnack = useCallback(() => {
    clearTimeout(timer.current);
    setSnack(null);
  }, []);

  const showSnack = useCallback((message, type = "info") => {
    setSnack({ message, type });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSnack(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { snack, showSnack, closeSnack };
}

export default function Snackbar({ snack, onClose }) {
  if (!snack) return null;

  return (
    <div className={`snackbar ${snack.type}`} role="status">
      <span>{snack.message}</span>
      <button type="button" className="snackbar-close" onClick={onClose} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
