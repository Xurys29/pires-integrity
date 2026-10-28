(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoConnected = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const READ = /^(status|tenants|companies|companies\/[a-f0-9-]{36}\/(state|history\/[a-f0-9-]{36}|book\/[a-f0-9-]{36}|reports\/(system|campaign)\/[a-f0-9-]{36}|sources\/[a-z0-9-]+|execution(?:\/[a-f0-9-]{36})?))$/i;
  const WRITE = /^(companies|sources(?:\/reference)?|import\/(preview|commit)|companies\/[a-f0-9-]{36}\/(hierarchy|assets|contracts|campaigns|inspections|lvts|lvt-items|photos|findings|rtis|documents|relationships|field-lvts|field-items|execution-(assign|start|save|submit)|rti-updates|inspection-updates|asset-register|asset-operation|asset-links|measurements|certificates|classifications|nr13-assess|perenco-line-list|perenco-tq-book|deadlines|project-create|project-update|project-preview|project-scope|project-plan|project-event|project-snapshot|project-snapshot-get))$/i;
  function failure(message, code, status) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }
  function isEnabled(config) {
    return config?.mode === "connected" && config?.gestao?.backend === "supabase";
  }
  // Screen review uses the application's existing account/licensing endpoints.
  // It deliberately exposes no operational API, upload or persistence method.
  function createAccount(config, dependencies = {}) {
    if (config?.mode !== "connected") return null;
    const cloudApi = dependencies.cloudApi || root.PiresCloud,
      sdkFactory = dependencies.sdkFactory || root.PiresSupabase?.createClient;
    if (typeof cloudApi?.create !== "function" || typeof sdkFactory !== "function")
      throw failure("A autenticação do aplicativo está indisponível.", "configuration_unavailable", 503);
    const cloud = cloudApi.create(config, sdkFactory);
    if (!cloud.configured)
      throw failure("Use a configuração de acesso existente do aplicativo.", "configuration_unavailable", 503);
    async function user() {
      const current = await cloud.user();
      if (!current) return null;
      if (!UUID.test(current.id || "") || !current.email_confirmed_at || current.is_anonymous === true)
        throw failure("Use uma conta confirmada do aplicativo.", "auth_required", 401);
      return current;
    }
    async function companies() {
      if (!await user()) throw failure("Entre com sua conta do aplicativo.", "auth_required", 401);
      const rows = await cloud.companies();
      if (!Array.isArray(rows) || rows.some((row) => !UUID.test(row?.id || "") || typeof row.name !== "string" || !row.name.trim()) ||
          new Set(rows.map((row) => row.id)).size !== rows.length)
        throw failure("Não foi possível confirmar as empresas de acesso.", "invalid_tenants", 502);
      return rows.map(({ id, name }) => ({ id, name }));
    }
    async function access(id) {
      if (!UUID.test(id || "")) throw failure("Selecione a empresa de acesso.", "tenant_required", 400);
      if (!await user()) throw failure("Entre com sua conta do aplicativo.", "auth_required", 401);
      const grant = await cloud.requireAccess(id, true);
      if (grant.allowed !== true || grant.company_id !== id || grant.company_role === "client")
        throw failure("Acesso indisponível para esta conta e empresa.", "access_denied", 403);
      return grant;
    }
    return Object.freeze({
      config: cloud.config,
      user, companies, access,
      signIn: async (email, password) => { await cloud.signIn(email, password); return user(); },
      signOut: () => cloud.signOut(),
      subscribe: typeof cloud.subscribe === "function" ? (callback) => cloud.subscribe(callback) : undefined,
    });
  }
  function create(config, dependencies = {}) {
    if (!isEnabled(config)) return null;
    const cloudApi = dependencies.cloudApi || root.PiresCloud,
      sdkFactory = dependencies.sdkFactory || root.PiresSupabase?.createClient,
      fetcher = dependencies.fetch || root.fetch?.bind(root);
    if (typeof cloudApi?.create !== "function" || typeof sdkFactory !== "function" || typeof fetcher !== "function")
      throw failure("Serviço conectado indisponível. A configuração local não será usada automaticamente.", "configuration_unavailable", 503);
    let client;
    const cloud = cloudApi.create(config, (...args) => {
      client = sdkFactory(...args);
      return client;
    });
    if (!cloud.configured || !client?.auth?.getSession)
      throw failure("Sessão do aplicativo indisponível.", "configuration_unavailable", 503);
    const settings = cloud.config,
      endpoint = settings.supabaseUrl + "/functions/v1/gestao-api/";
    let tenant = null, tenantRevision = 0;
    function setTenant(id) {
      if (id !== null && !UUID.test(id || ""))
        throw failure("Selecione uma empresa de acesso válida.", "invalid_tenant", 400);
      if (tenant !== id) tenantRevision++;
      tenant = id;
    }
    function checkTenant(route, revision, write) {
      if (route !== "status" && route !== "tenants" && revision !== tenantRevision)
        throw failure(write
          ? "A operação foi concluída na empresa de acesso anterior. Selecione-a para conferir antes de repetir."
          : "A empresa de acesso foi alterada. Consulte novamente a seleção atual.", "tenant_changed", 409);
    }
    async function response(route, body, original) {
      const write = body !== undefined || original !== undefined;
      if (!(original && ["sources/document", "sources/photo"].includes(route)) && !(write ? WRITE : READ).test(route))
        throw failure("Esta ação ainda não está disponível na Gestão conectada.", "unsupported_operation", 501);
      if (write && route === "sources" && !/\.xlsx$/i.test(body?.name || ""))
        throw failure("A importação de listas aceita somente XLSX. Use o vínculo documental para arquivar um PDF original sem interpretação automática.", "unsupported_format", 415);
      const publicRoute = route === "status" || route === "tenants",
        selectedTenant = tenant,
        revision = tenantRevision;
      if (!publicRoute && !selectedTenant)
        throw failure("Selecione a empresa de acesso antes de consultar ou cadastrar ativos.", "tenant_required", 400);
      const { data, error } = await client.auth.getSession();
      if (error || typeof data?.session?.access_token !== "string" || !data.session.access_token)
        throw failure("Entre com sua conta do aplicativo para continuar.", "auth_required", 401);
      const headers = {
        Authorization: "Bearer " + data.session.access_token,
        apikey: settings.publishableKey,
      };
      if (selectedTenant && route !== "tenants") headers["X-Pires-Tenant"] = selectedTenant;
      if (original) {
        headers["Content-Type"] = route === "sources/photo" ? (/\.png$/i.test(original.name) ? "image/png" : "image/jpeg") : /\.pdf$/i.test(original.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        headers["X-Pires-Source-Name"] = encodeURIComponent(original.name);
      } else if (write) headers["Content-Type"] = "application/json";
      let result;
      try {
        result = await fetcher(endpoint + route, {
          method: write ? "POST" : "GET",
          headers,
          credentials: "omit",
          ...(write ? { body: original || JSON.stringify(body) } : {}),
        });
      } catch {
        throw failure(write
          ? "Não foi possível confirmar a operação na Gestão conectada. Atualize a situação antes de repetir."
          : "Não foi possível acessar a Gestão conectada. Tente novamente mais tarde.", "service_unavailable", 503);
      }
      if (!result.ok) {
        let detail;
        try { detail = await result.json(); } catch { detail = null; }
        throw failure(
          typeof detail?.error === "string" ? detail.error : "A solicitação não foi concluída pela Gestão conectada.",
          result.status === 401 ? "auth_required" : detail?.code || "request_failed",
          result.status,
        );
      }
      checkTenant(route, revision, write);
      return result;
    }
    async function request(route, body) {
      const revision = tenantRevision, result = await response(route, body);
      let data;
      try { data = await result.json(); }
      catch { throw failure("Resposta inválida da Gestão conectada.", "invalid_response", 502); }
      checkTenant(route, revision, body !== undefined);
      return data;
    }
    async function tenants() {
      const rows = await request("tenants");
      if (!Array.isArray(rows) || rows.some((row) => !UUID.test(row?.id || "") || typeof row.name !== "string" || !row.name.trim()))
        throw failure("Não foi possível confirmar as empresas de acesso.", "invalid_tenants", 502);
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        throw failure("Lista de empresas de acesso inconsistente.", "invalid_tenants", 502);
      return rows.map((row) => ({ id: row.id, name: row.name }));
    }
    async function uploadDocument(file) {
      if (!file || typeof file.name !== "string" || !/\.(xlsx|pdf)$/i.test(file.name) || typeof file.arrayBuffer !== "function")
        throw failure("Anexe o arquivo original XLSX ou PDF.", "unsupported_format", 415);
      if (!Number.isInteger(file.size) || file.size < 1 || file.size > 32 * 1024 * 1024)
        throw failure("O documento original deve ter entre 1 byte e 32 MiB. Nenhuma extração automática será feita.", "invalid_source_size", 413);
      const revision = tenantRevision, result = await response("sources/document", undefined, file);
      let data;
      try { data = await result.json(); }
      catch { throw failure("Resposta inválida ao registrar o documento original.", "invalid_response", 502); }
      checkTenant("sources/document", revision, true);
      if (typeof data?.id !== "string" || !data.id) throw failure("A API não confirmou o identificador da fonte original.", "invalid_response", 502);
      return data;
    }
    async function uploadPhoto(file) {
      if (!file || typeof file.name !== "string" || !/\.(jpe?g|png)$/i.test(file.name) || typeof file.arrayBuffer !== "function")
        throw failure("Anexe a fotografia original JPEG ou PNG.", "unsupported_format", 415);
      if (!Number.isInteger(file.size) || file.size < 1 || file.size > 8 * 1024 * 1024)
        throw failure("A fotografia original deve ter entre 1 byte e 8 MiB.", "invalid_source_size", 413);
      const revision = tenantRevision, result = await response("sources/photo", undefined, file);
      let data;
      try { data = await result.json(); }
      catch { throw failure("Resposta inválida ao registrar a fotografia original.", "invalid_response", 502); }
      checkTenant("sources/photo", revision, true);
      if (typeof data?.id !== "string" || !data.id) throw failure("A API não confirmou a fonte da fotografia.", "invalid_response", 502);
      return data;
    }
    async function download(route) {
      if (!/^companies\/[a-f0-9-]{36}\/sources\/[a-z0-9-]+$/i.test(route))
        throw failure("Documento de origem inválido.", "invalid_source", 400);
      const revision = tenantRevision, result = await response(route),
        disposition = result.headers.get("Content-Disposition") || "";
      let name = "documento-original.xlsx";
      try {
        const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition),
          plain = /filename="?([^";]+)"?/i.exec(disposition);
        const candidate = encoded ? decodeURIComponent(encoded[1]) : plain?.[1];
        if (candidate && !/[\u0000-\u001f\u007f/\\]/.test(candidate)) name = candidate;
      } catch { /* Keep a safe fallback name for malformed download headers. */ }
      const blob = await result.blob();
      checkTenant(route, revision, false);
      return { blob, name };
    }
    return {
      config: settings, request, tenants, download, uploadDocument, uploadPhoto, setTenant,
      getTenant: () => tenant,
      signIn: (email, password) => cloud.signIn(email, password),
      signOut: async () => { await cloud.signOut(); setTenant(null); },
    };
  }
  return Object.freeze({ isEnabled, create, createAccount });
});
