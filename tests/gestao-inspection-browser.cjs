"use strict";
// Browser contract regression using synthetic accounts and HTTP data in this
// test process only. No application API server, production data or database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const { chromium } = require("playwright");

const id = n => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = { tenant:id(1), user:id(2), owner:id(3), unit:id(4), system:id(5),
  visualAsset:id(6), thicknessAsset:id(7), contract:id(8), campaign:id(9),
  visual:id(10), thickness:id(11), professional:id(12), otherProfessional:id(13),
  visualExecution:id(14), thicknessExecution:id(15) };
const API = "https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const config = { mode:"connected", gestao:{backend:"supabase"},
  supabaseUrl:"https://fixtureproject.supabase.co",
  publishableKey:"sb_" + "publishable_" + "inspection_fixture_not_real",
  appUrl:"https://app.fixture.invalid", privacyEmail:"privacy@fixture.invalid" };
const output = path.resolve(__dirname,"../output/inspection-review");
const clone = value => JSON.parse(JSON.stringify(value));
const catalogSource = { sourceId:"c".repeat(64),fileHash:"c".repeat(64),
  fileName:"SOMENTE-FIXTURE-SINTETICA.json",locator:{section:"Fixture isolada, sem valor técnico"} };
const verifiedCatalog = {id:id(21),status:"verified",source:catalogSource,items:[
  {id:"fixture-item-1",itemKey:"1.1",component:"COMPONENTE SOMENTE FIXTURE",
    conditions:[{id:"fixture-condition-1",text:"CONDIÇÃO SOMENTE FIXTURE",source:catalogSource},
      {id:"fixture-condition-1-alt",text:"CONDIÇÃO ALTERNATIVA SOMENTE FIXTURE",source:catalogSource}],
    recommendations:[{id:"fixture-recommendation-1",text:"RECOMENDAÇÃO SOMENTE FIXTURE",source:catalogSource,conditionIds:["fixture-condition-1"]}]},
  {id:"fixture-item-2",itemKey:"1.2",component:"OUTRO COMPONENTE SOMENTE FIXTURE",
    conditions:[{id:"fixture-condition-2",text:"OUTRA CONDIÇÃO SOMENTE FIXTURE",source:catalogSource}],
    recommendations:[]}
]};
function makePngFixture() {
  const chunk=(type,bytes)=>{
    const content=Buffer.concat([Buffer.from(type),bytes]),result=Buffer.alloc(bytes.length+12);
    result.writeUInt32BE(bytes.length);content.copy(result,4);
    let crc=0xffffffff;
    for(const byte of content){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    result.writeUInt32BE((crc^0xffffffff)>>>0,bytes.length+8);return result;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),
    chunk("IDAT",deflateSync(Buffer.from([0,255,0,0,255]))),chunk("IEND",Buffer.alloc(0))]);
}
const pngFixture=makePngFixture();

function initialState() {
  const asset = (assetId,tag) => ({id:assetId,tag,type:"linha",unitId:ids.unit,
    systemId:ids.system,operation:"nao_informado",technicalCondition:"nao_avaliado",
    technical:{},source:{fixture:true},version:1});
  const inspection = (inspectionId,assetId,type) => ({id:inspectionId,assetId,
    contractId:ids.contract,campaignId:ids.campaign,module:"integridade",type,
    planned:"2026-10-30",status:"planejada",source:"Planejamento sintético isolado",
    assigneeProfessionalId:ids.professional,assigneeName:"INSPETOR FIXTURE EXISTENTE",version:1});
  return { company:{id:ids.owner,name:"CLIENTE FIXTURE DE INSPEÇÃO",source:"Fixture isolada"},
    unit:[{id:ids.unit,name:"UNIDADE FIXTURE"}],
    system:[{id:ids.system,unitId:ids.unit,name:"SISTEMA FIXTURE"}],
    asset:[asset(ids.visualAsset,"VISUAL-FIXTURE"),asset(ids.thicknessAsset,"ESPESSURA-FIXTURE")],
    contract:[{id:ids.contract,name:"CONTRATO FIXTURE",modules:["integridade","rtis"],
      assetIds:[ids.visualAsset,ids.thicknessAsset],source:"Contrato sintético isolado"}],
    campaign:[{id:ids.campaign,name:"CAMPANHA FIXTURE",contractId:ids.contract,
      module:"integridade",assetIds:[ids.visualAsset,ids.thicknessAsset],status:"rascunho"}],
    inspection:[inspection(ids.visual,ids.visualAsset,"visual"),inspection(ids.thickness,ids.thicknessAsset,"espessura")],
    lvt:[],lvtItem:[],photo:[],finding:[],rti:[],document:[],revision:[],classification:[],
    deadline:[],delivery:[],relation:[],relations:[],findings:[] };
}

function sdkScript(role) {
  return `window.PiresSupabase={createClient(){return {auth:{
    getSession:async()=>({data:{session:{access_token:'fixture.browser.session'}},error:null}),
    getUser:async()=>({data:{user:{id:${JSON.stringify(ids.user)},email:'inspection@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false}},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>({error:null})
  },rpc:async(name,args)=>{
    if(name==='pi_my_company_access')return {data:[{id:${JSON.stringify(ids.tenant)},name:'ORGANIZAÇÃO FIXTURE'}],error:null};
    if(name==='pi_access_status_v3')return {data:{version:3,user_id:${JSON.stringify(ids.user)},status:'active',is_master:false,company_id:${JSON.stringify(ids.tenant)},company_role:${JSON.stringify(role)},activated_at:'2026-01-01T00:00:00Z',expires_at:null,server_now:'2026-10-28T20:00:00Z',license_scope:'company',plan_kind:'indefinite'},error:null};
    return {data:null,error:{code:'unexpected_fixture_rpc'}};
  }}}};`;
}

async function staticServer() {
  const appRoot = path.resolve(__dirname,"../app");
  const allowed = new Set(fs.readdirSync(appRoot,{recursive:true})
    .filter(file=>fs.statSync(path.join(appRoot,file)).isFile()));
  const server = http.createServer((request,response)=>{
    let file = new URL(request.url,"http://fixture").pathname.slice(1);
    if(!file.includes(".")) file += ".html";
    if(!allowed.has(file)) return response.writeHead(404).end();
    response.writeHead(200,{"Content-Type":{
      ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
      ".css":"text/css; charset=utf-8",".jpeg":"image/jpeg",".png":"image/png"
    }[path.extname(file)]||"application/octet-stream"});
    response.end(fs.readFileSync(path.join(appRoot,file)));
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  return {server,base:"http://127.0.0.1:"+server.address().port};
}

async function noOverflow(page,label) {
  const dimensions = await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(dimensions.document<=dimensions.width,`${label}: ${dimensions.document}px exceeds ${dimensions.width}px`);
}

async function navigate(page,view,inspectionId="_") {
  const hash = `#gestao/${ids.owner}/integridade/${view}/${inspectionId}?contrato=${ids.contract}`;
  await page.evaluate(value=>{location.hash=value;},hash);
  await page.waitForFunction(({view})=>document.getElementById("flowView")?.dataset.view===view,{view});
}

async function fixturePage(browser,base,options={}) {
  const role = options.role || "admin", canWrite = role === "admin";
  const state = initialState(), executions = new Map(), receipts = new Map(), files = new Map();
  const calls = [], errors = [], unexpected = [], writes = [];
  let deniedInspection = options.deniedInspection || null, photoNumber = 40;
  const catalog = options.catalogUnavailable
    ? {id:null,status:"unavailable",items:[],reason:"Catálogo de LVT com fonte conferida ainda não disponível"}
    : clone(verifiedCatalog);
  const professionals = [
    {id:ids.professional,name:"INSPETOR FIXTURE EXISTENTE",registrationState:"active",accessLinked:true},
    {id:ids.otherProfessional,name:"OUTRO PROFISSIONAL FIXTURE EXISTENTE",registrationState:"active",accessLinked:true}
  ];
  const inspection = inspectionId => state.inspection.find(record=>record.id===inspectionId);
  const progress = record => {
    const execution = executions.get(record.id), answered = execution?.answers?.filter(answer=>answer.conditionId||answer.notCovered).length||0;
    return {answered,total:record.type==="visual"?catalog.items.length:0};
  };
  const listedInspection = record => ({...clone(record),
    executionId:executions.get(record.id)?.id||null,
    executionStatus:executions.get(record.id)?.status||null,
    technicalReviewRequired:executions.get(record.id)?.answers?.some(answer=>answer.notCovered)||false,
    progress:progress(record)});
  const detail = inspectionId => {
    const record = inspection(inspectionId);
    if(!record) return null;
    const canExecute=canWrite&&record.assigneeProfessionalId===ids.professional;
    return {actorUserId:ids.user,professionalId:ids.professional,
      canAssign:canWrite,canExecute,writeAllowed:canWrite,
      professionals:canWrite?clone(professionals):[],
      executionBlockReason:!canWrite?"Seu acesso atual permite apenas consulta. A gestão deve revisar a autorização existente.":!canExecute?"A execução está disponível somente ao profissional atribuído à atividade.":null,
      inspection:listedInspection(record),execution:clone(executions.get(record.id)||null),
      catalog:record.type==="visual"?clone(catalog):{id:null,status:"unavailable",items:[],reason:"Procedimento e pontos de medição não confirmados"}};
  };
  const context = await browser.newContext({viewport:options.viewport||{width:1440,height:1000},reducedMotion:"reduce",locale:"pt-BR"});
  await context.route("**/*",route=>{
    const url=route.request().url();
    if(url.startsWith(base+"/")||url.startsWith(API))return route.continue();
    unexpected.push(url);return route.abort();
  });
  await context.route("**/runtime-config.js",route=>route.fulfill({contentType:"text/javascript",body:"window.PIRES_CONFIG="+JSON.stringify(config)+";"}));
  await context.route("**/vendor/supabase.js",route=>route.fulfill({contentType:"text/javascript",body:sdkScript(role)}));
  await context.route(API+"**",async route=>{
    const request=route.request(),resource=request.url().slice(API.length),method=request.method();
    const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-pires-tenant,x-pires-source-name","Access-Control-Expose-Headers":"Content-Disposition"};
    if(method==="OPTIONS")return route.fulfill({status:204,headers:cors});
    calls.push({resource,method});
    const json=(value,status=200)=>route.fulfill({status,headers:cors,json:value});
    const ownerPrefix=`companies/${ids.owner}/`;
    if(resource==="status")return json({user_id:ids.user,actor:"inspection@fixture.invalid",mode:"supabase_integrado",
      capabilities:{write:canWrite,operations:true,photoOriginals:true,documentOriginals:true,
        workflowVersion:2,inspectionExecutionVersion:1,xlsx:true,pdf:false,xls:false}});
    if(resource==="tenants")return json([{id:ids.tenant,name:"ORGANIZAÇÃO FIXTURE"}]);
    if(resource==="companies")return json([state.company]);
    assert.equal(request.headers()["x-pires-tenant"],ids.tenant);
    if(resource===ownerPrefix+"state")return json(clone(state));
    if(resource===ownerPrefix+"execution")return json({actorUserId:ids.user,
      professionalId:ids.professional,canAssign:canWrite,writeAllowed:canWrite,professionals:canWrite?professionals:[],
      inspections:state.inspection.filter(record=>canWrite||record.assigneeProfessionalId===ids.professional)
        .map(listedInspection)});
    if(resource.startsWith(ownerPrefix+"execution/")) {
      const inspectionId=resource.split("/").at(-1),record=inspection(inspectionId);
      if(!record||inspectionId===deniedInspection||!canWrite&&record.assigneeProfessionalId!==ids.professional)
        return json({error:"Inspeção não atribuída a este profissional",code:"access_denied"},403);
      return json(detail(inspectionId));
    }
    if(method==="GET"&&resource.startsWith(ownerPrefix+"sources/")) {
      const original=files.get(resource.split("/").at(-1));
      if(!original)return json({error:"Fonte sintética não encontrada"},404);
      return route.fulfill({status:200,headers:{...cors,"Content-Type":"image/png","Content-Disposition":"attachment; filename=FOTO-SOMENTE-FIXTURE.png"},body:original});
    }
    if(resource==="sources/photo") {
      if(!canWrite)return json({error:"Consulta somente",code:"access_denied"},403);
      const bytes=request.postDataBuffer(),sha=createHash("sha256").update(bytes).digest("hex");
      files.set(sha,bytes);writes.push({operation:"sources/photo"});
      return json({id:sha,sha,name:"FOTO-SOMENTE-FIXTURE.png",format:"photo_png"});
    }
    if(method!=="POST") {unexpected.push(resource);return json({error:"Rota sintética inesperada"},404);}
    const operation=resource.replace(ownerPrefix,""),body=request.postDataJSON();
    writes.push({operation,body:clone(body)});
    if(!canWrite)return json({error:"Seu acesso atual permite apenas consulta",code:"access_denied"},403);
    if(operation==="photos") {
      assert.ok(files.has(body.sourceId));
      const record={...body,id:id(photoNumber++),source:{sourceId:body.sourceId,locator:body.locator}};
      state.photo.push(record);return json(record);
    }
    const record=inspection(body.inspectionId);
    if(!record)return json({error:"Inspeção não encontrada"},404);
    const receiptKey=operation+":"+body.requestId;
    if(receipts.has(receiptKey))return json(clone(receipts.get(receiptKey)));
    if(operation==="execution-assign") {
      if(body.expectedVersion!==record.version)return json({error:"Registro alterado",code:"version_conflict"},409);
      const professional=professionals.find(person=>person.id===body.professionalId);
      record.assigneeProfessionalId=professional?.id||null;record.assigneeName=professional?.name||null;record.version++;
    } else if(operation==="execution-start") {
      if(record.assigneeProfessionalId!==ids.professional)return json({error:"Inspeção não atribuída ao usuário atual",code:"access_denied"},403);
      if(!executions.has(record.id)) {
        const executionId=record.type==="visual"?ids.visualExecution:ids.thicknessExecution;
        const execution={id:executionId,inspectionId:record.id,assetId:record.assetId,
          contractId:record.contractId,campaignId:record.campaignId,type:record.type,
          recordClass:record.type==="visual"?"field_lvt":"field_measurement",status:"rascunho",
          version:1,answers:[],observedOn:null,instrument:null,readings:[],progress:progress(record),
          items:record.type==="visual"?catalog.items.map((item,index)=>({catalogItemId:item.id,itemKey:item.itemKey,lvtItemId:id(30+index)})):[]};
        executions.set(record.id,execution);
        if(record.type==="visual") {
          state.lvt.push(clone(execution));
          for(const item of execution.items)state.lvtItem.push({id:item.lvtItemId,lvtId:execution.id,
            assetId:record.assetId,contractId:record.contractId,itemKey:item.itemKey,component:catalog.items.find(entry=>entry.id===item.catalogItemId).component});
        }
      }
    } else if(["execution-save","execution-submit"].includes(operation)) {
      const execution=executions.get(record.id);
      if(!execution)return json({error:"Inicie a inspeção"},409);
      if(body.expectedVersion!==execution.version)return json({error:"Rascunho alterado",code:"version_conflict"},409);
      if(operation==="execution-save") {
        for(const name of ["answers","observedOn","instrument","readings"])
          if(Object.hasOwn(body,name))execution[name]=clone(body[name]);
        execution.technicalReviewRequired=execution.answers.some(answer=>answer.notCovered);
        execution.status="rascunho";
        for(const answer of execution.answers)if(answer.recommendationId) {
          const sourceItem=execution.items.find(item=>item.catalogItemId===answer.catalogItemId);
          let rti=state.rti.find(value=>value.lvtItemId===sourceItem.lvtItemId);
          if(!rti) {rti={id:id(60+state.rti.length),assetId:record.assetId,contractId:record.contractId,
            inspectionId:record.id,lvtId:execution.id,lvtItemId:sourceItem.lvtItemId,
            title:"RECOMENDAÇÃO SOMENTE FIXTURE",recommendation:"RECOMENDAÇÃO SOMENTE FIXTURE",
            status:"aberta",currentness:"confirmed_current"};state.rti.push(rti);}
          rti.photoIds=clone(answer.photoIds||[]);
        }
      } else {
        if(catalog.status!=="verified"||record.type!=="visual"||execution.answers.length!==catalog.items.length||execution.answers.some(answer=>!answer.conditionId||answer.notCovered))
          return json({error:"Responda todos os itens com catálogo verificado; encaminhamentos técnicos pendentes impedem envio",code:"incomplete_checklist"},422);
        execution.status="em_revisao";
      }
      execution.version++;execution.progress=progress(record);
    } else {unexpected.push(resource);return json({error:"Gravação sintética inesperada"},404);}
    const response=detail(record.id);receipts.set(receiptKey,clone(response));return json(response);
  });
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+`/gestao.html#gestao/${ids.owner}/integridade/minhas/_?contrato=${ids.contract}`);
  await page.locator("#workspace:not([hidden])").waitFor();
  await page.locator(`#company option[value="${ids.owner}"]`).waitFor({state:"attached"});
  if(await page.locator("#company").inputValue()!==ids.owner)
    await page.locator(".client-card").filter({hasText:"CLIENTE FIXTURE DE INSPEÇÃO"}).click();
  return {page,context,state,executions,professionals,calls,writes,errors,unexpected,files,
    setDeniedInspection(value){deniedInspection=value;},catalog};
}

module.exports = { ids, initialState, sdkScript, staticServer, noOverflow, navigate, fixturePage, verifiedCatalog, pngFixture };

async function main() {
  fs.mkdirSync(output,{recursive:true});
  const {server,base}=await staticServer();
  let browser;
  const checks=[];
  const record=(name,limits)=>checks.push({name,passed:true,...(limits?{limits}:{} )});
  const save = async (fixture,label="Salvar rascunho") => {
    await fixture.page.getByRole("button",{name:label,exact:true}).click();
    if(label==="Enviar para revisão")return;
    await fixture.page.locator(".inspection-feedback").filter({hasText:/Rascunho salvo/}).waitFor();
  };
  const ready = (page,inspectionId,executionId) => page.locator(`.inspection-workspace[data-inspection-id="${inspectionId}"]${executionId?`[data-execution-id="${executionId}"]`:""}`).waitFor();
  try {
    browser=await chromium.launch({executablePath:process.env.PIRES_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
    const f=await fixturePage(browser,base),page=f.page;
    await page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).waitFor();
    assert.equal(await page.locator(".inspection-card").count(),2);
    const card=page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`);
    assert.match(await card.innerText(),/VISUAL-FIXTURE[\s\S]*SISTEMA FIXTURE[\s\S]*2026-10-30[\s\S]*INSPETOR FIXTURE EXISTENTE/);
    assert.equal(await card.getByRole("button",{name:"Iniciar inspeção",exact:true}).count(),1);
    assert.equal(await card.getByRole("button",{name:"Book e histórico",exact:true}).count(),1);
    await noOverflow(page,"desktop cards");
    await page.screenshot({path:path.join(output,"cards-desktop.png"),fullPage:true});
    record("cards mostram TAG, sistema, modalidade, data, responsável e ação principal; book secundário");

    await navigate(page,"ativos",ids.system);
    await card.waitFor();
    const countBefore=f.professionals.length;
    const assignment=card.locator('form[data-operation="execution-assign"]');
    await assignment.locator('[name="professionalId"]').selectOption(ids.otherProfessional);
    let assignmentReload=page.waitForResponse(response=>response.request().method()==="GET"&&response.url()===API+`companies/${ids.owner}/execution`);
    await assignment.getByRole("button",{name:"Salvar atribuição",exact:true}).click();
    await assignmentReload;
    await card.locator('[name="professionalId"]').filter({has:page.locator('option:checked[value="'+ids.otherProfessional+'"]')}).waitFor();
    assert.equal(f.professionals.length,countBefore);
    assert.equal(f.state.inspection.find(value=>value.id===ids.visual).assigneeProfessionalId,ids.otherProfessional);
    await card.locator('[name="professionalId"]').selectOption(ids.professional);
    assignmentReload=page.waitForResponse(response=>response.request().method()==="GET"&&response.url()===API+`companies/${ids.owner}/execution`);
    await card.getByRole("button",{name:"Salvar atribuição",exact:true}).click();
    await assignmentReload;
    await page.waitForFunction(({inspectionId,professionalId})=>{
      const node=document.querySelector(`.inspection-card[data-inspection-id="${inspectionId}"] select[name="professionalId"]`);
      return node?.value===professionalId;
    },{inspectionId:ids.visual,professionalId:ids.professional});
    record("gestor atribui e reatribui profissional existente sem criar pessoa, conta ou contrato");

    await card.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(page,ids.visual);
    await page.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(page,ids.visual,ids.visualExecution);
    assert.equal(f.executions.size,1);assert.equal(f.state.lvt.length,1);
    assert.equal(await page.locator(".inspection-item").count(),2);
    const first=()=>page.locator('[data-catalog-item-id="fixture-item-1"]');
    const second=()=>page.locator('[data-catalog-item-id="fixture-item-2"]');
    for(const item of [first(),second()])assert.equal(await item.locator('[name="conditionId"]').inputValue(),"");
    assert.equal(await first().locator('[name="recommendationId"]').isDisabled(),true);
    assert.equal(await page.locator(".inspection-item textarea,.inspection-item input[type=text]").count(),0);
    assert.equal(await page.locator('[name="observedOn"]').inputValue(),"");
    record("início abre checklist da mesma atividade, sem respostas boas automáticas nem redação livre de observação/recomendação");

    await save(f,"Enviar para revisão");
    await page.locator(".inspection-feedback").filter({hasText:/Responda todos os itens/}).waitFor();
    assert.equal(f.executions.get(ids.visual).status,"rascunho");
    await page.locator('[name="observedOn"]').fill("2026-10-28");
    await first().locator('[name="conditionId"]').selectOption("fixture-condition-1");
    await first().locator('[name="recommendationId"]').selectOption("fixture-recommendation-1");
    await first().locator('[name="conditionId"]').selectOption("fixture-condition-1-alt");
    assert.equal(await first().locator('[name="recommendationId"]').inputValue(),"");
    assert.equal(await first().locator('option[value="fixture-recommendation-1"]').evaluate(option=>option.disabled),true);
    assert.match(await first().innerText(),/recomendação anterior foi retirada/);
    await first().locator('[name="conditionId"]').selectOption("fixture-condition-1");
    await first().locator('[name="recommendationId"]').selectOption("fixture-recommendation-1");
    await second().locator('[name="conditionId"]').selectOption("fixture-condition-2");
    const savesBeforePhoto=f.writes.filter(write=>write.operation==="execution-save").length;
    await page.getByRole("button",{name:"Salvar rascunho",exact:true}).click();
    await page.locator(".inspection-feedback").filter({hasText:/anexe ao menos uma fotografia/}).waitFor();
    assert.equal(f.writes.filter(write=>write.operation==="execution-save").length,savesBeforePhoto);
    await first().locator('input[type="file"]').setInputFiles({name:"FOTO-SOMENTE-FIXTURE.png",mimeType:"image/png",buffer:pngFixture});
    await first().getByRole("button",{name:"Anexar fotos do item",exact:true}).click();
    await first().getByRole("status").filter({hasText:/Fotos vinculadas/}).waitFor();
    await save(f);
    assert.equal(f.state.rti.length,1);assert.equal(f.state.photo.length,1);assert.equal(f.state.rti[0].photoIds.length,1);
    assert.equal(f.state.rti[0].contractId,ids.contract);assert.equal(f.state.rti[0].assetId,ids.visualAsset);
    const stableRtiId=f.state.rti[0].id;
    await noOverflow(page,"desktop checklist");
    await page.screenshot({path:path.join(output,"checklist-desktop.png"),fullPage:true});
    record("rejeição do envio incompleto permite corrigir e salvar na mesma tela; foto vinculada ao item e RTI da mesma TAG/contrato", "Contrato HTTP sintético; autorização e atomicidade SQL são verificadas separadamente pela suíte de backend.");

    await navigate(page,"minhas");
    await page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Continuar inspeção",exact:true}).click();
    await ready(page,ids.visual,ids.visualExecution);
    await page.reload();await ready(page,ids.visual,ids.visualExecution);
    assert.equal(await first().locator('[name="conditionId"]').inputValue(),"fixture-condition-1");
    assert.equal(await first().locator('[name="recommendationId"]').inputValue(),"fixture-recommendation-1");
    await first().getByRole("button",{name:"Ver fotografia do item",exact:true}).click();
    await first().locator("img.inspection-item-photo").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector('.inspection-item-photo')?.naturalWidth===1);
    assert.equal(f.executions.size,1);assert.equal(f.state.lvt.length,1);assert.equal(f.state.rti.length,1);
    await save(f);
    assert.equal(f.state.rti[0].id,stableRtiId);assert.equal(f.state.rti.length,1);assert.equal(f.state.contract.length,1);
    record("continuar, recarregar e salvar preservam execução/LVT/RTI/contrato, seleções e acesso à foto do item", "Persistência do estado no processo de fixture do teste; não equivale à persistência de produção.");

    await first().locator('[name="conditionId"]').selectOption("__not_covered__");
    assert.equal(await first().locator('[name="recommendationId"]').isDisabled(),true);
    assert.equal(await first().locator('[name="recommendationId"]').inputValue(),"");
    await save(f);
    assert.equal(f.executions.get(ids.visual).technicalReviewRequired,true);
    assert.equal(f.executions.get(ids.visual).status,"rascunho");
    await navigate(page,"ativos",ids.system);
    await page.locator('[name="inspectionQueue"]').selectOption("technical");
    assert.equal(await page.locator(".inspection-card").count(),1);
    assert.match(await page.locator(".inspection-card").innerText(),/Gestão técnica pendente/);
    await page.screenshot({path:path.join(output,"gestao-tecnica-desktop.png"),fullPage:true});
    await page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Continuar inspeção",exact:true}).click();
    await ready(page,ids.visual,ids.visualExecution);
    await save(f,"Enviar para revisão");
    await page.locator(".inspection-feedback").filter({hasText:/encaminhamentos técnicos pendentes/}).waitFor();
    await first().locator('[name="conditionId"]').selectOption("fixture-condition-1");
    await first().locator('[name="recommendationId"]').selectOption("fixture-recommendation-1");
    await save(f,"Enviar para revisão");
    await page.locator(".inspection-feedback").filter({hasText:/Enviada para revisão técnica/}).waitFor();
    assert.equal(f.executions.get(ids.visual).status,"em_revisao");
    assert.equal(f.state.rti.length,1);assert.equal(f.state.rti[0].id,stableRtiId);assert.equal(f.state.rti[0].status,"aberta");
    assert.equal(await page.getByRole("button",{name:"Salvar rascunho",exact:true}).isDisabled(),true);
    record("condição não contemplada mantém pendência técnica; envio completo bloqueia edição e preserva RTI aberta");

    await navigate(page,"minhas");
    await page.locator(`.inspection-card[data-inspection-id="${ids.thickness}"]`).getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(page,ids.thickness);
    await page.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(page,ids.thickness,ids.thicknessExecution);
    assert.match(await page.locator(".inspection-workspace").innerText(),/Medição de espessura/);
    assert.equal(await page.locator(".inspection-item").count(),0);
    assert.equal(await page.locator('.inspection-reading').count(),0);
    assert.equal(await page.locator('[name="instrument"]').inputValue(),"");
    assert.equal(f.state.inspection.find(value=>value.id===ids.thickness).type,"espessura");
    await page.getByRole("button",{name:"Adicionar leitura identificada no desenho",exact:true}).click();
    const reading=page.locator('.inspection-reading').first();
    assert.equal(await reading.locator('[name="point"]').inputValue(),"");
    assert.equal(await reading.locator('[name="unit"]').inputValue(),"");
    await reading.locator('[name="point"]').fill("PONTO-FIXTURE-DOCUMENTADO");
    await reading.locator('[name="value"]').fill("3.20");await reading.locator('[name="unit"]').selectOption("mm");
    await page.locator('[name="instrument"]').fill("INSTRUMENTO SOMENTE FIXTURE");
    await page.locator('[name="observedOn"]').fill("2026-10-28");
    await save(f);
    await page.setViewportSize({width:390,height:844});await noOverflow(page,"mobile espessura");
    await page.screenshot({path:path.join(output,"espessura-mobile.png"),fullPage:true});
    assert.equal(f.executions.get(ids.thickness).type,"espessura");assert.equal(f.state.lvt.length,1);
    record("espessura abre ficha própria, sem virar visual ou inventar pontos/posições angulares; rascunho independente");
    await navigate(page,"minhas");await page.locator(".inspection-card").first().waitFor();
    await noOverflow(page,"mobile cards");await page.screenshot({path:path.join(output,"cards-mobile.png"),fullPage:true});
    await page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Consultar inspeção",exact:true}).click();
    await ready(page,ids.visual,ids.visualExecution);await noOverflow(page,"mobile checklist");
    await page.screenshot({path:path.join(output,"checklist-mobile.png"),fullPage:true});
    assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpected,[]);
    assert.equal(f.writes.some(write=>/person|account|credential|project-create/.test(write.operation)),false);
    await f.context.close();

    const pending=await fixturePage(browser,base,{catalogUnavailable:true,viewport:{width:390,height:844}});
    await pending.page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(pending.page,ids.visual);await pending.page.getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(pending.page,ids.visual,ids.visualExecution);
    await pending.page.locator(".inspection-catalog-pending").waitFor();
    assert.equal(await pending.page.locator(".inspection-item").count(),0);
    assert.equal(await pending.page.getByRole("button",{name:"Enviar para revisão",exact:true}).isDisabled(),true);
    await noOverflow(pending.page,"mobile catalog unavailable");
    await pending.page.screenshot({path:path.join(output,"catalogo-pendente-mobile.png"),fullPage:true});
    assert.deepEqual(pending.errors,[]);assert.deepEqual(pending.unexpected,[]);
    await pending.context.close();
    record("catálogo real indisponível é pendência explícita, sem frases inventadas ou respostas presumidas");

    const readonly=await fixturePage(browser,base,{role:"inspector",viewport:{width:390,height:844}});
    await readonly.page.locator(".inspection-card").first().waitFor();
    assert.equal(await readonly.page.locator('form[data-operation="execution-assign"]').count(),0);
    await readonly.page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).getByRole("button",{name:"Iniciar inspeção",exact:true}).click();
    await ready(readonly.page,ids.visual);
    assert.equal(await readonly.page.getByRole("button",{name:"Iniciar inspeção",exact:true}).isDisabled(),true);
    assert.match(await readonly.page.locator(".inspection-access-note").innerText(),/apenas consulta/);
    const accessNotice=await readonly.page.locator("#connectedWriteNotice").boundingBox(),clientToolbar=await readonly.page.locator(".client-toolbar").boundingBox();
    assert.ok(accessNotice.y+accessNotice.height<=clientToolbar.y+1,"Aviso de permissão não pode sobrepor o seletor de cliente no celular");
    assert.equal(readonly.writes.length,0);
    await readonly.page.screenshot({path:path.join(output,"inspetor-consulta-mobile.png"),fullPage:true});
    record("inspetor atribuído com permissão atual de consulta vê atividades, mas não salva nem recebe autorização inventada");
    readonly.state.inspection.find(value=>value.id===ids.visual).assigneeProfessionalId=ids.otherProfessional;
    await navigate(readonly.page,"minhas");
    await readonly.page.locator(`.inspection-card[data-inspection-id="${ids.thickness}"]`).waitFor();
    assert.equal(await readonly.page.locator(`.inspection-card[data-inspection-id="${ids.visual}"]`).count(),0);
    const denial=readonly.page.waitForResponse(response=>response.url()===API+`companies/${ids.owner}/execution/${ids.visual}`);
    await navigate(readonly.page,"execucao",ids.visual);
    assert.equal((await denial).status(),403);
    await readonly.page.locator("#workspace[hidden]").waitFor({state:"attached"});
    assert.equal(await readonly.page.locator('.inspection-workspace[data-inspection-id="'+ids.visual+'"]').count(),0);
    assert.equal(readonly.writes.length,0);assert.deepEqual(readonly.errors,[]);assert.deepEqual(readonly.unexpected,[]);
    await readonly.context.close();
    record("minhas inspeções oculta atividade de outro profissional e acesso direto negado não dispara gravação", "A negativa HTTP é simulada neste teste; a autorização real é coberta nos testes SQL/RPC isolados.");
    fs.writeFileSync(path.join(output,"browser-results.json"),JSON.stringify({
      fixtureOnly:true,productionTested:false,viewports:[{width:1440,height:1000},{width:390,height:844}],checks,
      warning:"Catálogo, profissionais, imagens e respostas HTTP são sintéticos exclusivos do teste; nenhuma conta ou dado foi inserido em produção."
    },null,2)+"\n");
    console.log(JSON.stringify({passed:checks.length,checks:checks.map(check=>check.name),output}));
  } finally {await browser?.close();server.close();}
}

if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
