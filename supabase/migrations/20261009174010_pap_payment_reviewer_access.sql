-- Retain narrowly scoped reviewer reads while an allocation awaits an on-chain payment.
-- Fully paid/refunded milestones remain inaccessible to former reviewers.
create or replace function private.is_pap_reviewer(p_project uuid,p_version integer,p_index integer) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.agreement_execution x
  join public.agreements a on a.project_id=x.project_id and a.version=x.active_version
  where x.project_id=p_project and x.active_version=p_version and p_index between 0 and 19
  and (x.state->'milestones'->p_index->>'state'='DISPUTED'
       or (x.state->'milestones'->p_index->>'state'='PAYMENT_PENDING'
           and jsonb_typeof(x.state->'milestones'->p_index->'allocation')='object'))
  and private.current_solana_wallet()=case
   when now()>=(x.state->'milestones'->p_index->>'disputedAt')::timestamptz+make_interval(hours=>(a.terms->>'backupDelayHours')::integer)
   then a.terms->>'backupReviewerWallet' else a.terms->>'reviewerWallet' end
 );
$$;
revoke all on function private.is_pap_reviewer(uuid,integer,integer) from public,anon;
grant execute on function private.is_pap_reviewer(uuid,integer,integer) to authenticated;
