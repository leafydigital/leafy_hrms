BEGIN;

CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx ON public.password_reset_tokens(user_id);

-- Dedupes daily scheduled notifications and prevents repeat email sends on server restarts.
CREATE TABLE IF NOT EXISTS public.email_notification_log (
  id bigserial PRIMARY KEY,
  notification_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
