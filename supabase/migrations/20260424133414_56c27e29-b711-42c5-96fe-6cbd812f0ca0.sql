-- NBA rule configuration persisted in Lovable Cloud.
-- Each row corresponds to one of the six NBA trigger keys used by the app
-- (loyalty_save_desk, free_tech_upgrade, rightsize_email, competitor_match,
-- suppress, nurture). The operator console at /nba-rules edits these.

CREATE TABLE public.nba_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text NOT NULL,
  channel text NOT NULL,
  -- Offer parameters
  discount_pct numeric NOT NULL DEFAULT 0,        -- 0..100
  contract_months integer NOT NULL DEFAULT 24,
  eligible_packages text[] NOT NULL DEFAULT '{}', -- product names from /products
  -- Trigger thresholds (any non-null value is enforced; nulls = ignore)
  min_loyalty_calls_90d integer,
  min_hold_seconds integer,
  min_ooc_days integer,
  min_speed_deficit_pct numeric,                  -- 0..1
  min_monthly_download_gb numeric,
  -- Cost-to-serve per contact in GBP, used in ROI math
  cost_per_contact_gbp numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nba_rules ENABLE ROW LEVEL SECURITY;

-- This is an internal operator console with no end-user auth, so policies are
-- intentionally permissive (matches the existing customer_datasets pattern).
CREATE POLICY "Public read nba rules"   ON public.nba_rules FOR SELECT USING (true);
CREATE POLICY "Public insert nba rules" ON public.nba_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update nba rules" ON public.nba_rules FOR UPDATE USING (true);
CREATE POLICY "Public delete nba rules" ON public.nba_rules FOR DELETE USING (true);

-- Reusable updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_nba_rules_updated_at
BEFORE UPDATE ON public.nba_rules
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults for the six existing triggers so the operator console has
-- editable starting values that mirror the in-code NBA_TRIGGERS map.
INSERT INTO public.nba_rules
  (trigger_key, label, description, channel, discount_pct, contract_months,
   eligible_packages, min_loyalty_calls_90d, min_hold_seconds, min_ooc_days,
   min_speed_deficit_pct, min_monthly_download_gb, cost_per_contact_gbp, display_order)
VALUES
  ('loyalty_save_desk', 'Specialist Save Desk',
   'Multiple loyalty calls or extended hold time → friction + active shopping. Route to a specialist save agent with a pre-approved discount.',
   'Outbound Call', 20, 24,
   ARRAY['Fibre 35','Fibre 65','Full Fibre 150','Full Fibre 500','Full Fibre 900']::text[],
   2, 1800, NULL, NULL, NULL, 12.00, 1),
  ('free_tech_upgrade', 'Free Tech Upgrade',
   'Speed deficit or legacy technology → fix the root cause rather than discounting. Move them to a faster line at the same price.',
   'Outbound Call + Engineer Visit', 0, 24,
   ARRAY['Fibre 35','Fibre 65','Full Fibre 150']::text[],
   NULL, NULL, NULL, 0.25, NULL, 65.00, 2),
  ('rightsize_email', 'Right-size Upgrade Email',
   'Heavy usage on a basic package → throttling and poor performance. Trigger an automated upgrade campaign tailored to their use case.',
   'Email + In-app', 10, 18,
   ARRAY['Fibre 35','Fibre 65']::text[],
   NULL, NULL, NULL, NULL, 800, 0.40, 3),
  ('competitor_match', 'Competitor-match Save Offer',
   'Cease intent matches Competitor Deals patterns → price is the primary lever. Trigger highest-tier retention offer immediately via preferred channel.',
   'Customer''s preferred channel', 25, 24,
   ARRAY[]::text[],
   NULL, NULL, NULL, NULL, NULL, 14.00, 4),
  ('suppress', 'Do Not Disturb',
   'Long-tenure low-risk customer. Outbound contact would erode satisfaction and induce churn — hold in nurture sequences only.',
   'Suppress', 0, 0, ARRAY[]::text[],
   NULL, NULL, NULL, NULL, NULL, 0.00, 5),
  ('nurture', 'Personalised Nurture',
   'Mid-risk customer without a single dominant trigger. Send a personalised retention email with usage insights.',
   'Email', 5, 12, ARRAY[]::text[],
   NULL, NULL, NULL, NULL, NULL, 0.30, 6);
