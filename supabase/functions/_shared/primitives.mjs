export class Fault extends Error {
  constructor(code, status=400, retrySeconds=null) { super(code); this.code=code; this.status=status; this.retrySeconds=retrySeconds; }
}
export const fail=(code,status=400,retry=null)=>{throw new Fault(code,status,retry);};
export const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const providerId=(value,kind)=>typeof value==='string'&&new RegExp('^'+kind+'_[A-Za-z0-9_-]{1,180}$').test(value);
export const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
export function json(status,value,headers={}) {
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
}
export async function boundedJson(source,maxBytes=65536) {
  if(!source.body)fail('body_required');
  const length=source.headers.get('content-length');
  if(length && Number(length)>maxBytes)fail('body_too_large',413);
  const reader=source.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('body_too_large',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch(e){if(e instanceof Fault)throw e;fail('invalid_json');}finally{reader.releaseLock();}
}
export async function sha256(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export async function sameSecret(received,expected) {
  if(typeof received!=='string'||received.length>512||typeof expected!=='string'||expected.length<32)return false;
  const a=await sha256(received),b=await sha256(expected);let different=0;
  for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);
  return different===0;
}
export function responseError(error,headers={}) {
  return json(error instanceof Fault?error.status:500,{error:error instanceof Fault?error.code:'internal_error',financialEffects:false},headers);
}


