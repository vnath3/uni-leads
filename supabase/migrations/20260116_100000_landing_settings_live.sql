alter table public.landing_settings
  add column if not exists is_live boolean not null default false,
  add column if not exists live_enabled_at timestamptz null,
  add column if not exists live_enabled_by uuid null references auth.users(id);

alter table public.landing_settings enable row level security;
