-- Preserve authorization predicates while reducing repeated policy evaluation.
-- Bounded locks: abort rather than delay a busy hosted database indefinitely.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create index agreement_acceptances_member on public.agreement_acceptances(project_id,wallet);
create index agreement_execution_version on public.agreement_execution(project_id,active_version);
create index agreement_transitions_version on public.agreement_transitions(project_id,agreement_version);
create index milestone_cache_version on public.milestone_cache(project_id,agreement_version);
create index support_notes_author on public.support_notes(author_id);
create index support_notes_project on public.support_notes(project_id);

alter policy own_profile_read on public.profiles using(id=(select auth.uid()));
alter policy own_profile_insert on public.profiles with check(id=(select auth.uid()));
alter policy own_profile_update on public.profiles using(id=(select auth.uid())) with check(id=(select auth.uid()));
alter policy own_receipts_read on public.notification_receipts using(user_id=(select auth.uid()));
alter policy own_receipts_insert on public.notification_receipts with check(user_id=(select auth.uid()));
alter policy own_receipts_update on public.notification_receipts using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
alter policy support_own_membership on public.support_members using(user_id=(select auth.uid()));

-- Permissive SELECT policies are already OR-ed by Postgres. Keep that exact
-- union, including legacy reviewer freshness and PAP's exclusive handoff.
drop policy participant_agreements on public.agreements;
drop policy reviewer_agreement on public.agreements;
drop policy pap_reviewer_agreement on public.agreements;
create policy agreement_authorized_read on public.agreements for select to authenticated using(
 private.is_project_participant(project_id)
 or exists(select 1 from public.milestone_cache m where m.project_id=agreements.project_id
   and m.agreement_version=agreements.version
   and private.is_milestone_reviewer(m.project_id,m.agreement_version,m.milestone_index))
 or exists(select 1 from generate_series(0,19) n where private.is_pap_reviewer(agreements.project_id,agreements.version,n))
);

drop policy evidence_read on public.evidence;
drop policy pap_reviewer_evidence on public.evidence;
create policy evidence_authorized_read on public.evidence for select to authenticated using(
 (status='ready' and (private.can_access_milestone(project_id,agreement_version,milestone_index)
   or private.is_pap_reviewer(project_id,agreement_version,milestone_index)))
 or (uploader_wallet=private.current_solana_wallet() and private.is_project_participant(project_id))
);

drop policy phase6_file_read on storage.objects;
drop policy pap_reviewer_file on storage.objects;
create policy evidence_file_authorized_read on storage.objects for select to authenticated using(
 bucket_id='pactlance-evidence'
 and (private.can_read_evidence_file(name) or private.can_read_pap_evidence_file(name))
);
commit;
