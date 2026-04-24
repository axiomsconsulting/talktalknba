ALTER TABLE public.app_settings
ADD COLUMN IF NOT EXISTS favicon_url text;

-- Storage policies for branding & avatars: allow authenticated users to upload/update.
-- Branding bucket already exists. Add an avatars bucket for profile photos if missing.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for avatars
DO $$ BEGIN
  CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Authenticated users can upload their own avatar (path prefix = user id)
DO $$ BEGIN
  CREATE POLICY "Users upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users update own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Branding bucket: allow admins to upload/update/delete (favicon + logo)
DO $$ BEGIN
  CREATE POLICY "Branding publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins upload branding"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins update branding"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins delete branding"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'branding' AND public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;