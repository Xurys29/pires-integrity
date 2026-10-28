// One-time authorized provisioning completed. No administrative client remains.
Deno.serve(() => new Response(JSON.stringify({error:"provisioning_closed"}),{status:410,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}));
