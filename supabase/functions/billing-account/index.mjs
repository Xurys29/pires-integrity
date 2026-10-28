import {config,userHeaders} from '../_shared/config.mjs';
import {Backend} from '../_shared/backend.mjs';
import {fail,json,boundedJson,exact,uuid,providerId,responseError} from '../_shared/primitives.mjs';
import {financialOperation} from '../_shared/commercial.mjs';
Deno.serve(async request=>{
 let headers={};
 try {
  const cfg=config(Deno.env);headers=userHeaders(request,cfg);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  const db=new Backend(cfg),actor=await db.authenticate(request),url=new URL(request.url);
  if(request.method==='GET'){
   if(url.searchParams.get('view')==='admin')return json(200,await db.userRpc(actor,'pi_billing_admin_status'),headers);
   const company=url.searchParams.get('company');if(!uuid(company))fail('company_required');
   return json(200,await db.userRpc(actor,'pi_billing_context',{p_company:company}),headers);
  }
  if(request.method!=='POST')fail('method_not_allowed',405);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('json_required',415);
  const b=await boundedJson(request,8192);
  if(['checkout','create-customer','create-subscription','cancel','refund','change-seats','enable-payments'].includes(b?.action))financialOperation();
  let name,args;
  if(b?.action==='bind'){
   if(!exact(b,['action','company','subscription','customer','payerKind','owner','quantity'])||!uuid(b.company)
    ||!providerId(b.subscription,'sub')||!providerId(b.customer,'cus')||!['CPF','CNPJ'].includes(b.payerKind)
    ||!Number.isInteger(b.quantity)||b.quantity<1||b.quantity>999||(b.payerKind==='CPF'&&(!uuid(b.owner)||b.quantity!==1))
    ||(b.payerKind==='CNPJ'&&b.owner!=null))fail('invalid_binding');
   name='pi_billing_admin_bind';args={p_company:b.company,p_subscription:b.subscription,p_customer:b.customer,p_kind:b.payerKind,p_owner:b.owner??null,p_quantity:b.quantity};
  }else if(b?.action==='reconcile'){
   if(!exact(b,['action','subscription','requestId'])||!providerId(b.subscription,'sub')||!uuid(b.requestId))fail('invalid_reconciliation');
   name='pi_billing_admin_queue';args={p_subscription:b.subscription,p_request:b.requestId};
  }else if(b?.action==='retry'){
   if(!exact(b,['action','jobId'])||!Number.isSafeInteger(b.jobId)||b.jobId<1)fail('invalid_job');
   name='pi_billing_admin_retry';args={p_job:b.jobId};
  }else fail('action_not_available',404);
  return json(200,await db.userRpc(actor,name,args),headers);
 }catch(error){return responseError(error,headers);}
});


