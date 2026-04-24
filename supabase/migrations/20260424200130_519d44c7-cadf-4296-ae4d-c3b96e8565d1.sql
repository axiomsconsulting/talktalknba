
-- Make sure required extensions exist
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Cancel any currently-stuck job so the operator can start fresh
UPDATE public.pull_jobs
   SET status = 'cancelled',
       error  = COALESCE(error, 'Reset by maintenance migration'),
       finished_at = COALESCE(finished_at, now())
 WHERE status IN ('queued', 'downloading', 'parsing', 'uploading');

-- Drop existing schedule if present (safe re-run)
DO $$
BEGIN
  PERFORM cron.unschedule('pull_azure_worker_tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Tick the worker every 30 seconds so queued pulls actually progress
SELECT cron.schedule(
  'pull_azure_worker_tick',
  '30 seconds',
  $$
  SELECT net.http_post(
    url := 'https://project--eba547f9-967a-4de5-bf53-d035c4b48cd6.lovable.app/api/public/hooks/pull-azure-worker',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
