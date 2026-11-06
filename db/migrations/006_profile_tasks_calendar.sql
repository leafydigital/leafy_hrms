-- Leafy HRMS: WFH opt-out, half-day session (morning/afternoon), wider attendance visibility for
-- senior leadership, task notes/activity log (chatter), and an audit log for self-service profile edits.
-- Safe to run more than once (npm run db:migrate re-applies every migration).
BEGIN;

-- ---------------------------------------------------------------------
-- WFH approved, but the employee came to the office: they can switch that day back to office.
-- ---------------------------------------------------------------------
ALTER TABLE public.wfh_days
  ADD COLUMN IF NOT EXISTS opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS opted_out_note text;

-- ---------------------------------------------------------------------
-- Half-day session: which half of the day was taken / worked.
-- ---------------------------------------------------------------------
ALTER TABLE public.leaves ADD COLUMN IF NOT EXISTS half_day_session text;
ALTER TABLE public.leaves DROP CONSTRAINT IF EXISTS leaves_half_day_session_check;
ALTER TABLE public.leaves ADD CONSTRAINT leaves_half_day_session_check
  CHECK (half_day_session IS NULL OR half_day_session IN ('morning','afternoon'));

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS half_day_session text;
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_half_day_session_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_half_day_session_check
  CHECK (half_day_session IS NULL OR half_day_session IN ('morning','afternoon'));

-- ---------------------------------------------------------------------
-- Attendance: CEO / CTO / COO can see everyone's attendance (for the employee calendar),
-- reporting persons their direct reports, everyone their own.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS att_read ON public.attendance;
CREATE POLICY att_read ON public.attendance FOR SELECT TO app_user
  USING (public.can_view_employee(employee_id));

-- ---------------------------------------------------------------------
-- Task activity log (Odoo-style chatter): created, status changes, re-assignment and notes.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_activities (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('created','status','assigned','note')),
  body text CHECK (body IS NULL OR length(body) <= 4000),
  old_status text,
  new_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_activities_task_idx ON public.task_activities(task_id, id);

ALTER TABLE public.task_activities ENABLE ROW LEVEL SECURITY;
-- Anyone who can see the task (assignee, Admin, HR — per the tasks policies) sees its activity...
DROP POLICY IF EXISTS task_activities_read ON public.task_activities;
CREATE POLICY task_activities_read ON public.task_activities FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
-- ...and can add notes in their own name. Status/created/assigned rows come only from the triggers below.
DROP POLICY IF EXISTS task_activities_add_note ON public.task_activities;
CREATE POLICY task_activities_add_note ON public.task_activities FOR INSERT TO app_user
  WITH CHECK (kind = 'note' AND author_id = public.current_employee_id()
              AND length(coalesce(trim(body), '')) > 0
              AND EXISTS (SELECT 1 FROM public.tasks t WHERE t.id = task_id));
GRANT SELECT, INSERT ON public.task_activities TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.task_activities_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.log_task_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := coalesce(public.current_employee_id(), NEW.created_by);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_activities (task_id, author_id, kind, new_status, body)
    VALUES (NEW.id, actor, 'created', NEW.status,
            (SELECT 'Assigned to ' || e.full_name FROM public.employees e WHERE e.id = NEW.assignee_id));
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.task_activities (task_id, author_id, kind, old_status, new_status)
      VALUES (NEW.id, actor, 'status', OLD.status, NEW.status);
    END IF;
    IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
      INSERT INTO public.task_activities (task_id, author_id, kind, body)
      VALUES (NEW.id, actor, 'assigned',
              coalesce((SELECT 'Assigned to ' || e.full_name FROM public.employees e WHERE e.id = NEW.assignee_id), 'Unassigned'));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_log_task_activity ON public.tasks;
CREATE TRIGGER trg_log_task_activity AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.log_task_activity();

-- Existing tasks get a "created" entry once, so their history is not empty.
INSERT INTO public.task_activities (task_id, author_id, kind, new_status, created_at)
SELECT t.id, t.created_by, 'created', t.status, t.created_at FROM public.tasks t
WHERE NOT EXISTS (SELECT 1 FROM public.task_activities a WHERE a.task_id = t.id);

-- ---------------------------------------------------------------------
-- My Profile: every self-service change is recorded (old -> new) for HR.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_profile_changes (
  id bigserial PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  field text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_profile_changes_emp_idx ON public.employee_profile_changes(employee_id, created_at DESC);
REVOKE ALL ON public.employee_profile_changes FROM app_user;

COMMIT;
