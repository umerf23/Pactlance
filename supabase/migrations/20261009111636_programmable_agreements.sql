-- PAP execution is off-chain. This migration never transfers tokens.
create table public.agreement_execution (
 project_id uuid primary key references public.projects(id), active_version integer not null,
 revision bigint not null check(revision>0), state jsonb not null, updated_at timestamptz not null default now(),
 foreign key(project_id,active_version) references public.agreements(project_id,version)
);
create table public.agreement_transitions (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id), agreement_version integer not null,
 actor text not null, action text not null, previous_state jsonb, new_state jsonb not null, reason text not null, rule_ids jsonb not null default '[]',
 idempotency_key uuid not null, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'), execution_revision bigint not null, created_at timestamptz not null default now(),
 unique(project_id,idempotency_key), foreign key(project_id,agreement_version) references public.agreements(project_id,version)
);
create index agreement_transitions_timeline on public.agreement_transitions(project_id,execution_revision);
alter table public.agreement_execution enable row level security;
alter table public.agreement_transitions enable row level security;
create policy pap_participant_execution on public.agreement_execution for select to authenticated using(private.is_project_participant(project_id));
create policy pap_participant_transitions on public.agreement_transitions for select to authenticated using(private.is_project_participant(project_id));
revoke all on public.agreement_execution,public.agreement_transitions from public,anon,authenticated;
grant select on public.agreement_execution,public.agreement_transitions to authenticated;
grant all on public.agreement_execution,public.agreement_transitions to service_role;
create function public.prevent_pap_history_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'PAP history is append-only'; end;
$$;
create trigger pap_history_immutable before update or delete on public.agreement_transitions for each row execute function public.prevent_pap_history_mutation();
create function public.commit_pap_transition(p_project uuid,p_actor text,p_version integer,p_expected_revision bigint,p_idempotency_key uuid,p_request_hash text,p_action text,p_state jsonb,p_reason text,p_rule_ids jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare project public.projects; execution public.agreement_execution; prior public.agreement_transitions; terms jsonb; next_revision bigint; authorized boolean;
begin
 select * into project from public.projects where id=p_project for update;
 if not found then raise exception 'Project unavailable'; end if;
 select * into prior from public.agreement_transitions where project_id=p_project and idempotency_key=p_idempotency_key;
 if found then
  if prior.actor<>p_actor or prior.request_hash<>p_request_hash then raise exception 'Idempotency conflict'; end if;
  return jsonb_build_object('state',prior.new_state,'revision',prior.execution_revision,'duplicate',true);
 end if;
 select * into execution from public.agreement_execution where project_id=p_project for update;
 if coalesce(execution.revision,0)<>p_expected_revision then raise exception 'Stale execution revision'; end if;
 select a.terms into terms from public.agreements a where a.project_id=p_project and a.version=p_version;
 if terms->'protocol'->>'execution' is distinct from 'offchain_workflow' then raise exception 'PAP terms required'; end if;
 authorized:=p_actor in(project.client_wallet,project.freelancer_wallet);
 if p_action='resolve' and execution.state->>'status'='DISPUTED' then
  select exists(select 1 from jsonb_array_elements(execution.state->'milestones') m where m->>'state'='DISPUTED' and p_actor=case when now()>=(m->>'disputedAt')::timestamptz+make_interval(hours=>(terms->>'backupDelayHours')::int) then terms->>'backupReviewerWallet' else terms->>'reviewerWallet' end) into authorized;
 end if;
 if not authorized then raise exception 'Actor unauthorized'; end if;
 if p_action='activate' then
  if project.current_version<>p_version or coalesce(execution.active_version,0)>=p_version then raise exception 'Stale activation'; end if;
  if (select count(*) from public.agreement_acceptances a join public.agreements g using(project_id,version) where a.project_id=p_project and a.version=p_version and a.commitment=g.commitment and a.wallet in(project.client_wallet,project.freelancer_wallet))<>2 then raise exception 'Both signatures required'; end if;
 elsif execution.active_version is distinct from p_version then raise exception 'Active version mismatch'; end if;
 if (p_state->>'version')::int<>p_version then raise exception 'State version mismatch'; end if;
 next_revision:=p_expected_revision+1;
 insert into public.agreement_transitions(project_id,agreement_version,actor,action,previous_state,new_state,reason,rule_ids,idempotency_key,request_hash,execution_revision)
 values(p_project,p_version,p_actor,p_action,execution.state,p_state,p_reason,p_rule_ids,p_idempotency_key,p_request_hash,next_revision);
 insert into public.agreement_execution(project_id,active_version,revision,state) values(p_project,p_version,next_revision,p_state)
 on conflict(project_id) do update set active_version=excluded.active_version,revision=excluded.revision,state=excluded.state,updated_at=now();
 return jsonb_build_object('state',p_state,'revision',next_revision,'duplicate',false);
end;
$$;
revoke all on function public.commit_pap_transition(uuid,text,integer,bigint,uuid,text,text,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_pap_transition(uuid,text,integer,bigint,uuid,text,text,jsonb,text,jsonb) to service_role;
revoke all on function public.prevent_pap_history_mutation() from public,anon,authenticated;
create function public.guard_pap_amendment() returns trigger language plpgsql set search_path='' as $$
declare active public.agreement_execution; old_terms jsonb; milestone jsonb; idx integer;
begin
 select * into active from public.agreement_execution where project_id=new.project_id;
 if not found then return new; end if;
 select terms into old_terms from public.agreements where project_id=new.project_id and version=active.active_version;
 if new.terms->'protocol' is null or new.terms->'protocol'='null'::jsonb then raise exception 'An active PAP agreement cannot downgrade to legacy escrow'; end if;
 if active.state->>'status'='CANCELLED' then raise exception 'Cancelled agreement cannot be amended'; end if;
 for milestone,idx in select value,(ordinality-1)::integer from jsonb_array_elements(active.state->'milestones') with ordinality loop
  if milestone->>'acceptedAt' is not null then
   if (new.terms->'milestones'->idx) is distinct from (old_terms->'milestones'->idx) or (new.terms->'protocol'->'milestones'->idx) is distinct from (old_terms->'protocol'->'milestones'->idx) then raise exception 'Completed milestone terms cannot change'; end if;
  end if;
 end loop;
 return new;
end;
$$;
create trigger pap_amendment_guard before insert on public.agreements for each row execute function public.guard_pap_amendment();
revoke all on function public.guard_pap_amendment() from public,anon,authenticated;
create function private.is_pap_reviewer(p_project uuid,p_version integer,p_index integer) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.agreement_execution x join public.agreements a on a.project_id=x.project_id and a.version=x.active_version
 where x.project_id=p_project and x.active_version=p_version and p_index between 0 and 19 and x.state->'milestones'->p_index->>'state'='DISPUTED'
 and private.current_solana_wallet()=case when now()>=(x.state->'milestones'->p_index->>'disputedAt')::timestamptz+make_interval(hours=>(a.terms->>'backupDelayHours')::integer) then a.terms->>'backupReviewerWallet' else a.terms->>'reviewerWallet' end);
$$;
revoke all on function private.is_pap_reviewer(uuid,integer,integer) from public,anon;
grant execute on function private.is_pap_reviewer(uuid,integer,integer) to authenticated;
create policy pap_reviewer_agreement on public.agreements for select to authenticated using(exists(select 1 from generate_series(0,19) n where private.is_pap_reviewer(project_id,version,n)));
create policy pap_reviewer_evidence on public.evidence for select to authenticated using(status='ready' and private.is_pap_reviewer(project_id,agreement_version,milestone_index));
create function private.can_read_pap_evidence_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.evidence e where e.storage_path=p_path and e.status='ready' and private.is_pap_reviewer(e.project_id,e.agreement_version,e.milestone_index));
$$;
revoke all on function private.can_read_pap_evidence_file(text) from public,anon;
grant execute on function private.can_read_pap_evidence_file(text) to authenticated;
create policy pap_reviewer_file on storage.objects for select to authenticated using(bucket_id='pactlance-evidence' and private.can_read_pap_evidence_file(name));
create trigger agreement_versions_immutable before update or delete on public.agreements for each row execute function public.prevent_pap_history_mutation();
create trigger agreement_consent_immutable before update or delete on public.agreement_acceptances for each row execute function public.prevent_pap_history_mutation();
