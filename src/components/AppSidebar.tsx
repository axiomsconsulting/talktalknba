import { useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Brain,
  Workflow,
  Database,
  PackageOpen,
  Settings2,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import talktalkLogo from "@/assets/talktalk-logo.svg";

const NAV_ITEMS = [
  { to: "/", short: "ROI", label: "Commercial ROI", icon: LayoutDashboard },
  { to: "/explainability", short: "Explain", label: "Explainability", icon: Brain },
  { to: "/strategy", short: "Strategy", label: "NBA Strategy", icon: Workflow },
  { to: "/nba-rules", short: "Rules", label: "NBA Rules", icon: Settings2 },
  { to: "/products", short: "Catalogue", label: "Product Catalogue", icon: PackageOpen },
  { to: "/data", short: "Data", label: "Data Library", icon: Database },
] as const;

function BrandLockup() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
      <div className="rounded-lg bg-talktalk-lime p-1.5 shadow-[var(--shadow-glow)] transition-transform group-hover:scale-105">
        <img src={talktalkLogo} alt="TalkTalk" className="h-4 w-auto" />
      </div>
      <div className="leading-tight hidden sm:block">
        <div className="text-[13px] font-semibold tracking-tight text-foreground">
          NBA Decisioning
        </div>
        <div className="text-[10px] text-muted-foreground -mt-0.5">Churn prevention</div>
      </div>
    </Link>
  );
}

/**
 * Top navigation: Apple-style glass pill. Sticky, blurred background,
 * pill items condense to a burger menu on narrow screens.
 */
export function AppSidebar() {
  const location = useLocation();
  const currentPath = location.pathname;
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40">
      {/* Frosted backdrop */}
      <div className="absolute inset-0 backdrop-blur-xl bg-[oklch(1_0_0_/_0.65)] dark:bg-[oklch(0.18_0.03_250_/_0.65)] border-b border-border/60" />

      <div className="relative px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
        <BrandLockup />

        {/* Glass pill nav — desktop / wide tablet */}
        <nav className="hidden lg:flex items-center mx-auto rounded-full border border-border/60 bg-[oklch(1_0_0_/_0.55)] backdrop-blur-md shadow-[0_4px_20px_-8px_oklch(0.16_0.02_250/0.18)] p-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-[var(--shadow-md)]"
                    : "text-foreground/70 hover:text-foreground hover:bg-foreground/5"
                )}
              >
                <Icon className="size-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mid-width condensed pill — short labels only */}
        <nav className="hidden md:flex lg:hidden items-center mx-auto rounded-full border border-border/60 bg-[oklch(1_0_0_/_0.55)] backdrop-blur-md p-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11.5px] font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/70 hover:text-foreground hover:bg-foreground/5"
                )}
                title={item.label}
              >
                <Icon className="size-3.5" />
                <span>{item.short}</span>
              </Link>
            );
          })}
        </nav>

        {/* Mobile burger trigger */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="md:hidden ml-auto inline-flex items-center justify-center rounded-full border border-border/60 bg-[oklch(1_0_0_/_0.6)] backdrop-blur-md p-2 text-foreground"
          aria-label="Toggle menu"
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>

        <div className="hidden md:block ml-auto" />
      </div>

      {/* Mobile dropdown sheet */}
      {open && (
        <div className="md:hidden relative border-b border-border/60 bg-[oklch(1_0_0_/_0.92)] backdrop-blur-xl">
          <nav className="px-4 py-3 grid grid-cols-2 gap-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = currentPath === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground/80 border-border hover:bg-foreground/5"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}

// Kept export to avoid breaking AppShell imports — renders nothing now since
// the top header above is fully responsive (incl. mobile burger).
export function MobileNav() {
  return null;
}
