(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PiresTeamModel=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const labels={registration:{active:'Cadastro ativo',inactive:'Cadastro inativo',pending:'Cadastro pendente'},availability:{available:'Disponível',assigned:'Alocado',unavailable:'Indisponível'},verification:{not_informed:'Não informado',pending:'Pendente de conferência',checked:'Conferido',rejected:'Recusado'},technical:{not_verified:'Não verificada',in_review:'Em análise',verified:'Verificada',restricted:'Restrita'},access:{not_created:'Acesso não criado',created:'Usuário criado · ativação pendente',invite_pending:'Convite pendente',active:'Ativado · login não validado',login_validated:'Login validado',revoked:'Acesso revogado'},relationship:{employee:'Funcionário',contractor:'Prestador',exercise:'Participante do exercício'}};
 const text=v=>v===undefined||v===null||v===''?'Não informado':String(v);
 const label=(group,key)=>labels[group]?.[key]||'Não informado';
 const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const date=v=>v&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):'Não informado';
 function documents(p,today){
  const all=[...(p.documents||[]),...(p.qualifications||[])],end=new Date(today+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+30);const limit=end.toISOString().slice(0,10);
  const expired=all.filter(x=>x.valid_until&&x.valid_until<today).length,expiring=all.filter(x=>x.valid_until&&x.valid_until>=today&&x.valid_until<=limit).length;
  const pending=all.filter(x=>x.verification!=='checked'||!(x.file_id||x.proof_file_id)).length;
  const code=!all.length?'unknown':expired?'expired':pending?'pending':expiring?'expiring':'checked';
  return {code,pending,expired,expiring,count:all.length,label:{unknown:'Documentação: não informado',expired:'Documentação com vencimento',pending:'Documentação pendente',expiring:'Documentos a vencer',checked:'Documentos conferidos'}[code]};
 }
 function metrics(people,today){return {active:people.filter(p=>p.registration_state==='active').length,access:people.filter(p=>['active','login_validated'].includes(p.access.status)).length,pending:people.reduce((n,p)=>n+documents(p,today).pending,0),expiring:people.reduce((n,p)=>n+documents(p,today).expiring,0),unknown:people.filter(p=>documents(p,today).code==='unknown').length};}
 function filter(people,f,today){return people.filter(p=>(!f.search||norm(p.name).includes(norm(f.search)))&&(!f.job||p.job_title===f.job)&&(!f.level||(f.level==='unknown'?p.integrity_level===null:String(p.integrity_level)===f.level))&&(!f.qualification||p.qualifications.some(q=>q.catalog_id===f.qualification))&&(!f.docs||documents(p,today).code===f.docs)&&(!f.project||p.assignments.some(a=>a.project_id===f.project&&a.active)));}
 function role(p){return p.functional_role==='engineer_reviewer'?'Engenharia · revisão / assinatura PLH / emissão em exercício':'Inspetor · ficha própria e escopo atribuído';}
 return Object.freeze({labels,text,label,date,documents,metrics,filter,role});
});
