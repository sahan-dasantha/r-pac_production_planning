import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Login.css";

function PressSheet() {
  const cols = 4;
  const rows = 3;
  const ups = Array.from({ length: cols * rows }, (_, i) => ({
    i,
    x: 51 + (i % cols) * 56,
    y: 42 + Math.floor(i / cols) * 54,
  }));

  return (
    <svg
      className="brand-sheet"
      viewBox="0 0 320 236"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="sheet-edge" x="40" y="30" width="240" height="180" />
      {ups.map((u) => (
        <rect
          key={u.i}
          className="up"
          x={u.x}
          y={u.y}
          width="50"
          height="48"
          rx="2"
          style={{ "--i": u.i }}
        />
      ))}
      <g className="marks">
        <path d="M40 18v8M28 30h8" />
        <path d="M280 18v8M284 30h8" />
        <path d="M40 214v8M28 210h8" />
        <path d="M280 214v8M284 210h8" />
        <circle cx="160" cy="16" r="6" />
        <path d="M160 6v20M150 16h20" />
      </g>
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <aside className="login-brand">
        <div className="brand-name">Offset Planner</div>
        <PressSheet />
        <p className="brand-copy">
          Look up a reference, set its UPs and keep the press schedule accurate.
        </p>
      </aside>

      <main className="login-panel">
        <form className="login-form" onSubmit={handleSubmit}>
          <h1>Sign in</h1>
          <p className="subtitle">Enter your planner account details.</p>

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />

          <label htmlFor="password">Password</label>
          <div className="pw-field">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          <button type="submit" className="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </main>
    </div>
  );
}
