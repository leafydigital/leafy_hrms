-- Leafy HRMS chat: private groups (only the people you add) and file / image attachments.
-- Safe to run more than once.
BEGIN;

-- Private groups: kind 'group' — visible only to members. The creator is the group owner.
ALTER TABLE public.chat_channels DROP CONSTRAINT IF EXISTS chat_channels_kind_check;
ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_kind_check CHECK (kind IN ('channel','dm','group'));
ALTER TABLE public.chat_channels
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.chat_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.chat_members DROP CONSTRAINT IF EXISTS chat_members_role_check;
ALTER TABLE public.chat_members ADD CONSTRAINT chat_members_role_check CHECK (role IN ('owner','member'));
CREATE INDEX IF NOT EXISTS chat_members_employee_idx ON public.chat_members(employee_id);

-- A message may now be only a file / image, so the text can be empty.
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_body_check CHECK (length(body) <= 4000);

-- Attachments are uploaded first (message_id empty), then linked when the message is sent.
CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  message_id bigint REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON public.chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_orphan_idx ON public.chat_attachments(uploaded_by, created_at) WHERE message_id IS NULL;

-- Chat is served only through /api/chat/*, which checks membership itself.
REVOKE ALL ON public.chat_attachments FROM app_user;

COMMIT;
