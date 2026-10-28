-- Self-service requests. Approval is still restricted to the global administrator.
-- Apply only after reviewing this delta; no automatic approval, billing or invites.
begin;
create table pi_access_private.access_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null unique references auth.users(id),
 full_name text not null check(char_length(full_name) between 2 and 120),
 applicant_kind text not null check(applicant_kind in ('individual','company')),
 company_name text not null check(char_length(company_name) between 2 and 160),
 requested_seats integer not null check(requested_seats between 1 and 999),
 request_state text not null default 'pending' check(request_state in ('pending','approved','rejected')),
 created_at timestamptz not null default clock_timestamp(),
 company_id uuid references public.pi_companies(id),
 decided_at timestamptz,
 decided_by uuid references auth.users(id),
 decision_reason text,
 check(applicant_kind<>'individual' or requested_seats=1),
 check((request_state='pending' and company_id is null and decided_at is null and decided_by is null)
    or (request_state='approved' and company_id is not null and decided_at is not null and decided_by is not null)
    or (request_state='rejected' and company_id is null and decided_at is not null and decided_by is not null))
);
alter table pi_access_private.access_requests enable row level security;
alter table pi_access_private.access_requests force row level security;
revoke all on pi_access_private.access_requests from public,anon,authenticated;

create function pi_access_private.capture_access_request(p_user uuid,p_full_name text,p_kind text,p_company_name text,p_seats integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function pi_access_private.capture_access_request(uuid,text,text,text,integer) from public,anon,authenticated;

create function pi_access_private.capture_signup_request()
returns trigger language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function pi_access_private.capture_signup_request() from public,anon,authenticated;
create trigger pi_signup_request after insert on auth.users for each row execute function pi_access_private.capture_signup_request();

create function pi_access_private.request_access(p_full_name text,p_kind text,p_company_name text,p_seats integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not pi_access_private.identity_verified(auth.uid()) then raise exception 'verified_identity_required' using errcode='42501';end if;
 return pi_access_private.capture_access_request(auth.uid(),p_full_name,p_kind,p_company_name,p_seats);
end $$;

create function pi_access_private.my_access_request()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r jsonb; eligible boolean;
begin
 if not pi_access_private.identity_verified(auth.uid()) then raise exception 'verified_identity_required' using errcode='42501';end if;
 select to_jsonb(x) into r from pi_access_private.access_requests x where user_id=auth.uid();
 eligible:=r is null and not exists(select 1 from public.pi_company_memberships where user_id=auth.uid())
 and not exists(select 1 from pi_access_private.masters where user_id=auth.uid())
 and not exists(select 1 from pi_access_private.accounts where user_id=auth.uid() and access_state='revoked');
 return jsonb_build_object('request',r,'can_request',eligible,'server_now',statement_timestamp());
end $$;

create function pi_access_private.admin_access_requests()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;
begin
 perform pi_access_private.require_master();
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('email',u.email,'email_verified',pi_access_private.identity_verified(u.id),
 'approved_seats',l.seat_limit,'activated_at',l.activated_at,'expires_at',l.expires_at)
 order by (r.request_state='pending') desc,r.created_at desc),'[]'::jsonb) into rows
 from pi_access_private.access_requests r join auth.users u on u.id=r.user_id
 left join pi_access_private.company_licenses l on l.company_id=r.company_id;
 return jsonb_build_object('requests',rows,'server_now',statement_timestamp());
end $$;

-- Only an approved, verified intake may substitute for an accepted invitation.
-- Existing invitation and seat enforcement remain unchanged.
do $$
declare definition text; old_condition text :=
'not exists(select 1 from pi_access_private.invitations where id=m.invitation_id and company_id=p_company_id and auth_user_id=p_user_id and invitation_state=''accepted'')';
begin
 select pg_get_functiondef('pi_access_private.membership_change(uuid,uuid,text,text)'::regprocedure) into definition;
 if strpos(definition,old_condition)=0 then raise exception 'membership_definition_changed_review_required';end if;
 definition:=replace(definition,old_condition,'(not exists(select 1 from pi_access_private.invitations where id=m.invitation_id and company_id=p_company_id and auth_user_id=p_user_id and invitation_state=''accepted'') and not exists(select 1 from pi_access_private.access_requests where user_id=p_user_id and company_id=p_company_id and request_state=''approved''))');
 execute definition;
end $$;

create function pi_access_private.admin_decide_request(p_request_id uuid,p_action text,p_seats integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function public.pi_request_access(p_full_name text,p_kind text,p_company_name text,p_seats integer)
returns jsonb language sql security invoker set search_path='' as $$select pi_access_private.request_access(p_full_name,p_kind,p_company_name,p_seats)$$;
create function public.pi_my_access_request()
returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.my_access_request()$$;
create function public.pi_admin_access_requests()
returns jsonb language sql stable security invoker set search_path='' as $$select pi_access_private.admin_access_requests()$$;
create function public.pi_admin_decide_request(p_request_id uuid,p_action text,p_seats integer,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$select pi_access_private.admin_decide_request(p_request_id,p_action,p_seats,p_reason)$$;
revoke all on function pi_access_private.request_access(text,text,text,integer), pi_access_private.my_access_request(),
 pi_access_private.admin_access_requests(),pi_access_private.admin_decide_request(uuid,text,integer,text),
 public.pi_request_access(text,text,text,integer),public.pi_my_access_request(),
 public.pi_admin_access_requests(),public.pi_admin_decide_request(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function pi_access_private.request_access(text,text,text,integer), pi_access_private.my_access_request(),
 pi_access_private.admin_access_requests(),pi_access_private.admin_decide_request(uuid,text,integer,text),
 public.pi_request_access(text,text,text,integer),public.pi_my_access_request(),
 public.pi_admin_access_requests(),public.pi_admin_decide_request(uuid,text,integer,text) to authenticated;
commit;


