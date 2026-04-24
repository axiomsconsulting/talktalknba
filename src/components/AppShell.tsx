import { AppSidebar } from "./AppSidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex flex-col bg-[var(--surface-sunken)]">
      <AppSidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
