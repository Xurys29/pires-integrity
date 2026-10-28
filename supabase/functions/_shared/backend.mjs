import {boundedJson,fail,uuid} from './primitives.mjs';
const USER_RPC=new Set(['pi_billing_context','pi_billing_admin_bind','pi_billing_admin_queue','pi_billing_admin_retry',
  'pi_billing_claim','pi_billing_finish','pi_billing_admin_status','pi_billing_enqueue_reconciliation']);
export class Backend {
  constructor(cfg,fetcher=fetch){this.cfg=cfg;this.fetcher=fetcher;}
  async request(path,key,authorization,body) {
    let response;
    try {
      response=await this.fetcher(this.cfg.url+path,{method:body===undefined?'GET':'POST',redirect:'error',
        headers:{apikey:key,Authorization:authorization,'content-type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
    }catch{fail('backend_unavailable',503);}
    if(!response.ok){
      if(response.status===401||response.status===403)fail('access_denied',403);
      // Never surface raw SQL, provider response, identifiers or secret-bearing headers.
      if(response.status===400||response.status===409)fail('request_conflict_or_invalid',409);
      fail('backend_unavailable',503);
    }
    return boundedJson(response,262144);
  }
  async authenticate(request) {
    const authorization=request.headers.get('authorization')||'';
    if(!/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization))fail('authentication_required',401);
    const user=await this.request('/auth/v1/user',this.cfg.publicKey,authorization);
    if(!uuid(user?.id)||!user.email_confirmed_at)fail('verified_identity_required',403);
    return {authorization}; // never trust user_metadata or an actor supplied by the browser
  }
  async userRpc(actor,name,args={}) {
    if(!USER_RPC.has(name))fail('rpc_not_allowed',500);
    return this.request('/rest/v1/rpc/'+name,this.cfg.publicKey,actor.authorization,args);
  }
  async ingest(args) {
    if(!this.cfg.serviceKey)fail('backend_configuration_missing',503);
    return this.request('/rest/v1/rpc/pi_billing_ingest',this.cfg.serviceKey,'Bearer '+this.cfg.serviceKey,args);
  }
}


