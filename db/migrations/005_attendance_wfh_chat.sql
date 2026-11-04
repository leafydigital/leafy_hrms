-- Leafy HRMS: 4-digit password reset codes, attendance approvals (late / other IP / edited time),
-- location + IP capture, breaks, work-from-home requests, and office chat.
-- Safe to run more than once (npm run db:migrate re-applies every migration).
BEGIN;

-- ---------------------------------------------------------------------
-- Forgot password: 4-digit email code -> short-lived reset token
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,                 -- HMAC of the 4-digit code, never the code itself
  attempts int NOT NULL DEFAULT 0,         -- wrong guesses; the code dies after 5
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  reset_token_hash text UNIQUE,            -- issued once the code is verified
  reset_expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_codes_user_idx ON public.password_reset_codes(user_id, created_at DESC);
REVOKE ALL ON public.password_reset_codes FROM app_user;

-- ---------------------------------------------------------------------
-- Attendance: typed vs system time, IP, location, approval workflow
-- check_in / check_out hold the time the employee typed (accepted time after approval);
-- *_system hold the server clock at the moment they pressed the button.
-- ---------------------------------------------------------------------
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_mode text NOT NULL DEFAULT 'office',
  ADD COLUMN IF NOT EXISTS check_in_system timestamptz,
  ADD COLUMN IF NOT EXISTS check_in_ip text,
  ADD COLUMN IF NOT EXISTS check_in_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS check_in_lng numeric(9,6),
  ADD COLUMN IF NOT EXISTS check_in_accuracy numeric(10,1),
  ADD COLUMN IF NOT EXISTS check_in_office_network boolean,
  ADD COLUMN IF NOT EXISTS check_in_reason text,
  ADD COLUMN IF NOT EXISTS check_out_system timestamptz,
  ADD COLUMN IF NOT EXISTS check_out_ip text,
  ADD COLUMN IF NOT EXISTS check_out_lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS check_out_lng numeric(9,6),
  ADD COLUMN IF NOT EXISTS check_out_accuracy numeric(10,1),
  ADD COLUMN IF NOT EXISTS check_out_office_network boolean,
  ADD COLUMN IF NOT EXISTS check_out_reason text,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS review_action text;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_work_mode_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_work_mode_check CHECK (work_mode IN ('office','wfh'));
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_approval_status_check;
ALTER TABLE public.attendance ADD CONSTRAINT attendance_approval_status_check
  CHECK (approval_status IN ('not_required','pending','approved','rejected'));
CREATE INDEX IF NOT EXISTS attendance_approval_idx ON public.attendance(approval_status) WHERE approval_status = 'pending';
CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance(date);

-- Employees no longer write attendance directly: check-in / check-out go through the API so the
-- server (not the browser) decides the time, IP and whether HR approval is required.
DROP POLICY IF EXISTS att_insert_own ON public.attendance;
DROP POLICY IF EXISTS att_update_own ON public.attendance;

-- Breaks during a shift
CREATE TABLE IF NOT EXISTS public.attendance_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid NOT NULL REFERENCES public.attendance(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS attendance_breaks_att_idx ON public.attendance_breaks(attendance_id);
-- Only one open break per employee at a time
CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_open ON public.attendance_breaks(employee_id) WHERE ended_at IS NULL;
ALTER TABLE public.attendance_breaks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS att_breaks_read ON public.attendance_breaks;
CREATE POLICY att_breaks_read ON public.attendance_breaks FOR SELECT TO app_user USING (public.can_view_employee(employee_id));
GRANT SELECT ON public.attendance_breaks TO app_user;

-- ---------------------------------------------------------------------
-- Work from home
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wfh_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days int NOT NULL CHECK (days > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  approved_dates date[] NOT NULL DEFAULT '{}',
  requested_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,  -- differs from employee_id when HR/Admin/manager marks WFH
  reviewed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS wfh_requests_emp_idx ON public.wfh_requests(employee_id, start_date);
CREATE INDEX IF NOT EXISTS wfh_requests_status_idx ON public.wfh_requests(status);

CREATE TABLE IF NOT EXISTS public.wfh_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  wfh_date date NOT NULL,
  request_id uuid REFERENCES public.wfh_requests(id) ON DELETE CASCADE,
  approved_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, wfh_date)
);
CREATE INDEX IF NOT EXISTS wfh_days_date_idx ON public.wfh_days(wfh_date);

ALTER TABLE public.wfh_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wfh_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wfh_requests_read ON public.wfh_requests;
CREATE POLICY wfh_requests_read ON public.wfh_requests FOR SELECT TO app_user USING (public.can_view_employee(employee_id));
DROP POLICY IF EXISTS wfh_days_read ON public.wfh_days;
CREATE POLICY wfh_days_read ON public.wfh_days FOR SELECT TO app_user USING (public.can_view_employee(employee_id));
-- Writes happen through /api/wfh/* (approver checks + emails), so app_user only reads.
GRANT SELECT ON public.wfh_requests, public.wfh_days TO app_user;
REVOKE INSERT, UPDATE, DELETE ON public.wfh_requests, public.wfh_days FROM app_user;

-- ---------------------------------------------------------------------
-- Office chat (Slack-style channels + direct messages)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'channel' CHECK (kind IN ('channel','dm')),
  description text,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.chat_members (
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, employee_id)
);
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id bigserial PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','shift','task','system')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON public.chat_messages(channel_id, id DESC);
CREATE TABLE IF NOT EXISTS public.chat_reads (
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, employee_id)
);
-- Chat is served only through /api/chat/*, which checks channel membership itself.
REVOKE ALL ON public.chat_channels, public.chat_members, public.chat_messages, public.chat_reads FROM app_user;

INSERT INTO public.chat_channels (slug, name, kind, description, sort_order) VALUES
  ('general', 'general', 'channel', 'Company-wide announcements and conversation', 1),
  ('shift-updates', 'shift-updates', 'channel', 'Shift in, shift out and breaks (posted automatically on check-in / check-out)', 2),
  ('task-updates', 'task-updates', 'channel', 'Daily task plans and task status updates', 3)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
