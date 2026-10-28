// Local draft. Pure request handler: no SDK, environment, network, logging or credentials here.
// The factories must bind caller RPCs to the verified bearer. Only provider dispatch and
// pi_admin_mark_invite_sent may use the privileged factory.
export const MAX_ADMIN_BODY_BYTES = 16 * 1024;
export const INVITABLE_ROLES = Object.freeze(['admin', 'planner', 'inspector', 'assistant', 'client']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_HEADERS = new Set(['authorization', 'apikey', 'content-type', 'x-client-info']);
const ERRORS = {
  configuration_unavailable: [503, 'Administração indisponível: configuração pendente.'],
  origin_not_allowed: [403, 'Origem não autorizada.'],
  method_not_allowed: [405, 'Método não permitido.'],
  authentication_required: [401, 'Autenticação confirmada necessária.'],
  access_denied: [403, 'Acesso administrativo não autorizado.'],
  invalid_request: [400, 'Solicitação inválida.'],
  payload_too_large: [413, 'Solicitação excede o tamanho permitido.'],
  access_check_unavailable: [503, 'Não foi possível confirmar a autorização atual.'],
  operation_failed: [409, 'Operação não concluída. Confira o estado atual antes de tentar novamente.'],
  invite_dispatch_failed: [502, 'Convite não concluído. Revisão administrativa necessária antes de nova tentativa.'],
  invite_confirmation_failed: [502, 'O envio precisa de reconciliação administrativa. Não reenvie automaticamente.'],
};

function originOnly(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const raw = value.trim();
    const url = new URL(raw);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (![url.origin, `${url.origin}/`].includes(raw)) return null;
    return url.origin;
  } catch { return null; }
}

function configuredPublicKey(value) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key && !/[\s\u0000-\u001f\u007f]/.test(key) ? key : null;
}

// Presence is intentional: an invalid selected source must not silently fall
// through to a lower-priority key. This parses configuration, not key authenticity.
function selectPublicKey(get) {
  const explicit = get('PIRES_PUBLIC_KEY');
  if (explicit !== undefined) return configuredPublicKey(explicit);

  const injected = get('SUPABASE_PUBLISHABLE_KEYS');
  if (injected !== undefined) {
    if (typeof injected !== 'string') return null;
    try {
      const keys = JSON.parse(injected);
      if (!row(keys) || !Object.hasOwn(keys, 'default')) return null;
      return configuredPublicKey(keys.default);
    } catch { return null; }
  }

  const compatible = get('SUPABASE_PUBLISHABLE_KEY');
  if (compatible !== undefined) return configuredPublicKey(compatible);
  return configuredPublicKey(get('SUPABASE_ANON_KEY'));
}

/** Read configuration without providing a development credential or fallback origin. */
export function readAccessAdminConfig(env) {
  const get = typeof env === 'function' ? env : (key) => env?.[key];
  const url = originOnly(get('SUPABASE_URL'));
  const appOrigin = originOnly(get('PIRES_APP_ORIGIN'));
  const publicKey = selectPublicKey(get);
  const adminSecret = String(get('PIRES_ADMIN_SECRET') || '').trim();
  if (!url || !appOrigin || !publicKey || !adminSecret || publicKey === adminSecret) return null;
  return { url, appOrigin, publicKey, adminSecret };
}

function response(code, origin, data) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (code === 'ok') return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers });
  const [status, message] = ERRORS[code];
  if (status === 405) headers.Allow = 'POST, OPTIONS';
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), { status, headers });
}

async function readBody(request) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_ADMIN_BODY_BYTES)) {
    throw new Error('payload_too_large');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('invalid_request');
  }
  if (!request.body) throw new Error('invalid_request');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ADMIN_BODY_BYTES) {
        await reader.cancel();
        throw new Error('payload_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new Error('invalid_request'); }
}

function normalizedEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2 || parts[0].length > 64 ||
      parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..') ||
      parts[1].split('.').some((label) => label.length > 63)) return null;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email) ? email : null;
}

function validateAction(body) {
  const allowed = {
    list: ['action'],
    invite: ['action', 'email', 'company_id', 'role'],
    approve: ['action', 'user_id', 'company_id'],
    revoke: ['action', 'user_id', 'company_id'],
  };
  const keys = Object.hasOwn(allowed, body.action) ? allowed[body.action] : null;
  if (!keys || Object.keys(body).some((key) => !keys.includes(key))) return null;
  if (body.action === 'list') return { action: 'list' };
  if (typeof body.company_id !== 'string' || !UUID.test(body.company_id)) return null;
  const company_id = body.company_id.toLowerCase();
  if (body.action === 'invite') {
    const email = normalizedEmail(body.email);
    if (!email || !INVITABLE_ROLES.includes(body.role)) return null;
    return { action: 'invite', email, company_id, role: body.role };
  }
  if (typeof body.user_id !== 'string' || !UUID.test(body.user_id)) return null;
  return { action: body.action, company_id, user_id: body.user_id.toLowerCase() };
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  if (header.length > 8200) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
  return match?.[1] || null;
}

function row(value) { return value && typeof value === 'object' && !Array.isArray(value); }

// The SQL RPC is a purpose-built public DTO, never an Auth user object. Defense in
// depth avoids serializing credential fields even if that DTO is expanded later.
function publicDto(value) {
  if (Array.isArray(value)) return value.map(publicDto);
  if (!row(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|password|secret|api.?key|raw_.*meta_data|authorization)/i.test(key))
    .map(([key, child]) => [key, publicDto(child)]));
}

/**
 * Dependency injection keeps all local tests offline. Both factories are called
 * only after config, request and bearer validation. No caller claims are decoded.
 */
export function createAccessAdminHandler({ getConfig, createCaller, createPrivileged }) {
  return async (request) => {
    let config;
    try { config = readAccessAdminConfig(await getConfig()); } catch { /* fail closed */ }
    if (!config) return response('configuration_unavailable');
    const origin = request.headers.get('origin');
    if (origin !== config.appOrigin) return response('origin_not_allowed');
    if (request.method === 'OPTIONS') {
      const requested = (request.headers.get('access-control-request-headers') || '')
        .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (request.headers.get('access-control-request-method') !== 'POST' ||
          requested.some((item) => !ALLOWED_HEADERS.has(item))) return response('origin_not_allowed', origin);
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
        'Access-Control-Max-Age': '600',
        'Cache-Control': 'no-store',
        Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
      } });
    }
    if (request.method !== 'POST') return response('method_not_allowed', origin);
    const token = bearer(request);
    if (!token) return response('authentication_required', origin);
    let action;
    try { action = validateAction(await readBody(request)); }
    catch (error) { return response(error?.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_request', origin); }
    if (!action) return response('invalid_request', origin);

    let caller;
    try { caller = await createCaller(config, token); }
    catch { return response('access_check_unavailable', origin); }
    let user;
    try {
      const auth = await caller.auth.getUser(token);
      user = auth.data?.user;
      if (auth.error || !user || !UUID.test(user.id) || !user.email_confirmed_at || user.is_anonymous === true) {
        return response('authentication_required', origin);
      }
    } catch { return response('authentication_required', origin); }
    try {
      // Re-read current server policy on every operation; stale JWT metadata,
      // body role/company and even confirmed email cannot confer administration.
      const access = await caller.rpc('pi_access_status_v3', {p_company_id:action.company_id??null});
      if (access.error || !row(access.data)) return response('access_check_unavailable', origin);
      if (access.data.version !== 3 || access.data.license_scope !== 'company' || access.data.status !== 'active' || access.data.user_id !== user.id) return response('access_denied', origin);
      if (access.data.is_master !== true && !(action.action === 'invite' && action.role !== 'admin' && access.data.company_id === action.company_id && access.data.company_role === 'admin')) return response('access_denied', origin);
    } catch { return response('access_check_unavailable', origin); }

    if (action.action !== 'invite') {
      try {
        const name = action.action === 'list' ? 'pi_admin_dashboard_v3' : `pi_admin_${action.action}`;
        const args = action.action === 'list' ? {p_company_id:null} : { p_user_id: action.user_id, p_company_id: action.company_id };
        const result = await caller.rpc(name, args);
        if (result.error) return response('operation_failed', origin);
        if (action.action === 'list') {
          if (!row(result.data) || ['users', 'companies', 'invitations', 'activity'].some((key) => !Array.isArray(result.data[key]))) {
            return response('operation_failed', origin);
          }
          const data = Object.fromEntries(['users', 'companies', 'invitations', 'activity'].map((key) => [key, publicDto(result.data[key])]));
          return response('ok', origin, data);
        }
        return response('ok', origin, publicDto(result.data));
      } catch { return response('operation_failed', origin); }
    }

    let prepared;
    try {
      const result = await caller.rpc('pi_admin_prepare_invite', {
        p_email: action.email, p_company_id: action.company_id, p_role: action.role,
      });
      prepared = result.data;
      if (result.error || !row(prepared) || !UUID.test(prepared.invitation_id) ||
          prepared.email !== action.email || prepared.company_id !== action.company_id || prepared.role !== action.role) {
        return response('operation_failed', origin);
      }
      // Only the trusted SQL result can choose an in-app offer for an already
      // confirmed identity. No email is sent, identity changed or membership
      // activated; that user must explicitly accept after signing in.
      if (prepared.status === 'offered' && prepared.send_allowed === false &&
          prepared.existing_user === true && prepared.delivery === 'in_app') {
        return response('ok', origin, {
          invitation_id: prepared.invitation_id, email: prepared.email,
          company_id: prepared.company_id, role: prepared.role,
          status: 'offered', delivery: 'in_app',
        });
      }
      if (prepared.status !== 'prepared' || prepared.send_allowed !== true ||
          prepared.existing_user !== false || prepared.delivery !== 'email') return response('operation_failed', origin);
    } catch { return response('operation_failed', origin); }

    let privileged;
    let invitedUser;
    try {
      privileged = await createPrivileged(config);
      const sent = await privileged.auth.admin.inviteUserByEmail(prepared.email, {
        redirectTo: `${config.appOrigin}/`,
        // Hint only: the acceptance RPC matches the authenticated identity/email
        // to the invitation row; user-editable metadata never authorizes access.
        data: { invitation_id: prepared.invitation_id },
      });
      invitedUser = sent.data?.user;
      if (sent.error || !invitedUser || !UUID.test(invitedUser.id) || normalizedEmail(invitedUser.email) !== prepared.email) {
        return response('invite_dispatch_failed', origin);
      }
    } catch { return response('invite_dispatch_failed', origin); }
    try {
      const marked = await privileged.rpc('pi_admin_mark_invite_sent', {
        p_invitation_id: prepared.invitation_id, p_auth_user_id: invitedUser.id,
      });
      if (marked.error) return response('invite_confirmation_failed', origin);
    } catch { return response('invite_confirmation_failed', origin); }
    return response('ok', origin, {
      invitation_id: prepared.invitation_id, email: prepared.email,
      company_id: prepared.company_id, role: prepared.role, status: 'dispatched', delivery: 'email',
    });
  };
}

