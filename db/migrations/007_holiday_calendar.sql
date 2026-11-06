-- Leafy HRMS: holiday calendar types, and role in the name directory (for searching employees by role).
-- Safe to run more than once.
BEGIN;

-- Holiday / festival type shown on the Holiday Calendar.
ALTER TABLE public.company_holidays ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'festival';
ALTER TABLE public.company_holidays DROP CONSTRAINT IF EXISTS company_holidays_kind_check;
ALTER TABLE public.company_holidays ADD CONSTRAINT company_holidays_kind_check
  CHECK (kind IN ('festival','national','company'));
ALTER TABLE public.company_holidays ADD COLUMN IF NOT EXISTS description text;

-- Name directory used across the app: add the access role so Team attendance can be searched by role.
-- (No contact, ID or pay data is exposed here.)
CREATE OR REPLACE VIEW public.employee_directory AS
  SELECT id, emp_code, full_name, department_id, designation_id, status, reporting_to, employment_type, date_of_joining, role
  FROM public.employees;
GRANT SELECT ON public.employee_directory TO app_user;

COMMIT;
