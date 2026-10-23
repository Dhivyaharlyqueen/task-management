import { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../firebase";
import Snackbar, { useSnackbar } from "./Snackbar";
import "../style/Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          <span className="visual-icon">✓</span>
          <h1>Work. Track. Achieve.</h1>
          <p>
            Manage employee tasks and keep your
            team's progress organized in one place.
          </p>
          <div className="visual-footer">EMPLOYEE TASK TRACKER</div>
        </div>
      </div>

      <div className="login-form-side">
        <form className="login-card" onSubmit={handleLogin}>
          <span className="login-tag">WELCOME BACK</span>
          <h2>Sign in</h2>
          <p className="login-description">
            Enter your details to access your dashboard.
          </p>

          <label>Email</label>
          <input
            type="email"
            placeholder="Enter email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label>Password</label>
          <input
            type="password"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" className="login-button">
            Sign In →
          </button>

          <p className="login-note">Employee Task Tracker</p>
        </form>
      </div>
      <Snackbar snack={snack} onClose={closeSnack} />
    </div>
  );
}

export default Login;
