-- REVIEW CANDIDATE ONLY: not applied to production and not a generated migration.
-- Supabase CLI cannot start here because /home/agent/.supabase is read-only.
-- Generate a migration with the supported CLI before rollout. Apply only to an
-- isolated development database while reviewing this candidate.
-- Existing pilot, identity, licence and write checks remain authoritative.
-- In Equipe v1 write=true is admin/master only: assigning a read-only inspector
-- does NOT grant execution permission. No memberships, pilot grants, accounts,
-- licences or credentials are created/updated by this candidate.
-- Proposed API ACL delta for review: direct authenticated EXECUTE on the four
-- legacy private dispatchers is revoked; public.pi_gestao_api retains access
-- through the new wrapper. Without this delta legacy dispatchers bypass managed
-- draft guards. This is tested only in transient isolated local databases.
-- No real catalogue is seeded. A complete curated source must be inspected and
-- reviewed before a catalogue is installed; arbitrary historical text is not a
-- catalogue. Catalogues are private immutable versions frozen by execution.
begin;

create table pi_gestao_private.inspection_catalogs (
 tenant_id uuid not null, owner_id uuid not null, id uuid not null default gen_random_uuid(),
 source_id text not null, source_locator jsonb not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 1000),
 verified_by uuid not null references auth.users(id), verified_at timestamptz not null,
 active boolean not null default true,
 primary key(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id) references pi_gestao_private.owners(tenant_id,id),
 foreign key(tenant_id,source_id) references pi_gestao_private.sources(tenant_id,id),
 check(jsonb_typeof(source_locator)='object')
);
create table pi_gestao_private.inspection_executions (
 tenant_id uuid not null, owner_id uuid not null, inspection_id uuid not null,
 execution_id uuid not null, execution_kind text not null check(execution_kind in ('lvt','document')),
 catalog_id uuid,
 primary key(tenant_id,owner_id,inspection_id), unique(tenant_id,owner_id,execution_id),
 foreign key(tenant_id,owner_id,inspection_id) references pi_gestao_private.records(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id,execution_id,execution_kind) references pi_gestao_private.records(tenant_id,owner_id,id,kind),
 foreign key(tenant_id,owner_id,catalog_id) references pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id)
);
alter table pi_gestao_private.inspection_catalogs enable row level security;
alter table pi_gestao_private.inspection_executions enable row level security;
revoke all on pi_gestao_private.inspection_catalogs,pi_gestao_private.inspection_executions from public,anon,authenticated,service_role;

create function pi_gestao_private.ga_execution_catalog(p_tenant uuid,p_owner uuid,p_id uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare c pi_gestao_private.inspection_catalogs; s pi_gestao_private.sources;
 item jsonb; choice jsonb; seen text[]:='{}'; choice_ids text[]; loc jsonb;
begin
 select * into c from pi_gestao_private.inspection_catalogs
 where tenant_id=p_tenant and owner_id=p_owner and (p_id is null and active or id=p_id)
 order by verified_at desc,id limit 1;
 if not found then return jsonb_build_object('id',null,'items','[]'::jsonb,'status','unavailable','reason','Catálogo de LVT com fonte conferida ainda não disponível.');end if;
 select * into s from pi_gestao_private.sources where tenant_id=p_tenant and id=c.source_id;
 if s.id is null or coalesce(s.workbook->>'format','xlsx') not in ('xlsx','document_xlsx','document_pdf')
 or not exists(select 1 from storage.objects where bucket_id='pi-gestao-sources' and name=s.object_key)
 then raise exception 'Original do catálogo indisponível.' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(c.items) loop
  perform pi_gestao_private.ga_text(item->>'id','Identidade do item do catálogo',200);
  perform pi_gestao_private.ga_text(item->>'itemKey','Número do item do catálogo',100);
  perform pi_gestao_private.ga_text(item->>'component','Componente do catálogo',1000);
  if (item->>'id')=any(seen) or jsonb_typeof(item->'conditions') is distinct from 'array'
  or jsonb_array_length(item->'conditions')=0 or jsonb_typeof(item->'recommendations') is distinct from 'array'
  then raise exception 'Catálogo incompleto ou com identidade duplicada.' using errcode='22023';end if;
  seen:=array_append(seen,item->>'id');choice_ids:='{}';
  for choice in select value from jsonb_array_elements((item->'conditions')||(item->'recommendations')) loop
   perform pi_gestao_private.ga_text(choice->>'id','Identidade da frase',200);
   perform pi_gestao_private.ga_text(choice->>'text','Frase documental',10000);
   loc:=choice->'source'->'locator';
   if (choice->>'id')=any(choice_ids) or choice->'source'->>'sourceId' is distinct from s.id
   or choice->'source'->>'fileHash' is distinct from s.id
   or jsonb_typeof(loc) is distinct from 'object' or loc='{}'::jsonb
   then raise exception 'Frase sem proveniência documental conferida.' using errcode='22023';end if;
   choice_ids:=array_append(choice_ids,choice->>'id');
  end loop;
 end loop;
 return jsonb_build_object('id',c.id,'status','verified','items',c.items,'source',jsonb_build_object('sourceId',s.id,'fileHash',s.id,'fileName',s.name,'locator',c.source_locator),'verifiedAt',c.verified_at);
end $$;

-- One shared predicate keeps the queue and direct execution gate in agreement.
-- It has no table access and does not grant access to any actor or activity.
create function pi_gestao_private.ga_execution_scope_matches(p_inspection jsonb,p_contract jsonb,p_campaign jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(
  p_inspection->>'module'='integridade' and p_inspection->>'type' in ('visual','espessura')
  and p_contract->>'id'=p_inspection->>'contractId'
  and p_campaign->>'id'=p_inspection->>'campaignId'
  and coalesce(p_contract->'modules','[]') ? (p_inspection->>'module')
  and coalesce(p_contract->'moduleAssetIds'->(p_inspection->>'module'),p_contract->'assetIds','[]') ? (p_inspection->>'assetId')
  and p_campaign->>'contractId'=p_contract->>'id'
  and p_campaign->>'module'=p_inspection->>'module'
  and coalesce(p_campaign->'assetIds','[]') ? (p_inspection->>'assetId'),false);
$$;

-- Contract-aware reports use canonical record IDs and derive every collection,
-- version and source from the same filtered snapshot. The legacy no-contract
-- route remains explicit about covering all contracts in the selected system.
create function pi_gestao_private.ga_system_report_scoped(p_tenant uuid,p_owner uuid,p_system uuid,p_campaign uuid,p_contract uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare owner_record jsonb;system_record jsonb;campaign_record jsonb;contract_record jsonb;result jsonb;
begin
 perform pi_gestao_private.ga_require_access(p_tenant,false);
 if p_contract is null then
  result:=pi_gestao_private.ga_system_report(p_tenant,p_owner,p_system,p_campaign);
  return result||jsonb_build_object('reportScope',jsonb_build_object('mode',case when p_campaign is null then 'system_all_contracts' else 'campaign' end,'ownerId',p_owner,'contractId',result->'contract'->>'id','systemId',result->'system'->>'id','campaignId',p_campaign));
 end if;
 owner_record:=pi_gestao_private.ga_owner(p_tenant,p_owner);
 contract_record:=pi_gestao_private.ga_record(p_tenant,p_owner,p_contract,'contract');
 if not coalesce(contract_record->'modules','[]') ? 'integridade' or contract_record->>'recordClass'='commercial_reference' then raise exception 'Contrato fora do módulo de integridade.' using errcode='42501';end if;
 if p_campaign is not null then
  campaign_record:=pi_gestao_private.ga_record(p_tenant,p_owner,p_campaign,'campaign');
  if campaign_record->>'contractId' is distinct from p_contract::text or campaign_record->>'module' is distinct from 'integridade'
  or (p_system is not null and campaign_record->>'systemId' is distinct from p_system::text)
  then raise exception 'Campanha não corresponde ao contrato e sistema selecionados.' using errcode='42501';end if;
  p_system:=(campaign_record->>'systemId')::uuid;
 end if;
 if p_system is null then raise exception 'Sistema explícito obrigatório.' using errcode='22023';end if;
 system_record:=pi_gestao_private.ga_record(p_tenant,p_owner,p_system,'system');
 with assets as materialized (
  select r.* from pi_gestao_private.records r
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='asset' and r.body->>'systemId'=p_system::text
  and coalesce(contract_record->'moduleAssetIds'->'integridade',contract_record->'assetIds','[]') ? r.id::text
  and (p_campaign is null or coalesce(campaign_record->'assetIds','[]') ? r.id::text)
 ), campaigns as materialized (
  select r.* from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='campaign'
  and r.body->>'contractId'=p_contract::text and r.body->>'systemId'=p_system::text and r.body->>'module'='integridade'
  and (p_campaign is null or r.id=p_campaign)
  and exists(select 1 from assets a where coalesce(r.body->'assetIds','[]') ? a.id::text)
 ), inspections as materialized (
  select r.* from pi_gestao_private.records r join campaigns c on c.id::text=r.body->>'campaignId'
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='inspection' and r.body->>'contractId'=p_contract::text
  and exists(select 1 from assets a where a.id::text=r.body->>'assetId')
  and pi_gestao_private.ga_execution_scope_matches(r.body,contract_record,c.body||jsonb_build_object('id',c.id))
 ), eligible_documents as materialized (
  select r.* from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='document'
  and (nullif(r.body->>'contractId','') is null or r.body->>'contractId'=p_contract::text)
  and (nullif(r.body->>'assetId','') is null or exists(select 1 from assets a where a.id::text=r.body->>'assetId'))
  and (nullif(r.body->>'campaignId','') is null or exists(select 1 from campaigns c where c.id::text=r.body->>'campaignId'))
  and (nullif(r.body->>'inspectionId','') is null or exists(select 1 from inspections i where i.id::text=r.body->>'inspectionId'))
  and (nullif(r.body->>'module','') is null or r.body->>'module' in ('integridade','rtis'))
  and coalesce(r.body->>'recordClass','') not in ('projectSnapshot','projectPreview','projectScope','projectPlan','projectEvent')
 ), lvts as materialized (
  select r.* from pi_gestao_private.records r join inspections i on i.id::text=r.body->>'inspectionId'
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='lvt' and r.body->>'contractId'=p_contract::text
  and r.body->>'assetId'=i.body->>'assetId' and r.body->>'module'=i.body->>'module'
  and r.body->>'campaignId'=i.body->>'campaignId' and r.body->>'systemId'=i.body->>'systemId'
  and (nullif(r.body->>'documentId','') is null or exists(select 1 from eligible_documents d where d.id::text=r.body->>'documentId'
   and (nullif(d.body->>'assetId','') is null or d.body->>'assetId'=i.body->>'assetId')
   and (nullif(d.body->>'campaignId','') is null or d.body->>'campaignId'=i.body->>'campaignId')
   and (nullif(d.body->>'inspectionId','') is null or d.body->>'inspectionId'=i.id::text)))
 ), items as materialized (
  select r.* from pi_gestao_private.records r join lvts l on l.id::text=r.body->>'lvtId'
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='lvt_item' and r.body->>'contractId'=p_contract::text
  and r.body->>'assetId'=l.body->>'assetId' and r.body->>'inspectionId'=l.body->>'inspectionId'
  and r.body->>'campaignId'=l.body->>'campaignId' and r.body->>'systemId'=l.body->>'systemId' and r.body->>'module'=l.body->>'module'
 ), photos as materialized (
  select r.* from pi_gestao_private.records r join items i on i.id::text=r.body->>'lvtItemId'
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='photo' and r.body->>'contractId'=p_contract::text
  and r.body->>'assetId'=i.body->>'assetId' and r.body->>'lvtId'=i.body->>'lvtId'
  and r.body->>'inspectionId'=i.body->>'inspectionId' and r.body->>'campaignId'=i.body->>'campaignId' and r.body->>'systemId'=i.body->>'systemId' and r.body->>'module'=i.body->>'module'
 ), findings as materialized (
  select r.* from pi_gestao_private.records r join items i on i.id::text=r.body->>'lvtItemId'
  where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='finding' and r.body->>'contractId'=p_contract::text
  and r.body->>'assetId'=i.body->>'assetId' and r.body->>'lvtId'=i.body->>'lvtId'
  and r.body->>'inspectionId'=i.body->>'inspectionId' and r.body->>'campaignId'=i.body->>'campaignId' and r.body->>'systemId'=i.body->>'systemId' and r.body->>'module'=i.body->>'module'
 ), rtis as materialized (
  select r.* from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='rti'
  and r.body->>'contractId'=p_contract::text and exists(select 1 from assets a where a.id::text=r.body->>'assetId')
  and (nullif(r.body->>'systemId','') is null or r.body->>'systemId'=p_system::text)
  and (nullif(r.body->>'campaignId','') is null or exists(select 1 from campaigns c where c.id::text=r.body->>'campaignId'))
  and (nullif(r.body->>'inspectionId','') is null or exists(select 1 from inspections i where i.id::text=r.body->>'inspectionId' and i.body->>'assetId'=r.body->>'assetId' and i.body->>'campaignId'=r.body->>'campaignId'))
  and (nullif(r.body->>'lvtItemId','') is null or exists(select 1 from items i where i.id::text=r.body->>'lvtItemId' and i.body->>'assetId'=r.body->>'assetId' and i.body->>'campaignId'=r.body->>'campaignId'))
  and (nullif(r.body->>'findingId','') is null or exists(select 1 from findings f where f.id::text=r.body->>'findingId' and f.body->>'assetId'=r.body->>'assetId' and f.body->>'campaignId'=r.body->>'campaignId' and (nullif(r.body->>'lvtItemId','') is null or f.body->>'lvtItemId'=r.body->>'lvtItemId')))
  and (nullif(r.body->>'documentId','') is null or exists(select 1 from eligible_documents d where d.id::text=r.body->>'documentId'
   and (nullif(d.body->>'assetId','') is null or d.body->>'assetId'=r.body->>'assetId')
   and (nullif(d.body->>'campaignId','') is null or d.body->>'campaignId'=r.body->>'campaignId')
   and (nullif(d.body->>'inspectionId','') is null or d.body->>'inspectionId'=r.body->>'inspectionId')))
 ), documents as materialized (
  select d.* from eligible_documents d where (
   d.body->>'contractId'=p_contract::text and exists(select 1 from assets a where a.id::text=d.body->>'assetId')
   or exists(select 1 from lvts l where l.body->>'documentId'=d.id::text)
   or exists(select 1 from rtis r where r.body->>'documentId'=d.id::text)
  )
 ), selected as materialized (
  select r.* from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='contract' and r.id=p_contract
  union all select * from assets union all select * from campaigns union all select * from inspections
  union all select * from lvts union all select * from items union all select * from photos
  union all select * from findings union all select * from rtis union all select * from documents
 )
 select jsonb_build_object('snapshotVersion',1,'version',1,'draft',true,'canIssue',false,'company',owner_record,'system',system_record,'campaign',campaign_record,'contract',contract_record,
 'reportScope',jsonb_build_object('mode',case when p_campaign is null then 'contract_system' else 'contract_campaign' end,'ownerId',p_owner,'contractId',p_contract,'systemId',p_system,'campaignId',p_campaign),
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
 'sourceProvenance',coalesce((select jsonb_agg(jsonb_build_object('sourceId',s.id,'fileHash',s.id,'fileName',s.name,'format',coalesce(s.workbook->>'format','xlsx')) order by s.id) from pi_gestao_private.sources s where s.tenant_id=p_tenant and exists(select 1 from selected r where s.id in (r.body->'source'->>'sourceId',r.body->'conditionSource'->>'sourceId',r.body->'recommendationSource'->>'sourceId'))),'[]'),
 'unresolvedOwnerRTICount',(select count(*) from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='rti' and r.body->>'assetId' is null and r.body->>'contractId'=p_contract::text and (p_campaign is null or r.body->>'campaignId'=p_campaign::text))) into result from selected;
 return result||jsonb_build_object('scopeDigest',pi_gestao_private.ga_hash(result),'generatedAt',statement_timestamp());
end $$;

create function pi_gestao_private.ga_execution_detail(p_tenant uuid,p_owner uuid,p_inspection uuid)
returns jsonb language plpgsql set search_path='' as $$
declare actor uuid; cap jsonb; i jsonb; e jsonb; cat jsonb; con jsonb; campaign jsonb; p pi_team_private.professionals;
 a pi_team_private.professionals; x pi_gestao_private.inspection_executions; manager boolean; can_execute boolean; reason text;
begin
 actor:=pi_gestao_private.ga_require_access(p_tenant,false);
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,actor);
 manager:=cap->>'role' in ('admin','master');
 i:=pi_gestao_private.ga_record(p_tenant,p_owner,p_inspection,'inspection');
 if i->>'module' is distinct from 'integridade' or i->>'type' not in ('visual','espessura') then raise exception 'Modalidade não coberta por esta ficha.' using errcode='22023';end if;
 con:=pi_gestao_private.ga_record(p_tenant,p_owner,(i->>'contractId')::uuid,'contract');
 campaign:=pi_gestao_private.ga_record(p_tenant,p_owner,(i->>'campaignId')::uuid,'campaign');
 if not pi_gestao_private.ga_execution_scope_matches(i,con,campaign)
 then raise exception 'Atividade fora do escopo atual do contrato/campanha.' using errcode='42501';end if;
 select * into p from pi_team_private.professionals where tenant_id=p_tenant and user_id=actor and registration_state='active' and access_revoked_at is null;
 select * into a from pi_team_private.professionals where tenant_id=p_tenant and id=nullif(i->>'assigneeProfessionalId','')::uuid;
 if not manager and (p.id is null or i->>'assigneeProfessionalId' is distinct from p.id::text) then raise exception 'Inspeção não atribuída a este profissional.' using errcode='42501';end if;
 select * into x from pi_gestao_private.inspection_executions where tenant_id=p_tenant and owner_id=p_owner and inspection_id=p_inspection;
 if x.execution_id is not null then e:=pi_gestao_private.ga_record(p_tenant,p_owner,x.execution_id,x.execution_kind);end if;
 if i->>'type'='visual' and x.execution_id is not null and x.catalog_id is null then
 cat:=jsonb_build_object('id',null,'items','[]'::jsonb,'status','unavailable','reason','Rascunho iniciado sem catálogo conferido; vinculação de modelo exige revisão técnica.');
 elsif i->>'type'='visual' then cat:=pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,x.catalog_id);
 else cat:=jsonb_build_object('id',null,'items','[]'::jsonb,'status','not_applicable');end if;
 can_execute:=cap->>'write'='true' and p.id is not null and a.id=p.id and a.registration_state='active' and a.access_revoked_at is null and a.user_id=actor;
 reason:=case when cap->>'write' is distinct from 'true' then 'A permissão atual permite consulta. A execução depende de revisão da política de acesso pela gestão.'
 when a.id is null then 'Inspeção ainda não atribuída.'
 when a.user_id is null then 'Profissional sem vínculo de acesso individual conferido.'
 when p.id is null or a.id<>p.id then 'A execução pertence ao profissional responsável atribuído.'
 when a.registration_state<>'active' or a.access_revoked_at is not null then 'Cadastro do responsável indisponível.' end;
 return jsonb_build_object('inspection',i||jsonb_build_object('assigneeName',a.name,'assigneeAccessLinked',a.user_id is not null),
 'execution',e,'catalog',cat,'actorUserId',actor,'professionalId',p.id,'canAssign',manager and cap->>'write'='true',
 'writeAllowed',cap->>'write'='true','canExecute',coalesce(can_execute,false),'executionBlockReason',reason,
 'professionals',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'registrationState',q.registration_state,'accessLinked',q.user_id is not null) order by q.name) from pi_team_private.professionals q where q.tenant_id=p_tenant and q.registration_state='active' and q.access_revoked_at is null),'[]') else '[]'::jsonb end);
end $$;

create function pi_gestao_private.ga_api_execution(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
<<ga_api_execution>>
declare actor uuid; own uuid; inspection_id uuid; request_id uuid; cap jsonb; d jsonb; i jsonb; e jsonb; cat jsonb; patch jsonb; managed_inspection uuid;
 manager boolean; person pi_team_private.professionals; x pi_gestao_private.inspection_executions;
 receipt pi_gestao_private.operation_receipts; digest text; result jsonb; rec record;
 item jsonb; shell jsonb; answer jsonb; normalized jsonb; answers jsonb:='[]'; item_refs jsonb:='[]';
 condition jsonb; recommendation jsonb; photo jsonb; photo_id text; prior_rti jsonb; finding jsonb; rti jsonb;
 scope jsonb; source jsonb; id uuid; item_id uuid; kind text; observed text; status text; n integer; completed integer:=0; review_needed boolean:=false;
 seen text[]:='{}'; reading jsonb; readings jsonb; instrument text;
begin
 if p_action='reports.system' then
  if p_payload ? 'contractId' and nullif(p_payload->>'contractId','') is null then raise exception 'Contrato explícito inválido.' using errcode='22023';end if;
  return pi_gestao_private.ga_system_report_scoped(p_tenant,(p_payload->>'ownerId')::uuid,nullif(p_payload->>'systemId','')::uuid,nullif(p_payload->>'campaignId','')::uuid,nullif(p_payload->>'contractId','')::uuid);
 end if;
 if p_action is null or p_action not like 'execution.%' then
  -- Historical import remains a separate path. It cannot mutate or duplicate a
  -- managed execution, including calls through the old API operation names.
  if p_action in ('field_lvts.create','field_items.create','lvt_items.create','findings.create','photos.create','inspections.update','lvts.create','measurements.create') then
   own:=(p_payload->>'ownerId')::uuid;
   perform pi_gestao_private.ga_require_access(p_tenant,true);
   perform pi_gestao_private.ga_owner(p_tenant,own);
   perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=own for update;
   if p_action in ('field_lvts.create','lvts.create','measurements.create') then managed_inspection:=nullif(p_payload->>'inspectionId','')::uuid;
   elsif p_action='inspections.update' then managed_inspection:=nullif(p_payload->>'id','')::uuid;
   elsif p_action in ('field_items.create','lvt_items.create') then
    select z.inspection_id into managed_inspection from pi_gestao_private.inspection_executions z where z.tenant_id=p_tenant and z.owner_id=own and z.execution_id=nullif(p_payload->>'lvtId','')::uuid;
   else
    select z.inspection_id into managed_inspection from pi_gestao_private.inspection_executions z join pi_gestao_private.records r on r.tenant_id=z.tenant_id and r.owner_id=z.owner_id and r.body->>'lvtId'=z.execution_id::text where r.id=nullif(p_payload->>'lvtItemId','')::uuid and z.tenant_id=p_tenant and z.owner_id=own;
   end if;
   if managed_inspection is not null and exists(select 1 from pi_gestao_private.inspection_executions z where z.tenant_id=p_tenant and z.owner_id=own and z.inspection_id=managed_inspection) then
    d:=pi_gestao_private.ga_execution_detail(p_tenant,own,managed_inspection);
    if p_action<>'photos.create' or d->>'canExecute' is distinct from 'true' or d->'execution'->>'status' is distinct from 'rascunho' then raise exception 'Utilize a ficha de execução; dados gerenciados não podem ser alterados pelo fluxo histórico.' using errcode='42501';end if;
   end if;
  end if;
  return pi_gestao_private.ga_api_projects(p_tenant,p_action,p_payload);
 end if;
 if p_action not in ('execution.list','execution.get','execution.assign','execution.start','execution.save','execution.submit','execution.catalog') then raise exception 'Operação de execução indisponível.' using errcode='0A000';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'Payload inválido.' using errcode='22023';end if;
 actor:=pi_gestao_private.ga_require_access(p_tenant,false);
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,actor);manager:=cap->>'role' in ('admin','master');
 own:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,own);
 select * into person from pi_team_private.professionals where tenant_id=p_tenant and user_id=actor and registration_state='active' and access_revoked_at is null;
 if p_action='execution.list' then
  if not manager and person.id is null then raise exception 'Perfil profissional ativo necessário.' using errcode='42501';end if;
  select coalesce(jsonb_agg(r.body||jsonb_build_object('id',r.id,'version',r.version,'assigneeName',p.name,'assigneeAccessLinked',p.user_id is not null,'executionId',x.execution_id,'executionStatus',er.body->>'status','technicalReviewRequired',coalesce((er.body->>'technicalReviewRequired')::boolean,false),'progress',coalesce(er.body->'progress',jsonb_build_object('answered',0,'total',0))) order by r.seq),'[]') into result
  from pi_gestao_private.records r
  join pi_gestao_private.records con on con.tenant_id=r.tenant_id and con.owner_id=r.owner_id and con.id=nullif(r.body->>'contractId','')::uuid and con.kind='contract'
  join pi_gestao_private.records campaign on campaign.tenant_id=r.tenant_id and campaign.owner_id=r.owner_id and campaign.id=nullif(r.body->>'campaignId','')::uuid and campaign.kind='campaign'
  left join pi_team_private.professionals p on p.tenant_id=r.tenant_id and p.id=nullif(r.body->>'assigneeProfessionalId','')::uuid
  left join pi_gestao_private.inspection_executions x on x.tenant_id=r.tenant_id and x.owner_id=r.owner_id and x.inspection_id=r.id
  left join pi_gestao_private.records er on er.tenant_id=x.tenant_id and er.owner_id=x.owner_id and er.id=x.execution_id
  where r.tenant_id=p_tenant and r.owner_id=own and r.kind='inspection'
  and pi_gestao_private.ga_execution_scope_matches(r.body,con.body||jsonb_build_object('id',con.id),campaign.body||jsonb_build_object('id',campaign.id))
  and (manager or r.body->>'assigneeProfessionalId'=person.id::text);
  return jsonb_build_object('actorUserId',actor,'professionalId',person.id,'canAssign',manager and cap->>'write'='true','writeAllowed',cap->>'write'='true','inspections',result,
   'professionals',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'registrationState',p.registration_state,'accessLinked',p.user_id is not null) order by p.name) from pi_team_private.professionals p where p.tenant_id=p_tenant and p.registration_state='active' and p.access_revoked_at is null),'[]') else '[]'::jsonb end);
 end if;
 inspection_id:=(p_payload->>'inspectionId')::uuid;
 d:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);i:=d->'inspection';
 if p_action='execution.get' then return d;end if;
 if p_action='execution.catalog' then return d->'catalog';end if;
 -- Never turn an assignment into a persistent permission grant.
 perform pi_gestao_private.ga_require_access(p_tenant,true);
 if p_action='execution.assign' then
  if not manager then raise exception 'Atribuição exige gestão autorizada.' using errcode='42501';end if;
 elsif d->>'canExecute' is distinct from 'true' then raise exception 'Execução exige o responsável atribuído e permissão atual de gravação.' using errcode='42501';end if;
 if i->>'type' not in ('visual','espessura') or i->>'module' is distinct from 'integridade' then raise exception 'Modalidade de execução não coberta por esta ficha.' using errcode='22023';end if;
 request_id:=(p_payload->>'requestId')::uuid;if request_id is null then raise exception 'Identificador estável obrigatório.' using errcode='22023';end if;
 digest:=pi_gestao_private.ga_hash(p_payload);
 -- Serialize starts, assignment and all related item/RTI changes for this owner.
 perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=own for update;
 d:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);i:=d->'inspection';e:=d->'execution';cat:=d->'catalog';
 if p_action<>'execution.assign' and d->>'canExecute' is distinct from 'true' then raise exception 'A atribuição mudou; reabra a atividade.' using errcode='42501';end if;
 select * into receipt from pi_gestao_private.operation_receipts where tenant_id=p_tenant and owner_id=own and action=p_action and operation_receipts.request_id=ga_api_execution.request_id;
 if found then
  if receipt.digest<>digest or receipt.actor_user_id<>actor then raise exception 'Operação já recebida com outro conteúdo.' using errcode='23505';end if;
  return pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);
 end if;
 if p_action='execution.assign' then
  if e->>'id' is not null and nullif(p_payload->>'professionalId','') is distinct from i->>'assigneeProfessionalId' then raise exception 'Atividade iniciada exige revisão técnica antes de trocar o responsável.' using errcode='22023';end if;
  if e->>'id' is not null and (jsonb_array_length(coalesce(e->'answers','[]'))>0 or jsonb_array_length(coalesce(e->'readings','[]'))>0 or e->>'status'<>'rascunho') then raise exception 'Atividade com respostas exige revisão antes de reatribuir.' using errcode='22023';end if;
  if i->>'status'='concluida' then raise exception 'Atividade concluída não pode ser reatribuída.' using errcode='22023';end if;
  select * into person from pi_team_private.professionals where tenant_id=p_tenant and id=nullif(p_payload->>'professionalId','')::uuid and registration_state='active' and access_revoked_at is null;
  if nullif(p_payload->>'professionalId','') is not null and person.id is null then raise exception 'Selecione profissional ativo do cadastro existente.' using errcode='22023';end if;
  perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(p_payload->>'expectedVersion')::bigint,jsonb_build_object('assigneeProfessionalId',person.id,'assigneeName',person.name,'assignedAt',now(),'assignedBy',actor),actor,'responsável da inspeção atribuído');
 elsif p_action='execution.start' then
  if i->>'status'='concluida' then raise exception 'Atividade concluída; abra reinspeção justificada.' using errcode='22023';end if;
  if e->>'id' is null then
   if exists(select 1 from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='lvt' and r.body->>'inspectionId'=inspection_id::text and r.body->>'recordClass'='field_lvt') then raise exception 'Já existe LVT de campo desta atividade; vinculação do rascunho exige revisão, sem duplicação automática.' using errcode='22023';end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   source:=jsonb_build_object('format','field_record','actorUserId',actor);
   scope:=jsonb_build_object('assetId',i->>'assetId','inspectionId',i->>'id','campaignId',i->>'campaignId','contractId',i->>'contractId','systemId',i->>'systemId','module',i->>'module');
   e:=pi_gestao_private.ga_put(p_tenant,own,kind,scope||jsonb_build_object('recordClass',case when kind='lvt' then 'field_lvt' else 'measurement_draft' end,'executionVersion',1,'type',i->>'type','status','rascunho','source',source,'inspectorProfessionalId',i->>'assigneeProfessionalId','inspector',i->>'assigneeName','answers','[]'::jsonb,'readings','[]'::jsonb,'items','[]'::jsonb,'catalogId',cat->>'id','technicalReviewRequired',false,'createdAt',now(),'createdBy',actor),actor);
   insert into pi_gestao_private.inspection_executions(tenant_id,owner_id,inspection_id,execution_id,execution_kind,catalog_id) values(p_tenant,own,inspection_id,(e->>'id')::uuid,kind,nullif(cat->>'id','')::uuid);
   if kind='lvt' then perform pi_gestao_private.ga_link(p_tenant,own,(e->>'id')::uuid,kind,inspection_id,'inspection','records_inspection',actor);end if;
   if kind='lvt' then
    for item in select value from jsonb_array_elements(cat->'items') loop
     shell:=pi_gestao_private.ga_put(p_tenant,own,'lvt_item',scope||jsonb_build_object('lvtId',e->>'id','executionId',e->>'id','recordClass','field_checklist_item','catalogItemId',item->>'id','itemKey',item->>'itemKey','component',item->>'component','description',null,'conditionId',null,'recommendationId',null,'status','pendente','source',source,'photoIds','[]'::jsonb),actor);
     perform pi_gestao_private.ga_link(p_tenant,own,(shell->>'id')::uuid,'lvt_item',(e->>'id')::uuid,'lvt','part_of_lvt',actor);
     item_refs:=item_refs||jsonb_build_array(jsonb_build_object('catalogItemId',item->>'id','itemKey',item->>'itemKey','lvtItemId',shell->>'id'));
    end loop;
    perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,'lvt',1,jsonb_build_object('items',item_refs,'progress',jsonb_build_object('answered',0,'total',jsonb_array_length(item_refs))),actor,'itens pendentes da LVT preparados');
   end if;
   perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(i->>'version')::bigint,jsonb_build_object('status','em_andamento','executionId',e->>'id'),actor,'inspeção iniciada');
  end if;
 else
  if e->>'id' is null then raise exception 'Inicie a inspeção antes de salvar.' using errcode='22023';end if;
  if e->>'status' is distinct from 'rascunho' then raise exception 'Ficha enviada para revisão; edição exige devolução técnica.' using errcode='22023';end if;
  if (e->>'version')::bigint is distinct from (p_payload->>'expectedVersion')::bigint then raise exception 'Rascunho alterado; reabra antes de salvar.' using errcode='40001';end if;
  if p_action='execution.submit' then
   if i->>'type'='visual' and (cat->>'status' is distinct from 'verified' or jsonb_array_length(cat->'items')=0 or jsonb_array_length(coalesce(e->'answers','[]'))<>jsonb_array_length(cat->'items') or exists(select 1 from jsonb_array_elements(e->'answers') a where nullif(a->>'conditionId','') is null and a->>'notCovered' is distinct from 'true')) then raise exception 'Cada item precisa de resposta de catálogo conferido ou encaminhamento à gestão técnica.' using errcode='22023';end if;
   if i->>'type'='espessura' and (jsonb_array_length(coalesce(e->'readings','[]'))=0 or nullif(e->>'instrument','') is null) then raise exception 'Medição planejada continua pendente sem instrumento e leituras.' using errcode='22023';end if;
   if nullif(e->>'observedOn','') is null then raise exception 'Informe a data observada antes de enviar.' using errcode='22023';end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,kind,(e->>'version')::bigint,jsonb_build_object('status','em_revisao','submittedAt',now(),'submittedBy',actor,'signatureStatus','pendente'),actor,'ficha enviada para revisão técnica');
   perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(i->>'version')::bigint,jsonb_build_object('executionStatus','em_revisao'),actor,'execução aguardando revisão');
  else
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('ownerId','inspectionId','requestId','expectedVersion','answers','observedOn','instrument','readings')) then raise exception 'Campo de execução não reconhecido; frases livres não são aceitas.' using errcode='22023';end if;
   observed:=pi_gestao_private.ga_date(p_payload->>'observedOn','Data observada');if observed::date>current_date then raise exception 'Data observada futura.' using errcode='22023';end if;
   patch:=jsonb_build_object('observedOn',observed);
   if i->>'type'='visual' then
    if jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_array_length(p_payload->'answers')>1000 then raise exception 'Respostas inválidas.' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(coalesce(e->'answers','[]')) prior where not exists(select 1 from jsonb_array_elements(p_payload->'answers') next_answer where next_answer->>'catalogItemId'=prior->>'catalogItemId')) then raise exception 'Resposta salva não pode desaparecer implicitamente; envie a escolha vazia explicitamente para revisão.' using errcode='22023';end if;
    for answer in select value from jsonb_array_elements(p_payload->'answers') loop
     if exists(select 1 from jsonb_object_keys(answer) k where k not in ('itemKey','catalogItemId','conditionId','recommendationId','notCovered','photoIds')) then raise exception 'Resposta aceita somente escolhas do catálogo e fotos do item.' using errcode='22023';end if;
     select value into item from jsonb_array_elements(cat->'items') where value->>'id'=answer->>'catalogItemId';
     if item is null or item->>'itemKey' is distinct from answer->>'itemKey' or (item->>'id')=any(seen) then raise exception 'Item fora do catálogo conferido ou repetido.' using errcode='22023';end if;
     seen:=array_append(seen,item->>'id');
     select value into shell from jsonb_array_elements(e->'items') where value->>'catalogItemId'=item->>'id';
     item_id:=(shell->>'lvtItemId')::uuid;
     if jsonb_typeof(answer->'notCovered') is distinct from 'boolean' or jsonb_typeof(answer->'photoIds') is distinct from 'array' then raise exception 'Resposta explícita e lista de fotos obrigatórias.' using errcode='22023';end if;
     condition:=null;recommendation:=null;
     if answer->>'notCovered'='true' then
      if nullif(answer->>'conditionId','') is not null or nullif(answer->>'recommendationId','') is not null then raise exception 'Condição não contemplada deve seguir à gestão sem escolha falsa.' using errcode='22023';end if;
      review_needed:=true;
     else
      if nullif(answer->>'conditionId','') is not null then
       select value into condition from jsonb_array_elements(item->'conditions') where value->>'id'=answer->>'conditionId';
       if condition is null then raise exception 'Condição fora do catálogo conferido.' using errcode='22023';end if;
      end if;
      if nullif(answer->>'recommendationId','') is not null then
       select value into recommendation from jsonb_array_elements(item->'recommendations') where value->>'id'=answer->>'recommendationId';
       if recommendation is null or condition is null then raise exception 'Recomendação fora do catálogo ou sem condição respondida.' using errcode='22023';end if;
       if recommendation ? 'conditionIds' and not (recommendation->'conditionIds') ? (condition->>'id') then raise exception 'Recomendação não corresponde à condição na fonte conferida.' using errcode='22023';end if;
       if observed is null then raise exception 'Recomendação exige data observada.' using errcode='22023';end if;
       if regexp_replace(lower(btrim(recommendation->>'text')),'[[:punct:]]+$','','g') in ('sem recomendações','sem recomendacoes','não se aplica','nao se aplica','nenhuma','n/a','0','erro') then raise exception 'Texto sem ação não cria recomendação ou RTI.' using errcode='22023';end if;
       if jsonb_array_length(answer->'photoIds')=0 then raise exception 'Recomendação exige foto vinculada ao item.' using errcode='22023';end if;
      end if;
     end if;
     for photo_id in select value#>>'{}' from jsonb_array_elements(answer->'photoIds') loop
      photo:=pi_gestao_private.ga_record(p_tenant,own,photo_id::uuid,'photo');
      if photo->>'lvtItemId' is distinct from item_id::text or photo->>'assetId' is distinct from i->>'assetId' then raise exception 'Foto pertence a outro item ou TAG.' using errcode='42501';end if;
     end loop;
     normalized:=jsonb_build_object('catalogItemId',item->>'id','itemKey',item->>'itemKey','conditionId',condition->>'id','recommendationId',recommendation->>'id','notCovered',answer->'notCovered','photoIds',answer->'photoIds');
     if condition is not null or answer->>'notCovered'='true' then completed:=completed+1;end if;
     answers:=answers||jsonb_build_array(normalized);
     shell:=pi_gestao_private.ga_record(p_tenant,own,item_id,'lvt_item');
     scope:=jsonb_build_object('assetId',i->>'assetId','lvtId',e->>'id','inspectionId',i->>'id','campaignId',i->>'campaignId','contractId',i->>'contractId','systemId',i->>'systemId','module',i->>'module','lvtItemId',item_id);
     source:=jsonb_build_object('format','field_record','actorUserId',actor,'observedOn',observed,'catalogId',cat->>'id');
     perform pi_gestao_private.ga_change(p_tenant,own,item_id,'lvt_item',(shell->>'version')::bigint,normalized||jsonb_build_object('description',condition->>'text','conditionSource',condition->'source','recommendationSource',recommendation->'source','status',case when answer->>'notCovered'='true' then 'gestao_tecnica_pendente' when condition is null then 'pendente' else 'respondido' end,'technicalReviewRequired',answer->'notCovered','source',source),actor,'resposta de item da LVT salva');
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into prior_rti from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
     if recommendation is not null then
      select r.body||jsonb_build_object('id',r.id,'version',r.version) into finding from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='finding' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
      patch:=scope||jsonb_build_object('executionId',e->>'id','description',condition->>'text','recommendation',recommendation->>'text','recommendationId',recommendation->>'id','recommendationSource',recommendation->'source','photoIds',answer->'photoIds','source',source,'sourceDate',observed);
      if finding is null then finding:=pi_gestao_private.ga_put(p_tenant,own,'finding',patch,actor);else finding:=pi_gestao_private.ga_change(p_tenant,own,(finding->>'id')::uuid,'finding',(finding->>'version')::bigint,patch,actor,'recomendação do item atualizada');end if;
      patch:=patch||jsonb_build_object('findingId',finding->>'id','title',recommendation->>'text','originType','field_recommendation','technicalReviewRequired',false,'recommendationWithdrawn',false);
      if prior_rti is null then
       rti:=pi_gestao_private.ga_put(p_tenant,own,'rti',patch||jsonb_build_object('status',case when observed::date=current_date then 'aberta' else 'atualidade_desconhecida' end,'currentness',case when observed::date=current_date then 'confirmed_current' else 'unknown' end,'sourceStatus','Recomendação selecionada na ficha de campo','currentnessConfirmedAt',case when observed::date=current_date then now() else null end,'currentnessEvidence','Seleção registrada pelo responsável autenticado; revisão técnica pendente.','actions','[]'::jsonb,'history','[]'::jsonb),actor);
       perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',item_id,'lvt_item','addresses_item',actor);
       perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',(finding->>'id')::uuid,'finding','addresses',actor);
      else
       if prior_rti->>'status'='encerrada' and (prior_rti->>'recommendationId' is distinct from recommendation->>'id' or prior_rti->'photoIds' is distinct from answer->'photoIds') then raise exception 'RTI encerrada exige revisão técnica antes de alterar recomendação ou fotos.' using errcode='22023';end if;
       rti:=pi_gestao_private.ga_change(p_tenant,own,(prior_rti->>'id')::uuid,'rti',(prior_rti->>'version')::bigint,patch,actor,'mesma RTI atualizada pela recomendação do item');end if;
      perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',(i->>'assetId')::uuid,'asset','affects',actor);
     elsif prior_rti is not null then
      review_needed:=true;
      perform pi_gestao_private.ga_change(p_tenant,own,(prior_rti->>'id')::uuid,'rti',(prior_rti->>'version')::bigint,jsonb_build_object('technicalReviewRequired',true,'recommendationWithdrawn',true),actor,'retirada de recomendação em rascunho encaminhada à gestão; RTI preservada');
     end if;
    end loop;
    patch:=jsonb_build_object('observedOn',observed,'answers',answers,'progress',jsonb_build_object('answered',completed,'total',jsonb_array_length(cat->'items')),'technicalReviewRequired',review_needed);
   else
    if p_payload ? 'answers' and jsonb_array_length(p_payload->'answers')>0 then raise exception 'Atividade de espessura não aceita respostas de inspeção visual.' using errcode='22023';end if;
    readings:=coalesce(p_payload->'readings','[]');instrument:=nullif(btrim(p_payload->>'instrument'),'');
    if jsonb_typeof(readings)<>'array' or jsonb_array_length(readings)>1000 then raise exception 'Leituras inválidas.' using errcode='22023';end if;
    for reading in select value from jsonb_array_elements(readings) loop
     perform pi_gestao_private.ga_text(reading->>'point','Ponto documentado',200);
     if reading->>'unit' not in ('mm','in') or reading->>'unit' is null or coalesce(reading->>'value','') !~ '^\d+(\.\d+)?$' or (reading->>'value')::numeric<=0 then raise exception 'Leitura exige valor positivo e unidade documentada.' using errcode='22023';end if;
    end loop;
    patch:=jsonb_build_object('observedOn',observed,'instrument',instrument,'readings',readings,'progress',jsonb_build_object('answered',jsonb_array_length(readings),'total',null));
   end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,kind,(e->>'version')::bigint,patch,actor,'mesmo rascunho de execução salvo');
  end if;
 end if;
 result:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);
 insert into pi_gestao_private.operation_receipts(tenant_id,owner_id,action,request_id,digest,result,actor_user_id) values(p_tenant,own,p_action,ga_api_execution.request_id,digest,result,actor);
 return result;
end $$;

revoke all on function pi_gestao_private.ga_execution_catalog(uuid,uuid,uuid),pi_gestao_private.ga_execution_scope_matches(jsonb,jsonb,jsonb),pi_gestao_private.ga_system_report_scoped(uuid,uuid,uuid,uuid,uuid),pi_gestao_private.ga_execution_detail(uuid,uuid,uuid),pi_gestao_private.ga_api_execution(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke execute on function pi_gestao_private.ga_api(uuid,text,jsonb),pi_gestao_private.ga_api_operational(uuid,text,jsonb),pi_gestao_private.ga_api_prepared(uuid,text,jsonb),pi_gestao_private.ga_api_projects(uuid,text,jsonb) from authenticated;
grant execute on function pi_gestao_private.ga_api_execution(uuid,text,jsonb) to authenticated;
create or replace function public.pi_gestao_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select pi_gestao_private.ga_api_execution(p_tenant,p_action,p_payload);
end;
commit;
