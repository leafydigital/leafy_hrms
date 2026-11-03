-- Leave policy update for Leafy HRMS. Safe to run more than once.
BEGIN;

-- Extend the lightweight employee directory for leave balance reporting. Do not expose personal contact/Aadhaar fields.
CREATE OR REPLACE VIEW public.employee_directory AS
  SELECT id, emp_code, full_name, department_id, designation_id, status, reporting_to, employment_type, date_of_joining
  FROM public.employees;
GRANT SELECT ON public.employee_directory TO app_user;

ALTER TABLE public.leave_types
  ADD COLUMN IF NOT EXISTS eligible_gender text NOT NULL DEFAULT 'any'
    CHECK (eligible_gender IN ('any','female','male')),
  ADD COLUMN IF NOT EXISTS probation_monthly_accrual numeric(5,2) NOT NULL DEFAULT 1;

-- Casual Leave: 2 days accrue per month; unused balance carries forward to the next year.
UPDATE public.leave_types
   SET days_per_year = 24, monthly_accrual = 2, is_paid = true,
       carry_forward = true, eligible_gender = 'any', probation_monthly_accrual = 1
 WHERE lower(name) IN ('casual leave', 'casual leave (cl)', 'cl');

-- Paid Leave: 2 days accrue per month; no carry-forward.
INSERT INTO public.leave_types (name, days_per_year, monthly_accrual, is_paid, carry_forward, eligible_gender, probation_monthly_accrual)
VALUES ('Paid Leave', 24, 2, true, false, 'any', 1)
ON CONFLICT (name) DO UPDATE SET days_per_year = EXCLUDED.days_per_year,
  monthly_accrual = EXCLUDED.monthly_accrual, is_paid = EXCLUDED.is_paid,
  carry_forward = EXCLUDED.carry_forward, eligible_gender = EXCLUDED.eligible_gender,
  probation_monthly_accrual = EXCLUDED.probation_monthly_accrual;

-- LOP has no paid entitlement and no fixed limit; it is used for payroll deductions.
INSERT INTO public.leave_types (name, days_per_year, monthly_accrual, is_paid, carry_forward, eligible_gender, probation_monthly_accrual)
VALUES ('Unpaid Leave (LOP)', 0, 0, false, false, 'any', 0)
ON CONFLICT (name) DO UPDATE SET days_per_year = 0, monthly_accrual = 0,
  is_paid = false, carry_forward = false, eligible_gender = 'any', probation_monthly_accrual = 0;
UPDATE public.leave_types SET is_paid = false, carry_forward = false, eligible_gender = 'any'
 WHERE lower(name) IN ('unpaid leave', 'unpaid leave (lop)');

-- Maternity/Paternity leave: 12 days annually, visible only to the relevant gender.
INSERT INTO public.leave_types (name, days_per_year, monthly_accrual, is_paid, carry_forward, eligible_gender, probation_monthly_accrual)
VALUES ('Maternity Leave', 12, 0, true, false, 'female', 0)
ON CONFLICT (name) DO UPDATE SET days_per_year = 12, monthly_accrual = 0,
  is_paid = true, carry_forward = false, eligible_gender = 'female', probation_monthly_accrual = 0;

INSERT INTO public.leave_types (name, days_per_year, monthly_accrual, is_paid, carry_forward, eligible_gender, probation_monthly_accrual)
VALUES ('Paternity Leave', 12, 0, true, false, 'male', 0)
ON CONFLICT (name) DO UPDATE SET days_per_year = 12, monthly_accrual = 0,
  is_paid = true, carry_forward = false, eligible_gender = 'male', probation_monthly_accrual = 0;

-- Keep the generic annual entitlement consistent with monthly accrual.
UPDATE public.leave_types SET days_per_year = 24, monthly_accrual = 2, is_paid = true, carry_forward = true
 WHERE lower(name) IN ('casual leave', 'casual leave (cl)', 'cl');

COMMIT;
