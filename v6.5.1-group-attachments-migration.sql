-- ConnectChat Pro v6.5.1 group attachment support.
-- Run once in Supabase SQL Editor before sending files to groups.

alter table public.group_messages
  add column if not exists kind text not null default 'text',
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists mime_type text;

alter table public.group_messages
  drop constraint if exists group_messages_body_check;

alter table public.group_messages
  alter column body set default '';

alter table public.group_messages
  add constraint group_messages_body_check
  check (char_length(body) between 0 and 4000);

alter table public.group_messages
  drop constraint if exists group_messages_kind_check;

alter table public.group_messages
  add constraint group_messages_kind_check
  check (kind in ('text','image','voice','file'));
