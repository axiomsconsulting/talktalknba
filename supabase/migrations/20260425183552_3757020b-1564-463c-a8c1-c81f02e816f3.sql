INSERT INTO public.data_connections (kind, name, config, enabled, schedule_cron)
SELECT 'sample'::public.data_connection_kind, 'Sample data', '{}'::jsonb, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.data_connections WHERE kind = 'sample'::public.data_connection_kind
);
