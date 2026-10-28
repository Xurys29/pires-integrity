-- Contract dashboards: additive records using the existing private registry and pilot gate.
-- Originals, canonical assets, financial references and licenses are never replaced.
begin;

create function pi_gestao_private.gp_preview(t uuid,o uuid,c jsonb,i jsonb,a uuid)
returns jsonb language plpgsql set search_path='' as $$
declare src pi_gestao_private.sources; sh jsonb; rr jsonb; v jsonb; rows jsonb:='[]'; issues jsonb;
 m jsonb:=coalesce(i->'mapping','{}'); k text; col text; n integer; first_n integer; last_n integer;
 target jsonb; matches jsonb; typ text; mod text:=c->'modules'->>0; ident text; range_info jsonb; selected jsonb;
begin
 if i->>'mode'='existing' then
  if jsonb_typeof(i->'ids') is distinct from 'array' or jsonb_array_length(i->'ids')>10000 then raise exception 'Selecione os registros existentes.';end if;
  for ident in select distinct jsonb_array_elements_text(i->'ids') loop
   target:=pi_gestao_private.ga_record(t,o,ident::uuid,case when mod='rtis' then 'rti' else 'asset' end);
   if mod='nr13' and target->>'type' not in ('tanque','vaso','caldeira','outro') or mod='valvulas' and target->>'type'<>'valvula' then raise exception 'Tipo incompatível com o módulo.';end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('row',jsonb_array_length(rows)+1,'existingId',ident,'values',target,'action','link','issues','[]'::jsonb));
  end loop;
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
end $$;

create function pi_gestao_private.ga_api_projects(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function pi_gestao_private.gp_preview(uuid,uuid,jsonb,jsonb,uuid),pi_gestao_private.ga_api_projects(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function pi_gestao_private.ga_api_projects(uuid,text,jsonb) to authenticated;
create or replace function public.pi_gestao_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' begin atomic select pi_gestao_private.ga_api_projects(p_tenant,p_action,p_payload);end;
commit;
