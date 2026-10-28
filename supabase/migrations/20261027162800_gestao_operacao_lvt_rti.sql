-- Additive pilot workflow. Existing actor/tenant/pilot checks remain authoritative.
-- No user, license, pilot grant, bucket or original is changed by this migration.
begin;

create table pi_gestao_private.operation_receipts (
 tenant_id uuid not null, owner_id uuid not null, action text not null, request_id uuid not null,
 digest text not null, result jsonb not null, actor_user_id uuid not null, created_at timestamptz not null default now(),
 primary key(tenant_id,owner_id,action,request_id),
 foreign key(tenant_id,owner_id) references pi_gestao_private.owners(tenant_id,id)
);
alter table pi_gestao_private.operation_receipts enable row level security;
revoke all on pi_gestao_private.operation_receipts from public,anon,authenticated,service_role;

create function pi_gestao_private.ga_date(p_value text,p_label text,p_required boolean default false)
returns text language plpgsql immutable set search_path='' as $$
begin
 if nullif(btrim(p_value),'') is null then
  if p_required then raise exception '%: data obrigatória.',p_label; end if;
  return null;
 end if;
 if p_value !~ '^\d{4}-\d{2}-\d{2}$' or to_char(p_value::date,'YYYY-MM-DD')<>p_value then raise exception '%: data inválida.',p_label;end if;
 return p_value;
end $$;

create function pi_gestao_private.ga_change(p_tenant uuid,p_owner uuid,p_id uuid,p_kind text,p_version bigint,p_patch jsonb,p_actor uuid,p_event text)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; old_record pi_gestao_private.records;
begin
 select * into old_record from pi_gestao_private.records where tenant_id=p_tenant and owner_id=p_owner and id=p_id and kind=p_kind for update;
 if not found then raise exception 'Registro não encontrado neste cliente.';end if;
 if p_version is null or p_version<>old_record.version then raise exception using errcode='40001',message='O registro mudou. Atualize a tela antes de salvar novamente.';end if;
 update pi_gestao_private.records set body=body||p_patch||jsonb_build_object('updatedAt',now(),'updatedBy',p_actor),version=version+1
 where tenant_id=p_tenant and owner_id=p_owner and id=p_id returning body||jsonb_build_object('id',id,'version',version) into result;
 perform pi_gestao_private.ga_audit(p_tenant,p_owner,p_id,p_actor,p_event,jsonb_build_object('previousVersion',old_record.version,'previous',old_record.body,'record',result));
 return result;
end $$;

create function pi_gestao_private.ga_api_operational(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

revoke all on function pi_gestao_private.ga_date(text,text,boolean),pi_gestao_private.ga_change(uuid,uuid,uuid,text,bigint,jsonb,uuid,text),pi_gestao_private.ga_api_operational(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function pi_gestao_private.ga_api_operational(uuid,text,jsonb) to authenticated;
create or replace function public.pi_gestao_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path=''
begin atomic
 select pi_gestao_private.ga_api_operational(p_tenant,p_action,p_payload);
end;
commit;
