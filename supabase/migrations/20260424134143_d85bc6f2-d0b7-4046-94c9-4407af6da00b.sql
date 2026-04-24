-- Allow calls.csv and cease.csv enrichment files in the dataset registry.
ALTER TABLE public.customer_datasets
  DROP CONSTRAINT IF EXISTS customer_datasets_kind_check;

ALTER TABLE public.customer_datasets
  ADD CONSTRAINT customer_datasets_kind_check
  CHECK (kind IN ('customer_info','usage','calls','cease','other'));
