CREATE TABLE IF NOT EXISTS public.md_aggregate_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  source_signature text
);

ALTER TABLE public.md_aggregate_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approved users read aggregate cache"
  ON public.md_aggregate_cache
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL) AND public.is_active_user(auth.uid()));

CREATE POLICY "Admins write aggregate cache"
  ON public.md_aggregate_cache
  FOR ALL
  TO public
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));