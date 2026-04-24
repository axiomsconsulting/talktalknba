
-- Active data source registry: one row per data kind.
CREATE TABLE IF NOT EXISTS public.active_data_sources (
  kind TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin IN ('upload', 'live')),
  -- Upload origin
  dataset_id UUID NULL,
  -- Live origin
  connection_id UUID NULL,
  source_file_id UUID NULL,
  remote_name TEXT NULL,
  -- Display
  label TEXT NOT NULL,
  rows_count INTEGER NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by UUID NULL,
  CONSTRAINT active_data_sources_kind_chk CHECK (kind IN ('customer_info','calls','cease','usage')),
  CONSTRAINT active_data_sources_origin_payload_chk CHECK (
    (origin = 'upload' AND dataset_id IS NOT NULL)
    OR
    (origin = 'live' AND connection_id IS NOT NULL)
  )
);

ALTER TABLE public.active_data_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users read active sources" ON public.active_data_sources;
CREATE POLICY "Approved users read active sources"
ON public.active_data_sources FOR SELECT
USING (auth.uid() IS NOT NULL AND is_active_user(auth.uid()));

DROP POLICY IF EXISTS "Admins write active sources" ON public.active_data_sources;
CREATE POLICY "Admins write active sources"
ON public.active_data_sources FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Backfill from existing is_active uploads
INSERT INTO public.active_data_sources (kind, origin, dataset_id, label, rows_count)
SELECT d.kind, 'upload', d.id, d.filename, d.row_count
FROM public.customer_datasets d
WHERE d.is_active = true
ON CONFLICT (kind) DO NOTHING;
