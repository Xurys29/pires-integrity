-- Isolated PGlite fixture, never a production migration or source of licenses.
-- Only the verified helper signatures are mirrored; external Auth/licensing is stubbed.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create schema storage;
create schema pi_access_private;
-- Existing schema ACL confirmed by read-only catalog; never granted by migration.
create schema pi_gestao_private;
grant usage on schema pi_gestao_private to authenticated;
-- Exact legacy signatures/ACLs from the real catalog; bodies are isolated sentinels,
-- not replacements for or implementations of production authorization helpers.
create function pi_gestao_private.has_company_role(p_company uuid,p_roles text[]) returns boolean language sql security definer set search_path='' as $$ select false $$;
create function pi_gestao_private.has_company_role_legacy(p_company uuid,p_roles text[]) returns boolean language sql security definer set search_path='' as $$ select true $$;
revoke all on function pi_gestao_private.has_company_role(uuid,text[]),pi_gestao_private.has_company_role_legacy(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function pi_gestao_private.has_company_role(uuid,text[]) to authenticated;
create table auth.users(id uuid primary key);
create table auth.fixture_users(id uuid primary key,verified boolean not null default true,active boolean not null default true);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated,service_role;
grant execute on function auth.uid() to authenticated,service_role;
create table public.pi_companies(id uuid primary key,name text not null,created_at timestamptz default now());
create table public.pi_company_memberships(company_id uuid,user_id uuid,role_name text,access_state text,primary key(company_id,user_id));
create table pi_access_private.fixture_licenses(company_id uuid primary key,active boolean not null default true);
create table pi_access_private.masters(user_id uuid primary key,revoked_at timestamptz);
create table pi_access_private.tenant_rollout(singleton boolean primary key,enabled boolean,writes_paused boolean);
insert into pi_access_private.tenant_rollout values(true,true,false);
create function pi_access_private.tenants_enabled() returns boolean language sql stable security definer set search_path='' as $$ select coalesce((select enabled from pi_access_private.tenant_rollout where singleton),false) $$;
create function pi_access_private.identity_verified(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.fixture_users where id=p_user and verified) $$;
create function pi_access_private.account_active_legacy(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.fixture_users where id=p_user and active) $$;
create function pi_access_private.company_active(p_company uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from pi_access_private.fixture_licenses where company_id=p_company and active) $$;
create function pi_access_private.member_identity_allowed(p_user uuid,p_company uuid) returns boolean language sql stable security definer set search_path='' as $$ select pi_access_private.identity_verified(p_user) and exists(select 1 from public.pi_company_memberships where company_id=p_company and user_id=p_user and access_state='active') $$;
create function pi_access_private.is_master() returns boolean language sql stable security definer set search_path='' as $$ select pi_access_private.identity_verified(auth.uid()) and pi_access_private.account_active_legacy(auth.uid()) and exists(select 1 from pi_access_private.masters where user_id=auth.uid() and revoked_at is null) $$;
create function pi_access_private.tenant_write_guard() returns void language plpgsql security definer set search_path='' as $$ begin if not pi_access_private.tenants_enabled() or (select writes_paused from pi_access_private.tenant_rollout where singleton) then raise exception 'tenant_writes_unavailable' using errcode='42501';end if;end $$;
create function public.pi_access_status_v3(p_company_id uuid default null) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('version',3,'user_id',auth.uid(),'status',case when pi_access_private.identity_verified(auth.uid()) and ((p_company_id is null and pi_access_private.is_master()) or (pi_access_private.company_active(p_company_id) and pi_access_private.member_identity_allowed(auth.uid(),p_company_id))) then 'active' else 'pending' end,'is_master',pi_access_private.is_master(),'company_id',p_company_id,'company_role',(select role_name from public.pi_company_memberships where company_id=p_company_id and user_id=auth.uid()),'activated_at',now()-interval '1 day','expires_at',now()+interval '1 day','server_now',now(),'plan_kind','fixture','license_scope','company')
$$;
create function public.pi_my_company_access() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) order by c.id),'[]') from public.pi_companies c where pi_access_private.is_master() or exists(select 1 from public.pi_company_memberships m where m.company_id=c.id and m.user_id=auth.uid() and m.access_state='active')
$$;
create table storage.buckets(id text primary key,name text,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[],owner_id text);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,metadata jsonb,owner_id text,unique(bucket_id,name));
alter table public.pi_companies enable row level security;
alter table public.pi_company_memberships enable row level security;
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
insert into storage.buckets(id,name,public,file_size_limit) values('pi-gestao-sources','pi-gestao-sources',false,8388608);
