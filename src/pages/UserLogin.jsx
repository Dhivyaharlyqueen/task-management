
import { useState } from "react";
import "../styles/UserLogin.css";

function UserLogin() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!identifier.trim() || !password) {
      alert("Please enter your Employee ID or Email ID and Password.");
      return;
    }

    // Connect your existing User Login API here.
    // Do not change the existing Admin Login API.
    console.log("User login submitted");
  };

  return (
    <div className="user-login-page">
      <div className="user-login-card">
        <img
          src="/dog.png"
          alt="Cute puppy"
          className="user-login-dog"
        />

        <h1>Welcome back, friend.</h1>
        <p className="user-login-subtitle">
          Sign in to continue.
        </p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="identifier">
            Employee ID or Email ID
          </label>

          <div className="user-login-input">
            <span>♙</span>
            <input
              id="identifier"
              type="text"
              placeholder="Enter your Employee ID or Email ID"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <label htmlFor="password">Password</label>

          <div className="user-login-input">
            <span>🔒</span>
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
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          <button type="submit" className="user-login-button">
            Login <span>→</span>
          </button>
        </form>
      </div>
    </div>
  );
}

export default UserLogin;
