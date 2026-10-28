(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PiresTeamAPI=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 function create(config,deps={}){
  let client;const cloud=(deps.cloud||root.PiresCloud).create(config,(...args)=>{client=(deps.factory||root.PiresSupabase.createClient)(...args);return client;});
  let tenant=null,generation=0;
  function setTenant(id){if(id!==tenant)generation++;tenant=id;}
  function failure(error){const messages={42501:'Acesso negado para esta pessoa, organização ou informação restrita.',40001:'Esta ficha mudou. Atualize antes de salvar novamente.',23505:'Já existe um registro com esta identificação ou vigência.',23514:'Confira os campos e o escopo informado.',22023:'Confira os dados, o comprovante e a justificativa de conferência.'};const e=new Error(messages[error?.code]||'Não foi possível confirmar a operação. Atualize a tela antes de repetir.');e.code=error?.code;throw e;}
  async function call(action,payload={}){if(!tenant)throw Error('Selecione a organização de acesso.');const version=generation;const {data,error}=await client.rpc('pi_team_api',{p_tenant:tenant,p_action:action,p_payload:payload});if(error)failure(error);if(version!==generation)throw Error('A organização mudou durante a operação. Reabra a ficha no contexto correto.');return data;}
  async function organizations(){await cloud.requireUser?.();return cloud.companies();}
  async function upload(person,file,purpose){
   if(!file||file.size<1||file.size>8388608)throw Error('Escolha um arquivo de até 8 MiB.');
   const types={'pdf':'application/pdf','png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','txt':'text/plain'},mime=types[file.name.split('.').pop().toLowerCase()];
   if(!mime||purpose==='avatar'&&!mime.startsWith('image/'))throw Error('Formatos aceitos: PDF, JPEG, PNG ou TXT. Para fotos, JPEG ou PNG.');
   const version=generation,entry=await call('file.reserve',{professional_id:person,name:file.name,mime,byte_size:file.size,purpose});
   const {error}=await client.storage.from('pi-team-private').upload(entry.object_key,file,{contentType:mime,upsert:false});if(error)throw Error('O anexo não foi confirmado. Nenhum documento foi marcado como conferido.');
   if(version!==generation)throw Error('A organização mudou. Reabra a ficha para conferir o arquivo.');
   await call('file.complete',{professional_id:person,id:entry.id});return entry;
  }
  async function download(person,id){const version=generation,entry=await call('file.get',{professional_id:person,id});const {data,error}=await client.storage.from('pi-team-private').download(entry.object_key);if(error)failure(error);if(version!==generation)throw Error('A organização mudou.');return {blob:data,name:entry.name};}
  return {call,upload,download,organizations,setTenant,getTenant:()=>tenant,cloud,signIn:(email,password)=>cloud.signIn(email,password),signOut:async()=>{await cloud.signOut();setTenant(null);},user:()=>cloud.user(),subscribe:fn=>cloud.subscribe?.(fn)};
 }
 return Object.freeze({create});
});
