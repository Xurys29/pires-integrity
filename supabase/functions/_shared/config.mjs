import {fail} from './primitives.mjs';
export function config(env) {
  const project='seosxvydjvsulhcpljyy';
  const url=env.get('SUPABASE_URL');
  if(url!=='https://'+project+'.supabase.co')fail('unexpected_backend_project',503);
  if(env.get('PI_BILLING_MODE')!=='observe')fail('billing_disabled',503);
  const publicKey=env.get('SUPABASE_ANON_KEY');
  if(!publicKey)fail('backend_configuration_missing',503);
  return {url,publicKey,serviceKey:env.get('SUPABASE_SERVICE_ROLE_KEY'),
    asaasKey:env.get('ASAAS_API_KEY'),webhookToken:env.get('ASAAS_WEBHOOK_TOKEN'),
    appOrigin:'https://app.piresintegridade.com.br'};
}
export function userHeaders(request,cfg) {
  const origin=request.headers.get('origin');
  if(origin!==null && origin!==cfg.appOrigin)fail('origin_denied',403);
  return {'access-control-allow-origin':cfg.appOrigin,'vary':'Origin',
    'access-control-allow-headers':'authorization, apikey, content-type',
    'access-control-allow-methods':'GET, POST, OPTIONS'};
}


