begin;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated,service_role;
alter function public.current_solana_wallet() set schema private;
alter function public.is_project_participant(uuid) set schema private;
create or replace function private.is_project_participant(p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects p where p.id=p_project and
 private.current_solana_wallet() in (p.client_wallet,p.freelancer_wallet));
$$;
revoke all on function private.current_solana_wallet() from public,anon,authenticated;
revoke all on function private.is_project_participant(uuid) from public,anon,authenticated;
grant execute on function private.current_solana_wallet() to authenticated;
grant execute on function private.is_project_participant(uuid) to authenticated;
commit;
