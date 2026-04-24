import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, X, Loader2, Shield, UserCog, Eye, ClipboardCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole, type AccountStatus } from "@/data/auth";

export const Route = createFileRoute("/admin/users")({
  head: () => ({ meta: [{ title: "User management — TalkTalk NBA" }] }),
  component: UsersAdminPage,
});

interface Row {
  user_id: string;
  email: string;
  display_name: string | null;
  status: AccountStatus;
  approved_at: string | null;
  created_at: string;
  roles: AppRole[];
}

const ROLE_META: Record<AppRole, { label: string; icon: typeof Shield; tone: string }> = {
  admin: { label: "Admin", icon: Shield, tone: "bg-primary/10 text-primary border-primary/30" },
  operator: { label: "Operator", icon: UserCog, tone: "bg-chart-4/15 text-chart-4 border-chart-4/30" },
  analyst: { label: "Analyst", icon: Eye, tone: "bg-muted text-muted-foreground border-border" },
  approver: { label: "Approver", icon: ClipboardCheck, tone: "bg-success/15 text-success border-success/30" },
};

function UsersAdminPage() {
  const { isAdmin, isApproverOrAdmin, loading } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id,email,display_name,status,approved_at,created_at")
      .order("created_at", { ascending: false });
    const { data: roleRows } = await supabase.from("user_roles").select("user_id,role");
    const byUser = new Map<string, AppRole[]>();
    (roleRows ?? []).forEach((r: { user_id: string; role: AppRole }) => {
      const arr = byUser.get(r.user_id) ?? [];
      arr.push(r.role);
      byUser.set(r.user_id, arr);
    });
    setRows(
      (profs ?? []).map((p) => ({
        ...(p as Omit<Row, "roles">),
        roles: byUser.get(p.user_id) ?? [],
      }))
    );
  };

  useEffect(() => {
    if (!loading && isApproverOrAdmin) void load();
  }, [loading, isApproverOrAdmin]);

  if (loading) return null;
  if (!isApproverOrAdmin) return <Navigate to="/" />;

  const setStatus = async (userId: string, status: AccountStatus) => {
    setBusyId(userId);
    const patch: Record<string, unknown> = { status };
    if (status === "active") patch.approved_at = new Date().toISOString();
    await supabase.from("profiles").update(patch).eq("user_id", userId);
    // Default new approved users to "analyst" so they have access immediately
    if (status === "active") {
      const existing = rows?.find((r) => r.user_id === userId);
      if (existing && existing.roles.length === 0) {
        await supabase.from("user_roles").insert({ user_id: userId, role: "analyst" });
      }
    }
    await load();
    setBusyId(null);
  };

  const toggleRole = async (userId: string, role: AppRole, has: boolean) => {
    setBusyId(userId);
    if (has) {
      await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
    } else {
      await supabase.from("user_roles").insert({ user_id: userId, role });
    }
    await load();
    setBusyId(null);
  };

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  const others = (rows ?? []).filter((r) => r.status !== "pending");

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="User management"
        description="Approve or reject signup requests, and assign roles. Operators can edit data and rules; Analysts have read-only access; Approvers can review signups."
      />

      <div className="px-5 sm:px-8 lg:px-10 py-6 lg:py-8 space-y-8">
        {/* Pending queue */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Awaiting approval ({pending.length})
          </h2>
          {!rows ? (
            <Card>
              <CardContent className="py-8 flex justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </CardContent>
            </Card>
          ) : pending.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No pending requests.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {pending.map((r) => (
                <Card key={r.user_id}>
                  <CardContent className="py-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.display_name ?? r.email}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Requested {new Date(r.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(r.user_id, "rejected")}
                        disabled={busyId === r.user_id}
                      >
                        <X className="size-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setStatus(r.user_id, "active")}
                        disabled={busyId === r.user_id}
                      >
                        {busyId === r.user_id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                        Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Active / rejected with role management */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            All users ({others.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {others.map((r) => (
                  <div
                    key={r.user_id}
                    className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6"
                  >
                    <div className="min-w-0 lg:w-64">
                      <div className="font-medium truncate">{r.display_name ?? r.email}</div>
                      <div className="text-xs text-muted-foreground truncate">{r.email}</div>
                    </div>
                    <div className="shrink-0">
                      <Badge
                        variant="outline"
                        className={
                          r.status === "active"
                            ? "border-success/40 text-success"
                            : "border-destructive/40 text-destructive"
                        }
                      >
                        {r.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {(Object.keys(ROLE_META) as AppRole[]).map((role) => {
                        const has = r.roles.includes(role);
                        const meta = ROLE_META[role];
                        const Icon = meta.icon;
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => isAdmin && toggleRole(r.user_id, role, has)}
                            disabled={!isAdmin || busyId === r.user_id}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-opacity ${
                              has ? meta.tone : "border-dashed border-border text-muted-foreground/60 hover:opacity-100"
                            } ${!isAdmin ? "cursor-default" : "cursor-pointer"} ${has ? "" : "opacity-60"}`}
                            title={isAdmin ? (has ? `Remove ${meta.label}` : `Add ${meta.label}`) : "Admin only"}
                          >
                            <Icon className="size-3" />
                            {meta.label}
                          </button>
                        );
                      })}
                    </div>
                    {r.status === "rejected" && isApproverOrAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(r.user_id, "active")}
                        disabled={busyId === r.user_id}
                      >
                        Re-activate
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          {!isAdmin && (
            <p className="mt-3 text-xs text-muted-foreground">
              Role assignment requires the Admin role.
            </p>
          )}
        </section>
      </div>
    </AppShell>
  );
}
