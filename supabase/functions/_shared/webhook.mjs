import {fail,json,boundedJson,sameSecret,canonical,sha256,providerId} from './primitives.mjs';
const EVENTS=new Set(['PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE',
 'PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
 'PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
 'PAYMENT_RECEIVED_IN_CASH_UNDONE','SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED','SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED']);
export async function receiveWebhook(request,cfg,db) {
  if(request.method!=='POST')fail('method_not_allowed',405);
  if(typeof cfg.webhookToken!=='string'||cfg.webhookToken.length<32||cfg.webhookToken.length>255
    ||/\s/.test(cfg.webhookToken)||cfg.webhookToken===cfg.asaasKey)fail('webhook_configuration_missing',503);
  if(!await sameSecret(request.headers.get('asaas-access-token'),cfg.webhookToken))fail('unauthorized',401);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))fail('json_required',415);
  const e=await boundedJson(request,65536);
  if(typeof e?.id!=='string'||!/^evt_[A-Za-z0-9_&-]{1,180}$/.test(e.id)||!EVENTS.has(e.event))fail('unsupported_event',400);
  const type=e.event.startsWith('PAYMENT_')?'payment':'subscription',r=e[type];
  if(!providerId(r?.id,type==='payment'?'pay':'sub'))fail('invalid_resource');
  const projection={event:e.event,type,id:r.id,subscription:type==='subscription'?r.id:(providerId(r.subscription,'sub')?r.subscription:null)};
  // Minimal stable projection; never keep names, addresses, documents, emails or full payloads.
  for(const key of ['status','dueDate','paymentDate','clientPaymentDate','confirmedDate','creditDate','deleted','value']){
    const v=r[key];if(typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v))||(typeof v==='string'&&/^[A-Z0-9_.:-]{1,60}$/i.test(v)))projection[key]=v;
  }
  const result=await db.ingest({p_event_id:e.id,p_event:e.event,p_kind:type,p_resource_id:r.id,
    p_subscription:projection.subscription,p_fingerprint:await sha256(canonical(projection)),p_projection:projection});
  // A conflict has been durably quarantined; a lost response can safely be replayed.
  return json(200,{received:true,state:result.state,financialEffects:false});
}


