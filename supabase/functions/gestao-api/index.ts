import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { createGestaoHandler } from "../_shared/gestao-api-core.mjs";
import { readXlsx } from "../_shared/xlsx-reader.mjs";
import { validateDocument, validatePhoto } from "../_shared/document-original.mjs";
// Only the three user-authorized original files; verified to contain no URLs or credentials.
import preparedSources from "../_shared/prepared-documents.private.json" with { type: "json" };
import { preparedReader } from "../_shared/prepared-originals.mjs";
import preparedLineList from "../_shared/perenco-line-list.private.json" with { type: "json" };

// Managed server variables only. No configuration value or key is embedded here.
const url = Deno.env.get("SUPABASE_URL") || "";
const publicKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
// Non-secret deployment target already confirmed for this application. A shared
// project override must match it exactly; never widen CORS to another origin.
const approvedAppOrigin = "https://app.piresintegridade.com.br";
const configuredAppOrigin = Deno.env.get("APP_ORIGIN") || approvedAppOrigin;
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const handler = createGestaoHandler({
  appOrigin: configuredAppOrigin === approvedAppOrigin ? approvedAppOrigin : "",
  createUserClient(token: string) {
    if (!url || !publicKey) throw Error("Server configuration unavailable");
    return createClient(url, publicKey, { ...options, global: { headers: { Authorization: "Bearer " + token } } });
  },
  createServiceClient() {
    const serverKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serverKey) throw Error("Server configuration unavailable");
    return createClient(url, serverKey, options);
  },
  readXlsx,
  validateDocument,
  validatePhoto,
  preparedSources: preparedSources.map(({id,name}) => ({id,name})),
  readPreparedSource: preparedReader(preparedSources),
  preparedLineList,
});
Deno.serve(handler);
