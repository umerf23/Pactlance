begin;
-- Unexposed counters. No client can reset a quota or choose its own allowance.
create table private.api_limits (
 user_id uuid not null references auth.users(id) on delete cascade,
 scope text not null check(scope in ('read','write','escrow','evidence')),
 window_started timestamptz not null,
 used integer not null check(used between 1 and 121),
 primary key(user_id,scope)
);
alter table private.api_limits enable row level security;
revoke all on private.api_limits from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update on private.api_limits to service_role;
create function public.consume_api_limit(p_user uuid,p_scope text,p_limit integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer; t timestamptz:=clock_timestamp();
begin
 if p_limit not between 1 and 120 then raise exception 'invalid limit'; end if;
 insert into private.api_limits as q(user_id,scope,window_started,used)
 values(p_user,p_scope,t,1)
 on conflict(user_id,scope) do update set
 window_started=case when q.window_started<=t-interval '1 minute' then t else q.window_started end,
 used=case when q.window_started<=t-interval '1 minute' then 1 else least(q.used+1,121) end
 returning used into n;
 return n<=p_limit;
end $$;
revoke all on function public.consume_api_limit(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.consume_api_limit(uuid,text,integer) to service_role;
commit;
