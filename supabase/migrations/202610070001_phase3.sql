-- Phase 3: private project metadata and off-chain signed agreements.
-- Never derive authorization from user_metadata or accept a client-supplied role.
begin;
create or replace function public.current_solana_wallet() returns text
language sql stable security definer set search_path = '' as $$
 select case when count(*)=1 then min(substring(i.provider_id from 13)) else null end
 from auth.identities i where i.user_id=auth.uid() and i.provider='web3'
 and i.provider_id ~ '^web3:solana:[1-9A-HJ-NP-Za-km-z]{32,44}$';
$$;
revoke all on function public.current_solana_wallet() from public;
grant execute on function public.current_solana_wallet() to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (length(display_name) between 1 and 80)
);
create table public.projects (
 id uuid primary key,
 title text not null check(length(title) between 3 and 120),
 client_wallet text not null, freelancer_wallet text not null,
 current_version integer not null check(current_version>0),
 locked boolean not null default false,
 created_at timestamptz not null default now(),
 check(client_wallet<>freelancer_wallet)
);
create table public.project_members (
 project_id uuid not null references public.projects(id),
 wallet text not null,
 role text not null check(role in ('client','freelancer')),
 primary key(project_id,wallet),unique(project_id,role)
);
create table public.agreements (
 project_id uuid not null references public.projects(id),
 version integer not null check(version>0),
 terms jsonb not null,
 salt text not null check(salt ~ '^[a-f0-9]{64}$'),
 commitment text not null check(commitment ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 primary key(project_id,version),
 check(terms->>'projectId'=project_id::text),
 check((terms->>'version')::integer=version),
 check(terms->>'network'='devnet'),
 check(jsonb_typeof(terms->'milestones')='array' and jsonb_array_length(terms->'milestones') between 1 and 20)
);
create table public.agreement_acceptances (
 project_id uuid not null, version integer not null,
 wallet text not null,
 commitment text not null check(commitment ~ '^[a-f0-9]{64}$'),
 signed_message text not null check(length(signed_message) between 1 and 2000),
 signature text not null check(length(signature) between 80 and 100),
 accepted_at timestamptz not null default now(),
 primary key(project_id,version,wallet),
 foreign key(project_id,version) references public.agreements(project_id,version),
 foreign key(project_id,wallet) references public.project_members(project_id,wallet)
);
create index projects_client on public.projects(client_wallet);
create index projects_freelancer on public.projects(freelancer_wallet);

create or replace function public.is_project_participant(p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.projects p where p.id=p_project and
 public.current_solana_wallet() in (p.client_wallet,p.freelancer_wallet));
$$;
revoke all on function public.is_project_participant(uuid) from public;
grant execute on function public.is_project_participant(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.agreements enable row level security;
alter table public.agreement_acceptances enable row level security;
revoke all on public.profiles,public.projects,public.project_members,public.agreements,public.agreement_acceptances from anon,authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select on public.projects,public.project_members,public.agreements,public.agreement_acceptances to authenticated;
grant all on public.profiles,public.projects,public.project_members,public.agreements,public.agreement_acceptances to service_role;
create policy own_profile_read on public.profiles for select to authenticated using(id=auth.uid());
create policy own_profile_insert on public.profiles for insert to authenticated with check(id=auth.uid());
create policy own_profile_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy participant_projects on public.projects for select to authenticated using(public.is_project_participant(id));
create policy participant_members on public.project_members for select to authenticated using(public.is_project_participant(project_id));
create policy participant_agreements on public.agreements for select to authenticated using(public.is_project_participant(project_id));
create policy participant_acceptances on public.agreement_acceptances for select to authenticated using(public.is_project_participant(project_id));

-- Only the server's service role can call mutations. API verifies Auth.getUser,
-- participant membership, strict input schema and (for acceptance) Ed25519 signature.
-- Row locks provide compare-and-swap protection against concurrent revisions/acceptance.
create or replace function public.save_agreement_version(
 p_project uuid,p_actor text,p_expected_version integer,p_terms jsonb,p_salt text,p_commitment text
) returns integer language plpgsql security definer set search_path='' as $$
declare current_row public.projects; next_version integer;
begin
 if p_actor is null or p_terms->>'clientWallet' is null or p_terms->>'freelancerWallet' is null
 or p_actor not in (p_terms->>'clientWallet',p_terms->>'freelancerWallet') then raise exception 'not participant'; end if;
 if p_expected_version=0 then
  next_version:=1;
  insert into public.projects(id,title,client_wallet,freelancer_wallet,current_version)
  values(p_project,p_terms->>'title',p_terms->>'clientWallet',p_terms->>'freelancerWallet',1);
  insert into public.project_members values(p_project,p_terms->>'clientWallet','client'),(p_project,p_terms->>'freelancerWallet','freelancer');
 else
  select * into current_row from public.projects where id=p_project for update;
  if not found then raise exception 'not found'; end if;
  if current_row.locked or current_row.current_version<>p_expected_version then raise exception 'version conflict or locked'; end if;
  if p_actor not in (current_row.client_wallet,current_row.freelancer_wallet)
  or p_terms->>'clientWallet'<>current_row.client_wallet or p_terms->>'freelancerWallet'<>current_row.freelancer_wallet then raise exception 'participants immutable'; end if;
  next_version:=p_expected_version+1;
  update public.projects set title=p_terms->>'title',current_version=next_version where id=p_project;
 end if;
 insert into public.agreements(project_id,version,terms,salt,commitment) values(p_project,next_version,p_terms,p_salt,p_commitment);
 return next_version;
end $$;
create or replace function public.record_agreement_acceptance(
 p_project uuid,p_actor text,p_version integer,p_commitment text,p_message text,p_signature text
) returns void language plpgsql security definer set search_path='' as $$
declare current_row public.projects; expected_hash text;
begin
 select * into current_row from public.projects where id=p_project for update;
 if not found then raise exception 'not found';end if;
 if p_actor is null or p_actor not in (current_row.client_wallet,current_row.freelancer_wallet) then raise exception 'not participant';end if;
 if current_row.current_version<>p_version or current_row.locked then raise exception 'version conflict or locked';end if;
 select commitment into expected_hash from public.agreements where project_id=p_project and version=p_version;
 if expected_hash is distinct from p_commitment then raise exception 'commitment mismatch';end if;
 insert into public.agreement_acceptances(project_id,version,wallet,commitment,signed_message,signature)
 values(p_project,p_version,p_actor,p_commitment,p_message,p_signature)
 on conflict(project_id,version,wallet) do nothing;
end $$;
revoke all on function public.save_agreement_version(uuid,text,integer,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.record_agreement_acceptance(uuid,text,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.save_agreement_version(uuid,text,integer,jsonb,text,text) to service_role;
grant execute on function public.record_agreement_acceptance(uuid,text,integer,text,text,text) to service_role;
commit;
