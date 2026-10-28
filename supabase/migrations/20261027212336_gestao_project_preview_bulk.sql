-- Keep the same gate and atomic scope; bound previews to identity fields.
begin;
create or replace function pi_gestao_private.gp_preview(t uuid,o uuid,c jsonb,i jsonb,a uuid)
returns jsonb language plpgsql set search_path='' as $$
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
end $$;


commit;
