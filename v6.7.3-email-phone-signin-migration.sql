-- ConnectChat Pro v6.7.3 optional email and phone sign-in
-- Safe to run more than once. Existing username logins are unchanged.

create extension if not exists citext;

alter table public.users add column if not exists email citext;
alter table public.users add column if not exists phone text;

create unique index if not exists users_email_unique_idx
  on public.users (lower(email::text))
  where email is not null;

create unique index if not exists users_phone_unique_idx
  on public.users (phone)
  where phone is not null;

alter table public.users drop constraint if exists users_email_format_check;
alter table public.users
  add constraint users_email_format_check
  check (email is null or email::text ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$');

alter table public.users drop constraint if exists users_phone_format_check;
alter table public.users
  add constraint users_phone_format_check
  check (phone is null or phone ~ '^\+?[0-9]{8,15}$');
