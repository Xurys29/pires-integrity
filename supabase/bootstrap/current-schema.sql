-- Schema-only snapshot read from production on 2026-10-28. No users, business rows or credentials.

-- For a NEW isolated Supabase database only. Never replay on production.

begin;

set local check_function_bodies = off;

create schema if not exists extensions;

create extension if not exists pgcrypto with schema extensions;

create schema "pi_access_private";

create schema "pi_billing_private";

create schema "pi_gestao_private";

create schema "pi_team_private";

create table "pi_access_private"."invitations" (
  "id" uuid not null,
  "email" text not null,
  "company_id" uuid not null,
  "role_name" text not null,
  "invitation_state" text not null,
  "delivery" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null,
  "expires_at" timestamp with time zone not null,
  "auth_user_id" uuid,
  "sent_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "trial_days" integer not null
);

create table "pi_access_private"."accounts" (
  "user_id" uuid not null,
  "access_state" text not null,
  "access_kind" text not null,
  "activated_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "trial_days" integer not null
);

create table "public"."pi_assessments" (
  "id" uuid not null,
  "user_id" uuid not null,
  "kind" text not null,
  "title" text not null,
  "payload" jsonb not null,
  "report_text" text not null,
  "app_version" text not null,
  "created_at" timestamp with time zone not null,
  "company_id" uuid
);

create table "public"."pi_companies" (
  "id" uuid not null,
  "name" text not null,
  "created_at" timestamp with time zone not null
);

create table "public"."pi_company_memberships" (
  "company_id" uuid not null,
  "user_id" uuid not null,
  "role_name" text not null,
  "created_at" timestamp with time zone not null,
  "access_state" text not null,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "invitation_id" uuid
);

create table "pi_access_private"."admin_changes" (
  "id" uuid not null,
  "occurred_at" timestamp with time zone not null,
  "actor_id" uuid not null,
  "target_user_id" uuid,
  "company_id" uuid not null,
  "event" text not null,
  "before_value" jsonb not null,
  "after_value" jsonb not null,
  "reason" text
);

create table "pi_access_private"."masters" (
  "user_id" uuid not null,
  "granted_at" timestamp with time zone not null,
  "revoked_at" timestamp with time zone
);

create table "pi_access_private"."activity" (
  "id" uuid not null,
  "occurred_at" timestamp with time zone not null,
  "actor_id" uuid,
  "target_user_id" uuid,
  "company_id" uuid,
  "event" text not null,
  "source" text not null,
  "context" text,
  "object_id" uuid
);

create table "pi_access_private"."tenant_rollout" (
  "singleton" boolean not null,
  "enabled" boolean not null,
  "writes_paused" boolean not null
);

create table "pi_access_private"."company_licenses" (
  "company_id" uuid not null,
  "migration_state" text not null,
  "license_state" text not null,
  "plan_kind" text,
  "initial_days" integer,
  "seat_limit" integer,
  "seats_used" integer not null,
  "activated_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revision" integer not null
);

create table "pi_access_private"."tenant_changes" (
  "id" uuid not null,
  "occurred_at" timestamp with time zone not null,
  "actor_id" uuid not null,
  "company_id" uuid not null,
  "target_user_id" uuid,
  "event" text not null,
  "before_value" jsonb not null,
  "after_value" jsonb not null,
  "reason" text not null
);

create table "pi_access_private"."company_seat_exemptions" (
  "company_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_access_private"."access_requests" (
  "id" uuid not null,
  "user_id" uuid not null,
  "full_name" text not null,
  "applicant_kind" text not null,
  "company_name" text not null,
  "requested_seats" integer not null,
  "request_state" text not null,
  "created_at" timestamp with time zone not null,
  "company_id" uuid,
  "decided_at" timestamp with time zone,
  "decided_by" uuid,
  "decision_reason" text
);

create table "pi_billing_private"."bindings" (
  "id" uuid not null,
  "company_id" uuid not null,
  "provider_subscription" text not null,
  "provider_customer" text not null,
  "payer_kind" text not null,
  "owner_id" uuid,
  "quantity" integer not null,
  "terms" jsonb not null,
  "created_at" timestamp with time zone not null,
  "created_by" uuid not null
);

create table "pi_billing_private"."inbox" (
  "event_id" text not null,
  "event" text not null,
  "kind" text not null,
  "resource_id" text not null,
  "subscription_hint" text,
  "fingerprint" text not null,
  "projection" jsonb not null,
  "conflict" boolean not null,
  "received_at" timestamp with time zone not null
);

create table "pi_billing_private"."event_conflicts" (
  "event_id" text not null,
  "fingerprint" text not null,
  "created_at" timestamp with time zone not null
);

create table "pi_billing_private"."jobs" (
  "id" bigint generated always as identity not null,
  "dedupe_key" text not null,
  "event_id" text,
  "kind" text not null,
  "resource_id" text not null,
  "subscription_hint" text,
  "scan_id" uuid,
  "page_offset" integer not null,
  "state" text not null,
  "attempts" integer not null,
  "lease" uuid,
  "lease_until" timestamp with time zone,
  "next_attempt" timestamp with time zone not null,
  "reason" text,
  "created_at" timestamp with time zone not null
);

create table "pi_billing_private"."observations" (
  "id" bigint generated always as identity not null,
  "job_id" bigint not null,
  "binding_id" uuid not null,
  "snapshot" jsonb not null,
  "observed_at" timestamp with time zone not null,
  "financial_effects" boolean not null
);

create table "pi_billing_private"."audit" (
  "id" bigint generated always as identity not null,
  "occurred_at" timestamp with time zone not null,
  "actor_id" uuid,
  "company_id" uuid,
  "event" text not null,
  "reference" text,
  "details" jsonb not null
);

create table "pi_billing_private"."catalog" (
  "id" text not null,
  "revision" integer not null,
  "state" text not null,
  "terms" jsonb not null
);

create table "pi_gestao_private"."pilot_access" (
  "tenant_id" uuid not null,
  "user_id" uuid not null,
  "granted_at" timestamp with time zone not null,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "reason" text not null
);

create table "pi_gestao_private"."record_origins" (
  "tenant_id" uuid not null,
  "owner_id" uuid not null,
  "kind" text not null,
  "origin_key" text not null,
  "record_id" uuid not null,
  "source_id" text,
  "digest" text not null
);

create table "pi_gestao_private"."record_relations" (
  "tenant_id" uuid not null,
  "owner_id" uuid not null,
  "from_id" uuid not null,
  "from_kind" text not null,
  "to_id" uuid not null,
  "to_kind" text not null,
  "relation_type" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_gestao_private"."owners" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "name" text not null,
  "source" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null,
  "name_key" text generated always as (btrim(regexp_replace(lower(name), '[[:space:][:punct:]]+'::text, ' '::text, 'g'::text))) stored
);

create table "pi_gestao_private"."records" (
  "tenant_id" uuid not null,
  "owner_id" uuid not null,
  "id" uuid not null,
  "seq" bigint generated always as identity not null,
  "kind" text not null,
  "body" jsonb not null,
  "version" bigint not null
);

create table "pi_gestao_private"."sources" (
  "tenant_id" uuid not null,
  "id" text not null,
  "name" text not null,
  "byte_size" bigint not null,
  "object_key" text not null,
  "workbook" jsonb not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_gestao_private"."previews" (
  "tenant_id" uuid not null,
  "owner_id" uuid,
  "id" uuid not null,
  "source_id" text not null,
  "body" jsonb not null,
  "consumed" boolean not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_gestao_private"."imports" (
  "tenant_id" uuid not null,
  "owner_id" uuid not null,
  "identity" text not null,
  "canonical_key" text not null,
  "digest" text not null,
  "asset_id" uuid not null,
  "source_id" text not null
);

create table "pi_gestao_private"."audit" (
  "seq" bigint generated always as identity not null,
  "tenant_id" uuid not null,
  "owner_id" uuid,
  "record_id" uuid not null,
  "actor_user_id" uuid not null,
  "action" text not null,
  "at" timestamp with time zone not null,
  "body" jsonb not null
);

create table "pi_gestao_private"."operation_receipts" (
  "tenant_id" uuid not null,
  "owner_id" uuid not null,
  "action" text not null,
  "request_id" uuid not null,
  "digest" text not null,
  "result" jsonb not null,
  "actor_user_id" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_team_private"."professionals" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "exercise_key" text,
  "user_id" uuid,
  "name" text not null,
  "job_title" text,
  "relationship" text,
  "professional_email" text,
  "professional_phone" text,
  "integrity_level" smallint,
  "integrity_basis" text,
  "registration_state" text not null,
  "availability" text,
  "availability_note" text,
  "technical_state" text,
  "technical_basis" text,
  "exercise" boolean not null,
  "functional_role" text not null,
  "test_identity" text,
  "test_registration" text,
  "avatar_file_id" uuid,
  "access_revoked_at" timestamp with time zone,
  "login_validated_at" timestamp with time zone,
  "version" integer not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null,
  "updated_by" uuid not null,
  "updated_at" timestamp with time zone not null
);

create table "pi_team_private"."qualification_catalog" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "code" text not null,
  "meaning" text not null,
  "active" boolean not null,
  "version" integer not null
);

create table "pi_team_private"."qualifications" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "professional_id" uuid not null,
  "catalog_id" uuid not null,
  "method" text,
  "qualification_level" text,
  "scope" text,
  "certifier" text,
  "certificate_number" text,
  "valid_until" date,
  "verification" text not null,
  "verification_note" text,
  "proof_file_id" uuid,
  "version" integer not null
);

create table "pi_team_private"."documents" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "professional_id" uuid not null,
  "title" text not null,
  "kind" text not null,
  "activity" text,
  "client_id" uuid,
  "unit" text,
  "issuer" text,
  "valid_until" date,
  "verification" text not null,
  "verification_note" text,
  "file_id" uuid,
  "version" integer not null
);

create table "pi_team_private"."files" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "professional_id" uuid not null,
  "name" text not null,
  "object_key" text not null,
  "mime" text not null,
  "byte_size" bigint not null,
  "purpose" text not null,
  "state" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_team_private"."assignments" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "professional_id" uuid not null,
  "client_id" uuid not null,
  "project_id" uuid not null,
  "activity" text,
  "starts_on" date,
  "ends_on" date,
  "active" boolean not null
);

create table "pi_team_private"."requirements" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "title" text not null,
  "activity" text,
  "client_id" uuid,
  "unit" text,
  "basis" text not null,
  "active" boolean not null
);

create table "pi_team_private"."salary_references" (
  "tenant_id" uuid not null,
  "id" uuid not null,
  "integrity_level" smallint not null,
  "amount_cents" bigint not null,
  "effective_from" date not null,
  "reason" text not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone not null
);

create table "pi_team_private"."salary_managers" (
  "tenant_id" uuid not null,
  "user_id" uuid not null
);

create table "pi_team_private"."history" (
  "id" bigint generated always as identity not null,
  "tenant_id" uuid not null,
  "professional_id" uuid,
  "entity" text not null,
  "entity_id" text not null,
  "actor_id" uuid not null,
  "occurred_at" timestamp with time zone not null,
  "action" text not null,
  "before_value" jsonb,
  "after_value" jsonb
);

CREATE OR REPLACE FUNCTION public.pi_access_status(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select pi_access_private.access_status(p_company_id); $function$;

CREATE OR REPLACE FUNCTION public.pi_record_activity(p_event text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.record_activity(p_event,p_company_id); $function$;

CREATE OR REPLACE FUNCTION public.pi_pending_invites()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select pi_access_private.pending_invites(); $function$;

CREATE OR REPLACE FUNCTION public.pi_accept_invite(p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.accept_invite(p_invitation_id); $function$;

CREATE OR REPLACE FUNCTION public.pi_admin_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ select pi_access_private.admin_overview(); $function$;

CREATE OR REPLACE FUNCTION public.pi_admin_prepare_invite(p_email text, p_company_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.prepare_invite(p_email,p_company_id,p_role); $function$;

CREATE OR REPLACE FUNCTION public.pi_admin_approve(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.approve(p_user_id,p_company_id); $function$;

CREATE OR REPLACE FUNCTION public.pi_admin_revoke(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.revoke_access(p_user_id,p_company_id); $function$;

CREATE OR REPLACE FUNCTION pi_access_private.reject_activity_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'activity_is_append_only' using errcode='42501'; end;
$function$;

CREATE OR REPLACE FUNCTION public.pi_access_status_v2(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.access_status_v2(p_company_id);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_dashboard(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.dashboard(p_company_id);$function$;

CREATE OR REPLACE FUNCTION pi_access_private.self_account_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select pi_access_private.account_active(auth.uid()); $function$;

CREATE OR REPLACE FUNCTION pi_access_private.account_active(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not pi_access_private.tenants_enabled() then pi_access_private.account_active_legacy(p_user) else
 pi_access_private.identity_verified(p_user) and (
 (exists(select 1 from pi_access_private.masters where user_id=p_user and revoked_at is null) and pi_access_private.account_active_legacy(p_user))
 or exists(select 1 from public.pi_company_memberships m where m.user_id=p_user and m.access_state='active' and m.role_name<>'client' and pi_access_private.company_active(m.company_id) and pi_access_private.member_identity_allowed(p_user,m.company_id))) end;$function$;

CREATE OR REPLACE FUNCTION pi_access_private.require_master()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or not pi_access_private.is_master() then
    raise exception 'master_access_required' using errcode='42501';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.audit_assessment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op='INSERT' then
    insert into pi_access_private.activity(actor_id,target_user_id,company_id,event,object_id)
      values(auth.uid(),new.user_id,new.company_id,'assessment_created',new.id); return new;
  end if;
  insert into pi_access_private.activity(actor_id,target_user_id,company_id,event,object_id)
    values(auth.uid(),old.user_id,old.company_id,'assessment_deleted',old.id); return old;
end;
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.self_internal_account_active()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pi_access_private.self_account_active() and
    (pi_access_private.is_master() or exists (
      select 1 from public.pi_company_memberships m
      where m.user_id=auth.uid() and m.access_state='active'
        and m.role_name in ('admin','planner','inspector','assistant')
    ));
$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.has_company_role(p_company uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not pi_access_private.tenants_enabled() then pi_gestao_private.has_company_role_legacy(p_company,p_roles) else
 pi_access_private.member_identity_allowed(auth.uid(),p_company) and pi_access_private.company_active(p_company) and exists(select 1 from public.pi_company_memberships where user_id=auth.uid() and company_id=p_company and access_state='active' and role_name=any(p_roles) and role_name<>'client') end;$function$;

CREATE OR REPLACE FUNCTION pi_access_private.record_activity(p_event text, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid();
begin
  if p_event is null or p_event<>'session_opened' then
    raise exception 'invalid_activity_event' using errcode='22023';
  end if;
  if v_uid is null or not pi_access_private.account_active(v_uid)
    or (p_company_id is null and pi_access_private.access_status(null)->>'status'<>'active')
    or (p_company_id is not null and not pi_gestao_private.has_company_role(p_company_id,array['admin','planner','inspector','assistant','client'])) then
    raise exception 'active_access_required' using errcode='42501';
  end if;
  -- Serializa sinais concorrentes; mudar empresa nao permite furar o limite.
  perform pg_advisory_xact_lock(hashtextextended('app_entry:'||v_uid::text||':'||p_event,0));
  if exists(select 1 from pi_access_private.activity where actor_id=v_uid and event=p_event
    and occurred_at>clock_timestamp()-interval '1 minute') then return false; end if;
  insert into pi_access_private.activity(actor_id,company_id,event,source,context)
    values(v_uid,p_company_id,p_event,'client_signal','app_entry');
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.pending_invites()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid(); v_email text;
begin
  select lower(email) into v_email from auth.users where id=v_uid and email_confirmed_at is not null;
  if v_uid is null or v_email is null then raise exception 'verified_identity_required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('invitation_id',i.id,'company_id',i.company_id,
    'company_name',c.name,'role',i.role_name,'expires_at',i.expires_at,'delivery',i.delivery) order by i.created_at,i.id)
    from pi_access_private.invitations i join public.pi_companies c on c.id=i.company_id
    where i.auth_user_id=v_uid and i.email=v_email and i.invitation_state in ('offered','sent')
      and i.expires_at>statement_timestamp()),'[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_trial_plan(p_user_id uuid, p_company_id uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.trial_plan(p_user_id,p_company_id,p_days);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_access_private.mark_invite_sent(p_invitation_id,p_auth_user_id); $function$;

CREATE OR REPLACE FUNCTION pi_access_private.mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inv pi_access_private.invitations%rowtype;
begin
  select * into v_inv from pi_access_private.invitations where id=p_invitation_id for update;
  if not found or v_inv.invitation_state<>'prepared' or v_inv.delivery<>'email' or v_inv.expires_at<=statement_timestamp()
    or not exists (select 1 from auth.users u where u.id=p_auth_user_id and lower(u.email)=v_inv.email)
    or not pi_access_private.account_active(v_inv.created_by)
    or not exists(select 1 from pi_access_private.masters m where m.user_id=v_inv.created_by and m.revoked_at is null) then
    raise exception 'invalid_invitation_dispatch' using errcode='22023';
  end if;
  update pi_access_private.invitations set invitation_state='sent',auth_user_id=p_auth_user_id,sent_at=clock_timestamp()
    where id=v_inv.id;
  insert into pi_access_private.activity(actor_id,target_user_id,company_id,event,object_id)
    values(v_inv.created_by,p_auth_user_id,v_inv.company_id,'invite_sent',v_inv.id);
  return jsonb_build_object('invitation_id',v_inv.id,'status','sent');
end;
$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_company_save(p_name text, p_company_id uuid DEFAULT NULL::uuid, p_expected_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.company_save(p_name,p_company_id,p_expected_name);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.prepare_invite_v2(p_email,p_company_id,p_role,p_trial_days);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.trial_extend(p_user_id,p_company_id,p_expected_expiry,p_new_expiry,p_reason);$function$;

CREATE OR REPLACE FUNCTION pi_access_private.session_summary(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb;
begin
 if not pi_access_private.is_master() then return null; end if;
 if to_regclass('auth.sessions') is null then return null; end if;
 execute 'select jsonb_build_object(''records'',count(*),''last_created_at'',max(created_at),''observed_span_seconds'',max(greatest(0,extract(epoch from(updated_at-created_at))))) from auth.sessions where user_id=$1' into v using p_user;
 return v;
exception when undefined_column then return null;
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not pi_access_private.identity_verified(auth.uid()) then raise exception 'verified_identity_required' using errcode='42501';end if;
 return pi_access_private.capture_access_request(auth.uid(),p_full_name,p_kind,p_company_name,p_seats);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.my_access_request()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; eligible boolean;
begin
 if not pi_access_private.identity_verified(auth.uid()) then raise exception 'verified_identity_required' using errcode='42501';end if;
 select to_jsonb(x) into r from pi_access_private.access_requests x where user_id=auth.uid();
 eligible:=r is null and not exists(select 1 from public.pi_company_memberships where user_id=auth.uid())
 and not exists(select 1 from pi_access_private.masters where user_id=auth.uid())
 and not exists(select 1 from pi_access_private.accounts where user_id=auth.uid() and access_state='revoked');
 return jsonb_build_object('request',r,'can_request',eligible,'server_now',statement_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION public.pi_admin_approve_v2(p_user_id uuid, p_company_id uuid, p_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.approve_v2(p_user_id,p_company_id,p_days);$function$;

CREATE OR REPLACE FUNCTION pi_access_private.admin_access_requests()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare rows jsonb;
begin
 perform pi_access_private.require_master();
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('email',u.email,'email_verified',pi_access_private.identity_verified(u.id),
 'approved_seats',l.seat_limit,'activated_at',l.activated_at,'expires_at',l.expires_at)
 order by (r.request_state='pending') desc,r.created_at desc),'[]'::jsonb) into rows
 from pi_access_private.access_requests r join auth.users u on u.id=r.user_id
 left join pi_access_private.company_licenses l on l.company_id=r.company_id;
 return jsonb_build_object('requests',rows,'server_now',statement_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.seat_exempt(p_user uuid, p_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select exists(select 1 from pi_access_private.company_seat_exemptions where user_id=p_user and company_id=p_company);$function$;

CREATE OR REPLACE FUNCTION pi_access_private.admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r pi_access_private.access_requests%rowtype; c uuid; result jsonb; approved_role text;
begin
 perform pi_access_private.tenant_write_guard();
 perform pi_access_private.require_master();
 if p_action is null or p_action not in ('approve','reject') or p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then
  raise exception 'invalid_request_decision' using errcode='22023';
 end if;
 select * into r from pi_access_private.access_requests where id=p_request_id for update;
 if not found then raise exception 'request_not_found' using errcode='22023';end if;
 if r.request_state<>'pending' then
  if (p_action='approve' and r.request_state='approved') or (p_action='reject' and r.request_state='rejected') then
   return jsonb_build_object('request',to_jsonb(r),'unchanged',true);
  end if;
  raise exception 'request_already_decided' using errcode='22023';
 end if;
 if p_action='reject' then
  update pi_access_private.access_requests set request_state='rejected',decided_at=clock_timestamp(),decided_by=auth.uid(),decision_reason=btrim(p_reason)
  where id=r.id returning to_jsonb(access_requests) into result;
  return jsonb_build_object('request',result,'unchanged',false);
 end if;
 if not pi_access_private.identity_verified(r.user_id) then raise exception 'email_confirmation_required' using errcode='22023';end if;
 if exists(select 1 from public.pi_company_memberships where user_id=r.user_id)
 or exists(select 1 from pi_access_private.masters where user_id=r.user_id)
 or exists(select 1 from pi_access_private.accounts where user_id=r.user_id and access_state='revoked') then
  raise exception 'existing_access_requires_review' using errcode='22023';
 end if;
 if p_seats is null or p_seats not between 1 and 999 or (r.applicant_kind='individual' and p_seats<>1) then raise exception 'invalid_seat_limit' using errcode='22023';end if;
 -- No request can claim an existing tenant merely by entering its name.
 if r.applicant_kind='company' and exists(select 1 from public.pi_companies where lower(btrim(name))=lower(r.company_name)) then
  raise exception 'company_already_exists_use_invitation' using errcode='22023';
 end if;
 c:=(pi_access_private.company_save_v3(r.company_name,null,null,btrim(p_reason))->>'id')::uuid;
 perform pi_access_private.license_change(c,'configure',0,p_seats,'trial',7,null,btrim(p_reason));
 approved_role:=case when r.applicant_kind='company' then 'admin' else 'assistant' end;
 insert into public.pi_company_memberships(company_id,user_id,role_name,access_state) values(c,r.user_id,approved_role,'pending');
 update pi_access_private.access_requests set request_state='approved',company_id=c,decided_at=clock_timestamp(),decided_by=auth.uid(),decision_reason=btrim(p_reason)
 where id=r.id returning to_jsonb(access_requests) into result;
 -- Sole clock starter, after successful approval. Any failure rolls back everything.
 perform pi_access_private.membership_change(r.user_id,c,'activate',btrim(p_reason));
 return jsonb_build_object('request',result,'unchanged',false);
end $function$;

CREATE OR REPLACE FUNCTION public.pi_request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.request_access(p_full_name,p_kind,p_company_name,p_seats)$function$;

CREATE OR REPLACE FUNCTION public.pi_my_access_request()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.my_access_request()$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_access_requests()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.admin_access_requests()$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.admin_decide_request(p_request_id,p_action,p_seats,p_reason)$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.enqueue_reconciliation(p_job,p_lease,p_payments,p_next)$function$;

CREATE OR REPLACE FUNCTION pi_access_private.member_identity_allowed(p_user uuid, p_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select pi_access_private.identity_verified(p_user) and (not pi_access_private.seat_exempt(p_user,p_company) or (pi_access_private.account_active_legacy(p_user) and exists(select 1 from pi_access_private.masters where user_id=p_user and revoked_at is null)));$function$;

CREATE OR REPLACE FUNCTION pi_access_private.seat_exemption_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if tg_op<>'INSERT' then raise exception 'exemption_history_preserved';end if;
 if pi_access_private.tenants_enabled() or not (select writes_paused from pi_access_private.tenant_rollout where singleton) or not pi_access_private.identity_verified(new.user_id) or not pi_access_private.account_active_legacy(new.user_id) or not exists(select 1 from pi_access_private.masters where user_id=new.user_id and revoked_at is null) then raise exception 'reviewed_global_exemption_required';end if;
 if exists(select 1 from public.pi_company_memberships where user_id=new.user_id and company_id=new.company_id and access_state='active') then
 update pi_access_private.company_licenses set seats_used=seats_used-1 where company_id=new.company_id and seats_used>0;if not found then raise exception 'exemption_counter_mismatch';end if;end if;return new;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.is_master()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select pi_access_private.identity_verified(auth.uid()) and pi_access_private.account_active_legacy(auth.uid()) and exists(select 1 from pi_access_private.masters where user_id=auth.uid() and revoked_at is null);$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.has_company_role_legacy(p_company uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null and pi_access_private.account_active(auth.uid()) and exists (
    select 1 from public.pi_company_memberships m where m.user_id=auth.uid()
      and m.company_id=p_company and m.access_state='active' and m.role_name=any(p_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.pi_access_status_v3(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.access_status_v3(p_company_id);$function$;

CREATE OR REPLACE FUNCTION pi_billing_private.append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin raise exception 'append_only';end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_hash(p_value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')
$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_column(p_value text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare n integer:=0; i integer;
begin
 if p_value is null or p_value !~ '^[A-Z]{1,3}$' then raise exception 'Coluna inválida.'; end if;
 for i in 1..length(p_value) loop n:=n*26+ascii(substr(p_value,i,1))-64; end loop;
 return n-1;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_date(p_value text, p_label text, p_required boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
 if nullif(btrim(p_value),'') is null then
  if p_required then raise exception '%: data obrigatória.',p_label; end if;
  return null;
 end if;
 if p_value !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_value::date,'YYYY-MM-DD')<>p_value then raise exception '%: data inválida.',p_label;end if;
 return p_value;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_change(p_tenant uuid, p_owner uuid, p_id uuid, p_kind text, p_version bigint, p_patch jsonb, p_actor uuid, p_event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb; old_record pi_gestao_private.records;
begin
 select * into old_record from pi_gestao_private.records where tenant_id=p_tenant and owner_id=p_owner and id=p_id and kind=p_kind for update;
 if not found then raise exception 'Registro não encontrado neste cliente.';end if;
 if p_version is null or p_version<>old_record.version then raise exception using errcode='40001',message='O registro mudou. Atualize a tela antes de salvar novamente.';end if;
 update pi_gestao_private.records set body=body||p_patch||jsonb_build_object('updatedAt',now(),'updatedBy',p_actor),version=version+1
 where tenant_id=p_tenant and owner_id=p_owner and id=p_id returning body||jsonb_build_object('id',id,'version',version) into result;
 perform pi_gestao_private.ga_audit(p_tenant,p_owner,p_id,p_actor,p_event,jsonb_build_object('previousVersion',old_record.version,'previous',old_record.body,'record',result));
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_api_operational(p_tenant uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
<<ga_api_operational>>
declare actor uuid; owner_id uuid; request_id uuid; digest text; receipt pi_gestao_private.operation_receipts;
 result jsonb; b jsonb; asset jsonb; target jsonb; inspection jsonb; lvt jsonb; item jsonb; finding jsonb; rti jsonb; doc jsonb; evidence jsonb; campaign jsonb;
 scope_fields jsonb; event jsonb; events jsonb; key_name text; id uuid; observed text; status_value text; row_value jsonb; amount numeric;
begin
 if p_action='findings.create' and regexp_replace(lower(btrim(coalesce(p_payload->>'recommendation',''))),'[[:punct:]]+$','','g') in ('não se aplica','nao se aplica','sem recomendações','sem recomendacoes','nenhuma','n/a') then
  raise exception 'Item sem recomendação real: deixe a recomendação vazia para não criar RTI artificial.';
 end if;
 if p_action in ('state.get','book.get') then
  result:=pi_gestao_private.ga_api(p_tenant,p_action,p_payload);
  owner_id:=coalesce(nullif(p_payload->>'ownerId',''),nullif(p_payload->>'companyId',''))::uuid;
  if p_action='state.get' then
   foreach key_name in array array['classification','deadline','measurement','certificate','assetLink'] loop
    select result||jsonb_build_object(key_name,coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq),'[]')) into result
    from pi_gestao_private.records where tenant_id=p_tenant and owner_id=ga_api_operational.owner_id and kind='document' and body->>'recordClass'=key_name;
   end loop;
   result:=result||jsonb_build_object('relations',coalesce(result->'assetLink','[]'));
  else
   -- Only explicit ID relations contribute records from another asset to this book.
   with linked as (
    select body->>'toAssetId' as asset_id from pi_gestao_private.records where tenant_id=p_tenant and owner_id=ga_api_operational.owner_id and kind='document' and body->>'recordClass'='assetLink' and body->>'fromAssetId'=p_payload->>'assetId'
    union select body->>'fromAssetId' from pi_gestao_private.records where tenant_id=p_tenant and owner_id=ga_api_operational.owner_id and kind='document' and body->>'recordClass'='assetLink' and body->>'toAssetId'=p_payload->>'assetId'
   ) select result||jsonb_build_object('relatedRecords',coalesce(jsonb_agg(r.body||jsonb_build_object('id',r.id,'kind',r.kind,'version',r.version) order by r.seq),'[]')) into result
   from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=ga_api_operational.owner_id and r.kind<>'asset' and r.body->>'assetId' in(select asset_id from linked);
  end if;
  return result||jsonb_build_object('workflowVersion',2);
 end if;
 if p_action is null or p_action not in ('field_lvts.create','field_items.create','rtis.update','inspections.update','assets.register','assets.operation','asset_links.create','measurements.create','certificates.create','classifications.create','deadlines.create') then
  return pi_gestao_private.ga_api(p_tenant,p_action,p_payload);
 end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Payload inválido.';end if;
 actor:=pi_gestao_private.ga_require_access(p_tenant,true);
 owner_id:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,owner_id);
 request_id:=(p_payload->>'requestId')::uuid;
 if request_id is null then raise exception 'Identificador da operação obrigatório.';end if;
 digest:=pi_gestao_private.ga_hash(p_payload);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||owner_id::text||p_action||request_id::text,0));
 select * into receipt from pi_gestao_private.operation_receipts where tenant_id=p_tenant and operation_receipts.owner_id=ga_api_operational.owner_id and action=p_action and operation_receipts.request_id=ga_api_operational.request_id;
 if found then
  if receipt.digest<>digest or receipt.actor_user_id<>actor then raise exception using errcode='23505',message='Operação já registrada com outro conteúdo. Atualize a tela.';end if;
  return receipt.result;
 end if;

 if p_action='field_lvts.create' then
  inspection:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'inspectionId')::uuid,'inspection');
  if inspection->>'type'<>'visual' or inspection->>'status'='concluida' then raise exception 'Selecione uma inspeção visual em aberto.';end if;
  observed:=pi_gestao_private.ga_date(p_payload->>'observedOn','Data da inspeção',true);
  if observed::date>current_date then raise exception 'A inspeção realizada não pode ter data futura.';end if;
  b:=jsonb_build_object('assetId',inspection->>'assetId','inspectionId',inspection->>'id','campaignId',inspection->>'campaignId','contractId',inspection->>'contractId','systemId',inspection->>'systemId','module',inspection->>'module','recordClass','field_lvt','observedOn',observed,'inspector',pi_gestao_private.ga_text(p_payload->>'inspector','Responsável pela inspeção',300),'procedure',nullif(btrim(p_payload->>'procedure'),''),'status','em_preenchimento','source',jsonb_build_object('format','field_record','actorUserId',actor,'observedOn',observed));
  result:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'lvt','field:'||request_id,b,null,actor);
  perform pi_gestao_private.ga_link(p_tenant,owner_id,(result->>'id')::uuid,'lvt',(inspection->>'id')::uuid,'inspection','records_inspection',actor);
 elsif p_action='field_items.create' then
  lvt:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'lvtId')::uuid,'lvt');
  if lvt->>'recordClass' is distinct from 'field_lvt' then raise exception 'Registro de campo exige LVT de campo; a fonte histórica é preservada.';end if;
  inspection:=pi_gestao_private.ga_record(p_tenant,owner_id,(lvt->>'inspectionId')::uuid,'inspection');
  if inspection->>'status'='concluida' then raise exception 'Inspeção concluída. Abra uma reinspeção para novos registros.';end if;
  scope_fields:=jsonb_build_object('assetId',lvt->>'assetId','lvtId',lvt->>'id','inspectionId',lvt->>'inspectionId','campaignId',lvt->>'campaignId','contractId',lvt->>'contractId','systemId',lvt->>'systemId','module',lvt->>'module');
  observed:=lvt->>'observedOn'; evidence:=lvt->'source';
  b:=scope_fields||jsonb_build_object('itemKey',pi_gestao_private.ga_text(p_payload->>'itemKey','Número do item',100),'component',pi_gestao_private.ga_text(p_payload->>'component','Componente / ponto',1000),'description',pi_gestao_private.ga_text(p_payload->>'condition','Condição encontrada',10000),'observations',nullif(btrim(p_payload->>'observations'),''),'source',evidence,'recordClass','field_item','observedOn',observed);
  item:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'lvt_item','field:'||(lvt->>'id')||':'||(b->>'itemKey'),b,null,actor);
  perform pi_gestao_private.ga_link(p_tenant,owner_id,(item->>'id')::uuid,'lvt_item',(lvt->>'id')::uuid,'lvt','part_of_lvt',actor);
  result:=item;
  if nullif(btrim(p_payload->>'recommendation'),'') is not null then
   if lower(btrim(p_payload->>'recommendation')) in ('não se aplica','nao se aplica','sem recomendações','sem recomendacoes','n/a','nenhuma') then raise exception 'Sem recomendação: deixe o campo vazio para não criar RTI artificial.';end if;
   b:=scope_fields||jsonb_build_object('lvtItemId',item->>'id','description',item->>'description','recommendation',pi_gestao_private.ga_text(p_payload->>'recommendation','Recomendação',10000),'source',evidence,'sourceDate',observed,'currentness',case when observed::date=(item->>'createdAt')::timestamptz::date then 'confirmed_current' else 'unknown' end);
   finding:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'finding','field:'||(item->>'id'),b,null,actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(finding->>'id')::uuid,'finding',(item->>'id')::uuid,'lvt_item','found_in_item',actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(finding->>'id')::uuid,'finding',(lvt->>'id')::uuid,'lvt','found_in',actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(finding->>'id')::uuid,'finding',(lvt->>'assetId')::uuid,'asset','affects',actor);
   b:=scope_fields||jsonb_build_object('lvtItemId',item->>'id','findingId',finding->>'id','title',finding->>'recommendation','recommendation',finding->>'recommendation','originType','field_recommendation','source',evidence,'sourceDate',observed,'sourceStatus','Recomendação registrada na inspeção','status',case when observed::date=(item->>'createdAt')::timestamptz::date then 'aberta' else 'atualidade_desconhecida' end,'currentness',case when observed::date=(item->>'createdAt')::timestamptz::date then 'confirmed_current' else 'unknown' end,'currentnessConfirmedAt',case when observed::date=(item->>'createdAt')::timestamptz::date then (finding->>'createdAt')::timestamptz else null end,'currentnessEvidence',case when observed::date=(item->>'createdAt')::timestamptz::date then 'Recomendação registrada na LVT de campo por '||(lvt->>'inspector') else null end,'actions','[]'::jsonb,'history','[]'::jsonb);
   rti:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'rti','recommendation:'||(finding->>'id'),b,null,actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(rti->>'id')::uuid,'rti',(item->>'id')::uuid,'lvt_item','addresses_item',actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(rti->>'id')::uuid,'rti',(finding->>'id')::uuid,'finding','addresses',actor);
   perform pi_gestao_private.ga_link(p_tenant,owner_id,(rti->>'id')::uuid,'rti',(lvt->>'assetId')::uuid,'asset','affects',actor);
   result:=result||jsonb_build_object('finding',finding,'rti',rti);
  end if;
 elsif p_action='rtis.update' then
  id:=(p_payload->>'id')::uuid;
  perform 1 from pi_gestao_private.records where tenant_id=p_tenant and records.owner_id=ga_api_operational.owner_id and records.id=ga_api_operational.id for update;
  rti:=pi_gestao_private.ga_record(p_tenant,owner_id,id,'rti'); b:='{}';
  if p_payload ? 'due' then b:=b||jsonb_build_object('due',pi_gestao_private.ga_date(p_payload->>'due','Prazo'));end if;
  if p_payload ? 'responsible' then b:=b||jsonb_build_object('responsible',nullif(btrim(p_payload->>'responsible'),''));end if;
  event:=jsonb_build_object('requestId',request_id,'at',now(),'actor',actor,'description',pi_gestao_private.ga_text(p_payload->>'evidence','Registro / evidência do acompanhamento',10000));
  if nullif(p_payload->>'evidenceDocumentId','') is not null then
   doc:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'evidenceDocumentId')::uuid,'document');
   if doc->>'assetId' is distinct from rti->>'assetId' or rti->>'assetId' is null then raise exception 'Evidência de atendimento deve estar vinculada ao mesmo ativo.';end if;
   event:=event||jsonb_build_object('documentId',doc->>'id');
  end if;
  if nullif(btrim(p_payload->>'action'),'') is not null then b:=b||jsonb_build_object('actions',coalesce(rti->'actions','[]')||jsonb_build_array(jsonb_build_object('description',pi_gestao_private.ga_text(p_payload->>'action','Ação',10000),'at',now(),'actor',actor,'evidence',p_payload->>'evidence','documentId',doc->>'id')));end if;
  status_value:=nullif(p_payload->>'status','');
  if status_value is not null then
   if status_value not in ('aberta','encerrada') then raise exception 'Situação atual inválida.';end if;
   observed:=pi_gestao_private.ga_date(p_payload->>'confirmedOn','Data da verificação atual',true);
   if observed::date<>current_date then raise exception 'A situação atual exige verificação de hoje. Preserve verificações anteriores no histórico.';end if;
   if status_value='encerrada' then
    perform pi_gestao_private.ga_text(p_payload->>'reinspection','Resultado da reinspeção / verificação de atendimento',10000);
    if doc is null then raise exception 'Encerramento exige documento de evidência vinculado ao ativo.';end if;
    b:=b||jsonb_build_object('closureEvidence',p_payload->>'evidence','closureDocumentId',doc->>'id','closedAt',now(),'reinspection',p_payload->>'reinspection');
   else b:=b||jsonb_build_object('closedAt',null);end if;
   b:=b||jsonb_build_object('status',status_value,'currentness','confirmed_current','currentnessConfirmedAt',now(),'currentnessEvidence',p_payload->>'evidence');
  elsif nullif(btrim(p_payload->>'reinspection'),'') is not null then b:=b||jsonb_build_object('reinspection',p_payload->>'reinspection');end if;
  b:=b||jsonb_build_object('history',coalesce(rti->'history','[]')||jsonb_build_array(event));
  result:=pi_gestao_private.ga_change(p_tenant,owner_id,id,'rti',(p_payload->>'expectedVersion')::bigint,b,actor,'acompanhamento de RTI');
 elsif p_action='inspections.update' then
  inspection:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'id')::uuid,'inspection');
  status_value:=p_payload->>'status';
  if status_value is null or status_value not in ('em_andamento','concluida') then raise exception 'Situação de inspeção inválida.';end if;
  observed:=pi_gestao_private.ga_date(p_payload->>'done','Data de execução',true);
  if observed::date>current_date then raise exception 'Data de execução futura não é permitida.';end if;
  if status_value='concluida' and not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and records.owner_id=ga_api_operational.owner_id and body->>'inspectionId'=inspection->>'id' and (kind='lvt_item' or kind='document' and body->>'recordClass'='measurement')) then raise exception 'Conclusão exige itens ou medições registrados nesta inspeção.';end if;
  b:=jsonb_build_object('status',status_value,'done',observed,'executionSource',pi_gestao_private.ga_text(p_payload->>'evidence','Evidência de execução',10000));
  result:=pi_gestao_private.ga_change(p_tenant,owner_id,(inspection->>'id')::uuid,'inspection',(p_payload->>'expectedVersion')::bigint,b,actor,'andamento da inspeção');
 elsif p_action='assets.register' then
  target:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'systemId')::uuid,'system');
  if p_payload->>'type' is null or p_payload->>'type' not in ('linha','segmento','tanque','vaso','caldeira','valvula','outro') then raise exception 'Tipo de ativo inválido.';end if;
  perform pi_gestao_private.ga_text(p_payload->>'tag','TAG',300);
  if jsonb_array_length(pi_gestao_private.ga_tag_blockers(p_payload->>'tag','Cadastro'))>0 then raise exception 'TAG provisória não pode ser registrada como definitiva.';end if;
  if exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and records.owner_id=ga_api_operational.owner_id and kind='asset' and body->>'systemId'=target->>'id' and lower(btrim(body->>'tag'))=lower(btrim(p_payload->>'tag'))) then raise exception 'A TAG já existe neste sistema. Utilize o mesmo ativo.';end if;
  evidence:=pi_gestao_private.ga_evidence(p_tenant,owner_id,p_payload,actor);
  b:=jsonb_build_object('tag',btrim(p_payload->>'tag'),'type',p_payload->>'type','unitId',target->>'unitId','systemId',target->>'id','identification',nullif(p_payload->>'identification',''),'technical',jsonb_build_object('fluid',jsonb_build_object('value',nullif(p_payload->>'fluid',''),'source',evidence)),'source',evidence,'operation','nao_informado','technicalCondition','nao_avaliado');
  result:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'asset','documented:'||request_id,b,evidence->>'sourceId',actor);
 elsif p_action='assets.operation' then
  asset:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'assetId')::uuid,'asset');
  status_value:=p_payload->>'operation';
  if status_value is null or status_value not in ('em_operacao','fora_de_operacao','descontinuado','nao_informado') then raise exception 'Situação operacional inválida.';end if;
  if status_value in ('fora_de_operacao','descontinuado') then perform pi_gestao_private.ga_text(p_payload->>'reason','Motivo da situação operacional');end if;
  b:=jsonb_build_object('operation',status_value,'operationReason',nullif(p_payload->>'reason',''),'operationEvidence',pi_gestao_private.ga_text(p_payload->>'evidence','Evidência da situação operacional',10000),'operationConfirmedAt',now());
  result:=pi_gestao_private.ga_change(p_tenant,owner_id,(asset->>'id')::uuid,'asset',(p_payload->>'expectedVersion')::bigint,b,actor,'situação operacional do ativo');
 else
  asset:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'assetId')::uuid,'asset');
  evidence:=pi_gestao_private.ga_evidence(p_tenant,owner_id,p_payload,actor);
  b:=jsonb_build_object('assetId',asset->>'id','systemId',asset->>'systemId','reference',pi_gestao_private.ga_text(p_payload->>'reference','Identificação do registro',500),'source',evidence,'currentness','unknown');
  if p_action='asset_links.create' then
   target:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'toAssetId')::uuid,'asset');
   if asset->>'id'=target->>'id' or p_payload->>'kind' is null or p_payload->>'kind' not in ('valvula_psv','linha_integridade','medicao_espessura','relacao_documentada') then raise exception 'Relação entre ativos inválida.';end if;
   if p_payload->>'kind'='valvula_psv' and target->>'type'<>'valvula' and asset->>'type'<>'valvula' then raise exception 'Relação de PSV exige uma válvula cadastrada.';end if;
   b:=b||jsonb_build_object('recordClass','assetLink','fromAssetId',asset->>'id','toAssetId',target->>'id','kind',p_payload->>'kind','basis',pi_gestao_private.ga_text(p_payload->>'basis','Comprovação do vínculo',10000));
  elsif p_action='measurements.create' then
   inspection:=pi_gestao_private.ga_record(p_tenant,owner_id,(p_payload->>'inspectionId')::uuid,'inspection');
   if inspection->>'assetId' is distinct from asset->>'id' or inspection->>'type'<>'espessura' then raise exception 'Medição exige inspeção de espessura do mesmo ativo.';end if;
   observed:=pi_gestao_private.ga_date(p_payload->>'measuredOn','Data da medição',true);
   if observed::date>current_date then raise exception 'Medição realizada não pode ter data futura.';end if;
   if jsonb_typeof(p_payload->'readings') is distinct from 'array' or jsonb_array_length(p_payload->'readings') not between 1 and 1000 then raise exception 'Informe de 1 a 1000 leituras documentadas.';end if;
   for row_value in select value from jsonb_array_elements(p_payload->'readings') loop
    perform pi_gestao_private.ga_text(row_value->>'point','Ponto da leitura',200);
    if row_value->>'unit' not in ('mm','in') or row_value->>'unit' is null or (row_value->>'value') !~ '^\d+(\.\d+)?$' then raise exception 'Leitura deve ter número e unidade mm ou in.';end if;
    amount:=(row_value->>'value')::numeric;if amount is null or amount<=0 then raise exception 'Leitura deve ser positiva.';end if;
   end loop;
   b:=b||jsonb_build_object('recordClass','measurement','module','integridade','inspectionId',inspection->>'id','campaignId',inspection->>'campaignId','contractId',inspection->>'contractId','measuredOn',observed,'instrument',nullif(p_payload->>'instrument',''),'calibration',nullif(p_payload->>'calibration',''),'procedure',nullif(p_payload->>'procedure',''),'readings',p_payload->'readings');
  elsif p_action='certificates.create' then
   if asset->>'type'<>'valvula' then raise exception 'Certificado de válvula exige uma válvula cadastrada.';end if;
   b:=b||jsonb_build_object('recordClass','certificate','module','valvulas','documentType','certificado_valvula','issuedOn',pi_gestao_private.ga_date(p_payload->>'issuedOn','Data do certificado'),'validUntil',pi_gestao_private.ga_date(p_payload->>'validUntil','Validade documental'),'issuer',nullif(p_payload->>'issuer',''),'resultText',nullif(p_payload->>'resultText',''));
  elsif p_action='classifications.create' then
   if p_payload->>'scope' is null or p_payload->>'scope' not in ('covered','not_covered','excluded','pending') then raise exception 'Enquadramento documental inválido.';end if;
   if nullif(p_payload->>'category','') is not null and not ((asset->>'type'='vaso' and p_payload->>'category' in ('I','II','III','IV','V')) or (asset->>'type'='caldeira' and p_payload->>'category' in ('A','B'))) then raise exception 'Categoria incompatível com o tipo de equipamento.';end if;
   b:=b||jsonb_build_object('recordClass','classification','module','nr13','reviewStatus','revisado','classificationMethod','documented','assetType',asset->>'type','responsible',pi_gestao_private.ga_text(p_payload->>'responsible','Responsável pelo enquadramento documental',300),'basis',pi_gestao_private.ga_text(p_payload->>'basis','Conclusão transcrita do documento',10000),'result',jsonb_build_object('scope',p_payload->>'scope','category',nullif(p_payload->>'category','')));
  elsif p_action='deadlines.create' then
   if p_payload->>'type' is null or p_payload->>'type' not in ('interna','externa','extraordinaria','certificacao') then raise exception 'Tipo de prazo inválido.';end if;
   b:=b||jsonb_build_object('recordClass','deadline','module','nr13','type',p_payload->>'type','due',pi_gestao_private.ga_date(p_payload->>'due','Próxima inspeção documentada',true));
  end if;
  key_name:=pi_gestao_private.ga_hash(jsonb_build_array(b->>'recordClass',asset->>'id',evidence->>'sourceId',evidence->'locator',b->>'toAssetId'));
  result:=pi_gestao_private.ga_origin_put(p_tenant,owner_id,'document','operational:'||key_name,b,evidence->>'sourceId',actor);
  perform pi_gestao_private.ga_link(p_tenant,owner_id,(result->>'id')::uuid,'document',(asset->>'id')::uuid,'asset','documents_asset',actor);
  if p_action='asset_links.create' then perform pi_gestao_private.ga_link(p_tenant,owner_id,(result->>'id')::uuid,'document',(target->>'id')::uuid,'asset','documents_asset',actor);end if;
 end if;
 insert into pi_gestao_private.operation_receipts(tenant_id,owner_id,action,request_id,digest,result,actor_user_id) values(p_tenant,ga_api_operational.owner_id,p_action,ga_api_operational.request_id,ga_api_operational.digest,ga_api_operational.result,actor);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.prepare_invite(p_email text, p_company_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.company_save(p_name text, p_company_id uuid DEFAULT NULL::uuid, p_expected_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if pi_access_private.tenants_enabled() then raise exception 'use_company_save_v3_api' using errcode='42501';end if;return pi_access_private.company_save_legacy(p_name,p_company_id,p_expected_name);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.dashboard(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select case when pi_access_private.tenants_enabled() then pi_access_private.dashboard_v3(p_company_id) else pi_access_private.dashboard_legacy(p_company_id) end;$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_dashboard_v3(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.dashboard_v3(p_company_id);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.license_change(p_company_id,p_action,p_expected_revision,p_seat_limit,p_plan_kind,p_days,p_new_expiry,p_reason);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.membership_change(p_user_id,p_company_id,p_action,p_reason);$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_access_private.company_save_v3(p_name,p_company_id,p_expected_name,p_reason);$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_admin_retry(p_job bigint)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.admin_retry(p_job)$function$;

CREATE OR REPLACE FUNCTION public.pi_admin_migration_map()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.migration_map();$function$;

CREATE OR REPLACE FUNCTION public.pi_my_company_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_access_private.my_company_access();$function$;

CREATE OR REPLACE FUNCTION pi_access_private.tenant_write_guard()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not pi_access_private.tenants_enabled() or (select writes_paused from pi_access_private.tenant_rollout where singleton) then raise exception 'tenant_writes_unavailable' using errcode='42501';end if;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.tenants_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select enabled from pi_access_private.tenant_rollout where singleton;$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_admin_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_billing_private.admin_status()$function$;

CREATE OR REPLACE FUNCTION pi_billing_private.claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j pi_billing_private.jobs%rowtype; b pi_billing_private.bindings%rowtype; token uuid:=gen_random_uuid();
begin
 perform pi_billing_private.caller(null,true);
 -- Expired final leases cannot remain stuck indefinitely.
 update pi_billing_private.jobs set state='review',reason='attempts_exhausted',lease=null,lease_until=null
 where state='processing' and lease_until<clock_timestamp() and attempts>=5;
 select * into j from pi_billing_private.jobs q where attempts<5 and
 ((state in('pending','retry') and next_attempt<=clock_timestamp()) or (state='processing' and lease_until<clock_timestamp()))
 order by id for update skip locked limit 1;
 if not found then return null;end if;
 select * into b from pi_billing_private.bindings where provider_subscription=j.subscription_hint;
 if not found or exists(select 1 from pi_billing_private.inbox where event_id=j.event_id and conflict) then
  update pi_billing_private.jobs set state='review',reason=case when b.id is null then 'unmapped_subscription' else 'event_conflict' end,lease=null,lease_until=null where id=j.id;
  return jsonb_build_object('state','review','jobId',j.id);
 end if;
 -- Observe also excludes internal/indefinite licenses; it cannot affect them.
 if exists(select 1 from pi_access_private.company_licenses where company_id=b.company_id and plan_kind='indefinite')
 or exists(select 1 from pi_access_private.company_seat_exemptions where company_id=b.company_id) then
  update pi_billing_private.jobs set state='review',reason='internal_license_protected',lease=null,lease_until=null where id=j.id;
  return jsonb_build_object('state','review','jobId',j.id);
 end if;
 update pi_billing_private.jobs set state='processing',lease=token,lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1 where id=j.id returning * into j;
 return jsonb_build_object('state','processing','jobId',j.id,'lease',j.lease,'kind',j.kind,'resourceId',j.resource_id,
 'subscription',b.provider_subscription,'customer',b.provider_customer,'bindingId',b.id,'quantity',b.quantity,'offset',j.page_offset,'attempts',j.attempts);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.identity_verified(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and (banned_until is null or banned_until<=statement_timestamp()));$function$;

CREATE OR REPLACE FUNCTION pi_access_private.company_active(p_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from pi_access_private.company_licenses where company_id=p_company and migration_state='ready' and license_state='active' and activated_at<=statement_timestamp() and (plan_kind='indefinite' or expires_at>statement_timestamp()));$function$;

CREATE OR REPLACE FUNCTION pi_access_private.account_active_legacy(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_user is not null and exists (
    select 1 from pi_access_private.accounts a join auth.users u on u.id=a.user_id
    where a.user_id=p_user and a.access_state='approved' and u.email_confirmed_at is not null
      and (a.access_kind='standard' or (a.activated_at<=statement_timestamp() and a.expires_at>statement_timestamp()))
  );
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.tenant_manage(p_company uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if not pi_access_private.is_master() and not pi_gestao_private.has_company_role(p_company,array['admin']) then raise exception 'company_admin_required' using errcode='42501';end if;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.company_license_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 insert into pi_access_private.company_licenses(company_id,migration_state) values(new.id,'new');return new;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.membership_seat_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_nr13_result(t text, i jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare p numeric;v numeric;d numeric;temp numeric;toxic numeric;fc text;s text:='pending';cat text;g int;pv numeric;
 missing jsonb:='[]';checks jsonb:='[]';k text;support text:=i->>'support';criterion text:=i->>'fluidCriterion';
begin
 if jsonb_typeof(i) is distinct from 'object' then raise exception 'Dados técnicos inválidos.';end if;
 for k in select unnest(array['pressureKpa','volumeM3','diameterM','temperatureC','toxicPpm']) loop
  if nullif(i->>k,'') is not null and (i->>k !~ '^-?[0-9]+(\.[0-9]+)?$' or length(i->>k)>24) then raise exception 'Valor numérico inválido: %',k;end if;
 end loop;
 p:=nullif(i->>'pressureKpa','')::numeric;v:=nullif(i->>'volumeM3','')::numeric;d:=nullif(i->>'diameterM','')::numeric;temp:=nullif(i->>'temperatureC','')::numeric;toxic:=nullif(i->>'toxicPpm','')::numeric;
 if p<0 or v<=0 or d<=0 or toxic<0 then raise exception 'Dimensões inválidas.';end if;
 if nullif(btrim(i->>'fluidEvidence'),'') is not null then fc:=case
 when criterion in ('flammable','hydrogen','acetylene') then 'A'
 when criterion='combustible' and temp>=200 then 'A' when criterion='combustible' and temp<200 then 'B'
 when criterion='toxic' and toxic<=20 then 'A' when criterion='toxic' and toxic>20 then 'B'
 when criterion in ('steam','air','asphyxiant') then 'C' when criterion='other' then 'D' end;end if;
 if t='tanque' then
  if support in ('structural','buried','legs','saddles','pedestals','shoes') then s:='excluded';checks:=checks||jsonb_build_array('13.2.2(l,n): exclusão conforme construção e apoio documentados; permanece o dever de inspeção/manutenção.');
  elsif i->>'metal'='no' then s:='not_covered';checks:=checks||jsonb_build_array('13.2.1(f): tanque não metálico fora desta alínea.');
  else
   if support is distinct from 'ground' then missing:=missing||jsonb_build_array('Forma de apoio e integração estrutural comprovadas');end if;
   if i->>'metal' is distinct from 'yes' then missing:=missing||jsonb_build_array('Material metálico comprovado');end if;
   if i->>'tankDefinition' is distinct from 'yes' then missing:=missing||jsonb_build_array('Compatibilidade da construção e geometria com a definição de tanque do glossário');end if;
   if p is null then missing:=missing||jsonb_build_array('Pressão de operação em kPa manométricos');end if;
   if v is null then missing:=missing||jsonb_build_array('Capacidade nominal em m³');end if;
   if d is null then missing:=missing||jsonb_build_array('Diâmetro externo aplicável; geometria retangular exige critério técnico documentado');end if;
   if fc is null then missing:=missing||jsonb_build_array('Propriedade do fluido comprovada por FDS ou referência técnica e temperatura aplicável');end if;
   checks:=checks||jsonb_build_array('13.2.1(f): diâmetro externo > 3 m, volume > 20 m³ e fluido classe A ou B.','Glossário: pressão atmosférica ou pressão de operação inferior a 103 kPa.');
   if jsonb_array_length(missing)=0 then
    s:=case when p<103 and d>3 and v>20 and fc in ('A','B') then 'covered' when p>=103 then 'pending' else 'not_covered' end;
    if p>=103 then missing:=missing||jsonb_build_array('Pressão incompatível com definição de tanque: revisar tipo e código do equipamento');end if;
   end if;
  end if;
 elsif t='vaso' then
  if i->>'exclusionsReviewed' is distinct from 'yes' or i->>'specificExclusion' is distinct from 'no' then missing:=missing||jsonb_build_array('Conferência documentada das exclusões de 13.2.2');end if;
  if d is not null and d<0.15 then s:='excluded';checks:=checks||jsonb_build_array('13.2.2(f): diâmetro interno inferior a 150 mm.');
  else
   if d is null then missing:=missing||jsonb_build_array('Diâmetro interno para conferir exclusão de 13.2.2(f)');end if;
   if p is null then missing:=missing||jsonb_build_array('Pressão máxima de operação em kPa manométricos');end if;
   if v is null then missing:=missing||jsonb_build_array('Volume interno em m³');end if;
   if fc is null then missing:=missing||jsonb_build_array('Propriedade do fluido e evidência da classificação');end if;
   checks:=checks||jsonb_build_array('13.2.1(b,c): P×V > 8 kPa·m³ ou fluido classe A.');
   if jsonb_array_length(missing)=0 then
    s:=case when p*v>8 or fc='A' then 'covered' else 'not_covered' end;
    if s='covered' then
     pv:=p*v/1000;g:=case when pv>100 then 1 when pv>30 and pv<100 then 2 when pv>2.5 and pv<30 then 3 when pv>1 and pv<2.5 then 4 when pv<1 then 5 end;
     if g is null then missing:=missing||jsonb_build_array('P×V exatamente no limite entre grupos: revisar desigualdades do texto normativo');
     else cat:=case fc when 'A' then (array['I','I','II','III','III'])[g] when 'B' then (array['I','II','III','IV','IV'])[g] when 'C' then (array['I','II','III','IV','V'])[g] when 'D' then (array['II','III','IV','V','V'])[g] end;end if;
    end if;
   end if;
  end if;
 elsif t='caldeira' then
  if v is not null and v<0.1 then s:='excluded';checks:=checks||jsonb_build_array('13.2.2(k): volume inferior a 100 L.');
  else
   if v is null then missing:=missing||jsonb_build_array('Volume interno em m³');end if;
   if p is null then missing:=missing||jsonb_build_array('Pressão de operação em kPa');end if;
   if i->>'exclusionsReviewed' is distinct from 'yes' or i->>'specificExclusion' is distinct from 'no' then missing:=missing||jsonb_build_array('Conferência documentada das exclusões de 13.2.2');end if;
   if jsonb_array_length(missing)=0 then s:=case when p>60 then 'covered' else 'not_covered' end;if s='covered' then cat:=case when p>=1960 then 'A' else 'B' end;end if;end if;
   checks:=checks||jsonb_build_array('13.2.1(a): pressão > 60 kPa; 13.4.1.1: A ≥ 1.960 kPa, B > 60 e < 1.960 kPa.');
  end if;
 else missing:=missing||jsonb_build_array('Tipo de equipamento exige regra específica e vínculos comprovados; não recebe categoria de vaso por analogia.');end if;
 return jsonb_build_object('scope',s,'category',cat,'fluidClass',fc,'riskGroup',g,'pvMpaM3',pv,'missing',missing,'checks',checks,'ruleVersion','NR13-2022/2026.1','technicalApproval',false,'normativeBasis','NR-13 oficial consolidada, Portarias MTP 1.846/2022 e 4.219/2022; conferida em 27/10/2026');
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_api_prepared(p_tenant uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare actor uuid;own uuid;asset jsonb;evidence jsonb;result jsonb;b jsonb;h jsonb;m jsonb;r jsonb;issues jsonb;source_id text;k text;
 ids jsonb:='[]';pending jsonb:='[]';systems jsonb:='{}';sys text;con jsonb;camp jsonb;count_ok int:=0;count_dup int:=0;counts jsonb;prior jsonb;typ text;src text;d jsonb;job pi_gestao_private.previews;cursor_pos int:=0;batch_end int;
begin
 if p_action not in ('nr13.assess','line_lists.prepare','perenco.tq_book') or p_action is null then return pi_gestao_private.ga_api_operational(p_tenant,p_action,p_payload);end if;
 actor:=pi_gestao_private.ga_require_access(p_tenant,true);own:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,own);
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||own::text||p_action,0));
 if p_action='nr13.assess' then
  if p_payload ? 'result' or p_payload ? 'category' or p_payload ? 'scope' then raise exception 'Resultado calculado exclusivamente pelo servidor.';end if;
  asset:=pi_gestao_private.ga_record(p_tenant,own,(p_payload->>'assetId')::uuid,'asset');evidence:=pi_gestao_private.ga_evidence(p_tenant,own,p_payload,actor);
  result:=pi_gestao_private.ga_nr13_result(asset->>'type',p_payload->'inputs');
  b:=jsonb_build_object('recordClass','classification','module','nr13','assetId',asset->>'id','systemId',asset->>'systemId','assetType',asset->>'type','classificationMethod','automatic_nr13','reviewStatus','calculado','reference','Enquadramento automático NR-13','source',evidence,'inputs',p_payload->'inputs','result',result,'basis',result->>'normativeBasis','ruleVersion',result->>'ruleVersion','currentness','unknown');
  result:=pi_gestao_private.ga_origin_put(p_tenant,own,'document','nr13:'||pi_gestao_private.ga_hash(b),b,evidence->>'sourceId',actor);
  perform pi_gestao_private.ga_link(p_tenant,own,(result->>'id')::uuid,'document',(asset->>'id')::uuid,'asset','documents_asset',actor);return result;
 end if;
 if not exists(select 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=own and lower(name)='perenco') then raise exception 'Originais confirmados exclusivamente para Perenco.';end if;
 if p_action='line_lists.prepare' then
  m:=p_payload->'manifest';source_id:=m->>'sourceId';
  if pi_gestao_private.ga_hash(m) is distinct from 'd462569987a9a9f5858fc06edafb06c8b7811c44fa702b3a4cfd9adbaff749f6' then raise exception 'Organização diverge da extração assistida conferida.';end if;
  if m->>'schema' is distinct from 'pires-line-list-review-1' or source_id is distinct from 'a075a11ac1cfc78aee64c088f9bb65e9794a3761179b31e8be92c38778d7d141' or m->>'unit' is distinct from 'Plataforma de Cherne 1 (PCH-1)' or m->>'sheet' is distinct from '04 - Line List - Relatórios' or jsonb_array_length(m->'rows') is distinct from 1769 then raise exception 'Manifesto da lista confirmada inválido.';end if;
  evidence:=pi_gestao_private.ga_evidence(p_tenant,own,jsonb_build_object('sourceId',source_id,'locator',jsonb_build_object('sheet',m->>'sheet','row',17)),actor);k:='assisted-list:'||source_id;
  select rec.body||jsonb_build_object('id',rec.id) into prior from pi_gestao_private.record_origins o join pi_gestao_private.records rec on rec.tenant_id=o.tenant_id and rec.owner_id=o.owner_id and rec.id=o.record_id where o.tenant_id=p_tenant and o.owner_id=own and o.kind='document' and o.origin_key=k;
  if found then return prior||jsonb_build_object('reused',true);end if;
  -- Private checkpoint. consumed=true keeps it outside the generic import/commit flow.
  select * into job from pi_gestao_private.previews p where p.tenant_id=p_tenant and p.owner_id=own and p.body->>'jobKey'=k for update;
  if found then
   if job.created_by is distinct from actor then raise exception using errcode='42501',message='Processamento privado de outro operador.';end if;
   cursor_pos:=(job.body->>'cursor')::int;ids:=job.body->'ids';pending:=job.body->'pending';systems:=job.body->'systems';count_ok:=(job.body->>'countOk')::int;count_dup:=(job.body->>'countDup')::int;
  else
   insert into pi_gestao_private.previews(tenant_id,owner_id,source_id,created_by,consumed,body) values(p_tenant,own,source_id,actor,true,jsonb_build_object('jobKey',k,'cursor',0,'ids',ids,'pending',pending,'systems',systems,'countOk',0,'countDup',0)) returning * into job;
  end if;
  batch_end:=least(cursor_pos+100,jsonb_array_length(m->'rows'));
  select jsonb_object_agg(tag,n) into counts from(select lower(btrim(value->>'tag')) tag,count(*) n from jsonb_array_elements(m->'rows') group by lower(btrim(value->>'tag'))) c;
  for r in select value from jsonb_array_elements(m->'rows') with ordinality rows(value,n) where n>cursor_pos and n<=batch_end order by n loop
   issues:=coalesce(r->'issues','[]');
   if (counts->>lower(btrim(r->>'tag')))::int>1 then issues:=issues||jsonb_build_array('TAG repetida: reconciliar origem e segmentos antes do cadastro.');count_dup:=count_dup+1;end if;
   issues:=issues||pi_gestao_private.ga_tag_blockers(r->>'tag','Linha '||(r->>'row'));
   if r->>'tag' ~* '(S\s*/\s*TAG|SEM\s*TAG|TBD|XXX)' then issues:=issues||jsonb_build_array('Identificação sem TAG definitiva na fonte');end if;
   if nullif(btrim(r->>'system'),'') is null then issues:=issues||jsonb_build_array('Sistema não informado');end if;
   if jsonb_array_length(issues)>0 then pending:=pending||jsonb_build_array(r||jsonb_build_object('issues',issues));continue;end if;
   h:=pi_gestao_private.ga_hierarchy(p_tenant,own,m->>'unit',r->>'system',actor);
   if exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='asset' and body->>'unitId'=h->'unit'->>'id' and lower(btrim(body->>'tag'))=lower(btrim(r->>'tag'))) then pending:=pending||jsonb_build_array(r||jsonb_build_object('issues',jsonb_build_array('TAG já cadastrada na unidade; conferir vínculo por ID.')));continue;end if;
   evidence:=pi_gestao_private.ga_evidence(p_tenant,own,jsonb_build_object('sourceId',source_id,'locator',jsonb_build_object('sheet',m->>'sheet','row',(r->>'row')::int)),actor);
   b:=jsonb_build_object('tag',r->>'tag','type','linha','unitId',h->'unit'->>'id','systemId',h->'system'->>'id','operation','nao_informado','technicalCondition','nao_avaliado','source',evidence,'technical',jsonb_build_object('fluid',jsonb_build_object('value',r->>'fluid','source',evidence),'material',jsonb_build_object('value',r->>'material','source',evidence),'diameter',jsonb_build_object('value',r->>'diameter','unit','in','source',evidence),'circuit',jsonb_build_object('value',r->>'circuit','source',evidence)),'importMethod','assisted_literal_review');
   asset:=pi_gestao_private.ga_origin_put(p_tenant,own,'asset',k||':'||(r->>'row'),b,source_id,actor);
   ids:=ids||jsonb_build_array(asset->>'id');sys:=h->'system'->>'id';systems:=jsonb_set(systems,array[sys],coalesce(systems->sys,'[]')||jsonb_build_array(asset->>'id'),true);count_ok:=count_ok+1;
  end loop;
  update pi_gestao_private.previews set body=jsonb_build_object('jobKey',k,'cursor',batch_end,'ids',ids,'pending',pending,'systems',systems,'countOk',count_ok,'countDup',count_dup) where tenant_id=p_tenant and id=job.id;
  if batch_end<jsonb_array_length(m->'rows') then return jsonb_build_object('done',false,'processed',batch_end,'total',jsonb_array_length(m->'rows'));end if;
  if count_ok=0 then raise exception 'Nenhuma linha elegível para iniciar a campanha.';end if;
  b:=jsonb_build_object('name','Escopo PCH-1 — contrato a confirmar','recordClass','operational_scope','commercialStatus','a_confirmar','source','Organização assistida da lista PCH-1. Não comprova contrato ou execução pela Pires.','modules',jsonb_build_array('integridade'),'assetIds',ids,'moduleAssetIds',jsonb_build_object('integridade',ids),'status','rascunho');
  con:=pi_gestao_private.ga_origin_put(p_tenant,own,'contract',k,b,source_id,actor);
  for sys,ids in select key,value from jsonb_each(systems) loop
   h:=pi_gestao_private.ga_record(p_tenant,own,sys::uuid,'system');
   b:=jsonb_build_object('name','PCH-1 · '||(h->>'name'),'contractId',con->>'id','systemId',sys,'module','integridade','assetIds',ids,'plannedStart',null,'plannedEnd',null,'source','Lista PCH-1. Campanha em planejamento; execução e contrato a confirmar.','status','rascunho');
   camp:=pi_gestao_private.ga_origin_put(p_tenant,own,'campaign',k||':'||sys,b,source_id,actor);
   perform pi_gestao_private.ga_link(p_tenant,own,(camp->>'id')::uuid,'campaign',(con->>'id')::uuid,'contract','under_contract',actor);
  end loop;
  evidence:=pi_gestao_private.ga_evidence(p_tenant,own,jsonb_build_object('sourceId',source_id,'locator',jsonb_build_object('sheet',m->>'sheet','row',17)),actor);
  b:=jsonb_build_object('recordClass','line_list_review','documentType','outro','module','integridade','reference','Line list global PCH-1 · organização e pendências','source',evidence,'contractId',con->>'id','importedCount',count_ok,'pendingCount',jsonb_array_length(pending),'duplicateRows',count_dup,'pendingRows',pending,'notes',m->'notes','systems',systems,'extractionMethod','assisted_literal_review','currentness','unknown');
  return pi_gestao_private.ga_origin_put(p_tenant,own,'document',k,b,source_id,actor);
 end if;
 source_id:='95254bbfa8d4c828db150ff68a324f40643f61ef293225835e0da2ab2de1a525';
 evidence:=pi_gestao_private.ga_evidence(p_tenant,own,jsonb_build_object('sourceId',source_id,'locator',jsonb_build_object('page',1)),actor);
 perform pi_gestao_private.ga_evidence(p_tenant,own,jsonb_build_object('sourceId','b666c44fea24f0642d2b2720f3a064bac932a690814d0cde8a0c169d9ef4a9ba','locator',jsonb_build_object('page',2)),actor);
 h:=pi_gestao_private.ga_hierarchy(p_tenant,own,'Plataforma de Cherne 2 (PCH-2)','18 — Diesel System',actor);k:='perenco-tq04761-pch2-book-v1';
 select rec.body||jsonb_build_object('id',rec.id) into prior from pi_gestao_private.record_origins o join pi_gestao_private.records rec on rec.tenant_id=o.tenant_id and rec.owner_id=o.owner_id and rec.id=o.record_id where o.tenant_id=p_tenant and o.owner_id=own and o.kind='asset' and o.origin_key=k;
 if found then return prior||jsonb_build_object('reused',true);end if;
 if exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='asset' and body->>'unitId'=h->'unit'->>'id' and upper(body->>'tag')='TQ-04761') then raise exception 'TAG existente: reconciliar cadastro antes de preparar o book.';end if;
 b:=jsonb_build_object('tag','TQ-04761','type','tanque','unitId',h->'unit'->>'id','systemId',h->'system'->>'id','identification','Clean Diesel Storage Tank · módulo 047 · circuito DS.02','operation','nao_informado','technicalCondition','nao_avaliado','source',evidence,'technical',jsonb_build_object('fluid',jsonb_build_object('value','Clean Diesel','source',evidence)),
 'datasheet',jsonb_build_object('Fabricante','Snam Projetos','Partida informada','1980 (não é data de fabricação comprovada)','Código de projeto','R509 — edição a confirmar','Material','A283 Gr C','Volume nominal','112,5 m³','Pressão de projeto / operação / MAOP','Atmosférica','Temperatura de projeto / operação','40 °C / 25 °C','Espessuras nominais','Fundo 22,4 mm; costado 12,5 mm; teto 6,3 mm; dique 6,3 mm','Sobreespessura de corrosão','3 mm','Eficiência de junta informada','0,70','Geometria do desenho','Retangular; apoio e integração estrutural a confirmar','Data e prestadora da fonte','13/08/2025 · Priner','Referência do relatório','XXX/YYY — numeração provisória na fonte'),
 'bookPending',jsonb_build_array('Confirmar apoio, construção e critério dimensional para enquadramento NR-13.','Obter FDS do diesel e propriedades para a classe do fluido.','Obter relatório de inspeção realizada, medições efetivas e data da última inspeção.','Definir próximas inspeções com base documental e responsável técnico.','Confirmar situação operacional e histórico de recomendações/RTIs.','Confirmar dispositivos de segurança e certificados aplicáveis; N3 é respiro e N6 é extravasor no desenho.','Numeração provisória XXX/YYY deve ser reconciliada com documentos emitidos.'));
 asset:=pi_gestao_private.ga_origin_put(p_tenant,own,'asset',k,b,source_id,actor);
 for src,typ in select * from (values(source_id,'Plano de inspeção · Priner · 13/08/2025 · PCH-2'),('b666c44fea24f0642d2b2720f3a064bac932a690814d0cde8a0c169d9ef4a9ba','Desenho de inspeção · pontos PTM e bocais · PCH-2')) x(s,t) loop
  d:=pi_gestao_private.ga_api_operational(p_tenant,'documents.create',jsonb_build_object('ownerId',own,'assetId',asset->>'id','module','nr13','documentType','outro','reference',typ,'sourceId',src,'locator',jsonb_build_object('page',1),'sourceDate','2025-08-13'));
 end loop;
 result:=pi_gestao_private.ga_api_prepared(p_tenant,'nr13.assess',jsonb_build_object('ownerId',own,'assetId',asset->>'id','sourceId',source_id,'locator',jsonb_build_object('page',1),'inputs',jsonb_build_object('pressureKpa','0','volumeM3','112.5','temperatureC','25','metal','yes','support','unknown','tankDefinition','unknown','geometry','rectangular','fluidCriterion','unknown','sourceStatement','Campo NR-13 category: Yes; não informa categoria I–V nem demonstra critérios.')));
 return asset||jsonb_build_object('classification',result);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.access_status_legacy(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid(); v_account pi_access_private.accounts%rowtype;
  v_membership public.pi_company_memberships%rowtype; v_status text := 'pending';
  v_master boolean := false; v_now timestamptz := statement_timestamp();
begin
  if v_uid is null then
    return jsonb_build_object('version',1,'user_id',null,'status','unavailable','is_master',false,
      'company_id',null,'company_role',null,'activated_at',null,'expires_at',null,'server_now',v_now);
  end if;
  select * into v_account from pi_access_private.accounts where user_id=v_uid;
  v_master := pi_access_private.is_master();
  select * into v_membership from public.pi_company_memberships m
    where m.user_id=v_uid and (p_company_id is null or m.company_id=p_company_id)
    order by case m.access_state when 'active' then 0 when 'pending' then 1 else 2 end,m.created_at,m.company_id limit 1;
  if v_master and p_company_id is null then v_status:='active';
  elsif v_account.access_state='revoked' or v_membership.access_state='revoked' then v_status:='revoked';
  elsif v_account.access_state='approved' and v_account.access_kind='trial' and v_account.expires_at<=v_now then v_status:='expired';
  elsif pi_access_private.account_active(v_uid)
    and (v_membership.access_state='active' or (v_master and p_company_id is null)) then v_status:='active';
  end if;
  return jsonb_build_object('version',1,'user_id',v_uid,'status',v_status,'is_master',v_master,
    'company_id',v_membership.company_id,'company_role',v_membership.role_name,
    'activated_at',v_account.activated_at,'expires_at',v_account.expires_at,'server_now',v_now);
end;
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.access_status_v2_legacy(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select pi_access_private.access_status(p_company_id)||jsonb_build_object('version',2,
 'trial_days',(select trial_days from pi_access_private.accounts where user_id=auth.uid()),
 'can_manage_company',coalesce(pi_gestao_private.has_company_role(p_company_id,array['admin']),false));
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.accept_invite_legacy(p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.trial_plan_legacy(p_user_id uuid, p_company_id uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.company_save_legacy(p_name text, p_company_id uuid DEFAULT NULL::uuid, p_expected_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.approve_legacy(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.revoke_access_legacy(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pi_access_private.require_master();
  if p_user_id=auth.uid() or exists(select 1 from pi_access_private.masters where user_id=p_user_id and revoked_at is null) then
    raise exception 'master_provisioning_requires_separate_review' using errcode='42501';
  end if;
  perform 1 from pi_access_private.accounts where user_id=p_user_id for update;
  update public.pi_company_memberships set access_state='revoked',revoked_at=clock_timestamp()
    where company_id=p_company_id and user_id=p_user_id;
  if not found then raise exception 'membership_required' using errcode='22023'; end if;
  if not exists(select 1 from public.pi_company_memberships where user_id=p_user_id and access_state='active') then
    update pi_access_private.accounts set access_state='revoked',revoked_at=clock_timestamp() where user_id=p_user_id;
  end if;
  insert into pi_access_private.activity(actor_id,target_user_id,company_id,event)
    values(auth.uid(),p_user_id,p_company_id,'access_revoked');
  return jsonb_build_object('user_id',p_user_id,'company_id',p_company_id,'status','revoked');
end;
$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_api_projects(p_tenant uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;own uuid;rid uuid;digest text;receipt pi_gestao_private.operation_receipts;
 c jsonb;result jsonb;b jsonb;technical jsonb;row_data jsonb;decision jsonb;decision_map jsonb;target jsonb;h jsonb;preview jsonb;prior jsonb;plan jsonb;task jsonb;doc jsonb;
 ids jsonb:='[]';rti_ids jsonb:='[]';decisions jsonb:='[]';module_name text;key_name text;ident text;date_value text;num integer;sv integer;pv integer;
begin
 if p_action='state.get' then
  result:=pi_gestao_private.ga_api_prepared(p_tenant,p_action,p_payload);own:=coalesce(p_payload->>'ownerId',p_payload->>'companyId')::uuid;
  foreach key_name in array array['projectScope','projectPlan','projectEvent'] loop
   select result||jsonb_build_object(key_name,coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq),'[]')) into result from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='document' and body->>'recordClass'=key_name;
  end loop;
  select result||jsonb_build_object('projectSnapshot',coalesce(jsonb_agg((body-'state')||jsonb_build_object('id',id,'version',version) order by seq),'[]')) into result from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='document' and body->>'recordClass'='projectSnapshot';
  -- Large immutable snapshots and previews are not repeated in normal state responses.
  select jsonb_set(result,'{document}',coalesce(jsonb_agg(value) filter(where coalesce(value->>'recordClass','') not in ('projectSnapshot','projectPreview')),'[]')) into result from jsonb_array_elements(result->'document');
  return result||jsonb_build_object('projectDashboardVersion',1,'asOf',now());
 end if;
 if p_action is null or p_action not in ('projects.create','projects.update','projects.preview','projects.scope','projects.plan','projects.event','projects.snapshot','projects.snapshot_get') then return pi_gestao_private.ga_api_prepared(p_tenant,p_action,p_payload);end if;
 actor:=pi_gestao_private.ga_require_access(p_tenant,p_action<>'projects.snapshot_get');own:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,own);
 if p_action='projects.snapshot_get' then
  result:=pi_gestao_private.ga_record(p_tenant,own,(p_payload->>'id')::uuid,'document');
  if result->>'recordClass'<>'projectSnapshot' then raise exception 'Resumo não encontrado.';end if;return result;
 end if;
 rid:=(p_payload->>'requestId')::uuid;if rid is null then raise exception 'Identificador estável obrigatório.';end if;
 digest:=pi_gestao_private.ga_hash(p_payload);
 perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=own for update;
 select * into receipt from pi_gestao_private.operation_receipts where tenant_id=p_tenant and owner_id=own and action=p_action and request_id=rid;
 if found then if receipt.digest<>digest or receipt.actor_user_id<>actor then raise exception using errcode='23505',message='Operação repetida com outro conteúdo.';end if;return receipt.result;end if;
 if p_action='projects.create' then
  module_name:=p_payload->>'module';if module_name is null or module_name not in ('integridade','rtis','nr13','valvulas') then raise exception 'Módulo obrigatório.';end if;
  b:=jsonb_build_object('name',pi_gestao_private.ga_text(p_payload->>'name','Projeto',200),'source',pi_gestao_private.ga_text(p_payload->>'source','Referência da organização do projeto'),'modules',jsonb_build_array(module_name),'moduleAssetIds',jsonb_build_object(module_name,'[]'::jsonb),'assetIds','[]'::jsonb,'rtiIds','[]'::jsonb,'status','rascunho','recordClass','operational_project','contractReference',nullif(p_payload->>'contractReference',''),'responsible',nullif(p_payload->>'responsible',''),'unit',nullif(p_payload->>'unit',''),'scopeVersion',0,'planVersion',0,'createdAt',now(),'createdBy',actor);
  result:=pi_gestao_private.ga_put(p_tenant,own,'contract',b,actor);
 else
  c:=pi_gestao_private.ga_record(p_tenant,own,(p_payload->>'contractId')::uuid,'contract');
  module_name:=p_payload->>'module';if c->>'recordClass'='commercial_reference' or module_name is null or not (c->'modules') ? module_name then raise exception 'Contrato não pertence ao módulo deste cliente.';end if;
  sv:=coalesce((c->>'scopeVersion')::integer,0);pv:=coalesce((c->>'planVersion')::integer,0);
  if p_action='projects.preview' then
   if jsonb_array_length(c->'modules')<>1 then raise exception 'Importação requer um projeto próprio deste módulo.';end if;
   result:=pi_gestao_private.gp_preview(p_tenant,own,c,p_payload,actor);
  elsif p_action='projects.scope' then
   preview:=pi_gestao_private.ga_record(p_tenant,own,(p_payload->>'previewId')::uuid,'document');
   if preview->>'recordClass'<>'projectPreview' or preview->>'contractId'<>c->>'id' or preview->>'module'<>module_name or preview->>'createdBy'<>actor::text or (preview->>'expectedVersion')::bigint<>(c->>'version')::bigint then raise exception using errcode='40001',message='Prévia desatualizada ou de outro projeto. Confira novamente.';end if;
   if p_payload->>'confirm' is distinct from 'true' or coalesce(p_payload->>'scopeMode','') not in ('append','replace') or jsonb_typeof(p_payload->'decisions') is distinct from 'array' then raise exception 'Confirme as decisões e o modo de atualização.';end if;
   if jsonb_array_length(p_payload->'decisions')<>jsonb_array_length(preview->'rows') or (select count(distinct value->>'row') from jsonb_array_elements(p_payload->'decisions'))<>jsonb_array_length(preview->'rows') then raise exception 'Cada linha exige uma decisão única.';end if;
   select coalesce(jsonb_object_agg(value->>'row',value),'{}') into decision_map from jsonb_array_elements(p_payload->'decisions');
   if p_payload->>'scopeMode'='append' then
    ids:=coalesce(c->'moduleAssetIds'->module_name,c->'assetIds','[]');rti_ids:=coalesce(c->'rtiIds','[]');
    select body into prior from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='document' and body->>'recordClass'='projectScope' and body->>'contractId'=c->>'id' and (body->>'scopeVersion')::integer=sv;
    select coalesce(jsonb_agg(q||jsonb_build_object('sourceId',coalesce(q->>'sourceId',prior->>'sourceId'))),'[]') into decisions from jsonb_array_elements(coalesce(prior->'decisions','[]')) q where q->'decision'->>'action'='review' and not (preview->>'sourceId' is not null and coalesce(q->>'sourceId',prior->>'sourceId')=preview->>'sourceId' and q->>'sheet'=preview->'input'->>'sheet' and exists(select 1 from jsonb_array_elements(preview->'rows') p where p->>'row'=q->>'row'));
   end if;
   for row_data in select value from jsonb_array_elements(preview->'rows') loop
    decision:=decision_map->(row_data->>'row');
    if decision is null or coalesce(decision->>'action','') not in ('link','new','review','exclude') then raise exception 'Decisão inválida.';end if;
    if decision->>'action' in ('review','exclude') then perform pi_gestao_private.ga_text(decision->>'reason','Motivo da decisão');
    else
     if decision->>'action'<>row_data->>'action' or jsonb_array_length(row_data->'issues')>0 then raise exception 'Conflitos precisam permanecer em revisão.';end if;
     if decision->>'action'='link' then target:=pi_gestao_private.ga_record(p_tenant,own,(row_data->>'existingId')::uuid,case when module_name='rtis' then 'rti' else 'asset' end);
     else
      h:=pi_gestao_private.ga_hierarchy(p_tenant,own,row_data->'values'->>'unit',row_data->'values'->>'system',actor);
      if exists(select 1 from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='asset' and r.body->>'unitId'=h->'unit'->>'id' and r.body->>'tag'=row_data->'values'->>'tag') then raise exception using errcode='40001',message='Identidade cadastrada após a prévia. Gere nova prévia.';end if;
      technical:='{}';
      for key_name,ident in select key,value from jsonb_each_text(row_data->'values') where key in ('fluid','material','volume','designPressure','temperature','diameter') and value is not null loop technical:=technical||jsonb_build_object(key_name,jsonb_build_object('value',ident,'unit',preview->'input'->'units'->>key_name,'source',jsonb_build_object('sourceId',preview->>'sourceId','sheet',preview->'input'->>'sheet','row',row_data->'row')));end loop;
      target:=pi_gestao_private.ga_put(p_tenant,own,'asset',jsonb_build_object('tag',row_data->'values'->>'tag','type',row_data->'values'->>'type','unitId',h->'unit'->>'id','systemId',h->'system'->>'id','technical',technical,'technicalCondition','nao_avaliado','values',row_data->'values','units',preview->'input'->'units','fluid',row_data->'values'->>'fluid','operation','nao_informado','source',jsonb_build_object('sourceId',preview->>'sourceId','locator',jsonb_build_object('sheet',preview->'input'->>'sheet','row',row_data->'row'))),actor);
     end if;
     if module_name='rtis' then rti_ids:=rti_ids||jsonb_build_array(target->>'id');if target->>'assetId' is not null then ids:=ids||jsonb_build_array(target->>'assetId');end if;
     else ids:=ids||jsonb_build_array(target->>'id');end if;
     decision:=decision||jsonb_build_object('recordId',target->>'id');
    end if;
    decisions:=decisions||jsonb_build_array(row_data||jsonb_build_object('decision',decision,'sourceId',preview->>'sourceId','sheet',preview->'input'->>'sheet'));
   end loop;
   select coalesce(jsonb_agg(x order by x),'[]') into ids from (select distinct jsonb_array_elements_text(ids) x) z;
   select coalesce(jsonb_agg(x order by x),'[]') into rti_ids from (select distinct jsonb_array_elements_text(rti_ids) x) z;
   result:=pi_gestao_private.ga_put(p_tenant,own,'document',jsonb_build_object('recordClass','projectScope','contractId',c->>'id','module',module_name,'scopeVersion',sv+1,'previousVersion',sv,'assetIds',ids,'rtiIds',rti_ids,'decisions',decisions,'mode',p_payload->>'scopeMode','sourceId',preview->>'sourceId','sourceName',preview->>'sourceName','mapping',preview->'input'->'mapping','units',preview->'input'->'units','basis',preview->'input'->>'basis','createdAt',now(),'createdBy',actor),actor);
   perform pi_gestao_private.ga_change(p_tenant,own,(c->>'id')::uuid,'contract',(c->>'version')::bigint,jsonb_build_object('assetIds',ids,'moduleAssetIds',jsonb_build_object(module_name,ids),'rtiIds',rti_ids,'scopeVersion',sv+1),actor,'project.scope');
  elsif p_action='projects.update' then
   b:=jsonb_build_object('responsible',nullif(p_payload->>'responsible',''),'contractReference',nullif(p_payload->>'contractReference',''),'unit',nullif(p_payload->>'unit',''),'periodStart',pi_gestao_private.ga_date(p_payload->>'periodStart','Início'),'periodEnd',pi_gestao_private.ga_date(p_payload->>'periodEnd','Fim'));
   if b->>'periodStart'>b->>'periodEnd' then raise exception 'Período invertido.';end if;
   result:=pi_gestao_private.ga_change(p_tenant,own,(c->>'id')::uuid,'contract',(p_payload->>'expectedVersion')::bigint,b,actor,'project.identification');
  elsif p_action='projects.plan' then
   if (p_payload->>'expectedVersion')::bigint is distinct from (c->>'version')::bigint or jsonb_typeof(p_payload->'tasks') is distinct from 'array' or jsonb_array_length(p_payload->'tasks')>10000 then raise exception using errcode='40001',message='Projeto alterado ou tarefas inválidas.';end if;
   if sv=0 then raise exception 'Confirme uma versão do escopo antes do planejamento.';end if;
   if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'tasks'))<>jsonb_array_length(p_payload->'tasks') then raise exception 'IDs de tarefas repetidos.';end if;
   if exists(select 1 from jsonb_array_elements(p_payload->'tasks') q group by q->>'targetKind',q->>'targetId',q->>'stage',q->>'modality' having count(*)>1) then raise exception 'Entrega repetida para o mesmo registro, etapa e modalidade.';end if;
   for task in select value from jsonb_array_elements(p_payload->'tasks') loop
    perform (task->>'id')::uuid;perform pi_gestao_private.ga_text(task->>'name','Entrega / tarefa',200);
    if coalesce(task->>'targetKind','') not in ('asset','rti','inspection','document') or coalesce(task->>'stage','') not in ('execution','review','issuance','acceptance','received','test') or coalesce(task->>'modality','') not in ('visual','espessura','interna','externa','atendimento','certificacao') then raise exception 'Tipo, etapa ou modalidade inválida.';end if;
    if module_name<>'valvulas' and task->>'stage' in ('received','test') or module_name='integridade' and task->>'modality' not in ('visual','espessura') or module_name='nr13' and task->>'modality' not in ('interna','externa','espessura') or module_name='rtis' and task->>'modality'<>'atendimento' or module_name='valvulas' and task->>'modality'<>'certificacao' then raise exception 'Etapa ou modalidade incompatível com o módulo.';end if;
    target:=pi_gestao_private.ga_record(p_tenant,own,(task->>'targetId')::uuid,task->>'targetKind');
    if task->>'targetKind'='asset' then ident:=target->>'id';else ident:=target->>'assetId';end if;
    if task->>'targetKind'='rti' then
     if not coalesce(c->'rtiIds','[]') ? (target->>'id') then raise exception 'RTI fora do escopo explícito.';end if;
    elsif task->>'targetKind' in ('inspection','document') then
     if target->>'contractId' is distinct from c->>'id' or not coalesce(c->'assetIds','[]') ? ident then raise exception 'Registro de outro contrato ou fora do escopo.';end if;
    elsif not coalesce(c->'assetIds','[]') ? ident then raise exception 'Ativo fora do escopo.';end if;
    perform pi_gestao_private.ga_date(task->>'plannedDate','Data planejada');
    if coalesce(task->>'weight','1')<>'1' then raise exception 'Esta versão usa pesos iguais por serviço da mesma modalidade.';end if;
    if exists(select 1 from pi_gestao_private.records e where e.tenant_id=p_tenant and e.owner_id=own and e.kind='document' and e.body->>'recordClass'='projectPlan' and e.body->>'contractId'=c->>'id' and exists(select 1 from jsonb_array_elements(e.body->'tasks') q where q->>'id'=task->>'id' and (q->>'targetId'<>task->>'targetId' or q->>'targetKind'<>task->>'targetKind' or q->>'stage'<>task->>'stage' or q->>'modality'<>task->>'modality'))) then raise exception 'ID de tarefa não pode mudar de alvo, etapa ou modalidade.';end if;
   end loop;
   result:=pi_gestao_private.ga_put(p_tenant,own,'document',jsonb_build_object('recordClass','projectPlan','contractId',c->>'id','module',module_name,'planVersion',pv+1,'scopeVersion',sv,'tasks',p_payload->'tasks','basis',pi_gestao_private.ga_text(p_payload->>'basis','Base e aprovação do planejamento'),'createdAt',now(),'createdBy',actor),actor);
   perform pi_gestao_private.ga_change(p_tenant,own,(c->>'id')::uuid,'contract',(c->>'version')::bigint,jsonb_build_object('planVersion',pv+1),actor,'project.plan');
  elsif p_action='projects.event' then
   select body into plan from pi_gestao_private.records where tenant_id=p_tenant and owner_id=own and kind='document' and body->>'recordClass'='projectPlan' and body->>'contractId'=c->>'id' and (body->>'planVersion')::integer=pv;
   if plan is null or (plan->>'scopeVersion')::integer<>sv then raise exception 'Revise o planejamento para o escopo vigente.';end if;
   select value into task from jsonb_array_elements(plan->'tasks') where value->>'id'=p_payload->>'taskId';
   if task is null or coalesce(p_payload->>'status','') not in ('in_progress','submitted','done','returned') then raise exception 'Tarefa ou status inválido.';end if;
   date_value:=pi_gestao_private.ga_date(p_payload->>'on','Data do evento',true);if date_value::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Evento não pode estar no futuro.';end if;
   doc:=pi_gestao_private.ga_record(p_tenant,own,(p_payload->>'evidenceDocumentId')::uuid,'document');
   target:=pi_gestao_private.ga_record(p_tenant,own,(task->>'targetId')::uuid,task->>'targetKind');
   ident:=case when task->>'targetKind'='asset' then task->>'targetId' else target->>'assetId' end;
   if doc->'source'->>'sourceId' is null or doc->>'contractId' is distinct from c->>'id' or doc->>'assetId' is not null and doc->>'assetId' is distinct from ident then raise exception 'Evidência original deve pertencer ao contrato e ao alvo.';end if;
   result:=pi_gestao_private.ga_put(p_tenant,own,'document',jsonb_build_object('recordClass','projectEvent','contractId',c->>'id','module',module_name,'scopeVersion',sv,'planVersion',pv,'taskId',task->>'id','stage',task->>'stage','status',p_payload->>'status','on',date_value,'responsible',pi_gestao_private.ga_text(p_payload->>'responsible','Responsável',200),'evidence',pi_gestao_private.ga_text(p_payload->>'evidence','Evidência do evento'),'evidenceDocumentId',doc->>'id','source',doc->'source','createdAt',now(),'createdBy',actor),actor);
  elsif p_action='projects.snapshot' then
   date_value:=pi_gestao_private.ga_date(p_payload->>'cutoff','Data de corte',true);if date_value::date>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Data de corte futura.';end if;
   b:=pi_gestao_private.ga_api_projects(p_tenant,'state.get',jsonb_build_object('ownerId',own));
   result:=pi_gestao_private.ga_put(p_tenant,own,'document',jsonb_build_object('recordClass','projectSnapshot','contractId',c->>'id','module',module_name,'scopeVersion',sv,'planVersion',pv,'filters',jsonb_build_object('cutoff',date_value,'modality',p_payload->>'modality'),'state',b,'stateHash',pi_gestao_private.ga_hash(b),'createdAt',now(),'createdBy',actor),actor);
  end if;
 end if;
 insert into pi_gestao_private.operation_receipts(tenant_id,owner_id,action,request_id,digest,result,actor_user_id) values(p_tenant,own,p_action,rid,digest,result,actor);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION public.pi_gestao_api(p_tenant uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
 SELECT pi_gestao_private.ga_api_projects(p_tenant, p_action, p_payload) AS ga_api_projects;
END;

CREATE OR REPLACE FUNCTION pi_access_private.trial_extend_legacy(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.approve_v2_legacy(p_user_id uuid, p_company_id uuid, p_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pi_access_private.require_master();
 if p_days is not null then perform pi_access_private.trial_plan(p_user_id,p_company_id,p_days); end if;
 return pi_access_private.approve(p_user_id,p_company_id);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.prepare_invite_v2_legacy(p_email text, p_company_id uuid, p_role text, p_trial_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
 perform pi_access_private.require_master();
 if p_trial_days is null or p_trial_days not between 1 and 90 then raise exception 'invalid_trial_days' using errcode='22023'; end if;
 v_result:=pi_access_private.prepare_invite(p_email,p_company_id,p_role);
 update pi_access_private.invitations set trial_days=p_trial_days where id=(v_result->>'invitation_id')::uuid;
 return v_result||jsonb_build_object('trial_days',p_trial_days);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.dashboard_legacy(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.dashboard_v3(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.trial_plan(p_user_id uuid, p_company_id uuid, p_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_license_api' using errcode='42501'; end if;return pi_access_private.trial_plan_legacy(p_user_id,p_company_id,p_days);end $function$;

CREATE OR REPLACE FUNCTION public.pi_billing_ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.ingest(p_event_id,p_event,p_kind,p_resource_id,p_subscription,p_fingerprint,p_projection)$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_admin_queue(p_subscription text, p_request uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.admin_queue(p_subscription,p_request)$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_claim()
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.claim()$function$;

CREATE OR REPLACE FUNCTION public.pi_billing_finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.finish(p_job,p_lease,p_state,p_reason,p_snapshot,p_retry)$function$;

CREATE OR REPLACE FUNCTION pi_access_private.access_status_v3(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;begin perform pi_access_private.tenant_write_guard();perform pi_access_private.require_master();
 if p_reason is null or char_length(btrim(p_reason)) not between 10 and 500 then raise exception 'reason_required';end if;
 r:=pi_access_private.company_save_legacy(p_name,p_company_id,p_expected_name);
 insert into pi_access_private.tenant_changes(actor_id,company_id,event,before_value,after_value,reason) values(auth.uid(),(r->>'id')::uuid,'company_named',jsonb_build_object('name',p_expected_name),r,btrim(p_reason));return r;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.migration_map()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;begin perform pi_access_private.require_master();
 select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) into result from(
 select c.id company_id,c.name,l.migration_state,l.seat_limit,l.seats_used,
 count(distinct jsonb_build_array(a.access_kind,a.activated_at,a.expires_at,a.access_state)) filter(where a.user_id is not null) as distinct_legacy_terms,
 coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'membership_state',m.access_state,'role',m.role_name,'legacy_state',a.access_state,'legacy_kind',a.access_kind,'legacy_start',a.activated_at,'legacy_end',a.expires_at,'other_companies',(select count(*) from public.pi_company_memberships mm where mm.user_id=m.user_id))) filter(where m.user_id is not null),'[]'::jsonb) legacy_memberships
 from public.pi_companies c join pi_access_private.company_licenses l on l.company_id=c.id left join public.pi_company_memberships m on m.company_id=c.id left join pi_access_private.accounts a on a.user_id=m.user_id group by c.id,c.name,l.migration_state,l.seat_limit,l.seats_used)t;return result;end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.my_company_access()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'access',pi_access_private.access_status_v3(c.id)) order by c.name),'[]'::jsonb)
 from public.pi_company_memberships m join public.pi_companies c on c.id=m.company_id where m.user_id=auth.uid() and pi_access_private.identity_verified(auth.uid());$function$;

CREATE OR REPLACE FUNCTION pi_access_private.access_status(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select case when pi_access_private.tenants_enabled() then pi_access_private.access_status_v3(p_company_id) else pi_access_private.access_status_legacy(p_company_id) end;$function$;

CREATE OR REPLACE FUNCTION pi_access_private.access_status_v2(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select case when pi_access_private.tenants_enabled() then pi_access_private.access_status_v3(p_company_id) else pi_access_private.access_status_v2_legacy(p_company_id) end;$function$;

CREATE OR REPLACE FUNCTION pi_access_private.accept_invite(p_invitation_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then perform pi_access_private.tenant_write_guard();end if;return pi_access_private.accept_invite_legacy(p_invitation_id);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.approve(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then return pi_access_private.membership_change(p_user_id,p_company_id,'activate','Aprovação explícita do vínculo.'); end if;return pi_access_private.approve_legacy(p_user_id,p_company_id);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.revoke_access(p_user_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then return pi_access_private.membership_change(p_user_id,p_company_id,'deactivate','Desativação explícita do vínculo.'); end if;return pi_access_private.revoke_access_legacy(p_user_id,p_company_id);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_license_api' using errcode='42501'; end if;return pi_access_private.trial_extend_legacy(p_user_id,p_company_id,p_expected_expiry,p_new_expiry,p_reason);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.approve_v2(p_user_id uuid, p_company_id uuid, p_days integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_membership_api' using errcode='42501'; end if;return pi_access_private.approve_v2_legacy(p_user_id,p_company_id,p_days);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin if pi_access_private.tenants_enabled() then raise exception 'use_company_invite_api' using errcode='42501'; end if;return pi_access_private.prepare_invite_v2_legacy(p_email,p_company_id,p_role,p_trial_days);end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.admin_overview_legacy()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform pi_access_private.require_master();
  return jsonb_build_object(
    'users',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,
      'company_id',m.company_id,'company_name',c.name,'company_role',m.role_name,
      'status',case when a.access_state='revoked' or m.access_state='revoked' then 'revoked'
        when a.access_state='approved' and a.access_kind='trial' and a.expires_at<=statement_timestamp() then 'expired'
        when m.access_state='active' and pi_access_private.account_active(m.user_id) then 'active' else 'pending' end,
      'activated_at',a.activated_at,'expires_at',a.expires_at,'approved_at',m.approved_at,'revoked_at',m.revoked_at,
      'last_activity_at',(select max(log.occurred_at) from pi_access_private.activity log where log.actor_id=m.user_id),
      'is_master',exists(select 1 from pi_access_private.masters g where g.user_id=m.user_id and g.revoked_at is null)) order by c.name,u.email)
      from public.pi_company_memberships m join public.pi_companies c on c.id=m.company_id
      join auth.users u on u.id=m.user_id left join pi_access_private.accounts a on a.user_id=m.user_id),'[]'::jsonb),
    'companies',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from public.pi_companies),'[]'::jsonb),
    'invitations',coalesce((select jsonb_agg(jsonb_build_object('invitation_id',i.id,'email',i.email,
      'company_id',i.company_id,'company_name',c.name,'role',i.role_name,'delivery',i.delivery,'status',case
        when i.invitation_state in ('prepared','offered','sent') and i.expires_at<=statement_timestamp() then 'expired' else i.invitation_state end,
      'created_at',i.created_at,'expires_at',i.expires_at,'sent_at',i.sent_at,'accepted_at',i.accepted_at) order by i.created_at desc)
      from pi_access_private.invitations i join public.pi_companies c on c.id=i.company_id),'[]'::jsonb),
    'activity',coalesce((select jsonb_agg(to_jsonb(t) order by t.occurred_at desc) from
      (select id,occurred_at,actor_id,target_user_id,company_id,event,source,context,object_id
        from pi_access_private.activity order by occurred_at desc,id limit 200) t),'[]'::jsonb));
end;
$function$;

CREATE OR REPLACE FUNCTION pi_access_private.admin_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform pi_access_private.require_master();
 if pi_access_private.tenants_enabled() then return pi_access_private.dashboard_v3(null);end if;
 return pi_access_private.admin_overview_legacy();end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.capture_access_request(p_user uuid, p_full_name text, p_kind text, p_company_name text, p_seats integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r pi_access_private.access_requests%rowtype; v_name text:=btrim(p_full_name); v_company text:=btrim(p_company_name);
begin
 perform pi_access_private.tenant_write_guard();
 -- Identity is supplied only by the Auth INSERT trigger or auth.uid() wrapper.
 if p_user is null then raise exception 'identity_required' using errcode='42501';end if;
 perform 1 from auth.users where id=p_user for update;
 if not found then raise exception 'identity_required' using errcode='42501';end if;
 select * into r from pi_access_private.access_requests where user_id=p_user;
 if found then return to_jsonb(r);end if;
 if exists(select 1 from public.pi_company_memberships where user_id=p_user)
 or exists(select 1 from pi_access_private.masters where user_id=p_user)
 or exists(select 1 from pi_access_private.accounts where user_id=p_user and access_state='revoked') then
  raise exception 'existing_access_requires_review' using errcode='22023';
 end if;
 if v_name is null or char_length(v_name) not between 2 and 120 or p_kind is null or p_kind not in ('individual','company')
 or p_seats is null or p_seats not between 1 and 999 or (p_kind='individual' and p_seats<>1) then
  raise exception 'invalid_access_request' using errcode='22023';
 end if;
 if p_kind='individual' then v_company:=v_name;end if;
 if v_company is null or char_length(v_company) not between 2 and 160
 or v_name ~ '[[:cntrl:]]' or v_company ~ '[[:cntrl:]]' then
  raise exception 'invalid_access_request' using errcode='22023';
 end if;
 insert into pi_access_private.access_requests(user_id,full_name,applicant_kind,company_name,requested_seats)
 values(p_user,v_name,p_kind,v_company,p_seats) returning * into r;
 return to_jsonb(r);
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.capture_signup_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb:=new.raw_user_meta_data->'pi_access_request';
begin
 if v is null then return new;end if;
 if jsonb_typeof(v)<>'object' or v->>'version' is distinct from '1' or
    coalesce(v->>'seats','') !~ '^[1-9][0-9]{0,2}$' then
  raise exception 'invalid_access_request' using errcode='22023';
 end if;
 -- Metadata is untrusted intake data only. Roles, dates and approval are never read.
 perform pi_access_private.capture_access_request(new.id,v->>'name',v->>'kind',v->>'company',(v->>'seats')::integer);
 return new;
end $function$;

CREATE OR REPLACE FUNCTION pi_access_private.membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not pi_access_private.member_identity_allowed(p_user_id,p_company_id) or (not exists(select 1 from pi_access_private.invitations where id=m.invitation_id and company_id=p_company_id and auth_user_id=p_user_id and invitation_state='accepted') and not exists(select 1 from pi_access_private.access_requests where user_id=p_user_id and company_id=p_company_id and request_state='approved')) then raise exception 'accepted_invitation_required' using errcode='22023';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.caller(p_company uuid DEFAULT NULL::uuid, p_master boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not pi_access_private.identity_verified(auth.uid())
 or not exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id')
 or exists(select 1 from pi_access_private.accounts a where a.user_id=auth.uid() and a.access_state='revoked')
 then raise exception 'billing_access_denied' using errcode='42501';end if;
 if p_master then perform pi_access_private.require_master();return;end if;
 if p_company is null or not exists(select 1 from public.pi_companies where id=p_company) then raise exception 'billing_access_denied' using errcode='42501';end if;
 if not pi_access_private.is_master() and not exists(
  select 1 from public.pi_company_memberships m where m.company_id=p_company and m.user_id=auth.uid() and m.access_state='active'
  and (m.role_name='admin' or (m.role_name='assistant' and exists(
   select 1 from pi_access_private.access_requests r where r.user_id=auth.uid() and r.company_id=p_company
    and r.applicant_kind='individual' and r.request_state='approved'))))
 then raise exception 'billing_access_denied' using errcode='42501';end if;
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.context(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 perform pi_billing_private.caller(p_company,false);
 select jsonb_build_object('company_id',l.company_id,'license_state',l.license_state,'plan_kind',l.plan_kind,
 'seat_limit',l.seat_limit,'seats_used',l.seats_used,'activated_at',l.activated_at,'expires_at',l.expires_at,
 'internal_protected',l.plan_kind='indefinite' or exists(select 1 from pi_access_private.company_seat_exemptions where company_id=p_company))
 into result from pi_access_private.company_licenses l where l.company_id=p_company;
 return jsonb_build_object('mode','observe','financialEffects',false,'license',result,
  'catalog',(select terms||jsonb_build_object('state',state,'revision',revision) from pi_billing_private.catalog),
  'bindings',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'payer_kind',payer_kind,'quantity',quantity,'created_at',created_at)),'[]') from pi_billing_private.bindings where company_id=p_company),
  'observations',(select count(*) from pi_billing_private.observations o join pi_billing_private.bindings b on b.id=o.binding_id where b.company_id=p_company));
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b pi_billing_private.bindings%rowtype; frozen jsonb;
begin
 perform pi_billing_private.caller(null,true);perform pi_access_private.tenant_write_guard();
 if p_company is null or p_quantity is null or p_kind is null or p_kind not in('CPF','CNPJ') or p_quantity not between 1 and 999
 or p_subscription is null or p_subscription!~'^sub_[A-Za-z0-9_-]{1,180}$'
 or p_customer is null or p_customer!~'^cus_[A-Za-z0-9_-]{1,180}$'
 then raise exception 'invalid_binding';end if;
 perform 1 from pi_access_private.company_licenses where company_id=p_company and migration_state='ready' for update;
 if not found then raise exception 'license_not_ready';end if;
 if exists(select 1 from pi_access_private.company_licenses where company_id=p_company and plan_kind='indefinite')
 or exists(select 1 from pi_access_private.company_seat_exemptions where company_id=p_company) then raise exception 'internal_license_protected';end if;
 if p_kind='CPF' and (p_owner is null or p_quantity<>1 or not exists(
  select 1 from public.pi_company_memberships where company_id=p_company and user_id=p_owner and access_state='active')
  or not exists(select 1 from pi_access_private.access_requests where company_id=p_company and user_id=p_owner
    and applicant_kind='individual' and request_state='approved')) then raise exception 'personal_owner_required';end if;
 if p_kind='CNPJ' and p_owner is not null then raise exception 'corporate_owner_must_be_null';end if;
 select * into b from pi_billing_private.bindings where provider_subscription=p_subscription;
 if found then
  if b.company_id is distinct from p_company or b.provider_customer is distinct from p_customer
   or b.payer_kind is distinct from p_kind or b.owner_id is distinct from p_owner or b.quantity is distinct from p_quantity
   then raise exception 'binding_immutable_conflict';end if;
  return jsonb_build_object('id',b.id,'unchanged',true,'financialEffects',false);
 end if;
 select terms into frozen from pi_billing_private.catalog where id='calculadora-mensal';
 insert into pi_billing_private.bindings(company_id,provider_subscription,provider_customer,payer_kind,owner_id,quantity,terms,created_by)
 values(p_company,p_subscription,p_customer,p_kind,p_owner,p_quantity,frozen||jsonb_build_object('quantity',p_quantity,'payerKind',p_kind),auth.uid()) returning * into b;
 insert into pi_billing_private.audit(actor_id,company_id,event,reference,details) values(auth.uid(),p_company,'existing_subscription_bound',b.id::text,jsonb_build_object('financialEffects',false));
 return jsonb_build_object('id',b.id,'unchanged',false,'financialEffects',false);
end $function$;

CREATE OR REPLACE FUNCTION public.pi_billing_admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select pi_billing_private.admin_bind(p_company,p_subscription,p_customer,p_kind,p_owner,p_quantity)$function$;

CREATE OR REPLACE FUNCTION pi_billing_private.ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare previous pi_billing_private.inbox%rowtype;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'service_required' using errcode='42501';end if;
 if p_event_id is null or p_event_id!~'^evt_[A-Za-z0-9_&-]{1,180}$' or p_event is null or p_event!~'^(PAYMENT|SUBSCRIPTION)_[A-Z_]{1,80}$'
 or p_fingerprint is null or p_fingerprint!~'^[a-f0-9]{64}$' or p_kind is null or p_kind not in('payment','subscription')
 or p_resource_id is null or p_resource_id!~(case when p_kind='payment' then '^pay_[A-Za-z0-9_-]{1,180}$' else '^sub_[A-Za-z0-9_-]{1,180}$' end)
 or (p_subscription is not null and p_subscription!~'^sub_[A-Za-z0-9_-]{1,180}$')
 or p_projection is null or jsonb_typeof(p_projection)<>'object' or octet_length(p_projection::text)>4096
 or (p_projection-array['event','type','id','subscription','status','dueDate','paymentDate','clientPaymentDate','confirmedDate','creditDate','deleted','value'])<>'{}'::jsonb
 then raise exception 'invalid_event';end if;
 insert into pi_billing_private.inbox(event_id,event,kind,resource_id,subscription_hint,fingerprint,projection)
 values(p_event_id,p_event,p_kind,p_resource_id,p_subscription,p_fingerprint,p_projection) on conflict(event_id) do nothing;
 select * into previous from pi_billing_private.inbox where event_id=p_event_id for update;
 if previous.fingerprint<>p_fingerprint then
  insert into pi_billing_private.event_conflicts(event_id,fingerprint)values(p_event_id,p_fingerprint) on conflict do nothing;
  update pi_billing_private.inbox set conflict=true where event_id=p_event_id;
  update pi_billing_private.jobs set state='review',reason='event_conflict',lease=null,lease_until=null where event_id=p_event_id;
  return jsonb_build_object('state','quarantined');
 end if;
 if previous.conflict then return jsonb_build_object('state','quarantined');end if;
 insert into pi_billing_private.jobs(dedupe_key,event_id,kind,resource_id,subscription_hint)
 values('event:'||p_event_id,p_event_id,p_kind,p_resource_id,p_subscription) on conflict(dedupe_key) do nothing;
 return jsonb_build_object('state','persisted');
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.admin_queue(p_subscription text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b pi_billing_private.bindings%rowtype; j pi_billing_private.jobs%rowtype;
begin
 perform pi_billing_private.caller(null,true);
 if p_request is null then raise exception 'request_id_required';end if;
 select * into b from pi_billing_private.bindings where provider_subscription=p_subscription;
 if not found then raise exception 'binding_required';end if;
 insert into pi_billing_private.jobs(dedupe_key,kind,resource_id,subscription_hint,scan_id)
 values('scan:'||p_request::text||':0','scan',p_subscription,p_subscription,p_request) on conflict(dedupe_key) do nothing;
 select * into j from pi_billing_private.jobs where dedupe_key='scan:'||p_request::text||':0';
 if j.resource_id<>p_subscription then raise exception 'idempotency_conflict';end if;
 insert into pi_billing_private.audit(actor_id,company_id,event,reference)values(auth.uid(),b.company_id,'reconciliation_requested',j.id::text);
 return jsonb_build_object('jobId',j.id,'state',j.state,'financialEffects',false);
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j pi_billing_private.jobs%rowtype; b pi_billing_private.bindings%rowtype; outcome text;
begin
 perform pi_billing_private.caller(null,true);
 select * into j from pi_billing_private.jobs where id=p_job for update;
 if not found or j.state<>'processing' or j.lease is distinct from p_lease or j.lease_until<=clock_timestamp() then raise exception 'stale_lease';end if;
 if p_state is null or p_state not in('done','retry','review') or p_reason is null or p_reason not in(
 'observed_policy_pending','amount_review','provider_unavailable','provider_rate_limited','provider_credentials_rejected',
 'provider_resource_not_found','provider_request_rejected','invalid_provider_snapshot','invalid_provider_cycle','invalid_provider_amount',
 'invalid_provider_page','invalid_json','body_too_large','payment_not_subscription','subscription_mismatch','customer_mismatch',
 'pagination_review_required','backend_unavailable','internal_error') then raise exception 'invalid_finish';end if;
 outcome:=case when p_state='retry' and j.attempts>=5 then 'review' else p_state end;
 if outcome='done' then
  select * into b from pi_billing_private.bindings where provider_subscription=j.subscription_hint;
  if b.id is null or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
  or p_snapshot->>'id' is distinct from j.resource_id or p_snapshot->>'customer' is distinct from b.provider_customer
  or (j.kind='payment' and p_snapshot->>'subscription' is distinct from b.provider_subscription)
  or (j.kind<>'payment' and p_snapshot->>'id' is distinct from b.provider_subscription)
  or p_snapshot->'financialEffects' is distinct from 'false'::jsonb
  or (p_snapshot-array['id','customer','subscription','status','valueMinor','dueDate','paymentDate','clientPaymentDate','confirmedDate','creditDate','estimatedCreditDate','deleted','cycle','nextDueDate','financialEffects'])<>'{}'::jsonb
  then raise exception 'snapshot_binding_mismatch';end if;
  insert into pi_billing_private.observations(job_id,binding_id,snapshot)values(j.id,b.id,p_snapshot);
 end if;
 update pi_billing_private.jobs set state=outcome,reason=p_reason,lease=null,lease_until=null,
 next_attempt=clock_timestamp()+make_interval(secs=>greatest(30,least(coalesce(p_retry,60),86400))) where id=j.id;
 insert into pi_billing_private.audit(actor_id,company_id,event,reference,details)
 values(auth.uid(),b.company_id,'job_finished',j.id::text,jsonb_build_object('state',outcome,'reason',p_reason,'financialEffects',false));
 return jsonb_build_object('jobId',j.id,'state',outcome,'financialEffects',false);
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j pi_billing_private.jobs%rowtype; item jsonb; count_items integer;
begin
 perform pi_billing_private.caller(null,true);
 select * into j from pi_billing_private.jobs where id=p_job for update;
 if not found or j.kind<>'scan' or j.state<>'processing' or j.lease is distinct from p_lease or j.lease_until<=clock_timestamp() then raise exception 'stale_lease';end if;
 if p_payments is null or jsonb_typeof(p_payments)<>'array' or jsonb_array_length(p_payments)>100 then raise exception 'invalid_page';end if;
 count_items:=jsonb_array_length(p_payments);
 if p_next is not null and (count_items=0 or p_next<>j.page_offset+count_items or p_next>100000) then raise exception 'invalid_cursor';end if;
 for item in select value from jsonb_array_elements(p_payments) loop
  if jsonb_typeof(item)<>'string' or (item#>>'{}')!~'^pay_[A-Za-z0-9_-]{1,180}$' then raise exception 'invalid_payment_id';end if;
  insert into pi_billing_private.jobs(dedupe_key,kind,resource_id,subscription_hint)
   values('reconcile:'||j.scan_id::text||':'||(item#>>'{}'),'payment',item#>>'{}',j.subscription_hint)
   on conflict(dedupe_key) do nothing;
 end loop;
 if p_next is not null then
  insert into pi_billing_private.jobs(dedupe_key,kind,resource_id,subscription_hint,scan_id,page_offset)
  values('scan:'||j.scan_id::text||':'||p_next,'scan',j.resource_id,j.subscription_hint,j.scan_id,p_next) on conflict(dedupe_key) do nothing;
 end if;
 return jsonb_build_object('queued',count_items,'nextOffset',p_next,'financialEffects',false);
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.admin_retry(p_job bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j pi_billing_private.jobs%rowtype;
begin
 perform pi_billing_private.caller(null,true);
 select * into j from pi_billing_private.jobs where id=p_job for update;
 if not found or j.state not in('review','retry') or exists(select 1 from pi_billing_private.inbox where event_id=j.event_id and conflict)
 then raise exception 'job_not_retryable';end if;
 update pi_billing_private.jobs set state='pending',attempts=0,reason=null,next_attempt=clock_timestamp(),lease=null,lease_until=null where id=j.id;
 insert into pi_billing_private.audit(actor_id,event,reference)values(auth.uid(),'manual_retry',j.id::text);
 return jsonb_build_object('jobId',j.id,'state','pending','financialEffects',false);
end $function$;

CREATE OR REPLACE FUNCTION pi_billing_private.admin_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pi_billing_private.caller(null,true);
 return jsonb_build_object('mode','observe','financialEffects',false,
 'states',(select coalesce(jsonb_object_agg(state,total),'{}') from (select state,count(*) as total from pi_billing_private.jobs group by state)s),
 'review',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select id,reason,attempts,created_at from pi_billing_private.jobs where state='review' order by id desc limit 50)s));
end $function$;

CREATE OR REPLACE FUNCTION public.pi_billing_context(p_company uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select pi_billing_private.context(p_company)$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_preview(p_tenant uuid, p_owner uuid, p_input jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare src pi_gestao_private.sources;owner jsonb;wb jsonb;sheet jsonb;meta jsonb;rr jsonb;vv jsonb;
 rows jsonb:='[]';warnings jsonb:='[]';blockers jsonb:='[]';row_blockers jsonb;mapping jsonb;units jsonb;
 tag text;sheet_name text;format_name text;v_kind text;ident text;digest_value text;action_name text;prior pi_gestao_private.imports;
 first_row integer;last_row integer;n integer;k text;col text;cell text[];company_value text;pid uuid:=gen_random_uuid();result jsonb;range_info jsonb;
begin
 if p_owner is null then
   owner:=jsonb_build_object('name',pi_gestao_private.ga_text(p_input->>'companyName','Empresa na fonte',200));
   if exists(select 1 from pi_gestao_private.owners where tenant_id=p_tenant and name_key=btrim(regexp_replace(lower(owner->>'name'),'[[:space:][:punct:]]+',' ','g'))) then raise exception 'Empresa cliente já existe; selecione seu ID explicitamente.';end if;
 else owner:=pi_gestao_private.ga_owner(p_tenant,p_owner);end if;
 select * into src from pi_gestao_private.sources where tenant_id=p_tenant and id=p_input->>'sourceId';
 if not found then raise exception 'Fonte não encontrada neste tenant.'; end if;
 if src.created_by<>p_actor and not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and body->'source'->>'sourceId'=src.id) then raise exception using errcode='42501',message='Fonte em revisão privada de outro operador.';end if;
 if coalesce(src.workbook->>'format','xlsx') not in ('xlsx','pdf_control') then raise exception 'Original documental sem extração não é lista importável.';end if;
 wb:=src.workbook;meta:=coalesce(wb->'metadata','null'::jsonb);format_name:=coalesce(wb->>'format','xlsx');
 perform pi_gestao_private.ga_text(p_input->>'sourceIdentity','Identidade estável do arquivo',500);
 perform pi_gestao_private.ga_text(p_input->>'unit','Unidade',200);
 perform pi_gestao_private.ga_text(p_input->>'system','Sistema',200);
 perform pi_gestao_private.ga_text(p_input->>'systemEvidence','Fonte da unidade e sistema');
 if p_input->>'companyName' is distinct from owner->>'name' then raise exception 'Empresa cliente explícita diverge do nome histórico informado.'; end if;
 if coalesce(p_input->>'sourceCompanyName',owner->>'name') is distinct from owner->>'name' then perform pi_gestao_private.ga_text(p_input->>'ownerMappingEvidence','Confirmação explícita de correspondência entre nome original e cliente');end if;
 v_kind:=coalesce(p_input->>'type','linha');
 if v_kind not in ('linha','segmento') then raise exception 'Importação exige linha ou segmento.'; end if;
 if format_name='pdf_control' then
   if meta->>'companyName' is distinct from coalesce(p_input->>'sourceCompanyName',owner->>'name') or meta->>'system' is distinct from p_input->>'system' then raise exception 'Preserve empresa e sistema do cabeçalho PDF.'; end if;
   sheet:=wb->'sheets'->0;sheet_name:='Página 1';first_row:=1;last_row:=2147483647;mapping:=coalesce(meta->'columns','[]');units:='{}';v_kind:='linha';
 else
   sheet_name:=p_input->>'sheet';
   select value into sheet from jsonb_array_elements(wb->'sheets') where value->>'name'=sheet_name;
   if sheet is null then raise exception 'Aba exata não encontrada.'; end if;
   cell:=regexp_match(coalesce(p_input->>'companyCell',''),'^([A-Z]{1,3})([0-9]+)$');
   if cell is null then raise exception 'Informe célula que comprova empresa.'; end if;
   select value->'values'->>pi_gestao_private.ga_column(cell[1]) into company_value from jsonb_array_elements(sheet->'rows') where (value->>'row')::integer=cell[2]::integer;
   if btrim(company_value) is distinct from coalesce(p_input->>'sourceCompanyName',owner->>'name') then raise exception 'Empresa diverge da célula original.'; end if;
   first_row:=(p_input->>'start')::integer;last_row:=(p_input->>'end')::integer;
   if first_row is null or last_row is null or first_row<1 or last_row<first_row or last_row-first_row>10000 then raise exception 'Faixa de linhas inválida.'; end if;
   mapping:=p_input->'mapping';units:=coalesce(p_input->'units','{}');
   if jsonb_typeof(mapping) is distinct from 'object' or mapping->>'tag' is null or jsonb_typeof(units)<>'object' then raise exception 'Mapeamento e unidades inválidos.'; end if;
   for k,col in select key,value from jsonb_each_text(mapping) loop
     if k not in ('tag','segment','fluid','material','diameter','volume','temperature','operationPressure','designPressure','pmta','thickness','minimumThickness','operation') then raise exception 'Campo de mapeamento desconhecido.'; end if;
     perform pi_gestao_private.ga_column(col);
     if k in ('diameter','volume','temperature','operationPressure','designPressure','pmta','thickness','minimumThickness') then perform pi_gestao_private.ga_text(units->>k,'Unidade original '||k,100); end if;
   end loop;
   for range_info in select value from jsonb_array_elements(coalesce(meta->'mergedRanges','[]')||coalesce(meta->'formulaRanges','[]')||coalesce(meta->'formulaCells','[]')) where value->>'sheet'=sheet_name loop
     if pi_gestao_private.ga_range_intersects(coalesce(range_info->>'range',range_info->>'address'),first_row,last_row,mapping,p_input->>'companyCell') then
       blockers:=blockers||jsonb_build_array('Célula mesclada ou fórmula na origem '||sheet_name||'!'||coalesce(range_info->>'range',range_info->>'address')||'; confira empresa, identificação e valores antes de importar.');
     end if;
   end loop;
 end if;
 for rr in select value from jsonb_array_elements(sheet->'rows') where (value->>'row')::integer between first_row and last_row order by (value->>'row')::integer loop
   n:=(rr->>'row')::integer;vv:='{}';
   if format_name='pdf_control' then
     vv:=jsonb_build_object('tag',rr->'values'->0,'pAndId',rr->'values'->1,'module',rr->'values'->2,'systemColumn',rr->'values'->3,'inspectionStartRaw',rr->'values'->4,'inspectionEndRaw',rr->'values'->5,'visual',rr->'values'->6,'utm',rr->'values'->7,'isometric',rr->'values'->8,'progressRaw',rr->'values'->9,'comments',rr->'values'->10);
   else
     if not exists(select 1 from jsonb_array_elements(rr->'values') v where v not in ('null'::jsonb,'""'::jsonb)) then warnings:=warnings||jsonb_build_array('Linha '||n||' vazia; não será importada.');continue;end if;
     for k,col in select key,value from jsonb_each_text(mapping) loop
       if left(coalesce(rr->'values'->>pi_gestao_private.ga_column(col),''),1)='=' then raise exception 'Célula com fórmula exige conferência.'; end if;
       vv:=vv||jsonb_build_object(k,coalesce(rr->'values'->pi_gestao_private.ga_column(col),'null'::jsonb));
     end loop;
   end if;
   tag:=vv->>'tag';
   if tag is null or btrim(tag)='' then
     if format_name='pdf_control' then warnings:=warnings||jsonb_build_array('Item '||n||' sem TAG; excluído.');continue;
     else raise exception 'Linha %: TAG ausente; confira a fonte.',n;end if;
   end if;
   perform pi_gestao_private.ga_text(tag,'TAG',300);
   ident:=pi_gestao_private.ga_hash(jsonb_build_array(p_input->>'sourceIdentity',sheet_name,n));
   digest_value:=pi_gestao_private.ga_hash(jsonb_build_object('values',vv,'units',units,'unit',p_input->>'unit','system',p_input->>'system','type',v_kind));
   select * into prior from pi_gestao_private.imports where tenant_id=p_tenant and owner_id=p_owner and (identity=ident or canonical_key=pi_gestao_private.ga_hash(jsonb_build_array(src.id,sheet_name,n))); 
   action_name:=case when prior.identity is null then 'novo' when prior.digest=digest_value then 'inalterado' else 'conflito' end;
   row_blockers:=pi_gestao_private.ga_tag_blockers(tag,case when format_name='pdf_control' then 'Item ' else 'Linha ' end||n);
   blockers:=blockers||row_blockers;
   if exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=p_owner and kind='asset' and body->>'tag'=tag and id is distinct from prior.asset_id) or exists(select 1 from jsonb_array_elements(rows) x where x->'values'->>'tag'=tag) then warnings:=warnings||jsonb_build_array('TAG '||tag||' repetida; cada linha de origem permanece separada.');end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('row',n,'page',case when format_name='pdf_control' then 1 else null end,'bbox',rr->'bbox','values',vv,'identity',ident,'digest',digest_value,'action',action_name,'existingId',prior.asset_id,'blockers',row_blockers));
 end loop;
 if jsonb_array_length(rows)=0 then raise exception 'Nenhuma linha válida na prévia.'; end if;
 result:=jsonb_build_object('id',pid,'companyId',p_owner,'ownerId',p_owner,'companyName',owner->>'name','sourceCompanyName',coalesce(p_input->>'sourceCompanyName',owner->>'name'),'ownerMappingEvidence',nullif(p_input->>'ownerMappingEvidence',''),'ownerMappingConfirmedBy',p_actor,'sourceId',src.id,'sourceIdentity',p_input->>'sourceIdentity','sourceFormat',format_name,'sheet',sheet_name,'companyCell',p_input->>'companyCell','unit',p_input->>'unit','system',p_input->>'system','systemEvidence',p_input->>'systemEvidence','type',v_kind,'mapping',mapping,'units',units,'rows',rows,'warnings',warnings,'blockers',blockers,'createdAt',now(),'fileName',src.name,'fileHash',src.id,'sourceMetadata',meta);
 insert into pi_gestao_private.previews(tenant_id,owner_id,id,source_id,body,created_by) values(p_tenant,p_owner,pid,src.id,result,p_actor);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_text(p_value text, p_label text, p_max integer DEFAULT 2000)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  if p_value is null or length(btrim(p_value))=0 or length(p_value)>p_max then
    raise exception using errcode='22023',message=p_label||': texto obrigatório ou limite excedido.';
  end if;
  return btrim(p_value);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_tag_blockers(p_tag text, p_origin text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select case when p_tag ~* '(^|[^[:alnum:]])(HOLD|X{2,})($|[^[:alnum:]])'
 then jsonb_build_array(p_origin||': TAG provisória '||p_tag||'; fonte e identificação definitiva pendentes de confirmação.') else '[]'::jsonb end
$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_api(p_tenant uuid, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid;v_owner uuid;owner jsonb;result jsonb;u jsonb;s jsonb;a jsonb;new_id uuid;src pi_gestao_private.sources;
 manual_reference text;manual_technical jsonb;field record;history_id uuid;
begin
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Payload inválido.';end if;
 if p_action is null or p_action not in ('access.get','owners.list','owners.create','hierarchy.create','assets.create','state.get','sources.get','imports.preview','imports.commit','history.get','contracts.create','campaigns.create','inspections.create','documents.create','lvts.create','findings.create','rtis.open','relationships.create','lvt_items.create','photos.create','book.get','reports.system') then raise exception using errcode='0A000',message='Operação não disponível neste adaptador.';end if;
 actor:=pi_gestao_private.ga_require_access(p_tenant,p_action not in ('access.get','owners.list','state.get','sources.get','history.get','book.get','reports.system'));
 if p_action='access.get' then return pi_gestao_private.ga_access_for_actor(p_tenant,actor);
 elsif p_action='owners.list' then
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'source',source) order by created_at,id),'[]') into result from pi_gestao_private.owners where tenant_id=p_tenant;
   return result;
 elsif p_action='owners.create' then
   perform pi_gestao_private.ga_text(p_payload->>'name','Nome da empresa cliente',200);perform pi_gestao_private.ga_text(p_payload->>'source','Fonte do nome');
   select id into new_id from pi_gestao_private.owners where tenant_id=p_tenant and name_key=btrim(regexp_replace(lower(p_payload->>'name'),'[[:space:][:punct:]]+',' ','g'));
   if found then return pi_gestao_private.ga_owner(p_tenant,new_id)||jsonb_build_object('reused',true);end if;
   insert into pi_gestao_private.owners(tenant_id,name,source,created_by) values(p_tenant,btrim(p_payload->>'name'),btrim(p_payload->>'source'),actor) returning id into new_id;
   result:=pi_gestao_private.ga_owner(p_tenant,new_id);perform pi_gestao_private.ga_audit(p_tenant,new_id,new_id,actor,'empresa criada',result);return result;
 elsif p_action='sources.get' then
   select * into src from pi_gestao_private.sources where tenant_id=p_tenant and id=p_payload->>'sourceId';
   if not found then raise exception 'Fonte não encontrada neste tenant.';end if;
   if nullif(p_payload->>'ownerId','') is not null then
     v_owner:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,v_owner);
     if not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner and body->'source'->>'sourceId'=src.id) then raise exception 'Fonte não vinculada à empresa cliente.';end if;
   elsif src.created_by<>actor then raise exception using errcode='42501',message='Fonte ainda não vinculada; revisão restrita ao operador que a enviou.';end if;
   return jsonb_build_object('id',src.id,'sha',src.id,'name',src.name,'size',src.byte_size,'objectKey',src.object_key,'format',coalesce(src.workbook->>'format','xlsx'));
 end if;
 if p_action='imports.preview' then return pi_gestao_private.ga_preview(p_tenant,nullif(p_payload->>'ownerId','')::uuid,p_payload,actor);end if;
 if p_action='imports.commit' then return pi_gestao_private.ga_commit(p_tenant,nullif(p_payload->>'ownerId','')::uuid,(p_payload->>'previewId')::uuid,(p_payload->>'confirm')::boolean,actor);end if;
 v_owner:=coalesce(nullif(p_payload->>'ownerId',''),nullif(p_payload->>'companyId',''))::uuid;owner:=pi_gestao_private.ga_owner(p_tenant,v_owner);
 if p_action='reports.system' then return pi_gestao_private.ga_system_report(p_tenant,v_owner,nullif(p_payload->>'systemId','')::uuid,nullif(p_payload->>'campaignId','')::uuid);end if;
 if p_action in ('contracts.create','campaigns.create','inspections.create','documents.create','lvts.create','findings.create','rtis.open','relationships.create','lvt_items.create','photos.create') then return pi_gestao_private.ga_workflow(p_tenant,v_owner,p_action,p_payload,actor);end if;
 if p_action='book.get' then
   history_id:=(p_payload->>'assetId')::uuid;perform pi_gestao_private.ga_record(p_tenant,v_owner,history_id,'asset');
   select jsonb_build_object('asset',pi_gestao_private.ga_record(p_tenant,v_owner,history_id,'asset'),'records',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'kind',kind,'version',version) order by seq) filter(where kind<>'asset' and (body->>'assetId'=history_id::text or (kind in ('campaign','contract') and (body->'assetIds') ? history_id::text) or exists(select 1 from pi_gestao_private.record_relations rel where rel.tenant_id=p_tenant and rel.owner_id=v_owner and rel.from_id=records.id and rel.to_id=history_id))),'[]')) into result from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner;return result;
 end if;
 if p_action='state.get' then
   result:=jsonb_build_object('company',owner,'contract','[]'::jsonb,'document','[]'::jsonb,'revision','[]'::jsonb,'classification','[]'::jsonb,'deadline','[]'::jsonb,'rti','[]'::jsonb,'inspection','[]'::jsonb,'delivery','[]'::jsonb);
   select result||jsonb_build_object('unit',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='unit'),'[]'),'system',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='system'),'[]'),'asset',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='asset'),'[]')) into result from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner;
   for field in select unnest(array['contract','campaign','inspection','lvt','finding','rti','document','lvt_item','photo']) as key loop
     select result||jsonb_build_object(case when field.key='lvt_item' then 'lvtItem' else field.key end,coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq),'[]')) into result from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner and kind=field.key;
   end loop;
   select result||jsonb_build_object('relation',coalesce(jsonb_agg(jsonb_build_object('fromId',from_id,'fromKind',from_kind,'toId',to_id,'toKind',to_kind,'relationType',relation_type)),'[]')) into result from pi_gestao_private.record_relations where tenant_id=p_tenant and owner_id=v_owner;
   return result;
 elsif p_action='hierarchy.create' then return pi_gestao_private.ga_hierarchy(p_tenant,v_owner,p_payload->>'unit',p_payload->>'system',actor);
 elsif p_action='assets.create' then
   select body||jsonb_build_object('id',id) into u from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner and id=(p_payload->>'unitId')::uuid and kind='unit';
   select body||jsonb_build_object('id',id) into s from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner and id=(p_payload->>'systemId')::uuid and kind='system';
   if u is null or s is null or s->>'unitId' is distinct from u->>'id' then raise exception 'Sistema e unidade inválidos neste tenant/empresa cliente.';end if;
   perform pi_gestao_private.ga_text(p_payload->>'tag','TAG',300);
   if p_payload->>'type' not in ('linha','segmento') or p_payload->>'type' is null then raise exception 'Este adaptador cadastra linhas e segmentos.';end if;
   if jsonb_typeof(p_payload->'source') is distinct from 'string' then raise exception 'Fonte manual exige referência documental declarada em texto.';end if;
   manual_reference:=pi_gestao_private.ga_text(p_payload->>'source','Referência documental declarada');
   if jsonb_typeof(coalesce(p_payload->'technical','{}')) is distinct from 'object' then raise exception 'Dados técnicos manuais inválidos.';end if;
   manual_technical:='{}';
   for field in select key,value from jsonb_each(coalesce(p_payload->'technical','{}')) loop
     if field.key not in ('fluid','material','diameter','volume','temperature','operationPressure','designPressure','pmta','thickness','minimumThickness') or jsonb_typeof(field.value) is distinct from 'object' or not (field.value ? 'value') then raise exception 'Campo técnico manual não permitido.';end if;
     if jsonb_typeof(field.value->'value') in ('object','array') then raise exception 'Valor técnico deve ser escalar ou ausente.';end if;
     if jsonb_typeof(field.value->'source') is distinct from 'string' or btrim(field.value->>'source') is distinct from manual_reference then raise exception 'Fonte técnica deve corresponder à referência declarada, sem alegação de arquivo verificado.';end if;
     if field.value->'value' not in ('null'::jsonb,'""'::jsonb) and field.key not in ('fluid','material') then perform pi_gestao_private.ga_text(field.value->>'unit','Unidade original '||field.key,100);end if;
     manual_technical:=manual_technical||jsonb_build_object(field.key,jsonb_build_object('value',field.value->'value','unit',field.value->'unit','source',manual_reference));
   end loop;
   if jsonb_array_length(pi_gestao_private.ga_tag_blockers(p_payload->>'tag','Cadastro'))>0 then raise exception 'TAG provisória requer identificação definitiva.';end if;
   return pi_gestao_private.ga_put(p_tenant,v_owner,'asset',jsonb_build_object('tag',p_payload->>'tag','type',p_payload->>'type','unitId',u->>'id','systemId',s->>'id','technical',manual_technical,'source',jsonb_build_object('format','manual','reference',manual_reference,'actorUserId',actor),'operation','nao_informado','technicalCondition','nao_avaliado'),actor);
 elsif p_action='imports.preview' then return pi_gestao_private.ga_preview(p_tenant,v_owner,p_payload,actor);
 elsif p_action='imports.commit' then return pi_gestao_private.ga_commit(p_tenant,v_owner,(p_payload->>'previewId')::uuid,(p_payload->>'confirm')::boolean,actor);
 elsif p_action='history.get' then
   history_id:=(p_payload->>'assetId')::uuid;
   if not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=v_owner and id=history_id) then raise exception 'Registro não encontrado nesta empresa cliente.';end if;
   select coalesce(jsonb_agg(jsonb_build_object('actor',actor_user_id,'at',at,'event',action,'body',body) order by seq),'[]') into result from pi_gestao_private.audit where tenant_id=p_tenant and owner_id=v_owner and record_id=history_id;return result;
 end if;
 raise exception 'Operação indisponível.';
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_range_intersects(p_range text, p_start integer, p_end integer, p_mapping jsonb, p_company_cell text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare bounds text[];company_cell text[];left_col integer;right_col integer;first_row integer;last_row integer;
begin
 bounds:=regexp_match(replace(p_range,'$',''),'^([A-Z]{1,3})([1-9][0-9]*)(:([A-Z]{1,3})([1-9][0-9]*))?$');
 if bounds is null then raise exception 'Intervalo de origem não reconhecido; confira o arquivo.';end if;
 left_col:=pi_gestao_private.ga_column(bounds[1]);right_col:=pi_gestao_private.ga_column(coalesce(bounds[4],bounds[1]));
 first_row:=bounds[2]::integer;last_row:=coalesce(bounds[5],bounds[2])::integer;
 company_cell:=regexp_match(coalesce(p_company_cell,''),'^([A-Z]{1,3})([1-9][0-9]*)$');
 if company_cell is not null and company_cell[2]::integer between first_row and last_row and pi_gestao_private.ga_column(company_cell[1]) between left_col and right_col then return true;end if;
 return first_row<=p_end and last_row>=p_start and exists(select 1 from jsonb_each_text(p_mapping) m where pi_gestao_private.ga_column(m.value) between left_col and right_col);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_access_for_actor(p_tenant uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare role_name text;master boolean;can_write boolean;
begin
 if p_actor is null or p_tenant is null or not exists(select 1 from pi_gestao_private.pilot_access p where p.tenant_id=p_tenant and p.user_id=p_actor and p.revoked_at is null and (p.expires_at is null or p.expires_at>now())) then
   raise exception using errcode='42501',message='Piloto não autorizado para este par exato de usuário e conta.';
 end if;
 if pi_access_private.tenants_enabled() is not true
 or pi_access_private.identity_verified(p_actor) is not true or pi_access_private.company_active(p_tenant) is not true then
   raise exception using errcode='42501',message='Acesso à Gestão indisponível para este tenant e usuário.';
 end if;
 select m.role_name into role_name from public.pi_company_memberships m where m.company_id=p_tenant and m.user_id=p_actor;
 if role_name='client' then raise exception using errcode='42501',message='Gestão operacional não é portal de clientes.';end if;
 master:=(pi_access_private.account_active_legacy(p_actor) is true) and exists(select 1 from pi_access_private.masters m where m.user_id=p_actor and m.revoked_at is null);
 if not master and (role_name is null or role_name not in ('admin','planner','inspector','assistant')
   or not exists(select 1 from public.pi_company_memberships m where m.company_id=p_tenant and m.user_id=p_actor and m.access_state='active')
   or pi_access_private.member_identity_allowed(p_actor,p_tenant) is not true) then
   raise exception using errcode='42501',message='Vínculo ativo e autorizado obrigatório.';
 end if;
 can_write:=master or role_name='admin';
 if can_write then
   begin perform pi_access_private.tenant_write_guard();exception when insufficient_privilege then can_write:=false;end;
 end if;
 return jsonb_build_object('pilot',true,'read',true,'write',can_write,'role',case when master then 'master' else role_name end,'tenant',p_tenant,'actorUserId',p_actor);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_require_access(p_tenant uuid, p_write boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();cap jsonb;status jsonb;
begin
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,actor);
 status:=public.pi_access_status_v3(p_tenant);
 if cap->>'role'='master' then status:=public.pi_access_status_v3(null);end if;
 if status->>'status' is distinct from 'active' or status->>'user_id' is distinct from actor::text
 or (cap->>'role'='master' and status->>'is_master' is distinct from 'true')
 or (cap->>'role'<>'master' and (status->>'company_id' is distinct from p_tenant::text or status->>'company_role' is distinct from cap->>'role')) then
   raise exception using errcode='42501',message='Autorização atual não confirmada pela licença e identidade.';
 end if;
 if p_write and cap->>'write' is distinct from 'true' then raise exception using errcode='42501',message='Gravação exige Gestão autorizada e operação liberada.';end if;
 return actor;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_owner(p_tenant uuid, p_owner uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare value jsonb;
begin
 select jsonb_build_object('id',id,'name',name,'source',source,'createdAt',created_at) into value
 from pi_gestao_private.owners where tenant_id=p_tenant and id=p_owner;
 if value is null then raise exception using errcode='22023',message='Empresa cliente não encontrada neste tenant.'; end if;
 return value;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_audit(p_tenant uuid, p_owner uuid, p_record uuid, p_actor uuid, p_action text, p_body jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 insert into pi_gestao_private.audit(tenant_id,owner_id,record_id,actor_user_id,action,body)
 values(p_tenant,p_owner,p_record,p_actor,p_action,p_body)
$function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_put(p_tenant uuid, p_owner uuid, p_kind text, p_body jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare rid uuid:=gen_random_uuid();
begin
 insert into pi_gestao_private.records(tenant_id,owner_id,id,kind,body) values(p_tenant,p_owner,rid,p_kind,p_body);
 perform pi_gestao_private.ga_audit(p_tenant,p_owner,rid,p_actor,p_kind,p_body);
 return p_body||jsonb_build_object('id',rid,'version',1);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_hierarchy(p_tenant uuid, p_owner uuid, p_unit text, p_system text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare u jsonb;s jsonb;
begin
 p_unit:=pi_gestao_private.ga_text(p_unit,'Unidade',200);
 p_system:=pi_gestao_private.ga_text(p_system,'Sistema',200);
 select body||jsonb_build_object('id',id,'version',version) into u from pi_gestao_private.records
 where tenant_id=p_tenant and owner_id=p_owner and kind='unit' and body->>'name'=p_unit;
 if u is null then u:=pi_gestao_private.ga_put(p_tenant,p_owner,'unit',jsonb_build_object('name',p_unit),p_actor); end if;
 select body||jsonb_build_object('id',id,'version',version) into s from pi_gestao_private.records
 where tenant_id=p_tenant and owner_id=p_owner and kind='system' and body->>'unitId'=u->>'id' and body->>'name'=p_system;
 if s is null then s:=pi_gestao_private.ga_put(p_tenant,p_owner,'system',jsonb_build_object('name',p_system,'unitId',u->>'id'),p_actor); end if;
 return jsonb_build_object('unit',u,'system',s);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_commit(p_tenant uuid, p_owner uuid, p_id uuid, p_confirm boolean, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p pi_gestao_private.previews; row_data jsonb;v jsonb;source_value jsonb;technical jsonb;hierarchy jsonb;asset jsonb;item record;
 prior pi_gestao_private.imports;inserted integer:=0;unchanged integer:=0;expected_identity text;expected_digest text;v_owner uuid;
begin
 if p_confirm is distinct from true then raise exception 'Confirme a prévia antes de gravar.';end if;
 select * into p from pi_gestao_private.previews where tenant_id=p_tenant and id=p_id for update;
 if not found or p.consumed then raise exception 'Prévia inexistente ou já gravada.';end if;
 if p.created_by is distinct from p_actor then raise exception using errcode='42501',message='Prévia privada de outro operador; gere e confira sua própria prévia.';end if;
 if p_owner is not null and p_owner is distinct from p.owner_id then raise exception 'Prévia pertence a outra empresa cliente.';end if;
 v_owner:=p.owner_id;
 if jsonb_array_length(p.body->'blockers')>0 then raise exception 'Prévia bloqueada; identificação ou células pendentes na fonte.';end if;
 if exists(select 1 from jsonb_array_elements(p.body->'rows') r where r->>'action'='conflito') then raise exception 'Alteração na fonte exige revisão; lote bloqueado.';end if;
 if v_owner is null then
   if exists(select 1 from pi_gestao_private.owners where tenant_id=p_tenant and name_key=btrim(regexp_replace(lower(p.body->>'companyName'),'[[:space:][:punct:]]+',' ','g'))) then raise exception 'Empresa criada desde a prévia; selecione o ID existente e revise.';end if;
   insert into pi_gestao_private.owners(tenant_id,name,source,created_by) values(p_tenant,p.body->>'companyName',(p.body->>'sourceIdentity')||' / '||(p.body->>'sheet')||' / '||coalesce(p.body->>'companyCell','cabeçalho PDF'),p_actor) returning id into v_owner;
   perform pi_gestao_private.ga_audit(p_tenant,v_owner,v_owner,p_actor,'empresa criada',pi_gestao_private.ga_owner(p_tenant,v_owner));
 else
   perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=v_owner for update;
   if not found then raise exception 'Empresa cliente não encontrada neste tenant.';end if;
 end if;
 hierarchy:=pi_gestao_private.ga_hierarchy(p_tenant,v_owner,p.body->>'unit',p.body->>'system',p_actor);
 for row_data in select value from jsonb_array_elements(p.body->'rows') loop
   v:=row_data->'values';
   if jsonb_array_length(pi_gestao_private.ga_tag_blockers(v->>'tag','Registro'))>0 then raise exception 'Prévia bloqueada por TAG provisória.';end if;
   expected_identity:=pi_gestao_private.ga_hash(jsonb_build_array(p.body->>'sourceIdentity',p.body->>'sheet',(row_data->>'row')::integer));
   expected_digest:=pi_gestao_private.ga_hash(jsonb_build_object('values',v,'units',p.body->'units','unit',p.body->>'unit','system',p.body->>'system','type',p.body->>'type'));
   if row_data->>'identity' is distinct from expected_identity or row_data->>'digest' is distinct from expected_digest then raise exception 'Integridade da prévia inválida.';end if;
   select * into prior from pi_gestao_private.imports where tenant_id=p_tenant and owner_id=v_owner and (identity=row_data->>'identity' or canonical_key=pi_gestao_private.ga_hash(jsonb_build_array(p.source_id,p.body->>'sheet',(row_data->>'row')::integer))); 
   if prior.identity is not null then
     if prior.digest is distinct from row_data->>'digest' then raise exception 'Fonte mudou desde a prévia; nenhum registro foi gravado.';end if;
     unchanged:=unchanged+1;continue;
   end if;
   source_value:=jsonb_build_object('sourceId',p.source_id,'file',p.body->>'sourceIdentity','fileName',p.body->>'fileName','fileHash',p.body->>'fileHash','format',p.body->>'sourceFormat','sheet',case when p.body->>'sourceFormat'='pdf_control' then null else p.body->>'sheet' end,'row',case when p.body->>'sourceFormat'='pdf_control' then null else (row_data->>'row')::integer end,'page',row_data->'page','item',case when p.body->>'sourceFormat'='pdf_control' then (row_data->>'row')::integer else null end,'bbox',row_data->'bbox','mapping',p.body->'mapping','units',p.body->'units','raw',v,'systemEvidence',p.body->>'systemEvidence','sourceCompanyName',p.body->>'sourceCompanyName','ownerMappingEvidence',p.body->>'ownerMappingEvidence','ownerMappingConfirmedBy',p.body->>'ownerMappingConfirmedBy','metadata',p.body->'sourceMetadata');
   technical:='{}';
   for item in select key,value from jsonb_each(v) where key in ('fluid','material','diameter','volume','temperature','operationPressure','designPressure','pmta','thickness','minimumThickness') loop technical:=technical||jsonb_build_object(item.key,jsonb_build_object('value',item.value,'unit',p.body->'units'->item.key,'source',source_value));end loop;
   asset:=pi_gestao_private.ga_put(p_tenant,v_owner,'asset',jsonb_build_object('tag',v->>'tag','unitId',hierarchy->'unit'->>'id','systemId',hierarchy->'system'->>'id','type',p.body->>'type','technical',technical,'operation','nao_informado','technicalCondition','nao_avaliado','source',source_value,'segment',v->'segment','operationSource',v->'operation'),p_actor);
   insert into pi_gestao_private.imports(tenant_id,owner_id,identity,canonical_key,digest,asset_id,source_id) values(p_tenant,v_owner,row_data->>'identity',pi_gestao_private.ga_hash(jsonb_build_array(p.source_id,p.body->>'sheet',(row_data->>'row')::integer)),row_data->>'digest',(asset->>'id')::uuid,p.source_id);
   inserted:=inserted+1;
 end loop;
 update pi_gestao_private.previews set consumed=true,owner_id=v_owner where tenant_id=p_tenant and id=p_id;
 perform pi_gestao_private.ga_audit(p_tenant,v_owner,(hierarchy->'system'->>'id')::uuid,p_actor,'importação',jsonb_build_object('sourceId',p.source_id,'previewId',p.id,'inserted',inserted,'unchanged',unchanged));
 return jsonb_build_object('company',pi_gestao_private.ga_owner(p_tenant,v_owner),'unit',hierarchy->'unit','system',hierarchy->'system','inserted',inserted,'unchanged',unchanged);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cap jsonb;sha text;source_name text;size_value bigint;object_key text;wb jsonb;format_name text;sheet jsonb;row_data jsonb;existing pi_gestao_private.sources;object_metadata jsonb;
begin
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,p_actor);
 if cap->>'write' is distinct from 'true' then raise exception using errcode='42501',message='Operador da ingestão sem autorização atual de gravação.';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Payload de fonte inválido.';end if;
 sha:=p_payload->>'sha';source_name:=pi_gestao_private.ga_text(p_payload->>'name','Nome original',300);size_value:=(p_payload->>'size')::bigint;object_key:=p_payload->>'objectKey';wb:=p_payload->'workbook';
 if sha is null or sha !~ '^[a-f0-9]{64}$' or size_value is null or size_value<1 or size_value>33554432 then raise exception 'SHA ou tamanho da fonte inválido.';end if;
 if jsonb_typeof(wb) is distinct from 'object' or jsonb_typeof(wb->'sheets') is distinct from 'array' or (coalesce(wb->>'format','xlsx') in ('xlsx','pdf_control') and jsonb_array_length(wb->'sheets')<1) or octet_length(wb::text)>36700160 then raise exception 'Estrutura da fonte inválida.';end if;
 format_name:=coalesce(wb->>'format','xlsx');
 if format_name not in ('xlsx','pdf_control','document_xlsx','document_pdf','image_jpeg','image_png') or (format_name in ('xlsx','document_xlsx') and source_name !~* '\.xlsx$') or (format_name in ('pdf_control','document_pdf') and source_name !~* '\.pdf$') or (format_name='image_jpeg' and source_name !~* '\.jpe?g$') or (format_name='image_png' and source_name !~* '\.png$') then raise exception 'Formato da fonte não suportado.';end if;
 if format_name in ('xlsx','pdf_control','image_jpeg','image_png') and size_value>8388608 then raise exception 'Fonte de importação limitada a 8 MiB.';end if;
 if format_name in ('document_xlsx','document_pdf','image_jpeg','image_png') and (jsonb_array_length(wb->'sheets')<>0 or wb->'metadata'->>'extraction' is distinct from 'not_performed') then raise exception 'Documento original não deve alegar extração automática.';end if;
 if object_key is distinct from (p_tenant::text||'/'||sha||'/original.'||(case when format_name in ('xlsx','document_xlsx') then 'xlsx' when format_name='image_jpeg' then 'jpg' when format_name='image_png' then 'png' else 'pdf' end)) then raise exception 'Objeto original fora do caminho imutável deste tenant/SHA.';end if;
 if not exists(select 1 from storage.buckets b where b.id='pi-gestao-sources' and b.public=false) then raise exception 'Bucket privado de originais indisponível.';end if;
 select o.metadata into object_metadata from storage.objects o where o.bucket_id='pi-gestao-sources' and o.name=object_key;
 if not found then raise exception 'Objeto original ainda não foi armazenado.';end if;
 if object_metadata ? 'size' and (object_metadata->>'size')::bigint<>size_value then raise exception 'Tamanho declarado diverge do objeto armazenado.';end if;
 if (select count(*) from jsonb_array_elements(wb->'sheets'))<>(select count(distinct value->>'name') from jsonb_array_elements(wb->'sheets')) then raise exception 'Abas ausentes ou repetidas.';end if;
 for sheet in select value from jsonb_array_elements(wb->'sheets') loop
   perform pi_gestao_private.ga_text(sheet->>'name','Aba original',300);
   if jsonb_typeof(sheet->'rows') is distinct from 'array' or jsonb_array_length(sheet->'rows')>50000 then raise exception 'Linhas da fonte inválidas ou excessivas.';end if;
   if (select count(*) from jsonb_array_elements(sheet->'rows'))<>(select count(distinct value->>'row') from jsonb_array_elements(sheet->'rows')) then raise exception 'Linhas de origem repetidas.';end if;
   for row_data in select value from jsonb_array_elements(sheet->'rows') loop
     if jsonb_typeof(row_data->'row') is distinct from 'number' or (row_data->>'row')::integer<1 or (row_data->>'row')::integer>50000 or jsonb_typeof(row_data->'values') is distinct from 'array' or jsonb_array_length(row_data->'values')>300 then raise exception 'Coordenadas ou células inválidas.';end if;
     if exists(select 1 from jsonb_array_elements(row_data->'values') v where jsonb_typeof(v) in ('array','object')) then raise exception 'Célula não escalar na fonte.';end if;
   end loop;
 end loop;
 select * into existing from pi_gestao_private.sources where tenant_id=p_tenant and id=sha for update;
 if found then
   if existing.byte_size<>size_value or existing.object_key<>object_key or existing.workbook<>wb then raise exception 'Fonte original imutável; conflito de registro.';end if;
   return jsonb_build_object('id',existing.id,'sha',existing.id,'name',existing.name,'format',coalesce(existing.workbook->>'format','xlsx'),'metadata',existing.workbook->'metadata','sheets',existing.workbook->'sheets');
 end if;
 insert into pi_gestao_private.sources(tenant_id,id,name,byte_size,object_key,workbook,created_by) values(p_tenant,sha,source_name,size_value,object_key,wb,p_actor) on conflict(tenant_id,id) do nothing;
 if not found then
   select * into existing from pi_gestao_private.sources where tenant_id=p_tenant and id=sha;
   if existing.byte_size<>size_value or existing.object_key<>object_key or existing.workbook<>wb then raise exception 'Fonte original imutável; conflito de registro.';end if;
   return jsonb_build_object('id',existing.id,'sha',existing.id,'name',existing.name,'format',coalesce(existing.workbook->>'format','xlsx'),'metadata',existing.workbook->'metadata','sheets',existing.workbook->'sheets');
 end if;
 insert into pi_gestao_private.audit(tenant_id,record_id,actor_user_id,action,body) values(p_tenant,gen_random_uuid(),p_actor,'fonte registrada',jsonb_build_object('sourceId',sha,'name',source_name,'size',size_value,'objectKey',object_key));
 return jsonb_build_object('id',sha,'sha',sha,'name',source_name,'format',format_name,'metadata',wb->'metadata','sheets',wb->'sheets');
end $function$;

CREATE OR REPLACE FUNCTION public.pi_gestao_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
BEGIN ATOMIC
 SELECT pi_gestao_private.ga_register_source(p_tenant, p_actor, p_payload) AS ga_register_source;
END;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_record(p_tenant uuid, p_owner uuid, p_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 select body||jsonb_build_object('id',id,'version',version) into result from pi_gestao_private.records
 where tenant_id=p_tenant and owner_id=p_owner and id=p_id and kind=p_kind;
 if result is null then raise exception using errcode='22023',message='Vínculo não encontrado com o tipo correto nesta empresa cliente.';end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_evidence(p_tenant uuid, p_owner uuid, p_input jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare src pi_gestao_private.sources;loc jsonb:=p_input->'locator';
begin
 select * into src from pi_gestao_private.sources where tenant_id=p_tenant and id=p_input->>'sourceId';
 if not found then raise exception 'Original registrado obrigatório para esta evidência.';end if;
 if src.created_by<>p_actor and not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=p_owner and body->'source'->>'sourceId'=src.id) then raise exception using errcode='42501',message='Original privado não vinculado a esta empresa cliente.';end if;
 if jsonb_typeof(loc) is distinct from 'object' or octet_length(loc::text)>4000 or (
   (jsonb_typeof(loc->'page')='number' and (loc->>'page')::integer>0)
   or (length(btrim(loc->>'sheet'))>0 and jsonb_typeof(loc->'row')='number' and (loc->>'row')::integer>0)
   or length(btrim(loc->>'section'))>0) is not true then raise exception 'Localizador explícito da evidência é obrigatório.';end if;
 if loc ? 'sheet' or loc ? 'row' then
   if not exists(select 1 from jsonb_array_elements(src.workbook->'sheets') sh cross join lateral jsonb_array_elements(sh->'rows') rr where sh->>'name'=loc->>'sheet' and rr->>'row'=loc->>'row') and coalesce(src.workbook->>'format','xlsx') not in ('document_xlsx','document_pdf') then raise exception 'Aba/linha de evidência não existe no original registrado.';end if;
 end if;
 return jsonb_build_object('sourceId',src.id,'fileHash',src.id,'fileName',src.name,'format',coalesce(src.workbook->>'format','xlsx'),'locator',loc);
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_origin_put(p_tenant uuid, p_owner uuid, p_kind text, p_key text, p_body jsonb, p_source text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior pi_gestao_private.record_origins;result jsonb;digest_value text:=pi_gestao_private.ga_hash(p_body);
begin
 -- Caller holds the owner row lock, serializing origins/relations for that owner.
 select * into prior from pi_gestao_private.record_origins where tenant_id=p_tenant and owner_id=p_owner and kind=p_kind and origin_key=p_key;
 if found then
   if prior.digest<>digest_value then raise exception using errcode='23505',message='Origem já registrada com conteúdo diferente; revisão necessária.';end if;
   return pi_gestao_private.ga_record(p_tenant,p_owner,prior.record_id,p_kind)||jsonb_build_object('reused',true);
 end if;
 result:=pi_gestao_private.ga_put(p_tenant,p_owner,p_kind,p_body||jsonb_build_object('createdBy',p_actor,'createdAt',now()),p_actor);
 insert into pi_gestao_private.record_origins(tenant_id,owner_id,kind,origin_key,record_id,source_id,digest)
 values(p_tenant,p_owner,p_kind,p_key,(result->>'id')::uuid,p_source,digest_value);
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_link(p_tenant uuid, p_owner uuid, p_from uuid, p_from_kind text, p_to uuid, p_to_kind text, p_type text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb;b jsonb;result jsonb;
begin
 a:=pi_gestao_private.ga_record(p_tenant,p_owner,p_from,p_from_kind);b:=pi_gestao_private.ga_record(p_tenant,p_owner,p_to,p_to_kind);
 if p_from_kind='rti' and p_to_kind='asset' and a->>'assetId' is not null and a->>'assetId'<>p_to::text then raise exception 'RTI já vinculada a outro ativo; revisão necessária.';end if;
 if p_from_kind='rti' and p_to_kind='finding' and a->>'assetId' is not null and b->>'assetId' is distinct from a->>'assetId' then raise exception 'Achado e RTI pertencem a ativos diferentes.';end if;
 if p_from_kind='rti' and p_to_kind='finding' and a->>'contractId' is not null and b->>'contractId' is not null and a->>'contractId'<>b->>'contractId' then raise exception 'RTI e achado pertencem a contratos diferentes.';end if;
 if p_from_kind='rti' and p_to_kind='finding' and a->>'campaignId' is not null and b->>'campaignId' is not null and a->>'campaignId'<>b->>'campaignId' then raise exception 'RTI e achado pertencem a campanhas diferentes.';end if;
 if p_from_kind='rti' and p_to_kind='finding' and a->>'findingId' is not null and a->>'findingId'<>p_to::text then raise exception 'RTI já vinculada a outro achado.';end if;
 result:=jsonb_build_object('fromId',p_from,'fromKind',p_from_kind,'toId',p_to,'toKind',p_to_kind,'relationType',p_type);
 insert into pi_gestao_private.record_relations(tenant_id,owner_id,from_id,from_kind,to_id,to_kind,relation_type,created_by)
 values(p_tenant,p_owner,p_from,p_from_kind,p_to,p_to_kind,p_type,p_actor) on conflict do nothing;
 if found then perform pi_gestao_private.ga_audit(p_tenant,p_owner,p_from,p_actor,'vínculo explícito criado',result);end if;
 if p_from_kind='rti' and p_to_kind='asset' and p_type='affects' then
   update pi_gestao_private.records set body=jsonb_set(jsonb_set(body,'{assetId}',to_jsonb(p_to::text)),'{unresolved,asset}','false')||jsonb_build_object('systemId',b->>'systemId'),version=version+1 where tenant_id=p_tenant and owner_id=p_owner and id=p_from and body->>'assetId' is null;
 end if;
 if p_from_kind='rti' and p_to_kind='finding' and p_type='addresses' then
   perform pi_gestao_private.ga_link(p_tenant,p_owner,p_from,'rti',(b->>'assetId')::uuid,'asset','affects',p_actor);
   update pi_gestao_private.records set body=body||jsonb_build_object('findingId',p_to,'lvtItemId',b->>'lvtItemId','contractId',coalesce(body->>'contractId',b->>'contractId'),'campaignId',coalesce(body->>'campaignId',b->>'campaignId'))||jsonb_build_object('unresolved',jsonb_build_object('asset',false,'contract',coalesce(body->>'contractId',b->>'contractId') is null)),version=version+1 where tenant_id=p_tenant and owner_id=p_owner and id=p_from and body->>'findingId' is null;
 end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_workflow(p_tenant uuid, p_owner uuid, p_action text, p_input jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b jsonb;result jsonb;con jsonb;campaign jsonb;inspection jsonb;doc jsonb;lvt jsonb;finding jsonb;evidence jsonb;lvt_item jsonb;source_format text;
 ids jsonb;module_scopes jsonb;module_name text;item jsonb;entry record;key_value text;kind_value text;source_id text;asset uuid;ref uuid;asset_text text;auto_rti jsonb;
begin
 perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=p_owner for update;
 if not found then raise exception 'Empresa cliente não encontrada neste tenant.';end if;
 if p_action in ('contracts.create','campaigns.create','inspections.create') then
   if coalesce(p_input->>'requestId','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then raise exception 'requestId UUID estável obrigatório para repetição segura.';end if;
   key_value:='request:'||(p_input->>'requestId');
 end if;
 if p_action='contracts.create' then
   if jsonb_typeof(p_input->'modules') is distinct from 'array' or jsonb_array_length(p_input->'modules')<1 or exists(select 1 from jsonb_array_elements_text(p_input->'modules') m where m not in ('integridade','nr13','valvulas','rtis')) then raise exception 'Módulos explícitos do contrato obrigatórios.';end if;
   ids:=p_input->'assetIds';module_scopes:=coalesce(p_input->'moduleAssetIds','{}');
   if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)=0 or jsonb_typeof(module_scopes)<>'object' then raise exception 'Escopo explícito de ativos obrigatório.';end if;
   for item in select value from jsonb_array_elements(ids) loop perform pi_gestao_private.ga_record(p_tenant,p_owner,(item#>>'{}')::uuid,'asset');end loop;
   if not p_input ? 'moduleAssetIds' then for module_name in select jsonb_array_elements_text(p_input->'modules') loop module_scopes:=module_scopes||jsonb_build_object(module_name,ids);end loop;end if;
   for module_name in select jsonb_array_elements_text(p_input->'modules') loop
     if jsonb_typeof(module_scopes->module_name) is distinct from 'array' or not ids @> (module_scopes->module_name) then raise exception 'Escopo por módulo deve conter apenas ativos deste contrato.';end if;
   end loop;
   if exists(select 1 from jsonb_object_keys(module_scopes) m where not (p_input->'modules') ? m) then raise exception 'Módulo de escopo não faz parte do contrato.';end if;
   b:=jsonb_build_object('name',pi_gestao_private.ga_text(p_input->>'name','Contrato',200),'source',pi_gestao_private.ga_text(p_input->>'source','Referência do contrato'),'modules',p_input->'modules','assetIds',ids,'moduleAssetIds',module_scopes,'status','rascunho');
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'contract',key_value,b,null,p_actor);
   for item in select value from jsonb_array_elements(ids) loop perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'contract',(item#>>'{}')::uuid,'asset','scope_asset',p_actor);end loop;
 elsif p_action='campaigns.create' then
   con:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'contractId')::uuid,'contract');perform pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'systemId')::uuid,'system');module_name:=p_input->>'module';ids:=p_input->'assetIds';
   if module_name is null or not (con->'modules') ? module_name or jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)=0 or not (con->'moduleAssetIds'->module_name) @> ids then raise exception 'Campanha fora do escopo do módulo/contrato.';end if;
   for asset_text in select jsonb_array_elements_text(ids) loop
     doc:=pi_gestao_private.ga_record(p_tenant,p_owner,asset_text::uuid,'asset');if doc->>'systemId' is distinct from p_input->>'systemId' then raise exception 'Todos os ativos da campanha devem pertencer ao sistema explícito.';end if;
   end loop;
   if p_input->>'status' is distinct from 'rascunho' then raise exception 'Campanha nova deve ser rascunho operacional explícito.';end if;
   for asset_text in select unnest(array['plannedStart','plannedEnd']) loop if nullif(p_input->>asset_text,'') is not null then perform (p_input->>asset_text)::date;end if;end loop;
   if nullif(p_input->>'plannedStart','') is not null and nullif(p_input->>'plannedEnd','') is not null and (p_input->>'plannedEnd')::date<(p_input->>'plannedStart')::date then raise exception 'Período planejado inválido.';end if;
   b:=jsonb_build_object('name',pi_gestao_private.ga_text(p_input->>'name','Campanha',200),'contractId',con->>'id','systemId',p_input->>'systemId','module',module_name,'assetIds',ids,'plannedStart',nullif(p_input->>'plannedStart',''),'plannedEnd',nullif(p_input->>'plannedEnd',''),'source',pi_gestao_private.ga_text(p_input->>'source','Fonte do planejamento'),'status','rascunho');
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'campaign',key_value,b,null,p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'campaign',(con->>'id')::uuid,'contract','under_contract',p_actor);
   for item in select value from jsonb_array_elements(ids) loop perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'campaign',(item#>>'{}')::uuid,'asset','campaign_asset',p_actor);end loop;
 elsif p_action='inspections.create' then
   asset:=(p_input->>'assetId')::uuid;perform pi_gestao_private.ga_record(p_tenant,p_owner,asset,'asset');campaign:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'campaignId')::uuid,'campaign');
   if p_input->>'contractId' is distinct from campaign->>'contractId' or p_input->>'module' is distinct from campaign->>'module' or not (campaign->'assetIds') ? asset::text then raise exception 'Inspeção fora do escopo da campanha.';end if;
   if p_input->>'status' is distinct from 'planejada' or p_input->>'type' is null or p_input->>'type' not in ('visual','espessura') or p_input ? 'done' then raise exception 'Esta ação apenas planeja inspeção; execução exige evidência separada.';end if;
   if nullif(p_input->>'plannedDate','') is not null then perform (p_input->>'plannedDate')::date;end if;
   b:=jsonb_build_object('assetId',asset,'contractId',campaign->>'contractId','campaignId',campaign->>'id','systemId',campaign->>'systemId','module',campaign->>'module','type',p_input->>'type','source',pi_gestao_private.ga_text(p_input->>'source','Fonte do planejamento'),'status','planejada','planned',nullif(p_input->>'plannedDate',''),'done',null);
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'inspection',key_value,b,null,p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'inspection',asset,'asset','inspects',p_actor);perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'inspection',(campaign->>'id')::uuid,'campaign','in_campaign',p_actor);
 elsif p_action='documents.create' then
   evidence:=pi_gestao_private.ga_evidence(p_tenant,p_owner,p_input,p_actor);source_id:=evidence->>'sourceId';
   if p_input->>'module' is null or p_input->>'module' not in ('integridade','nr13','valvulas','rtis') or p_input->>'documentType' is null or p_input->>'documentType' not in ('lvt','rti','relatorio','outro') then raise exception 'Módulo/tipo documental explícito obrigatório.';end if;
   asset:=nullif(p_input->>'assetId','')::uuid;
   if asset is not null then perform pi_gestao_private.ga_record(p_tenant,p_owner,asset,'asset');end if;
   if nullif(p_input->>'contractId','') is not null then con:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'contractId')::uuid,'contract');if asset is not null and not(con->'assetIds') ? asset::text then raise exception 'Documento fora do contrato.';end if;end if;
   if nullif(p_input->>'campaignId','') is not null then campaign:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'campaignId')::uuid,'campaign');if campaign->>'module' is distinct from p_input->>'module' or (con is not null and campaign->>'contractId' is distinct from con->>'id') or (asset is not null and not (campaign->'assetIds') ? asset::text) then raise exception 'Documento fora da campanha.';end if;if con is null then con:=pi_gestao_private.ga_record(p_tenant,p_owner,(campaign->>'contractId')::uuid,'contract');end if;end if;
   b:=jsonb_build_object('reference',pi_gestao_private.ga_text(p_input->>'reference','Referência documental',500),'documentType',p_input->>'documentType','module',p_input->>'module','assetId',asset,'contractId',con->>'id','campaignId',campaign->>'id','source',evidence,'sourceStatus',nullif(p_input->>'sourceStatus',''),'sourceDate',nullif(p_input->>'sourceDate',''),'sourceDateMissingReason',nullif(p_input->>'sourceDateMissingReason',''),'openingEvidence',nullif(p_input->>'openingEvidence',''),'currentness','unknown');
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'document',pi_gestao_private.ga_hash(jsonb_build_array(source_id,evidence->'locator',b->>'documentType')),b,source_id,p_actor);
   if asset is not null then perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'document',asset,'asset','documents_asset',p_actor);end if;
   if campaign is not null then perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'document',(campaign->>'id')::uuid,'campaign','in_campaign',p_actor);end if;
 elsif p_action='lvts.create' then
   asset:=(p_input->>'assetId')::uuid;inspection:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'inspectionId')::uuid,'inspection');doc:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'documentId')::uuid,'document');
   if inspection->>'assetId' is distinct from asset::text or doc->>'documentType' is distinct from 'lvt' or (doc->>'assetId' is not null and doc->>'assetId'<>asset::text) or doc->>'module' is distinct from inspection->>'module' or (doc->>'campaignId' is not null and doc->>'campaignId' is distinct from inspection->>'campaignId') or (doc->>'contractId' is not null and doc->>'contractId' is distinct from inspection->>'contractId') then raise exception 'LVT/original/inspeção não correspondem ao mesmo ativo e módulo.';end if;
   b:=jsonb_build_object('assetId',asset,'inspectionId',inspection->>'id','contractId',inspection->>'contractId','campaignId',inspection->>'campaignId','systemId',inspection->>'systemId','module',inspection->>'module','documentId',doc->>'id','source',doc->'source','status','documentada','currentness','unknown');
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'lvt',pi_gestao_private.ga_hash(jsonb_build_array(doc->>'id',inspection->>'id')),b,doc->'source'->>'sourceId',p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'lvt',(inspection->>'id')::uuid,'inspection','records_inspection',p_actor);perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'lvt',(doc->>'id')::uuid,'document','original_document',p_actor);
 elsif p_action='lvt_items.create' then
   asset:=(p_input->>'assetId')::uuid;lvt:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'lvtId')::uuid,'lvt');
   if lvt->>'assetId' is distinct from asset::text then raise exception 'Item LVT pertence a outro ativo.';end if;
   evidence:=pi_gestao_private.ga_evidence(p_tenant,p_owner,p_input,p_actor);
   b:=jsonb_build_object('assetId',asset,'lvtId',lvt->>'id','inspectionId',lvt->>'inspectionId','campaignId',lvt->>'campaignId','contractId',lvt->>'contractId','systemId',lvt->>'systemId','module',lvt->>'module','itemKey',pi_gestao_private.ga_text(p_input->>'itemKey','Identificador original do item LVT',500),'component',nullif(p_input->>'component',''),'description',nullif(p_input->>'description',''),'source',evidence);
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'lvt_item',pi_gestao_private.ga_hash(jsonb_build_array(lvt->>'id',b->>'itemKey')),b,evidence->>'sourceId',p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'lvt_item',(lvt->>'id')::uuid,'lvt','part_of_lvt',p_actor);
 elsif p_action='photos.create' then
   asset:=(p_input->>'assetId')::uuid;lvt_item:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'lvtItemId')::uuid,'lvt_item');
   if lvt_item->>'assetId' is distinct from asset::text then raise exception 'Foto e item LVT pertencem a ativos diferentes.';end if;
   evidence:=pi_gestao_private.ga_evidence(p_tenant,p_owner,p_input,p_actor);source_format:=evidence->>'format';
   if source_format not in ('image_jpeg','image_png') then raise exception 'Foto exige original JPEG/PNG privado registrado, sem extração automática.';end if;
   b:=jsonb_build_object('assetId',asset,'lvtItemId',lvt_item->>'id','lvtId',lvt_item->>'lvtId','inspectionId',lvt_item->>'inspectionId','campaignId',lvt_item->>'campaignId','contractId',lvt_item->>'contractId','systemId',lvt_item->>'systemId','module',lvt_item->>'module','caption',pi_gestao_private.ga_text(p_input->>'caption','Legenda da foto',2000),'source',evidence);
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'photo',pi_gestao_private.ga_hash(jsonb_build_array(lvt_item->>'id',evidence->>'sourceId',evidence->'locator')),b,evidence->>'sourceId',p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'photo',(lvt_item->>'id')::uuid,'lvt_item','illustrates_item',p_actor);
 elsif p_action='findings.create' then
   asset:=(p_input->>'assetId')::uuid;lvt_item:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'lvtItemId')::uuid,'lvt_item');lvt:=pi_gestao_private.ga_record(p_tenant,p_owner,(lvt_item->>'lvtId')::uuid,'lvt');
   if lvt_item->>'assetId' is distinct from asset::text or (nullif(p_input->>'lvtId','') is not null and p_input->>'lvtId'<>lvt->>'id') then raise exception 'Achado deve corresponder ao item/ativo/LVT explícitos.';end if;
   if lvt->>'assetId' is distinct from asset::text then raise exception 'Achado pertence a outro ativo.';end if;
   evidence:=pi_gestao_private.ga_evidence(p_tenant,p_owner,p_input,p_actor);
   b:=jsonb_build_object('assetId',asset,'lvtItemId',lvt_item->>'id','lvtId',lvt->>'id','inspectionId',lvt->>'inspectionId','campaignId',lvt->>'campaignId','contractId',lvt->>'contractId','systemId',lvt->>'systemId','module',lvt->>'module','description',pi_gestao_private.ga_text(p_input->>'description','Achado documentado',10000),'recommendation',nullif(btrim(p_input->>'recommendation'),''),'sourceStatus',nullif(p_input->>'sourceStatus',''),'sourceDate',nullif(p_input->>'sourceDate',''),'sourceDateMissingReason',nullif(p_input->>'sourceDateMissingReason',''),'source',evidence,'currentness','unknown');
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'finding',pi_gestao_private.ga_hash(jsonb_build_array(lvt_item->>'id',evidence->>'sourceId',evidence->'locator')),b,evidence->>'sourceId',p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'finding',(lvt_item->>'id')::uuid,'lvt_item','found_in_item',p_actor);perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'finding',(lvt->>'id')::uuid,'lvt','found_in',p_actor);perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'finding',asset,'asset','affects',p_actor);
   if b->>'recommendation' is not null then
     -- A real documented recommendation is an RTI in this domain. This is a new
     -- internal app ID, never an invented historical issued number or current status.
     doc:=pi_gestao_private.ga_record(p_tenant,p_owner,(lvt->>'documentId')::uuid,'document');
     auto_rti:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'rti','recommendation:'||(result->>'id'),
       jsonb_build_object('assetId',asset,'findingId',result->>'id','lvtItemId',lvt_item->>'id','systemId',lvt_item->>'systemId','documentId',doc->>'id','title',b->>'recommendation','recommendation',b->>'recommendation','originType','documented_recommendation','issuedNumber',null,'source',evidence,'sourceStatus',b->>'sourceStatus','sourceDate',b->>'sourceDate','sourceDateMissingReason',b->>'sourceDateMissingReason','status','atualidade_desconhecida','currentness','unknown','contractId',lvt->>'contractId','campaignId',lvt->>'campaignId','unresolved',jsonb_build_object('asset',false,'contract',lvt->>'contractId' is null)),evidence->>'sourceId',p_actor);
     perform pi_gestao_private.ga_link(p_tenant,p_owner,(auto_rti->>'id')::uuid,'rti',(lvt_item->>'id')::uuid,'lvt_item','addresses_item',p_actor);perform pi_gestao_private.ga_link(p_tenant,p_owner,(auto_rti->>'id')::uuid,'rti',(result->>'id')::uuid,'finding','addresses',p_actor);
     perform pi_gestao_private.ga_link(p_tenant,p_owner,(auto_rti->>'id')::uuid,'rti',(doc->>'id')::uuid,'document','recommendation_document',p_actor);
     perform pi_gestao_private.ga_link(p_tenant,p_owner,(auto_rti->>'id')::uuid,'rti',asset,'asset','affects',p_actor);
     result:=result||jsonb_build_object('rti',auto_rti);
   end if;

 elsif p_action='rtis.open' then
   doc:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'documentId')::uuid,'document');
   if doc->>'documentType' is distinct from 'rti' then raise exception 'Abertura exige documento RTI real e origem registrada.';end if;
   perform pi_gestao_private.ga_text(doc->>'openingEvidence','Evidência documental de abertura RTI',10000);perform pi_gestao_private.ga_text(doc->>'sourceStatus','Status original da RTI',500);
   if nullif(doc->>'sourceDate','') is null then perform pi_gestao_private.ga_text(doc->>'sourceDateMissingReason','Motivo da data de origem ausente');end if;
   evidence:=pi_gestao_private.ga_evidence(p_tenant,p_owner,jsonb_build_object('sourceId',doc->'source'->>'sourceId','locator',doc->'source'->'locator'),p_actor);
   asset:=nullif(p_input->>'assetId','')::uuid;
   if asset is not null then perform pi_gestao_private.ga_record(p_tenant,p_owner,asset,'asset');end if;
   if doc->>'assetId' is not null and doc->>'assetId' is distinct from asset::text then raise exception 'RTI e documento correspondem a ativos diferentes.';end if;
   if nullif(p_input->>'findingId','') is not null then finding:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_input->>'findingId')::uuid,'finding');if asset is null or finding->>'assetId'<>asset::text then raise exception 'Achado e RTI exigem mesmo ativo explícito.';end if;end if;
   if p_input ? 'due' or p_input ? 'currentness' or p_input ? 'status' or p_input ? 'closed' or p_input ? 'severity' then raise exception 'Estado atual, prazo, encerramento e categoria não são inferidos da fonte histórica.';end if;
   b:=jsonb_build_object('assetId',asset,'findingId',finding->>'id','lvtItemId',finding->>'lvtItemId','systemId',finding->>'systemId','documentId',doc->>'id','title',pi_gestao_private.ga_text(p_input->>'title','RTI documentada',1000),'source',evidence,'originType','historical_rti_document','issuedNumber',doc->>'reference','sourceStatus',doc->>'sourceStatus','sourceDate',doc->>'sourceDate','sourceDateMissingReason',doc->>'sourceDateMissingReason','openingEvidence',doc->>'openingEvidence','status','atualidade_desconhecida','currentness','unknown','contractId',coalesce(finding->>'contractId',doc->>'contractId'),'campaignId',coalesce(finding->>'campaignId',doc->>'campaignId'),'unresolved',jsonb_build_object('asset',asset is null,'contract',coalesce(finding->>'contractId',doc->>'contractId') is null));
   result:=pi_gestao_private.ga_origin_put(p_tenant,p_owner,'rti',doc->>'id',b,evidence->>'sourceId',p_actor);
   perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'rti',(doc->>'id')::uuid,'document','opening_document',p_actor);
   if asset is not null then perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'rti',asset,'asset','affects',p_actor);end if;
   if finding is not null then perform pi_gestao_private.ga_link(p_tenant,p_owner,(result->>'id')::uuid,'rti',(finding->>'id')::uuid,'finding','addresses',p_actor);end if;
 elsif p_action='relationships.create' then
   -- Only unresolved RTI/document association is mutable in this slice; the other
   -- edges are derived atomically by their creation actions and cannot bypass scope checks.
   if p_input->>'fromKind' is distinct from 'rti' or p_input->>'toKind' not in ('asset','finding') or (p_input->>'toKind'='asset' and p_input->>'relationType'<>'affects') or (p_input->>'toKind'='finding' and p_input->>'relationType'<>'addresses') then raise exception 'Vínculo manual disponível apenas para resolver RTI documental existente.';end if;
   result:=pi_gestao_private.ga_link(p_tenant,p_owner,(p_input->>'fromId')::uuid,p_input->>'fromKind',(p_input->>'toId')::uuid,p_input->>'toKind',p_input->>'relationType',p_actor);
 else raise exception using errcode='0A000',message='Fluxo indisponível.';
 end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.ga_system_report(p_tenant uuid, p_owner uuid, p_system uuid, p_campaign uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare system_record jsonb;campaign_record jsonb;contract_record jsonb;result jsonb;owner_record jsonb;
begin
 owner_record:=pi_gestao_private.ga_owner(p_tenant,p_owner);
 if p_campaign is not null then
   campaign_record:=pi_gestao_private.ga_record(p_tenant,p_owner,p_campaign,'campaign');
   if p_system is not null and campaign_record->>'systemId' is distinct from p_system::text then raise exception 'Campanha não pertence ao sistema solicitado.';end if;
   p_system:=(campaign_record->>'systemId')::uuid;contract_record:=pi_gestao_private.ga_record(p_tenant,p_owner,(campaign_record->>'contractId')::uuid,'contract');
 end if;
 system_record:=pi_gestao_private.ga_record(p_tenant,p_owner,p_system,'system');
 -- One statement reads the canonical records, versions and provenance consistently.
 with assets as materialized (
  select r.* from pi_gestao_private.records r where tenant_id=p_tenant and owner_id=p_owner and kind='asset' and body->>'systemId'=p_system::text and (p_campaign is null or (campaign_record->'assetIds') ? id::text)
 ), scoped as materialized (
  select r.* from pi_gestao_private.records r where tenant_id=p_tenant and owner_id=p_owner and (
   (kind='asset' and exists(select 1 from assets a where a.id=r.id))
   or (kind='contract' and (p_campaign is null or r.id=(campaign_record->>'contractId')::uuid) and exists(select 1 from assets a where (r.body->'assetIds') ? a.id::text))
   or (kind='campaign' and body->>'systemId'=p_system::text and (p_campaign is null or r.id=p_campaign))
   or (kind in ('inspection','lvt','lvt_item','photo','finding','rti','document') and (exists(select 1 from assets a where a.id::text=r.body->>'assetId')) and (p_campaign is null or r.body->>'campaignId'=p_campaign::text))
  )
 ), selected as materialized (
  select * from scoped
  union all
  select d.* from pi_gestao_private.records d where d.tenant_id=p_tenant and d.owner_id=p_owner and d.kind='document' and not exists(select 1 from scoped s where s.id=d.id) and exists(select 1 from scoped s where s.kind in ('lvt','rti') and s.body->>'documentId'=d.id::text)
 )
 select jsonb_build_object('snapshotVersion',1,'version',1,'draft',true,'canIssue',false,'company',owner_record,'system',system_record,'campaign',campaign_record,'contract',contract_record,
 'assets',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='asset'),'[]'),
 'contracts',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='contract'),'[]'),
 'campaigns',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='campaign'),'[]'),
 'inspections',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='inspection'),'[]'),
 'lvts',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='lvt'),'[]'),
 'lvtItems',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='lvt_item'),'[]'),
 'photos',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='photo'),'[]'),
 'findings',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='finding'),'[]'),
 'rtis',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='rti'),'[]'),
 'documents',coalesce(jsonb_agg(body||jsonb_build_object('id',id,'version',version) order by seq) filter(where kind='document'),'[]'),
 'recordVersions',coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'version',version) order by seq),'[]'),
 'sourceProvenance',coalesce((select jsonb_agg(jsonb_build_object('sourceId',s.id,'fileHash',s.id,'fileName',s.name,'format',coalesce(s.workbook->>'format','xlsx')) order by s.id) from pi_gestao_private.sources s where s.tenant_id=p_tenant and exists(select 1 from selected r where r.body->'source'->>'sourceId'=s.id)),'[]'),
 'unresolvedOwnerRTICount',(select count(*) from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='rti' and r.body->>'assetId' is null)) into result from selected;
 return result||jsonb_build_object('scopeDigest',pi_gestao_private.ga_hash(result),'generatedAt',statement_timestamp());
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.can_person(p_tenant uuid, p_person uuid, p_manager boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;
begin
 c:=pi_team_private.context(p_tenant);
 return exists(select 1 from pi_team_private.professionals p where p.tenant_id=p_tenant and p.id=p_person
 and ((c->>'manager')::boolean or (not p_manager and p.user_id=auth.uid() and p.access_revoked_at is null)));
exception when insufficient_privilege then return false;
end $function$;

CREATE OR REPLACE FUNCTION pi_gestao_private.gp_preview(t uuid, o uuid, c jsonb, i jsonb, a uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare src pi_gestao_private.sources; sh jsonb; rr jsonb; v jsonb; rows jsonb:='[]'; issues jsonb;
 m jsonb:=coalesce(i->'mapping','{}'); k text; col text; n integer; first_n integer; last_n integer;
 target jsonb; matches jsonb; typ text; mod text:=c->'modules'->>0; ident text; range_info jsonb; selected jsonb;
begin
 if i->>'mode'='existing' then
  if jsonb_typeof(i->'ids') is distinct from 'array' or jsonb_array_length(i->'ids')>10000 then raise exception 'Selecione os registros existentes.';end if;
  -- Aggregate only identity fields in one pass. Canonical technical bodies stay in records.
  select coalesce(jsonb_agg(jsonb_build_object('row',q.n,'existingId',q.id,'values',jsonb_strip_nulls(jsonb_build_object('id',q.id,'tag',q.body->>'tag','title',q.body->>'title','type',q.body->>'type','unitId',q.body->>'unitId','systemId',q.body->>'systemId','assetId',q.body->>'assetId')),'action','link','issues','[]'::jsonb) order by q.n),'[]') into rows
  from (select r.id,r.body,row_number() over(order by r.id) n from pi_gestao_private.records r where r.tenant_id=t and r.owner_id=o and r.kind=case when mod='rtis' then 'rti' else 'asset' end and r.id=any(array(select distinct value::uuid from jsonb_array_elements_text(i->'ids')))) q;
  if jsonb_array_length(rows)<>(select count(distinct value) from jsonb_array_elements_text(i->'ids')) then raise exception using errcode='22023',message='Vínculo não encontrado com o tipo correto nesta empresa cliente.';end if;
  if exists(select 1 from jsonb_array_elements(rows) x where mod='nr13' and coalesce(x->'values'->>'type','') not in ('tanque','vaso','caldeira','outro') or mod='valvulas' and coalesce(x->'values'->>'type','')<>'valvula') then raise exception 'Tipo incompatível com o módulo.';end if;
 else
  select * into src from pi_gestao_private.sources where tenant_id=t and id=i->>'sourceId';
  if not found or coalesce(src.workbook->>'format','xlsx')<>'xlsx' then raise exception 'Selecione uma lista XLSX extraída pelo servidor.';end if;
  if src.created_by<>a and not exists(select 1 from pi_gestao_private.records r where r.tenant_id=t and r.owner_id=o and r.body->'source'->>'sourceId'=src.id) then raise exception using errcode='42501',message='Fonte não disponível neste cliente.';end if;
  perform pi_gestao_private.ga_text(i->>'basis','Confirmação da unidade e cliente');
  select value into sh from jsonb_array_elements(src.workbook->'sheets') where value->>'name'=i->>'sheet';
  first_n:=(i->>'start')::integer;last_n:=(i->>'end')::integer;
  if sh is null or first_n is null or last_n is null or first_n<1 or last_n<first_n or last_n-first_n>10000 then raise exception 'Aba ou faixa inválida.';end if;
  if jsonb_typeof(m)<>'object' or not m ? 'tag' then raise exception 'Mapeie a TAG ou o ID da RTI.';end if;
  for k,col in select key,value from jsonb_each_text(m) loop
   if k not in ('tag','unit','system','type','fluid','material','volume','designPressure','temperature','diameter') then raise exception 'Campo não permitido.';end if;
   perform pi_gestao_private.ga_column(col);
   if k in ('volume','designPressure','temperature','diameter') then perform pi_gestao_private.ga_text(i->'units'->>k,'Unidade de medida '||k,50);end if;
  end loop;
  for rr in select value from jsonb_array_elements(sh->'rows') where (value->>'row')::integer between first_n and last_n order by (value->>'row')::integer loop
   if not exists(select 1 from jsonb_array_elements(rr->'values') z where z not in ('null'::jsonb,'""'::jsonb)) then continue;end if;
   n:=(rr->>'row')::integer;v:=jsonb_build_object('unit',nullif(i->>'unit',''),'system',nullif(i->>'system',''),'type',nullif(i->>'type',''));issues:='[]';target:=null;
   for k,col in select key,value from jsonb_each_text(m) loop v:=v||jsonb_build_object(k,nullif(btrim(rr->'values'->>pi_gestao_private.ga_column(col)),''));end loop;
   if coalesce(v->>'tag','')='' then issues:=issues||jsonb_build_array('Identificação ausente');end if;
   issues:=issues||pi_gestao_private.ga_tag_blockers(coalesce(v->>'tag',''),'Linha '||n);
   for range_info in select value from jsonb_array_elements(coalesce(src.workbook->'metadata'->'mergedRanges','[]')||coalesce(src.workbook->'metadata'->'formulaRanges','[]')||coalesce(src.workbook->'metadata'->'formulaCells','[]')) where value->>'sheet'=i->>'sheet' loop
    if pi_gestao_private.ga_range_intersects(coalesce(range_info->>'range',range_info->>'address'),n,n,m,'') then issues:=issues||jsonb_build_array('Fórmula ou mesclagem: conferir original');end if;
   end loop;
   if exists(select 1 from jsonb_each_text(v) z where left(z.value,1)='=') then issues:=issues||jsonb_build_array('Fórmula na origem');end if;
   if mod='rtis' then
    select coalesce(jsonb_agg(r.body||jsonb_build_object('id',r.id)),'[]') into matches from pi_gestao_private.records r where r.tenant_id=t and r.owner_id=o and r.kind='rti' and r.id::text=v->>'tag';
    if jsonb_array_length(matches)=1 then target:=matches->0;else issues:=issues||jsonb_build_array('RTI exige ID existente e origem comprovada; não será criada pela lista');end if;
   else
    typ:=v->>'type';
    if coalesce(v->>'unit','')='' or coalesce(v->>'system','')='' then issues:=issues||jsonb_build_array('Unidade ou sistema ausente');end if;
    if typ is null or typ not in ('linha','segmento','tanque','vaso','caldeira','valvula','outro') or mod='valvulas' and typ<>'valvula' or mod='nr13' and typ not in ('tanque','vaso','caldeira','outro') then issues:=issues||jsonb_build_array('Tipo incompatível com o módulo');end if;
    select coalesce(jsonb_agg(r.body||jsonb_build_object('id',r.id)),'[]') into matches from pi_gestao_private.records r
     join pi_gestao_private.records u on u.tenant_id=r.tenant_id and u.owner_id=r.owner_id and u.id::text=r.body->>'unitId' and u.kind='unit'
     where r.tenant_id=t and r.owner_id=o and r.kind='asset' and lower(btrim(r.body->>'tag'))=lower(v->>'tag') and lower(btrim(u.body->>'name'))=lower(v->>'unit');
    if jsonb_array_length(matches)=1 then
     target:=matches->0;
     if target->>'tag' is distinct from v->>'tag' then issues:=issues||jsonb_build_array('Grafia da TAG diverge do cadastro; conferir identidade');end if;
     if target->>'type' is distinct from typ or not exists(select 1 from pi_gestao_private.records s where s.tenant_id=t and s.owner_id=o and s.id::text=target->>'systemId' and s.body->>'name'=v->>'system') then issues:=issues||jsonb_build_array('Sistema ou tipo diverge do cadastro');end if;
     for k,col in select key,value from jsonb_each_text(v) where key in ('fluid','material','volume','designPressure','temperature','diameter') and value is not null loop
      if nullif(target->>'fluid','') is not null and k='fluid' and target->>'fluid'<>col or target->'values' ? k and target->'values'->>k is distinct from col then issues:=issues||jsonb_build_array('Divergência: '||k);end if;
      if target->'technical'->k->>'value' is not null and (target->'technical'->k->>'value' is distinct from col or k not in ('fluid','material') and target->'technical'->k->>'unit' is distinct from i->'units'->>k) then issues:=issues||jsonb_build_array('Divergência técnica: '||k);end if;
     end loop;
    elsif jsonb_array_length(matches)>1 then issues:=issues||jsonb_build_array('Mais de um cadastro para a identidade');end if;
   end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('row',n,'values',v,'existingId',target->>'id','action',case when jsonb_array_length(issues)>0 then 'review' when target is not null then 'link' else 'new' end,'issues',issues));
  end loop;
  select coalesce(jsonb_agg(case when d.n>1 then z.value||jsonb_build_object('action','review','issues',(z.value->'issues')||jsonb_build_array('Identidade repetida na lista')) else z.value end order by (z.value->>'row')::integer),'[]') into rows
   from jsonb_array_elements(rows) z join (select lower(value->'values'->>'tag') tag,lower(coalesce(value->'values'->>'unit','')) unit,count(*) n from jsonb_array_elements(rows) group by 1,2) d on d.tag is not distinct from lower(z.value->'values'->>'tag') and d.unit=lower(coalesce(z.value->'values'->>'unit',''));
 end if;
 return pi_gestao_private.ga_put(t,o,'document',jsonb_build_object('recordClass','projectPreview','contractId',c->>'id','module',mod,'expectedVersion',c->>'version','input',i,'rows',rows,'createdAt',now(),'createdBy',a,'sourceId',src.id,'sourceName',src.name),a);
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.context(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid:=auth.uid(); m public.pi_company_memberships%rowtype; manager boolean; s jsonb;
begin
 if a is null or p_tenant is null or not pi_access_private.tenants_enabled()
 or not pi_access_private.identity_verified(a) or not pi_access_private.company_active(p_tenant)
 then raise exception 'team_access_denied' using errcode='42501'; end if;
 select * into m from public.pi_company_memberships where company_id=p_tenant and user_id=a;
 if m.user_id is null or m.access_state<>'active' or m.role_name='client'
 or not pi_access_private.member_identity_allowed(a,p_tenant)
 then raise exception 'team_access_denied' using errcode='42501'; end if;
 s:=public.pi_access_status_v3(p_tenant);
 if s->>'status' is distinct from 'active' or s->>'user_id' is distinct from a::text or s->>'company_id' is distinct from p_tenant::text
 then raise exception 'team_license_denied' using errcode='42501'; end if;
 manager:=m.role_name='admin';
 if not manager and not exists(select 1 from pi_team_private.professionals where tenant_id=p_tenant and user_id=a and access_revoked_at is null)
 then raise exception 'team_profile_required' using errcode='42501'; end if;
 return jsonb_build_object('actor',a,'manager',manager,'salary',manager and (pi_access_private.is_master() or exists(select 1 from pi_team_private.salary_managers where tenant_id=p_tenant and user_id=a)), 'tenant',p_tenant);
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.audit_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b jsonb; a jsonb; t uuid; person uuid; ident text;
begin
 if auth.uid() is null then raise exception 'authenticated_author_required' using errcode='42501';end if;
 b:=case when TG_OP<>'INSERT' then to_jsonb(old) end;
 a:=case when TG_OP<>'DELETE' then to_jsonb(new) end;
 t:=(coalesce(a,b)->>'tenant_id')::uuid;
 person:=case when TG_TABLE_NAME='professionals' then (coalesce(a,b)->>'id')::uuid else (coalesce(a,b)->>'professional_id')::uuid end;
 ident:=coalesce(a,b)->>'id';
 insert into pi_team_private.history(tenant_id,professional_id,entity,entity_id,actor_id,action,before_value,after_value)
 values(t,person,TG_TABLE_NAME,coalesce(ident,''),auth.uid(),TG_OP,b,a);
 return coalesce(new,old);
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.person_json(p_tenant uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select to_jsonb(p)||jsonb_build_object(
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('code',c.code,'meaning',c.meaning) order by c.code) from pi_team_private.qualifications q join pi_team_private.qualification_catalog c on c.tenant_id=q.tenant_id and c.id=q.catalog_id where q.tenant_id=p_tenant and q.professional_id=p.id),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.title) from pi_team_private.documents d where d.tenant_id=p_tenant and d.professional_id=p.id),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('project_name',r.body->>'name','client_name',o.name) order by a.starts_on) from pi_team_private.assignments a join pi_gestao_private.records r on r.tenant_id=a.tenant_id and r.owner_id=a.client_id and r.id=a.project_id join pi_gestao_private.owners o on o.tenant_id=a.tenant_id and o.id=a.client_id where a.tenant_id=p_tenant and a.professional_id=p.id),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(to_jsonb(f)-'object_key' order by f.created_at) from pi_team_private.files f where f.tenant_id=p_tenant and f.professional_id=p.id and f.state='stored'),'[]'::jsonb),
 'access',jsonb_build_object('status',case when p.access_revoked_at is not null or m.access_state='revoked' then 'revoked' when p.user_id is null then 'not_created' when m.access_state='active' and pi_access_private.member_identity_allowed(p.user_id,p_tenant) and pi_access_private.company_active(p_tenant) then case when p.login_validated_at is not null then 'login_validated' else 'active' end else 'created' end,'user_id',p.user_id,'license_company_id',case when m.user_id is not null then m.company_id end,'license_scope','company','functional_role',p.functional_role,'signature_permission',case when p.functional_role='engineer_reviewer' and p.exercise then 'exercise_plh_sign_issue' else 'none' end,'professional_authorization','not_verified')
 ) from pi_team_private.professionals p left join public.pi_company_memberships m on m.company_id=p.tenant_id and m.user_id=p.user_id where p.tenant_id=p_tenant and p.id=p_id;
$function$;

CREATE OR REPLACE FUNCTION public.pi_team_api(p_tenant uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select pi_team_private.api(p_tenant,p_action,p_payload) $function$;

CREATE OR REPLACE FUNCTION pi_team_private.api(p_tenant uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb; actor uuid:=auth.uid(); manager boolean; person uuid; rid uuid; before jsonb; result jsonb; payload jsonb:=p_payload;
 p pi_team_private.professionals%rowtype; f pi_team_private.files%rowtype; q pi_team_private.qualifications%rowtype; d pi_team_private.documents%rowtype;
 n integer; key text; label text; new_role text; rec record;
begin
 c:=pi_team_private.context(p_tenant); manager:=(c->>'manager')::boolean;
 if jsonb_typeof(payload) is distinct from 'object' or octet_length(payload::text)>50000 then raise exception 'invalid_payload' using errcode='22023';end if;
 if p_action='status' then return c||jsonb_build_object('organization',(select name from public.pi_companies where id=p_tenant),'stage',1);end if;
 if p_action='list' then
 return c||jsonb_build_object('organization',(select name from public.pi_companies where id=p_tenant),'today',(now() at time zone 'America/Sao_Paulo')::date,
 'professionals',coalesce((select jsonb_agg(pi_team_private.person_json(p_tenant,x.id) order by x.name) from pi_team_private.professionals x where x.tenant_id=p_tenant and (manager or x.user_id=actor)),'[]'::jsonb),
 'catalog',coalesce((select jsonb_agg(to_jsonb(x) order by x.code) from pi_team_private.qualification_catalog x where x.tenant_id=p_tenant),'[]'::jsonb),
 'projects',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'client_id',r.owner_id,'name',r.body->>'name','unit',r.body->>'unit','client_name',o.name) order by o.name,r.body->>'name') from pi_gestao_private.records r join pi_gestao_private.owners o on o.tenant_id=r.tenant_id and o.id=r.owner_id where r.tenant_id=p_tenant and r.kind='contract' and r.body->>'recordClass' is distinct from 'commercial_reference' and (manager or exists(select 1 from pi_team_private.assignments a join pi_team_private.professionals x on x.tenant_id=a.tenant_id and x.id=a.professional_id where a.tenant_id=p_tenant and a.project_id=r.id and a.active and x.user_id=actor))),'[]'::jsonb),
 'clients',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from pi_gestao_private.owners where tenant_id=p_tenant),'[]'::jsonb) else '[]'::jsonb end,
 'requirements',case when manager then coalesce((select jsonb_agg(to_jsonb(x) order by x.title) from pi_team_private.requirements x where x.tenant_id=p_tenant),'[]'::jsonb) else '[]'::jsonb end);
 end if;
 person:=nullif(payload->>'professional_id','')::uuid;
 if p_action in ('person.get','history','file.get') then
 if not pi_team_private.can_person(p_tenant,person) then raise exception 'person_access_denied' using errcode='42501';end if;
 if p_action='person.get' then return pi_team_private.person_json(p_tenant,person);end if;
 if p_action='history' then return coalesce((select jsonb_agg(h order by h.id desc) from (select id,entity,entity_id,actor_id,occurred_at,action,before_value,after_value from pi_team_private.history where tenant_id=p_tenant and professional_id=person order by id desc limit 300) h),'[]'::jsonb);end if;
 select * into f from pi_team_private.files where tenant_id=p_tenant and id=(payload->>'id')::uuid and professional_id=person and state='stored';
 if f.id is null then raise exception 'file_unavailable' using errcode='42501';end if;return to_jsonb(f);
 end if;
 if p_action='salary.list' then
 if c->>'salary' is distinct from 'true' then raise exception 'salary_access_denied' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.integrity_level,x.effective_from desc) from pi_team_private.salary_references x where tenant_id=p_tenant),'[]'::jsonb);
 end if;
 perform pi_access_private.tenant_write_guard();
 if p_action not in ('person.contact','file.reserve','file.complete') and not manager then raise exception 'manager_required' using errcode='42501';end if;
 if p_action='exercise.prepare' then
 -- Deterministic keys + tenant constraint: repeat is a no-op, never resets edited records.
 for n in 1..22 loop
 key:=case when n<=20 then 'IF-'||lpad(n::text,2,'0') else 'EF-'||lpad((n-20)::text,2,'0') end;
 label:=case when n<=20 then 'Inspetor de Fluxo '||lpad(n::text,2,'0') else 'Engenheiro de Fluxo '||lpad((n-20)::text,2,'0') end;
 insert into pi_team_private.professionals(tenant_id,exercise_key,name,job_title,relationship,exercise,functional_role,test_identity,test_registration,created_by,updated_by)
 values(p_tenant,key,label,case when n<=20 then 'Inspetor' else 'Engenheiro' end,'exercise',true,case when n<=20 then 'inspector' else 'engineer_reviewer' end,'TESTE-CPF-'||key,case when n>20 then 'TESTE-CREA-'||key end,actor,actor)
 on conflict(tenant_id,exercise_key) do nothing;
 end loop;
 return jsonb_build_object('prepared',(select count(*) from pi_team_private.professionals where tenant_id=p_tenant and exercise_key in (select 'IF-'||lpad(i::text,2,'0') from generate_series(1,20)i union all select 'EF-'||lpad(i::text,2,'0') from generate_series(1,2)i)),'credentials_created',false);
 elsif p_action='person.save' then
 rid:=coalesce(person,gen_random_uuid());
 if payload ? 'user_id' or payload ? 'login_validated_at' or payload ? 'access' or payload ? 'exercise' or payload ? 'functional_role' then raise exception 'protected_fields' using errcode='42501';end if;
 if person is not null then
 select * into p from pi_team_private.professionals where tenant_id=p_tenant and id=person for update;
 if p.id is null then raise exception 'person_access_denied' using errcode='42501';end if;
 if p.version is distinct from (payload->>'version')::integer then raise exception 'version_conflict' using errcode='40001';end if;
 end if;
 if nullif(payload->>'integrity_level','') is not null and nullif(btrim(payload->>'integrity_basis'),'') is null then raise exception 'classification_basis_required' using errcode='22023';end if;
 if p.exercise and payload->>'technical_state'='verified' then raise exception 'exercise_is_not_professional_authorization' using errcode='22023';end if;
 insert into pi_team_private.professionals(tenant_id,id,name,job_title,relationship,professional_email,professional_phone,integrity_level,integrity_basis,registration_state,availability,availability_note,technical_state,technical_basis,created_by,updated_by)
 values(p_tenant,rid,btrim(payload->>'name'),nullif(btrim(payload->>'job_title'),''),nullif(payload->>'relationship',''),nullif(btrim(payload->>'professional_email'),''),nullif(btrim(payload->>'professional_phone'),''),nullif(payload->>'integrity_level','')::smallint,nullif(btrim(payload->>'integrity_basis'),''),coalesce(nullif(payload->>'registration_state',''),'active'),nullif(payload->>'availability',''),nullif(btrim(payload->>'availability_note'),''),nullif(payload->>'technical_state',''),nullif(btrim(payload->>'technical_basis'),''),actor,actor)
 on conflict(tenant_id,id) do update set name=excluded.name,job_title=excluded.job_title,relationship=case when p.exercise then 'exercise' else excluded.relationship end,professional_email=excluded.professional_email,professional_phone=excluded.professional_phone,integrity_level=excluded.integrity_level,integrity_basis=excluded.integrity_basis,registration_state=excluded.registration_state,availability=excluded.availability,availability_note=excluded.availability_note,technical_state=excluded.technical_state,technical_basis=excluded.technical_basis,updated_by=actor,updated_at=now(),version=p.version+1;
 return pi_team_private.person_json(p_tenant,rid);
 elsif p_action='person.contact' then
 if not pi_team_private.can_person(p_tenant,person) then raise exception 'person_access_denied' using errcode='42501';end if;
 update pi_team_private.professionals set professional_email=nullif(btrim(payload->>'professional_email'),''),professional_phone=nullif(btrim(payload->>'professional_phone'),''),updated_by=actor,updated_at=now(),version=version+1 where tenant_id=p_tenant and id=person and version=(payload->>'version')::integer returning id into rid;
 if rid is null then raise exception 'version_conflict' using errcode='40001';end if;
 return pi_team_private.person_json(p_tenant,person);
 elsif p_action='catalog.save' then
 rid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from pi_team_private.qualification_catalog where tenant_id=p_tenant and id=rid and (code is distinct from btrim(payload->>'code') or meaning is distinct from btrim(payload->>'meaning')))
 and exists(select 1 from pi_team_private.qualifications where tenant_id=p_tenant and catalog_id=rid) then raise exception 'used_meaning_is_immutable_create_new_code' using errcode='22023';end if;
 insert into pi_team_private.qualification_catalog(tenant_id,id,code,meaning,active) values(p_tenant,rid,btrim(payload->>'code'),btrim(payload->>'meaning'),coalesce((payload->>'active')::boolean,true))
 on conflict(tenant_id,id) do update set code=excluded.code,meaning=excluded.meaning,active=excluded.active,version=pi_team_private.qualification_catalog.version+1;
 return jsonb_build_object('id',rid);
 elsif p_action in ('qualification.save','document.save') then
 if not pi_team_private.can_person(p_tenant,person,true) then raise exception 'person_access_denied' using errcode='42501';end if;
 rid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if nullif(payload->>'file_id','') is not null and not exists(select 1 from pi_team_private.files where tenant_id=p_tenant and id=(payload->>'file_id')::uuid and professional_id=person and state='stored' and purpose=case when p_action='qualification.save' then 'qualification' else 'document' end) then raise exception 'proof_must_belong_to_person' using errcode='42501';end if;
 if payload->>'verification'='checked' and (nullif(payload->>'file_id','') is null or nullif(btrim(payload->>'verification_note'),'') is null) then raise exception 'evidence_and_check_note_required' using errcode='22023';end if;
 if p_action='qualification.save' then
 select * into q from pi_team_private.qualifications where tenant_id=p_tenant and id=rid for update;
 if q.id is not null and (q.professional_id<>person or q.version is distinct from (payload->>'version')::integer) then raise exception 'version_or_owner_conflict' using errcode='40001';end if;
 insert into pi_team_private.qualifications(tenant_id,id,professional_id,catalog_id,method,qualification_level,scope,certifier,certificate_number,valid_until,verification,verification_note,proof_file_id)
 values(p_tenant,rid,person,(payload->>'catalog_id')::uuid,nullif(btrim(payload->>'method'),''),nullif(btrim(payload->>'qualification_level'),''),nullif(btrim(payload->>'scope'),''),nullif(btrim(payload->>'certifier'),''),nullif(btrim(payload->>'certificate_number'),''),nullif(payload->>'valid_until','')::date,coalesce(nullif(payload->>'verification',''),'not_informed'),nullif(btrim(payload->>'verification_note'),''),nullif(payload->>'file_id','')::uuid)
 on conflict(tenant_id,id) do update set catalog_id=excluded.catalog_id,method=excluded.method,qualification_level=excluded.qualification_level,scope=excluded.scope,certifier=excluded.certifier,certificate_number=excluded.certificate_number,valid_until=excluded.valid_until,verification=excluded.verification,verification_note=excluded.verification_note,proof_file_id=excluded.proof_file_id,version=q.version+1;
 else
 select * into d from pi_team_private.documents where tenant_id=p_tenant and id=rid for update;
 if d.id is not null and (d.professional_id<>person or d.version is distinct from (payload->>'version')::integer) then raise exception 'version_or_owner_conflict' using errcode='40001';end if;
 insert into pi_team_private.documents(tenant_id,id,professional_id,title,kind,activity,client_id,unit,issuer,valid_until,verification,verification_note,file_id)
 values(p_tenant,rid,person,btrim(payload->>'title'),payload->>'kind',nullif(btrim(payload->>'activity'),''),nullif(payload->>'client_id','')::uuid,nullif(btrim(payload->>'unit'),''),nullif(btrim(payload->>'issuer'),''),nullif(payload->>'valid_until','')::date,coalesce(nullif(payload->>'verification',''),'not_informed'),nullif(btrim(payload->>'verification_note'),''),nullif(payload->>'file_id','')::uuid)
 on conflict(tenant_id,id) do update set title=excluded.title,kind=excluded.kind,activity=excluded.activity,client_id=excluded.client_id,unit=excluded.unit,issuer=excluded.issuer,valid_until=excluded.valid_until,verification=excluded.verification,verification_note=excluded.verification_note,file_id=excluded.file_id,version=d.version+1;
 end if;
 return jsonb_build_object('id',rid);
 elsif p_action='file.reserve' then
 if not pi_team_private.can_person(p_tenant,person) then raise exception 'person_access_denied' using errcode='42501';end if;
 rid:=gen_random_uuid();
 if payload->>'purpose'='avatar' and payload->>'mime' not in ('image/jpeg','image/png') then raise exception 'invalid_avatar' using errcode='22023';end if;
 insert into pi_team_private.files(tenant_id,id,professional_id,name,object_key,mime,byte_size,purpose,created_by)
 values(p_tenant,rid,person,payload->>'name',p_tenant||'/'||person||'/'||rid,payload->>'mime',(payload->>'byte_size')::bigint,payload->>'purpose',actor) returning * into f;
 return to_jsonb(f);
 elsif p_action='file.complete' then
 if not pi_team_private.can_person(p_tenant,person) then raise exception 'person_access_denied' using errcode='42501';end if;
 select * into f from pi_team_private.files where tenant_id=p_tenant and professional_id=person and id=(payload->>'id')::uuid for update;
 if f.id is null or f.state='archived' then raise exception 'file_unavailable' using errcode='42501';end if;
 if not exists(select 1 from storage.objects where bucket_id='pi-team-private' and name=f.object_key and (metadata->>'size')::bigint=f.byte_size and metadata->>'mimetype'=f.mime) then raise exception 'stored_file_not_confirmed' using errcode='22023';end if;
 if f.state='reserved' then update pi_team_private.files set state='stored' where tenant_id=p_tenant and id=f.id;end if;
 if f.purpose='avatar' then update pi_team_private.professionals set avatar_file_id=f.id,version=version+1,updated_by=actor,updated_at=now() where tenant_id=p_tenant and id=person;end if;
 return jsonb_build_object('id',f.id,'state','stored');
 elsif p_action='assignment.save' then
 if not pi_team_private.can_person(p_tenant,person,true) then raise exception 'person_access_denied' using errcode='42501';end if;
 if not exists(select 1 from pi_gestao_private.records where tenant_id=p_tenant and owner_id=(payload->>'client_id')::uuid and id=(payload->>'project_id')::uuid and kind='contract' and body->>'recordClass' is distinct from 'commercial_reference') then raise exception 'project_not_in_organization' using errcode='42501';end if;
 rid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 if exists(select 1 from pi_team_private.assignments where tenant_id=p_tenant and id=rid and professional_id<>person) then raise exception 'assignment_owner_conflict' using errcode='42501';end if;
 insert into pi_team_private.assignments(tenant_id,id,professional_id,client_id,project_id,activity,starts_on,ends_on,active)
 values(p_tenant,rid,person,(payload->>'client_id')::uuid,(payload->>'project_id')::uuid,nullif(btrim(payload->>'activity'),''),nullif(payload->>'starts_on','')::date,nullif(payload->>'ends_on','')::date,coalesce((payload->>'active')::boolean,true))
 on conflict(tenant_id,id) do update set client_id=excluded.client_id,project_id=excluded.project_id,activity=excluded.activity,starts_on=excluded.starts_on,ends_on=excluded.ends_on,active=excluded.active;
 return jsonb_build_object('id',rid);
 elsif p_action='requirement.save' then
 rid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
 insert into pi_team_private.requirements(tenant_id,id,title,activity,client_id,unit,basis,active)
 values(p_tenant,rid,btrim(payload->>'title'),nullif(btrim(payload->>'activity'),''),nullif(payload->>'client_id','')::uuid,nullif(btrim(payload->>'unit'),''),btrim(payload->>'basis'),coalesce((payload->>'active')::boolean,true))
 on conflict(tenant_id,id) do update set title=excluded.title,activity=excluded.activity,client_id=excluded.client_id,unit=excluded.unit,basis=excluded.basis,active=excluded.active;
 return jsonb_build_object('id',rid);
 elsif p_action='salary.save' then
 if c->>'salary' is distinct from 'true' or payload->>'confirm' is distinct from 'true' then raise exception 'salary_authorization_required' using errcode='42501';end if;
 insert into pi_team_private.salary_references(tenant_id,integrity_level,amount_cents,effective_from,reason,created_by)
 values(p_tenant,(payload->>'integrity_level')::smallint,(payload->>'amount_cents')::bigint,(payload->>'effective_from')::date,btrim(payload->>'reason'),actor) returning id into rid;
 return jsonb_build_object('id',rid);
 elsif p_action='access.bind' then
 -- Binds only an existing accepted identity and its existing company license.
 -- Never creates a user, sends a message, activates membership or changes seats.
 if not pi_access_private.is_master() then raise exception 'master_required' using errcode='42501';end if;
 select * into p from pi_team_private.professionals where tenant_id=p_tenant and id=person for update;
 rid:=(payload->>'user_id')::uuid;
 if p.id is null or p.user_id is not null and p.user_id<>rid then raise exception 'profile_binding_conflict' using errcode='40001';end if;
 if not exists(select 1 from public.pi_company_memberships where company_id=p_tenant and user_id=rid and role_name=case when p.functional_role='engineer_reviewer' then 'assistant' else 'inspector' end) then raise exception 'individual_membership_required' using errcode='42501';end if;
 update pi_team_private.professionals set user_id=rid,version=version+1,updated_by=actor,updated_at=now() where tenant_id=p_tenant and id=person;
 return pi_team_private.person_json(p_tenant,person);
 elsif p_action='access.revoke' then
 if not pi_team_private.can_person(p_tenant,person,true) then raise exception 'person_access_denied' using errcode='42501';end if;
 select * into p from pi_team_private.professionals where tenant_id=p_tenant and id=person for update;
 if p.user_id is null then raise exception 'access_not_created' using errcode='22023';end if;
 perform pi_access_private.membership_change(p.user_id,p_tenant,'deactivate',payload->>'reason');
 update pi_team_private.professionals set access_revoked_at=now(),updated_at=now(),updated_by=actor,version=version+1 where tenant_id=p_tenant and id=person;
 return pi_team_private.person_json(p_tenant,person);
 end if;
 raise exception 'unsupported_team_action' using errcode='22023';
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.file_allowed(p_name text, p_write boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare f pi_team_private.files%rowtype;
begin
 if auth.uid() is null then return false;end if;
 select * into f from pi_team_private.files where object_key=p_name;
 if f.id is null or not pi_team_private.can_person(f.tenant_id,f.professional_id) then return false;end if;
 return case when p_write then f.state='reserved' and f.created_by=auth.uid() else f.state='stored' end;
end $function$;

CREATE OR REPLACE FUNCTION pi_team_private.legacy_assessment_allowed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and not exists (
  select 1 from pi_team_private.professionals p
  where p.user_id=auth.uid() and p.exercise
 );
$function$;

alter table "pi_access_private"."invitations" alter column "id" set default gen_random_uuid();

alter table "pi_access_private"."invitations" alter column "invitation_state" set default 'prepared'::text;

alter table "pi_access_private"."invitations" alter column "delivery" set default 'email'::text;

alter table "pi_access_private"."invitations" alter column "created_at" set default clock_timestamp();

alter table "pi_access_private"."invitations" alter column "expires_at" set default (clock_timestamp() + '168:00:00'::interval);

alter table "pi_access_private"."invitations" alter column "trial_days" set default 7;

alter table "pi_access_private"."accounts" alter column "access_state" set default 'pending'::text;

alter table "pi_access_private"."accounts" alter column "access_kind" set default 'trial'::text;

alter table "pi_access_private"."accounts" alter column "trial_days" set default 7;

alter table "public"."pi_assessments" alter column "id" set default gen_random_uuid();

alter table "public"."pi_assessments" alter column "user_id" set default auth.uid();

alter table "public"."pi_assessments" alter column "created_at" set default now();

alter table "public"."pi_companies" alter column "id" set default gen_random_uuid();

alter table "public"."pi_companies" alter column "created_at" set default now();

alter table "public"."pi_company_memberships" alter column "created_at" set default now();

alter table "public"."pi_company_memberships" alter column "access_state" set default 'pending'::text;

alter table "pi_access_private"."admin_changes" alter column "id" set default gen_random_uuid();

alter table "pi_access_private"."admin_changes" alter column "occurred_at" set default clock_timestamp();

alter table "pi_access_private"."masters" alter column "granted_at" set default now();

alter table "pi_access_private"."activity" alter column "id" set default gen_random_uuid();

alter table "pi_access_private"."activity" alter column "occurred_at" set default clock_timestamp();

alter table "pi_access_private"."activity" alter column "source" set default 'server'::text;

alter table "pi_access_private"."tenant_rollout" alter column "singleton" set default true;

alter table "pi_access_private"."tenant_rollout" alter column "enabled" set default false;

alter table "pi_access_private"."tenant_rollout" alter column "writes_paused" set default false;

alter table "pi_access_private"."company_licenses" alter column "license_state" set default 'draft'::text;

alter table "pi_access_private"."company_licenses" alter column "seats_used" set default 0;

alter table "pi_access_private"."company_licenses" alter column "revision" set default 0;

alter table "pi_access_private"."tenant_changes" alter column "id" set default gen_random_uuid();

alter table "pi_access_private"."tenant_changes" alter column "occurred_at" set default clock_timestamp();

alter table "pi_access_private"."company_seat_exemptions" alter column "created_at" set default clock_timestamp();

alter table "pi_access_private"."access_requests" alter column "id" set default gen_random_uuid();

alter table "pi_access_private"."access_requests" alter column "request_state" set default 'pending'::text;

alter table "pi_access_private"."access_requests" alter column "created_at" set default clock_timestamp();

alter table "pi_billing_private"."bindings" alter column "id" set default gen_random_uuid();

alter table "pi_billing_private"."bindings" alter column "created_at" set default clock_timestamp();

alter table "pi_billing_private"."inbox" alter column "conflict" set default false;

alter table "pi_billing_private"."inbox" alter column "received_at" set default clock_timestamp();

alter table "pi_billing_private"."event_conflicts" alter column "created_at" set default clock_timestamp();

alter table "pi_billing_private"."jobs" alter column "page_offset" set default 0;

alter table "pi_billing_private"."jobs" alter column "state" set default 'pending'::text;

alter table "pi_billing_private"."jobs" alter column "attempts" set default 0;

alter table "pi_billing_private"."jobs" alter column "next_attempt" set default clock_timestamp();

alter table "pi_billing_private"."jobs" alter column "created_at" set default clock_timestamp();

alter table "pi_billing_private"."observations" alter column "observed_at" set default clock_timestamp();

alter table "pi_billing_private"."observations" alter column "financial_effects" set default false;

alter table "pi_billing_private"."audit" alter column "occurred_at" set default clock_timestamp();

alter table "pi_billing_private"."audit" alter column "details" set default '{}'::jsonb;

alter table "pi_gestao_private"."pilot_access" alter column "granted_at" set default now();

alter table "pi_gestao_private"."record_relations" alter column "created_at" set default now();

alter table "pi_gestao_private"."owners" alter column "id" set default gen_random_uuid();

alter table "pi_gestao_private"."owners" alter column "created_at" set default now();


alter table "pi_gestao_private"."records" alter column "id" set default gen_random_uuid();

alter table "pi_gestao_private"."records" alter column "version" set default 1;

alter table "pi_gestao_private"."sources" alter column "created_at" set default now();

alter table "pi_gestao_private"."previews" alter column "id" set default gen_random_uuid();

alter table "pi_gestao_private"."previews" alter column "consumed" set default false;

alter table "pi_gestao_private"."previews" alter column "created_at" set default now();

alter table "pi_gestao_private"."audit" alter column "at" set default now();

alter table "pi_gestao_private"."operation_receipts" alter column "created_at" set default now();

alter table "pi_team_private"."professionals" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."professionals" alter column "registration_state" set default 'active'::text;

alter table "pi_team_private"."professionals" alter column "exercise" set default false;

alter table "pi_team_private"."professionals" alter column "functional_role" set default 'inspector'::text;

alter table "pi_team_private"."professionals" alter column "version" set default 1;

alter table "pi_team_private"."professionals" alter column "created_at" set default now();

alter table "pi_team_private"."professionals" alter column "updated_at" set default now();

alter table "pi_team_private"."qualification_catalog" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."qualification_catalog" alter column "active" set default true;

alter table "pi_team_private"."qualification_catalog" alter column "version" set default 1;

alter table "pi_team_private"."qualifications" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."qualifications" alter column "verification" set default 'not_informed'::text;

alter table "pi_team_private"."qualifications" alter column "version" set default 1;

alter table "pi_team_private"."documents" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."documents" alter column "verification" set default 'not_informed'::text;

alter table "pi_team_private"."documents" alter column "version" set default 1;

alter table "pi_team_private"."files" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."files" alter column "state" set default 'reserved'::text;

alter table "pi_team_private"."files" alter column "created_at" set default now();

alter table "pi_team_private"."assignments" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."assignments" alter column "active" set default true;

alter table "pi_team_private"."requirements" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."requirements" alter column "active" set default true;

alter table "pi_team_private"."salary_references" alter column "id" set default gen_random_uuid();

alter table "pi_team_private"."salary_references" alter column "created_at" set default now();

alter table "pi_team_private"."history" alter column "occurred_at" set default now();

alter table "pi_access_private"."invitations" add constraint "invitations_check" CHECK (expires_at > created_at);

alter table "pi_access_private"."invitations" add constraint "invitations_check1" CHECK ((invitation_state <> ALL (ARRAY['offered'::text, 'sent'::text, 'accepted'::text])) OR auth_user_id IS NOT NULL);

alter table "pi_access_private"."invitations" add constraint "invitations_check2" CHECK (delivery = 'in_app'::text AND auth_user_id IS NOT NULL AND sent_at IS NULL AND (invitation_state = ANY (ARRAY['offered'::text, 'accepted'::text, 'revoked'::text])) OR delivery = 'email'::text AND (invitation_state = ANY (ARRAY['prepared'::text, 'sent'::text, 'accepted'::text, 'revoked'::text])) AND ((invitation_state <> ALL (ARRAY['sent'::text, 'accepted'::text])) OR sent_at IS NOT NULL));

alter table "pi_access_private"."invitations" add constraint "invitations_check3" CHECK (invitation_state <> 'accepted'::text OR accepted_at IS NOT NULL);

alter table "pi_access_private"."invitations" add constraint "invitations_delivery_check" CHECK (delivery = ANY (ARRAY['email'::text, 'in_app'::text]));

alter table "pi_access_private"."invitations" add constraint "invitations_email_check" CHECK (email = lower(btrim(email)) AND char_length(email) >= 3 AND char_length(email) <= 254);

alter table "pi_access_private"."invitations" add constraint "invitations_invitation_state_check" CHECK (invitation_state = ANY (ARRAY['prepared'::text, 'offered'::text, 'sent'::text, 'accepted'::text, 'revoked'::text]));

alter table "pi_access_private"."invitations" add constraint "invitations_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."invitations" add constraint "invitations_role_name_check" CHECK (role_name = ANY (ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text, 'client'::text]));

alter table "pi_access_private"."invitations" add constraint "invitations_trial_days_check" CHECK (trial_days >= 1 AND trial_days <= 90);

alter table "pi_access_private"."accounts" add constraint "accounts_access_kind_check" CHECK (access_kind = ANY (ARRAY['trial'::text, 'standard'::text]));

alter table "pi_access_private"."accounts" add constraint "accounts_access_state_check" CHECK (access_state = ANY (ARRAY['pending'::text, 'approved'::text, 'revoked'::text]));

alter table "pi_access_private"."accounts" add constraint "accounts_check1" CHECK (access_state <> 'approved'::text OR access_kind = 'standard'::text OR activated_at IS NOT NULL);

alter table "pi_access_private"."accounts" add constraint "accounts_pkey" PRIMARY KEY (user_id);

alter table "pi_access_private"."accounts" add constraint "accounts_trial_days_check" CHECK (trial_days >= 1 AND trial_days <= 90);

alter table "pi_access_private"."accounts" add constraint "pi_trial_period_valid" CHECK (access_kind = 'trial'::text AND (activated_at IS NULL AND expires_at IS NULL OR activated_at IS NOT NULL AND expires_at IS NOT NULL AND expires_at > activated_at AND expires_at <= (activated_at + '8760:00:00'::interval)) OR access_kind = 'standard'::text AND expires_at IS NULL);

alter table "public"."pi_assessments" add constraint "pi_assessments_app_version_check" CHECK (char_length(app_version) >= 1 AND char_length(app_version) <= 32);

alter table "public"."pi_assessments" add constraint "pi_assessments_kind_check" CHECK (kind = ANY (ARRAY['life'::text, 'pmta'::text, 'risk'::text]));

alter table "public"."pi_assessments" add constraint "pi_assessments_payload_check" CHECK (jsonb_typeof(payload) = 'object'::text AND octet_length(payload::text) <= 524288);

alter table "public"."pi_assessments" add constraint "pi_assessments_pkey" PRIMARY KEY (id);

alter table "public"."pi_assessments" add constraint "pi_assessments_report_text_check" CHECK (octet_length(report_text) <= 220000);

alter table "public"."pi_assessments" add constraint "pi_assessments_title_check" CHECK (char_length(btrim(title)) >= 1 AND char_length(btrim(title)) <= 180);

alter table "public"."pi_companies" add constraint "pi_companies_name_check" CHECK (char_length(btrim(name)) >= 1 AND char_length(btrim(name)) <= 180);

alter table "public"."pi_companies" add constraint "pi_companies_pkey" PRIMARY KEY (id);

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_access_state_check" CHECK (access_state = ANY (ARRAY['pending'::text, 'active'::text, 'revoked'::text]));

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_pkey" PRIMARY KEY (company_id, user_id);

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_role_name_check" CHECK (role_name = ANY (ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text, 'client'::text]));

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_event_check" CHECK (event = ANY (ARRAY['company_created'::text, 'company_edited'::text, 'trial_planned'::text, 'trial_extended'::text]));

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_reason_check" CHECK (reason IS NULL OR char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 500);

alter table "pi_access_private"."masters" add constraint "masters_pkey" PRIMARY KEY (user_id);

alter table "pi_access_private"."activity" add constraint "activity_context_check" CHECK (context IS NULL OR context = 'app_entry'::text);

alter table "pi_access_private"."activity" add constraint "activity_event_check" CHECK (event = ANY (ARRAY['invite_prepared'::text, 'invite_offered'::text, 'invite_sent'::text, 'invite_accepted'::text, 'access_approved'::text, 'access_revoked'::text, 'assessment_created'::text, 'assessment_deleted'::text, 'session_opened'::text]));

alter table "pi_access_private"."activity" add constraint "activity_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."activity" add constraint "activity_source_check" CHECK (source = ANY (ARRAY['server'::text, 'client_signal'::text]));

alter table "pi_access_private"."tenant_rollout" add constraint "tenant_rollout_pkey" PRIMARY KEY (singleton);

alter table "pi_access_private"."tenant_rollout" add constraint "tenant_rollout_singleton_check" CHECK (singleton);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_check" CHECK (seat_limit IS NULL OR seats_used <= seat_limit);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_check1" CHECK (plan_kind IS DISTINCT FROM 'trial'::text OR initial_days <= 90);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_check2" CHECK (plan_kind = 'indefinite'::text AND initial_days IS NULL AND expires_at IS NULL OR plan_kind IS DISTINCT FROM 'indefinite'::text AND (activated_at IS NULL AND expires_at IS NULL OR activated_at IS NOT NULL AND expires_at > activated_at));

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_check3" CHECK (migration_state <> 'ready'::text OR seat_limit IS NOT NULL AND (initial_days IS NOT NULL OR plan_kind = 'indefinite'::text) AND plan_kind IS NOT NULL);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_check4" CHECK (license_state <> 'active'::text OR migration_state = 'ready'::text AND activated_at IS NOT NULL);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_initial_days_check" CHECK (initial_days >= 1 AND initial_days <= 365);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_license_state_check" CHECK (license_state = ANY (ARRAY['draft'::text, 'active'::text, 'suspended'::text]));

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_migration_state_check" CHECK (migration_state = ANY (ARRAY['review_required'::text, 'new'::text, 'ready'::text]));

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_pkey" PRIMARY KEY (company_id);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_plan_kind_check" CHECK (plan_kind = ANY (ARRAY['trial'::text, 'term'::text, 'indefinite'::text]));

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_seat_limit_check" CHECK (seat_limit >= 0);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_seats_used_check" CHECK (seats_used >= 0);

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_event_check" CHECK (event = ANY (ARRAY['license_configured'::text, 'license_started'::text, 'license_extended'::text, 'license_suspended'::text, 'license_resumed'::text, 'membership_activated'::text, 'membership_deactivated'::text, 'company_named'::text, 'mapping_resolved'::text]));

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_reason_check" CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 500);

alter table "pi_access_private"."company_seat_exemptions" add constraint "company_seat_exemptions_pkey" PRIMARY KEY (company_id, user_id);

alter table "pi_access_private"."access_requests" add constraint "access_requests_applicant_kind_check" CHECK (applicant_kind = ANY (ARRAY['individual'::text, 'company'::text]));

alter table "pi_access_private"."access_requests" add constraint "access_requests_check" CHECK (applicant_kind <> 'individual'::text OR requested_seats = 1);

alter table "pi_access_private"."access_requests" add constraint "access_requests_check1" CHECK (request_state = 'pending'::text AND company_id IS NULL AND decided_at IS NULL AND decided_by IS NULL OR request_state = 'approved'::text AND company_id IS NOT NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL OR request_state = 'rejected'::text AND company_id IS NULL AND decided_at IS NOT NULL AND decided_by IS NOT NULL);

alter table "pi_access_private"."access_requests" add constraint "access_requests_company_name_check" CHECK (char_length(company_name) >= 2 AND char_length(company_name) <= 160);

alter table "pi_access_private"."access_requests" add constraint "access_requests_full_name_check" CHECK (char_length(full_name) >= 2 AND char_length(full_name) <= 120);

alter table "pi_access_private"."access_requests" add constraint "access_requests_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."access_requests" add constraint "access_requests_request_state_check" CHECK (request_state = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

alter table "pi_access_private"."access_requests" add constraint "access_requests_requested_seats_check" CHECK (requested_seats >= 1 AND requested_seats <= 999);

alter table "pi_access_private"."access_requests" add constraint "access_requests_user_id_key" UNIQUE (user_id);

alter table "pi_billing_private"."bindings" add constraint "bindings_check" CHECK (payer_kind = 'CPF'::text AND quantity = 1 AND owner_id IS NOT NULL OR payer_kind = 'CNPJ'::text AND owner_id IS NULL);

alter table "pi_billing_private"."bindings" add constraint "bindings_payer_kind_check" CHECK (payer_kind = ANY (ARRAY['CPF'::text, 'CNPJ'::text]));

alter table "pi_billing_private"."bindings" add constraint "bindings_pkey" PRIMARY KEY (id);

alter table "pi_billing_private"."bindings" add constraint "bindings_provider_customer_check" CHECK (provider_customer ~ '^cus_[A-Za-z0-9_-]{1,180}$'::text);

alter table "pi_billing_private"."bindings" add constraint "bindings_provider_subscription_check" CHECK (provider_subscription ~ '^sub_[A-Za-z0-9_-]{1,180}$'::text);

alter table "pi_billing_private"."bindings" add constraint "bindings_provider_subscription_key" UNIQUE (provider_subscription);

alter table "pi_billing_private"."bindings" add constraint "bindings_quantity_check" CHECK (quantity >= 1 AND quantity <= 999);

alter table "pi_billing_private"."inbox" add constraint "inbox_event_check" CHECK (event ~ '^(PAYMENT|SUBSCRIPTION)_[A-Z_]{1,80}$'::text);

alter table "pi_billing_private"."inbox" add constraint "inbox_event_id_check" CHECK (event_id ~ '^evt_[A-Za-z0-9_&-]{1,180}$'::text);

alter table "pi_billing_private"."inbox" add constraint "inbox_fingerprint_check" CHECK (fingerprint ~ '^[a-f0-9]{64}$'::text);

alter table "pi_billing_private"."inbox" add constraint "inbox_kind_check" CHECK (kind = ANY (ARRAY['payment'::text, 'subscription'::text]));

alter table "pi_billing_private"."inbox" add constraint "inbox_pkey" PRIMARY KEY (event_id);

alter table "pi_billing_private"."inbox" add constraint "inbox_projection_check" CHECK (octet_length(projection::text) <= 4096);

alter table "pi_billing_private"."event_conflicts" add constraint "event_conflicts_fingerprint_check" CHECK (fingerprint ~ '^[a-f0-9]{64}$'::text);

alter table "pi_billing_private"."event_conflicts" add constraint "event_conflicts_pkey" PRIMARY KEY (event_id, fingerprint);

alter table "pi_billing_private"."jobs" add constraint "jobs_attempts_check" CHECK (attempts >= 0 AND attempts <= 5);

alter table "pi_billing_private"."jobs" add constraint "jobs_check" CHECK (state = 'processing'::text AND lease IS NOT NULL AND lease_until IS NOT NULL OR state <> 'processing'::text AND lease IS NULL AND lease_until IS NULL);

alter table "pi_billing_private"."jobs" add constraint "jobs_dedupe_key_key" UNIQUE (dedupe_key);

alter table "pi_billing_private"."jobs" add constraint "jobs_kind_check" CHECK (kind = ANY (ARRAY['payment'::text, 'subscription'::text, 'scan'::text]));

alter table "pi_billing_private"."jobs" add constraint "jobs_page_offset_check" CHECK (page_offset >= 0 AND page_offset <= 100000);

alter table "pi_billing_private"."jobs" add constraint "jobs_pkey" PRIMARY KEY (id);

alter table "pi_billing_private"."jobs" add constraint "jobs_state_check" CHECK (state = ANY (ARRAY['pending'::text, 'processing'::text, 'retry'::text, 'review'::text, 'done'::text]));

alter table "pi_billing_private"."observations" add constraint "observations_financial_effects_check" CHECK (NOT financial_effects);

alter table "pi_billing_private"."observations" add constraint "observations_job_id_key" UNIQUE (job_id);

alter table "pi_billing_private"."observations" add constraint "observations_pkey" PRIMARY KEY (id);

alter table "pi_billing_private"."observations" add constraint "observations_snapshot_check" CHECK (octet_length(snapshot::text) <= 4096);

alter table "pi_billing_private"."audit" add constraint "audit_details_check" CHECK (octet_length(details::text) <= 4096);

alter table "pi_billing_private"."audit" add constraint "audit_pkey" PRIMARY KEY (id);

alter table "pi_billing_private"."catalog" add constraint "catalog_id_check" CHECK (id = 'calculadora-mensal'::text);

alter table "pi_billing_private"."catalog" add constraint "catalog_pkey" PRIMARY KEY (id);

alter table "pi_billing_private"."catalog" add constraint "catalog_revision_check" CHECK (revision = 1);

alter table "pi_billing_private"."catalog" add constraint "catalog_state_check" CHECK (state = 'draft'::text);

alter table "pi_gestao_private"."pilot_access" add constraint "pilot_access_check" CHECK (expires_at IS NULL OR expires_at > granted_at);

alter table "pi_gestao_private"."pilot_access" add constraint "pilot_access_pkey" PRIMARY KEY (tenant_id, user_id);

alter table "pi_gestao_private"."pilot_access" add constraint "pilot_access_reason_check" CHECK (length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000);

alter table "pi_gestao_private"."record_origins" add constraint "record_origins_pkey" PRIMARY KEY (tenant_id, owner_id, kind, origin_key);

alter table "pi_gestao_private"."record_relations" add constraint "record_relations_check" CHECK (from_id <> to_id);

alter table "pi_gestao_private"."record_relations" add constraint "record_relations_check1" CHECK (from_kind = 'contract'::text AND to_kind = 'asset'::text AND relation_type = 'scope_asset'::text OR from_kind = 'campaign'::text AND to_kind = 'contract'::text AND relation_type = 'under_contract'::text OR from_kind = 'campaign'::text AND to_kind = 'asset'::text AND relation_type = 'campaign_asset'::text OR from_kind = 'inspection'::text AND to_kind = 'campaign'::text AND relation_type = 'in_campaign'::text OR from_kind = 'inspection'::text AND to_kind = 'asset'::text AND relation_type = 'inspects'::text OR from_kind = 'lvt'::text AND to_kind = 'inspection'::text AND relation_type = 'records_inspection'::text OR from_kind = 'lvt'::text AND to_kind = 'document'::text AND relation_type = 'original_document'::text OR from_kind = 'lvt_item'::text AND to_kind = 'lvt'::text AND relation_type = 'part_of_lvt'::text OR from_kind = 'photo'::text AND to_kind = 'lvt_item'::text AND relation_type = 'illustrates_item'::text OR from_kind = 'finding'::text AND to_kind = 'lvt_item'::text AND relation_type = 'found_in_item'::text OR from_kind = 'finding'::text AND to_kind = 'lvt'::text AND relation_type = 'found_in'::text OR from_kind = 'finding'::text AND to_kind = 'asset'::text AND relation_type = 'affects'::text OR from_kind = 'rti'::text AND to_kind = 'lvt_item'::text AND relation_type = 'addresses_item'::text OR from_kind = 'rti'::text AND to_kind = 'finding'::text AND relation_type = 'addresses'::text OR from_kind = 'rti'::text AND to_kind = 'document'::text AND relation_type = 'opening_document'::text OR from_kind = 'rti'::text AND to_kind = 'document'::text AND relation_type = 'recommendation_document'::text OR from_kind = 'rti'::text AND to_kind = 'asset'::text AND relation_type = 'affects'::text OR from_kind = 'document'::text AND to_kind = 'asset'::text AND relation_type = 'documents_asset'::text OR from_kind = 'document'::text AND to_kind = 'campaign'::text AND relation_type = 'in_campaign'::text);

alter table "pi_gestao_private"."record_relations" add constraint "record_relations_pkey" PRIMARY KEY (tenant_id, owner_id, from_id, to_id, relation_type);

alter table "pi_gestao_private"."owners" add constraint "owners_name_check" CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 200);

alter table "pi_gestao_private"."owners" add constraint "owners_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_gestao_private"."owners" add constraint "owners_source_check" CHECK (length(btrim(source)) >= 1 AND length(btrim(source)) <= 2000);

alter table "pi_gestao_private"."owners" add constraint "owners_tenant_id_name_key_key" UNIQUE (tenant_id, name_key);

alter table "pi_gestao_private"."records" add constraint "records_body_check" CHECK (jsonb_typeof(body) = 'object'::text);

alter table "pi_gestao_private"."records" add constraint "records_kind_check" CHECK (kind = ANY (ARRAY['unit'::text, 'system'::text, 'asset'::text, 'contract'::text, 'campaign'::text, 'inspection'::text, 'lvt'::text, 'finding'::text, 'rti'::text, 'document'::text, 'lvt_item'::text, 'photo'::text]));

alter table "pi_gestao_private"."records" add constraint "records_pkey" PRIMARY KEY (tenant_id, owner_id, id);

alter table "pi_gestao_private"."records" add constraint "records_tenant_id_owner_id_id_kind_key" UNIQUE (tenant_id, owner_id, id, kind);

alter table "pi_gestao_private"."sources" add constraint "sources_byte_size_check" CHECK (byte_size >= 1 AND byte_size <= 33554432);

alter table "pi_gestao_private"."sources" add constraint "sources_id_check" CHECK (id ~ '^[a-f0-9]{64}$'::text);

alter table "pi_gestao_private"."sources" add constraint "sources_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_gestao_private"."sources" add constraint "sources_tenant_id_object_key_key" UNIQUE (tenant_id, object_key);

alter table "pi_gestao_private"."sources" add constraint "sources_workbook_check" CHECK (jsonb_typeof(workbook) = 'object'::text);

alter table "pi_gestao_private"."previews" add constraint "previews_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_gestao_private"."imports" add constraint "imports_pkey" PRIMARY KEY (tenant_id, owner_id, identity);

alter table "pi_gestao_private"."imports" add constraint "imports_tenant_id_owner_id_canonical_key_key" UNIQUE (tenant_id, owner_id, canonical_key);

alter table "pi_gestao_private"."audit" add constraint "audit_pkey" PRIMARY KEY (seq);

alter table "pi_gestao_private"."operation_receipts" add constraint "operation_receipts_pkey" PRIMARY KEY (tenant_id, owner_id, action, request_id);

alter table "pi_team_private"."professionals" add constraint "professionals_availability_check" CHECK (availability = ANY (ARRAY['available'::text, 'assigned'::text, 'unavailable'::text]));

alter table "pi_team_private"."professionals" add constraint "professionals_check" CHECK (integrity_level IS NULL OR length(btrim(integrity_basis)) > 0);

alter table "pi_team_private"."professionals" add constraint "professionals_check1" CHECK (technical_state IS DISTINCT FROM 'verified'::text OR length(btrim(technical_basis)) > 0);

alter table "pi_team_private"."professionals" add constraint "professionals_check2" CHECK (NOT exercise OR technical_state IS DISTINCT FROM 'verified'::text);

alter table "pi_team_private"."professionals" add constraint "professionals_check3" CHECK (exercise OR test_identity IS NULL AND test_registration IS NULL);

alter table "pi_team_private"."professionals" add constraint "professionals_functional_role_check" CHECK (functional_role = ANY (ARRAY['inspector'::text, 'engineer_reviewer'::text]));

alter table "pi_team_private"."professionals" add constraint "professionals_integrity_level_check" CHECK (integrity_level >= 1 AND integrity_level <= 3);

alter table "pi_team_private"."professionals" add constraint "professionals_name_check" CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 160);

alter table "pi_team_private"."professionals" add constraint "professionals_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."professionals" add constraint "professionals_registration_state_check" CHECK (registration_state = ANY (ARRAY['active'::text, 'inactive'::text, 'pending'::text]));

alter table "pi_team_private"."professionals" add constraint "professionals_relationship_check" CHECK (relationship = ANY (ARRAY['employee'::text, 'contractor'::text, 'exercise'::text]));

alter table "pi_team_private"."professionals" add constraint "professionals_technical_state_check" CHECK (technical_state = ANY (ARRAY['not_verified'::text, 'in_review'::text, 'verified'::text, 'restricted'::text]));

alter table "pi_team_private"."professionals" add constraint "professionals_tenant_id_exercise_key_key" UNIQUE (tenant_id, exercise_key);

alter table "pi_team_private"."professionals" add constraint "professionals_tenant_id_user_id_key" UNIQUE (tenant_id, user_id);

alter table "pi_team_private"."qualification_catalog" add constraint "qualification_catalog_code_check" CHECK (length(btrim(code)) >= 1 AND length(btrim(code)) <= 30);

alter table "pi_team_private"."qualification_catalog" add constraint "qualification_catalog_meaning_check" CHECK (length(btrim(meaning)) >= 1 AND length(btrim(meaning)) <= 500);

alter table "pi_team_private"."qualification_catalog" add constraint "qualification_catalog_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."qualification_catalog" add constraint "qualification_catalog_tenant_id_code_key" UNIQUE (tenant_id, code);

alter table "pi_team_private"."qualifications" add constraint "qualifications_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."qualifications" add constraint "qualifications_verification_check" CHECK (verification = ANY (ARRAY['not_informed'::text, 'pending'::text, 'checked'::text, 'rejected'::text]));

alter table "pi_team_private"."documents" add constraint "documents_kind_check" CHECK (kind = ANY (ARRAY['document'::text, 'training'::text]));

alter table "pi_team_private"."documents" add constraint "documents_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."documents" add constraint "documents_title_check" CHECK (length(btrim(title)) >= 1 AND length(btrim(title)) <= 180);

alter table "pi_team_private"."documents" add constraint "documents_verification_check" CHECK (verification = ANY (ARRAY['not_informed'::text, 'pending'::text, 'checked'::text, 'rejected'::text]));

alter table "pi_team_private"."files" add constraint "files_byte_size_check" CHECK (byte_size >= 1 AND byte_size <= 8388608);

alter table "pi_team_private"."files" add constraint "files_mime_check" CHECK (mime = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'text/plain'::text]));

alter table "pi_team_private"."files" add constraint "files_name_check" CHECK (length(name) >= 1 AND length(name) <= 180 AND name !~ '[/\\]'::text);

alter table "pi_team_private"."files" add constraint "files_object_key_key" UNIQUE (object_key);

alter table "pi_team_private"."files" add constraint "files_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."files" add constraint "files_purpose_check" CHECK (purpose = ANY (ARRAY['avatar'::text, 'qualification'::text, 'document'::text]));

alter table "pi_team_private"."files" add constraint "files_state_check" CHECK (state = ANY (ARRAY['reserved'::text, 'stored'::text, 'archived'::text]));

alter table "pi_team_private"."assignments" add constraint "assignments_check" CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on);

alter table "pi_team_private"."assignments" add constraint "assignments_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."requirements" add constraint "requirements_basis_check" CHECK (length(btrim(basis)) >= 1 AND length(btrim(basis)) <= 2000);

alter table "pi_team_private"."requirements" add constraint "requirements_check" CHECK (NULLIF(btrim(activity), ''::text) IS NOT NULL OR client_id IS NOT NULL OR NULLIF(btrim(unit), ''::text) IS NOT NULL);

alter table "pi_team_private"."requirements" add constraint "requirements_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."salary_references" add constraint "salary_references_amount_cents_check" CHECK (amount_cents > 0);

alter table "pi_team_private"."salary_references" add constraint "salary_references_integrity_level_check" CHECK (integrity_level >= 1 AND integrity_level <= 3);

alter table "pi_team_private"."salary_references" add constraint "salary_references_pkey" PRIMARY KEY (tenant_id, id);

alter table "pi_team_private"."salary_references" add constraint "salary_references_reason_check" CHECK (length(btrim(reason)) >= 5 AND length(btrim(reason)) <= 2000);

alter table "pi_team_private"."salary_references" add constraint "salary_references_tenant_id_integrity_level_effective_from_key" UNIQUE (tenant_id, integrity_level, effective_from);

alter table "pi_team_private"."salary_managers" add constraint "salary_managers_pkey" PRIMARY KEY (tenant_id, user_id);

alter table "pi_team_private"."history" add constraint "history_pkey" PRIMARY KEY (id);

alter table "pi_access_private"."invitations" add constraint "invitations_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);

alter table "pi_access_private"."invitations" add constraint "invitations_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."invitations" add constraint "invitations_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "pi_access_private"."accounts" add constraint "accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "public"."pi_assessments" add constraint "pi_assessments_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "public"."pi_assessments" add constraint "pi_assessments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES auth.users(id);

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "public"."pi_company_memberships" add constraint "pi_company_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "public"."pi_company_memberships" add constraint "pi_membership_invitation_fk" FOREIGN KEY (invitation_id) REFERENCES pi_access_private.invitations(id);

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."admin_changes" add constraint "admin_changes_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id);

alter table "pi_access_private"."masters" add constraint "masters_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "pi_access_private"."activity" add constraint "activity_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table "pi_access_private"."activity" add constraint "activity_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."activity" add constraint "activity_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id);

alter table "pi_access_private"."company_licenses" add constraint "company_licenses_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."tenant_changes" add constraint "tenant_changes_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES auth.users(id);

alter table "pi_access_private"."company_seat_exemptions" add constraint "company_seat_exemptions_company_id_user_id_fkey" FOREIGN KEY (company_id, user_id) REFERENCES pi_company_memberships(company_id, user_id);

alter table "pi_access_private"."access_requests" add constraint "access_requests_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_access_private"."access_requests" add constraint "access_requests_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES auth.users(id);

alter table "pi_access_private"."access_requests" add constraint "access_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "pi_billing_private"."bindings" add constraint "bindings_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_billing_private"."bindings" add constraint "bindings_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "pi_billing_private"."bindings" add constraint "bindings_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES auth.users(id);

alter table "pi_billing_private"."event_conflicts" add constraint "event_conflicts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES pi_billing_private.inbox(event_id);

alter table "pi_billing_private"."jobs" add constraint "jobs_event_id_fkey" FOREIGN KEY (event_id) REFERENCES pi_billing_private.inbox(event_id);

alter table "pi_billing_private"."observations" add constraint "observations_binding_id_fkey" FOREIGN KEY (binding_id) REFERENCES pi_billing_private.bindings(id);

alter table "pi_billing_private"."observations" add constraint "observations_job_id_fkey" FOREIGN KEY (job_id) REFERENCES pi_billing_private.jobs(id);

alter table "pi_billing_private"."audit" add constraint "audit_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table "pi_billing_private"."audit" add constraint "audit_company_id_fkey" FOREIGN KEY (company_id) REFERENCES pi_companies(id);

alter table "pi_gestao_private"."pilot_access" add constraint "pilot_access_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_gestao_private"."pilot_access" add constraint "pilot_access_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "pi_gestao_private"."record_origins" add constraint "record_origins_tenant_id_owner_id_record_id_kind_fkey" FOREIGN KEY (tenant_id, owner_id, record_id, kind) REFERENCES pi_gestao_private.records(tenant_id, owner_id, id, kind);

alter table "pi_gestao_private"."record_origins" add constraint "record_origins_tenant_id_source_id_fkey" FOREIGN KEY (tenant_id, source_id) REFERENCES pi_gestao_private.sources(tenant_id, id);

alter table "pi_gestao_private"."record_relations" add constraint "record_relations_tenant_id_owner_id_from_id_from_kind_fkey" FOREIGN KEY (tenant_id, owner_id, from_id, from_kind) REFERENCES pi_gestao_private.records(tenant_id, owner_id, id, kind);

alter table "pi_gestao_private"."record_relations" add constraint "record_relations_tenant_id_owner_id_to_id_to_kind_fkey" FOREIGN KEY (tenant_id, owner_id, to_id, to_kind) REFERENCES pi_gestao_private.records(tenant_id, owner_id, id, kind);

alter table "pi_gestao_private"."owners" add constraint "owners_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_gestao_private"."records" add constraint "records_tenant_id_owner_id_fkey" FOREIGN KEY (tenant_id, owner_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_gestao_private"."sources" add constraint "sources_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_gestao_private"."previews" add constraint "previews_tenant_id_owner_id_fkey" FOREIGN KEY (tenant_id, owner_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_gestao_private"."previews" add constraint "previews_tenant_id_source_id_fkey" FOREIGN KEY (tenant_id, source_id) REFERENCES pi_gestao_private.sources(tenant_id, id);

alter table "pi_gestao_private"."imports" add constraint "imports_tenant_id_owner_id_asset_id_fkey" FOREIGN KEY (tenant_id, owner_id, asset_id) REFERENCES pi_gestao_private.records(tenant_id, owner_id, id);

alter table "pi_gestao_private"."imports" add constraint "imports_tenant_id_source_id_fkey" FOREIGN KEY (tenant_id, source_id) REFERENCES pi_gestao_private.sources(tenant_id, id);

alter table "pi_gestao_private"."audit" add constraint "audit_tenant_id_owner_id_fkey" FOREIGN KEY (tenant_id, owner_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_gestao_private"."operation_receipts" add constraint "operation_receipts_tenant_id_owner_id_fkey" FOREIGN KEY (tenant_id, owner_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_team_private"."professionals" add constraint "professionals_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "pi_team_private"."professionals" add constraint "professionals_tenant_id_avatar_file_id_fkey" FOREIGN KEY (tenant_id, avatar_file_id) REFERENCES pi_team_private.files(tenant_id, id);

alter table "pi_team_private"."professionals" add constraint "professionals_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."professionals" add constraint "professionals_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES auth.users(id);

alter table "pi_team_private"."professionals" add constraint "professionals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "pi_team_private"."qualification_catalog" add constraint "qualification_catalog_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."qualifications" add constraint "qualifications_tenant_id_catalog_id_fkey" FOREIGN KEY (tenant_id, catalog_id) REFERENCES pi_team_private.qualification_catalog(tenant_id, id);

alter table "pi_team_private"."qualifications" add constraint "qualifications_tenant_id_professional_id_fkey" FOREIGN KEY (tenant_id, professional_id) REFERENCES pi_team_private.professionals(tenant_id, id);

alter table "pi_team_private"."qualifications" add constraint "qualifications_tenant_id_proof_file_id_fkey" FOREIGN KEY (tenant_id, proof_file_id) REFERENCES pi_team_private.files(tenant_id, id);

alter table "pi_team_private"."documents" add constraint "documents_tenant_id_client_id_fkey" FOREIGN KEY (tenant_id, client_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_team_private"."documents" add constraint "documents_tenant_id_file_id_fkey" FOREIGN KEY (tenant_id, file_id) REFERENCES pi_team_private.files(tenant_id, id);

alter table "pi_team_private"."documents" add constraint "documents_tenant_id_professional_id_fkey" FOREIGN KEY (tenant_id, professional_id) REFERENCES pi_team_private.professionals(tenant_id, id);

alter table "pi_team_private"."files" add constraint "files_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "pi_team_private"."files" add constraint "files_tenant_id_professional_id_fkey" FOREIGN KEY (tenant_id, professional_id) REFERENCES pi_team_private.professionals(tenant_id, id);

alter table "pi_team_private"."assignments" add constraint "assignments_tenant_id_client_id_project_id_fkey" FOREIGN KEY (tenant_id, client_id, project_id) REFERENCES pi_gestao_private.records(tenant_id, owner_id, id);

alter table "pi_team_private"."assignments" add constraint "assignments_tenant_id_professional_id_fkey" FOREIGN KEY (tenant_id, professional_id) REFERENCES pi_team_private.professionals(tenant_id, id);

alter table "pi_team_private"."requirements" add constraint "requirements_tenant_id_client_id_fkey" FOREIGN KEY (tenant_id, client_id) REFERENCES pi_gestao_private.owners(tenant_id, id);

alter table "pi_team_private"."requirements" add constraint "requirements_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."salary_references" add constraint "salary_references_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);

alter table "pi_team_private"."salary_references" add constraint "salary_references_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."salary_managers" add constraint "salary_managers_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."salary_managers" add constraint "salary_managers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id);

alter table "pi_team_private"."history" add constraint "history_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id);

alter table "pi_team_private"."history" add constraint "history_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES pi_companies(id);

alter table "pi_team_private"."history" add constraint "history_tenant_id_professional_id_fkey" FOREIGN KEY (tenant_id, professional_id) REFERENCES pi_team_private.professionals(tenant_id, id);

CREATE INDEX billing_bindings_company ON pi_billing_private.bindings USING btree (company_id);

CREATE UNIQUE INDEX gestao_units_name ON pi_gestao_private.records USING btree (tenant_id, owner_id, ((body ->> 'name'::text))) WHERE (kind = 'unit'::text);

CREATE INDEX gestao_records_scope_kind ON pi_gestao_private.records USING btree (tenant_id, owner_id, kind, seq);

CREATE INDEX team_history_person ON pi_team_private.history USING btree (tenant_id, professional_id, id DESC);

CREATE INDEX gestao_audit_scope_record ON pi_gestao_private.audit USING btree (tenant_id, owner_id, record_id, seq);

CREATE INDEX team_assignment_person ON pi_team_private.assignments USING btree (tenant_id, professional_id);

CREATE UNIQUE INDEX pi_invitation_pending ON pi_access_private.invitations USING btree (email, company_id) WHERE (invitation_state = ANY (ARRAY['prepared'::text, 'offered'::text, 'sent'::text]));

CREATE UNIQUE INDEX team_active_assignment ON pi_team_private.assignments USING btree (tenant_id, professional_id, project_id, COALESCE(activity, ''::text)) WHERE active;

CREATE INDEX team_qualification_person ON pi_team_private.qualifications USING btree (tenant_id, professional_id);

CREATE INDEX pi_activity_actor_event_date ON pi_access_private.activity USING btree (actor_id, event, occurred_at DESC);

CREATE INDEX team_file_person ON pi_team_private.files USING btree (tenant_id, professional_id);

CREATE UNIQUE INDEX gestao_systems_name ON pi_gestao_private.records USING btree (tenant_id, owner_id, ((body ->> 'unitId'::text)), ((body ->> 'name'::text))) WHERE (kind = 'system'::text);

CREATE INDEX pi_memberships_user_company ON public.pi_company_memberships USING btree (user_id, company_id);

CREATE INDEX billing_jobs_subscription ON pi_billing_private.jobs USING btree (subscription_hint);

CREATE INDEX pi_assessments_owner_date ON public.pi_assessments USING btree (user_id, created_at DESC);

CREATE INDEX pi_assessments_company_date ON public.pi_assessments USING btree (company_id, created_at DESC);

CREATE INDEX pi_tenant_changes_company_date ON pi_access_private.tenant_changes USING btree (company_id, occurred_at DESC);

CREATE INDEX billing_jobs_ready ON pi_billing_private.jobs USING btree (next_attempt, id) WHERE (state = ANY (ARRAY['pending'::text, 'retry'::text, 'processing'::text]));

CREATE INDEX gestao_relation_target ON pi_gestao_private.record_relations USING btree (tenant_id, owner_id, to_id, relation_type);

CREATE INDEX team_document_person ON pi_team_private.documents USING btree (tenant_id, professional_id);

alter table "pi_access_private"."invitations" enable row level security;

alter table "pi_access_private"."invitations" force row level security;

alter table "pi_access_private"."accounts" enable row level security;

alter table "pi_access_private"."accounts" force row level security;

alter table "public"."pi_assessments" enable row level security;

alter table "public"."pi_assessments" force row level security;

alter table "public"."pi_companies" enable row level security;

alter table "public"."pi_companies" force row level security;

alter table "public"."pi_company_memberships" enable row level security;

alter table "public"."pi_company_memberships" force row level security;

alter table "pi_access_private"."admin_changes" enable row level security;

alter table "pi_access_private"."admin_changes" force row level security;

alter table "pi_access_private"."masters" enable row level security;

alter table "pi_access_private"."masters" force row level security;

alter table "pi_access_private"."activity" enable row level security;

alter table "pi_access_private"."activity" force row level security;

alter table "pi_access_private"."tenant_rollout" enable row level security;

alter table "pi_access_private"."tenant_rollout" force row level security;

alter table "pi_access_private"."company_licenses" enable row level security;

alter table "pi_access_private"."company_licenses" force row level security;

alter table "pi_access_private"."tenant_changes" enable row level security;

alter table "pi_access_private"."tenant_changes" force row level security;

alter table "pi_access_private"."company_seat_exemptions" enable row level security;

alter table "pi_access_private"."company_seat_exemptions" force row level security;

alter table "pi_access_private"."access_requests" enable row level security;

alter table "pi_access_private"."access_requests" force row level security;

alter table "pi_billing_private"."bindings" enable row level security;

alter table "pi_billing_private"."bindings" force row level security;

alter table "pi_billing_private"."inbox" enable row level security;

alter table "pi_billing_private"."inbox" force row level security;

alter table "pi_billing_private"."event_conflicts" enable row level security;

alter table "pi_billing_private"."event_conflicts" force row level security;

alter table "pi_billing_private"."jobs" enable row level security;

alter table "pi_billing_private"."jobs" force row level security;

alter table "pi_billing_private"."observations" enable row level security;

alter table "pi_billing_private"."observations" force row level security;

alter table "pi_billing_private"."audit" enable row level security;

alter table "pi_billing_private"."audit" force row level security;

alter table "pi_billing_private"."catalog" enable row level security;

alter table "pi_billing_private"."catalog" force row level security;

alter table "pi_gestao_private"."pilot_access" enable row level security;

alter table "pi_gestao_private"."record_origins" enable row level security;

alter table "pi_gestao_private"."record_relations" enable row level security;

alter table "pi_gestao_private"."owners" enable row level security;

alter table "pi_gestao_private"."records" enable row level security;

alter table "pi_gestao_private"."sources" enable row level security;

alter table "pi_gestao_private"."previews" enable row level security;

alter table "pi_gestao_private"."imports" enable row level security;

alter table "pi_gestao_private"."audit" enable row level security;

alter table "pi_gestao_private"."operation_receipts" enable row level security;

alter table "pi_team_private"."professionals" enable row level security;

alter table "pi_team_private"."qualification_catalog" enable row level security;

alter table "pi_team_private"."qualifications" enable row level security;

alter table "pi_team_private"."documents" enable row level security;

alter table "pi_team_private"."files" enable row level security;

alter table "pi_team_private"."assignments" enable row level security;

alter table "pi_team_private"."requirements" enable row level security;

alter table "pi_team_private"."salary_references" enable row level security;

alter table "pi_team_private"."salary_managers" enable row level security;

alter table "pi_team_private"."history" enable row level security;

CREATE TRIGGER pi_activity_append_only BEFORE DELETE OR UPDATE ON pi_access_private.activity FOR EACH ROW EXECUTE FUNCTION pi_access_private.reject_activity_change();

CREATE TRIGGER pi_assessment_activity AFTER INSERT OR DELETE ON pi_assessments FOR EACH ROW EXECUTE FUNCTION pi_access_private.audit_assessment();

CREATE TRIGGER pi_admin_changes_append_only BEFORE DELETE OR UPDATE ON pi_access_private.admin_changes FOR EACH ROW EXECUTE FUNCTION pi_access_private.reject_activity_change();

CREATE TRIGGER pi_tenant_changes_append_only BEFORE DELETE OR UPDATE ON pi_access_private.tenant_changes FOR EACH ROW EXECUTE FUNCTION pi_access_private.reject_activity_change();

CREATE TRIGGER pi_seat_exemption_guard BEFORE INSERT OR DELETE OR UPDATE ON pi_access_private.company_seat_exemptions FOR EACH ROW EXECUTE FUNCTION pi_access_private.seat_exemption_guard();

CREATE TRIGGER pi_company_license_created AFTER INSERT ON pi_companies FOR EACH ROW EXECUTE FUNCTION pi_access_private.company_license_created();

CREATE TRIGGER pi_membership_seat_guard BEFORE INSERT OR DELETE OR UPDATE ON pi_company_memberships FOR EACH ROW EXECUTE FUNCTION pi_access_private.membership_seat_guard();

CREATE TRIGGER pi_signup_request AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION pi_access_private.capture_signup_request();

CREATE TRIGGER billing_observations_immutable BEFORE DELETE OR UPDATE ON pi_billing_private.observations FOR EACH ROW EXECUTE FUNCTION pi_billing_private.append_only();

CREATE TRIGGER billing_audit_immutable BEFORE DELETE OR UPDATE ON pi_billing_private.audit FOR EACH ROW EXECUTE FUNCTION pi_billing_private.append_only();

CREATE TRIGGER billing_bindings_immutable BEFORE DELETE OR UPDATE ON pi_billing_private.bindings FOR EACH ROW EXECUTE FUNCTION pi_billing_private.append_only();

CREATE TRIGGER billing_catalog_immutable BEFORE DELETE OR UPDATE ON pi_billing_private.catalog FOR EACH ROW EXECUTE FUNCTION pi_billing_private.append_only();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.professionals FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.qualification_catalog FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.qualifications FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.documents FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.files FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.assignments FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.requirements FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

CREATE TRIGGER team_audit AFTER INSERT OR UPDATE ON pi_team_private.salary_references FOR EACH ROW EXECUTE FUNCTION pi_team_private.audit_change();

create policy "team_exercise_assessment_boundary" on "public"."pi_assessments" as restrictive for ALL to "authenticated" using (pi_team_private.legacy_assessment_allowed()) with check (pi_team_private.legacy_assessment_allowed());

create policy "pi_assessments_delete" on "public"."pi_assessments" as permissive for DELETE to "authenticated" using (((user_id = auth.uid()) AND (company_id IS NOT NULL) AND pi_gestao_private.has_company_role(company_id, ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text])));

create policy "pi_assessments_insert" on "public"."pi_assessments" as permissive for INSERT to "authenticated" with check (((user_id = auth.uid()) AND (company_id IS NOT NULL) AND pi_gestao_private.has_company_role(company_id, ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text])));

create policy "pi_assessments_select" on "public"."pi_assessments" as permissive for SELECT to "authenticated" using ((((company_id IS NULL) AND (user_id = auth.uid()) AND ( SELECT pi_access_private.self_internal_account_active() AS self_internal_account_active)) OR ((company_id IS NOT NULL) AND pi_gestao_private.has_company_role(company_id, ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text]))));

create policy "pi_company_read" on "public"."pi_companies" as permissive for SELECT to "authenticated" using (pi_gestao_private.has_company_role(id, ARRAY['admin'::text, 'planner'::text, 'inspector'::text, 'assistant'::text, 'client'::text]));

create policy "pi_membership_read" on "public"."pi_company_memberships" as permissive for SELECT to "authenticated" using (
CASE
    WHEN (NOT pi_access_private.tenants_enabled()) THEN ((access_state = 'active'::text) AND pi_access_private.self_account_active() AND ((user_id = auth.uid()) OR pi_gestao_private.has_company_role(company_id, ARRAY['admin'::text, 'planner'::text])))
    ELSE (pi_gestao_private.has_company_role(company_id, ARRAY['admin'::text, 'planner'::text]) OR ((user_id = auth.uid()) AND pi_gestao_private.has_company_role(company_id, ARRAY['inspector'::text, 'assistant'::text])))
END);

revoke all on schema "pi_access_private" from public, anon, authenticated, service_role;

revoke all on schema "pi_billing_private" from public, anon, authenticated, service_role;

revoke all on schema "pi_gestao_private" from public, anon, authenticated, service_role;

revoke all on schema "pi_team_private" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."invitations" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."accounts" from public, anon, authenticated, service_role;

revoke all on table "public"."pi_assessments" from public, anon, authenticated, service_role;

revoke all on table "public"."pi_companies" from public, anon, authenticated, service_role;

revoke all on table "public"."pi_company_memberships" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."admin_changes" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."masters" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."activity" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."tenant_rollout" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."company_licenses" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."tenant_changes" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."company_seat_exemptions" from public, anon, authenticated, service_role;

revoke all on table "pi_access_private"."access_requests" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."bindings" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."inbox" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."event_conflicts" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."jobs" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."observations" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."audit" from public, anon, authenticated, service_role;

revoke all on table "pi_billing_private"."catalog" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."pilot_access" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."record_origins" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."record_relations" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."owners" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."records" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."sources" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."previews" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."imports" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."audit" from public, anon, authenticated, service_role;

revoke all on table "pi_gestao_private"."operation_receipts" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."professionals" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."qualification_catalog" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."qualifications" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."documents" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."files" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."assignments" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."requirements" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."salary_references" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."salary_managers" from public, anon, authenticated, service_role;

revoke all on table "pi_team_private"."history" from public, anon, authenticated, service_role;

revoke all on sequence "pi_billing_private"."jobs_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence "pi_billing_private"."observations_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence "pi_billing_private"."audit_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence "pi_gestao_private"."records_seq_seq" from public, anon, authenticated, service_role;

revoke all on sequence "pi_gestao_private"."audit_seq_seq" from public, anon, authenticated, service_role;

revoke all on sequence "pi_team_private"."history_id_seq" from public, anon, authenticated, service_role;

revoke all on function public.pi_access_status(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_record_activity(p_event text, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_pending_invites() from public, anon, authenticated, service_role;

revoke all on function public.pi_accept_invite(p_invitation_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_overview() from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_prepare_invite(p_email text, p_company_id uuid, p_role text) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_approve(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_revoke(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.reject_activity_change() from public, anon, authenticated, service_role;

revoke all on function public.pi_access_status_v2(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_dashboard(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.self_account_active() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.account_active(p_user uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.require_master() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.audit_assessment() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.self_internal_account_active() from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.has_company_role(p_company uuid, p_roles text[]) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.record_activity(p_event text, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.pending_invites() from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_trial_plan(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_company_save(p_name text, p_company_id uuid, p_expected_name text) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.session_summary(p_user uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.my_access_request() from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_approve_v2(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.admin_access_requests() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.seat_exempt(p_user uuid, p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text) from public, anon, authenticated, service_role;

revoke all on function public.pi_request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer) from public, anon, authenticated, service_role;

revoke all on function public.pi_my_access_request() from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_access_requests() from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.member_identity_allowed(p_user uuid, p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.seat_exemption_guard() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.is_master() from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.has_company_role_legacy(p_company uuid, p_roles text[]) from public, anon, authenticated, service_role;

revoke all on function public.pi_access_status_v3(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.append_only() from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_hash(p_value jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_column(p_value text) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_date(p_value text, p_label text, p_required boolean) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_change(p_tenant uuid, p_owner uuid, p_id uuid, p_kind text, p_version bigint, p_patch jsonb, p_actor uuid, p_event text) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_api_operational(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.prepare_invite(p_email text, p_company_id uuid, p_role text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.company_save(p_name text, p_company_id uuid, p_expected_name text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.dashboard(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_dashboard_v3(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_admin_retry(p_job bigint) from public, anon, authenticated, service_role;

revoke all on function public.pi_admin_migration_map() from public, anon, authenticated, service_role;

revoke all on function public.pi_my_company_access() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.tenant_write_guard() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.tenants_enabled() from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_admin_status() from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.claim() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.identity_verified(p_user uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.company_active(p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.account_active_legacy(p_user uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.tenant_manage(p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.company_license_created() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.membership_seat_guard() from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_nr13_result(t text, i jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_api_prepared(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.access_status_legacy(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.access_status_v2_legacy(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.accept_invite_legacy(p_invitation_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.trial_plan_legacy(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.company_save_legacy(p_name text, p_company_id uuid, p_expected_name text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.approve_legacy(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.revoke_access_legacy(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_api_projects(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function public.pi_gestao_api(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.trial_extend_legacy(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.approve_v2_legacy(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.prepare_invite_v2_legacy(p_email text, p_company_id uuid, p_role text, p_trial_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.dashboard_legacy(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.dashboard_v3(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.trial_plan(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_admin_queue(p_subscription text, p_request uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_claim() from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.access_status_v3(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.migration_map() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.my_company_access() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.access_status(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.access_status_v2(p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.accept_invite(p_invitation_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.approve(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.revoke_access(p_user_id uuid, p_company_id uuid) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.approve_v2(p_user_id uuid, p_company_id uuid, p_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.admin_overview_legacy() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.admin_overview() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.capture_access_request(p_user uuid, p_full_name text, p_kind text, p_company_name text, p_seats integer) from public, anon, authenticated, service_role;

revoke all on function pi_access_private.capture_signup_request() from public, anon, authenticated, service_role;

revoke all on function pi_access_private.membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.caller(p_company uuid, p_master boolean) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.context(p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer) from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.admin_queue(p_subscription text, p_request uuid) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.admin_retry(p_job bigint) from public, anon, authenticated, service_role;

revoke all on function pi_billing_private.admin_status() from public, anon, authenticated, service_role;

revoke all on function public.pi_billing_context(p_company uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_preview(p_tenant uuid, p_owner uuid, p_input jsonb, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_text(p_value text, p_label text, p_max integer) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_tag_blockers(p_tag text, p_origin text) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_api(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_range_intersects(p_range text, p_start integer, p_end integer, p_mapping jsonb, p_company_cell text) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_access_for_actor(p_tenant uuid, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_require_access(p_tenant uuid, p_write boolean) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_owner(p_tenant uuid, p_owner uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_audit(p_tenant uuid, p_owner uuid, p_record uuid, p_actor uuid, p_action text, p_body jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_put(p_tenant uuid, p_owner uuid, p_kind text, p_body jsonb, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_hierarchy(p_tenant uuid, p_owner uuid, p_unit text, p_system text, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_commit(p_tenant uuid, p_owner uuid, p_id uuid, p_confirm boolean, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function public.pi_gestao_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_record(p_tenant uuid, p_owner uuid, p_id uuid, p_kind text) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_evidence(p_tenant uuid, p_owner uuid, p_input jsonb, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_origin_put(p_tenant uuid, p_owner uuid, p_kind text, p_key text, p_body jsonb, p_source text, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_link(p_tenant uuid, p_owner uuid, p_from uuid, p_from_kind text, p_to uuid, p_to_kind text, p_type text, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_workflow(p_tenant uuid, p_owner uuid, p_action text, p_input jsonb, p_actor uuid) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.ga_system_report(p_tenant uuid, p_owner uuid, p_system uuid, p_campaign uuid) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.can_person(p_tenant uuid, p_person uuid, p_manager boolean) from public, anon, authenticated, service_role;

revoke all on function pi_gestao_private.gp_preview(t uuid, o uuid, c jsonb, i jsonb, a uuid) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.context(p_tenant uuid) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.audit_change() from public, anon, authenticated, service_role;

revoke all on function pi_team_private.person_json(p_tenant uuid, p_id uuid) from public, anon, authenticated, service_role;

revoke all on function public.pi_team_api(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.api(p_tenant uuid, p_action text, p_payload jsonb) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.file_allowed(p_name text, p_write boolean) from public, anon, authenticated, service_role;

revoke all on function pi_team_private.legacy_assessment_allowed() from public, anon, authenticated, service_role;

grant SELECT on table public.pi_assessments to "authenticated";

grant DELETE on table public.pi_assessments to "authenticated";

grant SELECT on table public.pi_companies to "authenticated";

grant SELECT on table public.pi_company_memberships to "authenticated";

grant EXECUTE on function public.pi_access_status(p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_record_activity(p_event text, p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_pending_invites() to "authenticated";

grant EXECUTE on function public.pi_accept_invite(p_invitation_id uuid) to "authenticated";

grant EXECUTE on function public.pi_admin_overview() to "authenticated";

grant EXECUTE on function public.pi_admin_prepare_invite(p_email text, p_company_id uuid, p_role text) to "authenticated";

grant EXECUTE on function public.pi_admin_approve(p_user_id uuid, p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_admin_revoke(p_user_id uuid, p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_access_status_v2(p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_admin_dashboard(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.self_account_active() to "authenticated";

grant EXECUTE on function pi_access_private.self_internal_account_active() to "authenticated";

grant EXECUTE on function pi_gestao_private.has_company_role(p_company uuid, p_roles text[]) to "authenticated";

grant EXECUTE on function pi_access_private.record_activity(p_event text, p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.pending_invites() to "authenticated";

grant EXECUTE on function public.pi_admin_trial_plan(p_user_id uuid, p_company_id uuid, p_days integer) to "authenticated";

grant EXECUTE on function public.pi_admin_mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid) to "service_role";

grant EXECUTE on function pi_access_private.mark_invite_sent(p_invitation_id uuid, p_auth_user_id uuid) to "service_role";

grant EXECUTE on function public.pi_admin_company_save(p_name text, p_company_id uuid, p_expected_name text) to "authenticated";

grant EXECUTE on function public.pi_admin_prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer) to "authenticated";

grant EXECUTE on function public.pi_admin_trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text) to "authenticated";

grant EXECUTE on function pi_access_private.request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer) to "authenticated";

grant EXECUTE on function pi_access_private.my_access_request() to "authenticated";

grant EXECUTE on function public.pi_admin_approve_v2(p_user_id uuid, p_company_id uuid, p_days integer) to "authenticated";

grant EXECUTE on function pi_access_private.admin_access_requests() to "authenticated";

grant EXECUTE on function pi_access_private.admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text) to "authenticated";

grant EXECUTE on function public.pi_request_access(p_full_name text, p_kind text, p_company_name text, p_seats integer) to "authenticated";

grant EXECUTE on function public.pi_my_access_request() to "authenticated";

grant EXECUTE on function public.pi_admin_access_requests() to "authenticated";

grant EXECUTE on function public.pi_admin_decide_request(p_request_id uuid, p_action text, p_seats integer, p_reason text) to "authenticated";

grant EXECUTE on function public.pi_billing_enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer) to "authenticated";

grant EXECUTE on function public.pi_access_status_v3(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_gestao_private.ga_api_operational(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_access_private.prepare_invite(p_email text, p_company_id uuid, p_role text) to "authenticated";

grant EXECUTE on function pi_access_private.company_save(p_name text, p_company_id uuid, p_expected_name text) to "authenticated";

grant EXECUTE on function pi_access_private.dashboard(p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_admin_dashboard_v3(p_company_id uuid) to "authenticated";

grant EXECUTE on function public.pi_admin_license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text) to "authenticated";

grant EXECUTE on function public.pi_admin_membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text) to "authenticated";

grant EXECUTE on function public.pi_admin_company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text) to "authenticated";

grant EXECUTE on function public.pi_billing_admin_retry(p_job bigint) to "authenticated";

grant EXECUTE on function public.pi_admin_migration_map() to "authenticated";

grant EXECUTE on function public.pi_my_company_access() to "authenticated";

grant EXECUTE on function pi_access_private.tenants_enabled() to "authenticated";

grant EXECUTE on function public.pi_billing_admin_status() to "authenticated";

grant EXECUTE on function pi_billing_private.claim() to "authenticated";

grant EXECUTE on function pi_gestao_private.ga_api_prepared(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_gestao_private.ga_api_projects(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function public.pi_gestao_api(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_access_private.dashboard_v3(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.trial_plan(p_user_id uuid, p_company_id uuid, p_days integer) to "authenticated";

grant EXECUTE on function public.pi_billing_ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb) to "service_role";

grant EXECUTE on function public.pi_billing_admin_queue(p_subscription text, p_request uuid) to "authenticated";

grant EXECUTE on function public.pi_billing_claim() to "authenticated";

grant EXECUTE on function public.pi_billing_finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer) to "authenticated";

grant EXECUTE on function pi_access_private.access_status_v3(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.license_change(p_company_id uuid, p_action text, p_expected_revision integer, p_seat_limit integer, p_plan_kind text, p_days integer, p_new_expiry timestamp with time zone, p_reason text) to "authenticated";

grant EXECUTE on function pi_access_private.company_save_v3(p_name text, p_company_id uuid, p_expected_name text, p_reason text) to "authenticated";

grant EXECUTE on function pi_access_private.migration_map() to "authenticated";

grant EXECUTE on function pi_access_private.my_company_access() to "authenticated";

grant EXECUTE on function pi_access_private.access_status(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.access_status_v2(p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.accept_invite(p_invitation_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.approve(p_user_id uuid, p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.revoke_access(p_user_id uuid, p_company_id uuid) to "authenticated";

grant EXECUTE on function pi_access_private.trial_extend(p_user_id uuid, p_company_id uuid, p_expected_expiry timestamp with time zone, p_new_expiry timestamp with time zone, p_reason text) to "authenticated";

grant EXECUTE on function pi_access_private.approve_v2(p_user_id uuid, p_company_id uuid, p_days integer) to "authenticated";

grant EXECUTE on function pi_access_private.prepare_invite_v2(p_email text, p_company_id uuid, p_role text, p_trial_days integer) to "authenticated";

grant EXECUTE on function pi_access_private.admin_overview() to "authenticated";

grant EXECUTE on function pi_access_private.membership_change(p_user_id uuid, p_company_id uuid, p_action text, p_reason text) to "authenticated";

grant EXECUTE on function pi_billing_private.context(p_company uuid) to "authenticated";

grant EXECUTE on function pi_billing_private.admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer) to "authenticated";

grant EXECUTE on function public.pi_billing_admin_bind(p_company uuid, p_subscription text, p_customer text, p_kind text, p_owner uuid, p_quantity integer) to "authenticated";

grant EXECUTE on function pi_billing_private.ingest(p_event_id text, p_event text, p_kind text, p_resource_id text, p_subscription text, p_fingerprint text, p_projection jsonb) to "service_role";

grant EXECUTE on function pi_billing_private.admin_queue(p_subscription text, p_request uuid) to "authenticated";

grant EXECUTE on function pi_billing_private.finish(p_job bigint, p_lease uuid, p_state text, p_reason text, p_snapshot jsonb, p_retry integer) to "authenticated";

grant EXECUTE on function pi_billing_private.enqueue_reconciliation(p_job bigint, p_lease uuid, p_payments jsonb, p_next integer) to "authenticated";

grant EXECUTE on function pi_billing_private.admin_retry(p_job bigint) to "authenticated";

grant EXECUTE on function pi_billing_private.admin_status() to "authenticated";

grant EXECUTE on function public.pi_billing_context(p_company uuid) to "authenticated";

grant EXECUTE on function pi_gestao_private.ga_api(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_gestao_private.ga_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb) to "service_role";

grant EXECUTE on function public.pi_gestao_register_source(p_tenant uuid, p_actor uuid, p_payload jsonb) to "service_role";

grant EXECUTE on function public.pi_team_api(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_team_private.api(p_tenant uuid, p_action text, p_payload jsonb) to "authenticated";

grant EXECUTE on function pi_team_private.file_allowed(p_name text, p_write boolean) to "authenticated";

grant EXECUTE on function pi_team_private.legacy_assessment_allowed() to "authenticated";

grant USAGE on schema pi_access_private to "authenticated";

grant USAGE on schema pi_access_private to "service_role";

grant USAGE on schema pi_billing_private to "authenticated";

grant USAGE on schema pi_billing_private to "service_role";

grant USAGE on schema pi_gestao_private to "authenticated";

grant USAGE on schema pi_team_private to "authenticated";

grant INSERT ("id") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("user_id") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("kind") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("title") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("payload") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("report_text") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("app_version") on table "public"."pi_assessments" to "authenticated";

grant INSERT ("company_id") on table "public"."pi_assessments" to "authenticated";

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pi-gestao-sources','pi-gestao-sources',false,33554432,ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','image/jpeg','image/png']::text[]);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('pi-team-private','pi-team-private',false,8388608,ARRAY['application/pdf','image/jpeg','image/png','text/plain']::text[]);

commit;
