-- REVIEW CANDIDATE ONLY: not applied to production and not a generated migration.
-- Supabase CLI cannot start here because /home/agent/.supabase is read-only.
-- Generate a migration with the supported CLI before rollout. Apply only to an
-- isolated development database while reviewing this candidate.
-- Existing pilot, identity and licence checks remain authoritative. Administrative
-- writes remain admin/master-only. Active inspectors get only operations on their
-- current assigned execution, through explicit scoped routes; never generic POSTs.
-- No memberships, pilot grants, accounts, licences or credentials are seeded.
-- Day/15-day programming policy is pending definition, not inferred here.
-- Proposed API ACL delta for review: direct authenticated EXECUTE on the four
-- legacy private dispatchers is revoked; public.pi_gestao_api retains access
-- through the new wrapper. Without this delta legacy dispatchers bypass managed
-- draft guards. This is tested only in transient isolated local databases.
-- No real catalogue is seeded. A complete curated source must be inspected and
-- reviewed before a catalogue is installed; arbitrary historical text is not a
-- catalogue. Executions retain the selected catalogue ID. Privileged catalogue
-- mutation is not prevented by this candidate; do not claim immutable original
-- bytes or install a real catalogue without applicability and version controls.
-- The declared inspection date is only a deadline anchor, never a calculated
-- deadline or a risk classification. No matrix, calendar or default interval is
-- activated here; existing recorded deadlines are preserved for technical review.
begin;

create table pi_gestao_private.inspection_catalogs (
 tenant_id uuid not null, owner_id uuid not null, id uuid not null default gen_random_uuid(),
 source_id text not null, source_locator jsonb not null,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 1000),
 verified_by uuid not null references auth.users(id), verified_at timestamptz not null,
 active boolean not null default true,
 version_label text, procedure_reference text, applicability jsonb,
 primary key(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id) references pi_gestao_private.owners(tenant_id,id),
 foreign key(tenant_id,source_id) references pi_gestao_private.sources(tenant_id,id),
 check(jsonb_typeof(source_locator)='object')
);
create table pi_gestao_private.inspection_catalog_bindings (
 tenant_id uuid not null, owner_id uuid not null, id uuid not null default gen_random_uuid(),
 inspection_id uuid not null, catalog_id uuid not null, source_id text not null,
 snapshot jsonb not null,content_hash text not null,scope jsonb not null,
 selected_by uuid not null references auth.users(id),selected_at timestamptz not null default now(),selection_version bigint not null check(selection_version>0),
 primary key(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id,inspection_id) references pi_gestao_private.records(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id,catalog_id) references pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id),
 foreign key(tenant_id,source_id) references pi_gestao_private.sources(tenant_id,id),
 check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=2000000 and content_hash=pi_gestao_private.ga_hash(snapshot)),
 check((snapshot->>'id'=catalog_id::text and snapshot->>'tenantId'=tenant_id::text and snapshot->>'ownerId'=owner_id::text and snapshot->'source'->>'sourceId'=source_id) is true),
 check((jsonb_typeof(scope)='object' and scope->>'inspectionId'=inspection_id::text and scope->>'ownerId'=owner_id::text) is true)
);
create table pi_gestao_private.inspection_executions (
 tenant_id uuid not null, owner_id uuid not null, inspection_id uuid not null,
 execution_id uuid not null, execution_kind text not null check(execution_kind in ('lvt','document')),
 catalog_id uuid, catalog_binding_id uuid,
 primary key(tenant_id,owner_id,inspection_id), unique(tenant_id,owner_id,execution_id),
 foreign key(tenant_id,owner_id,inspection_id) references pi_gestao_private.records(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id,execution_id,execution_kind) references pi_gestao_private.records(tenant_id,owner_id,id,kind),
 foreign key(tenant_id,owner_id,catalog_id) references pi_gestao_private.inspection_catalogs(tenant_id,owner_id,id),
 foreign key(tenant_id,owner_id,catalog_binding_id) references pi_gestao_private.inspection_catalog_bindings(tenant_id,owner_id,id)
);
alter table pi_gestao_private.inspection_catalogs enable row level security;
alter table pi_gestao_private.inspection_catalog_bindings enable row level security;
alter table pi_gestao_private.inspection_executions enable row level security;
revoke all on pi_gestao_private.inspection_catalogs,pi_gestao_private.inspection_executions,pi_gestao_private.inspection_catalog_bindings from public,anon,authenticated,service_role;

create function pi_gestao_private.ga_catalog_binding_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 raise exception 'Vínculo de catálogo é imutável; selecione nova versão explicitamente antes do início, preservando o histórico.' using errcode='55000';
end $$;
create trigger inspection_catalog_binding_immutable before update or delete on pi_gestao_private.inspection_catalog_bindings
for each row execute function pi_gestao_private.ga_catalog_binding_immutable();

create function pi_gestao_private.ga_execution_validate_catalog(p_tenant uuid,p_owner uuid,p_catalog jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare s pi_gestao_private.sources; item jsonb; choice jsonb; seen text[]:='{}'; choice_ids text[];loc jsonb;
begin
 if jsonb_typeof(p_catalog) is distinct from 'object' or p_catalog->>'tenantId' is distinct from p_tenant::text or p_catalog->>'ownerId' is distinct from p_owner::text
 or jsonb_typeof(p_catalog->'id') is distinct from 'string' or p_catalog->>'id' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 or p_catalog->>'status' is distinct from 'verified' or jsonb_typeof(p_catalog->'source'->'locator') is distinct from 'object' or p_catalog->'source'->'locator'='{}'::jsonb
 or jsonb_typeof(p_catalog->'items') is distinct from 'array' or jsonb_array_length(p_catalog->'items') not between 1 and 1000
 then raise exception 'Catálogo fora do escopo ou sem itens conferidos.' using errcode='22023';end if;
 select * into s from pi_gestao_private.sources where tenant_id=p_tenant and id=p_catalog->'source'->>'sourceId';
 if s.id is null or p_catalog->'source'->>'fileHash' is distinct from s.id or p_catalog->'source'->>'fileName' is distinct from s.name
 or coalesce(s.workbook->>'format','xlsx') not in ('xlsx','document_xlsx','document_pdf')
 or not exists(select 1 from storage.objects where bucket_id='pi-gestao-sources' and name=s.object_key)
 then raise exception 'Original do catálogo indisponível ou divergente.' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_catalog->'items') loop
  perform pi_gestao_private.ga_text(item->>'id','Identidade do item do catálogo',200);
  perform pi_gestao_private.ga_text(item->>'itemKey','Número do item do catálogo',100);
  perform pi_gestao_private.ga_text(item->>'component','Componente do catálogo',1000);
  if (item->>'id')=any(seen) or jsonb_typeof(item->'conditions') is distinct from 'array' or jsonb_array_length(item->'conditions')=0
  or jsonb_typeof(item->'recommendations') is distinct from 'array' then raise exception 'Catálogo incompleto ou com identidade duplicada.' using errcode='22023';end if;
  seen:=array_append(seen,item->>'id');choice_ids:='{}';
  for choice in select value from jsonb_array_elements((item->'conditions')||(item->'recommendations')) loop
   perform pi_gestao_private.ga_text(choice->>'id','Identidade da frase',200);
   perform pi_gestao_private.ga_text(choice->>'text','Frase documental',10000);loc:=choice->'source'->'locator';
   if (choice->>'id')=any(choice_ids) or choice->'source'->>'sourceId' is distinct from s.id or choice->'source'->>'fileHash' is distinct from s.id
   or jsonb_typeof(loc) is distinct from 'object' or loc='{}'::jsonb then raise exception 'Frase sem proveniência documental conferida.' using errcode='22023';end if;
   if (choice ? 'requiresTreatment' and jsonb_typeof(choice->'requiresTreatment') is distinct from 'boolean')
   or (choice ? 'supportsGoodCondition' and jsonb_typeof(choice->'supportsGoodCondition') is distinct from 'boolean')
   then raise exception 'Metadado de tratativa ou boas condições deve ser booleano declarado pela curadoria.' using errcode='22023';end if;
   choice_ids:=array_append(choice_ids,choice->>'id');
  end loop;
 end loop;
 return p_catalog;
end $$;

create function pi_gestao_private.ga_execution_catalog(p_tenant uuid,p_owner uuid,p_id uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare c pi_gestao_private.inspection_catalogs; s pi_gestao_private.sources;result jsonb;
begin
 if p_id is null then return jsonb_build_object('id',null,'items','[]'::jsonb,'status','unavailable','reason','Seleção explícita de catálogo aplicável e versionado pela gestão ainda pendente.');end if;
 select * into c from pi_gestao_private.inspection_catalogs where tenant_id=p_tenant and owner_id=p_owner and id=p_id;
 if not found then raise exception 'Catálogo selecionado não pertence ao cliente/tenant.' using errcode='22023';end if;
 select * into s from pi_gestao_private.sources where tenant_id=p_tenant and id=c.source_id;
 result:=jsonb_build_object('id',c.id,'tenantId',p_tenant,'ownerId',p_owner,'status','verified','items',c.items,
  'source',jsonb_build_object('sourceId',s.id,'fileHash',s.id,'fileName',s.name,'locator',c.source_locator),'verifiedAt',c.verified_at,
  'versionLabel',c.version_label,'procedureReference',c.procedure_reference,'applicability',c.applicability);
 return pi_gestao_private.ga_execution_validate_catalog(p_tenant,p_owner,result);
end $$;

create function pi_gestao_private.ga_execution_catalog_applicable(p_catalog jsonb,p_inspection jsonb,p_asset jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;ap jsonb:=p_catalog->'applicability';
begin
 if jsonb_typeof(p_catalog->'versionLabel') is distinct from 'string' or length(btrim(p_catalog->>'versionLabel')) not between 1 and 100
 or jsonb_typeof(p_catalog->'procedureReference') is distinct from 'string' or length(btrim(p_catalog->>'procedureReference')) not between 1 and 1000
 or jsonb_typeof(ap) is distinct from 'object' then return false;end if;
 if exists(select 1 from jsonb_object_keys(ap) key where key not in ('inspectionTypes','assetTypes','contractIds','assetIds')) then return false;end if;
 foreach k in array array['inspectionTypes','assetTypes','contractIds','assetIds'] loop
  if jsonb_typeof(ap->k) is distinct from 'array' then return false;end if;
  if jsonb_array_length(ap->k)=0 then return false;end if;
  for v in select value from jsonb_array_elements(ap->k) loop
   if jsonb_typeof(v) is distinct from 'string' or length(btrim(v#>>'{}'))=0 then return false;end if;
   if k in ('contractIds','assetIds') and (v#>>'{}') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then return false;end if;
  end loop;
 end loop;
 return coalesce((ap->'inspectionTypes') ? (p_inspection->>'type') and (ap->'assetTypes') ? (p_asset->>'type')
  and (ap->'contractIds') ? (p_inspection->>'contractId') and (ap->'assetIds') ? (p_inspection->>'assetId'),false);
end;
$$;

create function pi_gestao_private.ga_execution_catalog_binding_json(p_binding pi_gestao_private.inspection_catalog_bindings)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('status','pinned','id',p_binding.id,'catalogId',p_binding.catalog_id,'contentHash',p_binding.content_hash,
  'versionLabel',p_binding.snapshot->>'versionLabel','procedureReference',p_binding.snapshot->>'procedureReference',
  'selectedAt',p_binding.selected_at,'selectedBy',p_binding.selected_by,'selectionVersion',p_binding.selection_version,'scope',p_binding.scope);
$$;

create function pi_gestao_private.ga_execution_catalog_state(p_tenant uuid,p_owner uuid,p_inspection jsonb,p_execution jsonb,p_binding_id uuid,p_catalog_id uuid,p_can_select boolean)
returns jsonb language plpgsql set search_path='' as $$
declare b pi_gestao_private.inspection_catalog_bindings;c jsonb;binding jsonb;choices jsonb:='[]';candidate record;asset jsonb;
begin
 if p_inspection->>'type'<>'visual' then return jsonb_build_object('catalog',jsonb_build_object('id',null,'items','[]'::jsonb,'status','not_applicable'),'catalogBinding',jsonb_build_object('status','not_applicable'),'catalogChoices','[]'::jsonb,'canSelectCatalog',false,'legacyReadOnly',false);end if;
 asset:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_inspection->>'assetId')::uuid,'asset');
 if p_execution->>'id' is not null and p_binding_id is null then
  c:=case when p_catalog_id is null then pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,null) else pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,p_catalog_id) end;
  return jsonb_build_object('catalog',c,'catalogBinding',jsonb_build_object('status','legacy_unpinned','reason','Rascunho legado sem vínculo imutável; leitura preservada, migração exige revisão explícita.'),'catalogChoices','[]'::jsonb,'canSelectCatalog',false,'legacyReadOnly',true);
 end if;
 if p_binding_id is null then p_binding_id:=nullif(p_inspection->>'catalogBindingId','')::uuid;end if;
 if p_binding_id is not null then
  select * into b from pi_gestao_private.inspection_catalog_bindings where tenant_id=p_tenant and owner_id=p_owner and inspection_id=(p_inspection->>'id')::uuid and id=p_binding_id;
  if b.id is null or b.content_hash is distinct from pi_gestao_private.ga_hash(b.snapshot)
  or b.scope->>'assetId' is distinct from p_inspection->>'assetId' or b.scope->>'contractId' is distinct from p_inspection->>'contractId'
  or b.scope->>'systemId' is distinct from p_inspection->>'systemId' or b.scope->>'inspectionType' is distinct from p_inspection->>'type' or b.scope->>'assetType' is distinct from asset->>'type'
  then raise exception 'Vínculo imutável do catálogo diverge do escopo da inspeção.' using errcode='22023';end if;
  if p_execution->>'id' is not null and (p_execution->>'catalogBindingId' is distinct from b.id::text or p_execution->>'catalogHash' is distinct from b.content_hash
   or p_execution->>'catalogVersion' is distinct from b.snapshot->>'versionLabel' or p_execution->>'catalogId' is distinct from b.catalog_id::text or p_catalog_id is distinct from b.catalog_id)
  then raise exception 'Execução diverge do vínculo imutável do catálogo.' using errcode='22023';end if;
  c:=pi_gestao_private.ga_execution_validate_catalog(p_tenant,p_owner,b.snapshot);binding:=pi_gestao_private.ga_execution_catalog_binding_json(b);
 else
  c:=pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,null);binding:=jsonb_build_object('status','not_selected','reason','Gestão deve selecionar explicitamente versão e aplicabilidade antes de iniciar.');
 end if;
 if p_can_select and p_execution->>'id' is null then
  for candidate in select id from pi_gestao_private.inspection_catalogs where tenant_id=p_tenant and owner_id=p_owner and active order by verified_at desc,id loop
   declare cc jsonb;begin
    cc:=pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,candidate.id);
    if pi_gestao_private.ga_execution_catalog_applicable(cc,p_inspection,asset) then
     choices:=choices||jsonb_build_array(jsonb_build_object('id',cc->>'id','versionLabel',cc->>'versionLabel','procedureReference',cc->>'procedureReference','contentHash',pi_gestao_private.ga_hash(cc),'sourceFileName',cc->'source'->>'fileName'));
    end if;
   exception when sqlstate '22023' then null;end;
  end loop;
 end if;
 return jsonb_build_object('catalog',c,'catalogBinding',binding,'catalogChoices',choices,'canSelectCatalog',p_can_select and p_execution->>'id' is null,'legacyReadOnly',false);
end $$;

create function pi_gestao_private.ga_execution_select_catalog(p_tenant uuid,p_owner uuid,p_inspection jsonb,p_payload jsonb,p_actor uuid)
returns void language plpgsql set search_path='' as $$
declare c jsonb;asset jsonb;b pi_gestao_private.inspection_catalog_bindings;prior pi_gestao_private.inspection_catalog_bindings;catalog_hash text;scope jsonb;version bigint;cap jsonb;
begin
 if pi_gestao_private.ga_require_access(p_tenant,true) is distinct from p_actor then raise exception 'Ator inválido.' using errcode='42501';end if;
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,p_actor);
 if cap->>'role' not in ('admin','master') or cap->>'write' is distinct from 'true' then raise exception 'Seleção de catálogo exige gestão autorizada.' using errcode='42501';end if;
 if p_inspection->>'type'<>'visual' then raise exception 'Catálogo LVT não se aplica à medição de espessura.' using errcode='22023';end if;
 if exists(select 1 from pi_gestao_private.inspection_executions where tenant_id=p_tenant and owner_id=p_owner and inspection_id=(p_inspection->>'id')::uuid)
 or p_inspection->>'status'='concluida' then raise exception 'Catálogo de execução iniciada não pode ser trocado; revisão explícita é necessária.' using errcode='22023';end if;
 version:=(p_inspection->>'version')::bigint;
 if version is distinct from (p_payload->>'expectedVersion')::bigint then raise exception 'Inspeção alterada; reabra antes de selecionar catálogo.' using errcode='40001';end if;
 c:=pi_gestao_private.ga_execution_catalog(p_tenant,p_owner,(p_payload->>'catalogId')::uuid);
 if c->>'id' is null or not exists(select 1 from pi_gestao_private.inspection_catalogs where tenant_id=p_tenant and owner_id=p_owner and id=(c->>'id')::uuid and active) then raise exception 'Selecione catálogo ativo e conferido.' using errcode='22023';end if;
 asset:=pi_gestao_private.ga_record(p_tenant,p_owner,(p_inspection->>'assetId')::uuid,'asset');
 if not pi_gestao_private.ga_execution_catalog_applicable(c,p_inspection,asset) then raise exception 'Catálogo exige versão, procedimento e aplicabilidade explícitos para modalidade, equipamento, contrato e TAG.' using errcode='22023';end if;
 catalog_hash:=pi_gestao_private.ga_hash(c);
 if jsonb_typeof(p_payload->'expectedCatalogHash') is distinct from 'string' or p_payload->>'expectedCatalogHash' is distinct from catalog_hash then raise exception 'Conteúdo do catálogo mudou; confira novamente antes de selecionar.' using errcode='40001';end if;
 if exists(select 1 from pi_gestao_private.inspection_catalog_bindings where tenant_id=p_tenant and owner_id=p_owner and catalog_id=(c->>'id')::uuid and snapshot->>'versionLabel'=c->>'versionLabel' and content_hash<>catalog_hash)
 then raise exception 'Versão de catálogo já vinculada tem outro conteúdo; publique nova versão explícita.' using errcode='22023';end if;
 select * into prior from pi_gestao_private.inspection_catalog_bindings where tenant_id=p_tenant and owner_id=p_owner and id=nullif(p_inspection->>'catalogBindingId','')::uuid;
 if prior.id is not null and prior.content_hash=catalog_hash then return;end if;
 scope:=jsonb_build_object('ownerId',p_owner,'inspectionId',p_inspection->>'id','contractId',p_inspection->>'contractId','systemId',p_inspection->>'systemId','assetId',p_inspection->>'assetId','inspectionType',p_inspection->>'type','assetType',asset->>'type');
 insert into pi_gestao_private.inspection_catalog_bindings(tenant_id,owner_id,inspection_id,catalog_id,source_id,snapshot,content_hash,scope,selected_by,selection_version)
 values(p_tenant,p_owner,(p_inspection->>'id')::uuid,(c->>'id')::uuid,c->'source'->>'sourceId',c,catalog_hash,scope,p_actor,version+1) returning * into b;
 perform pi_gestao_private.ga_change(p_tenant,p_owner,(p_inspection->>'id')::uuid,'inspection',version,jsonb_build_object('catalogBindingId',b.id,'catalogId',b.catalog_id,'catalogHash',b.content_hash,'catalogVersion',c->>'versionLabel'),p_actor,'versão aplicável de catálogo selecionada explicitamente');
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
  return result||jsonb_build_object('reportScope',jsonb_build_object('mode',case when p_campaign is null then 'system_all_contracts' else 'campaign' end,'ownerId',p_owner,'contractId',result->'contract'->>'id','systemId',result->'system'->>'id','campaignId',p_campaign),'catalogBindings',(select coalesce(jsonb_agg(pi_gestao_private.ga_execution_catalog_binding_json(b)||jsonb_build_object('catalog',b.snapshot) order by b.id),'[]') from pi_gestao_private.inspection_catalog_bindings b where b.tenant_id=p_tenant and b.owner_id=p_owner and exists(select 1 from jsonb_array_elements(coalesce(result->'lvts','[]')) l where l->>'catalogBindingId'=b.id::text)));
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
 result:=result||jsonb_build_object('catalogBindings',(select coalesce(jsonb_agg(pi_gestao_private.ga_execution_catalog_binding_json(b)||jsonb_build_object('catalog',b.snapshot) order by b.id),'[]') from pi_gestao_private.inspection_catalog_bindings b where b.tenant_id=p_tenant and b.owner_id=p_owner and exists(select 1 from jsonb_array_elements(coalesce(result->'lvts','[]')) l where l->>'catalogBindingId'=b.id::text)));
 return result||jsonb_build_object('scopeDigest',pi_gestao_private.ga_hash(result),'generatedAt',statement_timestamp());
end $$;

-- Narrow actor/assignment capability. No memberships, pilot rows or licences are
-- created here. Programming-period policy remains a separate pending decision.
create function pi_gestao_private.ga_execution_actor_scope(p_tenant uuid,p_owner uuid,p_inspection uuid,p_actor uuid,p_write boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare cap jsonb;i jsonb;con jsonb;campaign jsonb;p pi_team_private.professionals;a pi_team_private.professionals;manager boolean;allowed boolean;
begin
 if p_write then
  perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=p_owner for update;
  perform 1 from pi_gestao_private.pilot_access where tenant_id=p_tenant and user_id=p_actor for share;
  perform 1 from public.pi_company_memberships where company_id=p_tenant and user_id=p_actor for share;
  perform 1 from pi_access_private.masters where user_id=p_actor for share;
  perform 1 from pi_team_private.professionals where tenant_id=p_tenant and user_id=p_actor for share;
 end if;
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,p_actor);manager:=cap->>'role' in ('admin','master');
 i:=pi_gestao_private.ga_record(p_tenant,p_owner,p_inspection,'inspection');
 if i->>'module' is distinct from 'integridade' or i->>'type' not in ('visual','espessura') then raise exception 'Modalidade não coberta por esta ficha.' using errcode='22023';end if;
 con:=pi_gestao_private.ga_record(p_tenant,p_owner,(i->>'contractId')::uuid,'contract');
 campaign:=pi_gestao_private.ga_record(p_tenant,p_owner,(i->>'campaignId')::uuid,'campaign');
 if not pi_gestao_private.ga_execution_scope_matches(i,con,campaign) then raise exception 'Atividade fora do escopo atual do contrato/campanha.' using errcode='42501';end if;
 select * into p from pi_team_private.professionals where tenant_id=p_tenant and user_id=p_actor and registration_state='active' and access_revoked_at is null;
 select * into a from pi_team_private.professionals where tenant_id=p_tenant and id=nullif(i->>'assigneeProfessionalId','')::uuid;
 if not manager and (p.id is null or i->>'assigneeProfessionalId' is distinct from p.id::text) then raise exception 'Inspeção não atribuída a este profissional.' using errcode='42501';end if;
 allowed:=p.id is not null and a.id=p.id and a.registration_state='active' and a.access_revoked_at is null and a.user_id=p_actor
  and ((manager and cap->>'write'='true') or (cap->>'role'='inspector' and p.functional_role='inspector'));
 if allowed then
  begin perform pi_access_private.tenant_write_guard();exception when insufficient_privilege then allowed:=false;end;
 end if;
 if p_write and allowed is not true then raise exception 'Execução exige inspetor ativo atribuído e capacidade atual da atividade.' using errcode='42501';end if;
 return jsonb_build_object('inspection',i,'contract',con,'campaign',campaign,'manager',manager,'professionalId',p.id,'canExecute',coalesce(allowed,false),'role',cap->>'role');
end $$;

create function pi_gestao_private.ga_execution_detail(p_tenant uuid,p_owner uuid,p_inspection uuid)
returns jsonb language plpgsql set search_path='' as $$
declare actor uuid; cap jsonb; i jsonb; e jsonb; cat jsonb; catalog_state jsonb; con jsonb; campaign jsonb; p pi_team_private.professionals;
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
 catalog_state:=pi_gestao_private.ga_execution_catalog_state(p_tenant,p_owner,i,e,x.catalog_binding_id,x.catalog_id,manager and cap->>'write'='true');cat:=catalog_state->'catalog';
 can_execute:=(pi_gestao_private.ga_execution_actor_scope(p_tenant,p_owner,p_inspection,actor,false)->>'canExecute')::boolean;
 reason:=case when not manager and (cap->>'role'<>'inspector' or p.functional_role is distinct from 'inspector') then 'A permissão atual permite consulta. A execução exige o perfil de inspetor atribuído.'
 when a.id is null then 'Inspeção ainda não atribuída.'
 when a.user_id is null then 'Profissional sem vínculo de acesso individual conferido.'
 when p.id is null or a.id<>p.id then 'A execução pertence ao profissional responsável atribuído.'
 when a.registration_state<>'active' or a.access_revoked_at is not null then 'Cadastro do responsável indisponível.' end;
 if catalog_state->>'legacyReadOnly'='true' then can_execute:=false;reason:=catalog_state->'catalogBinding'->>'reason';end if;
 return jsonb_build_object('inspection',i||jsonb_build_object('assigneeName',a.name,'assigneeAccessLinked',a.user_id is not null),
 'execution',e,'catalog',cat,'catalogBinding',catalog_state->'catalogBinding','catalogChoices',catalog_state->'catalogChoices','canSelectCatalog',catalog_state->'canSelectCatalog','outcomeWorkflowVersion',1,'points',coalesce((select jsonb_agg(r.body||jsonb_build_object('id',r.id,'version',r.version) order by r.seq) from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='document' and r.body->>'recordClass'='field_point_reference' and r.body->>'executionId'=e->>'id' and r.body->>'inspectionId'=i->>'id'),'[]'::jsonb),'actorUserId',actor,'professionalId',p.id,'canAssign',manager and cap->>'write'='true',
 'writeAllowed',(manager and cap->>'write'='true') or coalesce(can_execute,false),'administrativeWriteAllowed',cap->>'write'='true','canExecute',coalesce(can_execute,false),'executionBlockReason',reason,'inspectionScopeVersion',1,
 'professionals',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'registrationState',q.registration_state,'accessLinked',q.user_id is not null) order by q.name) from pi_team_private.professionals q where q.tenant_id=p_tenant and q.registration_state='active' and q.access_revoked_at is null),'[]') else '[]'::jsonb end);
end $$;

-- The inspector context is constructed from current assignments, never by
-- returning the generic owner snapshot and relying on client-side filtering.
create function pi_gestao_private.ga_execution_context(p_tenant uuid,p_owner uuid,p_inspection uuid default null)
returns jsonb language plpgsql set search_path='' as $$
#variable_conflict use_column
declare actor uuid;cap jsonb;manager boolean;person pi_team_private.professionals;r record;v jsonb;result jsonb;key text;
 inspection_ids text[]:='{}';asset_ids text[]:='{}';contract_ids text[]:='{}';campaign_ids text[]:='{}';system_ids text[]:='{}';unit_ids text[]:='{}';execution_ids text[]:='{}';item_ids text[]:='{}';selected_ids text[]:='{}';
begin
 actor:=pi_gestao_private.ga_require_access(p_tenant,false);cap:=pi_gestao_private.ga_access_for_actor(p_tenant,actor);manager:=cap->>'role' in ('admin','master');
 select * into person from pi_team_private.professionals where tenant_id=p_tenant and user_id=actor and registration_state='active' and access_revoked_at is null;
 if not manager and person.id is null then raise exception 'Perfil profissional ativo necessário.' using errcode='42501';end if;
 if p_inspection is not null then perform pi_gestao_private.ga_execution_actor_scope(p_tenant,p_owner,p_inspection,actor,false);end if;
 result:=jsonb_build_object('company',pi_gestao_private.ga_owner(p_tenant,p_owner),'inspectionScopeVersion',1,'scopeMode',case when manager then 'management' else 'assigned_inspector' end,'unit','[]'::jsonb,'system','[]'::jsonb,'asset','[]'::jsonb,'contract','[]'::jsonb,'campaign','[]'::jsonb,'inspection','[]'::jsonb,'lvt','[]'::jsonb,'lvtItem','[]'::jsonb,'photo','[]'::jsonb,'finding','[]'::jsonb,'rti','[]'::jsonb,'document','[]'::jsonb,'revision','[]'::jsonb,'classification','[]'::jsonb,'deadline','[]'::jsonb,'delivery','[]'::jsonb,'relation','[]'::jsonb);
 for r in select i.* from pi_gestao_private.records i
  join pi_gestao_private.records c on c.tenant_id=i.tenant_id and c.owner_id=i.owner_id and c.id::text=i.body->>'contractId' and c.kind='contract'
  join pi_gestao_private.records ca on ca.tenant_id=i.tenant_id and ca.owner_id=i.owner_id and ca.id::text=i.body->>'campaignId' and ca.kind='campaign'
  where i.tenant_id=p_tenant and i.owner_id=p_owner and i.kind='inspection' and (p_inspection is null or i.id=p_inspection)
   and (manager or i.body->>'assigneeProfessionalId'=person.id::text)
   and pi_gestao_private.ga_execution_scope_matches(i.body,c.body||jsonb_build_object('id',c.id),ca.body||jsonb_build_object('id',ca.id)) order by i.seq
 loop
  inspection_ids:=array_append(inspection_ids,r.id::text);asset_ids:=array_append(asset_ids,r.body->>'assetId');contract_ids:=array_append(contract_ids,r.body->>'contractId');campaign_ids:=array_append(campaign_ids,r.body->>'campaignId');selected_ids:=array_append(selected_ids,r.id::text);
  result:=jsonb_set(result,'{inspection}',result->'inspection'||jsonb_build_array(r.body||jsonb_build_object('id',r.id,'version',r.version)));
 end loop;
 if not manager and cardinality(inspection_ids)=0 then raise exception 'Nenhuma programação atribuída autoriza este cliente.' using errcode='42501';end if;
 select coalesce(array_agg(x.execution_id::text),'{}') into execution_ids from pi_gestao_private.inspection_executions x where x.tenant_id=p_tenant and x.owner_id=p_owner and x.inspection_id::text=any(inspection_ids);
 select coalesce(array_agg(r.id::text),'{}') into item_ids from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='lvt_item' and r.body->>'lvtId'=any(execution_ids) and r.body->>'inspectionId'=any(inspection_ids);
 select coalesce(array_agg(r.body->>'systemId'),'{}'),coalesce(array_agg(r.body->>'unitId'),'{}') into system_ids,unit_ids from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.kind='asset' and r.id::text=any(asset_ids);
 for r in select * from pi_gestao_private.records where tenant_id=p_tenant and owner_id=p_owner and kind<>'inspection' order by seq loop
  key:=null;v:=r.body||jsonb_build_object('id',r.id,'version',r.version);
  if r.kind='asset' and r.id::text=any(asset_ids) then key:='asset';
  elsif r.kind='system' and r.id::text=any(system_ids) then key:='system';
  elsif r.kind='unit' and r.id::text=any(unit_ids) then key:='unit';
  elsif r.kind='contract' and r.id::text=any(contract_ids) then
   key:='contract';v:=jsonb_build_object('id',r.id,'version',r.version,'name',r.body->>'name','modules',jsonb_build_array('integridade'),'assetIds',(select coalesce(jsonb_agg(distinct a),'[]') from unnest(asset_ids) a where coalesce(r.body->'assetIds','[]') ? a and exists(select 1 from pi_gestao_private.records si where si.tenant_id=p_tenant and si.owner_id=p_owner and si.kind='inspection' and si.id::text=any(inspection_ids) and si.body->>'contractId'=r.id::text and si.body->>'assetId'=a)),'moduleAssetIds',jsonb_build_object('integridade',(select coalesce(jsonb_agg(distinct a),'[]') from unnest(asset_ids) a where coalesce(r.body->'moduleAssetIds'->'integridade',r.body->'assetIds','[]') ? a and exists(select 1 from pi_gestao_private.records si where si.tenant_id=p_tenant and si.owner_id=p_owner and si.kind='inspection' and si.id::text=any(inspection_ids) and si.body->>'contractId'=r.id::text and si.body->>'assetId'=a))));
  elsif r.kind='campaign' and r.id::text=any(campaign_ids) then
   key:='campaign';v:=jsonb_build_object('id',r.id,'version',r.version,'name',r.body->>'name','contractId',r.body->>'contractId','systemId',r.body->>'systemId','module','integridade','status',r.body->>'status','assetIds',(select coalesce(jsonb_agg(distinct a),'[]') from unnest(asset_ids) a where coalesce(r.body->'assetIds','[]') ? a and exists(select 1 from pi_gestao_private.records si where si.tenant_id=p_tenant and si.owner_id=p_owner and si.kind='inspection' and si.id::text=any(inspection_ids) and si.body->>'campaignId'=r.id::text and si.body->>'assetId'=a)));
  elsif r.kind='lvt' and r.id::text=any(execution_ids) then key:='lvt';
  elsif r.kind='lvt_item' and r.id::text=any(item_ids) then key:='lvtItem';
  elsif r.kind in ('photo','finding','rti') and r.body->>'inspectionId'=any(inspection_ids) and r.body->>'lvtItemId'=any(item_ids) and r.body->>'assetId'=any(asset_ids) and r.body->>'contractId'=any(contract_ids) and exists(select 1 from pi_gestao_private.records it where it.tenant_id=p_tenant and it.owner_id=p_owner and it.kind='lvt_item' and it.id::text=r.body->>'lvtItemId' and it.body->>'lvtId'=r.body->>'lvtId' and it.body->>'inspectionId'=r.body->>'inspectionId' and it.body->>'assetId'=r.body->>'assetId' and it.body->>'contractId'=r.body->>'contractId') then key:=r.kind;
  elsif r.kind='document' and (r.id::text=any(execution_ids) or r.body->>'recordClass'='field_point_reference' and r.body->>'executionId'=any(execution_ids) and r.body->>'lvtItemId'=any(item_ids)) then key:='document';end if;
  if key is not null then result:=jsonb_set(result,array[key],result->key||jsonb_build_array(v));selected_ids:=array_append(selected_ids,r.id::text);end if;
 end loop;
 result:=result||jsonb_build_object('recordVersions',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'kind',r.kind,'version',r.version) order by r.seq),'[]') from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=p_owner and r.id::text=any(selected_ids)));
 return result;
end $$;

create function pi_gestao_private.ga_execution_report(p_tenant uuid,p_owner uuid,p_inspection uuid)
returns jsonb language plpgsql set search_path='' as $$
declare d jsonb;s jsonb;result jsonb;source_ids text[]:='{}';r jsonb;k text;
begin
 d:=pi_gestao_private.ga_execution_detail(p_tenant,p_owner,p_inspection);s:=pi_gestao_private.ga_execution_context(p_tenant,p_owner,p_inspection);
 result:=jsonb_build_object('snapshotVersion',1,'version',1,'draft',true,'canIssue',false,'inspectionScopeVersion',1,'company',s->'company','contract',s->'contract'->0,'system',s->'system'->0,'campaign',s->'campaign'->0,'reportScope',jsonb_build_object('mode','contract_system','ownerId',p_owner,'contractId',d->'inspection'->>'contractId','systemId',d->'inspection'->>'systemId'),
 'assets',s->'asset','contracts',s->'contract','campaigns',s->'campaign','inspections',s->'inspection','lvts',s->'lvt','lvtItems',s->'lvtItem','photos',s->'photo','findings',s->'finding','rtis',s->'rti','documents',s->'document','recordVersions',s->'recordVersions');
 for k in select unnest(array['lvt','lvtItem','photo','finding','rti','document']) loop
  for r in select value from jsonb_array_elements(s->k) loop source_ids:=source_ids||array[r->'source'->>'sourceId',r->'conditionSource'->>'sourceId',r->'recommendationSource'->>'sourceId'];end loop;
 end loop;
 source_ids:=array_append(source_ids,d->'catalog'->'source'->>'sourceId');
 result:=result||jsonb_build_object('sourceProvenance',(select coalesce(jsonb_agg(jsonb_build_object('sourceId',src.id,'fileHash',src.id,'fileName',src.name,'format',coalesce(src.workbook->>'format','xlsx')) order by src.id),'[]') from pi_gestao_private.sources src where src.tenant_id=p_tenant and src.id=any(source_ids)),'catalogBindings',(select coalesce(jsonb_agg(pi_gestao_private.ga_execution_catalog_binding_json(b)||jsonb_build_object('catalog',b.snapshot) order by b.id),'[]') from pi_gestao_private.inspection_catalog_bindings b where b.tenant_id=p_tenant and b.owner_id=p_owner and b.id::text=d->'execution'->>'catalogBindingId' and b.inspection_id=p_inspection));
 return result||jsonb_build_object('scopeDigest',pi_gestao_private.ga_hash(result),'generatedAt',statement_timestamp());
end $$;

create function pi_gestao_private.ga_execution_source(p_tenant uuid,p_owner uuid,p_inspection uuid,p_source text,p_item uuid default null)
returns jsonb language plpgsql set search_path='' as $$
declare d jsonb;src pi_gestao_private.sources;
begin
 d:=pi_gestao_private.ga_execution_detail(p_tenant,p_owner,p_inspection);
 if p_source is null or p_source !~ '^[a-f0-9]{64}$' then raise exception 'Original inválido.' using errcode='22023';end if;
 if p_item is not null and not exists(select 1 from jsonb_array_elements(coalesce(d->'execution'->'items','[]')) j where j->>'lvtItemId'=p_item::text) then raise exception 'Item fora da execução atribuída.' using errcode='42501';end if;
 if not coalesce(p_item is null and d->'catalog'->'source'->>'sourceId'=p_source,false) and not exists(
  select 1 from pi_gestao_private.records photo join pi_gestao_private.records item on item.tenant_id=photo.tenant_id and item.owner_id=photo.owner_id and item.id::text=photo.body->>'lvtItemId' and item.kind='lvt_item'
  where photo.tenant_id=p_tenant and photo.owner_id=p_owner and photo.kind='photo' and photo.body->'source'->>'sourceId'=p_source and photo.body->>'inspectionId'=p_inspection::text and photo.body->>'lvtId'=d->'execution'->>'id' and photo.body->>'contractId'=d->'inspection'->>'contractId' and photo.body->>'assetId'=d->'inspection'->>'assetId'
   and item.body->>'lvtId'=d->'execution'->>'id' and (p_item is null or item.id=p_item)
 ) then raise exception 'Original não vinculado à execução/item atribuído.' using errcode='42501';end if;
 select * into src from pi_gestao_private.sources where tenant_id=p_tenant and id=p_source;
 if src.id is null then raise exception 'Original indisponível.' using errcode='42501';end if;
 return jsonb_build_object('sha',src.id,'id',src.id,'name',src.name,'size',src.byte_size,'objectKey',src.object_key,'format',coalesce(src.workbook->>'format','xlsx'),'metadata',src.workbook->'metadata');
end $$;

create function pi_gestao_private.ga_execution_photo_scope(p_tenant uuid,p_owner uuid,p_inspection uuid,p_item uuid,p_actor uuid,p_version bigint default null)
returns jsonb language plpgsql set search_path='' as $$
declare a jsonb;x pi_gestao_private.inspection_executions;e jsonb;item jsonb;
begin
 a:=pi_gestao_private.ga_execution_actor_scope(p_tenant,p_owner,p_inspection,p_actor,true);
 select * into x from pi_gestao_private.inspection_executions where tenant_id=p_tenant and owner_id=p_owner and inspection_id=p_inspection;
 if x.execution_id is null or x.execution_kind<>'lvt' then raise exception 'Foto exige LVT visual gerenciada em rascunho.' using errcode='42501';end if;
 e:=pi_gestao_private.ga_record(p_tenant,p_owner,x.execution_id,'lvt');item:=pi_gestao_private.ga_record(p_tenant,p_owner,p_item,'lvt_item');
 if e->>'status' is distinct from 'rascunho' or item->>'lvtId' is distinct from x.execution_id::text or item->>'inspectionId' is distinct from p_inspection::text or item->>'assetId' is distinct from a->'inspection'->>'assetId' or item->>'contractId' is distinct from a->'inspection'->>'contractId' then raise exception 'Foto fora da execução/item em rascunho.' using errcode='42501';end if;
 if p_version is not null and (e->>'version')::bigint is distinct from p_version then raise exception 'Rascunho alterado; reabra antes do envio da foto.' using errcode='40001';end if;
 return jsonb_build_object('inspectionId',p_inspection,'executionId',x.execution_id,'lvtItemId',p_item,'executionVersion',(e->>'version')::bigint,'canUpload',true,'inspection',a->'inspection');
end $$;

-- Narrow service-only commit: actor is supplied by verified Edge Auth, never by
-- an authenticated browser RPC. Original registration and item-photo linkage
-- share one SQL transaction and recheck the actor/current assignment under lock.
create function pi_gestao_private.ga_execution_photo(p_tenant uuid,p_actor uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare own uuid;i uuid;item_id uuid;operation_id uuid;s jsonb;authorized jsonb;receipt pi_gestao_private.operation_receipts;digest text;src pi_gestao_private.sources;wb jsonb;format_name text;ext text;sha text;name text;size_value bigint;object_key text;metadata jsonb;photo jsonb;result jsonb;evidence jsonb;photo_body jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('ownerId','inspectionId','lvtItemId','requestId','expectedVersion','source')) then raise exception 'Payload de foto inválido.' using errcode='22023';end if;
 own:=(p_payload->>'ownerId')::uuid;i:=(p_payload->>'inspectionId')::uuid;item_id:=(p_payload->>'lvtItemId')::uuid;operation_id:=(p_payload->>'requestId')::uuid;
 if own is null or i is null or item_id is null or operation_id is null or nullif(p_payload->>'expectedVersion','') is null then raise exception 'Identidade de foto e versão obrigatórias.' using errcode='22023';end if;
 authorized:=pi_gestao_private.ga_execution_photo_scope(p_tenant,own,i,item_id,p_actor,null);
 digest:=pi_gestao_private.ga_hash(p_payload);
 select * into receipt from pi_gestao_private.operation_receipts r where r.tenant_id=p_tenant and r.owner_id=own and r.action='execution.photo.register' and r.request_id=operation_id;
 if found then
  if receipt.digest<>digest or receipt.actor_user_id<>p_actor then raise exception 'Foto já recebida com outro conteúdo.' using errcode='23505';end if;
  return receipt.result;
 end if;
 authorized:=pi_gestao_private.ga_execution_photo_scope(p_tenant,own,i,item_id,p_actor,(p_payload->>'expectedVersion')::bigint);
 s:=p_payload->'source';
 if jsonb_typeof(s) is distinct from 'object' or exists(select 1 from jsonb_object_keys(s) k where k not in ('sha','name','size','objectKey','workbook')) then raise exception 'Fonte de foto inválida.' using errcode='22023';end if;
 sha:=s->>'sha';name:=pi_gestao_private.ga_text(s->>'name','Nome original',300);size_value:=(s->>'size')::bigint;object_key:=s->>'objectKey';wb:=s->'workbook';format_name:=wb->>'format';ext:=case format_name when 'image_jpeg' then 'jpg' when 'image_png' then 'png' end;
 if sha is null or sha !~ '^[a-f0-9]{64}$' or size_value is null or size_value<1 or size_value>8388608 or ext is null or jsonb_typeof(wb) is distinct from 'object' or wb->'sheets' is distinct from '[]'::jsonb or wb->'metadata'->>'extraction' is distinct from 'not_performed' or octet_length(wb::text)>200000 then raise exception 'Foto exige original JPEG/PNG privado validado.' using errcode='22023';end if;
 if (format_name='image_jpeg' and name !~* '\.jpe?g$') or (format_name='image_png' and name !~* '\.png$') or object_key is distinct from (p_tenant::text||'/'||sha||'/original.'||ext) then raise exception 'Identidade da foto diverge do original.' using errcode='22023';end if;
 if not exists(select 1 from storage.buckets where id='pi-gestao-sources' and public=false) then raise exception 'Bucket privado indisponível.' using errcode='22023';end if;
 select o.metadata into metadata from storage.objects o where o.bucket_id='pi-gestao-sources' and o.name=object_key;
 if not found or metadata ? 'size' and (metadata->>'size')::bigint<>size_value then raise exception 'Original armazenado ainda não conferido.' using errcode='22023';end if;
 select * into src from pi_gestao_private.sources where tenant_id=p_tenant and id=sha for update;
 if found and (src.byte_size<>size_value or src.object_key<>object_key or src.workbook<>wb) then raise exception 'Original imutável em conflito.' using errcode='23505';end if;
 if src.id is null then insert into pi_gestao_private.sources(tenant_id,id,name,byte_size,object_key,workbook,created_by) values(p_tenant,sha,name,size_value,object_key,wb,p_actor);end if;
 evidence:=jsonb_build_object('sourceId',sha,'fileHash',sha,'fileName',coalesce(src.name,name),'format',format_name,'locator',jsonb_build_object('section','Foto de campo vinculada ao item'));
 photo_body:=jsonb_build_object('assetId',authorized->'inspection'->>'assetId','inspectionId',i,'campaignId',authorized->'inspection'->>'campaignId','contractId',authorized->'inspection'->>'contractId','systemId',authorized->'inspection'->>'systemId','module','integridade','lvtId',authorized->>'executionId','lvtItemId',item_id,'caption','Foto do item registrada em campo','source',evidence);
 photo:=pi_gestao_private.ga_origin_put(p_tenant,own,'photo',pi_gestao_private.ga_hash(jsonb_build_array(item_id,sha,evidence->'locator')),photo_body,sha,p_actor);
 perform pi_gestao_private.ga_link(p_tenant,own,(photo->>'id')::uuid,'photo',item_id,'lvt_item','illustrates_item',p_actor);
 result:=jsonb_build_object('photo',photo,'source',jsonb_build_object('id',sha,'sha',sha,'name',coalesce(src.name,name),'format',format_name),'inspectionId',i,'executionId',authorized->>'executionId','requestId',operation_id,'linked',true);
 insert into pi_gestao_private.operation_receipts(tenant_id,owner_id,action,request_id,digest,result,actor_user_id) values(p_tenant,own,'execution.photo.register',operation_id,digest,result,p_actor);
 perform pi_gestao_private.ga_audit(p_tenant,own,(photo->>'id')::uuid,p_actor,'foto de execução vinculada',jsonb_build_object('inspectionId',i,'lvtItemId',item_id,'sourceId',sha,'requestId',operation_id));
 return result;
end $$;

create function public.pi_gestao_execution_photo(p_tenant uuid,p_actor uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select pi_gestao_private.ga_execution_photo(p_tenant,p_actor,p_payload);
end;

create function pi_gestao_private.ga_api_execution(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
<<ga_api_execution>>
declare actor uuid; own uuid; inspection_id uuid; request_id uuid; cap jsonb; d jsonb; i jsonb; e jsonb; cat jsonb; patch jsonb; managed_inspection uuid;
 manager boolean; person pi_team_private.professionals; x pi_gestao_private.inspection_executions;
 receipt pi_gestao_private.operation_receipts; digest text; result jsonb; rec record;
 item jsonb; shell jsonb; answer jsonb; normalized jsonb; answers jsonb:='[]'; item_refs jsonb:='[]';
 condition jsonb; recommendation jsonb; photo jsonb; photo_id text; prior_rti jsonb; finding jsonb; rti jsonb;
 scope jsonb; source jsonb; deadline_anchor jsonb; deadline_review boolean; id uuid; item_id uuid; kind text; observed text; status text; n integer; completed integer:=0; review_needed boolean:=false;
 seen text[]:='{}'; reading jsonb; readings jsonb; instrument text;
 outcome text; coverage jsonb; point_ref jsonb; point_body jsonb; point_label text; point_status text;
 requires_treatment boolean; actionability text; supports_good boolean; no_action_text text;
 checked_answer jsonb; checked_condition jsonb; checked_recommendation jsonb; checked_item jsonb; checked_point jsonb;
 selected_photo_ids jsonb:='[]'::jsonb; treatment_count integer:=0; coverage_photo_ids jsonb;
begin
 actor:=pi_gestao_private.ga_require_access(p_tenant,false);
 cap:=pi_gestao_private.ga_access_for_actor(p_tenant,actor);manager:=cap->>'role' in ('admin','master');
 select * into person from pi_team_private.professionals where tenant_id=p_tenant and user_id=actor and registration_state='active' and access_revoked_at is null;
 if p_action='access.get' then return cap||jsonb_build_object('inspectionScopeVersion',1,'inspectionWriteAllowed',cap->>'role'='inspector' and person.id is not null and person.functional_role='inspector','inspectorWorkspaceVersion',1);end if;
 if p_action='owners.list' and cap->>'role'='inspector' then
  if person.id is null then raise exception 'Perfil profissional ativo necessário.' using errcode='42501';end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name) order by o.name),'[]') from pi_gestao_private.owners o where o.tenant_id=p_tenant and exists(
   select 1 from pi_gestao_private.records i join pi_gestao_private.records c on c.tenant_id=i.tenant_id and c.owner_id=i.owner_id and c.id::text=i.body->>'contractId' and c.kind='contract'
    join pi_gestao_private.records ca on ca.tenant_id=i.tenant_id and ca.owner_id=i.owner_id and ca.id::text=i.body->>'campaignId' and ca.kind='campaign'
   where i.tenant_id=p_tenant and i.owner_id=o.id and i.kind='inspection' and i.body->>'assigneeProfessionalId'=person.id::text and pi_gestao_private.ga_execution_scope_matches(i.body,c.body||jsonb_build_object('id',c.id),ca.body||jsonb_build_object('id',ca.id))));
 end if;
 if p_action in ('execution.context','execution.report','execution.source','execution.photo.authorize') then
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000000 then raise exception 'Payload inválido.' using errcode='22023';end if;
  own:=(p_payload->>'ownerId')::uuid;perform pi_gestao_private.ga_owner(p_tenant,own);inspection_id:=nullif(p_payload->>'inspectionId','')::uuid;
  if p_action='execution.context' then return pi_gestao_private.ga_execution_context(p_tenant,own,inspection_id);end if;
  if inspection_id is null then raise exception 'Inspeção explícita obrigatória.' using errcode='22023';end if;
  if p_action='execution.report' then return pi_gestao_private.ga_execution_report(p_tenant,own,inspection_id);end if;
  if p_action='execution.source' then return pi_gestao_private.ga_execution_source(p_tenant,own,inspection_id,p_payload->>'sourceId',nullif(p_payload->>'lvtItemId','')::uuid);end if;
  if nullif(p_payload->>'expectedVersion','') is null or nullif(p_payload->>'requestId','') is null then raise exception 'Versão e identificador estável obrigatórios.' using errcode='22023';end if;
  request_id:=(p_payload->>'requestId')::uuid;
  result:=pi_gestao_private.ga_execution_photo_scope(p_tenant,own,inspection_id,(p_payload->>'lvtItemId')::uuid,actor,null);
  select * into receipt from pi_gestao_private.operation_receipts r where r.tenant_id=p_tenant and r.owner_id=own and r.action='execution.photo.register' and r.request_id=ga_api_execution.request_id;
  if found then
   if receipt.actor_user_id<>actor or receipt.result->>'inspectionId' is distinct from inspection_id::text or receipt.result->'photo'->>'lvtItemId' is distinct from p_payload->>'lvtItemId' then raise exception 'Foto já recebida com outro contexto.' using errcode='23505';end if;
   -- A known photo may be retried after another content save. Current actor,
   -- assignment and draft are still checked; the service commit compares the
   -- complete source/body digest before returning the original receipt.
   return result-'inspection';
  end if;
  return pi_gestao_private.ga_execution_photo_scope(p_tenant,own,inspection_id,(p_payload->>'lvtItemId')::uuid,actor,(p_payload->>'expectedVersion')::bigint)-'inspection';
 end if;
 if cap->>'role'='inspector' and (p_action is null or p_action not like 'execution.%') then raise exception 'Utilize somente a programação e as fontes da inspeção atribuída.' using errcode='42501';end if;
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
 if p_action not in ('execution.list','execution.get','execution.assign','execution.start','execution.save','execution.submit','execution.catalog','execution.catalog.select') then raise exception 'Operação de execução indisponível.' using errcode='0A000';end if;
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
  return jsonb_build_object('actorUserId',actor,'professionalId',person.id,'canAssign',manager and cap->>'write'='true','writeAllowed',(manager and cap->>'write'='true') or (cap->>'role'='inspector' and person.functional_role='inspector'),'inspectionScopeVersion',1,'inspections',result,
   'professionals',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'registrationState',p.registration_state,'accessLinked',p.user_id is not null) order by p.name) from pi_team_private.professionals p where p.tenant_id=p_tenant and p.registration_state='active' and p.access_revoked_at is null),'[]') else '[]'::jsonb end);
 end if;
 inspection_id:=(p_payload->>'inspectionId')::uuid;
 d:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);i:=d->'inspection';
 if p_action='execution.get' then return d;end if;
 if p_action='execution.catalog' then return d->'catalog';end if;
 -- Assignment permits only scoped execution actions, never a generic write grant.
 if p_action in ('execution.assign','execution.catalog.select') then
  perform pi_gestao_private.ga_require_access(p_tenant,true);
  if not manager then raise exception 'Atribuição exige gestão autorizada.' using errcode='42501';end if;
 elsif d->>'canExecute' is distinct from 'true' then raise exception 'Execução exige o responsável atribuído e permissão atual de gravação.' using errcode='42501';end if;
 if i->>'type' not in ('visual','espessura') or i->>'module' is distinct from 'integridade' then raise exception 'Modalidade de execução não coberta por esta ficha.' using errcode='22023';end if;
 request_id:=(p_payload->>'requestId')::uuid;if request_id is null then raise exception 'Identificador estável obrigatório.' using errcode='22023';end if;
 digest:=pi_gestao_private.ga_hash(p_payload);
 -- Serialize starts, assignment and all related item/RTI changes for this owner.
 perform 1 from pi_gestao_private.owners where tenant_id=p_tenant and id=own for update;
 if p_action in ('execution.assign','execution.catalog.select') then
  perform 1 from pi_gestao_private.pilot_access where tenant_id=p_tenant and user_id=actor for share;
  perform 1 from public.pi_company_memberships where company_id=p_tenant and user_id=actor for share;
  perform 1 from pi_access_private.masters where user_id=actor for share;
  perform pi_gestao_private.ga_require_access(p_tenant,true);
 else perform pi_gestao_private.ga_execution_actor_scope(p_tenant,own,inspection_id,actor,true);end if;
 d:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);i:=d->'inspection';e:=d->'execution';cat:=d->'catalog';
 if p_action not in ('execution.assign','execution.catalog.select') and d->>'canExecute' is distinct from 'true' then raise exception 'A atribuição mudou; reabra a atividade.' using errcode='42501';end if;
 select * into receipt from pi_gestao_private.operation_receipts where tenant_id=p_tenant and owner_id=own and action=p_action and operation_receipts.request_id=ga_api_execution.request_id;
 if found then
  if receipt.digest<>digest or receipt.actor_user_id<>actor then raise exception 'Operação já recebida com outro conteúdo.' using errcode='23505';end if;
  return pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);
 end if;
 if p_action='execution.catalog.select' then
  perform pi_gestao_private.ga_execution_select_catalog(p_tenant,own,i,p_payload,actor);
 elsif p_action='execution.assign' then
  if e->>'id' is not null and nullif(p_payload->>'professionalId','') is distinct from i->>'assigneeProfessionalId' then raise exception 'Atividade iniciada exige revisão técnica antes de trocar o responsável.' using errcode='22023';end if;
  if e->>'id' is not null and (jsonb_array_length(coalesce(e->'answers','[]'))>0 or jsonb_array_length(coalesce(e->'readings','[]'))>0 or e->>'status'<>'rascunho') then raise exception 'Atividade com respostas exige revisão antes de reatribuir.' using errcode='22023';end if;
  if i->>'status'='concluida' then raise exception 'Atividade concluída não pode ser reatribuída.' using errcode='22023';end if;
  select * into person from pi_team_private.professionals where tenant_id=p_tenant and id=nullif(p_payload->>'professionalId','')::uuid and registration_state='active' and access_revoked_at is null;
  if nullif(p_payload->>'professionalId','') is not null and person.id is null then raise exception 'Selecione profissional ativo do cadastro existente.' using errcode='22023';end if;
  perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(p_payload->>'expectedVersion')::bigint,jsonb_build_object('assigneeProfessionalId',person.id,'assigneeName',person.name,'assignedAt',now(),'assignedBy',actor),actor,'responsável da inspeção atribuído');
 elsif p_action='execution.start' then
  if i->>'type'='visual' and d->'catalogBinding'->>'status' is distinct from 'pinned' then raise exception 'Selecione explicitamente catálogo aplicável e versionado antes de iniciar a inspeção visual.' using errcode='22023';end if;
  if i->>'status'='concluida' then raise exception 'Atividade concluída; abra reinspeção justificada.' using errcode='22023';end if;
  if e->>'id' is null then
   if exists(select 1 from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='lvt' and r.body->>'inspectionId'=inspection_id::text and r.body->>'recordClass'='field_lvt') then raise exception 'Já existe LVT de campo desta atividade; vinculação do rascunho exige revisão, sem duplicação automática.' using errcode='22023';end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   source:=jsonb_build_object('format','field_record','actorUserId',actor);
   scope:=jsonb_build_object('assetId',i->>'assetId','inspectionId',i->>'id','campaignId',i->>'campaignId','contractId',i->>'contractId','systemId',i->>'systemId','module',i->>'module');
   e:=pi_gestao_private.ga_put(p_tenant,own,kind,scope||jsonb_build_object('recordClass',case when kind='lvt' then 'field_lvt' else 'measurement_draft' end,'executionVersion',1,'type',i->>'type','status','rascunho','source',source,'inspectorProfessionalId',i->>'assigneeProfessionalId','inspector',i->>'assigneeName','answers','[]'::jsonb,'readings','[]'::jsonb,'items','[]'::jsonb,'catalogId',cat->>'id','catalogBindingId',d->'catalogBinding'->>'id','catalogHash',d->'catalogBinding'->>'contentHash','catalogVersion',cat->>'versionLabel','technicalReviewRequired',false,'createdAt',now(),'createdBy',actor),actor);
   deadline_anchor:=jsonb_build_object('event','inspection_performed','date',null,'status','pending_observed_on','inspectionId',i->>'id','executionId',e->>'id','executionVersion',2);
   insert into pi_gestao_private.inspection_executions(tenant_id,owner_id,inspection_id,execution_id,execution_kind,catalog_id,catalog_binding_id) values(p_tenant,own,inspection_id,(e->>'id')::uuid,kind,nullif(cat->>'id','')::uuid,nullif(d->'catalogBinding'->>'id','')::uuid);
   if kind='lvt' then perform pi_gestao_private.ga_link(p_tenant,own,(e->>'id')::uuid,kind,inspection_id,'inspection','records_inspection',actor);end if;
   if kind='lvt' then
    for item in select value from jsonb_array_elements(cat->'items') loop
     shell:=pi_gestao_private.ga_put(p_tenant,own,'lvt_item',scope||jsonb_build_object('lvtId',e->>'id','executionId',e->>'id','recordClass','field_checklist_item','catalogItemId',item->>'id','itemKey',item->>'itemKey','component',item->>'component','description',null,'conditionId',null,'recommendationId',null,'status','pendente','source',source,'photoIds','[]'::jsonb),actor);
     perform pi_gestao_private.ga_link(p_tenant,own,(shell->>'id')::uuid,'lvt_item',(e->>'id')::uuid,'lvt','part_of_lvt',actor);
     item_refs:=item_refs||jsonb_build_array(jsonb_build_object('catalogItemId',item->>'id','itemKey',item->>'itemKey','lvtItemId',shell->>'id'));
    end loop;
    perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,'lvt',1,jsonb_build_object('items',item_refs,'progress',jsonb_build_object('answered',0,'total',jsonb_array_length(item_refs)),'deadlineAnchor',deadline_anchor,'outcome','pending','coverage',null),actor,'itens pendentes da LVT preparados');
   else
    perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,kind,1,jsonb_build_object('deadlineAnchor',deadline_anchor),actor,'marco da inspeção pendente de data declarada');
   end if;
   perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(i->>'version')::bigint,jsonb_build_object('status','em_andamento','executionId',e->>'id'),actor,'inspeção iniciada');
  end if;
 else
  if e->>'id' is null then raise exception 'Inicie a inspeção antes de salvar.' using errcode='22023';end if;
  if e->>'status' is distinct from 'rascunho' then raise exception 'Ficha enviada para revisão; edição exige devolução técnica.' using errcode='22023';end if;
  if (e->>'version')::bigint is distinct from (p_payload->>'expectedVersion')::bigint then raise exception 'Rascunho alterado; reabra antes de salvar.' using errcode='40001';end if;
  if i->>'type'='visual' then
   if p_action='execution.submit' and (p_payload ? 'outcome' or p_payload ? 'coverage') then raise exception 'Salve o resultado e a cobertura antes de enviar para revisão.' using errcode='22023';end if;
   if p_payload ? 'outcome' and jsonb_typeof(p_payload->'outcome') is distinct from 'string' then raise exception 'Resultado deve ser declarado explicitamente.' using errcode='22023';end if;
   outcome:=coalesce(p_payload->>'outcome',e->>'outcome','pending');
   if outcome not in ('pending','good_condition','treatment_required','technical_review') then raise exception 'Resultado de inspeção inválido.' using errcode='22023';end if;
   if outcome='technical_review' then review_needed:=true;end if;
   coverage:=case when p_payload ? 'coverage' then p_payload->'coverage' else e->'coverage' end;
   if coverage='null'::jsonb then coverage:=null;end if;
   if coverage is not null then
    if jsonb_typeof(coverage) is distinct from 'object' or exists(select 1 from jsonb_object_keys(coverage) k where k not in ('extent','description','photoIds'))
    or jsonb_typeof(coverage->'description') is distinct from 'string'
    or coverage->>'extent' is null or coverage->>'extent' not in ('declared_section','declared_entire_line')
    or jsonb_typeof(coverage->'photoIds') is distinct from 'array' or jsonb_array_length(coverage->'photoIds')>1000
    then raise exception 'Cobertura exige extensão declarada, descrição do trecho e lista de fotos.' using errcode='22023';end if;
    coverage:=jsonb_build_object('extent',coverage->>'extent','description',pi_gestao_private.ga_text(coverage->>'description','Trecho efetivamente inspecionado declarado',2000),'photoIds',coverage->'photoIds');
   end if;
  elsif p_payload ? 'outcome' or p_payload ? 'coverage' then raise exception 'Resultado visual e cobertura não se aplicam à ficha de espessura.' using errcode='22023';end if;
  if p_action='execution.submit' then
   if i->>'type'='visual' and (cat->>'status' is distinct from 'verified' or jsonb_array_length(cat->'items')=0 or jsonb_array_length(coalesce(e->'answers','[]'))<>jsonb_array_length(cat->'items') or exists(select 1 from jsonb_array_elements(e->'answers') a where nullif(a->>'conditionId','') is null and a->>'notCovered' is distinct from 'true')) then raise exception 'Cada item precisa de resposta de catálogo conferido ou encaminhamento à gestão técnica.' using errcode='22023';end if;
   if i->>'type'='espessura' and (jsonb_array_length(coalesce(e->'readings','[]'))=0 or nullif(e->>'instrument','') is null) then raise exception 'Medição planejada continua pendente sem instrumento e leituras.' using errcode='22023';end if;
   if nullif(e->>'observedOn','') is null then raise exception 'Informe a data observada antes de enviar.' using errcode='22023';end if;

  if i->>'type'='visual' then
   if p_action='execution.submit' then answers:=coalesce(e->'answers','[]'::jsonb);observed:=e->>'observedOn';end if;
   selected_photo_ids:='[]'::jsonb;treatment_count:=0;
   for checked_answer in select value from jsonb_array_elements(answers) loop
    selected_photo_ids:=selected_photo_ids||coalesce(checked_answer->'photoIds','[]'::jsonb);
    select value into item from jsonb_array_elements(cat->'items') where value->>'id'=checked_answer->>'catalogItemId';
    select value into checked_condition from jsonb_array_elements(coalesce(item->'conditions','[]')) where value->>'id'=checked_answer->>'conditionId';
    select value into checked_recommendation from jsonb_array_elements(coalesce(item->'recommendations','[]')) where value->>'id'=checked_answer->>'recommendationId';
    select value into shell from jsonb_array_elements(e->'items') where value->>'catalogItemId'=checked_answer->>'catalogItemId';
    checked_item:=pi_gestao_private.ga_record(p_tenant,own,(shell->>'lvtItemId')::uuid,'lvt_item');
    if outcome in ('good_condition','treatment_required') and checked_recommendation is not null and jsonb_typeof(checked_recommendation->'requiresTreatment') is distinct from 'boolean' then raise exception 'O resultado exige classificação de tratativa explícita na curadoria do catálogo.' using errcode='22023';end if;
    if item is null or checked_item->>'catalogItemId' is distinct from checked_answer->>'catalogItemId'
    or checked_item->>'conditionId' is distinct from checked_answer->>'conditionId' or checked_item->>'recommendationId' is distinct from checked_answer->>'recommendationId'
    or (nullif(checked_answer->>'conditionId','') is not null and (checked_condition is null or checked_item->>'description' is distinct from checked_condition->>'text' or checked_item->'conditionSource' is distinct from checked_condition->'source'))
    or (nullif(checked_answer->>'recommendationId','') is not null and (checked_recommendation is null or checked_item->>'recommendation' is distinct from checked_recommendation->>'text' or checked_item->'recommendationSource' is distinct from checked_recommendation->'source'))
    then raise exception 'Escolha ou fonte salva diverge do catálogo atual; salve novamente para revisão técnica.' using errcode='22023';end if;
    if checked_recommendation is not null and (
     jsonb_typeof(checked_answer->'requiresTreatment') is distinct from 'boolean' or jsonb_typeof(checked_item->'requiresTreatment') is distinct from 'boolean'
     or (case when checked_recommendation ? 'requiresTreatment' then checked_recommendation->'requiresTreatment' else 'true'::jsonb end) is distinct from checked_answer->'requiresTreatment'
     or checked_item->'requiresTreatment' is distinct from checked_answer->'requiresTreatment'
     or checked_answer->>'actionabilityStatus' is distinct from (case when checked_recommendation ? 'requiresTreatment' then 'catalog_declared' else 'legacy_unclassified' end)
     or checked_item->>'actionabilityStatus' is distinct from checked_answer->>'actionabilityStatus'
    ) then raise exception 'Classificação de tratativa salva diverge do catálogo atual; salve novamente para revisão técnica.' using errcode='22023';end if;
    if outcome='good_condition' and (checked_answer->>'notCovered'='true' or checked_condition is null or checked_condition->>'supportsGoodCondition' is distinct from 'true' or checked_answer->>'conditionSupportsGoodCondition' is distinct from 'true' or checked_item->>'conditionSupportsGoodCondition' is distinct from 'true') then raise exception 'Boas condições exige cada condição explicitamente compatível na curadoria; ausência de tratativa não comprova condição boa.' using errcode='22023';end if;
    if checked_recommendation->>'requiresTreatment'='true' or checked_answer->>'requiresTreatment'='true' then
     treatment_count:=treatment_count+1;
     if outcome='good_condition' then raise exception 'Há tratativa nesta execução; não pode ser declarada como boas condições.' using errcode='22023';end if;
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into finding from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='finding' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=checked_item->>'id';
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into rti from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=checked_item->>'id';
     if finding is null or rti is null or rti->>'findingId' is distinct from finding->>'id' or finding->>'recommendationId' is distinct from checked_answer->>'recommendationId' or rti->>'recommendationId' is distinct from checked_answer->>'recommendationId' or finding->'photoIds' is distinct from checked_answer->'photoIds' or rti->'photoIds' is distinct from checked_answer->'photoIds' or rti->>'assetId' is distinct from i->>'assetId' or rti->>'inspectionId' is distinct from i->>'id' or rti->>'contractId' is distinct from i->>'contractId' or rti->>'requiresTreatment' is distinct from 'true' or rti->>'recommendationWithdrawn' is distinct from 'false'
     or finding->>'assetId' is distinct from i->>'assetId' or finding->>'inspectionId' is distinct from i->>'id' or finding->>'contractId' is distinct from i->>'contractId'
     or finding->>'pointId' is distinct from checked_answer->>'pointId' or rti->>'pointId' is distinct from checked_answer->>'pointId'
     or finding->'pointVersion' is distinct from checked_answer->'pointVersion' or rti->'pointVersion' is distinct from checked_answer->'pointVersion'
     or finding->>'pointLabel' is distinct from checked_answer->>'pointLabel' or rti->>'pointLabel' is distinct from checked_answer->>'pointLabel' then raise exception 'A tratativa exige achado e mesma RTI canônicos; salve antes de enviar.' using errcode='22023';end if;
     if checked_recommendation->>'requiresTreatment'='true' and (checked_item->>'pointLinkStatus' is distinct from 'linked_field_reference' or nullif(checked_answer->>'pointId','') is null) then raise exception 'Tratativa classificada exige referência de campo canônica.' using errcode='22023';end if;
    end if;
    if nullif(checked_answer->>'pointId','') is not null or nullif(checked_item->>'pointId','') is not null then
     if checked_answer->>'pointId' is distinct from checked_item->>'pointId' or checked_answer->>'pointLinkStatus' is distinct from 'linked_field_reference' then raise exception 'Vínculo do ponto salvo diverge do item canônico.' using errcode='22023';end if;
     checked_point:=pi_gestao_private.ga_record(p_tenant,own,(checked_item->>'pointId')::uuid,'document');
     if checked_point->>'recordClass' is distinct from 'field_point_reference' or checked_point->>'executionId' is distinct from e->>'id' or checked_point->>'inspectionId' is distinct from i->>'id' or checked_point->>'contractId' is distinct from i->>'contractId' or checked_point->>'assetId' is distinct from i->>'assetId' or checked_point->>'lvtItemId' is distinct from checked_item->>'id' or checked_point->>'label' is distinct from checked_answer->>'pointLabel' or checked_point->'photoIds' is distinct from checked_answer->'photoIds' or checked_point->'version' is distinct from checked_answer->'pointVersion' then raise exception 'Referência de campo diverge do item salvo.' using errcode='42501';end if;
    end if;
   end loop;
   if coverage is not null then
    coverage_photo_ids:='[]'::jsonb;
    for photo_id in select value#>>'{}' from jsonb_array_elements(coverage->'photoIds') loop
     if not selected_photo_ids ? photo_id or coverage_photo_ids ? photo_id then raise exception 'Cobertura exige fotos selecionadas nos itens desta execução, sem repetição.' using errcode='22023';end if;
     photo:=pi_gestao_private.ga_record(p_tenant,own,photo_id::uuid,'photo');
     if photo->>'assetId' is distinct from i->>'assetId' or photo->>'inspectionId' is distinct from i->>'id' or photo->>'contractId' is distinct from i->>'contractId' or photo->>'lvtId' is distinct from e->>'id' then raise exception 'Foto da cobertura pertence a outra TAG, inspeção ou contrato.' using errcode='42501';end if;
     coverage_photo_ids:=coverage_photo_ids||jsonb_build_array(photo_id);
    end loop;
   end if;
   if outcome='good_condition' then
    if cat->>'status' is distinct from 'verified' or jsonb_array_length(cat->'items')=0 or jsonb_array_length(answers)<>jsonb_array_length(cat->'items') or nullif(observed,'') is null or coverage is null or jsonb_array_length(coverage->'photoIds')=0 then raise exception 'Boas condições exige checklist completo, data observada, cobertura declarada e ao menos uma foto vinculada.' using errcode='22023';end if;
    if exists(select 1 from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id') then raise exception 'RTI desta execução permanece para gestão técnica; sua retirada não autoriza boas condições.' using errcode='22023';end if;
   elsif outcome='treatment_required' and treatment_count=0 then raise exception 'Resultado com tratativa exige ao menos uma recomendação acionável do catálogo.' using errcode='22023';end if;
   if p_action='execution.save' then patch:=patch||jsonb_build_object('outcome',outcome,'coverage',coverage);end if;
  end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,kind,(e->>'version')::bigint,jsonb_build_object('status','em_revisao','submittedAt',now(),'submittedBy',actor,'signatureStatus','pendente','technicalReviewRequired',coalesce((e->>'technicalReviewRequired')::boolean,false) or coalesce(outcome='technical_review',false)),actor,'ficha enviada para revisão técnica');
   perform pi_gestao_private.ga_change(p_tenant,own,inspection_id,'inspection',(i->>'version')::bigint,jsonb_build_object('executionStatus','em_revisao'),actor,'execução aguardando revisão');
  else
   if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('ownerId','inspectionId','requestId','expectedVersion','answers','observedOn','instrument','readings','outcome','coverage')) then raise exception 'Campo de execução não reconhecido; frases livres não são aceitas.' using errcode='22023';end if;
   observed:=pi_gestao_private.ga_date(p_payload->>'observedOn','Data observada');if observed::date>current_date then raise exception 'Data observada futura.' using errcode='22023';end if;
   deadline_anchor:=jsonb_build_object('event','inspection_performed','date',observed,'status',case when observed is null then 'pending_observed_on' else 'declared' end,'inspectionId',i->>'id','executionId',e->>'id','executionVersion',(e->>'version')::bigint+1);
   patch:=jsonb_build_object('observedOn',observed);
   if i->>'type'='visual' then
    if jsonb_typeof(p_payload->'answers') is distinct from 'array' or jsonb_array_length(p_payload->'answers')>1000 then raise exception 'Respostas inválidas.' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(coalesce(e->'answers','[]')) prior where not exists(select 1 from jsonb_array_elements(p_payload->'answers') next_answer where next_answer->>'catalogItemId'=prior->>'catalogItemId')) then raise exception 'Resposta salva não pode desaparecer implicitamente; envie a escolha vazia explicitamente para revisão.' using errcode='22023';end if;
    for answer in select value from jsonb_array_elements(p_payload->'answers') loop
     if exists(select 1 from jsonb_object_keys(answer) k where k not in ('itemKey','catalogItemId','conditionId','recommendationId','notCovered','photoIds','pointLabel')) then raise exception 'Resposta aceita somente escolhas do catálogo e fotos do item.' using errcode='22023';end if;
     select value into item from jsonb_array_elements(cat->'items') where value->>'id'=answer->>'catalogItemId';
     if item is null or item->>'itemKey' is distinct from answer->>'itemKey' or (item->>'id')=any(seen) then raise exception 'Item fora do catálogo conferido ou repetido.' using errcode='22023';end if;
     seen:=array_append(seen,item->>'id');
     select value into shell from jsonb_array_elements(e->'items') where value->>'catalogItemId'=item->>'id';
     item_id:=(shell->>'lvtItemId')::uuid;
     if jsonb_typeof(answer->'notCovered') is distinct from 'boolean' or jsonb_typeof(answer->'photoIds') is distinct from 'array' then raise exception 'Resposta explícita e lista de fotos obrigatórias.' using errcode='22023';end if;
     condition:=null;recommendation:=null;requires_treatment:=null;actionability:='not_selected';supports_good:=null;point_ref:=null;point_label:=null;point_status:='not_declared';
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
       no_action_text:=regexp_replace(regexp_replace(lower(btrim(recommendation->>'text')),'[[:space:]]+',' ','g'),'[[:punct:][:space:]]+$','','g');
       if recommendation ? 'requiresTreatment' then
        requires_treatment:=(recommendation->>'requiresTreatment')::boolean;actionability:='catalog_declared';
       else
        -- Compatibility only: existing positive recommendation selections keep
        -- their RTI, but are explicitly unclassified and need technical review.
        requires_treatment:=true;actionability:='legacy_unclassified';review_needed:=true;
       end if;
       if (no_action_text ~ '^0([.]0+)?$' or no_action_text in ('','–','—','sem recomendação','sem recomendacao','sem recomendações','sem recomendacoes','nenhuma recomendação','nenhuma recomendacao','nenhuma','não se aplica','nao se aplica','n/a','no recommendation','no recommendations','not applicable','0','erro')) and requires_treatment then raise exception 'Texto sem ação não cria tratativa ou RTI; a curadoria deve declarar requiresTreatment=false.' using errcode='22023';end if;
       if requires_treatment then
        if observed is null then raise exception 'Recomendação exige data observada.' using errcode='22023';end if;
        if jsonb_array_length(answer->'photoIds')=0 then raise exception 'Recomendação exige foto vinculada ao item.' using errcode='22023';end if;
       end if;
      end if;
     end if;
     if condition ? 'supportsGoodCondition' then supports_good:=(condition->>'supportsGoodCondition')::boolean;end if;
     for photo_id in select value#>>'{}' from jsonb_array_elements(answer->'photoIds') loop
      photo:=pi_gestao_private.ga_record(p_tenant,own,photo_id::uuid,'photo');
      if photo->>'lvtItemId' is distinct from item_id::text or photo->>'assetId' is distinct from i->>'assetId'
      or photo->>'lvtId' is distinct from e->>'id' or photo->>'inspectionId' is distinct from i->>'id'
      or photo->>'contractId' is distinct from i->>'contractId' or photo->>'systemId' is distinct from i->>'systemId'
      then raise exception 'Foto pertence a outro item, execução, contrato ou TAG.' using errcode='42501';end if;
     end loop;
     scope:=jsonb_build_object('assetId',i->>'assetId','lvtId',e->>'id','inspectionId',i->>'id','campaignId',i->>'campaignId','contractId',i->>'contractId','systemId',i->>'systemId','module',i->>'module','lvtItemId',item_id);
     source:=jsonb_build_object('format','field_record','actorUserId',actor,'observedOn',observed,'catalogId',cat->>'id');
     select count(*) into n from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='document' and r.body->>'recordClass'='field_point_reference' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
     if n>1 then raise exception 'Há referências de campo duplicadas; revisão técnica necessária.' using errcode='22023';end if;
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into point_ref from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='document' and r.body->>'recordClass'='field_point_reference' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
     if point_ref is not null and (point_ref->>'contractId' is distinct from i->>'contractId' or point_ref->>'assetId' is distinct from i->>'assetId' or point_ref->>'inspectionId' is distinct from i->>'id' or point_ref->>'systemId' is distinct from i->>'systemId' or point_ref->>'lvtId' is distinct from e->>'id') then raise exception 'Referência de campo fora do escopo da execução.' using errcode='42501';end if;
     if answer ? 'pointLabel' and jsonb_typeof(answer->'pointLabel') not in ('string','null') then raise exception 'Rótulo de ponto deve ser texto declarado, nunca objeto, número ou booleano.' using errcode='22023';end if;
     if nullif(btrim(answer->>'pointLabel'),'') is not null then point_label:=pi_gestao_private.ga_text(answer->>'pointLabel','Rótulo de referência de campo declarado',200);else point_label:=point_ref->>'label';end if;
     if requires_treatment and actionability='catalog_declared' and point_label is null then raise exception 'A tratativa exige rótulo de ponto declarado; nenhuma localização é presumida.' using errcode='22023';end if;
     if point_label is not null then
      point_body:=scope||jsonb_build_object('recordClass','field_point_reference','executionId',e->>'id','label',point_label,'photoIds',answer->'photoIds','drawingReference',null,'locationStatus','pending_drawing_reference','source',source);
      if point_ref is null then point_ref:=pi_gestao_private.ga_put(p_tenant,own,'document',point_body,actor);
      elsif (point_ref-'id'-'version'-'createdAt'-'createdBy'-'updatedAt'-'updatedBy') is distinct from point_body then point_ref:=pi_gestao_private.ga_change(p_tenant,own,(point_ref->>'id')::uuid,'document',(point_ref->>'version')::bigint,point_body,actor,'referência de campo declarada atualizada; sem localização geométrica presumida');end if;
      point_status:='linked_field_reference';
     elsif requires_treatment then point_status:='pending';review_needed:=true;end if;
     normalized:=jsonb_build_object('catalogItemId',item->>'id','itemKey',item->>'itemKey','conditionId',condition->>'id','recommendationId',recommendation->>'id','notCovered',answer->'notCovered','photoIds',answer->'photoIds','requiresTreatment',requires_treatment,'conditionSupportsGoodCondition',supports_good,'actionabilityStatus',actionability,'pointId',point_ref->>'id','pointLabel',point_label,'pointVersion',point_ref->'version','pointLinkStatus',point_status);
     if condition is not null or answer->>'notCovered'='true' then completed:=completed+1;end if;
     answers:=answers||jsonb_build_array(normalized);
     shell:=pi_gestao_private.ga_record(p_tenant,own,item_id,'lvt_item');
     scope:=jsonb_build_object('assetId',i->>'assetId','lvtId',e->>'id','inspectionId',i->>'id','campaignId',i->>'campaignId','contractId',i->>'contractId','systemId',i->>'systemId','module',i->>'module','lvtItemId',item_id);
     source:=jsonb_build_object('format','field_record','actorUserId',actor,'observedOn',observed,'catalogId',cat->>'id');
     perform pi_gestao_private.ga_change(p_tenant,own,item_id,'lvt_item',(shell->>'version')::bigint,normalized||jsonb_build_object('description',condition->>'text','conditionSource',condition->'source','recommendation',recommendation->>'text','recommendationSource',recommendation->'source','status',case when answer->>'notCovered'='true' then 'gestao_tecnica_pendente' when condition is null then 'pendente' else 'respondido' end,'technicalReviewRequired',answer->'notCovered','source',source),actor,'resposta de item da LVT salva');
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into prior_rti from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into finding from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='finding' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=item_id::text;
     -- Version metadata advances on every content save. Only changes to the
     -- declared date or selected condition/recommendation invalidate the basis of
     -- an existing deadline; a no-op save or replay does not create a new review.
     deadline_review:=coalesce(prior_rti->>'deadlineReviewRequired','false')='true' or (
      nullif(btrim(prior_rti->>'due'),'') is not null and (
       (case when prior_rti->'deadlineAnchor' ? 'date' then prior_rti->'deadlineAnchor'->>'date' else prior_rti->>'sourceDate' end) is distinct from observed
       or (case when shell ? 'conditionId' then shell->>'conditionId' else prior_rti->>'conditionId' end) is distinct from condition->>'id'
       or (case when shell ? 'description' then shell->>'description' else prior_rti->>'description' end) is distinct from condition->>'text'
       -- A withdrawn RTI keeps its historical recommendation. The item records
       -- the effective selection, including an explicit empty choice.
       or (case when shell ? 'recommendationId' then shell->>'recommendationId' else prior_rti->>'recommendationId' end) is distinct from recommendation->>'id'
       or (case when shell ? 'recommendationId' and shell->>'recommendationId' is null then null else prior_rti->>'recommendation' end) is distinct from recommendation->>'text'
      ));
     if requires_treatment then
      patch:=scope||jsonb_build_object('executionId',e->>'id','description',condition->>'text','conditionId',condition->>'id','recommendation',recommendation->>'text','recommendationId',recommendation->>'id','recommendationSource',recommendation->'source','photoIds',answer->'photoIds','source',source,'sourceDate',observed,'deadlineAnchor',deadline_anchor,'deadlineReviewRequired',deadline_review,'requiresTreatment',true,'actionabilityStatus',actionability,'pointId',point_ref->>'id','pointLabel',point_label,'pointVersion',point_ref->'version','pointLinkStatus',point_status);
      if finding is null then finding:=pi_gestao_private.ga_put(p_tenant,own,'finding',patch,actor);else finding:=pi_gestao_private.ga_change(p_tenant,own,(finding->>'id')::uuid,'finding',(finding->>'version')::bigint,patch,actor,'recomendação do item atualizada');end if;
      patch:=patch||jsonb_build_object('findingId',finding->>'id','title',recommendation->>'text','originType','field_recommendation','technicalReviewRequired',actionability='legacy_unclassified' or point_status='pending','recommendationWithdrawn',false);
      if prior_rti is null then
       rti:=pi_gestao_private.ga_put(p_tenant,own,'rti',patch||jsonb_build_object('status','aberta','currentness',case when observed::date=current_date then 'confirmed_current' else 'unknown' end,'sourceStatus','Recomendação selecionada na ficha de campo','currentnessConfirmedAt',case when observed::date=current_date then now() else null end,'currentnessEvidence','Seleção registrada pelo responsável autenticado; revisão técnica pendente.','actions','[]'::jsonb,'history','[]'::jsonb),actor);
       perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',item_id,'lvt_item','addresses_item',actor);
       perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',(finding->>'id')::uuid,'finding','addresses',actor);
      else
       if prior_rti->>'status'='encerrada' and (prior_rti->>'recommendationId' is distinct from recommendation->>'id' or prior_rti->'photoIds' is distinct from answer->'photoIds') then raise exception 'RTI encerrada exige revisão técnica antes de alterar recomendação ou fotos.' using errcode='22023';end if;
       rti:=pi_gestao_private.ga_change(p_tenant,own,(prior_rti->>'id')::uuid,'rti',(prior_rti->>'version')::bigint,patch,actor,'mesma RTI atualizada pela recomendação do item');end if;
      perform pi_gestao_private.ga_link(p_tenant,own,(rti->>'id')::uuid,'rti',(i->>'assetId')::uuid,'asset','affects',actor);
     elsif prior_rti is not null then
      review_needed:=true;
      if finding is not null then perform pi_gestao_private.ga_change(p_tenant,own,(finding->>'id')::uuid,'finding',(finding->>'version')::bigint,jsonb_build_object('deadlineAnchor',deadline_anchor,'deadlineReviewRequired',deadline_review,'historicalEvidencePreserved',true,'pointId',point_ref->>'id','pointLabel',point_label,'pointVersion',point_ref->'version','pointLinkStatus',point_status),actor,'marco da inspeção atualizado; recomendação retirada em rascunho');end if;
      perform pi_gestao_private.ga_change(p_tenant,own,(prior_rti->>'id')::uuid,'rti',(prior_rti->>'version')::bigint,jsonb_build_object('technicalReviewRequired',true,'recommendationWithdrawn',true,'historicalEvidencePreserved',true,'deadlineAnchor',deadline_anchor,'deadlineReviewRequired',deadline_review,'pointId',point_ref->>'id','pointLabel',point_label,'pointVersion',point_ref->'version','pointLinkStatus',point_status),actor,'retirada de recomendação em rascunho encaminhada à gestão; RTI preservada');
     end if;
    end loop;
    patch:=jsonb_build_object('observedOn',observed,'answers',answers,'progress',jsonb_build_object('answered',completed,'total',jsonb_array_length(cat->'items')),'technicalReviewRequired',review_needed,'outcome',outcome,'coverage',coverage);
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

  if i->>'type'='visual' then
   if p_action='execution.submit' then answers:=coalesce(e->'answers','[]'::jsonb);observed:=e->>'observedOn';end if;
   selected_photo_ids:='[]'::jsonb;treatment_count:=0;
   for checked_answer in select value from jsonb_array_elements(answers) loop
    selected_photo_ids:=selected_photo_ids||coalesce(checked_answer->'photoIds','[]'::jsonb);
    select value into item from jsonb_array_elements(cat->'items') where value->>'id'=checked_answer->>'catalogItemId';
    select value into checked_condition from jsonb_array_elements(coalesce(item->'conditions','[]')) where value->>'id'=checked_answer->>'conditionId';
    select value into checked_recommendation from jsonb_array_elements(coalesce(item->'recommendations','[]')) where value->>'id'=checked_answer->>'recommendationId';
    select value into shell from jsonb_array_elements(e->'items') where value->>'catalogItemId'=checked_answer->>'catalogItemId';
    checked_item:=pi_gestao_private.ga_record(p_tenant,own,(shell->>'lvtItemId')::uuid,'lvt_item');
    if outcome in ('good_condition','treatment_required') and checked_recommendation is not null and jsonb_typeof(checked_recommendation->'requiresTreatment') is distinct from 'boolean' then raise exception 'O resultado exige classificação de tratativa explícita na curadoria do catálogo.' using errcode='22023';end if;
    if item is null or checked_item->>'catalogItemId' is distinct from checked_answer->>'catalogItemId'
    or checked_item->>'conditionId' is distinct from checked_answer->>'conditionId' or checked_item->>'recommendationId' is distinct from checked_answer->>'recommendationId'
    or (nullif(checked_answer->>'conditionId','') is not null and (checked_condition is null or checked_item->>'description' is distinct from checked_condition->>'text' or checked_item->'conditionSource' is distinct from checked_condition->'source'))
    or (nullif(checked_answer->>'recommendationId','') is not null and (checked_recommendation is null or checked_item->>'recommendation' is distinct from checked_recommendation->>'text' or checked_item->'recommendationSource' is distinct from checked_recommendation->'source'))
    then raise exception 'Escolha ou fonte salva diverge do catálogo atual; salve novamente para revisão técnica.' using errcode='22023';end if;
    if checked_recommendation is not null and (
     jsonb_typeof(checked_answer->'requiresTreatment') is distinct from 'boolean' or jsonb_typeof(checked_item->'requiresTreatment') is distinct from 'boolean'
     or (case when checked_recommendation ? 'requiresTreatment' then checked_recommendation->'requiresTreatment' else 'true'::jsonb end) is distinct from checked_answer->'requiresTreatment'
     or checked_item->'requiresTreatment' is distinct from checked_answer->'requiresTreatment'
     or checked_answer->>'actionabilityStatus' is distinct from (case when checked_recommendation ? 'requiresTreatment' then 'catalog_declared' else 'legacy_unclassified' end)
     or checked_item->>'actionabilityStatus' is distinct from checked_answer->>'actionabilityStatus'
    ) then raise exception 'Classificação de tratativa salva diverge do catálogo atual; salve novamente para revisão técnica.' using errcode='22023';end if;
    if outcome='good_condition' and (checked_answer->>'notCovered'='true' or checked_condition is null or checked_condition->>'supportsGoodCondition' is distinct from 'true' or checked_answer->>'conditionSupportsGoodCondition' is distinct from 'true' or checked_item->>'conditionSupportsGoodCondition' is distinct from 'true') then raise exception 'Boas condições exige cada condição explicitamente compatível na curadoria; ausência de tratativa não comprova condição boa.' using errcode='22023';end if;
    if checked_recommendation->>'requiresTreatment'='true' or checked_answer->>'requiresTreatment'='true' then
     treatment_count:=treatment_count+1;
     if outcome='good_condition' then raise exception 'Há tratativa nesta execução; não pode ser declarada como boas condições.' using errcode='22023';end if;
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into finding from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='finding' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=checked_item->>'id';
     select r.body||jsonb_build_object('id',r.id,'version',r.version) into rti from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id' and r.body->>'lvtItemId'=checked_item->>'id';
     if finding is null or rti is null or rti->>'findingId' is distinct from finding->>'id' or finding->>'recommendationId' is distinct from checked_answer->>'recommendationId' or rti->>'recommendationId' is distinct from checked_answer->>'recommendationId' or finding->'photoIds' is distinct from checked_answer->'photoIds' or rti->'photoIds' is distinct from checked_answer->'photoIds' or rti->>'assetId' is distinct from i->>'assetId' or rti->>'inspectionId' is distinct from i->>'id' or rti->>'contractId' is distinct from i->>'contractId' or rti->>'requiresTreatment' is distinct from 'true' or rti->>'recommendationWithdrawn' is distinct from 'false'
     or finding->>'assetId' is distinct from i->>'assetId' or finding->>'inspectionId' is distinct from i->>'id' or finding->>'contractId' is distinct from i->>'contractId'
     or finding->>'pointId' is distinct from checked_answer->>'pointId' or rti->>'pointId' is distinct from checked_answer->>'pointId'
     or finding->'pointVersion' is distinct from checked_answer->'pointVersion' or rti->'pointVersion' is distinct from checked_answer->'pointVersion'
     or finding->>'pointLabel' is distinct from checked_answer->>'pointLabel' or rti->>'pointLabel' is distinct from checked_answer->>'pointLabel' then raise exception 'A tratativa exige achado e mesma RTI canônicos; salve antes de enviar.' using errcode='22023';end if;
     if checked_recommendation->>'requiresTreatment'='true' and (checked_item->>'pointLinkStatus' is distinct from 'linked_field_reference' or nullif(checked_answer->>'pointId','') is null) then raise exception 'Tratativa classificada exige referência de campo canônica.' using errcode='22023';end if;
    end if;
    if nullif(checked_answer->>'pointId','') is not null or nullif(checked_item->>'pointId','') is not null then
     if checked_answer->>'pointId' is distinct from checked_item->>'pointId' or checked_answer->>'pointLinkStatus' is distinct from 'linked_field_reference' then raise exception 'Vínculo do ponto salvo diverge do item canônico.' using errcode='22023';end if;
     checked_point:=pi_gestao_private.ga_record(p_tenant,own,(checked_item->>'pointId')::uuid,'document');
     if checked_point->>'recordClass' is distinct from 'field_point_reference' or checked_point->>'executionId' is distinct from e->>'id' or checked_point->>'inspectionId' is distinct from i->>'id' or checked_point->>'contractId' is distinct from i->>'contractId' or checked_point->>'assetId' is distinct from i->>'assetId' or checked_point->>'lvtItemId' is distinct from checked_item->>'id' or checked_point->>'label' is distinct from checked_answer->>'pointLabel' or checked_point->'photoIds' is distinct from checked_answer->'photoIds' or checked_point->'version' is distinct from checked_answer->'pointVersion' then raise exception 'Referência de campo diverge do item salvo.' using errcode='42501';end if;
    end if;
   end loop;
   if coverage is not null then
    coverage_photo_ids:='[]'::jsonb;
    for photo_id in select value#>>'{}' from jsonb_array_elements(coverage->'photoIds') loop
     if not selected_photo_ids ? photo_id or coverage_photo_ids ? photo_id then raise exception 'Cobertura exige fotos selecionadas nos itens desta execução, sem repetição.' using errcode='22023';end if;
     photo:=pi_gestao_private.ga_record(p_tenant,own,photo_id::uuid,'photo');
     if photo->>'assetId' is distinct from i->>'assetId' or photo->>'inspectionId' is distinct from i->>'id' or photo->>'contractId' is distinct from i->>'contractId' or photo->>'lvtId' is distinct from e->>'id' then raise exception 'Foto da cobertura pertence a outra TAG, inspeção ou contrato.' using errcode='42501';end if;
     coverage_photo_ids:=coverage_photo_ids||jsonb_build_array(photo_id);
    end loop;
   end if;
   if outcome='good_condition' then
    if cat->>'status' is distinct from 'verified' or jsonb_array_length(cat->'items')=0 or jsonb_array_length(answers)<>jsonb_array_length(cat->'items') or nullif(observed,'') is null or coverage is null or jsonb_array_length(coverage->'photoIds')=0 then raise exception 'Boas condições exige checklist completo, data observada, cobertura declarada e ao menos uma foto vinculada.' using errcode='22023';end if;
    if exists(select 1 from pi_gestao_private.records r where r.tenant_id=p_tenant and r.owner_id=own and r.kind='rti' and r.body->>'executionId'=e->>'id') then raise exception 'RTI desta execução permanece para gestão técnica; sua retirada não autoriza boas condições.' using errcode='22023';end if;
   elsif outcome='treatment_required' and treatment_count=0 then raise exception 'Resultado com tratativa exige ao menos uma recomendação acionável do catálogo.' using errcode='22023';end if;
   if p_action='execution.save' then patch:=patch||jsonb_build_object('outcome',outcome,'coverage',coverage);end if;
  end if;
   kind:=case when i->>'type'='visual' then 'lvt' else 'document' end;
   patch:=patch||jsonb_build_object('deadlineAnchor',deadline_anchor);
   perform pi_gestao_private.ga_change(p_tenant,own,(e->>'id')::uuid,kind,(e->>'version')::bigint,patch,actor,'mesmo rascunho de execução salvo');
  end if;
 end if;
 result:=pi_gestao_private.ga_execution_detail(p_tenant,own,inspection_id);
 insert into pi_gestao_private.operation_receipts(tenant_id,owner_id,action,request_id,digest,result,actor_user_id) values(p_tenant,own,p_action,ga_api_execution.request_id,digest,result,actor);
 return result;
end $$;

revoke all on function pi_gestao_private.ga_catalog_binding_immutable(),pi_gestao_private.ga_execution_validate_catalog(uuid,uuid,jsonb),pi_gestao_private.ga_execution_catalog_applicable(jsonb,jsonb,jsonb),pi_gestao_private.ga_execution_catalog_binding_json(pi_gestao_private.inspection_catalog_bindings),pi_gestao_private.ga_execution_catalog_state(uuid,uuid,jsonb,jsonb,uuid,uuid,boolean),pi_gestao_private.ga_execution_select_catalog(uuid,uuid,jsonb,jsonb,uuid),pi_gestao_private.ga_execution_catalog(uuid,uuid,uuid),pi_gestao_private.ga_execution_scope_matches(jsonb,jsonb,jsonb),pi_gestao_private.ga_system_report_scoped(uuid,uuid,uuid,uuid,uuid),pi_gestao_private.ga_execution_detail(uuid,uuid,uuid),pi_gestao_private.ga_api_execution(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function pi_gestao_private.ga_execution_actor_scope(uuid,uuid,uuid,uuid,boolean),pi_gestao_private.ga_execution_context(uuid,uuid,uuid),pi_gestao_private.ga_execution_report(uuid,uuid,uuid),pi_gestao_private.ga_execution_source(uuid,uuid,uuid,text,uuid),pi_gestao_private.ga_execution_photo_scope(uuid,uuid,uuid,uuid,uuid,bigint),pi_gestao_private.ga_execution_photo(uuid,uuid,jsonb),public.pi_gestao_execution_photo(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function pi_gestao_private.ga_execution_photo(uuid,uuid,jsonb),public.pi_gestao_execution_photo(uuid,uuid,jsonb) to service_role;
revoke execute on function pi_gestao_private.ga_api(uuid,text,jsonb),pi_gestao_private.ga_api_operational(uuid,text,jsonb),pi_gestao_private.ga_api_prepared(uuid,text,jsonb),pi_gestao_private.ga_api_projects(uuid,text,jsonb) from authenticated;
grant execute on function pi_gestao_private.ga_api_execution(uuid,text,jsonb) to authenticated;
create or replace function public.pi_gestao_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select pi_gestao_private.ga_api_execution(p_tenant,p_action,p_payload);
end;
commit;
