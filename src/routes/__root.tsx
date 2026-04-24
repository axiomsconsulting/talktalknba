import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/data/auth";
import { AuthGate } from "@/components/AuthGate";
import { useBrandingStore, applyBrandingToDocument } from "@/data/brandingStore";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TalkTalk NBA — Retention Decisioning" },
      {
        name: "description",
        content:
          "Enterprise Next Best Action churn-prevention platform for TalkTalk: ROI modelling, transparent AI explainability and end-to-end decisioning architecture.",
      },
      { name: "author", content: "TalkTalk · Data Science" },
      { property: "og:title", content: "TalkTalk NBA — Retention Decisioning" },
      {
        property: "og:description",
        content:
          "Live ROI modelling, model explainability and the architecture behind TalkTalk's churn-prevention engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function BrandingHydrator() {
  const { settings, load } = useBrandingStore();
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    applyBrandingToDocument(settings);
  }, [settings]);
  return null;
}

function RootComponent() {
  return (
    <AuthProvider>
      <BrandingHydrator />
      <AuthGate>
        <Outlet />
      </AuthGate>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
