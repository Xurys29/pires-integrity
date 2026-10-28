const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
async function page(status){
 const elements={};for(const id of ['assetsModule','assetsModuleBadge','openManagement','managementPlanned','assetsModuleNote','home']){const classes=new Set();elements[id]={textContent:'',href:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},addEventListener:(name,fn)=>{elements[id][name]=fn;}};}
 const navigations=[],config={mode:'connected',gestao:{backend:'supabase'}},context={window:{PIRES_CONFIG:config,PiresGestaoConnected:{create:()=>({request:async()=>{if(status instanceof Error)throw status;return status;}})},PiresAccount:{guard:async()=>true},location:{assign:url=>navigations.push(url)},addEventListener:()=>{}},document:{getElementById:id=>elements[id]},MutationObserver:class{observe(){}}};
 vm.runInNewContext(fs.readFileSync('app/gestao-entry.js','utf8'),context);await new Promise(r=>setImmediate(r));return {elements,navigations};
}
test('home: piloto autorizado abre Gestão; conta sem acesso nunca recebe link liberado',async()=>{
 const granted=await page({capabilities:{operations:true}});assert.equal(granted.elements.assetsModuleBadge.textContent,'Disponível para sua conta');assert.equal(granted.elements.openManagement.classList.contains('hidden'),false);await granted.elements.openManagement.click({preventDefault(){}});assert.deepEqual(granted.navigations,['/gestao']);
 for(const status of [new Error('denied'),{capabilities:{operations:false}}]){const denied=await page(status);assert.equal(denied.elements.openManagement.classList.contains('hidden'),true);await denied.elements.openManagement.click({preventDefault(){}});assert.equal(denied.navigations.length,0);}
});
