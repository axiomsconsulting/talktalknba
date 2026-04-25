-- Add 'sample' to the data_connection_kind enum and seed a row so the
-- bundled sample dataset can be toggled on/off like any other connector.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'data_connection_kind' AND e.enumlabel = 'sample'
  ) THEN
    ALTER TYPE public.data_connection_kind ADD VALUE 'sample';
  END IF;
END$$;
