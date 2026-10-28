// Supabase Edge boundary for the explicitly enabled operational pilot.
// User JWTs handle normal operations. Privileged access is confined to immutable
// originals and registration of the workbook parsed here, never client JSON.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA = /^[a-f0-9]{64}$/;
const BUCKET = "pi-gestao-sources";
const SOURCE_FORMATS = {
  xlsx: { extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  document_xlsx: { extension: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  document_pdf: { extension: "pdf", mime: "application/pdf" },
  image_jpeg: { extension: "jpg", mime: "image/jpeg" },
  image_png: { extension: "png", mime: "image/png" },
};
const MAX_BODY = 12 * 1024 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_DOCUMENT = 32 * 1024 * 1024;
const CREATE_ACTIONS = Object.freeze({
  "project-create": "projects.create", "project-update": "projects.update", "project-preview": "projects.preview", "project-scope": "projects.scope", "project-plan": "projects.plan", "project-event": "projects.event", "project-snapshot": "projects.snapshot", "project-snapshot-get": "projects.snapshot_get",
  hierarchy: "hierarchy.create", assets: "assets.create", contracts: "contracts.create",
  campaigns: "campaigns.create", inspections: "inspections.create", lvts: "lvts.create",
  findings: "findings.create", rtis: "rtis.open", documents: "documents.create",
  relationships: "relationships.create", "lvt-items": "lvt_items.create", photos: "photos.create",
  "field-lvts": "field_lvts.create", "field-items": "field_items.create", "rti-updates": "rtis.update",
  "inspection-updates": "inspections.update", "asset-register": "assets.register", "asset-operation": "assets.operation",
  "asset-links": "asset_links.create", measurements: "measurements.create", certificates: "certificates.create",
  classifications: "classifications.create", "nr13-assess": "nr13.assess", "perenco-tq-book": "perenco.tq_book", deadlines: "deadlines.create",
});
class ApiFailure extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}
/** @returns {never} */
function fail(status, code, message, extra) {
  throw new ApiFailure(status, code, message, extra);
}
function configuredOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
      return null;
    return url.origin;
  } catch { return null; }
}
function routeOf(request) {
  const url = new URL(request.url);
  if (url.search) fail(400, "invalid_route", "A rota não aceita parâmetros de consulta neste recorte.");
  const marker = "/gestao-api/", i = url.pathname.indexOf(marker);
  const route = i >= 0 ? url.pathname.slice(i + marker.length) : url.pathname.replace(/^\/+/, "");
  if (!route || /[\\%]/.test(route)) fail(400, "invalid_route", "Rota inválida.");
  return route;
}
async function jsonBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || ""))
    fail(415, "invalid_content_type", "Envie JSON para esta operação.");
  const length = request.headers.get("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    fail(413, "request_too_large", "Limite de 12 MB por requisição conectada.");
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
          await reader.cancel();
          fail(413, "request_too_large", "Limite de 12 MB por requisição conectada.");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail(400, "invalid_json", "JSON inválido."); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    fail(400, "invalid_json", "Envie um objeto JSON.");
  return body;
}
function rpcFailure(error) {
  if (error?.code === "42501") fail(403, "access_denied", "Acesso indisponível para esta operação e empresa.");
  if (error?.code === "0A000") fail(501, "unsupported_operation", "Esta ação ainda não está disponível no recorte conectado. Nenhum registro foi criado.");
  if (["23505", "40001", "40P01"].includes(error?.code))
    fail(409, "review_required", "Há conflito ou alteração concorrente. Consulte a situação e confira novamente antes de repetir.");
  if (["22023", "22P02", "23502", "23503", "23514", "P0001"].includes(error?.code))
    fail(400, "validation_failed", "Os dados não passaram na conferência. Confira fonte, vínculo, mapeamento e prévia.");
  fail(503, "database_unavailable", "Não foi possível confirmar a operação no banco. Consulte a situação antes de repetir.");
}
function sourceFormat(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 240 || /[\u0000-\u001f\u007f/\\]/.test(value)) return null;
  if (/\.xlsx$/i.test(value)) return "xlsx";
  if (/\.pdf$/i.test(value)) return "document_pdf";
  if (/\.jpe?g$/i.test(value)) return "image_jpeg";
  if (/\.png$/i.test(value)) return "image_png";
  return null;
}
async function documentBody(request, photo = false) {
  const encoded = request.headers.get("X-Pires-Source-Name") || "";
  let name;
  try {
    if (!encoded || encoded.length > 2880) throw Error("invalid name");
    name = decodeURIComponent(encoded).normalize("NFC").trim();
  } catch { fail(400, "invalid_source_name", "Informe um nome válido para o documento original."); }
  const extensionFormat = sourceFormat(name);
  const format = extensionFormat === "xlsx" ? "document_xlsx" : extensionFormat;
  if (!(photo ? ["image_jpeg", "image_png"] : ["document_xlsx", "document_pdf"]).includes(format))
    fail(415, "unsupported_format", photo ? "Fotografias originais aceitas: JPEG ou PNG." : "Originais documentais aceitos: XLSX ou PDF, sem extração automática.");
  if (request.headers.get("Content-Type") !== SOURCE_FORMATS[format].mime)
    fail(415, "invalid_content_type", "O tipo de conteúdo deve corresponder exatamente ao formato do original.");
  const limit = photo ? MAX_FILE : MAX_DOCUMENT;
  const limitMessage = photo ? "Fotografia original limitada a 8 MiB." : "Original documental limitado a 32 MiB.";
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > limit))
    fail(413, "request_too_large", limitMessage);
  // A single bounded destination avoids JSON/base64 strings and their copies.
  const bytes = new Uint8Array(declared === null ? limit : Number(declared));
  const reader = request.body?.getReader();
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (size + value.byteLength > bytes.byteLength) {
          await reader.cancel();
          fail(413, "request_too_large", limitMessage);
        }
        bytes.set(value, size); size += value.byteLength;
      }
    } finally { reader.releaseLock(); }
  }
  if (!size || (declared !== null && size !== Number(declared)))
    fail(400, "invalid_file", "O tamanho recebido do original não foi confirmado.");
  return { name, format, bytes: bytes.subarray(0, size) };
}
function decodeOriginal(base64) {
  if (typeof base64 !== "string" || !base64 || base64.length % 4 !== 0)
    fail(400, "invalid_file", "Documento original inválido.");
  if (base64.length > 4 * Math.ceil(MAX_FILE / 3))
    fail(413, "file_too_large", "Original limitado a 8 MB no modo conectado.");
  // No repeated capture groups: valid multi-megabyte files must not exhaust the
  // regular-expression stack before the bounded decoder/parser runs.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    fail(400, "invalid_file", "Documento original inválido.");
  let binary;
  try { binary = atob(base64); }
  catch { fail(400, "invalid_file", "Documento original inválido."); }
  if (!binary.length || binary.length > MAX_FILE)
    fail(413, "file_too_large", "Original limitado a 8 MB no modo conectado.");
  if (btoa(binary) !== base64) fail(400, "invalid_file", "Codificação do documento original inválida.");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function bytesOf(value, maxBytes = MAX_DOCUMENT) {
  if (Number(value?.byteLength ?? value?.size) > maxBytes)
    fail(502, "original_unavailable", "O documento armazenado excede o limite esperado para este original.");
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value && typeof value.arrayBuffer === "function") {
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (bytes.byteLength > maxBytes) fail(502, "original_unavailable", "O documento armazenado excede o limite esperado para este original.");
    return bytes;
  }
  fail(502, "original_unavailable", "Não foi possível conferir o documento original armazenado.");
}
async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (x) => x.toString(16).padStart(2, "0")).join("");
}
function duplicateObject(error) {
  return Number(error?.statusCode || error?.status) === 409 || error?.error === "Duplicate" || error?.code === "Duplicate";
}

export function createGestaoHandler({ appOrigin, createUserClient, createServiceClient, readXlsx, validateDocument, validatePhoto, preparedSources = [], readPreparedSource, preparedLineList }) {
  const allowedOrigin = configuredOrigin(appOrigin);
  return async function handle(request) {
    const origin = request.headers.get("Origin");
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Vary": "Origin",
    };
    if (allowedOrigin && origin === allowedOrigin) {
      headers["Access-Control-Allow-Origin"] = allowedOrigin;
      headers["Access-Control-Allow-Headers"] = "authorization,apikey,content-type,x-pires-tenant,x-pires-source-name";
      headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
      headers["Access-Control-Expose-Headers"] = "Content-Disposition";
    }
    const json = (status, body) => Response.json(body, { status, headers });
    try {
      if (!allowedOrigin) fail(503, "configuration_unavailable", "A origem autorizada da Gestão ainda não foi configurada.");
      if (origin !== allowedOrigin) fail(403, "origin_denied", "Origem não autorizada.");
      if (request.method === "OPTIONS") {
        const method = request.headers.get("Access-Control-Request-Method") || "GET";
        if (!["GET", "POST"].includes(method.toUpperCase())) fail(405, "method_not_allowed", "Método não permitido.");
        const requested = (request.headers.get("Access-Control-Request-Headers") || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
        if (requested.some((x) => !["authorization", "apikey", "content-type", "x-pires-tenant", "x-pires-source-name"].includes(x)))
          fail(403, "headers_denied", "Cabeçalhos não autorizados.");
        return new Response(null, { status: 204, headers });
      }
      if (!["GET", "POST"].includes(request.method)) fail(405, "method_not_allowed", "Método não permitido.");
      const bearer = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("Authorization") || "");
      if (!bearer || bearer[1].length > 16384) fail(401, "auth_required", "Entre com sua conta do aplicativo.");
      const client = createUserClient(bearer[1]);
      let auth;
      try { auth = await client.auth.getUser(bearer[1]); }
      catch { fail(401, "auth_required", "Não foi possível validar a sessão. Entre novamente."); }
      const user = auth?.data?.user;
      if (auth?.error || !UUID.test(user?.id || "") || !user.email_confirmed_at || user.is_anonymous === true)
        fail(401, "auth_required", "Use uma conta confirmada do aplicativo.");
      if (user.banned_until && Date.parse(user.banned_until) > Date.now())
        fail(403, "access_denied", "Acesso indisponível para esta conta.");
      const route = routeOf(request);
      const tenantValue = request.headers.get("X-Pires-Tenant");
      if (tenantValue && !UUID.test(tenantValue)) fail(400, "invalid_tenant", "Empresa de acesso inválida.");
      const tenant = tenantValue?.toLowerCase() || null;
      async function call(action, payload = {}, selectedTenant = tenant) {
        const result = await client.rpc("pi_gestao_api", { p_tenant: selectedTenant, p_action: action, p_payload: payload });
        if (result.error) rpcFailure(result.error);
        return result.data;
      }
      async function access(selectedTenant = tenant) {
        const grant = await call("access.get", {}, selectedTenant);
        if (grant?.tenant !== selectedTenant || grant?.actorUserId !== user.id || grant.pilot !== true || grant.read !== true || grant.role === "client")
          fail(403, "access_denied", "Acesso indisponível para esta empresa.");
        return grant;
      }
      async function permittedTenants() {
        const result = await client.rpc("pi_my_company_access");
        if (result.error) rpcFailure(result.error);
        if (!Array.isArray(result.data) || result.data.some((row) => !UUID.test(row?.id || "") || typeof row?.name !== "string" || !row.name.trim()))
          fail(502, "invalid_tenants", "Não foi possível conferir as empresas de acesso.");
        const rows = [];
        const ids = new Set();
        for (const row of result.data) {
          const id = row.id.toLowerCase();
          if (ids.has(id)) fail(502, "invalid_tenants", "Lista de empresas de acesso inconsistente.");
          ids.add(id);
          try { await access(id); rows.push({ id, name: row.name }); }
          catch (error) { if (!(error instanceof ApiFailure) || error.status !== 403) throw error; }
        }
        return rows;
      }
      if (route === "status" && request.method === "GET") {
        const grant = tenant ? await access() : null;
        if (!tenant && !(await permittedTenants()).length)
          fail(403, "access_denied", "O módulo ainda não está liberado para esta conta e empresa.");
        return json(200, {
          actor: user.email || user.id,
          user_id: user.id,
          mode: "supabase_integrado",
          tenant,
          pilot: true,
          preparedSources: preparedSources.map(({id,name}) => ({id,name})),
          capabilities: { workflowVersion: 2, xlsx: true, pdf: false, xls: false, operations: true, documentOriginals: true, photoOriginals: true, xlsxMaxBytes: MAX_FILE, documentMaxBytes: MAX_DOCUMENT, photoMaxBytes: MAX_FILE, write: grant?.write === true },
        });
      }
      if (route === "tenants" && request.method === "GET") {
        if (tenant) await access();
        const rows = await permittedTenants();
        return json(200, rows);
      }
      if (!tenant) fail(400, "tenant_required", "Selecione a empresa de acesso.");
      const grant = await access();
      const write = request.method === "POST";
      if (write && (grant.write !== true || !["admin", "master"].includes(grant.role)))
        fail(403, "write_denied", "Esta operação exige administração da empresa de acesso.");
      const rawDocument = write && route === "sources/document", rawPhoto = write && route === "sources/photo";
      const body = write && !rawDocument && !rawPhoto ? await jsonBody(request) : null;
      let service;
      const privileged = () => service || (service = createServiceClient());
      if (write && (route === "sources" || route === "sources/reference" || rawDocument || rawPhoto)) {
        let name, format, bytes;
        if (route === "sources/reference") {
          if (Object.keys(body).some(k=>k!=="referenceId") || !preparedSources.some(x=>x.id===body.referenceId) || typeof readPreparedSource!=="function")
            fail(400,"invalid_reference","Selecione uma referência de origem disponível.");
          try { ({name,format,bytes} = await readPreparedSource(body.referenceId)); }
          catch { fail(502,"reference_unavailable","Não foi possível conferir este original preparado. O envio local continua disponível."); }
          if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_DOCUMENT || !["document_pdf","document_xlsx"].includes(format) || sourceFormat(name)!==(format==="document_xlsx"?"xlsx":format))
            fail(502,"reference_unavailable","O original preparado não passou na conferência.");
        } else if (rawDocument || rawPhoto) ({ name, format, bytes } = await documentBody(request, rawPhoto));
        else {
          name = body.name;
          format = sourceFormat(name);
          if (format !== "xlsx") fail(415, "unsupported_format", "A importação estruturada aceita apenas XLSX. PDF ou XLSX documental usa o envio separado de original, sem OCR ou extração.");
          if (["workbook", "metadata", "format", "objectKey", "sha", "actor", "actorUserId", "user_id", "p_actor"].some((key) => Object.hasOwn(body, key)))
            fail(400, "server_fields", "O conteúdo extraído e a identidade da fonte são calculados pelo servidor.");
          bytes = decodeOriginal(body.base64);
        }
        let workbook;
        if (format === "xlsx") {
          try { workbook = await readXlsx(bytes); }
          catch { fail(400, "invalid_xlsx", "Não foi possível ler este XLSX dentro dos formatos e limites suportados."); }
          if (workbook?.format !== "xlsx" || !Array.isArray(workbook.sheets))
            fail(400, "invalid_xlsx", "O leitor não confirmou um XLSX suportado.");
        } else {
          const validator = rawPhoto ? validatePhoto : validateDocument;
          if (typeof validator !== "function")
            fail(503, "configuration_unavailable", "A validação de originais documentais ainda não está disponível.");
          try { workbook = await validator(bytes, { name, mime: SOURCE_FORMATS[format].mime }); }
          catch { fail(400, "invalid_document_original", "O documento original não passou na validação do formato. Nenhuma informação técnica foi extraída."); }
          if (workbook?.format !== format || !Array.isArray(workbook.sheets) || workbook.sheets.length || workbook.metadata?.extraction !== "not_performed")
            fail(400, "invalid_document_original", "O validador não confirmou um original documental sem extração.");
        }
        const definition = SOURCE_FORMATS[format];
        const sha = await sha256(bytes), objectKey = `${tenant}/${sha}/original.${definition.extension}`;
        const currentGrant = await access();
        if (currentGrant.write !== true || !["admin", "master"].includes(currentGrant.role))
          fail(403, "write_denied", "O acesso de gravação mudou. Confira sua liberação antes de repetir.");
        const storage = privileged().storage.from(BUCKET);
        const uploaded = await storage.upload(objectKey, bytes, { contentType: definition.mime, upsert: false });
        if (uploaded.error) {
          if (!duplicateObject(uploaded.error)) fail(503, "source_upload_unconfirmed", "Não foi possível confirmar o envio do original. Consulte a situação antes de repetir.");
          const previous = await storage.download(objectKey);
          if (previous.error) fail(502, "original_unavailable", "O original existente precisa ser conferido antes de reimportar.");
          const existing = await bytesOf(previous.data);
          if (existing.byteLength !== bytes.byteLength || await sha256(existing) !== sha)
            fail(409, "original_conflict", "O documento armazenado diverge do original recebido. Nenhum arquivo foi substituído.");
        }
        let result;
        try {
          result = await privileged().rpc("pi_gestao_register_source", {
            p_tenant: tenant, p_actor: user.id,
            p_payload: { sha, name, size: bytes.byteLength, objectKey, workbook },
          });
        } catch {
          fail(503, "source_registration_unconfirmed",
            "O original foi preservado, mas o cadastro da fonte não foi confirmado. Consulte a situação antes de repetir.", { sourceHash: sha, originalStored: true });
        }
        if (result.error) fail(result.error.code === "42501" ? 403 : 503, "source_registration_unconfirmed",
          "O original foi preservado, mas o cadastro da fonte não foi confirmado. Consulte a situação antes de repetir.", { sourceHash: sha, originalStored: true });
        return json(200, result.data);
      }
      const parts = route.split("/");
      if (parts[0] === "companies" && parts[1]) {
        const ownerId = parts[1].toLowerCase();
        if (!UUID.test(ownerId)) fail(400, "invalid_owner", "Empresa dona dos ativos inválida.");
        if (!write && parts.length === 4 && parts[2] === "sources") {
          const sourceId = parts[3];
          if (!SHA.test(sourceId)) fail(400, "invalid_source", "Documento de origem inválido.");
          const source = await call("sources.get", { ownerId, sourceId });
          const format = source?.format, definition = Object.hasOwn(SOURCE_FORMATS, format || "") ? SOURCE_FORMATS[format] : null;
          const maxBytes = ["document_xlsx", "document_pdf"].includes(format) ? MAX_DOCUMENT : MAX_FILE;
          if (!source || !definition || sourceFormat(source.name) !== (format === "document_xlsx" ? "xlsx" : format) || source.sha !== sourceId || source.objectKey !== `${tenant}/${sourceId}/original.${definition.extension}` || !Number.isSafeInteger(Number(source.size)) || Number(source.size) < 1 || Number(source.size) > maxBytes)
            fail(502, "original_unavailable", "Não foi possível conferir a identidade do original.");
          await access();
          const downloaded = await privileged().storage.from(BUCKET).download(source.objectKey);
          if (downloaded.error) fail(502, "original_unavailable", "Documento original indisponível.");
          const bytes = await bytesOf(downloaded.data, Number(source.size));
          if (bytes.byteLength !== Number(source.size) || await sha256(bytes) !== source.sha)
            fail(502, "original_integrity_failed", "O original armazenado não passou na conferência de integridade.");
          await access();
          return new Response(bytes, { status: 200, headers: {
            ...headers, "Content-Type": definition.mime,
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
          } });
        }
        if (!write && parts.length === 3 && parts[2] === "state") return json(200, await call("state.get", { ownerId }));
        if (!write && parts.length === 4 && parts[2] === "history" && UUID.test(parts[3]))
          return json(200, await call("history.get", { ownerId, assetId: parts[3].toLowerCase() }));
        if (!write && parts.length === 4 && parts[2] === "book" && UUID.test(parts[3]))
          return json(200, await call("book.get", { ownerId, assetId: parts[3].toLowerCase() }));
        if (!write && parts.length === 5 && parts[2] === "reports" && ["system", "campaign"].includes(parts[3]) && UUID.test(parts[4]))
          return json(200, await call("reports.system", { ownerId, [parts[3] === "system" ? "systemId" : "campaignId"]: parts[4].toLowerCase() }));
        if (write && parts.length === 3 && Object.hasOwn(CREATE_ACTIONS, parts[2]))
          return json(200, await call(CREATE_ACTIONS[parts[2]], { ...body, ownerId }));
        if (write && parts.length === 3 && parts[2] === "perenco-line-list" && preparedLineList) {
          if (Object.keys(body).some(k=>k!=="requestId")) fail(400,"server_fields","Esta organização usa a lista confirmada no servidor.");
          for (let batch=0;batch<20;batch++) {
            const progress=await call("line_lists.prepare", {ownerId,manifest:preparedLineList});
            if (progress?.done !== false) return json(200,progress);
          }
          fail(503,"import_in_progress","Parte da lista foi gravada. Repita a operação para retomar do último lote, sem duplicar linhas.");
        }
      }
      if (route === "companies") return json(write ? 201 : 200, await call(write ? "owners.create" : "owners.list", body || {}));
      if (write && route === "import/preview") {
        if (body.companyId && body.ownerId && body.companyId !== body.ownerId)
          fail(400, "owner_conflict", "A empresa cliente da prévia está inconsistente. Selecione seu ID novamente.");
        return json(200, await call("imports.preview", { ...body, ownerId: body.ownerId || body.companyId || null }));
      }
      if (write && route === "import/commit") return json(200, await call("imports.commit", body));
      fail(501, "unsupported_operation", "Esta ação ainda não está disponível no recorte conectado. Nenhum registro foi criado.");
    } catch (error) {
      if (error instanceof ApiFailure) return json(error.status, { error: error.message, code: error.code, ...error.extra });
      return json(503, { error: "O serviço não conseguiu confirmar a operação. Consulte a situação antes de repetir.", code: "service_unavailable" });
    }
  };
}
