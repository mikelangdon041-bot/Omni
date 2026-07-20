"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [remember, setRemember] = useState(true);
  const isRegister = mode === "register";

  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotUsername, setForgotUsername] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Not a <form> submit handler — this lives inside the outer login <form>,
  // and HTML forms can't nest, so it's wired up via button click / Enter key.
  async function resetMyPassword() {
    if (!forgotUsername.trim() || forgotBusy) return;
    setForgotBusy(true);
    setForgotError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username: forgotUsername }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForgotError(data.error || "Could not reset password.");
        return;
      }
      // Fill the real login form with the fresh credentials so the user can
      // just hit "Sign in" — no re-typing or copy-pasting the new password.
      setUsername(data.username);
      setPassword(data.tempPassword);
      setResetPassword(data.tempPassword);
      setShowPassword(true);
      setForgotOpen(false);
    } catch {
      setForgotError("Network error. Please try again.");
    } finally {
      setForgotBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(e.currentTarget);
    const payload = {
      username: String(form.get("username") || ""),
      password: String(form.get("password") || ""),
      displayName: String(form.get("displayName") || ""),
      company: String(form.get("company") || ""),
      rememberMe: remember,
    };

    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setPending(false);
        return;
      }

      if (data.signedIn === false) {
        router.push("/login");
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {isRegister ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isRegister
            ? "Pick a username and password — no email needed."
            : "Sign in with your username and password."}
        </p>
      </div>

      {isRegister && (
        <>
          <Field
            label="Company"
            name="company"
            type="text"
            autoComplete="organization"
            placeholder="Acme Medical"
          />
          <Field
            label="Display name (optional)"
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder="Dr. Jane Smith"
          />
        </>
      )}

      <Field
        label="Username"
        name="username"
        type="text"
        autoComplete="username"
        placeholder="jsmith"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Password</span>
        <span className="relative flex items-center">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={isRegister ? "new-password" : "current-password"}
            placeholder={isRegister ? "At least 8 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 pr-10 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2.5 text-muted hover:text-ink"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      </label>

      {resetPassword && (
        <div className="rounded-lg bg-status-success/10 px-3 py-2 text-xs text-status-success">
          <p>Your new password is filled in below — write it down if you want a copy:</p>
          <p className="mt-1 select-all break-all rounded bg-surface px-2 py-1 font-mono text-sm text-ink">
            {resetPassword}
          </p>
        </div>
      )}

      {!isRegister && (
        <>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            Remember me on this device
          </label>

          {forgotOpen ? (
            <div className="rounded-lg border border-border bg-canvas p-3">
              <p className="mb-2 text-xs text-ink">
                Enter your username and we&apos;ll issue a fresh password right here — no email
                needed.
              </p>
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={forgotUsername}
                  onChange={(e) => setForgotUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), resetMyPassword())}
                  placeholder="Username"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={resetMyPassword}
                  disabled={forgotBusy || !forgotUsername.trim()}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-fg disabled:opacity-60"
                >
                  {forgotBusy ? "…" : "Reset"}
                </button>
              </div>
              {forgotError && (
                <p className="mt-2 text-xs text-status-error">{forgotError}</p>
              )}
              <button
                type="button"
                onClick={() => setForgotOpen(false)}
                className="mt-2 text-xs text-muted hover:underline"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="text-left text-xs text-muted hover:text-primary hover:underline"
            >
              Forgot your password?
            </button>
          )}
        </>
      )}

      {error && (
        <p className="rounded-lg bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
      >
        {pending
          ? isRegister
            ? "Creating account…"
            : "Signing in…"
          : isRegister
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="text-center text-sm text-muted">
        {isRegister ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link
              href="/register"
              className="font-medium text-primary hover:underline"
            >
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        {...props}
        className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}
