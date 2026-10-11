-- PAP submissions deliberately have no on-chain review timer. Preserve the
-- legacy deadline invariant while allowing the verified PAP state to be cached.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
alter table public.milestone_cache add column is_pap boolean not null default false;
-- Derive the mode from the immutable binding for this milestone's version.
update public.milestone_cache m set is_pap=true
from public.escrow_bindings b
where b.project_id=m.project_id and b.agreement_version=m.agreement_version
  and jsonb_typeof(b.terms->'protocol')='object';
alter table public.milestone_cache drop constraint milestone_cache_check2;
alter table public.milestone_cache add constraint milestone_cache_review_deadline
  check(state <> 'submitted' or review_deadline is not null or is_pap);
comment on column public.milestone_cache.is_pap is
  'Derived from the immutable escrow binding by reconcile_escrow; PAP uses explicit payout authorization, not a chain review timer.';

create or replace function public.reconcile_escrow(p_project uuid,p_snapshot jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare old_slot bigint; old_program text; old_mint text; s bigint; a jsonb; m jsonb; v integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_project::text,0));
 s:=(p_snapshot->>'slot')::bigint;
 select finalized_slot,program_id,mint into old_slot,old_program,old_mint from public.project_chain_cache where project_id=p_project;
 if old_program is not null and (old_program is distinct from p_snapshot->'agreement'->'terms'->>'escrowProgram' or old_mint is distinct from p_snapshot->'agreement'->'terms'->'token'->>'mint') then raise exception 'deployment binding cannot change for an existing escrow'; end if;
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
  insert into public.milestone_cache(project_id,agreement_version,milestone_index,chain_address,state,amount_units,client_refunded,freelancer_paid,delivery_deadline,review_deadline,backup_at,reviewer_wallet,backup_reviewer_wallet,submission_commitment,dispute_commitment,verified_at,finalized_slot,is_pap)
  values(p_project,(m->>'agreementVersion')::integer,(m->>'index')::integer,m->>'chainAddress',case (m->>'status')::integer when 1 then 'funded' when 2 then 'submitted' when 3 then 'settled' when 4 then 'disputed' end,m->>'amount',m->>'clientRefunded',m->>'freelancerPaid',to_timestamp((m->>'deliveryDeadline')::double precision),case when (m->>'reviewDeadline')::bigint>0 then to_timestamp((m->>'reviewDeadline')::double precision) end,case when (m->>'backupAt')::bigint>0 then to_timestamp((m->>'backupAt')::double precision) end,a->'terms'->>'reviewerWallet',a->'terms'->>'backupReviewerWallet',m->>'submissionCommitment',m->>'disputeCommitment',now(),s,coalesce(jsonb_typeof(a->'terms'->'protocol')='object',false))
  on conflict(project_id,milestone_index) do update set agreement_version=excluded.agreement_version,state=excluded.state,client_refunded=excluded.client_refunded,freelancer_paid=excluded.freelancer_paid,review_deadline=excluded.review_deadline,backup_at=excluded.backup_at,submission_commitment=excluded.submission_commitment,dispute_commitment=excluded.dispute_commitment,verified_at=excluded.verified_at,finalized_slot=excluded.finalized_slot,is_pap=excluded.is_pap;
 end loop;
 return true;
end $$;
revoke all on function public.reconcile_escrow(uuid,jsonb) from public,anon,authenticated;grant execute on function public.reconcile_escrow(uuid,jsonb) to service_role;
commit;
