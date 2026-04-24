import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export interface AppSettings {
  id: string;
  app_name: string;
  app_description: string;
  logo_url: string | null;
  primary_color: string;
  accent_color: string;
  gradient_css: string;
  source_url: string | null;
  email_sender_name: string | null;
  email_reply_to: string | null;
}

interface State {
  settings: AppSettings | null;
  loading: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<AppSettings>) => Promise<{ error: string | null }>;
}

export const useBrandingStore = create<State>((set, get) => ({
  settings: null,
  loading: false,
  load: async () => {
    set({ loading: true });
    const { data } = await supabase
      .from("app_settings")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    set({ settings: (data as AppSettings) ?? null, loading: false });
  },
  save: async (patch) => {
    const current = get().settings;
    if (!current) return { error: "Settings not loaded" };
    const { data, error } = await supabase
      .from("app_settings")
      .update(patch)
      .eq("id", current.id)
      .select("*")
      .maybeSingle();
    if (error) return { error: error.message };
    set({ settings: (data as AppSettings) ?? current });
    return { error: null };
  },
}));

/**
 * Apply branding tokens to :root so existing semantic tokens
 * (--primary, --talktalk-lime, --gradient-primary) get overridden live.
 */
export function applyBrandingToDocument(s: AppSettings | null) {
  if (typeof document === "undefined" || !s) return;
  const root = document.documentElement;
  root.style.setProperty("--primary", s.primary_color);
  root.style.setProperty("--ring", s.primary_color);
  root.style.setProperty("--talktalk-lime", s.accent_color);
  root.style.setProperty("--gradient-primary", s.gradient_css);
}
