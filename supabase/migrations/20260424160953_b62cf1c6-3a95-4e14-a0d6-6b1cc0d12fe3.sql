-- =========================================================
-- Live data ingestion + retraining schema
-- =========================================================

-- Connection kinds
DO $$ BEGIN
  CREATE TYPE public.data_connection_kind AS ENUM ('databricks', 'gdrive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.data_run_status AS ENUM ('pending', 'running', 'success', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----- data_connections -----
CREATE TABLE IF NOT EXISTS public.data_connections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         public.data_connection_kind NOT NULL,
  name         text NOT NULL,
  -- Free-form per-kind config:
  --   gdrive:     { root_folder_id, root_folder_url, subfolders: { customer_info, calls, cease, usage, model_artefacts } }
  --   databricks: { warehouse_id, host, queries: [ { kind: 'customer_info'|'calls'|..., sql: '...' } ] }
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule_cron text,
  enabled      boolean NOT NULL DEFAULT true,
  last_run_at  timestamptz,
  last_status  public.data_run_status,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS data_connections_kind_unique
  ON public.data_connections (kind);

DROP TRIGGER IF EXISTS set_data_connections_updated_at ON public.data_connections;
CREATE TRIGGER set_data_connections_updated_at
BEFORE UPDATE ON public.data_connections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.data_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read connections" ON public.data_connections;
CREATE POLICY "Admins read connections" ON public.data_connections
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins insert connections" ON public.data_connections;
CREATE POLICY "Admins insert connections" ON public.data_connections
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update connections" ON public.data_connections;
CREATE POLICY "Admins update connections" ON public.data_connections
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins delete connections" ON public.data_connections;
CREATE POLICY "Admins delete connections" ON public.data_connections
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- ----- data_source_files -----
CREATE TABLE IF NOT EXISTS public.data_source_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   uuid NOT NULL REFERENCES public.data_connections(id) ON DELETE CASCADE,
  kind            text NOT NULL, -- customer_info | calls | cease | usage | model_artefacts | duckdb
  remote_id       text NOT NULL, -- Drive file id, or "<warehouse>/<query_kind>"
  remote_name     text,
  remote_modified_at timestamptz,
  remote_hash     text,
  bytes           bigint,
  dataset_id      uuid REFERENCES public.customer_datasets(id) ON DELETE SET NULL,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_ingested_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS data_source_files_remote_unique
  ON public.data_source_files (connection_id, kind, remote_id);

DROP TRIGGER IF EXISTS set_data_source_files_updated_at ON public.data_source_files;
CREATE TRIGGER set_data_source_files_updated_at
BEFORE UPDATE ON public.data_source_files
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.data_source_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users read source files" ON public.data_source_files;
CREATE POLICY "Approved users read source files" ON public.data_source_files
  FOR SELECT USING (auth.uid() IS NOT NULL AND public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "Admins write source files" ON public.data_source_files;
CREATE POLICY "Admins write source files" ON public.data_source_files
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ----- model_runs -----
CREATE TABLE IF NOT EXISTS public.model_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status       public.data_run_status NOT NULL DEFAULT 'pending',
  triggered_by text, -- 'manual' | 'cron' | 'connection:<id>'
  -- Full model_stats.json shape (accuracy, precision, recall, f1, roc_auc,
  -- confusion_matrix, dataset_split, hyperparameters, model_type, etc.)
  metrics      jsonb,
  -- Paths in Storage to the artefacts produced by the training job
  artefact_paths jsonb, -- { feature_importance, roc_curve, eval_segments, scored_customers, shap_values }
  databricks_run_id text,
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_model_runs_updated_at ON public.model_runs;
CREATE TRIGGER set_model_runs_updated_at
BEFORE UPDATE ON public.model_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.model_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users read model runs" ON public.model_runs;
CREATE POLICY "Approved users read model runs" ON public.model_runs
  FOR SELECT USING (auth.uid() IS NOT NULL AND public.is_active_user(auth.uid()));

DROP POLICY IF EXISTS "Admins write model runs" ON public.model_runs;
CREATE POLICY "Admins write model runs" ON public.model_runs
  FOR ALL USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ----- model-artefacts storage bucket (public-read; writes service-role only) -----
INSERT INTO storage.buckets (id, name, public)
VALUES ('model-artefacts', 'model-artefacts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read model artefacts" ON storage.objects;
CREATE POLICY "Public read model artefacts" ON storage.objects
  FOR SELECT USING (bucket_id = 'model-artefacts');