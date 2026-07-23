-- ConnectChat Pro v6.1 calculation-sheet permissions upgrade
-- Run once if v6-calculation-sheets-migration.sql was already run previously.

alter table public.calculation_sheets
  add column if not exists access_scope text not null default 'all';

alter table public.calculation_sheets
  drop constraint if exists calculation_sheets_access_scope_check;

alter table public.calculation_sheets
  add constraint calculation_sheets_access_scope_check
  check (access_scope in ('all','admins','selected'));

create table if not exists public.calculation_sheet_access (
  sheet_id bigint not null references public.calculation_sheets(id) on delete cascade,
  user_id bigint not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sheet_id,user_id)
);

create index if not exists idx_calculation_sheet_access_user
  on public.calculation_sheet_access(user_id,sheet_id);

alter table public.calculation_sheet_access enable row level security;

-- Existing v6 sheets remain shared with all approved users.
-- New administrator uploads default to Administrators only.
