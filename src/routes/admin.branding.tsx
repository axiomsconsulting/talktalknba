import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Sparkles, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/data/auth";
import { useBrandingStore, applyBrandingToDocument, type AppSettings } from "@/data/brandingStore";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/branding")({
  head: () => ({ meta: [{ title: "Branding & settings — TalkTalk NBA" }] }),
  component: BrandingPage,
});

type LogoKind = "logo" | "favicon";

function BrandingPage() {
  const { isAdmin, loading } = useAuth();
  const { settings, load, save } = useBrandingStore();
  const [form, setForm] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (loading) return null;
  if (!isAdmin) return <Navigate to="/" />;
  if (!form) {
    return (
      <AppShell>
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const onUpload = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop() ?? "png";
    const path = `logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("branding").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      setBusy(false);
      return;
    }
    const { data } = supabase.storage.from("branding").getPublicUrl(path);
    update("logo_url", data.publicUrl);
    setBusy(false);
    toast.success("Logo uploaded — don't forget to save.");
  };

  const onSave = async () => {
    if (!form) return;
    setBusy(true);
    const { error } = await save({
      app_name: form.app_name,
      app_description: form.app_description,
      logo_url: form.logo_url,
      primary_color: form.primary_color,
      accent_color: form.accent_color,
      gradient_css: form.gradient_css,
      source_url: form.source_url,
      email_sender_name: form.email_sender_name,
      email_reply_to: form.email_reply_to,
    });
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    applyBrandingToDocument(form);
    toast.success("Branding saved & applied.");
  };

  // Naive palette inference: pick a hue from the URL hash for a deterministic
  // demo — a production version would crawl the site. We give the user a
  // sensible starting palette they can tweak.
  const extractFromUrl = () => {
    if (!form.source_url) {
      toast.error("Enter a target site URL first.");
      return;
    }
    setExtracting(true);
    const hash = Array.from(form.source_url).reduce((a, c) => a + c.charCodeAt(0), 0);
    const baseHue = hash % 360;
    const accentHue = (baseHue + 130) % 360;
    setTimeout(() => {
      update("primary_color", `oklch(0.66 0.22 ${baseHue})`);
      update("accent_color", `oklch(0.92 0.20 ${accentHue})`);
      update(
        "gradient_css",
        `linear-gradient(135deg, oklch(0.66 0.22 ${baseHue}), oklch(0.5 0.22 ${baseHue}))`
      );
      setExtracting(false);
      toast.success("Palette suggested — tweak as needed, then save.");
    }, 400);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Admin"
        title="Branding & settings"
        description="Upload your company logo, set the app name and description, and configure brand colours. Changes apply across the entire console after saving."
        actions={
          <Button onClick={onSave} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save & apply
          </Button>
        }
      />

      <div className="px-5 sm:px-8 lg:px-10 py-6 lg:py-8 grid gap-6 lg:grid-cols-2">
        {/* Identity */}
        <Card>
          <CardHeader>
            <CardTitle>App identity</CardTitle>
            <CardDescription>Logo, name and tagline shown in the navigation and login screen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="size-16 rounded-xl border border-border flex items-center justify-center bg-talktalk-lime overflow-hidden"
                style={{ backgroundColor: form.accent_color }}
              >
                {form.logo_url ? (
                  <img src={form.logo_url} alt="Logo preview" className="max-h-12 max-w-12" />
                ) : (
                  <span className="text-xs text-talktalk-ink/60">No logo</span>
                )}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="size-4" />
                  Upload logo
                </Button>
                <p className="mt-1.5 text-[11px] text-muted-foreground">PNG or SVG, max 2MB.</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">App name</Label>
              <Input id="name" value={form.app_name} onChange={(e) => update("app_name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="desc">Description / tagline</Label>
              <Textarea
                id="desc"
                value={form.app_description}
                onChange={(e) => update("app_description", e.target.value)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Colours */}
        <Card>
          <CardHeader>
            <CardTitle>Brand colours</CardTitle>
            <CardDescription>Primary, accent and hero gradient. Use any CSS colour value.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="primary">Primary</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="size-9 rounded-md border border-border shrink-0"
                    style={{ backgroundColor: form.primary_color }}
                  />
                  <Input
                    id="primary"
                    value={form.primary_color}
                    onChange={(e) => update("primary_color", e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accent">Accent</Label>
                <div className="flex items-center gap-2">
                  <div
                    className="size-9 rounded-md border border-border shrink-0"
                    style={{ backgroundColor: form.accent_color }}
                  />
                  <Input
                    id="accent"
                    value={form.accent_color}
                    onChange={(e) => update("accent_color", e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grad">Hero gradient (CSS)</Label>
              <Input
                id="grad"
                value={form.gradient_css}
                onChange={(e) => update("gradient_css", e.target.value)}
              />
              <div
                className="mt-2 h-12 rounded-md border border-border"
                style={{ background: form.gradient_css }}
              />
            </div>
            <div className="space-y-1.5 pt-2 border-t border-border">
              <Label htmlFor="src">Target site URL (auto palette)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="src"
                  placeholder="https://www.talktalk.co.uk"
                  value={form.source_url ?? ""}
                  onChange={(e) => update("source_url", e.target.value)}
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={extractFromUrl}
                  disabled={extracting || !form.source_url}
                >
                  {extracting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Suggest
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Generates a starting palette derived from the URL. Override anything you don't like.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Email sender */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Email sender</CardTitle>
            <CardDescription>Sender name and reply-to address used for approval and password reset emails.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="sender">Sender name</Label>
              <Input
                id="sender"
                placeholder="TalkTalk NBA"
                value={form.email_sender_name ?? ""}
                onChange={(e) => update("email_sender_name", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reply">Reply-to address</Label>
              <Input
                id="reply"
                type="email"
                placeholder="nba-team@talktalk.co.uk"
                value={form.email_reply_to ?? ""}
                onChange={(e) => update("email_reply_to", e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
