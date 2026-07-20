-- ConnectChat Pro: administrator approval upgrade
-- Safe to run more than once in the Supabase SQL Editor.

alter table public.users
  add column if not exists status text not null default 'approved';

alter table public.users
  add column if not exists is_admin boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_status_check
      check (status in ('pending', 'approved', 'blocked'));
  end if;
end $$;

update public.users
set status = 'approved', is_admin = true
where lower(username::text) = lower('Abokanaan');

select id, username, status, is_admin, created_at
from public.users
order by created_at;
