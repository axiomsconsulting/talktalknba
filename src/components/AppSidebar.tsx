import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Brain,
  Workflow,
  Database,
  PackageOpen,
  Settings2,
  Activity,
  Menu,
  X,
  LogOut,
  User as UserIcon,
  Shield,
  Palette,
  Plug,
} from "lucide-react";
import { cn } from "@/lib/utils";
import talktalkLogo from "@/assets/talktalk-logo.svg";
import { useAuth } from "@/data/auth";
import { useBrandingStore } from "@/data/brandingStore";

const NAV_ITEMS = [
  { to: "/", short: "ROI", label: "Commercial ROI", icon: LayoutDashboard },
  { to: "/explainability", short: "Explain", label: "Explainability", icon: Brain },
  { to: "/strategy", short: "Strategy", label: "NBA Strategy", icon: Workflow },
  { to: "/nba-rules", short: "Rules", label: "NBA Rules", icon: Settings2 },
  { to: "/products", short: "Catalogue", label: "Product Catalogue", icon: PackageOpen },
  { to: "/model", short: "Model", label: "Model Metrics", icon: Activity },
  { to: "/data", short: "Data", label: "Data Library", icon: Database },
] as const;

function BrandLockup() {
  const { settings } = useBrandingStore();
  const logo = settings?.logo_url ?? talktalkLogo;
  const name = settings?.app_name ?? "NBA Decisioning";
  const desc = settings?.app_description ?? "Churn prevention";
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
      <div
        className="rounded-lg p-1.5 shadow-[var(--shadow-glow)] transition-transform group-hover:scale-105 flex items-center justify-center"
        style={{ backgroundColor: settings?.accent_color ?? "var(--talktalk-lime)" }}
      >
        <img src={logo} alt={name} className="h-4 w-auto max-w-[80px] object-contain" />
      </div>
      <div className="leading-tight hidden sm:block">
        <div className="text-[13px] font-semibold tracking-tight text-foreground">{name}</div>
        <div className="text-[10px] text-muted-foreground -mt-0.5">{desc}</div>
      </div>
    </Link>
  );
}

function UserMenu() {
  const { profile, signOut, isAdmin, isApproverOrAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!profile) return null;
  const initials = (profile.display_name ?? profile.email).slice(0, 2).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-[oklch(1_0_0_/_0.6)] backdrop-blur-md pl-1 pr-3 py-1 hover:bg-foreground/5 transition-colors"
      >
        <span className="size-7 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center overflow-hidden">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="size-full object-cover" />
          ) : (
            initials
          )}
        </span>
        <span className="hidden sm:inline text-[12.5px] font-medium text-foreground max-w-[120px] truncate">
          {profile.display_name ?? profile.email}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-popover shadow-lg p-1.5 z-50">
          <div className="px-2.5 py-2 border-b border-border mb-1">
            <div className="text-sm font-medium truncate">{profile.display_name ?? "User"}</div>
            <div className="text-[11px] text-muted-foreground truncate">{profile.email}</div>
          </div>
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-foreground/80 hover:bg-foreground/5"
          >
            <UserIcon className="size-4" />
            Your profile
          </Link>
          {isApproverOrAdmin && (
            <Link
              to="/admin/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-foreground/80 hover:bg-foreground/5"
            >
              <Shield className="size-4" />
              User management
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/admin/branding"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-foreground/80 hover:bg-foreground/5"
            >
              <Palette className="size-4" />
              Branding & settings
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-foreground/80 hover:bg-foreground/5"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppSidebar() {
  const location = useLocation();
  const currentPath = location.pathname;
  const [open, setOpen] = useState(false);
  const { session } = useAuth();

  return (
    <header className="sticky top-0 z-40">
      <div className="absolute inset-0 backdrop-blur-xl bg-[oklch(1_0_0_/_0.65)] dark:bg-[oklch(0.18_0.03_250_/_0.65)] border-b border-border/60" />
      <div className="relative px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
        <BrandLockup />

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

        <div className="ml-auto flex items-center gap-2">
          {session ? (
            <UserMenu />
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3.5 py-1.5 text-[12.5px] font-medium"
            >
              <UserIcon className="size-3.5" />
              Sign in
            </Link>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="md:hidden inline-flex items-center justify-center rounded-full border border-border/60 bg-[oklch(1_0_0_/_0.6)] backdrop-blur-md p-2 text-foreground"
            aria-label="Toggle menu"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

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

export function MobileNav() {
  return null;
}
