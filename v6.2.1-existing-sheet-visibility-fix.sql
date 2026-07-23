-- ConnectChat Pro v6.2.1
-- Run once in Supabase SQL Editor if files uploaded with v6.2 are visible only
-- to administrators. This changes those existing files to all approved users.

update public.calculation_sheets
set access_scope = 'all'
where access_scope = 'admins';
