"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth" : "/api/signup";
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json() as { success: boolean; error?: string };

      if (!data.success) {
        setError(data.error ?? `${mode === "login" ? "Login" : "Sign up"} failed`);
        return;
      }

      if (mode === "signup") {
        setSuccess("Account created! Redirecting…");
        setTimeout(() => router.push("/dashboard"), 800);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
    setSuccess("");
    setConfirmPassword("");
  }

  return (
    <div className="login-root">
      <div className="login-card animate-in">
        {/* Logo */}
        <div className="login-logo">
          auto<em>mate</em>
        </div>

        {/* Tab toggle */}
        <div style={{
          display: "flex",
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-sm)",
          padding: "3px",
          marginBottom: "var(--sp-8)",
          border: "1px solid var(--border)",
        }}>
          {(["login", "signup"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              style={{
                flex: 1,
                padding: "8px",
                borderRadius: "calc(var(--radius-sm) - 2px)",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-display)",
                fontWeight: 600,
                fontSize: "0.8rem",
                letterSpacing: "0.01em",
                transition: "all 0.2s ease",
                background: mode === m ? "var(--accent)" : "transparent",
                color: mode === m ? "#fff" : "var(--text-secondary)",
                boxShadow: mode === m ? "0 0 16px rgba(88,101,242,0.3)" : "none",
              }}
            >
              {m === "login" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} id="auth-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label">Email</label>
            <input
              id="email"
              type="email"
              className="input"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "signup" ? 8 : undefined}
            />
          </div>

          {mode === "signup" && (
            <div className="form-group animate-in">
              <label htmlFor="confirm-password" className="form-label">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
          )}

          {error && <div className="error-msg" role="alert">{error}</div>}
          {success && (
            <div style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              color: "var(--green)",
              marginTop: "var(--sp-3)",
              padding: "var(--sp-3) var(--sp-4)",
              background: "var(--green-dim)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid rgba(35,209,139,0.2)",
            }}>
              {success}
            </div>
          )}

          <button
            id="auth-submit"
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "var(--sp-6)" }}
            disabled={loading}
          >
            {loading
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Sign in →" : "Create account →")}
          </button>
        </form>

        {/* Helper hint */}
        <p style={{
          textAlign: "center",
          marginTop: "var(--sp-6)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
        }}>
          {mode === "login"
            ? <>No account?{" "}<button type="button" onClick={() => switchMode("signup")} style={{ background: "none", border: "none", color: "var(--accent-bright)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>Create one</button></>
            : <>Already have one?{" "}<button type="button" onClick={() => switchMode("login")} style={{ background: "none", border: "none", color: "var(--accent-bright)", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "0.7rem" }}>Sign in</button></>
          }
        </p>
      </div>
    </div>
  );
}
