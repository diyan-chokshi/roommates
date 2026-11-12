-- Public, read-only liveness check. Returns no household data and needs no privileged key.
create or replace function public.household_health() returns boolean
language sql stable security invoker set search_path = '' as $$ select true $$;
revoke all on function public.household_health() from public;
grant execute on function public.household_health() to anon, authenticated;
notify pgrst, 'reload schema';
