-- Stage one: organization staff registry. No Auth users, invitations, license
-- changes, inspection activity, signatures or issued documents are created here.
begin;
create schema pi_team_private;
revoke all on schema pi_team_private from public, anon, service_role;
grant usage on schema pi_team_private to authenticated;

create table pi_team_private.professionals (
 tenant_id uuid not null references public.pi_companies(id),
 id uuid not null default gen_random_uuid(),
 exercise_key text,
 user_id uuid references auth.users(id),
 name text not null check(length(btrim(name)) between 1 and 160),
 job_title text,
 relationship text check(relationship in ('employee','contractor','exercise')),
 professional_email text,
 professional_phone text,
 integrity_level smallint check(integrity_level between 1 and 3),
 integrity_basis text,
 registration_state text not null default 'active' check(registration_state in ('active','inactive','pending')),
 availability text check(availability in ('available','assigned','unavailable')),
 availability_note text,
 technical_state text check(technical_state in ('not_verified','in_review','verified','restricted')),
 technical_basis text,
 exercise boolean not null default false,
 functional_role text not null default 'inspector' check(functional_role in ('inspector','engineer_reviewer')),
 test_identity text,
 test_registration text,
 avatar_file_id uuid,
 access_revoked_at timestamptz,
 login_validated_at timestamptz,
 version integer not null default 1,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(tenant_id,id), unique(tenant_id,exercise_key), unique(tenant_id,user_id),
 check(integrity_level is null or length(btrim(integrity_basis))>0),
 check(technical_state is distinct from 'verified' or length(btrim(technical_basis))>0),
 check(not exercise or technical_state is distinct from 'verified'),
 check(exercise or (test_identity is null and test_registration is null))
);
create table pi_team_private.qualification_catalog (
 tenant_id uuid not null references public.pi_companies(id), id uuid not null default gen_random_uuid(),
 code text not null check(length(btrim(code)) between 1 and 30),
 meaning text not null check(length(btrim(meaning)) between 1 and 500),
 active boolean not null default true, version integer not null default 1,
 primary key(tenant_id,id), unique(tenant_id,code)
);
create table pi_team_private.qualifications (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), professional_id uuid not null,
 catalog_id uuid not null, method text, qualification_level text, scope text,
 certifier text, certificate_number text, valid_until date,
 verification text not null default 'not_informed' check(verification in ('not_informed','pending','checked','rejected')),
 verification_note text, proof_file_id uuid, version integer not null default 1,
 primary key(tenant_id,id), foreign key(tenant_id,professional_id) references pi_team_private.professionals(tenant_id,id),
 foreign key(tenant_id,catalog_id) references pi_team_private.qualification_catalog(tenant_id,id)
);
create table pi_team_private.documents (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), professional_id uuid not null,
 title text not null check(length(btrim(title)) between 1 and 180),
 kind text not null check(kind in ('document','training')),
 activity text, client_id uuid, unit text, issuer text, valid_until date,
 verification text not null default 'not_informed' check(verification in ('not_informed','pending','checked','rejected')),
 verification_note text, file_id uuid, version integer not null default 1,
 primary key(tenant_id,id), foreign key(tenant_id,professional_id) references pi_team_private.professionals(tenant_id,id),
 foreign key(tenant_id,client_id) references pi_gestao_private.owners(tenant_id,id)
);
create table pi_team_private.files (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), professional_id uuid not null,
 name text not null check(length(name) between 1 and 180 and name !~ '[/\\]'),
 object_key text not null unique, mime text not null check(mime in ('application/pdf','image/jpeg','image/png','text/plain')),
 byte_size bigint not null check(byte_size between 1 and 8388608),
 purpose text not null check(purpose in ('avatar','qualification','document')),
 state text not null default 'reserved' check(state in ('reserved','stored','archived')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(tenant_id,id), foreign key(tenant_id,professional_id) references pi_team_private.professionals(tenant_id,id)
);
alter table pi_team_private.professionals add foreign key(tenant_id,avatar_file_id) references pi_team_private.files(tenant_id,id);
alter table pi_team_private.qualifications add foreign key(tenant_id,proof_file_id) references pi_team_private.files(tenant_id,id);
alter table pi_team_private.documents add foreign key(tenant_id,file_id) references pi_team_private.files(tenant_id,id);
create table pi_team_private.assignments (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), professional_id uuid not null,
 client_id uuid not null, project_id uuid not null, activity text,
 starts_on date, ends_on date, active boolean not null default true,
 primary key(tenant_id,id), foreign key(tenant_id,professional_id) references pi_team_private.professionals(tenant_id,id),
 foreign key(tenant_id,client_id,project_id) references pi_gestao_private.records(tenant_id,owner_id,id),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create unique index team_active_assignment on pi_team_private.assignments(tenant_id,professional_id,project_id,coalesce(activity,'')) where active;
create table pi_team_private.requirements (
 tenant_id uuid not null references public.pi_companies(id), id uuid not null default gen_random_uuid(),
 title text not null, activity text, client_id uuid, unit text,
 basis text not null check(length(btrim(basis)) between 1 and 2000), active boolean not null default true,
 primary key(tenant_id,id), foreign key(tenant_id,client_id) references pi_gestao_private.owners(tenant_id,id),
 check(nullif(btrim(activity),'') is not null or client_id is not null or nullif(btrim(unit),'') is not null)
);
create table pi_team_private.salary_references (
 tenant_id uuid not null references public.pi_companies(id), id uuid not null default gen_random_uuid(),
 integrity_level smallint not null check(integrity_level between 1 and 3),
 amount_cents bigint not null check(amount_cents>0), effective_from date not null,
 reason text not null check(length(btrim(reason)) between 5 and 2000),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(tenant_id,id), unique(tenant_id,integrity_level,effective_from)
);
create table pi_team_private.salary_managers (
 tenant_id uuid not null references public.pi_companies(id), user_id uuid not null references auth.users(id),
 primary key(tenant_id,user_id)
);
create table pi_team_private.history (
 id bigint generated always as identity primary key, tenant_id uuid not null references public.pi_companies(id),
 professional_id uuid, entity text not null, entity_id text not null,
 actor_id uuid not null references auth.users(id), occurred_at timestamptz not null default now(),
 action text not null, before_value jsonb, after_value jsonb,
 foreign key(tenant_id,professional_id) references pi_team_private.professionals(tenant_id,id)
);
create index team_history_person on pi_team_private.history(tenant_id,professional_id,id desc);
create index team_qualification_person on pi_team_private.qualifications(tenant_id,professional_id);
create index team_document_person on pi_team_private.documents(tenant_id,professional_id);
create index team_file_person on pi_team_private.files(tenant_id,professional_id);
create index team_assignment_person on pi_team_private.assignments(tenant_id,professional_id);

create function pi_team_private.context(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
end $$;
create function pi_team_private.can_person(p_tenant uuid,p_person uuid,p_manager boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=pi_team_private.context(p_tenant);
 return exists(select 1 from pi_team_private.professionals p where p.tenant_id=p_tenant and p.id=p_person
 and ((c->>'manager')::boolean or (not p_manager and p.user_id=auth.uid() and p.access_revoked_at is null)));
exception when insufficient_privilege then return false;
end $$;
create function pi_team_private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
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
end $$;
do $$ declare t text;begin
 foreach t in array array['professionals','qualification_catalog','qualifications','documents','files','assignments','requirements','salary_references','salary_managers','history'] loop
 execute format('alter table pi_team_private.%I enable row level security',t);
 execute format('revoke all on pi_team_private.%I from public,anon,authenticated,service_role',t);
 if t not in ('history','salary_managers') then execute format('create trigger team_audit after insert or update on pi_team_private.%I for each row execute function pi_team_private.audit_change()',t);end if;
 end loop;
end $$;

create function pi_team_private.person_json(p_tenant uuid,p_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select to_jsonb(p)||jsonb_build_object(
 'qualifications',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('code',c.code,'meaning',c.meaning) order by c.code) from pi_team_private.qualifications q join pi_team_private.qualification_catalog c on c.tenant_id=q.tenant_id and c.id=q.catalog_id where q.tenant_id=p_tenant and q.professional_id=p.id),'[]'::jsonb),
 'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.title) from pi_team_private.documents d where d.tenant_id=p_tenant and d.professional_id=p.id),'[]'::jsonb),
 'assignments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('project_name',r.body->>'name','client_name',o.name) order by a.starts_on) from pi_team_private.assignments a join pi_gestao_private.records r on r.tenant_id=a.tenant_id and r.owner_id=a.client_id and r.id=a.project_id join pi_gestao_private.owners o on o.tenant_id=a.tenant_id and o.id=a.client_id where a.tenant_id=p_tenant and a.professional_id=p.id),'[]'::jsonb),
 'files',coalesce((select jsonb_agg(to_jsonb(f)-'object_key' order by f.created_at) from pi_team_private.files f where f.tenant_id=p_tenant and f.professional_id=p.id and f.state='stored'),'[]'::jsonb),
 'access',jsonb_build_object('status',case when p.access_revoked_at is not null or m.access_state='revoked' then 'revoked' when p.user_id is null then 'not_created' when m.access_state='active' and pi_access_private.member_identity_allowed(p.user_id,p_tenant) and pi_access_private.company_active(p_tenant) then case when p.login_validated_at is not null then 'login_validated' else 'active' end else 'created' end,'user_id',p.user_id,'license_company_id',case when m.user_id is not null then m.company_id end,'license_scope','company','functional_role',p.functional_role,'signature_permission',case when p.functional_role='engineer_reviewer' and p.exercise then 'exercise_plh_sign_issue' else 'none' end,'professional_authorization','not_verified')
 ) from pi_team_private.professionals p left join public.pi_company_memberships m on m.company_id=p.tenant_id and m.user_id=p.user_id where p.tenant_id=p_tenant and p.id=p_id;
$$;

create function pi_team_private.api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
end $$;

create function public.pi_team_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select pi_team_private.api(p_tenant,p_action,p_payload) $$;

create function pi_team_private.file_allowed(p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare f pi_team_private.files%rowtype;
begin
 if auth.uid() is null then return false;end if;
 select * into f from pi_team_private.files where object_key=p_name;
 if f.id is null or not pi_team_private.can_person(f.tenant_id,f.professional_id) then return false;end if;
 return case when p_write then f.state='reserved' and f.created_by=auth.uid() else f.state='stored' end;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pi-team-private','pi-team-private',false,8388608,array['application/pdf','image/jpeg','image/png','text/plain']);
create policy team_files_insert on storage.objects for insert to authenticated with check(bucket_id='pi-team-private' and pi_team_private.file_allowed(name,true));
create policy team_files_read on storage.objects for select to authenticated using(bucket_id='pi-team-private' and pi_team_private.file_allowed(name,false));
-- Immutable files: replacements receive new ids; no UPDATE/DELETE storage policy.
revoke all on all functions in schema pi_team_private from public,anon,authenticated,service_role;
revoke all on function public.pi_team_api(uuid,text,jsonb) from public,anon,service_role;
grant execute on function public.pi_team_api(uuid,text,jsonb),pi_team_private.api(uuid,text,jsonb),pi_team_private.file_allowed(text,boolean) to authenticated;
commit;
