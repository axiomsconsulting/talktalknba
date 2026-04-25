-- Extend the data_connection_kind enum with 'local_upload'.
ALTER TYPE public.data_connection_kind ADD VALUE IF NOT EXISTS 'local_upload';