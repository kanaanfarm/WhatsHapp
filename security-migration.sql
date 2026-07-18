-- CONNECTCHAT PRO SECURITY MIGRATION
-- Run once in Supabase > SQL Editor before deploying version 1.2.0.
-- Safe to run again. It does not delete users, messages, or uploaded files.

create table if not exists public.app_sessions (
  sid text primary key,
  sess jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_sessions_expires_idx
  on public.app_sessions(expires_at);

alter table public.app_sessions enable row level security;

-- The Node server uses the private service-role key. No browser policies are
-- created, so anon/authenticated browser clients cannot read session records.
revoke all on table public.app_sessions from anon, authenticated;

select 'ConnectChat security migration completed' as result;
