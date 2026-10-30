"use strict";
// Regression evidence for 30/10. Browser runs the real UI/PDF generator with
// synthetic SDK/HTTP fixtures; SQL permissions and persistence are not mocked
// into evidence of real backend behavior. No product or production writes.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {createRequire}=require("node:module"),{chromium}=require("playwright");
const {ids,staticServer,fixturePage,noOverflow}=require("./gestao-inspection-browser.cjs");
const root=path.resolve(__dirname,".."),output=path.join(root,"output/inspection-fixes-20261030/browser"),API="https://fixtureproject.supabase.co/functions/v1/gestao-api/",prefix=`companies/${ids.owner}/`;
const uuid=n=>"e0000000-0000-4000-8000-"+String(n).padStart(12,"0"),extra={contract2:uuid(1),system2:uuid(2),unit2:uuid(3),asset2:uuid(4),assetOtherSystem:uuid(5),inspection2:uuid(6),inspectionOtherSystem:uuid(7),campaign2:uuid(8),task:uuid(9),document:uuid(10),plan:uuid(11),scope:uuid(12),event:uuid(13)};
const copy=value=>JSON.parse(JSON.stringify(value)),endpoint=route=>API+prefix+route;
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-pires-tenant"};
const ready=(p,id=ids.visual,execution)=>p.locator(`.inspection-workspace[data-inspection-id="${id}"]${execution?`[data-execution-id="${execution}"]`:""}`).waitFor();
const card=(p,id)=>p.locator(`.inspection-card[data-inspection-id="${id}"]`);
async function baseline(){
  const original=path.join(__dirname,"gestao-inspection-browser.cjs"),source=fs.readFileSync(original,"utf8"),before=crypto.createHash("sha256").update(source).digest("hex");
  const expected='const output = path.resolve(__dirname,"../output/inspection-review");',replacement='const output = path.resolve(__dirname,"../output/inspection-fixes-20261030/browser/baseline");';
  assert.ok(source.includes(expected),"Original baseline output declaration changed; review before adapting output.");
  // Only the output path is substituted in memory. Original source is never edited.
  const run=new Function("require","module","__filename","__dirname",source.replace(expected,replacement)+"\nreturn main();");
  await run(createRequire(original),{exports:{}},original,__dirname);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(original)).digest("hex"),before);
  fs.writeFileSync(path.join(output,"baseline-source-check.json"),JSON.stringify({originalSourceUnchanged:true,sha256:before,adaptation:"output directory only, in memory",productFilesEdited:false},null,2)+"\n");
}
function seed(f){
  const s=f.state,contract=s.contract[0];contract.name="CONTRATO C1 FIXTURE";contract.assetIds.push(extra.assetOtherSystem);
  s.contract.push({id:extra.contract2,name:"CONTRATO C2 FIXTURE",modules:["integridade","rtis"],assetIds:[ids.visualAsset,extra.asset2],source:"Fixture C2 isolada"});
  s.unit.push({id:extra.unit2,name:"OUTRA UNIDADE FIXTURE"});s.system[0].name="SISTEMA DE MESMO NOME FIXTURE";s.system.push({id:extra.system2,unitId:extra.unit2,name:s.system[0].name});
  s.asset.push({...copy(s.asset[0]),id:extra.asset2,tag:"EXCLUSIVA-C2-FIXTURE"},{...copy(s.asset[0]),id:extra.assetOtherSystem,tag:"OUTRO-SISTEMA-C1-FIXTURE",systemId:extra.system2,unitId:extra.unit2});
  s.campaign[0].systemId=ids.system;s.campaign.push({...copy(s.campaign[0]),id:extra.campaign2,contractId:extra.contract2,name:"CAMPANHA C2 FIXTURE",assetIds:[ids.visualAsset,extra.asset2]});
  s.inspection.push({...copy(s.inspection[0]),id:extra.inspection2,contractId:extra.contract2,campaignId:extra.campaign2},{...copy(s.inspection[0]),id:extra.inspectionOtherSystem,assetId:extra.assetOtherSystem});
}
async function refresh(f){const response=f.page.waitForResponse(r=>r.url()===endpoint("state"));await f.page.locator("#refresh").click();await response;}
async function route(f,view,item="_",contract=ids.contract){
  await f.page.evaluate(hash=>{location.hash=hash;},`#gestao/${ids.owner}/integridade/${view}/${item}${contract?"?contrato="+contract:""}`);
  await f.page.waitForFunction(view=>document.getElementById("flowView")?.dataset.view===view,view);
}
function reportSnapshot(f,contractId,systemId,campaignId){
  const s=f.state,contract=s.contract.find(x=>x.id===contractId),campaign=campaignId?s.campaign.find(x=>x.id===campaignId):null;
  const assets=s.asset.filter(x=>x.systemId===systemId&&contract.assetIds.includes(x.id)),assetIds=new Set(assets.map(x=>x.id));
  return {generatedAt:"2026-10-30T12:00:00Z",draft:true,canIssue:false,company:copy(s.company),system:copy(s.system.find(x=>x.id===systemId)),contract:copy(contract),...(campaign?{campaign:copy(campaign)}:{}),assets:copy(assets),inspections:copy(s.inspection.filter(x=>x.contractId===contractId&&assetIds.has(x.assetId)&&(!campaign||x.campaignId===campaign.id))),lvts:[],lvtItems:[],photos:[],findings:[],rtis:[]};
}
async function pdfCapture(f){
  await f.page.evaluate(()=>{
    const real=window.PiresGestaoReportPDF,Ctor=window.PiresPDF?.jsPDF||window.jspdf?.jsPDF||window.jsPDF;window.__pdfCalls=[];window.__pdfSaves=[];
    window.PiresGestaoReportPDF={...real,createPdf(snapshot,images){const rendered=[];function RecordingPDF(options){const doc=new Ctor(options),text=doc.text;doc.text=function(...args){rendered.push(Array.isArray(args[0])?args[0].join("\n"):String(args[0]));return text.apply(this,args);};return doc;}const result=real.createPdf(snapshot,images,{},RecordingPDF);window.__pdfCalls.push({snapshot,renderedText:rendered.join("\n"),metadata:result.metadata});result.doc.save=filename=>window.__pdfSaves.push(filename);return result;}};
  });
}
async function scopedReports(f,{tamperContract=false,hold=false}={}){
  const requests=[],released={};let release;released.promise=new Promise(resolve=>{release=resolve;});released.release=release;
  await f.page.route(API+prefix+"reports/**",async request=>{
    const resource=request.request().url().slice((API+prefix).length);requests.push(resource);
    const match=/^reports\/contracts\/([a-f0-9-]{36})\/(system|campaign)\/([a-f0-9-]{36})$/i.exec(resource);
    if(!match)return request.fulfill({status:400,headers:cors,json:{error:"Regression fixture refuses unscoped report route"}});
    const[,contractId,kind,id]=match,campaign=kind==="campaign"?f.state.campaign.find(x=>x.id===id):null,systemId=campaign?.systemId||id;
    const snapshot=reportSnapshot(f,tamperContract?extra.contract2:contractId,systemId,campaign?.id);
    if(hold)await released.promise;
    return request.fulfill({status:200,headers:cors,json:snapshot});
  });
  return {requests,release:released.release};
}
async function generate(f,systemId,campaign=false){
  const section=f.page.locator(`[data-system-id="${systemId}"]`),label=campaign?"Gerar rascunho desta campanha no projeto":"Gerar rascunho deste sistema no projeto";
  const before=await f.page.evaluate(()=>window.__pdfSaves.length);await section.getByRole("button",{name:label,exact:true}).click();
  await f.page.waitForFunction(before=>window.__pdfSaves.length===before+1,before);
  return f.page.evaluate(()=>{const call=window.__pdfCalls.at(-1);return {contractId:call.snapshot.contract?.id,contractName:call.snapshot.contract?.name,systemId:call.snapshot.system.id,campaignId:call.snapshot.campaign?.id,assets:call.snapshot.assets.map(x=>x.id),inspections:call.snapshot.inspections.map(x=>x.id),contractInPdf:call.renderedText.includes(call.snapshot.contract.name)&&call.renderedText.includes(call.snapshot.contract.id),canIssue:call.metadata.canIssue,draft:call.metadata.draft};});
}
const scenarios=[];function test(id,title,viewport,steps,run){scenarios.push({id,title,viewport,steps,run});}
const desktop={width:1440,height:1000},mobile={width:390,height:844};

test("R01","Relatórios C1 sistema/campanha usam somente rota escopada e preservam contrato no PDF",desktop,["Com C1/C2 compartilhando TAG e sistema, abrir relatórios de C1.","Gerar rascunho de sistema e campanha; capturar o helper real com save mock.","Conferir rota contracts/C1, IDs C1 e nome/ID C1 no PDF em memória."],async f=>{
  await route(f,"relatorios");const h=await scopedReports(f);await pdfCapture(f);await f.page.locator(`[data-system-id="${ids.system}"]`).waitFor();
  const system=await generate(f,ids.system),campaign=await generate(f,ids.system,true);
  for(const value of[system,campaign]){assert.equal(value.contractId,ids.contract);assert.equal(value.contractInPdf,true);assert.equal(value.assets.includes(extra.asset2),false);assert.equal(value.inspections.includes(extra.inspection2),false);assert.equal(value.canIssue,false);assert.equal(value.draft,true);}
  assert.equal(campaign.campaignId,ids.campaign);assert.ok(h.requests.every(x=>x.startsWith(`reports/contracts/${ids.contract}/`)));
  return {requests:h.requests,system,campaign,pdfSaveMock:true};
});
test("R02","Trocar C1 por C2 no mesmo sistema não reutiliza inspeções do outro contrato",desktop,["Abrir relatórios e selecionar C2 pelo controle de escopo.","Gerar rascunho do mesmo sistema; conferir contrato C2 no PDF e só inspeções C2."],async f=>{
  await route(f,"relatorios");const h=await scopedReports(f);await pdfCapture(f);
  await f.page.getByLabel("Contrato ou escopo da inspeção").selectOption(extra.contract2);await f.page.locator(`[data-system-id="${ids.system}"]`).waitFor();
  const result=await generate(f,ids.system);assert.equal(result.contractId,extra.contract2);assert.equal(result.contractInPdf,true);assert.deepEqual(result.inspections,[extra.inspection2]);assert.equal(result.assets.includes(ids.thicknessAsset),false);assert.ok(h.requests.every(x=>x.startsWith(`reports/contracts/${extra.contract2}/`)));
  return {requests:h.requests,result,limit:"O filtro do snapshot é fixture HTTP. O teste comprova rota/contrato recebido pelo gerador e navegação, não a consulta SQL."};
});
test("R03","Sistemas de mesmo nome continuam distintos por ID",mobile,["Em C1, abrir relatório com dois sistemas homônimos de unidades diferentes.","Gerar rascunho do segundo sistema e conferir ID correspondente.","Abrir suas TAGs e conferir somente a atividade do segundo sistema."],async f=>{
  await route(f,"relatorios");const h=await scopedReports(f);await pdfCapture(f);assert.equal(await f.page.locator(".system-card").count(),2);
  const result=await generate(f,extra.system2);assert.equal(result.systemId,extra.system2);assert.deepEqual(result.assets,[extra.assetOtherSystem]);
  await f.page.locator(`[data-system-id="${extra.system2}"]`).getByRole("button",{name:"Abrir TAGs deste sistema",exact:true}).click();await card(f.page,extra.inspectionOtherSystem).waitFor();assert.equal(await card(f.page,ids.visual).count(),0);assert.equal(await card(f.page,ids.thickness).count(),0);
  return {requests:h.requests,result,visibleInspectionId:extra.inspectionOtherSystem};
});
test("R04","Snapshot de contrato divergente é recusado antes de gerar PDF",desktop,["Solicitar C1 e fazer a fixture retornar contract.id=C2.","Conferir erro de escopo e nenhum save/chamada ao gerador."],async f=>{
  await route(f,"relatorios");const h=await scopedReports(f,{tamperContract:true});await pdfCapture(f);
  await f.page.locator(`[data-system-id="${ids.system}"]`).getByRole("button",{name:"Gerar rascunho deste sistema no projeto",exact:true}).click();await f.page.locator("#message").filter({hasText:/Não foi possível confirmar o escopo/}).waitFor();assert.equal(await f.page.evaluate(()=>window.__pdfCalls.length),0);assert.equal(await f.page.evaluate(()=>window.__pdfSaves.length),0);
  return {requests:h.requests,pdfCalls:0,pdfSaves:0};
});
test("R05","Resposta tardia de C1 não gera PDF após navegar para C2",desktop,["Segurar resposta escopada de C1.","Trocar escopo para C2 antes da resposta; liberar C1.","Conferir zero PDFs gerados ou salvos fora do contexto original."],async f=>{
  await route(f,"relatorios");const h=await scopedReports(f,{hold:true});await pdfCapture(f);
  await f.page.locator(`[data-system-id="${ids.system}"]`).getByRole("button",{name:"Gerar rascunho deste sistema no projeto",exact:true}).click();
  await f.page.getByLabel("Contrato ou escopo da inspeção").selectOption(extra.contract2);await f.page.waitForFunction(id=>location.hash.includes("contrato="+id),extra.contract2);h.release();
  await f.page.waitForResponse(response=>response.url().includes(`/reports/contracts/${ids.contract}/system/`));await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await f.page.evaluate(()=>window.__pdfCalls.length),0);assert.equal(await f.page.evaluate(()=>window.__pdfSaves.length),0);
  return {requests:h.requests,pdfCalls:0,pdfSaves:0};
});
test("R06","Remover escopo oculta e nega a ficha; reincluir retoma mesmo rascunho",mobile,["Iniciar e salvar respostas na atividade C1.","Remover TAG de C1 na fixture; exigir fila limpa e deep link403, com rascunho preservado no armazenamento sintético.","Reincluir TAG e reabrir: mesmos ID/respostas; salvar sem duplicar."],async f=>{
  await route(f,"ativos",ids.system);await card(f.page,ids.visual).waitFor();await card(f.page,ids.visual).getByRole("button",{name:"Iniciar inspeção",exact:true}).click();await ready(f.page);await f.page.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();await ready(f.page,ids.visual,ids.visualExecution);
  await f.page.locator('[name="observedOn"]').fill("2026-10-30");await f.page.locator('[data-catalog-item-id="fixture-item-1"] [name="conditionId"]').selectOption("fixture-condition-1");await f.page.locator('[data-catalog-item-id="fixture-item-2"] [name="conditionId"]').selectOption("fixture-condition-2");
  let refreshed=f.page.waitForResponse(response=>response.url()===endpoint("execution/"+ids.visual));await f.page.getByRole("button",{name:"Salvar rascunho",exact:true}).click();await refreshed;await ready(f.page,ids.visual,ids.visualExecution);
  const original=copy(f.executions.get(ids.visual)),c=f.state.contract.find(x=>x.id===ids.contract);await route(f,"ativos",ids.system);await card(f.page,ids.visual).waitFor();c.assetIds=c.assetIds.filter(x=>x!==ids.visualAsset);
  await f.page.route(endpoint("execution/"+ids.visual),request=>c.assetIds.includes(ids.visualAsset)?request.fallback():request.fulfill({status:403,headers:cors,json:{error:"Atividade fora do escopo atual (fixture)",code:"access_denied"}}));
  await refresh(f);await route(f,"ativos",ids.system);await card(f.page,ids.thickness).waitFor();assert.equal(await card(f.page,ids.visual).count(),0);
  const denied=f.page.waitForResponse(response=>response.url()===endpoint("execution/"+ids.visual));await route(f,"execucao",ids.visual);assert.equal((await denied).status(),403);await f.page.locator("#workspace[hidden]").waitFor({state:"attached"});assert.deepEqual(f.executions.get(ids.visual),original);
  c.assetIds.push(ids.visualAsset);await f.page.evaluate(()=>{window.__scopeRestoreDocumentMarker=true;});const callsBefore=f.calls.length;
  await f.page.goto(f.base+`/gestao.html#gestao/${ids.owner}/integridade/execucao/${ids.visual}?contrato=${ids.contract}`);
  const sameUrlNavigation={documentMarkerPreserved:await f.page.evaluate(()=>window.__scopeRestoreDocumentMarker===true),workspaceStillHidden:await f.page.locator("#workspace").isHidden(),newApiRequests:f.calls.slice(callsBefore)};
  await f.page.reload();await ready(f.page,ids.visual,ids.visualExecution);assert.equal(await f.page.locator('[data-catalog-item-id="fixture-item-1"] [name="conditionId"]').inputValue(),"fixture-condition-1");
  refreshed=f.page.waitForResponse(response=>response.url()===endpoint("execution/"+ids.visual));await f.page.getByRole("button",{name:"Salvar rascunho",exact:true}).click();await refreshed;await ready(f.page,ids.visual,ids.visualExecution);assert.equal(f.executions.size,1);assert.equal(f.state.lvt.length,1);
  return {deniedStatus:403,executionId:ids.visualExecution,retainedAnswers:original.answers,executions:1,lvts:1,sameUrlNavigation,restoredByFullReload:true,limit:"Negativa403 e armazenamento são fixtures. Preservação/autorização SQL são validadas em suíte separada, sem exceção de execução fora de escopo."};
});
test("R07","Evento administrativo done não conta emissão técnica nem simula aprovação",desktop,["Semear planejamento issuance e um evento administrativo done com evidência de fixture, sem LVT/revisão/assinatura.","Abrir painel C1: KPI deve mostrar —, ciclo Emissão técnica Indisponível e manter um evento administrativo.","Conferir aviso no formulário de planejamento e preservação do evento."],async f=>{
  const s=f.state;s.projectDashboardVersion=1;s.contract[0].scopeVersion=1;s.projectScope=[{id:extra.scope,contractId:ids.contract,module:"integridade",scopeVersion:1,assetIds:copy(s.contract[0].assetIds),createdAt:"2026-10-28T12:00:00Z"}];
  s.projectPlan=[{id:extra.plan,contractId:ids.contract,module:"integridade",scopeVersion:1,planVersion:1,createdAt:"2026-10-28T12:00:00Z",tasks:[{id:extra.task,name:"MARCO ADMINISTRATIVO SOMENTE FIXTURE",targetKind:"asset",targetId:ids.visualAsset,stage:"issuance",modality:"visual",plannedDate:"2026-10-29",weight:1}]}];
  s.projectEvent=[{id:extra.event,contractId:ids.contract,module:"integridade",taskId:extra.task,stage:"issuance",status:"done",on:"2026-10-29",responsible:"GESTOR SOMENTE FIXTURE",evidenceDocumentId:extra.document,evidence:"Evento administrativo sintético, sem ato técnico",createdAt:"2026-10-29T12:00:00Z"}];s.document.push({id:extra.document,contractId:ids.contract,module:"integridade",assetId:ids.visualAsset,reference:"EVIDÊNCIA ADMINISTRATIVA SOMENTE FIXTURE",source:{sourceId:"a".repeat(64)}});
  await refresh(f);await route(f,"painel");const metric=f.page.locator(".project-metric").filter({hasText:"Relatórios tecnicamente emitidos"});await metric.waitFor();assert.equal(await metric.locator("strong").innerText(),"—");assert.match(await metric.innerText(),/Emissão técnica indisponível/);
  const stage=f.page.locator(".project-stage").filter({hasText:"Emissão técnica"});assert.equal(await stage.locator("strong").innerText(),"Indisponível");assert.match(await stage.innerText(),/Tarefas concluídas administrativamente:\s*1/);
  const model=await f.page.evaluate(({state,contract})=>{const result=window.PiresProjectModel.build(state,contract,"integridade");return {kpi:result.kpis.find(x=>x.key==="issuance"),stage:result.lifecycle.find(x=>x.stage==="issuance")};},{state:copy(s),contract:ids.contract});assert.equal(model.kpi.value,null);assert.equal(model.kpi.technicalAvailable,false);assert.equal(model.kpi.administrativeCompleted,1);assert.equal(model.stage.done,null);assert.equal(model.stage.administrativeDone,1);
  await f.page.screenshot({path:path.join(output,"R07-kpi-panel-desktop.png"),fullPage:true});
  await route(f,"planejamento");await f.page.getByText("Os eventos abaixo registram progresso administrativo do planejamento. Não aprovam, assinam ou emitem relatórios técnicos.",{exact:true}).waitFor();assert.equal(s.projectEvent.length,1);assert.equal(s.projectEvent[0].status,"done");
  return {model,eventRetained:true,eventStatus:"done",technicalDocumentsIssued:0};
});

async function main(){
  fs.mkdirSync(output,{recursive:true});if(process.argv.includes("--baseline"))return baseline();
  const filter=process.argv.find(x=>x.startsWith("--case=")),selected=filter?scenarios.filter(x=>filter.slice(7).split(",").includes(x.id)):scenarios;if(!selected.length)throw Error("No matching regression scenario");
  const file=path.join(output,"contract-browser-results.json"),prior=filter&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")).results:[],results=prior.filter(x=>!selected.some(s=>s.id===x.id));const{server,base}=await staticServer();let browser;
  try{browser=await chromium.launch({executablePath:process.env.PIRES_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
    for(const item of selected){let f;const result={id:item.id,title:item.title,viewport:item.viewport,reproduction:item.steps,evidenceType:"local UI with synthetic HTTP; real PDF generator with save mock",productionTested:false};
      try{f=await fixturePage(browser,base,{viewport:item.viewport});f.base=base;seed(f);await refresh(f);result.observed=await item.run(f);await noOverflow(f.page,item.id);assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);result.status="PASS";}
      catch(error){result.status="FAIL";result.error=error.message;result.stack=error.stack;process.exitCode=1;}
      finally{if(f){result.screenshot=item.id+"-"+item.viewport.width+".png";await f.page.screenshot({path:path.join(output,result.screenshot),fullPage:true}).catch(()=>{});result.pageErrors=f.errors;result.unexpectedRequests=f.unexpected;if(result.status==="FAIL")result.dom=await f.page.evaluate(()=>({url:location.href,text:document.body.innerText.slice(-18000)})).catch(()=>null);await f.context.close();}results.push(result);results.sort((a,b)=>scenarios.findIndex(x=>x.id===a.id)-scenarios.findIndex(x=>x.id===b.id));fs.writeFileSync(file,JSON.stringify({baseCommit:"38fe04faf986d1038c86ec1d672085b5ee5515ea",workingTreeUnderTest:true,fixtureOnly:true,productionTested:false,results},null,2)+"\n");console.log(item.id+" "+result.status+" "+item.title);}
    }
    const summary={baseCommit:"38fe04faf986d1038c86ec1d672085b5ee5515ea",workingTreeUnderTest:true,passed:results.filter(x=>x.status==="PASS").length,failed:results.filter(x=>x.status==="FAIL").length,total:results.length,fixtureOnly:true,productionTested:false,pdfSaveMock:true,uploadsOrReservations:0,productFilesEditedByThisTest:false,limits:["O navegador usa SDK e API simulados. Filtros SQL, RLS, armazenamento e recibos reais exigem testes separados.","O gerador real de PDF recebe snapshots sintéticos; doc.save é mockado, sem download, assinatura, emissão ou entrega.","O caso de escopo removido exige negativa enquanto fora do escopo; só após reincluir retoma o rascunho."]};fs.writeFileSync(path.join(output,"contract-browser-summary.json"),JSON.stringify(summary,null,2)+"\n");console.log(JSON.stringify(summary));
  }finally{await browser?.close();server.close();}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
