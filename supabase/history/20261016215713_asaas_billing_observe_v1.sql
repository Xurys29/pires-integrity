-- REVIEW DRAFT. Not applied. Generate a migration file with the Supabase CLI before deployment.
-- Production target: seosxvydjvsulhcpljyy. Observe only: no updates to existing access tables.
begin;
do $$
declare dependency record;
begin
 if to_regnamespace('pi_billing_private') is not null then raise exception 'billing_schema_exists_reconcile_first';end if;
 if to_regprocedure('pi_access_private.identity_verified(uuid)') is null
 or to_regprocedure('pi_access_private.is_master()') is null
 or to_regprocedure('pi_access_private.require_master()') is null
 or to_regprocedure('pi_access_private.tenant_write_guard()') is null
 or to_regclass('pi_access_private.access_requests') is null
 or to_regclass('pi_access_private.company_licenses') is null
 or to_regclass('pi_access_private.company_seat_exemptions') is null then
  raise exception 'published_access_schema_required';
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'pi_billing_%') then raise exception 'billing_rpc_exists_reconcile_first';end if;
 for dependency in select * from (values
  ('pi_access_private.identity_verified(uuid)','5aa502b9a07f6c23bc2cec95e42f13df'),
  ('pi_access_private.is_master()','cd1e253bbb281344d9d611a49c952598'),
  ('pi_access_private.require_master()','05ecc07fcd838b1d2d52017e644a629a'),
  ('pi_access_private.tenant_write_guard()','836036e7f41c8df10abb4b42f8bdba0f')
 ) as expected(signature,digest) loop
  if md5(pg_get_functiondef(to_regprocedure(dependency.signature))) is distinct from dependency.digest
   then raise exception 'access_dependency_changed_review_required';end if;
 end loop;
end $$;

create schema pi_billing_private;
revoke all on schema pi_billing_private from public,anon,authenticated,service_role;
grant usage on schema pi_billing_private to authenticated,service_role;

create table pi_billing_private.catalog(
 id text primary key check(id='calculadora-mensal'),
 revision integer not null check(revision=1),
 state text not null check(state='draft'),
 terms jsonb not null
);
insert into pi_billing_private.catalog values('calculadora-mensal',1,'draft',
 '{"currency":"BRL","cycle":"MONTHLY","priceBasis":"per_license","introUnitAmountMinor":2990,"introPaidCycles":2,"regularUnitAmountMinor":5990,"trialHours":168,"trialTrigger":"first_global_admin_approval","trialReset":false,"financialEffects":false,"paymentMethods":["CREDIT_CARD","PIX","BOLETO"],"contractRequired":true,"trialExpiryCreatesCharge":false,"paidStart":null,"settlementEvent":null,"graceDays":null,"overdue":null,"cancellation":null,"fullRefund":null,"partialRefund":null,"chargeback":null,"rehirePromotion":null,"seatChange":null,"proration":null,"adminOverride":null}'::jsonb);

create table pi_billing_private.bindings(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.pi_companies(id),
 provider_subscription text not null unique check(provider_subscription~'^sub_[A-Za-z0-9_-]{1,180}$'),
 provider_customer text not null check(provider_customer~'^cus_[A-Za-z0-9_-]{1,180}$'),
 payer_kind text not null check(payer_kind in('CPF','CNPJ')),
 owner_id uuid references auth.users(id),
 quantity integer not null check(quantity between 1 and 999),
 terms jsonb not null, created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),
 check((payer_kind='CPF' and quantity=1 and owner_id is not null) or (payer_kind='CNPJ' and owner_id is null))
);
create index billing_bindings_company on pi_billing_private.bindings(company_id);

create table pi_billing_private.inbox(
 event_id text primary key check(event_id~'^evt_[A-Za-z0-9_&-]{1,180}$'),
 event text not null check(event~'^(PAYMENT|SUBSCRIPTION)_[A-Z_]{1,80}$'),
 kind text not null check(kind in('payment','subscription')),
 resource_id text not null, subscription_hint text,
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 projection jsonb not null check(octet_length(projection::text)<=4096),
 conflict boolean not null default false,
 received_at timestamptz not null default clock_timestamp()
);
create table pi_billing_private.event_conflicts(
 event_id text not null references pi_billing_private.inbox(event_id),
 fingerprint text not null check(fingerprint~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(event_id,fingerprint)
);
create table pi_billing_private.jobs(
 id bigint generated always as identity primary key,
 dedupe_key text not null unique,
 event_id text references pi_billing_private.inbox(event_id),
 kind text not null check(kind in('payment','subscription','scan')),
 resource_id text not null, subscription_hint text,
 scan_id uuid, page_offset integer not null default 0 check(page_offset between 0 and 100000),
 state text not null default 'pending' check(state in('pending','processing','retry','review','done')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 lease uuid, lease_until timestamptz,
 next_attempt timestamptz not null default clock_timestamp(),
 reason text, created_at timestamptz not null default clock_timestamp(),
 check((state='processing' and lease is not null and lease_until is not null)
   or (state<>'processing' and lease is null and lease_until is null))
);
create index billing_jobs_ready on pi_billing_private.jobs(next_attempt,id) where state in('pending','retry','processing');
create index billing_jobs_subscription on pi_billing_private.jobs(subscription_hint);
create table pi_billing_private.observations(
 id bigint generated always as identity primary key,
 job_id bigint not null unique references pi_billing_private.jobs(id),
 binding_id uuid not null references pi_billing_private.bindings(id),
 snapshot jsonb not null check(octet_length(snapshot::text)<=4096),
 observed_at timestamptz not null default clock_timestamp(),
 financial_effects boolean not null default false check(not financial_effects)
);
create table pi_billing_private.audit(
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 actor_id uuid references auth.users(id),
 company_id uuid references public.pi_companies(id),
 event text not null, reference text,
 details jsonb not null default '{}' check(octet_length(details::text)<=4096)
);
create function pi_billing_private.append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'append_only';end $$;
create trigger billing_observations_immutable before update or delete on pi_billing_private.observations for each row execute function pi_billing_private.append_only();
create trigger billing_audit_immutable before update or delete on pi_billing_private.audit for each row execute function pi_billing_private.append_only();
create trigger billing_bindings_immutable before update or delete on pi_billing_private.bindings for each row execute function pi_billing_private.append_only();
create trigger billing_catalog_immutable before update or delete on pi_billing_private.catalog for each row execute function pi_billing_private.append_only();

-- Auth.getUser is checked at HTTP; the SQL layer independently checks the real session and current access.
create function pi_billing_private.caller(p_company uuid default null,p_master boolean default false)
returns void language plpgsql stable security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.context(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.admin_bind(p_company uuid,p_subscription text,p_customer text,p_kind text,p_owner uuid,p_quantity integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.ingest(p_event_id text,p_event text,p_kind text,p_resource_id text,p_subscription text,p_fingerprint text,p_projection jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.admin_queue(p_subscription text,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.claim() returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.finish(p_job bigint,p_lease uuid,p_state text,p_reason text,p_snapshot jsonb,p_retry integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.enqueue_reconciliation(p_job bigint,p_lease uuid,p_payments jsonb,p_next integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

create function pi_billing_private.admin_retry(p_job bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare j pi_billing_private.jobs%rowtype;
begin
 perform pi_billing_private.caller(null,true);
 select * into j from pi_billing_private.jobs where id=p_job for update;
 if not found or j.state not in('review','retry') or exists(select 1 from pi_billing_private.inbox where event_id=j.event_id and conflict)
 then raise exception 'job_not_retryable';end if;
 update pi_billing_private.jobs set state='pending',attempts=0,reason=null,next_attempt=clock_timestamp(),lease=null,lease_until=null where id=j.id;
 insert into pi_billing_private.audit(actor_id,event,reference)values(auth.uid(),'manual_retry',j.id::text);
 return jsonb_build_object('jobId',j.id,'state','pending','financialEffects',false);
end $$;

create function pi_billing_private.admin_status() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform pi_billing_private.caller(null,true);
 return jsonb_build_object('mode','observe','financialEffects',false,
 'states',(select coalesce(jsonb_object_agg(state,total),'{}') from (select state,count(*) as total from pi_billing_private.jobs group by state)s),
 'review',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from (select id,reason,attempts,created_at from pi_billing_private.jobs where state='review' order by id desc limit 50)s));
end $$;

-- Private RLS plus explicit ACL; only narrowly scoped RPCs are exposed.
do $$declare t record;begin
 for t in select tablename from pg_tables where schemaname='pi_billing_private' loop
  execute format('alter table pi_billing_private.%I enable row level security',t.tablename);
  execute format('alter table pi_billing_private.%I force row level security',t.tablename);
  execute format('revoke all on pi_billing_private.%I from public,anon,authenticated,service_role',t.tablename);
 end loop;
end $$;
revoke all on all sequences in schema pi_billing_private from public,anon,authenticated,service_role;
revoke all on all functions in schema pi_billing_private from public,anon,authenticated,service_role;

create function public.pi_billing_context(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select pi_billing_private.context(p_company)$$;
create function public.pi_billing_admin_bind(p_company uuid,p_subscription text,p_customer text,p_kind text,p_owner uuid,p_quantity integer) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.admin_bind(p_company,p_subscription,p_customer,p_kind,p_owner,p_quantity)$$;
create function public.pi_billing_ingest(p_event_id text,p_event text,p_kind text,p_resource_id text,p_subscription text,p_fingerprint text,p_projection jsonb) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.ingest(p_event_id,p_event,p_kind,p_resource_id,p_subscription,p_fingerprint,p_projection)$$;
create function public.pi_billing_admin_queue(p_subscription text,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.admin_queue(p_subscription,p_request)$$;
create function public.pi_billing_claim() returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.claim()$$;
create function public.pi_billing_finish(p_job bigint,p_lease uuid,p_state text,p_reason text,p_snapshot jsonb,p_retry integer) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.finish(p_job,p_lease,p_state,p_reason,p_snapshot,p_retry)$$;
create function public.pi_billing_enqueue_reconciliation(p_job bigint,p_lease uuid,p_payments jsonb,p_next integer) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.enqueue_reconciliation(p_job,p_lease,p_payments,p_next)$$;
create function public.pi_billing_admin_retry(p_job bigint) returns jsonb language sql security invoker set search_path='' as $$select pi_billing_private.admin_retry(p_job)$$;
create function public.pi_billing_admin_status() returns jsonb language sql stable security invoker set search_path='' as $$select pi_billing_private.admin_status()$$;

do $$declare f record;begin
 for f in select p.oid::regprocedure as signature,p.proname,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname like 'pi_billing_%')
 or (n.nspname='pi_billing_private' and p.proname in('context','admin_bind','ingest','admin_queue','claim','finish','enqueue_reconciliation','admin_retry','admin_status')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('ingest','pi_billing_ingest') then
   execute format('grant execute on function %s to service_role',f.signature);
  else execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;
end $$;
commit;

