begin;
-- Only trusted reconciliation writes cache/events. Browser writes never establish chain state.
create table public.milestone_cache (
 project_id uuid not null, agreement_version integer not null, milestone_index integer not null check(milestone_index between 0 and 19),
 chain_address text not null, state text not null check(state in ('funded','submitted','disputed','settled')),
 amount_units text not null check(amount_units ~ '^[1-9][0-9]{0,19}$' and amount_units::numeric<=18446744073709551615),
 client_refunded text not null default '0' check(client_refunded ~ '^[0-9]{1,20}$'),
 freelancer_paid text not null default '0' check(freelancer_paid ~ '^[0-9]{1,20}$'),
 delivery_deadline timestamptz not null, review_deadline timestamptz, backup_at timestamptz,
 reviewer_wallet text not null, backup_reviewer_wallet text not null,
 submission_commitment text, dispute_commitment text,
 verified_at timestamptz not null, finalized_slot bigint not null check(finalized_slot>=0),
 primary key(project_id,milestone_index), foreign key(project_id,agreement_version) references public.agreements(project_id,version),
 check(client_refunded::numeric+freelancer_paid::numeric<=amount_units::numeric),
 check(state<>'settled' or client_refunded::numeric+freelancer_paid::numeric=amount_units::numeric),
 check(state not in ('submitted','disputed') or review_deadline is not null or state='disputed'),
 check(state<>'disputed' or backup_at is not null)
);
create index milestone_reviewers on public.milestone_cache(reviewer_wallet,state);
create index milestone_backups on public.milestone_cache(backup_reviewer_wallet,state);
create or replace function private.is_milestone_reviewer(p_project uuid,p_version integer,p_index integer) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.milestone_cache m
 where m.project_id=p_project and m.agreement_version=p_version and m.milestone_index=p_index and m.state='disputed'
 and m.verified_at between now()-interval '2 minutes' and now()
 and private.current_solana_wallet()=case when now()<m.backup_at then m.reviewer_wallet else m.backup_reviewer_wallet end);
$$;
create or replace function private.can_access_milestone(p_project uuid,p_version integer,p_index integer) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_project_participant(p_project) or private.is_milestone_reviewer(p_project,p_version,p_index);
$$;
create table public.evidence (
 id uuid primary key, project_id uuid not null, agreement_version integer not null,
 milestone_index integer not null check(milestone_index between 0 and 19), uploader_wallet text not null,
 purpose text not null check(purpose in ('delivery','dispute')), title text not null check(length(title) between 3 and 120),
 note text not null default '' check(length(note)<=2000), kind text not null check(kind in ('file','link')),
 external_url text, storage_path text unique, filename text, mime_type text, byte_size integer,
 file_hash text check(file_hash is null or file_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in ('pending','ready')),
 salt text check(salt is null or salt ~ '^[a-f0-9]{64}$'), commitment text check(commitment is null or commitment ~ '^[a-f0-9]{64}$'), manifest jsonb,
 created_at timestamptz not null default now(), completed_at timestamptz,
 foreign key(project_id,agreement_version) references public.agreements(project_id,version),
 check((kind='file' and external_url is null and storage_path=project_id::text||'/'||id::text and filename is not null and byte_size between 1 and 20971520 and mime_type is not null)
 or (kind='link' and external_url like 'https://%' and storage_path is null and byte_size is null)),
 check(status<>'ready' or (commitment is not null and salt is not null and manifest is not null and completed_at is not null))
);
create index evidence_milestone on public.evidence(project_id,agreement_version,milestone_index,created_at);
create table public.transaction_events (
 project_id uuid not null references public.projects(id), signature text not null check(signature ~ '^[1-9A-HJ-NP-Za-km-z]{87,88}$'),
 milestone_index integer check(milestone_index between 0 and 19), event_kind text not null check(length(event_kind) between 1 and 80),
 status text not null check(status in ('pending','confirmed','finalized','failed')), slot bigint check(slot>=0), created_at timestamptz not null default now(),
 primary key(project_id,signature,event_kind)
);
create table public.notification_receipts (
 user_id uuid not null references auth.users(id) on delete cascade, notice_key text not null check(notice_key ~ '^[a-f0-9]{64}$'),
 dismissed_at timestamptz not null default now(), primary key(user_id,notice_key)
);
create table public.support_members (user_id uuid primary key references auth.users(id) on delete cascade);
create or replace function private.is_support() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.support_members where user_id=auth.uid());
$$;
create table public.support_notes (
 id uuid primary key, project_id uuid not null references public.projects(id), author_id uuid not null references auth.users(id),
 note text not null check(length(note) between 1 and 2000), created_at timestamptz not null default now()
);
create or replace function private.can_upload_evidence(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.evidence e where e.storage_path=p_path and e.kind='file' and e.status='pending'
 and e.created_at>now()-interval '10 minutes' and e.uploader_wallet=private.current_solana_wallet() and private.is_project_participant(e.project_id));
$$;
create or replace function private.can_read_evidence_file(p_path text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.evidence e where e.storage_path=p_path and
 ((e.status='ready' and private.can_access_milestone(e.project_id,e.agreement_version,e.milestone_index))
 or (e.status='pending' and e.uploader_wallet=private.current_solana_wallet() and private.is_project_participant(e.project_id))));
$$;
revoke all on function private.is_milestone_reviewer(uuid,integer,integer),private.can_access_milestone(uuid,integer,integer),private.is_support(),private.can_upload_evidence(text),private.can_read_evidence_file(text) from public,anon;
grant execute on function private.is_milestone_reviewer(uuid,integer,integer),private.can_access_milestone(uuid,integer,integer),private.is_support(),private.can_upload_evidence(text),private.can_read_evidence_file(text) to authenticated;
alter table public.milestone_cache enable row level security;
alter table public.evidence enable row level security;
alter table public.transaction_events enable row level security;
alter table public.notification_receipts enable row level security;
alter table public.support_members enable row level security;
alter table public.support_notes enable row level security;
revoke all on public.milestone_cache,public.evidence,public.transaction_events,public.notification_receipts,public.support_members,public.support_notes from anon,authenticated;
grant select on public.milestone_cache,public.evidence,public.transaction_events,public.support_members,public.support_notes to authenticated;
grant select,insert,update on public.notification_receipts to authenticated;
grant all on public.milestone_cache,public.evidence,public.transaction_events,public.notification_receipts,public.support_members,public.support_notes to service_role;
create policy cache_read on public.milestone_cache for select to authenticated using(private.can_access_milestone(project_id,agreement_version,milestone_index));
create policy evidence_read on public.evidence for select to authenticated using(
 (status='ready' and private.can_access_milestone(project_id,agreement_version,milestone_index))
 or (uploader_wallet=private.current_solana_wallet() and private.is_project_participant(project_id)));
create policy transactions_read on public.transaction_events for select to authenticated using(private.is_project_participant(project_id)
 or exists(select 1 from public.milestone_cache m where m.project_id=transaction_events.project_id and m.milestone_index=transaction_events.milestone_index and private.is_milestone_reviewer(m.project_id,m.agreement_version,m.milestone_index)));
create policy own_receipts_read on public.notification_receipts for select to authenticated using(user_id=auth.uid());
create policy own_receipts_insert on public.notification_receipts for insert to authenticated with check(user_id=auth.uid());
create policy own_receipts_update on public.notification_receipts for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy support_own_membership on public.support_members for select to authenticated using(user_id=auth.uid());
create policy support_notes_read on public.support_notes for select to authenticated using(private.is_support());
-- Reviewers see only the agreement version for a fresh, active assigned dispute.
create policy reviewer_agreement on public.agreements for select to authenticated using(exists(
 select 1 from public.milestone_cache m where m.project_id=agreements.project_id and m.agreement_version=agreements.version
 and private.is_milestone_reviewer(m.project_id,m.agreement_version,m.milestone_index)));
-- Immutable completion, service-role only, with a row lock to prevent concurrent rewrites.
create function public.complete_evidence(p_id uuid,p_actor text,p_file_hash text,p_salt text,p_commitment text,p_manifest jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.evidence;
begin
 select * into e from public.evidence where id=p_id for update;
 if not found or p_actor is null or e.uploader_wallet<>p_actor or e.status<>'pending' or e.created_at<=now()-interval '10 minutes' then raise exception 'evidence unavailable'; end if;
 if not exists(select 1 from public.projects p where p.id=e.project_id and p_actor in (p.client_wallet,p.freelancer_wallet)) then raise exception 'not participant'; end if;
 if e.kind='file' and (p_file_hash is null or p_file_hash<>e.file_hash) then raise exception 'file hash mismatch'; end if;
 update public.evidence set status='ready',salt=p_salt,commitment=p_commitment,manifest=p_manifest,completed_at=now() where id=p_id;
end $$;
revoke all on function public.complete_evidence(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.complete_evidence(uuid,text,text,text,text,jsonb) to service_role;
-- STORAGE section: private, bounded, append-only authenticated uploads; no browser overwrite/delete.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('pactlance-evidence','pactlance-evidence',false,20971520,array['application/pdf','image/png','image/jpeg','video/mp4','application/zip','text/plain']);
create policy phase6_file_insert on storage.objects for insert to authenticated with check(bucket_id='pactlance-evidence' and private.can_upload_evidence(name));
create policy phase6_file_read on storage.objects for select to authenticated using(bucket_id='pactlance-evidence' and private.can_read_evidence_file(name));
commit;
