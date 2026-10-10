-- Operator-run database-only test. Every fixture and temporary helper rolls back.
-- This is role/JWT-claim simulation, NOT browser Auth or Storage HTTP proof.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create temporary table probe_users(n integer primary key,id uuid, wallet text) on commit drop;
insert into probe_users values
 (0,gen_random_uuid(),'AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9'),
 (1,gen_random_uuid(),'9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu'),
 (2,gen_random_uuid(),'GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse'),
 (3,gen_random_uuid(),'EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1'),
 (4,gen_random_uuid(),'8SFqwqnq4whPhs8icwHA2hQg3hUoN1qrCLK1SBx3WKwe'),
 (5,gen_random_uuid(),'AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa');
create temporary table probe_project(id uuid) on commit drop;
insert into probe_project values(gen_random_uuid());
create temporary table probe_checks(name text primary key,passed boolean) on commit drop;
grant select on probe_users,probe_project to authenticated,anon,service_role;
grant insert,select on probe_checks to authenticated,anon,service_role;
create function pg_temp.probe_assert(p_pass boolean,p_name text) returns void language plpgsql as $$
begin
 if p_pass is distinct from true then raise exception 'probe failed: %',p_name; end if;
 insert into pg_temp.probe_checks values(p_name,true);
end $$;
create function pg_temp.probe_denied(p_sql text,p_name text) returns void language plpgsql as $$
begin
 begin
  execute p_sql;
 exception when insufficient_privilege then
  insert into pg_temp.probe_checks values(p_name,true);
  return;
 end;
 raise exception 'probe unexpectedly permitted: %',p_name;
end $$;
insert into auth.users(id) select id from probe_users;
insert into auth.identities(user_id,provider,provider_id,identity_data)
 select id,'web3','web3:solana:'||wallet,jsonb_build_object('sub','web3:solana:'||wallet) from probe_users;
insert into public.projects(id,title,client_wallet,freelancer_wallet,current_version)
 select p.id,'Pactlance rollback access probe',c.wallet,f.wallet,1 from probe_project p,probe_users c,probe_users f where c.n=0 and f.n=1;
insert into public.project_members(project_id,wallet,role)
 select p.id,u.wallet,case when u.n=0 then 'client' else 'freelancer' end from probe_project p,probe_users u where u.n in (0,1);
insert into public.agreements(project_id,version,terms,salt,commitment)
 select p.id,1,jsonb_build_object('projectId',p.id,'version',1,'network','devnet','milestones',jsonb_build_array(jsonb_build_object('sequence',1),jsonb_build_object('sequence',2)),
 'reviewerWallet',r.wallet,'backupReviewerWallet',b.wallet,'backupDelayHours',24),repeat('a',64),repeat('b',64)
 from probe_project p,probe_users r,probe_users b where r.n=2 and b.n=3;
insert into public.agreement_execution(project_id,active_version,revision,state)
 select id,1,1,jsonb_build_object('milestones',jsonb_build_array(jsonb_build_object('state','DISPUTED','disputedAt',now()),jsonb_build_object('state','FUNDED'))) from probe_project;
insert into public.evidence(id,project_id,agreement_version,milestone_index,uploader_wallet,purpose,title,kind,storage_path,filename,mime_type,byte_size,file_hash,status,salt,commitment,manifest,completed_at)
 select e.id,p.id,1,m.n,u.wallet,'delivery','Synthetic private evidence','file',p.id::text||'/'||e.id::text,'probe.txt','text/plain',4,repeat('c',64),'ready',repeat('d',64),repeat('e',64),'{}'::jsonb,now()
 from probe_project p,probe_users u,generate_series(0,1) m(n),lateral(select gen_random_uuid() as id where m.n>=0) e where u.n=1;
-- Metadata only: no Storage object bytes are uploaded or read by this probe.
insert into storage.objects(bucket_id,name) select 'pactlance-evidence',storage_path from public.evidence where project_id=(select id from probe_project);
insert into public.support_members(user_id) select id from probe_users where n=5;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=0),true);
select pg_temp.probe_assert((select count(*)=1 from public.agreements where project_id=(select id from probe_project)),'client_terms');
select pg_temp.probe_assert((select count(*)=2 from public.evidence where project_id=(select id from probe_project)),'client_evidence');
select pg_temp.probe_assert((select count(*)=2 from storage.objects where name like (select id::text||'/%' from probe_project)),'client_storage_metadata');
select pg_temp.probe_assert((select count(*)=1 from public.agreement_execution where project_id=(select id from probe_project)),'client_execution');
insert into public.profiles(id,display_name) select id,'Synthetic client' from probe_users where n=0;
select pg_temp.probe_denied('update public.profiles set id=(select id from pg_temp.probe_users where n=4) where id=(select id from pg_temp.probe_users where n=0)','profile_owner_reassignment_denied');
select pg_temp.probe_denied('select * from public.claim_outbox','participant_outbox_denied');
select pg_temp.probe_denied('select * from public.reconciliation_cursors','participant_cursor_denied');
select pg_temp.probe_denied('update public.agreement_execution set revision=999 where project_id=(select id from pg_temp.probe_project)','execution_write_denied');
select pg_temp.probe_denied('select public.consume_api_limit(auth.uid(),''read'',1)','browser_quota_rpc_denied');

select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=1),true);
select pg_temp.probe_assert((select count(*)=2 from public.evidence where project_id=(select id from probe_project)),'freelancer_evidence');
select pg_temp.probe_assert((select count(*)=1 from public.agreements where project_id=(select id from probe_project)),'freelancer_terms');
select pg_temp.probe_assert((select count(*)=2 from storage.objects where name like (select id::text||'/%' from probe_project)),'freelancer_storage_metadata');

select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=2),true);
select pg_temp.probe_assert((select count(*)=1 from public.agreements where project_id=(select id from probe_project)),'primary_terms');
select pg_temp.probe_assert((select count(*)=1 from public.evidence where project_id=(select id from probe_project)),'primary_exact_milestone');
select pg_temp.probe_assert((select count(*)=1 from storage.objects where name like (select id::text||'/%' from probe_project)),'primary_exact_storage');

select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=3),true);
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'backup_before_handoff_denied');
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=4),true);
select pg_temp.probe_assert((select count(*)=0 from public.agreements where project_id=(select id from probe_project)),'outsider_terms_denied');
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'outsider_evidence_denied');
select pg_temp.probe_assert((select count(*)=0 from storage.objects where name like (select id::text||'/%' from probe_project)),'outsider_storage_denied');
select pg_temp.probe_assert((select count(*)=0 from public.agreement_execution where project_id=(select id from probe_project)),'outsider_execution_denied');
select pg_temp.probe_denied('insert into public.support_members(user_id) select id from pg_temp.probe_users where n=4','support_self_enrollment_denied');
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=5),true);
select pg_temp.probe_assert((select count(*)=1 from public.support_members where user_id=auth.uid()),'support_own_membership');
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'support_evidence_denied');
select pg_temp.probe_assert((select count(*)=0 from storage.objects where name like (select id::text||'/%' from probe_project)),'support_storage_denied');

reset role;
update public.agreement_execution set state=jsonb_set(state,'{milestones,0,disputedAt}',to_jsonb(now()-interval '25 hours')) where project_id=(select id from probe_project);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=2),true);
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'primary_after_handoff_denied');
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=3),true);
select pg_temp.probe_assert((select count(*)=1 from public.evidence where project_id=(select id from probe_project)),'backup_after_handoff');
reset role;
update public.agreement_execution set state=jsonb_set(jsonb_set(state,'{milestones,0,state}','"PAYMENT_PENDING"'),'{milestones,0,allocation}','{"clientUnits":"0","freelancerUnits":"100"}') where project_id=(select id from probe_project);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=3),true);
select pg_temp.probe_assert((select count(*)=1 from public.evidence where project_id=(select id from probe_project)),'backup_pending_allocation');
reset role;
update public.agreement_execution set state=jsonb_set(state,'{milestones,0,state}','"PAID"') where project_id=(select id from probe_project);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=3),true);
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'reviewer_paid_revocation');
select pg_temp.probe_assert((select count(*)=0 from storage.objects where name like (select id::text||'/%' from probe_project)),'reviewer_paid_storage_revocation');
-- Exercise the legacy branch of the merged policy separately from PAP access.
reset role;
insert into public.milestone_cache(project_id,agreement_version,milestone_index,chain_address,state,amount_units,delivery_deadline,backup_at,reviewer_wallet,backup_reviewer_wallet,verified_at,finalized_slot)
 select p.id,1,0,'synthetic-chain-reference','disputed','100',now(),now()+interval '1 hour',r.wallet,b.wallet,now(),1
 from probe_project p,probe_users r,probe_users b where r.n=2 and b.n=3;
set local role authenticated;
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=2),true);
select pg_temp.probe_assert((select count(*)=1 from public.evidence where project_id=(select id from probe_project)),'legacy_primary_exact_milestone');
reset role;
update public.milestone_cache set verified_at=now()-interval '3 minutes' where project_id=(select id from probe_project);
set local role authenticated;
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'legacy_stale_snapshot_denied');
reset role;
update public.milestone_cache set verified_at=now(),backup_at=now() where project_id=(select id from probe_project);
set local role authenticated;
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'legacy_primary_at_handoff_denied');
select set_config('request.jwt.claim.sub',(select id::text from probe_users where n=3),true);
select pg_temp.probe_assert((select count(*)=1 from public.evidence where project_id=(select id from probe_project)),'legacy_backup_at_handoff');
reset role;
update public.milestone_cache set state='settled',client_refunded='100' where project_id=(select id from probe_project);
set local role authenticated;
select pg_temp.probe_assert((select count(*)=0 from public.evidence where project_id=(select id from probe_project)),'legacy_settled_revocation');
set local role anon;
select pg_temp.probe_denied('select * from public.evidence','anonymous_evidence_denied');
select pg_temp.probe_denied('select * from public.agreement_execution','anonymous_execution_denied');
reset role;
set local role service_role;
select pg_temp.probe_assert(public.consume_api_limit((select id from probe_users where n=0),'read',1),'server_quota_first_allowed');
select pg_temp.probe_assert(not public.consume_api_limit((select id from probe_users where n=0),'read',1),'server_quota_cutoff');
reset role;
-- Only bounded case labels and counts leave this transaction.
select jsonb_build_object('kind','hosted-database-role-probe','status','passed','checks',jsonb_agg(jsonb_build_object('name',name,'passed',passed) order by name),'limitation','Simulated claims and Storage metadata only; no browser sessions, object bytes, or payments verified.') as report from probe_checks;
rollback;
