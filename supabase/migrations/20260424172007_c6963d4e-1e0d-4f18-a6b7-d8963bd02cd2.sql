-- Async pull job tracker
CREATE TABLE public.pull_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | downloading | parsing | uploading | done | error
  files_total INTEGER NOT NULL DEFAULT 0,
  files_done INTEGER NOT NULL DEFAULT 0,
  current_kind TEXT,
  current_file TEXT,
  current_bytes_total BIGINT,
  current_bytes_done BIGINT,
  current_rows_read BIGINT,
  pending_files JSONB NOT NULL DEFAULT '[]'::jsonb, -- queue of [{kind, path}]
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  triggered_by UUID,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE public.pull_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pull_jobs"
  ON public.pull_jobs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users read pull_jobs"
  ON public.pull_jobs FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active_user(auth.uid()));

CREATE TRIGGER pull_jobs_updated_at
  BEFORE UPDATE ON public.pull_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_pull_jobs_status ON public.pull_jobs(status, started_at);

-- Top 50 most impacted customers (from external scoring)
CREATE TABLE public.top_customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_run_id UUID,
  customer_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  churn_prob NUMERIC NOT NULL,
  reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_nba TEXT,
  expected_save_gbp NUMERIC,
  features JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.top_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage top_customers"
  ON public.top_customers FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved users read top_customers"
  ON public.top_customers FOR SELECT
  USING (auth.uid() IS NOT NULL AND is_active_user(auth.uid()));

CREATE INDEX idx_top_customers_run ON public.top_customers(model_run_id, rank);
CREATE INDEX idx_top_customers_created ON public.top_customers(created_at DESC);

-- Enable cron + net for the async worker
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
