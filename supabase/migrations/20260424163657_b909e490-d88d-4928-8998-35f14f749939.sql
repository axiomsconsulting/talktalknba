CREATE UNIQUE INDEX IF NOT EXISTS data_source_files_conn_kind_remote_uidx
  ON public.data_source_files (connection_id, kind, remote_id);