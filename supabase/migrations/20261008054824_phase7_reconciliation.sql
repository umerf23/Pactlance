begin;
create table public.escrow_bindings (
 project_id uuid not null, agreement_version integer not null, program_id text not null, mint text not null,
 commitment text not null check(commitment ~ '^[a-f0-9]{64}$'), terms jsonb not null,
 primary key(project_id,agreement_version,program_id,mint), foreign key(project_id,agreement_version) references public.agreements(project_id,version)
);
alter table public.escrow_bindings enable row level security;
revoke all on public.escrow_bindings from anon,authenticated;
grant select on public.escrow_bindings to authenticated;grant all on public.escrow_bindings to service_role;
create policy binding_read on public.escrow_bindings for select to authenticated using(private.is_project_participant(project_id) or exists(select 1 from public.milestone_cache m where m.project_id=escrow_bindings.project_id and m.agreement_version=escrow_bindings.agreement_version and private.is_milestone_reviewer(m.project_id,m.agreement_version,m.milestone_index)));
create table public.project_chain_cache(
 project_id uuid primary key references public.projects(id),agreement_version integer not null,program_id text not null,mint text not null,
 client_accepted boolean not null,freelancer_accepted boolean not null,next_index integer not null check(next_index between 0 and 20),active boolean not null,cancelled boolean not null,
 finalized_slot bigint not null check(finalized_slot>=0),verified_at timestamptz not null
);
alter table public.project_chain_cache enable row level security;
revoke all on public.project_chain_cache from anon,authenticated;grant select on public.project_chain_cache to authenticated;grant all on public.project_chain_cache to service_role;
create policy chain_read on public.project_chain_cache for select to authenticated using(private.is_project_participant(project_id));
-- Atomic, slot-ordered reconciliation. A slower request cannot overwrite a later finalized snapshot.
create function public.reconcile_escrow(p_project uuid,p_snapshot jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare old_slot bigint; s bigint; a jsonb; m jsonb; v integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,0));
 s:=(p_snapshot->>'slot')::bigint;
 select finalized_slot into old_slot from public.project_chain_cache where project_id=p_project;
 if old_slot is not null and s<old_slot then return false; end if;
 for a in select * from jsonb_array_elements(p_snapshot->'bindings') loop
  v:=(a->'terms'->>'version')::integer;
  insert into public.escrow_bindings values(p_project,v,a->'terms'->>'escrowProgram',a->'terms'->'token'->>'mint',a->>'commitment',a->'terms') on conflict do nothing;
  if not exists(select 1 from public.escrow_bindings b where b.project_id=p_project and b.agreement_version=v and b.program_id=a->'terms'->>'escrowProgram' and b.mint=a->'terms'->'token'->>'mint' and b.commitment=a->>'commitment' and b.terms=a->'terms') then raise exception 'immutable binding conflict'; end if;
 end loop;
 if p_snapshot->'state'='null'::jsonb then return true; end if;
 a:=p_snapshot->'agreement';
 insert into public.project_chain_cache values(p_project,(a->'terms'->>'version')::integer,a->'terms'->>'escrowProgram',a->'terms'->'token'->>'mint',(p_snapshot->'state'->>'clientAccepted')::boolean,(p_snapshot->'state'->>'freelancerAccepted')::boolean,(p_snapshot->'state'->>'next')::integer,(p_snapshot->'state'->>'active')::boolean,(p_snapshot->'state'->>'cancelled')::boolean,s,now())
 on conflict(project_id) do update set agreement_version=excluded.agreement_version,program_id=excluded.program_id,mint=excluded.mint,client_accepted=excluded.client_accepted,freelancer_accepted=excluded.freelancer_accepted,next_index=excluded.next_index,active=excluded.active,cancelled=excluded.cancelled,finalized_slot=excluded.finalized_slot,verified_at=excluded.verified_at;
 update public.projects set locked=(p_snapshot->'state'->>'active')::boolean or (p_snapshot->'state'->>'cancelled')::boolean where id=p_project;
 for m in select * from jsonb_array_elements(p_snapshot->'milestones') loop
  if m='null'::jsonb then continue; end if;
  a:=(select x from jsonb_array_elements(p_snapshot->'bindings') x where (x->'terms'->>'version')::integer=(m->>'agreementVersion')::integer);
  insert into public.milestone_cache(project_id,agreement_version,milestone_index,chain_address,state,amount_units,client_refunded,freelancer_paid,delivery_deadline,review_deadline,backup_at,reviewer_wallet,backup_reviewer_wallet,submission_commitment,dispute_commitment,verified_at,finalized_slot)
  values(p_project,(m->>'agreementVersion')::integer,(m->>'index')::integer,m->>'chainAddress',case (m->>'status')::integer when 1 then 'funded' when 2 then 'submitted' when 3 then 'settled' when 4 then 'disputed' end,m->>'amount',m->>'clientRefunded',m->>'freelancerPaid',to_timestamp((m->>'deliveryDeadline')::double precision),case when (m->>'reviewDeadline')::bigint>0 then to_timestamp((m->>'reviewDeadline')::double precision) end,case when (m->>'backupAt')::bigint>0 then to_timestamp((m->>'backupAt')::double precision) end,a->'terms'->>'reviewerWallet',a->'terms'->>'backupReviewerWallet',m->>'submissionCommitment',m->>'disputeCommitment',now(),s)
  on conflict(project_id,milestone_index) do update set agreement_version=excluded.agreement_version,state=excluded.state,client_refunded=excluded.client_refunded,freelancer_paid=excluded.freelancer_paid,review_deadline=excluded.review_deadline,backup_at=excluded.backup_at,submission_commitment=excluded.submission_commitment,dispute_commitment=excluded.dispute_commitment,verified_at=excluded.verified_at,finalized_slot=excluded.finalized_slot;
 end loop;
 return true;
end $$;
revoke all on function public.reconcile_escrow(uuid,jsonb) from public,anon,authenticated;grant execute on function public.reconcile_escrow(uuid,jsonb) to service_role;
-- Worker outbox persists signed bytes before broadcast; never exposed through browser roles.
create table public.claim_outbox(project_id uuid not null references public.projects(id),milestone_index integer not null,signature text not null,raw text not null,blockhash text not null,last_valid_block_height bigint not null,status text not null check(status in ('pending','confirmed','finalized','failed','expired')),created_at timestamptz not null default now(),primary key(project_id,milestone_index));
alter table public.claim_outbox enable row level security;revoke all on public.claim_outbox from anon,authenticated;grant all on public.claim_outbox to service_role;
alter table public.transaction_events add column amount_units text,add column client_recipient text,add column freelancer_recipient text,add column network text not null default 'devnet' check(network='devnet');
create table public.reconciliation_cursors(project_id uuid primary key references public.projects(id),last_signature text,scan_before text,pending_head text);
alter table public.reconciliation_cursors enable row level security;revoke all on public.reconciliation_cursors from anon,authenticated;grant all on public.reconciliation_cursors to service_role;
commit;
