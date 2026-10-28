// LOCAL DRAFT — not deployed. Do not execute against production for local tests.
// The browser never receives PIRES_ADMIN_SECRET. No default credential or master
// bootstrap exists here. Required database RPCs must be reviewed/applied separately.
import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { createAccessAdminHandler } from '../_shared/access-admin-core.mjs';

const handler = createAccessAdminHandler({
  getConfig: () => (name: string) => Deno.env.get(name),
  createCaller: (config: { url: string; publicKey: string }, token: string) => createClient(
    config.url, config.publicKey,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  ),
  // Deliberately separate from the caller client: only provider invite and its
  // service-only dispatch confirmation use this credential. All administrative
  // decisions and mutations use the JWT-bound caller RPCs and SQL master checks.
  createPrivileged: (config: { url: string; adminSecret: string }) => createClient(
    config.url, config.adminSecret,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  ),
});

Deno.serve(handler);

