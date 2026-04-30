ALTER TABLE public.nba_rules
  ADD COLUMN IF NOT EXISTS flat_credit_gbp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS engineer_cost_gbp numeric NOT NULL DEFAULT 0;

-- Seed sensible defaults that match the treatment matrix copy in the app:
--   - Engineer dispatch + £15 service credit (free_tech_upgrade)
--   - Save desk has higher per-contact cost (loyalty_save_desk)
UPDATE public.nba_rules SET flat_credit_gbp = 15
  WHERE trigger_key = 'free_tech_upgrade' AND flat_credit_gbp = 0;
UPDATE public.nba_rules SET engineer_cost_gbp = 65
  WHERE trigger_key = 'free_tech_upgrade' AND engineer_cost_gbp = 0;