import {config} from '../_shared/config.mjs';
import {Backend} from '../_shared/backend.mjs';
import {receiveWebhook} from '../_shared/webhook.mjs';
import {responseError} from '../_shared/primitives.mjs';
Deno.serve(async request=>{try{const cfg=config(Deno.env);return await receiveWebhook(request,cfg,new Backend(cfg));}catch(error){return responseError(error);}});


