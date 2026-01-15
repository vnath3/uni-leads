"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const redirectTarget =
    redirectParam && redirectParam.startsWith("/") && !redirectParam.startsWith("//")
      ? redirectParam
      : "/super";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        router.replace(redirectTarget);
      }
    });

    return () => {
      active = false;
    };
  }, [router, redirectTarget]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }

    setLoading(true);
    if (mode === "signup") {
      const emailRedirectTo =
        typeof window !== "undefined"
          ? new URL(redirectTarget, window.location.origin).toString()
          : undefined;
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: emailRedirectTo ? { emailRedirectTo } : undefined
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        setInfo("Account created. Check your email to confirm and continue.");
        setLoading(false);
        return;
      }

      router.replace(redirectTarget);
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      router.replace(redirectTarget);
    }
  };

  const title = mode === "signup" ? "Create account" : "Sign in";
  const helperText =
    mode === "signup"
      ? "Create an account to accept your invite."
      : "Use your platform account to continue.";
  const toggleLabel =
    mode === "signup" ? "Back to sign in" : "Create an account";

  return (
    <div className="card">
      <h1>{title}</h1>
      <p className="muted">{helperText}</p>
      {error && <div className="error">{error}</div>}
      {info && <div className="notice">{info}</div>}
      <form onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
          />
        </label>
        <button className="button" type="submit" disabled={loading}>
          {loading
            ? mode === "signup"
              ? "Creating account..."
              : "Signing in..."
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </button>
      </form>
      <div className="tag-list" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            setMode((current) => (current === "signup" ? "signin" : "signup"))
          }
        >
          {toggleLabel}
        </button>
      </div>
    </div>
  );
}
