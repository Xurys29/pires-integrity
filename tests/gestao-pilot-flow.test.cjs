"use strict";
// Local integration only: real Edge/SQL/validators, synthetic Auth and Storage.
// No source document or account data is embedded in this test.
const {test}=require("node:test"),assert=require("node:assert/strict"),{randomUUID}=require("node:crypto"),
 {deflateSync}=require("node:zlib"),{jsPDF}=require("jspdf"),{setup,ids}=require("./fixtures/gestao-postgres-fixture.cjs");
function pngFixture(){
 const crc=b=>{let n=0xffffffff;for(const v of b){n^=v;for(let j=0;j<8;j++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const t=Buffer.from(type),h=Buffer.alloc(4),c=Buffer.alloc(4);h.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([h,t,data,c]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(8,0);head.writeUInt32BE(6,4);head[8]=8;head[9]=2;
 const pixels=Buffer.alloc(6*(1+8*3));for(let y=0;y<6;y++)for(let x=0;x<8;x++){let n=y*25+1+x*3;pixels[n]=x*30;pixels[n+1]=y*40;pixels[n+2]=150;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",head),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
}
test("piloto integrado local: sistema/TAG/LVT/item/foto/recomendação geram a mesma RTI persistente e bloqueiam outro master",async t=>{
 const [{createGestaoHandler},{readXlsx},validation]=await Promise.all([
  import("../supabase/functions/_shared/gestao-api-core.mjs"),import("../supabase/functions/_shared/xlsx-reader.mjs"),import("../supabase/functions/_shared/document-original.mjs")]);
 let f=await setup({pilot:false});t.after(()=>f.close());const storage=new Map(),events=[];
 const tokens=new Map([["fixture.admin.signature",ids.adminA],["fixture.master.signature",ids.master],["fixture.stranger.signature",ids.stranger]]);
 const rpc=async fn=>{try{return{data:await fn(),error:null};}catch(e){return{data:null,error:{code:e.code,message:e.message}};}};
 const handler=createGestaoHandler({appOrigin:"https://pilot.fixture.invalid",readXlsx,validateDocument:validation.validateDocument,validatePhoto:validation.validatePhoto,
  createUserClient(token){const uid=tokens.get(token);return{auth:{async getUser(){return{data:{user:uid?{id:uid,email_confirmed_at:"2026-01-01T00:00:00Z",is_anonymous:false}:null},error:uid?null:{message:"not fixture"}};}},
   rpc(name,args){events.push({kind:"userRpc",uid,name});if(name==="pi_gestao_api")return rpc(()=>f.call(args.p_tenant,args.p_action,args.p_payload,uid));return rpc(()=>f.asRole("authenticated",uid,async db=>(await db.query("select public.pi_my_company_access() as value")).rows[0].value));}};},
  createServiceClient(){events.push({kind:"service"});return{rpc(name,args){assert.equal(name,"pi_gestao_register_source");return rpc(()=>f.register(args.p_tenant,args.p_actor,args.p_payload));},storage:{from(bucket){assert.equal(bucket,"pi-gestao-sources");return{
   async upload(key,bytes,options){assert.equal(options.upsert,false);if(storage.has(key))return{error:{statusCode:"409"}};storage.set(key,Uint8Array.from(bytes));const[tenant,sha,file]=key.split("/");await f.putObject(tenant,sha,bytes.byteLength,file.split(".").at(-1));return{data:{path:key},error:null};},
   async download(key){return storage.has(key)?{data:new Blob([storage.get(key)]),error:null}:{error:{statusCode:"404"}};}
  };}}};}
 });
 async function response(route,body,{token="fixture.admin.signature",raw=false,mime,name}={}){
  const headers={Origin:"https://pilot.fixture.invalid",Authorization:"Bearer "+token,"X-Pires-Tenant":ids.tenantA};
  if(body!==undefined)headers["Content-Type"]=raw?mime:"application/json";if(name)headers["X-Pires-Source-Name"]=encodeURIComponent(name);
  return handler(new Request("https://supabase.fixture.invalid/functions/v1/gestao-api/"+route,{method:body===undefined?"GET":"POST",headers,...(body===undefined?{}:{body:raw?body:JSON.stringify(body)})}));
 }
 async function call(route,body,options){const r=await response(route,body,options),data=await r.json();assert.ok(r.ok,JSON.stringify({route,status:r.status,data}));return data;}
 assert.equal((await response("status")).status,403);
 await f.db.query("insert into pi_gestao_private.pilot_access(tenant_id,user_id,reason) values($1,$2,'isolated integration fixture')",[ids.tenantA,ids.adminA]);
 assert.equal((await call("status")).capabilities.write,true);
 const owner=await call("companies",{name:"Cliente integração fixture",source:"Pedido isolado fixture"}),root="companies/"+owner.id;
 assert.equal((await call("companies",{name:" CLIENTE INTEGRAÇÃO FIXTURE ",source:"Retry fixture"})).id,owner.id);
 const h=await call(root+"/hierarchy",{unit:"Unidade fixture",system:"Sistema fixture 1"}),other=await call(root+"/hierarchy",{unit:"Unidade fixture",system:"Sistema fixture 2"});
 const asset=await call(root+"/assets",{tag:"TAG-FIXTURE-A",type:"linha",unitId:h.unit.id,systemId:h.system.id,source:"Fonte declarada fixture"}),foreignSystemAsset=await call(root+"/assets",{tag:"TAG-FIXTURE-B",type:"linha",unitId:other.unit.id,systemId:other.system.id,source:"Fonte declarada fixture"});
 const con=await call(root+"/contracts",{requestId:randomUUID(),name:"Contrato fixture",source:"Escopo explícito fixture",modules:["integridade"],assetIds:[asset.id,foreignSystemAsset.id]});
 const campaignInput={requestId:randomUUID(),name:"Campanha fixture",source:"Planejamento fixture",status:"rascunho",contractId:con.id,module:"integridade",systemId:h.system.id,assetIds:[asset.id]};
 assert.notEqual((await response(root+"/campaigns",{...campaignInput,assetIds:[asset.id,foreignSystemAsset.id]})).status,200);
 const campaign=await call(root+"/campaigns",campaignInput),inspection=await call(root+"/inspections",{requestId:randomUUID(),assetId:asset.id,contractId:con.id,campaignId:campaign.id,module:"integridade",type:"visual",status:"planejada",source:"Planejamento fixture"});
 const pdf=new jsPDF();pdf.text("Documento de teste isolado; sem validade tecnica",15,20);const pdfBytes=new Uint8Array(pdf.output("arraybuffer"));
 const original=await call("sources/document",pdfBytes,{raw:true,mime:"application/pdf",name:"lvt-fixture.pdf"});
 const document=await call(root+"/documents",{assetId:asset.id,contractId:con.id,campaignId:campaign.id,module:"integridade",documentType:"lvt",reference:"LVT fixture",sourceId:original.id,locator:{page:1}}),lvt=await call(root+"/lvts",{assetId:asset.id,inspectionId:inspection.id,documentId:document.id});
 const itemInput={assetId:asset.id,lvtId:lvt.id,itemKey:"1.2",component:"Componente fixture",description:"Item da LVT fixture",sourceId:original.id,locator:{page:1,section:"Item 1.2"}},item=await call(root+"/lvt-items",itemInput),item2=await call(root+"/lvt-items",{...itemInput,itemKey:"1.3",locator:{page:1,section:"Item 1.3"}});
 assert.notEqual(item.id,item2.id);assert.equal((await call(root+"/lvt-items",itemInput)).id,item.id);
 const photoOriginal=await call("sources/photo",pngFixture(),{raw:true,mime:"image/png",name:"foto-fixture.png"}),photoInput={assetId:asset.id,lvtItemId:item.id,sourceId:photoOriginal.id,locator:{section:"Foto 1 do item 1.2"},caption:"Legenda da foto fixture"},photo=await call(root+"/photos",photoInput);
 assert.equal((await call(root+"/photos",photoInput)).id,photo.id);
 const findingInput={assetId:asset.id,lvtItemId:item.id,description:"Constatação fixture",recommendation:"Recomendação documentada fixture",sourceId:original.id,locator:{page:1,section:"Recomendação 1.2"},sourceStatus:"Situação histórica sem confirmação atual",sourceDate:"2020-01-01"},finding=await call(root+"/findings",findingInput);
 assert.equal(finding.rti.lvtItemId,item.id);assert.equal(finding.rti.issuedNumber,null);assert.equal(finding.rti.currentness,"unknown");assert.equal(finding.rti.due,undefined);
 const retry=await call(root+"/findings",findingInput);assert.equal(retry.id,finding.id);assert.equal(retry.rti.id,finding.rti.id);
 let state=await call(root+"/state");assert.equal(state.rti.length,1);assert.equal(state.lvtItem.length,2);assert.equal(state.photo.length,1);assert.equal(state.inspection[0].done,null);
 const book=await call(root+"/book/"+asset.id);assert.ok(book.records.some(r=>r.id===finding.rti.id));assert.ok(book.records.some(r=>r.id===photo.id));
 const snapshot=await call(root+"/reports/system/"+h.system.id);assert.equal(snapshot.canIssue,false);assert.equal(snapshot.system.id,h.system.id);assert.deepEqual(snapshot.assets.map(a=>a.id),[asset.id]);assert.equal(snapshot.photos[0].lvtItemId,item.id);assert.equal(snapshot.rtis[0].id,finding.rti.id);assert.ok(snapshot.recordVersions.length);
 const download=await response(root+"/sources/"+photoOriginal.id);assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pngFixture());
 const dataDir=await f.db.dumpDataDir();await f.close();f=await setup({loadDataDir:dataDir});state=await call(root+"/state");assert.equal(state.rti[0].id,finding.rti.id);assert.equal(state.photo[0].id,photo.id);
 const serviceCount=events.filter(e=>e.kind==="service").length;
 assert.equal((await response(root+"/state",undefined,{token:"fixture.master.signature"})).status,403);
 assert.equal((await response(root+"/sources/"+photoOriginal.id,undefined,{token:"fixture.stranger.signature"})).status,403);
 await f.db.query("update pi_gestao_private.pilot_access set revoked_at=now() where tenant_id=$1 and user_id=$2",[ids.tenantA,ids.adminA]);
 assert.equal((await response(root+"/state")).status,403);assert.equal((await response(root+"/sources/"+photoOriginal.id)).status,403);assert.equal(events.filter(e=>e.kind==="service").length,serviceCount);
});
