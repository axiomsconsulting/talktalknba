import { AppSidebar, MobileNav } from "./AppSidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex bg-[var(--surface-sunken)]">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <MobileNav />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
