const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.value='';this.disabled=false;this.checked=false;this.isConnected=true;}
 append(...children){this.children.push(...children);}
 setAttribute(name,value){this[name]=value;}
}
function fixture(capability,{legacy=false,declared=true,closed=false}={}){
 if(arguments.length===0)capability=1;
 const document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},box=new Element('main'),writes=[];
 const anchor={event:'inspection_completed',date:declared?'2026-10-28':null,status:declared?'declared':'pending_inspection_end',inspectionId:'inspection-fixture',executionId:'execution-fixture',executionVersion:4};
 const rti={id:'rti-fixture',version:7,assetId:'asset-fixture',status:closed?'encerrada':'aberta',due:'2027-02-01',deadlineAnchor:anchor,...(legacy?{}:{executionId:'execution-fixture'})};
 const context={mode:'connected',write:true,tenantId:'tenant-fixture',client:{id:'owner-fixture'},capabilities:{workflowVersion:2,rtiDeadlineDecisionVersion:capability},state:{rti:[rti],document:[]}};
 const sandbox={crypto:{randomUUID:()=> 'request-fixture'},document};vm.runInNewContext(fs.readFileSync(require.resolve('../app/gestao-workflow.js'),'utf8'),sandbox);
 const ui=sandbox.PiresGestaoWorkflow.create({document,getContext:()=>context,write:async(operation,payload)=>{writes.push(JSON.parse(JSON.stringify({operation,payload})));return {};},refresh:async()=>{}});
 assert.equal(ui.render(box,'rti-updates',{id:rti.id}),true);
 const walk=node=>[node,...(node.children||[]).flatMap(walk)],nodes=walk(box),form=nodes.find(x=>x.tag==='form'),fields=Object.fromEntries(nodes.filter(x=>x.name).map(x=>[x.name,x]));
 fields.evidence.value='JUSTIFICATIVA SOMENTE SINTÉTICA';
 return {context,rti,anchor,writes,fields,submit:()=>form.onsubmit({preventDefault(){}})};
}
test('deadline UI: absent or nonnumeric capability preserves due on ordinary follow-up',async()=>{
 for(const version of [undefined,0,'1',2]){const f=fixture(version);assert.equal(f.fields.due.disabled,true);assert.equal(f.fields.reviewDeadline.disabled,true);await f.submit();assert.equal(f.writes.length,1);assert.equal('due' in f.writes[0].payload,false);assert.equal('deadlineBasis' in f.writes[0].payload,false);}
});
test('deadline UI: explicit choice sends the displayed anchor and RTI version, never a later unseen basis',async()=>{
 const f=fixture();f.fields.reviewDeadline.checked=true;f.fields.reviewDeadline.onchange();f.fields.due.value='2027-03-01';
 f.context.state.rti=[{...f.rti,version:99,deadlineAnchor:{...f.anchor,date:'2026-11-03',executionVersion:12}}];
 await f.submit();assert.equal(f.writes.length,1);assert.equal(f.writes[0].payload.expectedVersion,7);assert.equal(f.writes[0].payload.due,'2027-03-01');assert.deepEqual(f.writes[0].payload.deadlineBasis,f.anchor);assert.equal('reviewDeadline' in f.writes[0].payload,false);
});
test('deadline UI: no explicit choice does not resolve deadline review or resend an existing due',async()=>{
 const f=fixture();assert.equal(f.fields.reviewDeadline.checked,false);await f.submit();assert.equal(f.writes.length,1);assert.equal('due' in f.writes[0].payload,false);assert.equal('deadlineBasis' in f.writes[0].payload,false);
});
test('deadline UI: missing anchor, closed RTI, revoked capability or empty due cannot send a new decision',async()=>{
 for(const options of [{declared:false},{closed:true},{}]){const f=fixture(1,options);f.fields.reviewDeadline.checked=true;if(!options.declared&&!options.closed)f.context.capabilities.rtiDeadlineDecisionVersion=0;await f.submit();assert.equal(f.writes.length,0);}
 const f=fixture();f.fields.reviewDeadline.checked=true;f.fields.reviewDeadline.onchange();f.fields.due.value='';await f.submit();assert.equal(f.writes.length,0);
});
test('deadline UI: legacy follow-up keeps its manual form without fabricating an inspection basis',async()=>{
 const f=fixture(0,{legacy:true});assert.equal(f.fields.reviewDeadline,undefined);assert.equal(f.fields.due.disabled,false);await f.submit();assert.equal(f.writes.length,1);assert.equal(f.writes[0].payload.due,'2027-02-01');assert.equal('deadlineBasis' in f.writes[0].payload,false);
});
