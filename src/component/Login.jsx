import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import Snackbar, { useSnackbar } from "./Snackbar";
import "../style/Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { snack, showSnack, closeSnack } = useSnackbar();

  async function handleLogin(e) {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      showSnack("Invalid email or password.", "error");
    }
  }

  return (
    <div className="login-page">
      <div className="login-visual">
        <div className="visual-content">
          <div className="login-brand">
            <span className="login-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path d="M8 7h8M8 12h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </span>
            <span>Employee Task Tracker</span>
          </div>
          <h1>Track work in one place.</h1>
          <p>Add tasks, keep the list up to date, and sync them with Google Sheets.</p>
          <ul className="login-points">
            <li>Record employee ID, name, and completed work</li>
            <li>Review the full task list without leaving the page</li>
            <li>Send updates to Google Sheets when you are ready</li>
          </ul>
        </div>
      </div>

      <div className="login-form-side">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="login-card-head">
            <span className="login-mark login-mark-light" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path d="M8 7h8M8 12h8M8 17h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <rect x="4" y="3.5" width="16" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </span>
            <div>
              <h2>Sign in</h2>
              <p className="login-description">Use your work account to open the tracker.</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <div className="field-control">
              <input
                id="email"
                type="email"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="field-control">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="field-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" className="login-button">
            Sign in
          </button>
        </form>
      </div>
      <Snackbar snack={snack} onClose={closeSnack} />
    </div>
  );
}

export default Login;
