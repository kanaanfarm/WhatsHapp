-- ConnectChat Pro v6.3 conversation archive preferences
-- Run this file once in Supabase SQL Editor before using Archive chat.

create table if not exists public.conversation_preferences (
  user_id bigint not null references public.users(id) on delete cascade,
  other_user_id bigint not null references public.users(id) on delete cascade,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, other_user_id),
  check (user_id <> other_user_id)
);

create index if not exists idx_conversation_preferences_archived
  on public.conversation_preferences(user_id, archived_at)
  where archived_at is not null;

alter table public.conversation_preferences enable row level security;

-- ConnectChat uses the Supabase service role. The application server restricts
-- every archive operation to the authenticated user's own preference row.
