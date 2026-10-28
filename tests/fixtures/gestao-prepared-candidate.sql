-- LOCAL TEST CANDIDATE ONLY. No migration or production execution is authorized by this file.
-- PGlite fixture tests will verify access, atomicity, idempotence and classification boundaries.
begin;
create function pi_gestao_private.ga_nr13_result(t text,i jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
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
end $$;

create function pi_gestao_private.ga_api_prepared(p_tenant uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare actor uuid;own uuid;asset jsonb;evidence jsonb;result jsonb;b jsonb;h jsonb;m jsonb;r jsonb;issues jsonb;source_id text;k text;
 ids jsonb:='[]';pending jsonb:='[]';systems jsonb:='{}';sys text;con jsonb;camp jsonb;count_ok int:=0;count_dup int:=0;counts jsonb;prior jsonb;typ text;src text;d jsonb;
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
  select jsonb_object_agg(tag,n) into counts from(select lower(btrim(value->>'tag')) tag,count(*) n from jsonb_array_elements(m->'rows') group by lower(btrim(value->>'tag'))) c;
  for r in select value from jsonb_array_elements(m->'rows') loop
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
revoke all on function pi_gestao_private.ga_nr13_result(text,jsonb),pi_gestao_private.ga_api_prepared(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function pi_gestao_private.ga_api_prepared(uuid,text,jsonb) to authenticated;
create or replace function public.pi_gestao_api(p_tenant uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' begin atomic select pi_gestao_private.ga_api_prepared(p_tenant,p_action,p_payload);end;
commit;
