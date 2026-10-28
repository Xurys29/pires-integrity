import {fail,boundedJson,providerId} from './primitives.mjs';
const API='https://api.asaas.com/v3';
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)?v:null;
const status=v=>typeof v==='string'&&/^[A-Z_]{2,60}$/.test(v)?v:null;
function minor(v) {
  const s=String(v);if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s))fail('invalid_provider_amount',502);
  const [whole,fraction='']=s.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
function resource(v,type) {
  if(!providerId(v?.id,type)||!providerId(v.customer,'cus')||!status(v.status))fail('invalid_provider_snapshot',502);
  return {id:v.id,customer:v.customer,status:v.status,valueMinor:minor(v.value)};
}
export function projectPayment(v) {
  const p=resource(v,'pay');
  if(!providerId(v.subscription,'sub'))fail('payment_not_subscription',409);
  // Date-only official fields stay date-only. No fabricated paidAt or timezone/settlement inference.
  return {...p,subscription:v.subscription,dueDate:day(v.dueDate),paymentDate:day(v.paymentDate),
    clientPaymentDate:day(v.clientPaymentDate),confirmedDate:day(v.confirmedDate),
    creditDate:day(v.creditDate),estimatedCreditDate:day(v.estimatedCreditDate),
    deleted:v.deleted===true,financialEffects:false};
}
export function projectSubscription(v) {
  const p=resource(v,'sub');
  if(!status(v.cycle))fail('invalid_provider_cycle',502);
  return {...p,cycle:v.cycle,nextDueDate:day(v.nextDueDate),deleted:v.deleted===true,financialEffects:false};
}
export class AsaasReadOnly {
  constructor(key,fetcher=fetch){
    if(typeof key!=='string'||!key.startsWith('$aact_prod_')||/[\r\n\s]/.test(key))fail('asaas_configuration_missing',503);
    this.key=key;this.fetcher=fetcher;
  }
  async #get(path){
    if(!/^\/(payments\/pay_[A-Za-z0-9_-]+|subscriptions\/sub_[A-Za-z0-9_-]+(?:\/payments\?offset=\d+&limit=100)?)$/.test(path))fail('provider_path_denied',500);
    let r;
    try {r=await this.fetcher(API+path,{method:'GET',redirect:'error',headers:{access_token:this.key,accept:'application/json','User-Agent':'PiresIntegrity-Billing-Observe/1'},signal:AbortSignal.timeout(12000)});}
    catch{fail('provider_unavailable',503,60);}
    if(r.status===429){
      const header=r.headers.get('retry-after');
      let delay=header&&/^\d+$/.test(header)?Number(header):Math.ceil((Date.parse(header||'')-Date.now())/1000);
      if(!Number.isFinite(delay))delay=60;fail('provider_rate_limited',503,Math.max(60,Math.min(delay,86400)));
    }
    if(r.status===401||r.status===403)fail('provider_credentials_rejected',503);
    if(r.status===404)fail('provider_resource_not_found',404);
    if(r.status>=500)fail('provider_unavailable',503,60);
    if(!r.ok)fail('provider_request_rejected',502);
    return boundedJson(r,1048576);
  }
  async payment(id){if(!providerId(id,'pay'))fail('invalid_payment_id');return projectPayment(await this.#get('/payments/'+id));}
  async subscription(id){if(!providerId(id,'sub'))fail('invalid_subscription_id');return projectSubscription(await this.#get('/subscriptions/'+id));}
  async paymentsPage(id,offset=0){
    if(!providerId(id,'sub')||!Number.isSafeInteger(offset)||offset<0||offset>100000)fail('invalid_page');
    const v=await this.#get('/subscriptions/'+id+'/payments?offset='+offset+'&limit=100');
    if(!Array.isArray(v.data)||v.data.length>100||typeof v.hasMore!=='boolean')fail('invalid_provider_page',502);
    if(v.hasMore&&v.data.length===0)fail('invalid_provider_page',502);
    const rows=v.data.map(projectPayment);
    if(rows.some(p=>p.subscription!==id))fail('subscription_mismatch',502);
    const next=v.hasMore?offset+v.data.length:null;
    if(next!==null&&next>100000)fail('pagination_review_required',409);
    return {rows,next};
  }
  // No POST/PUT/DELETE method is implemented or accepted.
}


