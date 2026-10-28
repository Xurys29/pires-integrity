import {config,userHeaders} from '../_shared/config.mjs';
import {Backend} from '../_shared/backend.mjs';
import {AsaasReadOnly} from '../_shared/asaas.mjs';
import {Fault,fail,json,boundedJson,exact,responseError} from '../_shared/primitives.mjs';
Deno.serve(async request=>{
 let headers={};
 try{
  const cfg=config(Deno.env);headers=userHeaders(request,cfg);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')fail('method_not_allowed',405);
  const db=new Backend(cfg),actor=await db.authenticate(request);
  await db.userRpc(actor,'pi_billing_admin_status'); // live Master + session check before reading/using an API key
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('json_required',415);
  const body=await boundedJson(request,128);if(!exact(body,[]))fail('empty_object_required');
  const api=new AsaasReadOnly(cfg.asaasKey);
  const job=await db.userRpc(actor,'pi_billing_claim');
  if(!job||job.state!=='processing')return json(200,job??{state:'idle',financialEffects:false},headers);
  try{
   const subscription=await api.subscription(job.subscription);
   if(subscription.customer!==job.customer)fail('customer_mismatch',409);
   let snapshot=subscription;
   if(job.kind==='payment'){
    snapshot=await api.payment(job.resourceId);
    if(snapshot.subscription!==job.subscription)fail('subscription_mismatch',409);
    if(snapshot.customer!==job.customer)fail('customer_mismatch',409);
   }else if(job.kind==='scan'){
    const page=await api.paymentsPage(job.subscription,job.offset);
    if(page.rows.some(p=>p.customer!==job.customer))fail('customer_mismatch',409);
    // Stored cursor and payment jobs survive a worker restart; repeated enqueue is idempotent.
    await db.userRpc(actor,'pi_billing_enqueue_reconciliation',{p_job:job.jobId,p_lease:job.lease,p_payments:page.rows.map(p=>p.id),p_next:page.next});
   }
   const possible=[2990*job.quantity,5990*job.quantity];
   const reason=possible.includes(snapshot.valueMinor)?'observed_policy_pending':'amount_review';
   const result=await db.userRpc(actor,'pi_billing_finish',{p_job:job.jobId,p_lease:job.lease,p_state:'done',p_reason:reason,p_snapshot:snapshot,p_retry:null});
   return json(200,result,headers);
  }catch(error){
   const retryable=error instanceof Fault&&['provider_unavailable','provider_rate_limited','backend_unavailable'].includes(error.code);
   const safe=new Set(['provider_unavailable','provider_rate_limited','provider_credentials_rejected','provider_resource_not_found',
     'provider_request_rejected','invalid_provider_snapshot','invalid_provider_cycle','invalid_provider_amount','invalid_provider_page',
     'invalid_json','body_too_large','payment_not_subscription','subscription_mismatch','customer_mismatch','pagination_review_required','backend_unavailable']);
   const result=await db.userRpc(actor,'pi_billing_finish',{p_job:job.jobId,p_lease:job.lease,
    p_state:retryable?'retry':'review',p_reason:safe.has(error?.code)?error.code:'internal_error',p_snapshot:null,
    p_retry:error.retrySeconds??Math.min(3600,30*(2**job.attempts))});
   return json(200,result,headers);
  }
 }catch(error){return responseError(error,headers);}
});


