import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, Upload, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/data/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Your profile — TalkTalk NBA" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, user, loading, refresh } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? "");
      setAvatarUrl(profile.avatar_url ?? null);
    }
  }, [profile]);

  if (loading) return null;
  if (!user || !profile) return <Navigate to="/login" />;

  const initials = (profile.display_name ?? profile.email).slice(0, 2).toUpperCase();

  const onUpload = async (file: File) => {
    setBusy(true);
    const ext = file.name.split(".").pop() ?? "png";
    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      cacheControl: "3600",
      upsert: true,
    });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      setBusy(false);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setBusy(false);
    toast.success("Photo uploaded — don't forget to save.");
  };

  const onSave = async () => {
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName || null, avatar_url: avatarUrl })
      .eq("user_id", user.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refresh();
    toast.success("Profile updated.");
  };

  const removePhoto = () => {
    setAvatarUrl(null);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="Update your display name and profile photo. Your photo appears in the top navigation and on activity records you create."
        actions={
          <Button onClick={onSave} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save
          </Button>
        }
      />

      <div className="px-5 sm:px-8 lg:px-10 py-6 lg:py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Profile photo</CardTitle>
            <CardDescription>JPG, PNG or SVG. Square images work best.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-5">
              <div className="size-20 rounded-full border border-border bg-primary text-primary-foreground flex items-center justify-center overflow-hidden text-xl font-semibold shrink-0">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profile" className="size-full object-cover" />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
                />
                <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Upload className="size-4" />
                  Upload new
                </Button>
                {avatarUrl && (
                  <Button variant="ghost" onClick={removePhoto} disabled={busy}>
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5 pt-3 border-t border-border">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="How you'd like to be addressed"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile.email} disabled />
              <p className="text-[11px] text-muted-foreground">
                To change your email address, contact an administrator.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
