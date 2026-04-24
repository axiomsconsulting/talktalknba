import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { Loader2, ShieldAlert, Mail, LogOut } from "lucide-react";
import { useAuth } from "@/data/auth";
import { Button } from "@/components/ui/button";

const PUBLIC_PATHS = new Set(["/login", "/reset-password"]);

/**
 * Wraps the app: redirects to /login if no session; shows a holding screen
 * for pending users; lets active users through.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const path = router.state.location.pathname;
  const isPublic = PUBLIC_PATHS.has(path);

  useEffect(() => {
    if (loading) return;
    if (!session && !isPublic) {
      navigate({ to: "/login" });
    }
  }, [loading, session, isPublic, navigate]);

  if (isPublic) return <>{children}</>;

  if (loading || (!session && !isPublic)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (session && profile && profile.status !== "active") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface-sunken)] p-6">
        <div className="max-w-md text-center space-y-4">
          <div className="mx-auto size-14 rounded-full bg-warning/15 flex items-center justify-center">
            {profile.status === "pending" ? (
              <Mail className="size-6 text-warning" />
            ) : (
              <ShieldAlert className="size-6 text-destructive" />
            )}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {profile.status === "pending" ? "Awaiting approval" : "Access denied"}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {profile.status === "pending"
              ? "Your account is waiting for an administrator to approve access. You'll receive an email once it's been reviewed."
              : "Your access request was rejected. If you believe this is in error, please contact your administrator."}
          </p>
          <div className="text-xs text-muted-foreground pt-2">
            Signed in as <span className="font-medium text-foreground">{profile.email}</span>
          </div>
          <Button variant="outline" onClick={signOut} className="mt-2">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
