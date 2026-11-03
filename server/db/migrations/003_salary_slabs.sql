BEGIN;

-- Reusable monthly salary templates. Gross and annual CTC are derived by PostgreSQL.
CREATE TABLE IF NOT EXISTS public.salary_slabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  basic numeric(12,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
  hra numeric(12,2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
  conveyance_allowance numeric(12,2) NOT NULL DEFAULT 0 CHECK (conveyance_allowance >= 0),
  defray_expenses numeric(12,2) NOT NULL DEFAULT 0 CHECK (defray_expenses >= 0),
  allowances numeric(12,2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  employer_pf numeric(12,2) NOT NULL DEFAULT 0 CHECK (employer_pf >= 0),
  employer_esi numeric(12,2) NOT NULL DEFAULT 0 CHECK (employer_esi >= 0),
  pf numeric(12,2) NOT NULL DEFAULT 0 CHECK (pf >= 0),
  tax numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  other_deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  monthly_gross numeric(12,2) GENERATED ALWAYS AS
    (basic + hra + conveyance_allowance + defray_expenses + allowances) STORED,
  annual_ctc numeric(14,2) GENERATED ALWAYS AS
    ((basic + hra + conveyance_allowance + defray_expenses + allowances + employer_pf + employer_esi) * 12) STORED,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS salary_slab_id uuid REFERENCES public.salary_slabs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS salary_slabs_active_gross_idx
  ON public.salary_slabs(active, monthly_gross);

ALTER TABLE public.salary_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_slabs_read ON public.salary_slabs;
CREATE POLICY salary_slabs_read ON public.salary_slabs FOR SELECT TO app_user
  USING (public.has_role(ARRAY['admin','hr','ceo','cto','coo']));
DROP POLICY IF EXISTS salary_slabs_manage ON public.salary_slabs;
CREATE POLICY salary_slabs_manage ON public.salary_slabs FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr','ceo','cto','coo']))
  WITH CHECK (public.has_role(ARRAY['admin','hr','ceo','cto','coo']));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_slabs TO app_user;
GRANT SELECT, INSERT, UPDATE ON public.salary_structures TO app_user;

COMMIT;
