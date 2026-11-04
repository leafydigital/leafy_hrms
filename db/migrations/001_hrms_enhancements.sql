-- Leafy HRMS enhancements. Safe to re-run against an existing installation.
BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS personal_email text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation text,
  ADD COLUMN IF NOT EXISTS blood_group text,
  ADD COLUMN IF NOT EXISTS pincode text,
  ADD COLUMN IF NOT EXISTS aadhaar_number text;

-- Keep employee codes generated for new records, while permitting authorized edits.
ALTER TABLE public.employees ALTER COLUMN emp_code SET DEFAULT ('LD' || lpad(nextval('public.emp_code_seq')::text, 3, '0'));

-- Senior leadership are explicit roles, not merely designation labels.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_role_check
  CHECK (role IN ('admin','hr','accounts','employee','ceo','cto','coo'));
ALTER TABLE public.designations DROP CONSTRAINT IF EXISTS designations_default_role_check;
ALTER TABLE public.designations ADD CONSTRAINT designations_default_role_check
  CHECK (default_role IN ('admin','hr','accounts','employee','ceo','cto','coo'));

-- Previous experience entries and configurable employee-defined custom fields.
CREATE TABLE IF NOT EXISTS public.employee_experiences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  company_name text,
  period text,
  experience_letter_name text,
  experience_letter_data text,
  payslip_name text,
  payslip_data text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_experiences_employee_idx ON public.employee_experiences(employee_id);
CREATE TABLE IF NOT EXISTS public.employee_custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name text NOT NULL UNIQUE,
  field_type text NOT NULL CHECK (field_type IN ('text','number','date','email','url','textarea','checkbox')),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Company holidays and comp-off ledger.
CREATE TABLE IF NOT EXISTS public.company_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.comp_off_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  earned_on date NOT NULL,
  days numeric(4,1) NOT NULL CHECK (days > 0),
  attendance_id uuid REFERENCES public.attendance(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(employee_id, earned_on)
);

-- Leave policy configuration supports monthly CL accrual and carry-forward without hardcoding other leave policies.
ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS monthly_accrual numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carry_forward boolean NOT NULL DEFAULT false;
UPDATE public.leave_types SET days_per_year = 24, monthly_accrual = 2, carry_forward = true WHERE lower(name) IN ('casual leave','casual leave (cl)');
UPDATE public.leave_types SET days_per_year = 0, is_paid = false WHERE lower(name) IN ('unpaid leave','unpaid leave (lop)');

-- Salary components; employer PF/ESI remain zero until configured by the company.
ALTER TABLE public.salary_structures
  ADD COLUMN IF NOT EXISTS conveyance_allowance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defray_expenses numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_pf numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_esi numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_ctc numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.payroll
  ADD COLUMN IF NOT EXISTS conveyance_allowance numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defray_expenses numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_pf numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS employer_esi numeric(12,2) NOT NULL DEFAULT 0;

-- Extend generated payroll totals to include the new salary components.
ALTER TABLE public.payroll DROP COLUMN gross;
ALTER TABLE public.payroll DROP COLUMN total_deductions;
ALTER TABLE public.payroll DROP COLUMN net_pay;
ALTER TABLE public.payroll ADD COLUMN gross numeric(12,2) GENERATED ALWAYS AS (basic + hra + allowances + conveyance_allowance + defray_expenses + bonus) STORED;
ALTER TABLE public.payroll ADD COLUMN total_deductions numeric(12,2) GENERATED ALWAYS AS (pf + tax + other_deductions + lop_amount) STORED;
ALTER TABLE public.payroll ADD COLUMN net_pay numeric(12,2) GENERATED ALWAYS AS (basic + hra + allowances + conveyance_allowance + defray_expenses + bonus - pf - tax - other_deductions - lop_amount) STORED;

-- When an employee code is manually edited, keep the sequence ahead of its numeric suffix.
CREATE OR REPLACE FUNCTION public.sync_emp_code_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE suffix bigint;
BEGIN
  suffix := substring(NEW.emp_code from '([0-9]+)$')::bigint;
  IF suffix IS NOT NULL THEN
    PERFORM setval('public.emp_code_seq', GREATEST((SELECT last_value FROM public.emp_code_seq), suffix), true);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_emp_code_sequence ON public.employees;
CREATE TRIGGER trg_sync_emp_code_sequence AFTER INSERT OR UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.sync_emp_code_sequence();

-- Shared security predicates: high leadership can review all records; a reporting person can see direct reports.
CREATE OR REPLACE FUNCTION public.is_hrms_lead() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role(ARRAY['admin','hr','ceo','cto','coo'])
$$;
CREATE OR REPLACE FUNCTION public.can_view_employee(target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_hrms_lead()
    OR target = public.current_employee_id()
    OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id=target AND e.reporting_to=public.current_employee_id())
$$;

-- Include reporting relationship in the lightweight directory so the UI can identify direct reports.
CREATE OR REPLACE VIEW public.employee_directory AS
  SELECT id, emp_code, full_name, department_id, designation_id, status, reporting_to FROM public.employees;
GRANT SELECT ON public.employee_directory TO app_user;

-- Employees: HR/Admin and Accounts retain their existing views; reporting managers can select direct reports.
DROP POLICY IF EXISTS emp_read ON public.employees;
CREATE POLICY emp_read ON public.employees FOR SELECT TO app_user
  USING (public.has_role(ARRAY['admin','hr','accounts']) OR user_id=public.uid()
         OR reporting_to=public.current_employee_id());
DROP POLICY IF EXISTS emp_insert ON public.employees;
CREATE POLICY emp_insert ON public.employees FOR INSERT TO app_user
  WITH CHECK (public.has_role(ARRAY['admin','hr']) AND (role NOT IN ('admin','ceo','cto','coo') OR public.has_role(ARRAY['admin'])));
DROP POLICY IF EXISTS emp_update ON public.employees;
CREATE POLICY emp_update ON public.employees FOR UPDATE TO app_user
  USING (public.has_role(ARRAY['admin','hr']) AND (role NOT IN ('admin','ceo','cto','coo') OR public.has_role(ARRAY['admin'])))
  WITH CHECK (public.has_role(ARRAY['admin','hr']) AND (role NOT IN ('admin','ceo','cto','coo') OR public.has_role(ARRAY['admin'])));
DROP POLICY IF EXISTS emp_delete ON public.employees;
CREATE POLICY emp_delete ON public.employees FOR DELETE TO app_user USING (public.has_role(ARRAY['admin']));

-- Stamp the approver and audit time for approvals, rejections, and cancellation decisions.
CREATE OR REPLACE FUNCTION public.leaves_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.has_role(ARRAY['admin','hr','ceo','cto','coo']) THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND (
      (OLD.status='pending' AND NEW.status IN ('approved','rejected')) OR
      (OLD.status='cancellation_requested' AND NEW.status IN ('cancelled','approved'))
    ) THEN
      NEW.reviewed_by := public.current_employee_id();
      NEW.reviewed_at := now();
    END IF;
  ELSE
    NEW.reviewed_by := OLD.reviewed_by;
    NEW.reviewed_at := OLD.reviewed_at;
    NEW.review_note := OLD.review_note;
  END IF;
  RETURN NEW;
END $$;

-- Rebuild leave policies for reporting relationships and senior leadership.
DROP POLICY IF EXISTS leave_read ON public.leaves;
CREATE POLICY leave_read ON public.leaves FOR SELECT TO app_user USING (public.can_view_employee(employee_id));
DROP POLICY IF EXISTS leave_insert_own ON public.leaves;
CREATE POLICY leave_insert_own ON public.leaves FOR INSERT TO app_user WITH CHECK (employee_id=public.current_employee_id() AND status='pending');
DROP POLICY IF EXISTS leave_insert_hr ON public.leaves;
CREATE POLICY leave_insert_hr ON public.leaves FOR INSERT TO app_user WITH CHECK (public.is_hrms_lead() AND employee_id<>public.current_employee_id());
ALTER TABLE public.leaves DROP CONSTRAINT IF EXISTS leaves_status_check;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_status_check CHECK (status IN ('pending','approved','rejected','cancelled','cancellation_requested'));
DROP POLICY IF EXISTS leave_update_own ON public.leaves;
CREATE POLICY leave_update_own ON public.leaves FOR UPDATE TO app_user
  USING (employee_id=public.current_employee_id() AND status IN ('pending','approved'))
  WITH CHECK (employee_id=public.current_employee_id() AND status='cancellation_requested');
DROP POLICY IF EXISTS leave_update_admin ON public.leaves;
CREATE POLICY leave_update_admin ON public.leaves FOR UPDATE TO app_user
  USING (public.has_role(ARRAY['admin','ceo','cto','coo']) OR (public.has_role(ARRAY['hr']) AND employee_id <> public.current_employee_id()))
  WITH CHECK (public.has_role(ARRAY['admin','ceo','cto','coo']) OR (public.has_role(ARRAY['hr']) AND employee_id <> public.current_employee_id()));
DROP POLICY IF EXISTS leave_update_hr ON public.leaves;
DROP POLICY IF EXISTS leave_delete ON public.leaves;
CREATE POLICY leave_delete ON public.leaves FOR DELETE TO app_user USING (public.has_role(ARRAY['admin']));

-- Attendance is visible to Admin/HR and direct reporting managers for team attendance.
DROP POLICY IF EXISTS att_read ON public.attendance;
CREATE POLICY att_read ON public.attendance FOR SELECT TO app_user USING (employee_id=public.current_employee_id() OR public.has_role(ARRAY['admin','hr']) OR EXISTS (SELECT 1 FROM public.employees x WHERE x.id=attendance.employee_id AND x.reporting_to=public.current_employee_id()));
DROP POLICY IF EXISTS att_manage ON public.attendance;
CREATE POLICY att_manage ON public.attendance FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr'])) WITH CHECK (public.has_role(ARRAY['admin','hr']));


-- Preserve salary/payroll access for Admin, HR, and Accounts.
DROP POLICY IF EXISTS sal_manage ON public.salary_structures;
CREATE POLICY sal_manage ON public.salary_structures FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr','accounts']))
  WITH CHECK (public.has_role(ARRAY['admin','hr','accounts']));
DROP POLICY IF EXISTS pay_read_staff ON public.payroll;
CREATE POLICY pay_read_staff ON public.payroll FOR SELECT TO app_user
  USING (public.has_role(ARRAY['admin','hr','accounts']));
DROP POLICY IF EXISTS pay_manage ON public.payroll;
CREATE POLICY pay_manage ON public.payroll FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr','accounts']))
  WITH CHECK (public.has_role(ARRAY['admin','hr','accounts']));

-- Supporting-table RLS and least-privilege grants.
ALTER TABLE public.employee_experiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comp_off_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_experience_access ON public.employee_experiences;
CREATE POLICY employee_experience_access ON public.employee_experiences FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr'])) WITH CHECK (public.has_role(ARRAY['admin','hr']));
DROP POLICY IF EXISTS employee_custom_fields_access ON public.employee_custom_field_definitions;
CREATE POLICY employee_custom_fields_access ON public.employee_custom_field_definitions FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr'])) WITH CHECK (public.has_role(ARRAY['admin','hr']));
DROP POLICY IF EXISTS company_holidays_read ON public.company_holidays;
CREATE POLICY company_holidays_read ON public.company_holidays FOR SELECT TO app_user USING (true);
DROP POLICY IF EXISTS company_holidays_manage ON public.company_holidays;
CREATE POLICY company_holidays_manage ON public.company_holidays FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr'])) WITH CHECK (public.has_role(ARRAY['admin','hr']));
DROP POLICY IF EXISTS comp_off_read ON public.comp_off_ledger;
CREATE POLICY comp_off_read ON public.comp_off_ledger FOR SELECT TO app_user USING (public.can_view_employee(employee_id));
DROP POLICY IF EXISTS comp_off_manage ON public.comp_off_ledger;
CREATE POLICY comp_off_manage ON public.comp_off_ledger FOR ALL TO app_user
  USING (public.has_role(ARRAY['admin','hr'])) WITH CHECK (public.has_role(ARRAY['admin','hr']));

-- Holiday work earns one comp-off day after a verified full check-in/check-out; half day earns 0.5.
CREATE OR REPLACE FUNCTION public.credit_holiday_comp_off() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE earned numeric(4,1);
BEGIN
  IF NEW.check_in IS NOT NULL AND NEW.check_out IS NOT NULL AND NEW.status IN ('present','wfh','half_day')
     AND EXISTS (SELECT 1 FROM public.company_holidays h WHERE h.holiday_date=NEW.date) THEN
    earned := CASE WHEN NEW.status='half_day' THEN 0.5 ELSE 1.0 END;
    INSERT INTO public.comp_off_ledger(employee_id, earned_on, days, attendance_id, note)
      VALUES (NEW.employee_id, NEW.date, earned, NEW.id, 'Verified work on company holiday')
      ON CONFLICT (employee_id, earned_on) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_credit_holiday_comp_off ON public.attendance;
CREATE TRIGGER trg_credit_holiday_comp_off AFTER INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.credit_holiday_comp_off();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_experiences, public.employee_custom_field_definitions, public.company_holidays, public.comp_off_ledger TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
COMMIT;
