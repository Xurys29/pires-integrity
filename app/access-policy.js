(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PiresAccess = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Presentation only: database policies and the administrative endpoint must
  // independently authorize every request using current server-side records.
  const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
  const TRIAL_US = BigInt(TRIAL_MS) * 1000n;
  const roles = ['admin', 'planner', 'inspector', 'assistant', 'client'];
  const statuses = ['active', 'pending', 'expired', 'revoked', 'unavailable'];
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const messages = Object.freeze({
    active: 'Acesso autorizado.',
    pending: 'Seu acesso aguarda convite e aprovação do administrador.',
    expired: 'A vigência desta empresa terminou. Solicite orientação ao administrador ou selecione outra empresa autorizada.',
    revoked: 'Seu acesso foi revogado pelo administrador.',
    unavailable: 'Não foi possível confirmar a autorização. Tente novamente mais tarde.'
  });
  function instant(value) {
    if (typeof value !== 'string') return NaN;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) return NaN;
    const [, year, month, day, hour, minute, second, , zone] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (Number(year) < 1000 || date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return NaN;
    if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return NaN;
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) return NaN;
    // PostgreSQL timestamps may carry microseconds. Preserve them so a trial
    // extended by even one microsecond is not accepted as exactly seven days.
    return BigInt(milliseconds) * 1000n + BigInt((match[7] || '').padEnd(6, '0').slice(3));
  }
  function unavailable() {
    return { version: 1, user_id: null, status: 'unavailable', is_master: false,
      company_id: null, company_role: null, activated_at: null, expires_at: null,
      server_now: null, allowed: false, can_admin: false, reason: 'unavailable', message: messages.unavailable };
  }
  function evaluate(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return unavailable();
    if (![1, 2, 3].includes(snapshot.version) || !uuid(snapshot.user_id) || !statuses.includes(snapshot.status) || typeof snapshot.is_master !== 'boolean' ||
        !(snapshot.company_id === null || uuid(snapshot.company_id)) || !(snapshot.company_role === null || roles.includes(snapshot.company_role)) ||
        typeof instant(snapshot.server_now) !== 'bigint') return unavailable();
    const start = snapshot.activated_at === null ? null : instant(snapshot.activated_at);
    const end = snapshot.expires_at === null ? null : instant(snapshot.expires_at);
    // V1 retains the exact 168-hour contract. V2 accepts the bounded period
    // returned by server-authorized planning/extensions, including denied states.
    const indefinite = snapshot.version === 3 && snapshot.license_scope === 'company' && snapshot.plan_kind === 'indefinite';
    if (indefinite ? (end !== null || (start !== null && typeof start !== 'bigint')) : ((start === null) !== (end === null) || (start !== null && (typeof start !== 'bigint' || typeof end !== 'bigint' || (snapshot.version === 1 ? end - start !== TRIAL_US : end <= start || (snapshot.version === 2 && end - start > 365n * 86400000000n)))))) return unavailable();
    if (snapshot.version === 3 && snapshot.license_scope !== 'company' && snapshot.status !== 'unavailable') return unavailable();
    if (snapshot.version === 3 && snapshot.company_role === 'client') return { ...unavailable(), user_id:snapshot.user_id };
    if (snapshot.company_role !== null && snapshot.company_id === null) return unavailable();
    const result = { version: snapshot.version, user_id: snapshot.user_id, status: snapshot.status,
      is_master: snapshot.is_master, company_id: snapshot.company_id, company_role: snapshot.company_role,
      activated_at: snapshot.activated_at, expires_at: snapshot.expires_at, server_now: snapshot.server_now, license_scope: snapshot.license_scope, plan_kind: snapshot.plan_kind,
      allowed: false, can_admin: false, reason: snapshot.status, message: messages[snapshot.status] };
    if (snapshot.status !== 'active') return result;
    if (snapshot.is_master) return { ...result, allowed: true, can_admin: true };
    if (!snapshot.company_id || !snapshot.company_role || start === null || (!indefinite && end === null)) return unavailable();
    const now = instant(snapshot.server_now);
    if (now < start) return unavailable();
    if (!indefinite && now >= end) return { ...result, status: 'expired', reason: 'expired', message: messages.expired };
    return { ...result, allowed: true, can_admin: snapshot.version >= 2 && snapshot.company_role === 'admin' };
  }
  return Object.freeze({ evaluate, TRIAL_MS });
});
