-- Resume the confirmed PCH-1 source in atomic batches; preserve the authenticated timeout and access gate.
begin;
create or replace function pi_gestao_private.ga_api_prepared(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;

commit;
