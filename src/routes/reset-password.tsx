import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set a new password — TalkTalk NBA" }] }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Listen for the PASSWORD_RECOVERY event fired by detectSessionInUrl
    // when supabase-js parses the recovery tokens out of the URL hash.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN" || session) {
        setReady(true);
      }
    });

    // Also poll the current session — covers the case where the listener
    // attaches after detectSessionInUrl has already processed the hash, or
    // the user lands here while already signed in (e.g. clicking the link
    // in another tab).
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setReady(true);
        return;
      }
      // If the URL still has a hash (token fragment), give supabase-js a
      // moment to process it.
      if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
        setTimeout(check, 250);
      } else {
        // No session and no recovery hash — link is invalid or expired.
        setError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
      }
    };
    void check();

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-sunken)] p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {ready
            ? "Enter your new password below."
            : "Validating your reset link…"}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pw">New password</Label>
            <Input
              id="pw"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!ready}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw2">Confirm password</Label>
            <Input
              id="pw2"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={!ready}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={busy || !ready}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
