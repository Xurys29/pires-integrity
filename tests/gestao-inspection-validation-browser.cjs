"use strict";
// Validation only. All accounts, API responses, catalogue phrases and photos
// are synthetic fixtures confined to this Node process. This script never
// starts the application API, connects to Supabase or changes product files.
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {chromium}=require("playwright");
const {ids,staticServer,fixturePage,navigate,noOverflow,pngFixture}=require("./gestao-inspection-browser.cjs");
const root=path.resolve(__dirname,".."),output=process.env.PIRES_BROWSER_OUTPUT_DIRECTORY?path.resolve(root,process.env.PIRES_BROWSER_OUTPUT_DIRECTORY):path.join(root,"output/flow-validation-20261029/browser"),validationDate=process.env.PIRES_BROWSER_VALIDATION_DATE||"2026-10-29";
const API="https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const ownerPrefix=`companies/${ids.owner}/`,url=operation=>API+ownerPrefix+operation;
const desktop={width:1440,height:1000},mobile={width:390,height:844};
const copy=value=>JSON.parse(JSON.stringify(value));
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-pires-tenant,x-pires-source-name"};
const first=page=>page.locator('[data-catalog-item-id="fixture-item-1"]');
const second=page=>page.locator('[data-catalog-item-id="fixture-item-2"]');
const ready=(page,inspection=ids.visual,execution)=>page.locator(`.inspection-workspace[data-inspection-id="${inspection}"]${execution?`[data-execution-id="${execution}"]`:""}`).waitFor();
const queueReady=(page,inspection=ids.visual)=>page.locator(`.inspection-card[data-inspection-id="${inspection}"]`).waitFor();
const saveButton=page=>page.getByRole("button",{name:"Salvar rascunho",exact:true});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const deadline=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error("Timeout: "+label)),8000);timer.unref?.();})]);
function counts(f){return {executions:f.executions.size,lvts:f.state.lvt.length,photos:f.state.photo.length,rtis:f.state.rti.length,contracts:f.state.contract.length,professionals:f.professionals.length};}
async function open(f,inspection=ids.visual,start=true){
  const page=f.page;
  await queueReady(page,inspection);
  await page.locator(`.inspection-card[data-inspection-id="${inspection}"]`).getByRole("button",{name:/^(Iniciar|Continuar|Consultar) inspeção$/}).click();
  await ready(page,inspection);
  if(start&&!f.executions.has(inspection)){
    await page.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(page,inspection,inspection===ids.visual?ids.visualExecution:ids.thicknessExecution);
  }
}
async function fillAnswers(page,{recommendation=false}={}){
  await page.locator('[name="observedOn"]').fill("2026-10-29");
  await first(page).locator('[name="conditionId"]').selectOption("fixture-condition-1");
  await second(page).locator('[name="conditionId"]').selectOption("fixture-condition-2");
  if(recommendation)await first(page).locator('[name="recommendationId"]').selectOption("fixture-recommendation-1");
}
async function assertAnswers(page){
  assert.equal(await page.locator('[name="observedOn"]').inputValue(),"2026-10-29");
  assert.equal(await first(page).locator('[name="conditionId"]').inputValue(),"fixture-condition-1");
  assert.equal(await second(page).locator('[name="conditionId"]').inputValue(),"fixture-condition-2");
}
async function saveOk(f){
  const refreshed=f.page.waitForResponse(response=>response.url()===url("execution/"+ids.visual)&&response.request().method()==="GET");
  await saveButton(f.page).click();await refreshed;await ready(f.page,ids.visual,ids.visualExecution);
}
async function uploadOne(f){
  const item=first(f.page);
  await item.locator('input[type="file"]').setInputFiles({name:"FOTO-VALIDACAO-SOMENTE-FIXTURE.png",mimeType:"image/png",buffer:pngFixture});
  await item.getByRole("button",{name:"Anexar fotos do item",exact:true}).click();
  await item.getByRole("status").filter({hasText:/Fotos vinculadas/}).waitFor();
}
const scenarios=[];
function scenario(id,title,viewport,steps,run,options={}){scenarios.push({id,title,viewport,steps,run,options});}

for(const [prefix,viewport] of [["D01",desktop],["M01",mobile]])scenario(prefix,"Duplo clique em Iniciar e retomada preservam o mesmo registro",viewport,[
  "Abrir uma atividade visual atribuída, sem execução existente.",
  "Segurar a resposta POST execution-start e aplicar dblclick no botão Iniciar.",
  "Conferir botão bloqueado e um POST; liberar resposta, salvar respostas, voltar a Minhas, continuar e recarregar."
],async f=>{
  const p=f.page;await open(f,ids.visual,false);
  const received=deferred(),release=deferred();let calls=0;
  await p.route(url("execution-start"),async route=>{calls++;received.resolve();await release.promise;await route.fallback();});
  const button=p.getByRole("button",{name:"Iniciar inspeção",exact:true}),clicked=button.dblclick({force:true});
  try{await deadline(received.promise,"POST start");assert.equal(await button.isDisabled(),true);assert.equal(calls,1);}finally{release.resolve();}
  await clicked;await ready(p,ids.visual,ids.visualExecution);
  assert.equal(calls,1);assert.equal(f.executions.size,1);assert.equal(f.state.lvt.length,1);
  await fillAnswers(p);await saveOk(f);
  await p.getByRole("button",{name:"Minhas inspeções",exact:true}).click();await queueReady(p);
  await p.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Continuar inspeção",exact:true}).click();
  await ready(p,ids.visual,ids.visualExecution);await p.reload();await ready(p,ids.visual,ids.visualExecution);await assertAnswers(p);
  assert.deepEqual(counts(f),{executions:1,lvts:1,photos:0,rtis:0,contracts:1,professionals:2});
  return {startPostCount:calls,executionId:f.executions.get(ids.visual).id,counts:counts(f)};
});

scenario("D02","Erro 503 ao salvar conserva respostas e retry usa o mesmo requestId",desktop,[
  "Iniciar, selecionar condições e data sem recomendação.","Fazer primeiro POST execution-save retornar 503 antes de qualquer gravação.",
  "Conferir seleção/data preservadas e execução vazia; clicar Salvar novamente e conferir persistência e requestId idêntico."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p);const attempted=[];
  await p.route(url("execution-save"),async route=>{attempted.push(route.request().postDataJSON());if(attempted.length===1)return route.fulfill({status:503,headers:cors,json:{error:"FALHA SINTÉTICA 503 AO SALVAR",code:"fixture_unavailable"}});return route.fallback();});
  await saveButton(p).click();await p.getByText("FALHA SINTÉTICA 503 AO SALVAR",{exact:true}).waitFor();await assertAnswers(p);
  assert.equal(f.executions.get(ids.visual).answers.length,0);assert.equal(f.executions.get(ids.visual).version,1);assert.equal(await saveButton(p).isDisabled(),false);
  await p.screenshot({path:path.join(output,"D02-save-503-retained.png"),fullPage:true});
  await saveOk(f);await assertAnswers(p);assert.equal(attempted.length,2);assert.equal(attempted[0].requestId,attempted[1].requestId);assert.equal(attempted[0].expectedVersion,attempted[1].expectedVersion);
  return {attemptedRequestIds:attempted.map(x=>x.requestId),savedVersion:f.executions.get(ids.visual).version,counts:counts(f)};
});

scenario("D03","Falha de resposta após gravação permite retry idempotente do cliente",desktop,[
  "Iniciar e preencher respostas; no interceptor HTTP, aplicar uma gravação ao estado isolado e retornar 503 de resultado não confirmado.",
  "Conferir aviso de resultado não confirmado, respostas conservadas e versão já gravada.","Repetir Salvar com o mesmo payload; conferir mesmo requestId e que a fixture retorna o recibo sem segunda mudança de versão."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p);const attempts=[];let receipt,applied=0;
  await p.route(url("execution-save"),async route=>{
    const body=route.request().postDataJSON();attempts.push(copy(body));
    if(attempts.length===1){
      const execution=f.executions.get(ids.visual);execution.answers=copy(body.answers);execution.observedOn=body.observedOn;execution.version++;execution.progress={answered:2,total:2};applied++;
      receipt={actorUserId:ids.user,professionalId:ids.professional,canAssign:true,canExecute:true,writeAllowed:true,professionals:copy(f.professionals),inspection:{...copy(f.state.inspection.find(x=>x.id===ids.visual)),executionId:execution.id,executionStatus:execution.status,progress:execution.progress},execution:copy(execution),catalog:copy(f.catalog)};
      return route.fulfill({status:503,headers:cors,json:{error:"RESULTADO SINTÉTICO NÃO CONFIRMADO APÓS GRAVAÇÃO",code:"fixture_uncertain_response"}});
    }
    if(body.requestId!==attempts[0].requestId)return route.fulfill({status:409,headers:cors,json:{error:"Fixture: retry não reutilizou requestId",code:"version_conflict"}});
    return route.fulfill({status:200,headers:cors,json:receipt});
  });
  await saveButton(p).click();await p.getByText("RESULTADO SINTÉTICO NÃO CONFIRMADO APÓS GRAVAÇÃO",{exact:true}).waitFor();await assertAnswers(p);
  assert.equal(f.executions.get(ids.visual).version,2);assert.equal(f.executions.get(ids.visual).answers.length,2);
  await saveOk(f);assert.equal(attempts.length,2);assert.equal(attempts[0].requestId,attempts[1].requestId);assert.equal(applied,1);assert.equal(f.executions.get(ids.visual).version,2);assert.equal(f.state.lvt.length,1);
  return {interceptedRequestIds:attempts.map(x=>x.requestId),fixtureCommits:applied,versionAfterRetry:2,limit:"Commit e recibo são simulados pelo interceptor HTTP somente para testar retry do cliente; idempotência SQL é verificada em suíte separada."};
});

scenario("D04","Duplo clique em Salvar envia somente uma gravação em andamento",desktop,[
  "Preencher rascunho e segurar resposta execution-save.","Aplicar dblclick em Salvar; conferir Salvar e Enviar bloqueados e um POST.","Liberar resposta e conferir uma versão nova."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p);const received=deferred(),release=deferred();let calls=0;
  await p.route(url("execution-save"),async route=>{calls++;received.resolve();await release.promise;await route.fallback();});
  const clicked=saveButton(p).dblclick({force:true});
  try{await deadline(received.promise,"POST save");assert.equal(await saveButton(p).isDisabled(),true);assert.equal(await p.getByRole("button",{name:"Enviar para revisão",exact:true}).isDisabled(),true);assert.equal(calls,1);}finally{release.resolve();}
  await clicked;await p.locator(".inspection-feedback").filter({hasText:/Rascunho salvo/}).waitFor();assert.equal(calls,1);assert.equal(f.executions.get(ids.visual).version,2);
  return {savePostCount:calls,version:2,counts:counts(f)};
});

scenario("D05","Conflito 409 preserva respostas sem sobrescrever o registro",desktop,[
  "Preencher respostas e simular conflito 409 no POST execution-save.","Conferir mensagem de conflito, seleções e data ainda presentes, nenhuma gravação na fixture e botão liberado."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p);let attempts=0;
  await p.route(url("execution-save"),route=>{attempts++;return route.fulfill({status:409,headers:cors,json:{error:"CONFLITO SINTÉTICO: recarregue antes de conciliar",code:"version_conflict"}});});
  await saveButton(p).click();await p.getByText("CONFLITO SINTÉTICO: recarregue antes de conciliar",{exact:true}).waitFor();await assertAnswers(p);
  assert.equal(attempts,1);assert.equal(f.executions.get(ids.visual).version,1);assert.equal(f.executions.get(ids.visual).answers.length,0);assert.equal(await saveButton(p).isDisabled(),false);
  return {attempts,storedVersion:1,storedAnswers:0,limit:"O teste não afirma resolução automática do conflito; o registro remoto precisa ser relido para conciliação."};
});

scenario("D06","Salvar confirmado com falha de atualização avisa e reabre o mesmo rascunho",desktop,[
  "Iniciar/preencher; permitir POST save e fazer a próxima consulta state falhar com 503.","Conferir mensagem que distingue gravação confirmada de atualização falha.","Recarregar após remover falha; conferir mesmo ID e respostas."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p);let fail=true;
  await p.route(url("state"),route=>{if(fail){fail=false;return route.fulfill({status:503,headers:cors,json:{error:"FALHA SINTÉTICA DE ATUALIZAÇÃO"}});}return route.fallback();});
  await saveButton(p).click();await p.locator(".inspection-feedback").filter({hasText:/O rascunho foi salvo\. A atualização da tela falhou/}).waitFor();await assertAnswers(p);
  assert.equal(f.executions.get(ids.visual).version,2);await p.reload();await ready(p,ids.visual,ids.visualExecution);await assertAnswers(p);assert.equal(f.state.lvt.length,1);
  return {savedVersion:2,executionId:f.executions.get(ids.visual).id,counts:counts(f)};
});

scenario("M02","Inspetor somente consulta não altera rascunho existente",mobile,[
  "Semear um rascunho sintético no estado do teste para profissional com writeAllowed=false.","Abrir a atividade; conferir controles de respostas/data/fotos e botões de salvar/envio bloqueados, sem atribuição.","Disparar tentativa de submit no formulário; conferir nenhuma requisição de gravação."
],async f=>{
  f.executions.set(ids.visual,{id:ids.visualExecution,inspectionId:ids.visual,assetId:ids.visualAsset,contractId:ids.contract,type:"visual",status:"rascunho",version:3,observedOn:"2026-10-29",answers:[{catalogItemId:"fixture-item-1",itemKey:"1.1",conditionId:"fixture-condition-1",recommendationId:null,notCovered:false,photoIds:[]}],items:[{catalogItemId:"fixture-item-1",itemKey:"1.1",lvtItemId:"d0000000-0000-4000-8000-000000000030"},{catalogItemId:"fixture-item-2",itemKey:"1.2",lvtItemId:"d0000000-0000-4000-8000-000000000031"}],readings:[]});
  const p=f.page;await navigate(p,"execucao",ids.visual);await ready(p,ids.visual,ids.visualExecution);
  assert.equal(await p.locator('[name="observedOn"]').isDisabled(),true);assert.equal(await first(p).locator('[name="conditionId"]').isDisabled(),true);assert.equal(await first(p).locator('input[type="file"]').isDisabled(),true);
  assert.equal(await saveButton(p).isDisabled(),true);assert.equal(await p.getByRole("button",{name:"Enviar para revisão",exact:true}).isDisabled(),true);assert.equal(await p.locator('form[data-operation="execution-assign"]').count(),0);
  await p.locator('form[data-operation="inspection-execution"]').dispatchEvent("submit");assert.equal(f.writes.length,0);
  const notice=await p.locator("#connectedWriteNotice").boundingBox(),toolbar=await p.locator(".client-toolbar").boundingBox();assert.ok(notice.y+notice.height<=toolbar.y+1);
  return {writes:0,fixtureRole:"inspector",writeAllowed:false,limit:"A permissão e a resposta HTTP são fixtures; RLS/RPC reais são verificados separadamente."};
},{role:"inspector"});

scenario("M03","Minhas inspeções e deep link não expõem atividade não atribuída",mobile,[
  "Alterar na fixture a atribuição da atividade visual para outro profissional.","Reabrir Minhas e conferir ausência da atividade visual.","Forçar deep link visual; conferir resposta 403, workspace oculto e nenhuma gravação."
],async f=>{
  const p=f.page;f.state.inspection.find(x=>x.id===ids.visual).assigneeProfessionalId=ids.otherProfessional;
  await navigate(p,"ativos",ids.system);await p.locator('[name="inspectionSearch"]').waitFor();await navigate(p,"minhas");await queueReady(p,ids.thickness);
  assert.equal(await p.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).count(),0);
  const denied=p.waitForResponse(response=>response.url()===url("execution/"+ids.visual));await navigate(p,"execucao",ids.visual);assert.equal((await denied).status(),403);await p.locator("#workspace[hidden]").waitFor({state:"attached"});
  assert.equal(await p.locator(`[data-execution-id]`).count(),0);assert.equal(f.writes.length,0);
  return {deniedStatus:403,writes:0,visibleExecutionNodes:0,limit:"A resposta 403 foi simulada; não se trata de ensaio autenticado em produção."};
},{role:"inspector"});

scenario("D07","Erro de atribuição não cria pessoa nem confirma responsável falso",desktop,[
  "Na lista de todas as TAGs, escolher outro profissional existente.","Simular 409 ao salvar atribuição.","Conferir feedback de erro e responsável persistido anterior; recarregar e conferir seleção original."
],async f=>{
  const p=f.page;await navigate(p,"ativos",ids.system);await queueReady(p);const before=counts(f),card=p.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`);
  await p.route(url("execution-assign"),route=>route.fulfill({status:409,headers:cors,json:{error:"ATRIBUIÇÃO NÃO CONFIRMADA NA FIXTURE",code:"version_conflict"}}));
  await card.locator('[name="professionalId"]').selectOption(ids.otherProfessional);await card.getByRole("button",{name:"Salvar atribuição",exact:true}).click();await card.getByText("ATRIBUIÇÃO NÃO CONFIRMADA NA FIXTURE",{exact:true}).waitFor();
  assert.equal(f.state.inspection.find(x=>x.id===ids.visual).assigneeProfessionalId,ids.professional);assert.deepEqual(counts(f),before);assert.equal(await card.locator("dd").filter({hasText:"INSPETOR FIXTURE EXISTENTE"}).count(),1);
  await p.reload();await queueReady(p);assert.equal(await card.locator('[name="professionalId"]').inputValue(),ids.professional);
  return {assignmentPersisted:ids.professional,counts:counts(f)};
});

scenario("M04","Sem catálogo real não há frases inventadas, respostas boas ou envio",mobile,[
  "Abrir atividade com catálogo unavailable e conferir aviso antes de iniciar.","Iniciar, conferir zero itens/seletores de condição e envio bloqueado.","Salvar rascunho vazio, voltar e continuar: mesmo ID, nenhum achado/RTI."
],async f=>{
  const p=f.page;await open(f,ids.visual,false);await p.locator(".inspection-catalog-pending").waitFor();await p.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();await ready(p,ids.visual,ids.visualExecution);
  assert.equal(await p.locator(".inspection-item").count(),0);assert.equal(await p.locator('[name="conditionId"]').count(),0);assert.equal(await p.getByRole("button",{name:"Enviar para revisão",exact:true}).isDisabled(),true);
  await saveOk(f);await p.getByRole("button",{name:"Minhas inspeções",exact:true}).click();await queueReady(p);await p.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Continuar inspeção",exact:true}).click();await ready(p,ids.visual,ids.visualExecution);
  assert.equal(f.executions.get(ids.visual).answers.length,0);assert.equal(f.state.rti.length,0);assert.equal(f.executions.size,1);
  return {catalog:"unavailable",items:0,answers:0,rtis:0,executionId:ids.visualExecution};
},{catalogUnavailable:true});

scenario("D08","Falha e retry de foto mantêm vínculo de item e uma RTI na fixture",desktop,[
  "Iniciar com duas respostas e recomendação no item1; primeiro upload sources/photo retorna503.","Conferir zero fotos/RTIs e arquivo ainda selecionado; repetir upload e salvar.","Recarregar, abrir fotografia original somente no item1 e salvar novamente; conferir uma RTI/contrato e os mesmos IDs."
],async f=>{
  const p=f.page;await open(f);await fillAnswers(p,{recommendation:true});let uploads=0;
  await p.route(API+"sources/photo",route=>{uploads++;if(uploads===1)return route.fulfill({status:503,headers:cors,json:{error:"UPLOAD SINTÉTICO NÃO CONFIRMADO",code:"fixture_unavailable"}});return route.fallback();});
  await first(p).locator('input[type="file"]').setInputFiles({name:"FOTO-VALIDACAO-SOMENTE-FIXTURE.png",mimeType:"image/png",buffer:pngFixture});await first(p).getByRole("button",{name:"Anexar fotos do item",exact:true}).click();await first(p).getByText("UPLOAD SINTÉTICO NÃO CONFIRMADO",{exact:true}).waitFor();
  assert.equal(f.state.photo.length,0);assert.equal(f.state.rti.length,0);assert.equal(await first(p).locator('input[type="file"]').evaluate(input=>input.files.length),1);
  await first(p).getByRole("button",{name:"Anexar fotos do item",exact:true}).click();await first(p).getByRole("status").filter({hasText:/Fotos vinculadas/}).waitFor();await saveOk(f);
  const rtiId=f.state.rti[0].id,photoId=f.state.photo[0].id;assert.equal(f.state.rti.length,1);assert.deepEqual(f.state.rti[0].photoIds,[photoId]);assert.equal(f.state.photo[0].lvtItemId,f.executions.get(ids.visual).items[0].lvtItemId);
  await p.reload();await ready(p,ids.visual,ids.visualExecution);assert.equal(await second(p).getByRole("button",{name:"Ver fotografia do item",exact:true}).count(),0);
  await first(p).getByRole("button",{name:"Ver fotografia do item",exact:true}).click();await first(p).locator("img.inspection-item-photo").waitFor({state:"visible"});await p.waitForFunction(()=>document.querySelector(".inspection-item-photo")?.naturalWidth===1);
  await saveOk(f);assert.equal(f.state.rti[0].id,rtiId);assert.equal(f.state.rti.length,1);assert.equal(f.state.photo.length,1);assert.equal(f.state.contract.length,1);
  return {uploads,photoId,rtiId,counts:counts(f),limit:"Criação e idempotência de RTI são comportamento da fixture HTTP; esta execução não valida a implementação SQL nem cria RTI real."};
});

scenario("M05","Recomendação incompatível ou sem foto não é salva",mobile,[
  "Conferir seletores vazios e recomendação bloqueada antes de escolher condição.","Escolher condição/recomendação e trocar para condição incompatível: recomendação deve ser retirada.","Voltar à condição compatível sem foto e tentar salvar: aviso local, nenhum POST save e nenhuma RTI."
],async f=>{
  const p=f.page;await open(f);assert.equal(await first(p).locator('[name="conditionId"]').inputValue(),"");assert.equal(await first(p).locator('[name="recommendationId"]').isDisabled(),true);assert.equal(await p.locator(".inspection-item textarea,.inspection-item input[type=text]").count(),0);
  await fillAnswers(p,{recommendation:true});await first(p).locator('[name="conditionId"]').selectOption("fixture-condition-1-alt");assert.equal(await first(p).locator('[name="recommendationId"]').inputValue(),"");assert.equal(await first(p).locator('option[value="fixture-recommendation-1"]').evaluate(option=>option.disabled),true);
  await first(p).locator('[name="conditionId"]').selectOption("fixture-condition-1");await first(p).locator('[name="recommendationId"]').selectOption("fixture-recommendation-1");await saveButton(p).click();await p.locator(".inspection-feedback").filter({hasText:/anexe ao menos uma fotografia/}).waitFor();
  assert.equal(f.writes.filter(x=>x.operation==="execution-save").length,0);assert.equal(f.state.rti.length,0);await assertAnswers(p);
  return {savePostCount:0,rtis:0,noFreeText:true};
});

scenario("M06","Atividade de espessura não se transforma em visual nem recebe pontos padrão",mobile,[
  "Abrir/Iniciar atividade espessura; conferir tipo e ausência de itens LVT/pontos/ângulos preenchidos.","Adicionar leitura com identificação sintética explícita, instrumento e data; salvar e recarregar.","Conferir mesmo registro, tipo espessura, leitura preservada e nenhuma LVT visual criada."
],async f=>{
  const p=f.page;await open(f,ids.thickness);assert.equal(await p.locator(".inspection-item").count(),0);assert.equal(await p.locator(".inspection-reading").count(),0);assert.equal(await p.locator('[name="instrument"]').inputValue(),"");
  await p.getByRole("button",{name:"Adicionar leitura identificada no desenho",exact:true}).click();const row=p.locator(".inspection-reading");assert.equal(await row.locator('[name="point"]').inputValue(),"");assert.equal(await row.locator('[name="unit"]').inputValue(),"");
  await row.locator('[name="point"]').fill("PONTO-SOMENTE-FIXTURE");await row.locator('[name="value"]').fill("3.20");await row.locator('[name="unit"]').selectOption("mm");await p.locator('[name="instrument"]').fill("INSTRUMENTO-SOMENTE-FIXTURE");await p.locator('[name="observedOn"]').fill("2026-10-29");
  const refreshed=p.waitForResponse(response=>response.url()===url("execution/"+ids.thickness));await saveButton(p).click();await refreshed;await ready(p,ids.thickness,ids.thicknessExecution);await p.reload();await ready(p,ids.thickness,ids.thicknessExecution);
  assert.equal(await p.locator('[name="point"]').inputValue(),"PONTO-SOMENTE-FIXTURE");assert.equal(f.executions.get(ids.thickness).type,"espessura");assert.equal(f.state.inspection.find(x=>x.id===ids.thickness).type,"espessura");assert.equal(f.state.lvt.length,0);
  return {executionId:ids.thicknessExecution,type:"espessura",visualLvts:0,readings:f.executions.get(ids.thickness).readings};
});

scenario("D09","Cliques percorrem cliente, módulo, projeto, sistema, TAG e execução",desktop,[
  "Autenticação e dados são fixtures; habilitar projectDashboardVersion1 no estado sintético e reler pelo botão Atualizar.",
  "Clicar Clientes no breadcrumb, selecionar cliente, clicar Abrir Inspeção de Integridade e Abrir painel do contrato.",
  "Clicar Abrir sistema, Iniciar inspeção da TAG visual e Iniciar na ficha; conferir contrato/TAG/tipo e mesmo registro gerado."
],async f=>{
  const p=f.page;f.state.projectDashboardVersion=1;
  const refreshed=p.waitForResponse(response=>response.url()===url("state"));await p.locator("#refresh").click();await refreshed;await queueReady(p);
  await p.locator("#flowBreadcrumb").getByRole("button",{name:"Clientes",exact:true}).click();
  await p.locator(".client-card").filter({hasText:"CLIENTE FIXTURE DE INSPEÇÃO"}).click();
  await p.getByRole("button",{name:"Abrir Inspeção de Integridade",exact:true}).click();
  const project=p.locator(".project-card").filter({hasText:"CONTRATO FIXTURE"});await project.getByRole("button",{name:"Abrir painel →",exact:true}).click();
  await p.locator(".project-heading h1").filter({hasText:"CONTRATO FIXTURE"}).waitFor();assert.match(p.url(),new RegExp("contrato="+ids.contract));
  await p.locator(".project-system").filter({hasText:"SISTEMA FIXTURE"}).getByRole("button",{name:"Abrir sistema →",exact:true}).click();
  await queueReady(p);await p.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Iniciar inspeção",exact:true}).click();await ready(p);
  await p.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();await ready(p,ids.visual,ids.visualExecution);
  assert.match(p.url(),new RegExp("contrato="+ids.contract));assert.match(await p.locator(".inspection-workspace h1").innerText(),/VISUAL-FIXTURE/);assert.equal(f.executions.get(ids.visual).type,"visual");assert.equal(f.executions.get(ids.visual).contractId,ids.contract);assert.equal(f.executions.get(ids.visual).assetId,ids.visualAsset);
  return {clickPath:["Clientes","CLIENTE FIXTURE DE INSPEÇÃO","Abrir Inspeção de Integridade","CONTRATO FIXTURE / Abrir painel","SISTEMA FIXTURE / Abrir sistema","VISUAL-FIXTURE / Iniciar inspeção","Iniciar inspeção"],executionId:ids.visualExecution,contractId:ids.contract,assetId:ids.visualAsset,limit:"Bootstrap inicial de autenticação continua simulado por SDK/deep link. Após clicar Clientes, os passos da hierarquia são cliques reais na UI local; o projeto e seus dados são fixtures sintéticas."};
});

async function main(){
  fs.mkdirSync(output,{recursive:true});
  const baselineSource=process.env.PIRES_BROWSER_BASELINE_DIRECTORY?path.resolve(root,process.env.PIRES_BROWSER_BASELINE_DIRECTORY):path.join(root,"output/inspection-review"),baselineTarget=path.join(output,"baseline");
  if(fs.existsSync(path.join(baselineSource,"browser-results.json"))){fs.mkdirSync(baselineTarget,{recursive:true});for(const name of fs.readdirSync(baselineSource))if(name.endsWith(".png")||name==="browser-results.json")fs.copyFileSync(path.join(baselineSource,name),path.join(baselineTarget,name));}
  const originalBrowser=path.join(__dirname,"gestao-inspection-browser.cjs"),originalHash=crypto.createHash("sha256").update(fs.readFileSync(originalBrowser)).digest("hex");
  const caseArg=process.argv.slice(2).find(arg=>arg.startsWith("--case=")),selected=caseArg?scenarios.filter(test=>caseArg.slice(7).split(",").includes(test.id)):scenarios;
  if(!selected.length)throw Error("Nenhum cenário corresponde ao filtro --case.");
  const priorFile=path.join(output,"extended-browser-results.json"),prior=caseArg&&fs.existsSync(priorFile)?JSON.parse(fs.readFileSync(priorFile,"utf8")).results:[];
  const {server,base}=await staticServer(),results=prior.filter(result=>!selected.some(test=>test.id===result.id));let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.PIRES_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
    for(const test of selected){
      let f;const result={id:test.id,title:test.title,viewport:test.viewport,reproduction:test.steps,evidenceType:"local_browser_with_synthetic_http_fixture",productionTested:false};
      const started=Date.now();
      try{
        f=await fixturePage(browser,base,{...test.options,viewport:test.viewport});
        result.observed=await test.run(f);
        await noOverflow(f.page,test.id);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
        assert.equal(f.writes.some(write=>/person|account|credential|project-create/.test(write.operation)),false);
        result.status="PASS";result.pageErrors=f.errors;result.unexpectedRequests=f.unexpected;
      }catch(error){result.status="FAIL";result.error=error.message;result.stack=error.stack;process.exitCode=1;}
      finally{
        result.durationMs=Date.now()-started;
        if(f){
          const screenshot=test.id+"-"+test.viewport.width+".png";await f.page.screenshot({path:path.join(output,screenshot),fullPage:true}).catch(()=>{});result.screenshot=screenshot;
          result.fixtureRequests=f.calls;result.fixtureWrites=f.writes.map(write=>({operation:write.operation,inspectionId:write.body?.inspectionId,requestId:write.body?.requestId,expectedVersion:write.body?.expectedVersion}));
          if(result.status==="FAIL")result.dom=await f.page.evaluate(()=>({url:location.href,body:document.body.innerText.slice(-16000)})).catch(()=>null);
          await f.context.close();
        }
        results.push(result);results.sort((a,b)=>scenarios.findIndex(test=>test.id===a.id)-scenarios.findIndex(test=>test.id===b.id));fs.writeFileSync(path.join(output,"extended-browser-results.json"),JSON.stringify({baseCommit:"38fe04faf986d1038c86ec1d672085b5ee5515ea",workingTreeUnderTest:true,fixtureOnly:true,productionTested:false,results},null,2)+"\n");
        console.log(test.id+" "+result.status+" "+test.title);
      }
    }
    const baseline=fs.existsSync(path.join(baselineTarget,"browser-results.json"))?JSON.parse(fs.readFileSync(path.join(baselineTarget,"browser-results.json"),"utf8")):null;
    const currentHash=crypto.createHash("sha256").update(fs.readFileSync(originalBrowser)).digest("hex");assert.equal(currentHash,originalHash);
    const summary={baseCommit:"38fe04faf986d1038c86ec1d672085b5ee5515ea",workingTreeUnderTest:true,baseline:{passed:baseline?.checks?.filter(x=>x.passed).length||0,path:"baseline/browser-results.json"},extended:{passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,total:results.length},originalBrowserUnchanged:true,originalBrowserSha256:originalHash,productFilesEdited:false,uploadsOrReservations:0,productionTested:false,limits:["Contas, catálogos, fotos e respostas HTTP são fixtures sintéticas do processo de teste.","Recarregar consulta o estado da fixture HTTP; isso não comprova persistência do banco nem comportamento em produção.","Autorizações e recibos de idempotência HTTP são simulados; a validação real de SQL/RPC ocorre em suíte local separada.","Nenhum documento técnico foi emitido ou enviado a cliente."]};
    fs.writeFileSync(path.join(output,"browser-validation-summary.json"),JSON.stringify(summary,null,2)+"\n");
    const report=["VALIDAÇÃO DE NAVEGADOR — "+validationDate,`Base commit: ${summary.baseCommit}; working tree under test`,`Baseline: ${summary.baseline.passed} PASS. Novos cenários: ${summary.extended.passed} PASS / ${summary.extended.failed} FAIL.`,"",...results.flatMap(result=>[`${result.id} ${result.status} — ${result.title}`,"Reprodução: "+result.reproduction.join(" "),"Evidência: "+result.screenshot,...(result.error?["Falha: "+result.error]:[]),""]),"LIMITES",...summary.limits];
    fs.writeFileSync(path.join(output,"BROWSER-VALIDATION.txt"),report.join("\n")+"\n");
    console.log(JSON.stringify(summary));
  }finally{await browser?.close();server.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
