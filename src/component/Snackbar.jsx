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

  const isSuccess = snack.type === "success";
  const isError = snack.type === "error";

  return (
    <div className={`snackbar ${snack.type}`} role="status">
      <div className="snackbar-icon-group" aria-hidden="true">
        {isSuccess && (
          <svg
            className="snackbar-rays"
            width="10"
            height="18"
            viewBox="0 0 10 18"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line x1="8.5" y1="3" x2="1.5" y2="1.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
            <line x1="8.5" y1="9" x2="1" y2="9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
            <line x1="8.5" y1="15" x2="1.5" y2="16.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
        <div className="snackbar-badge">
          {isSuccess ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : isError ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="16" x2="12" y2="11" />
              <line x1="12" y1="7" x2="12.01" y2="7" />
            </svg>
          )}
        </div>
      </div>

      <span className="snackbar-text">{snack.message}</span>

      <button
        type="button"
        className="snackbar-close"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
