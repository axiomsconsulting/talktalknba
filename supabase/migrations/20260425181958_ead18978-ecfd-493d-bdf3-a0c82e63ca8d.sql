INSERT INTO public.data_connections (kind, name, enabled, config)
SELECT 'local_upload'::public.data_connection_kind, 'Local upload', true, '{}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.data_connections WHERE kind = 'local_upload'
);