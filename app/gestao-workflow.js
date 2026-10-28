(function(root){
  "use strict";
  const titles={"field-lvts":"Preencher nova LVT", "field-items":"Adicionar item inspecionado", "rti-updates":"Registrar acompanhamento da RTI", "inspection-updates":"Atualizar andamento da inspeção", "asset-register":"Cadastrar equipamento ou válvula", "asset-operation":"Atualizar situação operacional", "asset-links":"Vincular ativo relacionado", measurements:"Registrar medição de espessura", certificates:"Registrar certificado da válvula", classifications:"Registrar enquadramento documentado", deadlines:"Registrar próxima inspeção documentada"};
  titles.hierarchy = "Cadastrar unidade e sistema";
  titles['nr13-assess']='Calcular enquadramento NR-13';
  titles['perenco-line-list']='Iniciar campanha PCH-1 com a lista confirmada';
  titles['perenco-tq-book']='Montar book TQ-04761 · PCH-2';
  function create(options){
    const doc=options.document||root.document,context=options.getContext;
    const records=k=>context().state?.[k]||[],label=r=>r.tag||r.reference||r.name||r.title||r.itemKey||r.id;
    const key=()=>[context().tenantId,context().client?.id].join('/');
    const writable=()=>context().mode==='connected'&&context().write===true&&context().capabilities?.workflowVersion>=2&&context().client;
    function render(parent,operation,defaults={}){
      if(!titles[operation]||!writable())return false;
      const initialKey=key(),requestId=root.crypto.randomUUID(),controls={},box=doc.createElement('details'),form=doc.createElement('form'),grid=doc.createElement('div'),feedback=doc.createElement('p');
      box.className='operation-drawer';grid.className='formgrid';form.dataset.operation=operation;feedback.setAttribute('role','status');
      const summary=doc.createElement('summary');summary.textContent=titles[operation];box.append(summary);
      const add=(name,text,type='text',required=true,value,choices)=>{
        const wrap=doc.createElement('label'),input=doc.createElement(choices?'select':type==='textarea'?'textarea':'input');wrap.append(doc.createTextNode(text));input.name=name;input.required=required;
        if(choices){const empty=doc.createElement('option');empty.value='';empty.textContent=required?'Selecione':'Não informado / manter pendente';input.append(empty);for(const [val,caption] of choices){const opt=doc.createElement('option');opt.value=val;opt.textContent=caption;input.append(opt);}}
        else if(type!=='textarea')input.type=type;
        if(value!==undefined&&value!==null)input.value=value;
        wrap.append(input);grid.append(wrap);controls[name]=input;return input;
      };
      const select=(name,text,kind,filter=()=>true,required=true,value=defaults[name])=>add(name,text,'select',required,value,records(kind).filter(filter).map(r=>[r.id,label(r)]));
      const note=text=>{const p=doc.createElement('p');p.className='form-help';p.textContent=text;grid.append(p);};
      const origin=()=>{select('sourceDocumentId','Documento que comprova o registro','document',r=>Boolean(r.source?.sourceId));add('section','Página, item ou células exatas no documento');};
      const assetSelect=()=>select('assetId','Ativo / TAG','asset',()=>true);
      if(operation==='perenco-line-list'){
        note('Lista original PCH-1: 1.769 registros em 24 sistemas. A organização mantém pendentes as TAGs repetidas, fórmulas e identificações inconclusivas. Contrato e datas da campanha ficam a confirmar. A repetição conserva os mesmos registros.');
      }else if(operation==='perenco-tq-book'){
        note('Plano e desenho originais da Priner, de 13/08/2025. Cadastro do tanque na PCH-2, ficha técnica e enquadramento automático com pendências documentais. Não vincula linhas da PCH-1 por semelhança de TAG.');
      }else if(operation==='nr13-assess'){
        select('assetId','Ativo / TAG','asset',r=>['tanque','vaso','caldeira','outro'].includes(r.type));origin();
        for(const [name,text] of [['pressureKpa','Pressão máxima de operação (kPa manométricos)'],['volumeM3','Volume / capacidade nominal (m³)'],['diameterM','Diâmetro (m): interno para vaso; externo para tanque'],['temperatureC','Temperatura de operação (°C)'],['toxicPpm','Limite de tolerância do tóxico (ppm)']])add(name,text,'text',false);
        add('fluidCriterion','Propriedade documentada do fluido','select',false,undefined,[['flammable','Inflamável'],['combustible','Combustível'],['toxic','Tóxico'],['hydrogen','Hidrogênio'],['acetylene','Acetileno'],['steam','Vapor de água'],['air','Ar comprimido'],['asphyxiant','Asfixiante simples'],['other','Outro fluido, fora das classes A/B/C']]);
        add('fluidEvidence','FDS / referência que comprova a propriedade do fluido','textarea',false);
        add('support','Tanque: forma de apoio / construção','select',false,undefined,[['ground','Apoiado diretamente sobre o solo'],['structural','Estrutural de embarcação/plataforma'],['buried','Enterrado'],['legs','Sobre pernas'],['saddles','Sobre selas'],['pedestals','Sobre pedestais'],['shoes','Sobre sapatas']]);
        add('metal','Tanque metálico?','select',false,undefined,[['yes','Sim, documentado'],['no','Não, documentado']]);
        add('tankDefinition','Construção compatível com a definição normativa de tanque?','select',false,undefined,[['yes','Sim, documentado']]);
        add('exclusionsReviewed','Vaso / caldeira: exclusões de 13.2.2 conferidas?','select',false,undefined,[['yes','Sim, com evidência no original']]);
        add('specificExclusion','Vaso / caldeira: há exclusão específica aplicável?','select',false,undefined,[['no','Não, conforme conferência documentada'],['yes','Sim — manter em análise']]);
        note('O servidor calcula o resultado pelas regras da NR-13. Campos ausentes geram pendências; tanque não recebe categoria I–V. O cálculo não emite aprovação técnica nem define datas de inspeção.');
        const fillKnown=()=>{const latest=records('classification').filter(r=>r.assetId===controls.assetId.value&&r.classificationMethod==='automatic_nr13').at(-1);for(const [name,input] of Object.entries(controls)){if(['assetId','sourceDocumentId','section'].includes(name))continue;input.value=latest?.inputs?.[name]||'';}const source=latest?.source,original=records('document').find(d=>d.source?.sourceId===source?.sourceId&&d.assetId===controls.assetId.value&&!d.recordClass);controls.sourceDocumentId.value=original?.id||'';controls.section.value=source?.locator?.section||(source?.locator?.page?'Página '+source.locator.page:'');};
        controls.assetId.onchange=fillKnown;fillKnown();
      }else if(operation==='hierarchy'){
        add('unit','Unidade / instalação'); add('system','Nome / código do sistema');
        note('Use a identificação do documento. Se a unidade não estiver comprovada, registre “Unidade a confirmar”. O ativo será cadastrado com a referência exata do original.');
      }else if(operation==='field-lvts'){
        select('inspectionId','Inspeção visual','inspection',r=>r.type==='visual'&&r.status!=='concluida'&&(!defaults.assetId||r.assetId===defaults.assetId));
        add('observedOn','Data em que a inspeção foi realizada','date');add('inspector','Responsável pela inspeção');add('procedure','Procedimento / revisão','text',false);
        note('Preencha com a inspeção realizada. Registros de datas anteriores permanecem históricos até a verificação da situação atual.');
      }else if(operation==='field-items'){
        select('lvtId','LVT em preenchimento','lvt',r=>r.recordClass==='field_lvt'&&(!defaults.assetId||r.assetId===defaults.assetId));
        add('itemKey','Número / identificação do item');add('component','Ponto ou componente inspecionado');add('condition','Condição encontrada','textarea');add('observations','Observações','textarea',false);add('recommendation','Recomendação — deixe vazio se não houver achado','textarea',false);
        note('Uma recomendação preenchida cria a RTI vinculada ao item automaticamente. As fotos são anexadas ao abrir o item salvo.');
      }else if(operation==='rti-updates'){
        const rti=records('rti').find(r=>r.id===defaults.id);if(!rti)return false;
        add('responsible','Responsável pelo atendimento','text',false,rti.responsible);add('due','Prazo definido','date',false,rti.due);add('action','Ação necessária ou realizada','textarea',false);add('evidence','Registro / evidência deste acompanhamento','textarea');
        add('status','Verificação da situação atual','select',false,undefined,[['aberta','Confirmar aberta'],['encerrada','Confirmar encerrada']]);
        add('confirmedOn','Data da verificação atual','date',false);select('evidenceDocumentId','Documento de evidência do atendimento','document',r=>r.assetId===rti.assetId,false);add('reinspection','Reinspeção / verificação de atendimento','textarea',false);
        note('Acompanhar ações não altera sozinho a situação histórica. Encerrar exige verificação de hoje, documento de evidência e resultado da reinspeção.');
      }else if(operation==='inspection-updates'){
        const inspection=records('inspection').find(r=>r.id===defaults.id);if(!inspection)return false;
        add('status','Andamento','select',true,undefined,[['em_andamento','Em andamento'],['concluida','Concluída']]);add('done','Data da execução','date');add('evidence','Evidência da execução / referência dos registros','textarea');
      }else if(operation==='asset-operation'){
        if(!records('asset').some(r=>r.id===defaults.assetId))return false;
        add('operation','Situação operacional','select',true,undefined,[['em_operacao','Em operação'],['fora_de_operacao','Fora de operação'],['descontinuado','Descontinuado'],['nao_informado','Não informado']]);add('reason','Motivo — obrigatório fora de operação ou descontinuado','textarea',false);add('evidence','Fonte / confirmação da situação operacional','textarea');
      }else if(operation==='asset-register'){
        select('systemId','Sistema','system');add('tag','TAG definitiva');add('type','Tipo de ativo','select',true,undefined,[['linha','Linha'],['segmento','Segmento'],['vaso','Vaso'],['tanque','Tanque'],['caldeira','Caldeira'],['valvula','Válvula / PSV'],['outro','Outro']]);add('identification','Identificação / descrição','text',false);add('fluid','Fluido documentado','text',false);origin();
      }else if(operation==='asset-links'){
        assetSelect();select('toAssetId','Ativo relacionado','asset',r=>r.id!==defaults.assetId);add('kind','Relação documentada','select',true,undefined,[['valvula_psv','Válvula / PSV do equipamento'],['linha_integridade','Linha relacionada'],['medicao_espessura','Medição relacionada'],['relacao_documentada','Outra relação documentada']]);add('reference','Identificação do vínculo');add('basis','Trecho que comprova a relação','textarea');origin();
      }else if(operation==='measurements'){
        assetSelect();select('inspectionId','Inspeção de espessura','inspection',r=>r.type==='espessura'&&(!defaults.assetId||r.assetId===defaults.assetId));add('reference','Identificação da medição');add('measuredOn','Data da medição','date');add('instrument','Instrumento','text',false);add('calibration','Calibração / certificado','text',false);add('procedure','Procedimento','text',false);add('readings','Leituras: ponto ; valor ; unidade — uma por linha','textarea');origin();
        note('Use ponto decimal e a unidade mm ou in. As leituras ficam registradas sem calcular aprovação ou espessura mínima não documentada.');
      }else if(operation==='certificates'){
        select('assetId','Válvula / PSV','asset',r=>r.type==='valvula');add('reference','Número / revisão do certificado');add('issuedOn','Data do certificado','date',false);add('validUntil','Validade informada no certificado','date',false);add('issuer','Empresa / responsável emissor','text',false);add('resultText','Resultado literal do certificado','textarea',false);origin();
      }else if(operation==='classifications'){
        assetSelect();add('reference','Documento de enquadramento');add('scope','Enquadramento documentado','select',true,undefined,[['covered','Enquadrado'],['not_covered','Fora do escopo'],['excluded','Exclusão documentada'],['pending','A confirmar']]);add('category','Categoria documentada — somente quando aplicável','select',false,undefined,['I','II','III','IV','V','A','B'].map(x=>[x,x]));add('responsible','Responsável pelo enquadramento no documento');add('basis','Conclusão transcrita do documento','textarea');origin();
        note('Este registro transcreve o enquadramento existente. Não substitui análise técnica ou calcula categoria automaticamente.');
      }else if(operation==='deadlines'){
        assetSelect();add('reference','Documento que define o prazo');add('type','Próxima inspeção','select',true,undefined,[['interna','Interna'],['externa','Externa'],['extraordinaria','Extraordinária'],['certificacao','Certificação']]);add('due','Data documentada','date');origin();
      }
      const submit=doc.createElement('button');submit.type='submit';submit.textContent='Salvar registro';form.append(grid,submit,feedback);box.append(form);parent.append(box);
      if(operation==='field-items')controls.recommendation.oninput=()=>{submit.textContent=controls.recommendation.value.trim()?'Salvar item e abrir RTI':'Salvar item';};
      form.onsubmit=async event=>{
        event.preventDefault();if(!writable()||key()!==initialKey)return;submit.disabled=true;feedback.textContent='Salvando…';
        try{
          const payload={requestId};for(const [name,input] of Object.entries(controls))payload[name]=input.value.trim()||null;
          if(operation==='perenco-line-list')await options.uploadPrepared('perenco-pch1-line-list');
          if(operation==='perenco-tq-book'){await options.uploadPrepared('perenco-tq04761-plan');await options.uploadPrepared('perenco-tq04761-drawing');}
          if(['rti-updates','inspection-updates'].includes(operation)){const r=records(operation==='rti-updates'?'rti':'inspection').find(r=>r.id===defaults.id);payload.id=r.id;payload.expectedVersion=r.version;}
          if(operation==='asset-operation'){const r=records('asset').find(r=>r.id===defaults.assetId);payload.assetId=r.id;payload.expectedVersion=r.version;}
          if(controls.sourceDocumentId){const source=records('document').find(r=>r.id===payload.sourceDocumentId)?.source;if(!source?.sourceId)throw Error('Selecione um documento original registrado.');payload.sourceId=source.sourceId;payload.locator={section:payload.section};delete payload.sourceDocumentId;delete payload.section;}
          if(operation==='nr13-assess'){payload.inputs={};for(const name of Object.keys(controls)){if(['assetId','sourceDocumentId','section'].includes(name))continue;payload.inputs[name]=payload[name];delete payload[name];}}
          if(operation==='measurements')payload.readings=controls.readings.value.split(/\r?\n/).filter(x=>x.trim()).map(line=>{const [point,value,unit,...extra]=line.split(';').map(x=>x.trim());if(!point||!/^\d+(\.\d+)?$/.test(value)||!['mm','in'].includes(unit)||extra.length)throw Error('Cada leitura deve conter ponto ; valor com ponto decimal ; mm ou in.');return {point,value,unit};});
          if(!writable()||key()!==initialKey)return;
          const result=await options.write(operation,payload);if(key()!==initialKey)return;feedback.textContent='Registro salvo. Atualizando…';await options.refresh();if(key()===initialKey)options.onSuccess?.(result,operation);
        }catch(error){feedback.textContent=error.message;options.onError?.(error);}finally{if(form.isConnected)submit.disabled=!writable();}
      };
      return true;
    }
    return Object.freeze({supports:operation=>Object.hasOwn(titles,operation),render});
  }
  root.PiresGestaoWorkflow=Object.freeze({create});
})(typeof globalThis!=='undefined'?globalThis:this);
