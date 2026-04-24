import { Link, useLocation } from "@tanstack/react-router";
import { LayoutDashboard, Brain, Workflow, Sparkles, Database } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  {
    to: "/",
    label: "Commercial ROI",
    sub: "Executive summary",
    icon: LayoutDashboard,
  },
  {
    to: "/explainability",
    label: "Explainability",
    sub: "Model transparency",
    icon: Brain,
  },
  {
    to: "/strategy",
    label: "NBA Strategy",
    sub: "Architecture & treatments",
    icon: Workflow,
  },
  {
    to: "/data",
    label: "Data Library",
    sub: "Uploads & mapping",
    icon: Database,
  },
] as const;

export function AppSidebar() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <aside className="hidden md:flex md:w-72 lg:w-80 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
      <div className="px-6 pt-7 pb-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-primary to-primary-deep flex items-center justify-center shadow-[var(--shadow-glow)]">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">TalkTalk NBA</div>
            <div className="text-xs text-sidebar-foreground/60">Retention Decisioning</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
          Workspaces
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = currentPath === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "group flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground shadow-sm border border-sidebar-border"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <div
                className={cn(
                  "mt-0.5 size-8 rounded-md flex items-center justify-center shrink-0 transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-sidebar-accent/60 text-sidebar-foreground/70 group-hover:bg-sidebar-accent"
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="font-medium">{item.label}</span>
                <span className="text-[11px] text-sidebar-foreground/55">{item.sub}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 pb-6 pt-4 border-t border-sidebar-border">
        <div className="rounded-lg bg-sidebar-accent/40 border border-sidebar-border p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-primary-glow">
            Model v2.4 · Live
          </div>
          <div className="mt-1 text-xs text-sidebar-foreground/70 leading-snug">
            Trained on 3.5M customers · refreshed weekly via Databricks pipeline.
          </div>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const location = useLocation();
  return (
    <nav className="md:hidden flex border-b border-border bg-card">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
              active ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
