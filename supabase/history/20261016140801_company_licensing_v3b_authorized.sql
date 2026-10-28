-- AUTHORIZED PRODUCTION V3B. No new identity, invitation, password, email or billing.
-- Apply once to seosxvydjvsulhcpljyy after rehearsal. Full transaction, no intermediate cutover.
begin;
set local lock_timeout='3s';set local statement_timeout='45s';
lock table public.pi_companies,public.pi_company_memberships,public.pi_assessments,pi_access_private.accounts,pi_access_private.masters,pi_access_private.invitations in share row exclusive mode;
-- Production-specific assertions/mapping omitted from this public source export.
-- LOCAL REVIEW ONLY. Requires the already-reviewed access baseline; no bootstrap or user grants.
-- Existing activation/expiry values are preserved. All administrative writes are atomic.
alter table pi_access_private.accounts add column trial_days integer not null default 7 check(trial_days between 1 and 90);
alter table pi_access_private.invitations add column trial_days integer not null default 7 check(trial_days between 1 and 90);
-- Discover the unnamed original duration check, refuse ambiguous schemas.
do $$ declare n text; c integer; begin
select count(*),min(conname) into c,n from pg_constraint where conrelid='pi_access_private.accounts'::regclass and contype='c' and pg_get_constraintdef(oid) like '%168%';
if c<>1 then raise exception 'baseline_trial_constraint_mismatch'; end if;
execute format('alter table pi_access_private.accounts drop constraint %I',n);
end $$;
alter table pi_access_private.accounts add constraint pi_trial_period_valid check(
 (access_kind='trial' and ((activated_at is null and expires_at is null) or
 (activated_at is not null and expires_at is not null and expires_at>activated_at and expires_at<=activated_at+interval '8760 hours')))
 or (access_kind='standard' and expires_at is null));
create table pi_access_private.admin_changes(
 id uuid primary key default gen_random_uuid(), occurred_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id), target_user_id uuid references auth.users(id),
 company_id uuid not null references public.pi_companies(id),
 event text not null check(event in ('company_created','company_edited','trial_planned','trial_extended')),
 before_value jsonb not null, after_value jsonb not null,
 reason text check(reason is null or char_length(btrim(reason)) between 10 and 500));
alter table pi_access_private.admin_changes enable row level security;
alter table pi_access_private.admin_changes force row level security;
revoke all on pi_access_private.admin_changes from public,anon,authenticated,service_role;
create trigger pi_admin_changes_append_only before update or delete on pi_access_private.admin_changes
for each row execute function pi_access_private.reject_activity_change();

create function pi_access_private.company_save(p_name text,p_company_id uuid default null,p_expected_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_old text; v_name text:=btrim(p_name);
begin
 perform pi_access_private.require_master();
 if v_name is null or char_length(v_name) not between 2 and 160 or v_name ~ '[[:cntrl:]]' then raise exception 'invalid_company_name' using errcode='22023'; end if;
 if p_company_id is null then
  insert into public.pi_companies(name) values(v_name) returning id into v_id;
 else
  select name into v_old from public.pi_companies where id=p_company_id for update;
  if not found or v_old is distinct from p_expected_name then raise exception 'company_changed_reload' using errcode='40001'; end if;
  update public.pi_companies set name=v_name where id=p_company_id; v_id:=p_company_id;
 end if;
 insert into pi_access_private.admin_changes(actor_id,company_id,event,before_value,after_value)
 values(auth.uid(),v_id,case when p_company_id is null then 'company_created' else 'company_edited' end,jsonb_build_object('name',v_old),jsonb_build_object('name',v_name));
 return jsonb_build_object('id',v_id,'name',v_name);
end $$;

create function pi_access_private.prepare_invite_v2(p_email text,p_company_id uuid,p_role text,p_trial_days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform pi_access_private.require_master();
 if p_trial_days is null or p_trial_days not between 1 and 90 then raise exception 'invalid_trial_days' using errcode='22023'; end if;
 v_result:=pi_access_private.prepare_invite(p_email,p_company_id,p_role);
 update pi_access_private.invitations set trial_days=p_trial_days where id=(v_result->>'invitation_id')::uuid;
 return v_result||jsonb_build_object('trial_days',p_trial_days);
end $$;

create function pi_access_private.trial_plan(p_user_id uuid,p_company_id uuid,p_days integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_old integer; v_start timestamptz;
begin
 perform pi_access_private.require_master();
 if p_days is null or p_days not between 1 and 90 then raise exception 'invalid_trial_days' using errcode='22023'; end if;
 select trial_days,activated_at into v_old,v_start from pi_access_private.accounts where user_id=p_user_id and access_kind='trial' for update;
 if not found or v_start is not null then raise exception 'trial_already_started_or_missing' using errcode='22023'; end if;
 if not exists(select 1 from public.pi_company_memberships where user_id=p_user_id and company_id=p_company_id) then raise exception 'membership_required' using errcode='42501'; end if;
 update pi_access_private.accounts set trial_days=p_days where user_id=p_user_id;
 insert into pi_access_private.admin_changes(actor_id,target_user_id,company_id,event,before_value,after_value)
 values(auth.uid(),p_user_id,p_company_id,'trial_planned',jsonb_build_object('days',v_old),jsonb_build_object('days',p_days));
 return jsonb_build_object('trial_days',p_days);
end $$;

create function pi_access_private.trial_extend(p_user_id uuid,p_company_id uuid,p_expected_expiry timestamptz,p_new_expiry timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a pi_access_private.accounts%rowtype;
begin
 perform pi_access_private.require_master();
 select * into a from pi_access_private.accounts where user_id=p_user_id for update;
 if not found or a.access_kind<>'trial' or a.activated_at is null or not exists(select 1 from public.pi_company_memberships where user_id=p_user_id and company_id=p_company_id) then raise exception 'started_trial_required' using errcode='22023'; end if;
 if a.expires_at is distinct from p_expected_expiry then raise exception 'trial_changed_reload' using errcode='40001'; end if;
 if p_new_expiry is null or p_new_expiry<=a.expires_at or p_new_expiry<=statement_timestamp() or p_new_expiry>a.expires_at+interval '2160 hours' or p_new_expiry>a.activated_at+interval '8760 hours' or p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'invalid_extension' using errcode='22023'; end if;
 update pi_access_private.accounts set expires_at=p_new_expiry where user_id=p_user_id;
 insert into pi_access_private.admin_changes(actor_id,target_user_id,company_id,event,before_value,after_value,reason)
 values(auth.uid(),p_user_id,p_company_id,'trial_extended',jsonb_build_object('expires_at',a.expires_at),jsonb_build_object('expires_at',p_new_expiry),btrim(p_reason));
 return jsonb_build_object('expires_at',p_new_expiry,'access_state',a.access_state);
end $$;

create or replace function pi_access_private.approve(p_user_id uuid,p_company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_membership public.pi_company_memberships%rowtype; v_now timestamptz:=clock_timestamp();
begin
  perform pi_access_private.require_master();
  if p_user_id=auth.uid() or exists(select 1 from pi_access_private.masters where user_id=p_user_id and revoked_at is null) then
    raise exception 'master_provisioning_requires_separate_review' using errcode='42501';
  end if;
  -- Lock comum da conta serializa aprovacoes/revogacoes em empresas distintas.
  perform 1 from pi_access_private.accounts where user_id=p_user_id for update;
  select * into v_membership from public.pi_company_memberships where company_id=p_company_id and user_id=p_user_id for update;
  if not found or not exists (select 1 from pi_access_private.invitations i join auth.users u on u.id=i.auth_user_id
      where i.id=v_membership.invitation_id and i.invitation_state='accepted' and i.auth_user_id=p_user_id
        and i.company_id=p_company_id and u.email_confirmed_at is not null) then
    raise exception 'accepted_invitation_required' using errcode='22023';
  end if;
  update pi_access_private.accounts set access_state='approved',revoked_at=null,
    activated_at=coalesce(activated_at,v_now),expires_at=coalesce(expires_at,v_now+trial_days*interval '24 hours')
    where user_id=p_user_id and access_kind='trial';
  if not found then raise exception 'trial_account_required' using errcode='22023'; end if;
  update public.pi_company_memberships set access_state='active',approved_by=auth.uid(),
    approved_at=coalesce(approved_at,v_now),revoked_at=null where company_id=p_company_id and user_id=p_user_id;
  insert into pi_access_private.activity(actor_id,target_user_id,company_id,event)
    values(auth.uid(),p_user_id,p_company_id,'access_approved');
  return jsonb_build_object('user_id',p_user_id,'company_id',p_company_id,'status','approved');
end;
$$;
create or replace function pi_access_private.accept_invite(p_invitation_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_inv pi_access_private.invitations%rowtype; v_uid uuid:=auth.uid(); v_email text; v_count integer;
begin
  select lower(email) into v_email from auth.users where id=v_uid and email_confirmed_at is not null;
  if v_uid is null or v_email is null then raise exception 'verified_identity_required' using errcode='42501'; end if;
  if p_invitation_id is null then
    select count(*) into v_count from pi_access_private.invitations
      where email=v_email and auth_user_id=v_uid and invitation_state in ('offered','sent') and expires_at>statement_timestamp();
    if v_count<>1 then raise exception 'explicit_invitation_required' using errcode='22023'; end if;
  end if;
  select * into v_inv from pi_access_private.invitations where email=v_email and auth_user_id=v_uid
    and (p_invitation_id is null or id=p_invitation_id) and invitation_state in ('offered','sent')
    and expires_at>statement_timestamp() for update;
  if not found then raise exception 'invalid_invitation' using errcode='22023'; end if;
  -- Nunca substitui cargo/vinculo existente; esta RPC nao permite reativacao.
  insert into public.pi_company_memberships(company_id,user_id,role_name,invitation_id)
    values(v_inv.company_id,v_uid,v_inv.role_name,v_inv.id);
  insert into pi_access_private.accounts(user_id,trial_days) values(v_uid,v_inv.trial_days) on conflict(user_id) do nothing;
  update pi_access_private.invitations set invitation_state='accepted',accepted_at=clock_timestamp() where id=v_inv.id;
  insert into pi_access_private.activity(actor_id,target_user_id,company_id,event,object_id)
    values(v_uid,v_uid,v_inv.company_id,'invite_accepted',v_inv.id);
  return pi_access_private.access_status(v_inv.company_id);
end;
$$;

create function pi_access_private.access_status_v2(p_company_id uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
select pi_access_private.access_status(p_company_id)||jsonb_build_object('version',2,
 'trial_days',(select trial_days from pi_access_private.accounts where user_id=auth.uid()),
 'can_manage_company',coalesce(pi_gestao_private.has_company_role(p_company_id,array['admin']),false));
$$;

-- Minimal session projection. Counts are persisted Auth records, NOT currently online users.
create function pi_access_private.session_summary(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v jsonb;
begin
 if not pi_access_private.is_master() then return null; end if;
 if to_regclass('auth.sessions') is null then return null; end if;
 execute 'select jsonb_build_object(''records'',count(*),''last_created_at'',max(created_at),''observed_span_seconds'',max(greatest(0,extract(epoch from(updated_at-created_at))))) from auth.sessions where user_id=$1' into v using p_user;
 return v;
exception when undefined_column then return null;
end $$;

create function pi_access_private.dashboard(p_company_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_master boolean:=pi_access_private.is_master(); v_companies jsonb; v_users jsonb; v_invites jsonb; v_activity jsonb; v_counts jsonb;
begin
 if not v_master and (p_company_id is null or not pi_gestao_private.has_company_role(p_company_id,array['admin'])) then raise exception 'company_admin_required' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]'::jsonb) into v_companies
 from public.pi_companies where (v_master or id=p_company_id) and (p_company_id is null or id=p_company_id);
 select coalesce(jsonb_agg(t.item order by t.company_name,t.email),'[]'::jsonb) into v_users from(
 select c.name company_name,u.email,jsonb_build_object('user_id',u.id,'email',u.email,'company_id',m.company_id,'company_name',c.name,
 'company_role',m.role_name,'is_master',exists(select 1 from pi_access_private.masters g where g.user_id=u.id and g.revoked_at is null),
 'status',case when a.access_state='revoked' or m.access_state='revoked' then 'revoked'
 when a.access_state='approved' and a.access_kind='trial' and a.expires_at<=statement_timestamp() then 'expired'
 when m.access_state='active' and pi_access_private.account_active(u.id) then 'active' else 'pending' end,
 'access_kind',a.access_kind,'trial_days',a.trial_days,'activated_at',a.activated_at,'expires_at',a.expires_at,
 'last_sign_in_at',case when v_master then u.last_sign_in_at else null end,
 'last_activity_at',(select max(l.occurred_at) from pi_access_private.activity l where l.actor_id=u.id and (v_master or l.company_id=p_company_id)),
 'entries',(select count(*) from pi_access_private.activity l where l.actor_id=u.id and l.event='session_opened' and (v_master or l.company_id=p_company_id)),
 'sessions',case when v_master then pi_access_private.session_summary(u.id) else null end) item
 from auth.users u left join public.pi_company_memberships m on m.user_id=u.id
 left join public.pi_companies c on c.id=m.company_id left join pi_access_private.accounts a on a.user_id=u.id
 where (v_master or m.company_id=p_company_id) and (p_company_id is null or m.company_id=p_company_id))t;
 select coalesce(jsonb_agg(jsonb_build_object('invitation_id',i.id,'email',i.email,'company_id',i.company_id,'company_name',c.name,'role',i.role_name,
 'status',case when i.invitation_state in('prepared','offered','sent') and i.expires_at<=statement_timestamp() then 'expired' else i.invitation_state end,
 'created_at',i.created_at,'expires_at',i.expires_at,'trial_days',coalesce(a.trial_days,i.trial_days),
 'activated_at',a.activated_at,'trial_expires_at',a.expires_at) order by i.created_at desc),'[]'::jsonb) into v_invites
 from pi_access_private.invitations i join public.pi_companies c on c.id=i.company_id left join pi_access_private.accounts a on a.user_id=i.auth_user_id
 where (v_master or i.company_id=p_company_id) and (p_company_id is null or i.company_id=p_company_id);
 select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc),'[]'::jsonb) into v_activity from(
 select e.*,actor.email actor_name,target.email target_name,c.name company_name from(
 select id,occurred_at,actor_id,target_user_id,company_id,event,null::jsonb before_value,null::jsonb after_value,null::text reason,source from pi_access_private.activity
 union all select id,occurred_at,actor_id,target_user_id,company_id,event,before_value,after_value,reason,'server' from pi_access_private.admin_changes)e
 left join auth.users actor on actor.id=e.actor_id left join auth.users target on target.id=e.target_user_id left join public.pi_companies c on c.id=e.company_id
 where (v_master or e.company_id=p_company_id) and (p_company_id is null or e.company_id=p_company_id)
 order by e.occurred_at desc,e.id limit 200)t;
 select jsonb_build_object('companies',jsonb_array_length(v_companies),'users',count(distinct x->>'user_id'),
 'active_trials',count(distinct x->>'user_id') filter(where x->>'access_kind'='trial' and x->>'status'='active'),
 'expiring_soon',count(distinct x->>'user_id') filter(where x->>'access_kind'='trial' and x->>'status'='active' and (x->>'expires_at')::timestamptz<=statement_timestamp()+interval '72 hours'),
 'pending_invitations',(select count(*) from jsonb_array_elements(v_invites)i where i->>'status' in('prepared','offered','sent'))) into v_counts
 from jsonb_array_elements(v_users)x;
 return jsonb_build_object('version',2,'is_master',v_master,'server_now',statement_timestamp(),'companies',v_companies,'users',v_users,'invitations',v_invites,'activity',v_activity,'metrics',v_counts);
end $$;

create function public.pi_access_status_v2(p_company_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.access_status_v2(p_company_id);$$;
revoke all on function public.pi_access_status_v2(uuid) from public,anon,service_role;
grant execute on function public.pi_access_status_v2(uuid) to authenticated;
revoke all on function pi_access_private.access_status_v2(uuid) from public,anon,service_role;
grant execute on function pi_access_private.access_status_v2(uuid) to authenticated;

create function public.pi_admin_dashboard(p_company_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.dashboard(p_company_id);$$;
revoke all on function public.pi_admin_dashboard(uuid) from public,anon,service_role;
grant execute on function public.pi_admin_dashboard(uuid) to authenticated;
revoke all on function pi_access_private.dashboard(uuid) from public,anon,service_role;
grant execute on function pi_access_private.dashboard(uuid) to authenticated;

create function public.pi_admin_company_save(p_name text,p_company_id uuid default null,p_expected_name text default null) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.company_save(p_name,p_company_id,p_expected_name);$$;
revoke all on function public.pi_admin_company_save(text,uuid,text) from public,anon,service_role;
grant execute on function public.pi_admin_company_save(text,uuid,text) to authenticated;
revoke all on function pi_access_private.company_save(text,uuid,text) from public,anon,service_role;
grant execute on function pi_access_private.company_save(text,uuid,text) to authenticated;

create function public.pi_admin_prepare_invite_v2(p_email text,p_company_id uuid,p_role text,p_trial_days integer) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.prepare_invite_v2(p_email,p_company_id,p_role,p_trial_days);$$;
revoke all on function public.pi_admin_prepare_invite_v2(text,uuid,text,integer) from public,anon,service_role;
grant execute on function public.pi_admin_prepare_invite_v2(text,uuid,text,integer) to authenticated;
revoke all on function pi_access_private.prepare_invite_v2(text,uuid,text,integer) from public,anon,service_role;
grant execute on function pi_access_private.prepare_invite_v2(text,uuid,text,integer) to authenticated;

create function public.pi_admin_trial_plan(p_user_id uuid,p_company_id uuid,p_days integer) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.trial_plan(p_user_id,p_company_id,p_days);$$;
revoke all on function public.pi_admin_trial_plan(uuid,uuid,integer) from public,anon,service_role;
grant execute on function public.pi_admin_trial_plan(uuid,uuid,integer) to authenticated;
revoke all on function pi_access_private.trial_plan(uuid,uuid,integer) from public,anon,service_role;
grant execute on function pi_access_private.trial_plan(uuid,uuid,integer) to authenticated;

create function public.pi_admin_trial_extend(p_user_id uuid,p_company_id uuid,p_expected_expiry timestamptz,p_new_expiry timestamptz,p_reason text) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.trial_extend(p_user_id,p_company_id,p_expected_expiry,p_new_expiry,p_reason);$$;
revoke all on function public.pi_admin_trial_extend(uuid,uuid,timestamptz,timestamptz,text) from public,anon,service_role;
grant execute on function public.pi_admin_trial_extend(uuid,uuid,timestamptz,timestamptz,text) to authenticated;
revoke all on function pi_access_private.trial_extend(uuid,uuid,timestamptz,timestamptz,text) from public,anon,service_role;
grant execute on function pi_access_private.trial_extend(uuid,uuid,timestamptz,timestamptz,text) to authenticated;

revoke all on function pi_access_private.session_summary(uuid) from public,anon,authenticated,service_role;
create function pi_access_private.approve_v2(p_user_id uuid,p_company_id uuid,p_days integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform pi_access_private.require_master();
 if p_days is not null then perform pi_access_private.trial_plan(p_user_id,p_company_id,p_days); end if;
 return pi_access_private.approve(p_user_id,p_company_id);
end $$;
create function public.pi_admin_approve_v2(p_user_id uuid,p_company_id uuid,p_days integer default null) returns jsonb
language sql security invoker set search_path='' as $$select pi_access_private.approve_v2(p_user_id,p_company_id,p_days);$$;
revoke all on function pi_access_private.approve_v2(uuid,uuid,integer), public.pi_admin_approve_v2(uuid,uuid,integer) from public,anon,service_role;
grant execute on function pi_access_private.approve_v2(uuid,uuid,integer), public.pi_admin_approve_v2(uuid,uuid,integer) to authenticated;
-- LOCAL CANDIDATE ONLY. Default mode=legacy: no automatic cutover or date/seat inference.
create table pi_access_private.tenant_rollout(singleton boolean primary key default true check(singleton),enabled boolean not null default false,writes_paused boolean not null default false);
insert into pi_access_private.tenant_rollout default values;
create table pi_access_private.company_licenses(
 company_id uuid primary key references public.pi_companies(id),
 migration_state text not null check(migration_state in('review_required','new','ready')),
 license_state text not null default 'draft' check(license_state in('draft','active','suspended')),
 plan_kind text check(plan_kind in('trial','term','indefinite')),
 initial_days integer check(initial_days between 1 and 365),
 seat_limit integer check(seat_limit>=0),seats_used integer not null default 0 check(seats_used>=0),
 activated_at timestamptz,expires_at timestamptz,revision integer not null default 0,
 check(seat_limit is null or seats_used<=seat_limit),
 check(plan_kind is distinct from 'trial' or initial_days<=90),
 check((plan_kind='indefinite' and initial_days is null and expires_at is null) or (plan_kind is distinct from 'indefinite' and ((activated_at is null and expires_at is null) or (activated_at is not null and expires_at>activated_at)))),
 check(migration_state<>'ready' or (seat_limit is not null and (initial_days is not null or plan_kind='indefinite') and plan_kind is not null)),
 check(license_state<>'active' or (migration_state='ready' and activated_at is not null)));
-- Only factual occupancy is copied. No legacy activation, expiry or capacity is chosen.
insert into pi_access_private.company_licenses(company_id,migration_state,seats_used)
 select c.id,'review_required',count(m.user_id) filter(where m.access_state='active')
 from public.pi_companies c left join public.pi_company_memberships m on m.company_id=c.id group by c.id;
create table pi_access_private.tenant_changes(
 id uuid primary key default gen_random_uuid(),occurred_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references auth.users(id),company_id uuid not null references public.pi_companies(id),target_user_id uuid references auth.users(id),
 event text not null check(event in('license_configured','license_started','license_extended','license_suspended','license_resumed','membership_activated','membership_deactivated','company_named','mapping_resolved')),
 before_value jsonb not null,after_value jsonb not null,reason text not null check(char_length(btrim(reason)) between 10 and 500));
create index pi_tenant_changes_company_date on pi_access_private.tenant_changes(company_id,occurred_at desc);
create trigger pi_tenant_changes_append_only before update or delete on pi_access_private.tenant_changes for each row execute function pi_access_private.reject_activity_change();
alter table pi_access_private.tenant_rollout enable row level security; alter table pi_access_private.tenant_rollout force row level security;
alter table pi_access_private.company_licenses enable row level security; alter table pi_access_private.company_licenses force row level security;
alter table pi_access_private.tenant_changes enable row level security; alter table pi_access_private.tenant_changes force row level security;
revoke all on pi_access_private.tenant_rollout,pi_access_private.company_licenses,pi_access_private.tenant_changes from public,anon,authenticated,service_role;
create function pi_access_private.tenants_enabled() returns boolean language sql stable security definer set search_path='' as $$select enabled from pi_access_private.tenant_rollout where singleton;$$;
create function pi_access_private.tenant_write_guard() returns void language plpgsql security definer set search_path='' as $$begin
 if not pi_access_private.tenants_enabled() or (select writes_paused from pi_access_private.tenant_rollout where singleton) then raise exception 'tenant_writes_unavailable' using errcode='42501';end if;end $$;
create function pi_access_private.identity_verified(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and (banned_until is null or banned_until<=statement_timestamp()));$$;
create function pi_access_private.company_active(p_company uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from pi_access_private.company_licenses where company_id=p_company and migration_state='ready' and license_state='active' and activated_at<=statement_timestamp() and (plan_kind='indefinite' or expires_at>statement_timestamp()));$$;
-- Retain the legacy functions for a disabled rollout, but remove all client execution grants.
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.account_active(uuid)'::regprocedure),'FUNCTION pi_access_private.account_active(', 'FUNCTION pi_access_private.account_active_legacy(');end $copy$;
revoke all on function pi_access_private.account_active_legacy(uuid) from public,anon,authenticated,service_role;

-- Explicit global-administrator exemptions only, granted by the reviewed mapping operator.
create table pi_access_private.company_seat_exemptions(company_id uuid not null,user_id uuid not null,created_at timestamptz not null default clock_timestamp(),primary key(company_id,user_id),foreign key(company_id,user_id) references public.pi_company_memberships(company_id,user_id));
alter table pi_access_private.company_seat_exemptions enable row level security;alter table pi_access_private.company_seat_exemptions force row level security;
revoke all on pi_access_private.company_seat_exemptions from public,anon,authenticated,service_role;
create function pi_access_private.seat_exempt(p_user uuid,p_company uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from pi_access_private.company_seat_exemptions where user_id=p_user and company_id=p_company);$$;
create function pi_access_private.member_identity_allowed(p_user uuid,p_company uuid) returns boolean language sql stable security definer set search_path='' as $$select pi_access_private.identity_verified(p_user) and (not pi_access_private.seat_exempt(p_user,p_company) or (pi_access_private.account_active_legacy(p_user) and exists(select 1 from pi_access_private.masters where user_id=p_user and revoked_at is null)));$$;
create function pi_access_private.seat_exemption_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op<>'INSERT' then raise exception 'exemption_history_preserved';end if;
 if pi_access_private.tenants_enabled() or not (select writes_paused from pi_access_private.tenant_rollout where singleton) or not pi_access_private.identity_verified(new.user_id) or not pi_access_private.account_active_legacy(new.user_id) or not exists(select 1 from pi_access_private.masters where user_id=new.user_id and revoked_at is null) then raise exception 'reviewed_global_exemption_required';end if;
 if exists(select 1 from public.pi_company_memberships where user_id=new.user_id and company_id=new.company_id and access_state='active') then
 update pi_access_private.company_licenses set seats_used=seats_used-1 where company_id=new.company_id and seats_used>0;if not found then raise exception 'exemption_counter_mismatch';end if;end if;return new;end $$;
create trigger pi_seat_exemption_guard before insert or update or delete on pi_access_private.company_seat_exemptions for each row execute function pi_access_private.seat_exemption_guard();
revoke all on function pi_access_private.seat_exempt(uuid,uuid),pi_access_private.member_identity_allowed(uuid,uuid),pi_access_private.seat_exemption_guard() from public,anon,authenticated,service_role;

create or replace function pi_access_private.account_active(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when not pi_access_private.tenants_enabled() then pi_access_private.account_active_legacy(p_user) else
 pi_access_private.identity_verified(p_user) and (
 (exists(select 1 from pi_access_private.masters where user_id=p_user and revoked_at is null) and pi_access_private.account_active_legacy(p_user))
 or exists(select 1 from public.pi_company_memberships m where m.user_id=p_user and m.access_state='active' and m.role_name<>'client' and pi_access_private.company_active(m.company_id) and pi_access_private.member_identity_allowed(p_user,m.company_id))) end;$$;
-- Global admin keeps the original explicit bootstrap/revocation; tenant membership cannot create master.
create or replace function pi_access_private.is_master() returns boolean language sql stable security definer set search_path='' as $$
 select pi_access_private.identity_verified(auth.uid()) and pi_access_private.account_active_legacy(auth.uid()) and exists(select 1 from pi_access_private.masters where user_id=auth.uid() and revoked_at is null);$$;
do $copy$ begin execute replace(pg_get_functiondef('pi_gestao_private.has_company_role(uuid,text[])'::regprocedure),'FUNCTION pi_gestao_private.has_company_role(', 'FUNCTION pi_gestao_private.has_company_role_legacy(');end $copy$;
revoke all on function pi_gestao_private.has_company_role_legacy(uuid,text[]) from public,anon,authenticated,service_role;
create or replace function pi_gestao_private.has_company_role(p_company uuid,p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select case when not pi_access_private.tenants_enabled() then pi_gestao_private.has_company_role_legacy(p_company,p_roles) else
 pi_access_private.member_identity_allowed(auth.uid(),p_company) and pi_access_private.company_active(p_company) and exists(select 1 from public.pi_company_memberships where user_id=auth.uid() and company_id=p_company and access_state='active' and role_name=any(p_roles) and role_name<>'client') end;$$;
create function pi_access_private.tenant_manage(p_company uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if not pi_access_private.is_master() and not pi_gestao_private.has_company_role(p_company,array['admin']) then raise exception 'company_admin_required' using errcode='42501';end if;end $$;
create function pi_access_private.company_license_created() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into pi_access_private.company_licenses(company_id,migration_state) values(new.id,'new');return new;end $$;
create trigger pi_company_license_created after insert on public.pi_companies for each row execute function pi_access_private.company_license_created();

-- Capacity is an atomic counter on ONE tenant row, not a SELECT COUNT followed by INSERT.
-- READ COMMITTED re-evaluates the UPDATE predicate after concurrent updates; higher isolation aborts conflicts.
create function pi_access_private.membership_seat_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid; old_active boolean:=false;new_active boolean:=false;
begin
 if tg_op='UPDATE' and (new.company_id<>old.company_id or new.user_id<>old.user_id) then raise exception 'membership_identity_immutable';end if;
 if tg_op<>'INSERT' then old_active:=old.access_state='active';cid:=old.company_id;end if;
 if tg_op<>'DELETE' then new_active:=new.access_state='active';cid:=new.company_id;end if;
 if pi_access_private.tenants_enabled() then
  perform pi_access_private.tenant_write_guard();
  if tg_op='DELETE' then raise exception 'deactivate_preserve_history' using errcode='42501';end if;
 end if;
 if pi_access_private.seat_exempt(coalesce(new.user_id,old.user_id),cid) then if tg_op='DELETE' then return old;end if;return new;end if;
 if new_active and not old_active then
  update pi_access_private.company_licenses set seats_used=seats_used+1
   where company_id=cid and ((not pi_access_private.tenants_enabled() and seat_limit is null) or
   (migration_state='ready' and seat_limit is not null and seats_used<seat_limit and license_state='active' and (plan_kind='indefinite' or expires_at>clock_timestamp())));
  if not found then raise exception 'seat_unavailable_or_license_inactive' using errcode='23514';end if;
 elsif old_active and not new_active then
  update pi_access_private.company_licenses set seats_used=seats_used-1 where company_id=cid and seats_used>0;
  if not found then raise exception 'seat_counter_inconsistent';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger pi_membership_seat_guard before insert or update or delete on public.pi_company_memberships for each row execute function pi_access_private.membership_seat_guard();

create function pi_access_private.license_change(p_company_id uuid,p_action text,p_expected_revision integer,p_seat_limit integer,p_plan_kind text,p_days integer,p_new_expiry timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l pi_access_private.company_licenses%rowtype; old_value jsonb;result jsonb;ev text;
begin
 perform pi_access_private.tenant_write_guard();perform pi_access_private.require_master();
 if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'reason_required' using errcode='22023';end if;
 select * into l from pi_access_private.company_licenses where company_id=p_company_id for update;
 if not found or l.revision is distinct from p_expected_revision then raise exception 'license_changed_reload' using errcode='40001';end if;
 if l.migration_state='review_required' then raise exception 'legacy_mapping_required' using errcode='22023';end if;
 old_value:=to_jsonb(l);
 if p_action='configure' then
  if p_seat_limit is null or p_seat_limit<l.seats_used or p_plan_kind is null or p_plan_kind not in('trial','term','indefinite') or (p_plan_kind='indefinite' and p_days is not null) or (p_plan_kind<>'indefinite' and (p_days is null or p_days<1 or p_days>(case when p_plan_kind='trial' then 90 else 365 end))) then raise exception 'invalid_license_configuration' using errcode='22023';end if;
  if l.activated_at is not null and (p_plan_kind is distinct from l.plan_kind or p_days is distinct from l.initial_days) then raise exception 'initial_term_locked' using errcode='22023';end if;
  update pi_access_private.company_licenses set seat_limit=p_seat_limit,plan_kind=p_plan_kind,initial_days=p_days,migration_state='ready',revision=revision+1 where company_id=p_company_id;ev:='license_configured';
 elsif p_action='extend' then
  if l.plan_kind='indefinite' or l.activated_at is null or p_new_expiry is null or p_new_expiry<=l.expires_at or p_new_expiry<=clock_timestamp() or p_new_expiry>l.expires_at+interval '2160 hours' then raise exception 'invalid_extension' using errcode='22023';end if;
  update pi_access_private.company_licenses set expires_at=p_new_expiry,revision=revision+1 where company_id=p_company_id;ev:='license_extended';
 elsif p_action='suspend' then
  update pi_access_private.company_licenses set license_state='suspended',revision=revision+1 where company_id=p_company_id;ev:='license_suspended';
 elsif p_action='resume' then
  if l.activated_at is null or l.migration_state<>'ready' then raise exception 'started_license_required';end if;
  update pi_access_private.company_licenses set license_state='active',revision=revision+1 where company_id=p_company_id;ev:='license_resumed';
 else raise exception 'invalid_license_action' using errcode='22023';end if;
 select to_jsonb(x) into result from pi_access_private.company_licenses x where company_id=p_company_id;
 insert into pi_access_private.tenant_changes(actor_id,company_id,event,before_value,after_value,reason) values(auth.uid(),p_company_id,ev,old_value,result,btrim(p_reason));return result;
end $$;

create function pi_access_private.membership_change(p_user_id uuid,p_company_id uuid,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l pi_access_private.company_licenses%rowtype;m public.pi_company_memberships%rowtype;started timestamptz:=clock_timestamp();after_m jsonb;
begin
 perform pi_access_private.tenant_write_guard();
 -- Consistent lock order: company license, actor membership, target membership.
 select * into l from pi_access_private.company_licenses where company_id=p_company_id for update;
 if not found then raise exception 'license_missing';end if;
 if l.migration_state='review_required' then raise exception 'legacy_mapping_required' using errcode='22023';end if;
 perform 1 from public.pi_company_memberships where company_id=p_company_id and user_id=auth.uid() for update;
 perform pi_access_private.tenant_manage(p_company_id);
 if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'reason_required' using errcode='22023';end if;
 select * into m from public.pi_company_memberships where user_id=p_user_id and company_id=p_company_id for update;
 if not found then raise exception 'membership_required';end if;
 if not pi_access_private.is_master() and (p_user_id=auth.uid() or m.role_name='admin') then raise exception 'global_admin_required_for_manager' using errcode='42501';end if;
 if p_action='activate' then
  if m.access_state='active' then return jsonb_build_object('unchanged',true,'company_id',p_company_id,'user_id',p_user_id);end if;
  if not pi_access_private.member_identity_allowed(p_user_id,p_company_id) or not exists(select 1 from pi_access_private.invitations where id=m.invitation_id and company_id=p_company_id and auth_user_id=p_user_id and invitation_state='accepted') then raise exception 'accepted_invitation_required' using errcode='22023';end if;
  if l.migration_state<>'ready' or l.seat_limit is null or l.license_state='suspended' then raise exception 'configured_license_required' using errcode='22023';end if;
  if l.activated_at is null then
   -- Only a successful FIRST membership activation starts the company clock. Rollback if no seat.
   update pi_access_private.company_licenses set activated_at=started,expires_at=started+initial_days*interval '24 hours',license_state='active',revision=revision+1 where company_id=p_company_id;
   insert into pi_access_private.tenant_changes(actor_id,company_id,target_user_id,event,before_value,after_value,reason)
   select auth.uid(),p_company_id,p_user_id,'license_started',to_jsonb(l),to_jsonb(x),'Primeira aprovação de vínculo aceito.' from pi_access_private.company_licenses x where company_id=p_company_id;
  elsif l.expires_at<=started then raise exception 'company_term_expired' using errcode='42501';end if;
  update public.pi_company_memberships set access_state='active',approved_at=coalesce(approved_at,started),approved_by=auth.uid(),revoked_at=null where company_id=p_company_id and user_id=p_user_id;
 elsif p_action='deactivate' then
  if m.access_state='revoked' then return jsonb_build_object('unchanged',true,'company_id',p_company_id,'user_id',p_user_id);end if;
  update public.pi_company_memberships set access_state='revoked',revoked_at=started where company_id=p_company_id and user_id=p_user_id;
 else raise exception 'invalid_membership_action' using errcode='22023';end if;
 select to_jsonb(x) into after_m from public.pi_company_memberships x where company_id=p_company_id and user_id=p_user_id;
 insert into pi_access_private.tenant_changes(actor_id,company_id,target_user_id,event,before_value,after_value,reason)
 values(auth.uid(),p_company_id,p_user_id,case when p_action='activate' then 'membership_activated' else 'membership_deactivated' end,to_jsonb(m),after_m,btrim(p_reason));
 return after_m;
end $$;

create function pi_access_private.access_status_v3(p_company_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.pi_company_memberships%rowtype;l pi_access_private.company_licenses%rowtype;v_status text:='pending';v_master boolean:=pi_access_private.is_master();
begin
 if not pi_access_private.tenants_enabled() or not pi_access_private.identity_verified(auth.uid()) then return jsonb_build_object('version',3,'status','unavailable','user_id',auth.uid(),'is_master',false,'company_id',null,'company_role',null,'activated_at',null,'expires_at',null,'server_now',statement_timestamp());end if;
 select * into m from public.pi_company_memberships x where user_id=auth.uid() and (p_company_id is null or company_id=p_company_id)
 order by (x.access_state='active' and x.role_name<>'client' and pi_access_private.company_active(x.company_id)) desc,x.created_at,x.company_id limit 1;
 if m.user_id is null and not v_master then return jsonb_build_object('version',3,'user_id',auth.uid(),'status','pending','is_master',false,'company_id',p_company_id,'company_role',null,'activated_at',null,'expires_at',null,'server_now',statement_timestamp(),'license_scope','company');end if;
 if p_company_id is not null then m.company_id:=p_company_id;end if;
 select * into l from pi_access_private.company_licenses where company_id=m.company_id;
 if v_master and p_company_id is null then v_status:='active';
 elsif m.access_state='revoked' or l.license_state='suspended' then v_status:='revoked';
 elsif l.migration_state='review_required' or l.seat_limit is null then v_status:='pending';
 elsif l.expires_at<=statement_timestamp() then v_status:='expired';
 elsif m.access_state='active' and pi_access_private.member_identity_allowed(auth.uid(),m.company_id) and pi_access_private.company_active(m.company_id) then v_status:=case when m.role_name='client' then 'unavailable' else 'active' end;end if;
 return jsonb_build_object('version',3,'user_id',auth.uid(),'status',v_status,'is_master',v_master,
 'company_id',case when v_master and p_company_id is null then null else m.company_id end,'company_role',case when v_master and p_company_id is null then null else m.role_name end,
 'activated_at',case when v_master and p_company_id is null then null else l.activated_at end,'expires_at',case when v_master and p_company_id is null then null else l.expires_at end,
 'plan_kind',l.plan_kind,'trial_days',l.initial_days,'server_now',statement_timestamp(),'license_scope','company','can_manage_company',v_master or pi_gestao_private.has_company_role(m.company_id,array['admin']));
end $$;
-- Old callers fail closed on the new protocol. They cannot prolong a person's old global trial.
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.access_status(uuid)'::regprocedure),'FUNCTION pi_access_private.access_status(', 'FUNCTION pi_access_private.access_status_legacy(');end $copy$;
create or replace function pi_access_private.access_status(p_company_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$select case when pi_access_private.tenants_enabled() then pi_access_private.access_status_v3(p_company_id) else pi_access_private.access_status_legacy(p_company_id) end;$$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.access_status_v2(uuid)'::regprocedure),'FUNCTION pi_access_private.access_status_v2(', 'FUNCTION pi_access_private.access_status_v2_legacy(');end $copy$;
create or replace function pi_access_private.access_status_v2(p_company_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$select case when pi_access_private.tenants_enabled() then pi_access_private.access_status_v3(p_company_id) else pi_access_private.access_status_v2_legacy(p_company_id) end;$$;


create or replace function pi_access_private.prepare_invite(p_email text,p_company_id uuid,p_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_email text:=lower(btrim(p_email)); v_existing uuid; v_count integer;
begin
  if pi_access_private.tenants_enabled() then
  perform pi_access_private.tenant_write_guard();perform pi_access_private.tenant_manage(p_company_id);
  if p_role='admin' and not pi_access_private.is_master() then raise exception 'global_admin_required_for_manager' using errcode='42501';end if;
 else perform pi_access_private.require_master();end if;
  if v_email is null or char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('admin','planner','inspector','assistant','client')
    or not exists (select 1 from public.pi_companies where id=p_company_id) then
    raise exception 'invalid_invitation' using errcode='22023';
  end if;
  -- Serializa preparacoes concorrentes da mesma chave sem permitir reenvio.
  perform pg_advisory_xact_lock(hashtextextended(v_email || p_company_id::text,0));
  if exists (select 1 from public.pi_company_memberships m join auth.users u on u.id=m.user_id
    where m.company_id=p_company_id and lower(u.email)=v_email) then
    raise exception 'membership_already_exists' using errcode='22023';
  end if;
  if exists (select 1 from pi_access_private.invitations where email=v_email and company_id=p_company_id
    and invitation_state in ('prepared','offered','sent') and expires_at>statement_timestamp()) then
    raise exception 'invitation_already_pending' using errcode='22023';
  end if;
  update pi_access_private.invitations set invitation_state='revoked',revoked_at=clock_timestamp()
    where email=v_email and company_id=p_company_id and invitation_state in ('prepared','offered','sent');
  -- Conta Auth confirmada ja existe: convite empresarial IN-APP, nao um novo
  -- convite de criacao de conta. Nao chamar provider nem fingir envio por email.
  select count(*),min(u.id::text)::uuid into v_count,v_existing from auth.users u
    where lower(u.email)=v_email and u.email_confirmed_at is not null;
  if v_count>1 then raise exception 'invitation_identity_ambiguous' using errcode='22023'; end if;
  if v_existing is not null then
    insert into pi_access_private.invitations(email,company_id,role_name,created_by,invitation_state,delivery,auth_user_id)
      values(v_email,p_company_id,p_role,auth.uid(),'offered','in_app',v_existing) returning id into v_id;
    insert into pi_access_private.activity(actor_id,target_user_id,company_id,event,object_id)
      values(auth.uid(),v_existing,p_company_id,'invite_offered',v_id);
    return jsonb_build_object('invitation_id',v_id,'email',v_email,'company_id',p_company_id,'role',p_role,
      'status','offered','send_allowed',false,'existing_user',true,'delivery','in_app');
  end if;
  insert into pi_access_private.invitations(email,company_id,role_name,created_by)
    values(v_email,p_company_id,p_role,auth.uid()) returning id into v_id;
  insert into pi_access_private.activity(actor_id,company_id,event,object_id)
    values(auth.uid(),p_company_id,'invite_prepared',v_id);
  return jsonb_build_object('invitation_id',v_id,'email',v_email,'company_id',p_company_id,'role',p_role,
    'status','prepared','send_allowed',true,'existing_user',false,'delivery','email');
end;
$$;

do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.accept_invite(uuid)'::regprocedure),'FUNCTION pi_access_private.accept_invite(', 'FUNCTION pi_access_private.accept_invite_legacy(');end $copy$;
create or replace function pi_access_private.accept_invite(p_invitation_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then perform pi_access_private.tenant_write_guard();end if;return pi_access_private.accept_invite_legacy(p_invitation_id);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.company_save(text,uuid,text)'::regprocedure),'FUNCTION pi_access_private.company_save(', 'FUNCTION pi_access_private.company_save_legacy(');end $copy$;
revoke all on function pi_access_private.company_save_legacy(text,uuid,text) from public,anon,authenticated,service_role;
create or replace function pi_access_private.company_save(p_name text,p_company_id uuid default null,p_expected_name text default null) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if pi_access_private.tenants_enabled() then raise exception 'use_company_save_v3_api' using errcode='42501';end if;return pi_access_private.company_save_legacy(p_name,p_company_id,p_expected_name);end $$;

create function pi_access_private.company_save_v3(p_name text,p_company_id uuid,p_expected_name text,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin perform pi_access_private.tenant_write_guard();perform pi_access_private.require_master();
 if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'reason_required';end if;
 r:=pi_access_private.company_save_legacy(p_name,p_company_id,p_expected_name);
 insert into pi_access_private.tenant_changes(actor_id,company_id,event,before_value,after_value,reason) values(auth.uid(),(r->>'id')::uuid,'company_named',jsonb_build_object('name',p_expected_name),r,btrim(p_reason));return r;end $$;
create function pi_access_private.migration_map() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;begin perform pi_access_private.require_master();
 select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) into result from(
 select c.id company_id,c.name,l.migration_state,l.seat_limit,l.seats_used,
 count(distinct jsonb_build_array(a.access_kind,a.activated_at,a.expires_at,a.access_state)) filter(where a.user_id is not null) as distinct_legacy_terms,
 coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'membership_state',m.access_state,'role',m.role_name,'legacy_state',a.access_state,'legacy_kind',a.access_kind,'legacy_start',a.activated_at,'legacy_end',a.expires_at,'other_companies',(select count(*) from public.pi_company_memberships mm where mm.user_id=m.user_id))) filter(where m.user_id is not null),'[]'::jsonb) legacy_memberships
 from public.pi_companies c join pi_access_private.company_licenses l on l.company_id=c.id left join public.pi_company_memberships m on m.company_id=c.id left join pi_access_private.accounts a on a.user_id=m.user_id group by c.id,c.name,l.migration_state,l.seat_limit,l.seats_used)t;return result;end $$;

do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.approve(uuid,uuid)'::regprocedure),'FUNCTION pi_access_private.approve(', 'FUNCTION pi_access_private.approve_legacy(');end $copy$;
create or replace function pi_access_private.approve(p_user_id uuid,p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then return pi_access_private.membership_change(p_user_id,p_company_id,'activate','Aprovação explícita do vínculo.'); end if;return pi_access_private.approve_legacy(p_user_id,p_company_id);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.revoke_access(uuid,uuid)'::regprocedure),'FUNCTION pi_access_private.revoke_access(', 'FUNCTION pi_access_private.revoke_access_legacy(');end $copy$;
create or replace function pi_access_private.revoke_access(p_user_id uuid,p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then return pi_access_private.membership_change(p_user_id,p_company_id,'deactivate','Desativação explícita do vínculo.'); end if;return pi_access_private.revoke_access_legacy(p_user_id,p_company_id);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.trial_plan(uuid,uuid,integer)'::regprocedure),'FUNCTION pi_access_private.trial_plan(', 'FUNCTION pi_access_private.trial_plan_legacy(');end $copy$;
create or replace function pi_access_private.trial_plan(p_user_id uuid,p_company_id uuid,p_days integer) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_license_api' using errcode='42501'; end if;return pi_access_private.trial_plan_legacy(p_user_id,p_company_id,p_days);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.trial_extend(uuid,uuid,timestamptz,timestamptz,text)'::regprocedure),'FUNCTION pi_access_private.trial_extend(', 'FUNCTION pi_access_private.trial_extend_legacy(');end $copy$;
create or replace function pi_access_private.trial_extend(p_user_id uuid,p_company_id uuid,p_expected_expiry timestamptz,p_new_expiry timestamptz,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_license_api' using errcode='42501'; end if;return pi_access_private.trial_extend_legacy(p_user_id,p_company_id,p_expected_expiry,p_new_expiry,p_reason);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.approve_v2(uuid,uuid,integer)'::regprocedure),'FUNCTION pi_access_private.approve_v2(', 'FUNCTION pi_access_private.approve_v2_legacy(');end $copy$;
create or replace function pi_access_private.approve_v2(p_user_id uuid,p_company_id uuid,p_days integer default null) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_membership_api' using errcode='42501'; end if;return pi_access_private.approve_v2_legacy(p_user_id,p_company_id,p_days);end $$;
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.prepare_invite_v2(text,uuid,text,integer)'::regprocedure),'FUNCTION pi_access_private.prepare_invite_v2(', 'FUNCTION pi_access_private.prepare_invite_v2_legacy(');end $copy$;
create or replace function pi_access_private.prepare_invite_v2(p_email text,p_company_id uuid,p_role text,p_trial_days integer) returns jsonb language plpgsql security definer set search_path='' as $$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_invite_api' using errcode='42501'; end if;return pi_access_private.prepare_invite_v2_legacy(p_email,p_company_id,p_role,p_trial_days);end $$;

do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.dashboard(uuid)'::regprocedure),'FUNCTION pi_access_private.dashboard(', 'FUNCTION pi_access_private.dashboard_legacy(');end $copy$;
create function pi_access_private.dashboard_v3(p_company_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d jsonb;cs jsonb;us jsonb;ivs jsonb;acts jsonb;
begin
 if not pi_access_private.tenants_enabled() then raise exception 'tenant_rollout_pending' using errcode='42501';end if;
 d:=pi_access_private.dashboard_legacy(p_company_id);
 select coalesce(jsonb_agg(c||jsonb_build_object('license',to_jsonb(l)||jsonb_build_object(
 'status',case when l.migration_state='review_required' then 'review_required' when l.seat_limit is null then 'unconfigured' when l.license_state='suspended' then 'suspended' when l.expires_at<=statement_timestamp() then 'expired' when l.license_state='active' then 'active' else 'draft' end,
 'seats_available',case when l.seat_limit is null then null else l.seat_limit-l.seats_used end,
 'pending_invites',(select count(*) from pi_access_private.invitations i where i.company_id=l.company_id and i.invitation_state in('prepared','offered','sent') and i.expires_at>statement_timestamp()),
 'pending_approvals',(select count(*) from public.pi_company_memberships m where m.company_id=l.company_id and m.access_state='pending')))),'[]'::jsonb) into cs
 from jsonb_array_elements(d->'companies') c join pi_access_private.company_licenses l on l.company_id=(c->>'id')::uuid;
 select coalesce(jsonb_agg(u||jsonb_build_object('membership_state',m.access_state,'seat_exempt',pi_access_private.seat_exempt(m.user_id,m.company_id),'access_kind',l.plan_kind,'trial_days',l.initial_days,'activated_at',l.activated_at,'expires_at',l.expires_at,
 'status',case when u->>'company_id' is null then 'pending' when m.access_state='revoked' then 'revoked' when l.license_state='suspended' then 'revoked' when l.migration_state='review_required' or l.seat_limit is null then 'pending' when l.expires_at<=statement_timestamp() then 'expired' when m.access_state='active' and l.license_state='active' then case when m.role_name='client' then 'blocked' else 'active' end else 'pending' end)),'[]'::jsonb) into us
 from jsonb_array_elements(d->'users') u left join public.pi_company_memberships m on m.user_id=(u->>'user_id')::uuid and m.company_id=(u->>'company_id')::uuid left join pi_access_private.company_licenses l on l.company_id=m.company_id;
 select coalesce(jsonb_agg(i||jsonb_build_object('trial_days',l.initial_days,'activated_at',l.activated_at,'trial_expires_at',l.expires_at,'plan_kind',l.plan_kind,'reserved_seat',false)),'[]'::jsonb) into ivs
 from jsonb_array_elements(d->'invitations') i left join pi_access_private.company_licenses l on l.company_id=(i->>'company_id')::uuid;
 select coalesce(jsonb_agg(x.item order by x.item->>'occurred_at' desc),'[]'::jsonb) into acts from(
 select item from(select value item from jsonb_array_elements(d->'activity') union all
 select to_jsonb(t)||jsonb_build_object('actor_name',a.email,'target_name',u.email,'company_name',c.name,'source','server')
 from pi_access_private.tenant_changes t join auth.users a on a.id=t.actor_id left join auth.users u on u.id=t.target_user_id join public.pi_companies c on c.id=t.company_id
 where ((d->>'is_master')::boolean or t.company_id=p_company_id) and (p_company_id is null or t.company_id=p_company_id))q order by item->>'occurred_at' desc limit 200)x;
 return d||jsonb_build_object('version',3,'companies',cs,'users',us,'invitations',ivs,'activity',acts,'metrics',jsonb_build_object(
 'companies',jsonb_array_length(cs),'users',(select count(distinct u->>'user_id') from jsonb_array_elements(us)u),
 'active_trials',(select count(*) from jsonb_array_elements(cs)c where c->'license'->>'plan_kind'='trial' and c->'license'->>'status'='active'),
 'expiring_soon',(select count(*) from jsonb_array_elements(cs)c where c->'license'->>'status'='active' and (c->'license'->>'expires_at')::timestamptz<=statement_timestamp()+interval '72 hours'),
 'pending_invitations',(select coalesce(sum((c->'license'->>'pending_invites')::integer),0) from jsonb_array_elements(cs)c)));
end $$;
create or replace function pi_access_private.dashboard(p_company_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$select case when pi_access_private.tenants_enabled() then pi_access_private.dashboard_v3(p_company_id) else pi_access_private.dashboard_legacy(p_company_id) end;$$;
create function pi_access_private.my_company_access() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'access',pi_access_private.access_status_v3(c.id)) order by c.name),'[]'::jsonb)
 from public.pi_company_memberships m join public.pi_companies c on c.id=m.company_id where m.user_id=auth.uid() and pi_access_private.identity_verified(auth.uid());$$;
-- V3 keeps private legacy records private and enforces each tenant on membership reads too.
drop policy pi_membership_read on public.pi_company_memberships;
create policy pi_membership_read on public.pi_company_memberships for select to authenticated using(
 case when not pi_access_private.tenants_enabled() then access_state='active' and pi_access_private.self_account_active() and(user_id=auth.uid() or pi_gestao_private.has_company_role(company_id,array['admin','planner']))
 else pi_gestao_private.has_company_role(company_id,array['admin','planner']) or(user_id=auth.uid() and pi_gestao_private.has_company_role(company_id,array['inspector','assistant'])) end);

create function public.pi_access_status_v3(p_company_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.access_status_v3(p_company_id);$$;
revoke all on function public.pi_access_status_v3(uuid) from public,anon,service_role;grant execute on function public.pi_access_status_v3(uuid) to authenticated;
create function public.pi_admin_dashboard_v3(p_company_id uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.dashboard_v3(p_company_id);$$;
revoke all on function public.pi_admin_dashboard_v3(uuid) from public,anon,service_role;grant execute on function public.pi_admin_dashboard_v3(uuid) to authenticated;
create function public.pi_admin_license_change(p_company_id uuid,p_action text,p_expected_revision integer,p_seat_limit integer,p_plan_kind text,p_days integer,p_new_expiry timestamptz,p_reason text) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.license_change(p_company_id,p_action,p_expected_revision,p_seat_limit,p_plan_kind,p_days,p_new_expiry,p_reason);$$;
revoke all on function public.pi_admin_license_change(uuid,text,integer,integer,text,integer,timestamptz,text) from public,anon,service_role;grant execute on function public.pi_admin_license_change(uuid,text,integer,integer,text,integer,timestamptz,text) to authenticated;
create function public.pi_admin_membership_change(p_user_id uuid,p_company_id uuid,p_action text,p_reason text) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.membership_change(p_user_id,p_company_id,p_action,p_reason);$$;
revoke all on function public.pi_admin_membership_change(uuid,uuid,text,text) from public,anon,service_role;grant execute on function public.pi_admin_membership_change(uuid,uuid,text,text) to authenticated;
create function public.pi_admin_company_save_v3(p_name text,p_company_id uuid,p_expected_name text,p_reason text) returns jsonb language sql  security invoker set search_path='' as $$select pi_access_private.company_save_v3(p_name,p_company_id,p_expected_name,p_reason);$$;
revoke all on function public.pi_admin_company_save_v3(text,uuid,text,text) from public,anon,service_role;grant execute on function public.pi_admin_company_save_v3(text,uuid,text,text) to authenticated;
create function public.pi_admin_migration_map() returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.migration_map();$$;
revoke all on function public.pi_admin_migration_map() from public,anon,service_role;grant execute on function public.pi_admin_migration_map() to authenticated;
create function public.pi_my_company_access() returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.my_company_access();$$;
revoke all on function public.pi_my_company_access() from public,anon,service_role;grant execute on function public.pi_my_company_access() to authenticated;
do $acl$ declare f record;begin for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_access_private' and(p.proname=any(array['tenants_enabled','tenant_write_guard','identity_verified','company_active','tenant_manage','company_license_created','membership_seat_guard','license_change','membership_change','access_status_v3','company_save_v3','migration_map','dashboard_v3','my_company_access','account_active','access_status','access_status_v2','accept_invite','approve','revoke_access','trial_plan','trial_extend','approve_v2','prepare_invite_v2']) or right(p.proname,7)='_legacy') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.sig);end loop;end $acl$;
grant execute on function pi_access_private.access_status_v3(uuid) to authenticated;
grant execute on function pi_access_private.dashboard_v3(uuid) to authenticated;
grant execute on function pi_access_private.license_change(uuid,text,integer,integer,text,integer,timestamptz,text) to authenticated;
grant execute on function pi_access_private.membership_change(uuid,uuid,text,text) to authenticated;
grant execute on function pi_access_private.company_save_v3(text,uuid,text,text) to authenticated;
grant execute on function pi_access_private.migration_map() to authenticated;
grant execute on function pi_access_private.my_company_access() to authenticated;
grant execute on function pi_access_private.access_status(uuid),pi_access_private.access_status_v2(uuid),pi_access_private.accept_invite(uuid),pi_access_private.approve(uuid,uuid),pi_access_private.revoke_access(uuid,uuid),pi_access_private.trial_plan(uuid,uuid,integer),pi_access_private.trial_extend(uuid,uuid,timestamptz,timestamptz,text),pi_access_private.approve_v2(uuid,uuid,integer),pi_access_private.prepare_invite_v2(text,uuid,text,integer),pi_access_private.tenants_enabled() to authenticated;
revoke all on function pi_gestao_private.has_company_role(uuid,text[]) from public,anon,service_role;grant execute on function pi_gestao_private.has_company_role(uuid,text[]) to authenticated;


-- Preserve function OID and legacy behavior while ensuring old overview callers see tenant terms.
do $copy$ begin execute replace(pg_get_functiondef('pi_access_private.admin_overview()'::regprocedure),'FUNCTION pi_access_private.admin_overview(', 'FUNCTION pi_access_private.admin_overview_legacy(');end $copy$;
revoke all on function pi_access_private.admin_overview_legacy() from public,anon,authenticated,service_role;
create or replace function pi_access_private.admin_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform pi_access_private.require_master();
 if pi_access_private.tenants_enabled() then return pi_access_private.dashboard_v3(null);end if;
 return pi_access_private.admin_overview_legacy();end $$;

update pi_access_private.tenant_rollout set writes_paused=true where singleton;
-- LOCAL REHEARSAL ONLY: no production invocation or remote execution authorized.
-- Temporary, invoker-rights functions: no public RPC or new persistent grants.
create or replace function pg_temp.pi_mapping_snapshot(p_company uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('company',to_jsonb(c),'license',to_jsonb(l),'exemptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.user_id) from pi_access_private.company_seat_exemptions e where e.company_id=c.id),'[]'::jsonb),'memberships',
 coalesce((select jsonb_agg(jsonb_build_object('membership',to_jsonb(m),'account',to_jsonb(a),
 'identity',jsonb_build_object('confirmed',u.email_confirmed_at,'banned_until',u.banned_until)) order by m.user_id)
 from public.pi_company_memberships m left join pi_access_private.accounts a on a.user_id=m.user_id left join auth.users u on u.id=m.user_id where m.company_id=c.id),'[]'::jsonb))
 from public.pi_companies c join pi_access_private.company_licenses l on l.company_id=c.id where c.id=p_company;$$;
revoke all on function pg_temp.pi_mapping_snapshot(uuid) from public,anon,authenticated,service_role;
create or replace function pg_temp.pi_resolve_mapping(p_actor uuid,p_company uuid,p_expected jsonb,p_decision jsonb,p_reason text,p_package_sha256 text) returns jsonb
language plpgsql set search_path='' as $$
declare before_state jsonb; after_state jsonb; d jsonb; m public.pi_company_memberships%rowtype;
 capacity integer; days integer; kind text; state text; starts timestamptz; ends timestamptz; used integer; item_count integer;
begin
 if current_user<>'postgres' then raise exception 'reviewed_operator_required' using errcode='42501';end if;
 if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 or p_package_sha256 is null or p_package_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'mapping_audit_required';end if;
 perform 1 from pi_access_private.tenant_rollout where singleton for update;
 if not exists(select 1 from pi_access_private.tenant_rollout where singleton and not enabled and writes_paused) then raise exception 'mapping_requires_disabled_paused_rollout';end if;
 -- Short transaction; bounded lock_timeout is mandatory in the caller. Locks stop legacy writes while checking the complete snapshot.
 lock table public.pi_companies,pi_access_private.company_licenses,public.pi_company_memberships,pi_access_private.accounts,pi_access_private.masters in share row exclusive mode;
 perform 1 from auth.users where id=p_actor or id in(select user_id from public.pi_company_memberships where company_id=p_company) order by id for share;
 if not pi_access_private.identity_verified(p_actor) or not pi_access_private.account_active_legacy(p_actor) or not exists(select 1 from pi_access_private.masters where user_id=p_actor and revoked_at is null) then raise exception 'confirmed_global_actor_required' using errcode='42501';end if;
 before_state:=pg_temp.pi_mapping_snapshot(p_company);
 if before_state is null or p_expected is distinct from before_state then raise exception 'mapping_snapshot_changed' using errcode='40001';end if;
 if before_state->'license'->>'migration_state'<>'review_required' then raise exception 'mapping_already_resolved';end if;
 if p_decision is null or jsonb_typeof(p_decision)<>'object' or jsonb_typeof(p_decision->'seat_limit') is distinct from 'number' or jsonb_typeof(p_decision->'memberships') is distinct from 'array' then raise exception 'explicit_mapping_values_required';end if;
 if (p_decision->>'seat_limit') !~ '^[0-9]+$' or (p_decision->>'initial_days' is not null and (p_decision->>'initial_days') !~ '^[0-9]+$') then raise exception 'integer_terms_required';end if;
 capacity:=(p_decision->>'seat_limit')::integer;days:=(p_decision->>'initial_days')::integer;kind:=p_decision->>'plan_kind';state:=p_decision->>'license_state';
 starts:=(p_decision->>'activated_at')::timestamptz;ends:=(p_decision->>'expires_at')::timestamptz;
 if kind is null or kind not in('trial','term','indefinite') or state is null or state not in('draft','active','suspended') or (kind='indefinite' and days is not null) or (kind<>'indefinite' and (days is null or days not between 1 and 365 or (kind='trial' and days>90))) then raise exception 'invalid_mapping_terms';end if;
 if (kind='indefinite' and ends is not null) or (kind<>'indefinite' and ((starts is null)<>(ends is null) or (starts is not null and ends<>starts+days*interval '24 hours'))) or starts>clock_timestamp() or (state='draft' and starts is not null) or (state='active' and starts is null) then raise exception 'explicit_mapping_dates_required';end if;
 select count(*) into item_count from jsonb_array_elements(p_decision->'memberships');
 if item_count<>(select count(*) from public.pi_company_memberships where company_id=p_company) or item_count<>(select count(distinct value->>'user_id') from jsonb_array_elements(p_decision->'memberships')) then raise exception 'every_membership_requires_one_decision';end if;
 used:=0;
 for d in select value from jsonb_array_elements(p_decision->'memberships') loop
  select * into m from public.pi_company_memberships where company_id=p_company and user_id=(d->>'user_id')::uuid;
  if not found or d->>'action' is null or d->>'action' not in('keep','deactivate') then raise exception 'invalid_membership_mapping';end if;
  if d->>'action'='keep' and m.access_state='active' then
   if not pi_access_private.identity_verified(m.user_id) or not pi_access_private.account_active_legacy(m.user_id) then raise exception 'legacy_denied_member_must_deactivate';end if;
   if not exists(select 1 from jsonb_array_elements_text(coalesce(p_decision->'exempt_global_users','[]'::jsonb)) e where e.value=m.user_id::text) then used:=used+1;end if;
  end if;
 end loop;
 if used>capacity then raise exception 'capacity_below_preserved_allocations';end if;
 if used>0 and (starts is null or state='draft') then raise exception 'active_members_require_explicit_company_term';end if;
 if (before_state->'license'->>'seats_used')::integer<>(select count(*) from public.pi_company_memberships where company_id=p_company and access_state='active' and not pi_access_private.seat_exempt(user_id,company_id)) then raise exception 'legacy_counter_inconsistent';end if;
 for d in select to_jsonb(value) from jsonb_array_elements_text(coalesce(p_decision->'exempt_global_users','[]'::jsonb)) loop
  if not exists(select 1 from public.pi_company_memberships where company_id=p_company and user_id=(d#>>'{}')::uuid) then raise exception 'exempt_membership_missing';end if;
  insert into pi_access_private.company_seat_exemptions(company_id,user_id) values(p_company,(d#>>'{}')::uuid);
 end loop;
 for d in select value from jsonb_array_elements(p_decision->'memberships') loop
  if d->>'action'='deactivate' then update public.pi_company_memberships set access_state='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and user_id=(d->>'user_id')::uuid and access_state<>'revoked';end if;
 end loop;
 update pi_access_private.company_licenses set migration_state='ready',license_state=state,seat_limit=capacity,plan_kind=kind,initial_days=days,activated_at=starts,expires_at=ends,revision=revision+1 where company_id=p_company;
 after_state:=pg_temp.pi_mapping_snapshot(p_company);
 if (after_state->'license'->>'seats_used')::integer<>used then raise exception 'mapping_counter_mismatch';end if;
 insert into pi_access_private.tenant_changes(actor_id,company_id,event,before_value,after_value,reason)
 values(p_actor,p_company,'mapping_resolved',before_state,after_state||jsonb_build_object('decision',p_decision,'package_sha256',p_package_sha256),btrim(p_reason));
 return after_state;
end $$;
revoke all on function pg_temp.pi_resolve_mapping(uuid,uuid,jsonb,jsonb,text,text) from public,anon,authenticated,service_role;

-- Production-specific assertions/mapping omitted from this public source export.
update pi_access_private.tenant_rollout set enabled=true,writes_paused=false where singleton;
-- Production-specific assertions/mapping omitted from this public source export.
notify pgrst,'reload schema';
commit;

