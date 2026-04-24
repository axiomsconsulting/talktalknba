import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/data/auth";
import talktalkLogo from "@/assets/talktalk-logo.svg";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — TalkTalk NBA" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await refresh();
        navigate({ to: "/" });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setMsg({
          kind: "ok",
          text: "Account created. Check your email to verify, then sign in. An admin will approve access.",
        });
        setMode("signin");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setMsg({ kind: "ok", text: "If an account exists, a reset link is on its way." });
      }
    } catch (err: unknown) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setMsg({ kind: "err", text: String(result.error) });
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-[var(--surface-sunken)]">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 bg-[var(--gradient-hero)] relative overflow-hidden">
        <div className="flex items-center gap-3 relative z-10">
          <div className="rounded-lg bg-talktalk-ink p-2">
            <img src={talktalkLogo} alt="TalkTalk" className="h-5 w-auto invert" />
          </div>
          <div className="text-talktalk-ink font-semibold tracking-tight">NBA Decisioning</div>
        </div>
        <div className="relative z-10 max-w-md">
          <h1 className="text-4xl font-semibold tracking-tight text-talktalk-ink leading-tight">
            Retention decisioning, built for accountable revenue.
          </h1>
          <p className="mt-4 text-talktalk-ink/70 leading-relaxed">
            ROI modelling, transparent SHAP explainability and end-to-end Next Best Action
            orchestration — all in one console.
          </p>
        </div>
        <div className="relative z-10 text-xs text-talktalk-ink/60">
          © TalkTalk · Data Science · Model v2.4
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex items-center gap-2.5">
            <div className="rounded-lg bg-talktalk-lime p-1.5">
              <img src={talktalkLogo} alt="TalkTalk" className="h-4 w-auto" />
            </div>
            <span className="font-semibold tracking-tight">NBA Decisioning</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">
            {mode === "signin" && "Sign in"}
            {mode === "signup" && "Request access"}
            {mode === "forgot" && "Reset your password"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {mode === "signin" && "Welcome back. Use email or Google."}
            {mode === "signup" &&
              "New accounts require admin approval before access is granted."}
            {mode === "forgot" && "Enter your email and we'll send a reset link."}
          </p>

          {msg && (
            <div
              className={`mt-4 rounded-md border px-3 py-2 text-xs ${
                msg.kind === "ok"
                  ? "border-success/30 bg-success/10 text-success-foreground"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              {msg.text}
            </div>
          )}

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Morgan"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            {mode !== "forgot" && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => setMode("forgot")}
                      className="text-xs text-primary hover:underline"
                    >
                      Forgot?
                    </button>
                  )}
                </div>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "signin" && "Sign in"}
              {mode === "signup" && "Request access"}
              {mode === "forgot" && "Send reset link"}
            </Button>
          </form>

          {mode !== "forgot" && (
            <>
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                  <span className="bg-[var(--surface-sunken)] px-2 text-muted-foreground">
                    or continue with
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={google}
                disabled={busy}
              >
                <svg className="size-4" viewBox="0 0 48 48" aria-hidden>
                  <path
                    fill="#FFC107"
                    d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"
                  />
                  <path
                    fill="#FF3D00"
                    d="M6.3 14.7l6.6 4.8C14.7 15.7 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
                  />
                  <path
                    fill="#4CAF50"
                    d="M24 44c5.3 0 10.1-2 13.7-5.3l-6.3-5.3c-2 1.5-4.6 2.6-7.4 2.6-5.2 0-9.6-3.3-11.2-8L6.3 33C9.6 39.6 16.3 44 24 44z"
                  />
                  <path
                    fill="#1976D2"
                    d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4 5.4l6.3 5.3C41.5 36 44 30.5 44 24c0-1.3-.1-2.6-.4-3.5z"
                  />
                </svg>
                Continue with Google
              </Button>
            </>
          )}

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" && (
              <>
                Need access?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="text-primary hover:underline font-medium"
                >
                  Request an account
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already have access?{" "}
                <button
                  onClick={() => setMode("signin")}
                  className="text-primary hover:underline font-medium"
                >
                  Sign in
                </button>
              </>
            )}
            {mode === "forgot" && (
              <button
                onClick={() => setMode("signin")}
                className="text-primary hover:underline font-medium"
              >
                Back to sign in
              </button>
            )}
          </div>

          <Link
            to="/"
            className="mt-8 block text-center text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to app
          </Link>
        </div>
      </div>
    </div>
  );
}
