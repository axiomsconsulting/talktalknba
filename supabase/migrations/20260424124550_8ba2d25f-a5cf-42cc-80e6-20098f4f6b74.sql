-- Storage bucket for uploaded datasets (CSV / Parquet)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'datasets',
  'datasets',
  true,
  52428800, -- 50 MB
  ARRAY['text/csv','application/vnd.ms-excel','application/octet-stream','application/x-parquet','text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read/write policies on the bucket (showcase app, no auth)
CREATE POLICY "Public read datasets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'datasets');

CREATE POLICY "Public upload datasets"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'datasets');

CREATE POLICY "Public update datasets"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'datasets');

CREATE POLICY "Public delete datasets"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'datasets');

-- Registry of uploaded datasets
CREATE TABLE public.customer_datasets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('customer_info','usage','other')),
  storage_path TEXT NOT NULL,
  row_count INTEGER,
  byte_size BIGINT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_datasets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read datasets registry"
  ON public.customer_datasets FOR SELECT
  USING (true);

CREATE POLICY "Public insert datasets registry"
  ON public.customer_datasets FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Public update datasets registry"
  ON public.customer_datasets FOR UPDATE
  USING (true);

CREATE POLICY "Public delete datasets registry"
  ON public.customer_datasets FOR DELETE
  USING (true);

CREATE INDEX customer_datasets_uploaded_at_idx
  ON public.customer_datasets (uploaded_at DESC);