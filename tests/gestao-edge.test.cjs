"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OWNER = "44444444-4444-4444-8444-444444444444";
const ASSET = "55555555-5555-4555-8555-555555555555";
const ORIGIN = "https://app.fixture.invalid";
const TOKEN = "fixtureHeader.fixturePayload.fixtureSignature";
const original = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);
const pdfOriginal = new TextEncoder().encode("%PDF-1.7\n% isolated original-only fixture; no technical contents\n%%EOF\n");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const workbook = {
  format: "xlsx", metadata: { readerVersion: "fixture" },
  sheets: [{ name: "Lista fixture ", maxRow: 2, maxColumn: 2, rows: [
    { row: 1, values: ["Empresa fixture"] }, { row: 2, values: ["TAG-FIXTURE", null] },
  ] }],
};
async function setup(options = {}) {
  const { createGestaoHandler } = await import("../supabase/functions/_shared/gestao-api-core.mjs");
  const events = [], files = new Map();
  let serviceClients = 0, accessCount = 0;
  const defaults = {
    id: USER, email: "operator@fixture.invalid", email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false,
  };
  const handler = createGestaoHandler({
    preparedSources: options.preparedSources,
    preparedLineList: options.preparedLineList,
    readPreparedSource: options.readPreparedSource,
    appOrigin: options.appOrigin === undefined ? ORIGIN : options.appOrigin,
    createUserClient(token) {
      events.push({ kind: "userClient", token });
      return {
        auth: { async getUser(jwt) {
          events.push({ kind: "getUser", jwt });
          if (options.authThrows) throw Error("private-server-detail");
          return options.auth || { data: { user: { ...defaults, ...options.user } }, error: null };
        } },
        async rpc(name, args) {
          events.push({ kind: "userRpc", name, args });
          if (name === "pi_my_company_access") return { data: options.tenants || [{ id: TENANT, name: "Tenant fixture" }], error: null };
          if (args.p_action === "access.get") {
            const grant = typeof options.grant === "function" ? options.grant(args.p_tenant, ++accessCount) : options.grant;
            return { data: { pilot: true, read: true, write: true, role: "admin", tenant: args.p_tenant, actorUserId: USER, ...grant }, error: options.accessError || null };
          }
          if (options.rpc) return options.rpc(name, args);
          return { data: { action: args.p_action, ...args.p_payload }, error: null };
        },
      };
    },
    createServiceClient() {
      serviceClients++;
      events.push({ kind: "serviceClient" });
      if (options.serviceThrows) throw Error("private-secret-that-must-not-leak");
      return {
        storage: { from(bucket) {
          assert.equal(bucket, "pi-gestao-sources");
          return {
            async upload(key, bytes, settings) {
              events.push({ kind: "upload", key, bytes: Uint8Array.from(bytes), settings });
              if (options.uploadError) return { error: options.uploadError };
              if (files.has(key)) return { error: { statusCode: "409", error: "Duplicate" } };
              files.set(key, Uint8Array.from(bytes));
              return { data: { path: key }, error: null };
            },
            async download(key) {
              events.push({ kind: "download", key });
              if (options.downloadError) return { data: null, error: options.downloadError };
              const data = options.downloadBytes || files.get(key);
              return data ? { data: new Blob([data]), error: null } : { data: null, error: { statusCode: "404" } };
            },
          };
        } },
        async rpc(name, args) {
          events.push({ kind: "serviceRpc", name, args });
          assert.equal(name, "pi_gestao_register_source");
          if (options.registerThrows) throw Error("private-network-registration-detail");
          if (options.registerError) return { data: null, error: options.registerError };
          const p = args.p_payload;
          return { data: { id: p.sha, sha: p.sha, name: p.name, format: p.workbook.format, metadata: p.workbook.metadata, sheets: p.workbook.sheets }, error: null };
        },
      };
    },
    readXlsx(bytes) {
      events.push({ kind: "parse", bytes: Uint8Array.from(bytes) });
      if (options.parseError) throw Error("private-parser-detail");
      return options.workbook || structuredClone(workbook);
    },
    validateDocument(bytes, metadata) {
      events.push({ kind: "validateDocument", bytes: Uint8Array.from(bytes), metadata });
      if (options.validateDocument) return options.validateDocument(bytes, metadata);
      if (options.validateDocumentError) throw Error("private-document-validator-detail");
      return options.documentEnvelope || {
        format: metadata.name.endsWith(".pdf") ? "document_pdf" : "document_xlsx", sheets: [],
        metadata: { readerVersion: "fixture-only", extraction: "not_performed", warnings: [] },
      };
    },
    validatePhoto(bytes, metadata) {
      events.push({ kind: "validatePhoto", bytes: Uint8Array.from(bytes), metadata });
      if (options.validatePhoto) return options.validatePhoto(bytes, metadata);
      if (options.validatePhotoError) throw Error("private-photo-validator-detail");
      return options.photoEnvelope || {
        format: /\.png$/i.test(metadata.name) ? "image_png" : "image_jpeg", sheets: [],
        metadata: { readerVersion: "fixture-only", extraction: "not_performed", width: 1, height: 1 },
      };
    },
  });
  async function send(route, settings = {}) {
    const headers = new Headers({ Origin: ORIGIN, Authorization: "Bearer " + TOKEN });
    if (settings.tenant !== null && !["status", "tenants"].includes(route)) headers.set("X-Pires-Tenant", settings.tenant || TENANT);
    if (settings.tenant && ["status", "tenants"].includes(route)) headers.set("X-Pires-Tenant", settings.tenant);
    const method = settings.method || (settings.body === undefined ? "GET" : "POST");
    if (settings.body !== undefined) headers.set("Content-Type", "application/json");
    for (const [key, value] of Object.entries(settings.headers || {})) {
      if (value === null) headers.delete(key); else headers.set(key, value);
    }
    const request = new Request("https://project.fixture.invalid/functions/v1/gestao-api/" + route, {
      method, headers,
      ...(settings.raw !== undefined ? { body: settings.raw } : settings.body !== undefined ? { body: JSON.stringify(settings.body) } : {}),
      ...(settings.raw instanceof ReadableStream ? { duplex: "half" } : {}),
    });
    const response = await handler(request);
    const data = response.headers.get("Content-Type")?.includes("application/json") ? await response.json() : null;
    return { status: response.status, data, response };
  }
  async function sendDocument(name, bytes, settings = {}) {
    return send("sources/document", { ...settings, method: "POST", raw: bytes, headers: {
      "Content-Type": name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Pires-Source-Name": encodeURIComponent(name),
      ...(settings.headers || {}),
    } });
  }
  async function sendPhoto(name, bytes, settings = {}) {
    return send("sources/photo", { ...settings, method: "POST", raw: bytes, headers: {
      "Content-Type": /\.png$/i.test(name) ? "image/png" : "image/jpeg",
      "X-Pires-Source-Name": encodeURIComponent(name),
      ...(settings.headers || {}),
    } });
  }
  return { send, sendDocument, sendPhoto, events, files, serviceCount: () => serviceClients };
}
const sourceBody = () => ({ name: "original fixture.xlsx", base64: Buffer.from(original).toString("base64") });
test('prepared references preserve master/pilot gates and original validator without exposing bytes in status',async()=>{
 const opts={preparedSources:[{id:'fixed',name:'original.pdf',base64:'never-expose'}],readPreparedSource:async()=>({name:'original.pdf',bytes:pdfOriginal,format:'document_pdf'})};
 const f=await setup(opts);const status=await f.send('status',{tenant:TENANT});assert.deepEqual(status.data.preparedSources,[{id:'fixed',name:'original.pdf'}]);
 const a=await f.send('sources/reference',{body:{referenceId:'fixed'}});assert.equal(a.status,200);assert.equal(a.data.id,hash(pdfOriginal));assert.ok(f.events.some(e=>e.kind==='validateDocument'));assert.ok(!f.events.some(e=>e.kind==='parse'));
 assert.equal((await f.send('sources/reference',{body:{referenceId:'fixed'}})).data.id,a.data.id);
 assert.equal((await f.send('sources/reference',{body:{referenceId:'fixed',url:'https://arbitrary.invalid'}})).status,400);
 assert.equal((await f.send('sources/reference',{body:{referenceId:'unknown'}})).status,400);
 const denied=await setup({...opts,grant:{pilot:false}});assert.equal((await denied.send('sources/reference',{body:{referenceId:'fixed'}})).status,403);assert.equal(denied.serviceCount(),0);
 const fail=await setup({...opts,readPreparedSource:async()=>{throw Error('private hash error');}});const failure=await fail.send('sources/reference',{body:{referenceId:'fixed'}});assert.equal(failure.status,502);assert.equal(fail.serviceCount(),0);assert.ok(!JSON.stringify(failure.data).includes('private hash'));
});

test("Edge exige origem configurada exata e preflight não cria clientes nem acessa dados", async () => {
  const h = await setup();
  const good = await h.send("companies", { method: "OPTIONS", headers: {
    "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,apikey,content-type,x-pires-tenant,x-pires-source-name",
  } });
  assert.equal(good.status, 204);
  assert.equal(good.response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(good.response.headers.get("Access-Control-Expose-Headers"), "Content-Disposition");
  assert.deepEqual(h.events, []);
  for (const origin of ["https://attacker.fixture.invalid", "null", null]) {
    const denied = await h.send("companies", { headers: { Origin: origin } });
    assert.equal(denied.status, 403);
    assert.equal(denied.response.headers.has("Access-Control-Allow-Origin"), false);
  }
  assert.equal((await h.send("companies", { method: "OPTIONS", headers: { "Access-Control-Request-Headers": "x-private-admin" } })).status, 403);
  assert.deepEqual(h.events, []);
  for (const appOrigin of ["", "*", "http://app.fixture.invalid", "https://app.fixture.invalid/path"]) {
    const invalid = await setup({ appOrigin });
    assert.equal((await invalid.send("status")).status, 503);
    assert.deepEqual(invalid.events, []);
  }
});

test("Edge verifica JWT com getUser por operação e recusa identidade anônima ou não confirmada", async () => {
  const h = await setup();
  for (const authorization of [null, "Bearer public-key", "Basic fixture", "Bearer a.b.c.extra"]) {
    assert.equal((await h.send("status", { headers: { Authorization: authorization } })).status, 401);
  }
  assert.deepEqual(h.events, []);
  for (const options of [
    { auth: { data: { user: null }, error: { message: "private-auth-detail" } } },
    { user: { email_confirmed_at: null } }, { user: { is_anonymous: true } }, { authThrows: true },
  ]) {
    const invalid = await setup(options), result = await invalid.send("companies");
    assert.equal(result.status, 401);
    assert.equal(invalid.events.some(e => e.kind.endsWith("Rpc")), false);
    assert.doesNotMatch(JSON.stringify(result.data), /private-auth-detail|private-server-detail/);
  }
  await h.send("companies");
  await h.send("companies");
  assert.equal(h.events.filter(e => e.kind === "getUser").length, 2);
  assert.ok(h.events.filter(e => e.kind === "getUser").every(e => e.jwt === TOKEN));
  assert.equal(h.serviceCount(), 0);
});

test("status sem tenant também exige par piloto SQL e tenants expõe somente pares permitidos", async () => {
  const h = await setup({ tenants: [{ id: TENANT, name: "Permitida" }, { id: OTHER, name: "Bloqueada" }],
    grant: tenant => tenant === OTHER ? { role: "client", read: false, write: false } : {},
  });
  const status = await h.send("status");
  assert.equal(status.status, 200);
  assert.deepEqual(status.data.capabilities, { workflowVersion: 2, xlsx: true, pdf: false, xls: false, operations: true, documentOriginals: true, photoOriginals: true, xlsxMaxBytes: 8 * 1024 * 1024, documentMaxBytes: 32 * 1024 * 1024, photoMaxBytes: 8 * 1024 * 1024, write: false });
  assert.equal(status.data.pilot, true);
  assert.equal(status.data.user_id, USER);
  assert.deepEqual(h.events.filter(e => e.kind === "userRpc").map(e => [e.name, e.args?.p_tenant]), [
    ["pi_my_company_access", undefined], ["pi_gestao_api", TENANT], ["pi_gestao_api", OTHER],
  ]);
  assert.equal((await h.send("status", { tenant: TENANT })).data.capabilities.write, true);
  assert.deepEqual((await h.send("tenants")).data, [{ id: TENANT, name: "Permitida" }]);
  assert.equal(h.serviceCount(), 0);
});

test("allowlist piloto é default deny inclusive masters, descoberta, upload e download", async () => {
  for (const role of ["admin", "master"]) {
    for (const pilot of [false, undefined, "true"]) {
      const h = await setup({ grant: { role, pilot } });
      for (const [route, settings] of [
        ["status", {}], ["status", { tenant: TENANT }], ["companies", {}],
        ["sources", { body: sourceBody() }], [`companies/${OWNER}/sources/${hash(original)}`, {}],
      ]) assert.equal((await h.send(route, settings)).status, 403, `${role}:${pilot}:${route}`);
      assert.deepEqual((await h.send("tenants")).data, []);
      assert.equal((await h.send("tenants", { tenant: TENANT })).status, 403);
      assert.equal(h.events.some(e => e.kind === "parse"), false);
      assert.equal(h.events.some(e => e.kind === "userRpc" && !["access.get", undefined].includes(e.args?.p_action)), false);
      assert.equal(h.serviceCount(), 0);
    }
  }
  const badDatabase = await setup({ accessError: { code: "42501", message: "private-denial" } });
  assert.equal((await badDatabase.send("status")).status, 403);
  assert.deepEqual((await badDatabase.send("tenants")).data, []);
});

test("tenant, proprietário, papel e ator são separados e verificados sem confiança em campos do cliente", async () => {
  const h = await setup();
  assert.equal((await h.send("companies", { tenant: null })).status, 400);
  assert.equal((await h.send("companies", { tenant: "Empresa pelo nome" })).status, 400);
  for (const grant of [{ tenant: OTHER }, { actorUserId: OTHER }, { read: false }, { role: "client" }]) {
    const invalid = await setup({ grant });
    assert.equal((await invalid.send("companies")).status, 403);
    assert.equal(invalid.events.filter(e => e.kind === "userRpc").length, 1);
    assert.equal(invalid.serviceCount(), 0);
  }
  for (const grant of [{ write: false }, { role: "planner", write: true }]) {
    const invalid = await setup({ grant });
    assert.equal((await invalid.send("companies", { body: { name: "Owner", source: "Fonte" } })).status, 403);
    assert.equal(invalid.events.some(e => e.kind === "userRpc" && e.args?.p_action === "owners.create"), false);
  }
  const hierarchy = await h.send(`companies/${OWNER}/hierarchy`, { body: { ownerId: OTHER, tenantId: OTHER, unit: "Unidade", system: "Sistema" } });
  assert.equal(hierarchy.data.ownerId, OWNER);
  const action = h.events.find(e => e.kind === "userRpc" && e.args.p_action === "hierarchy.create");
  assert.equal(action.args.p_tenant, TENANT);
  assert.equal(action.args.p_payload.ownerId, OWNER);
});

test("UUID de tenant é canonizado antes de autorização e caminho imutável da fonte", async () => {
  const h = await setup(), tenant = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const result = await h.send("sources", { tenant: tenant.toUpperCase(), body: sourceBody() });
  assert.equal(result.status, 200);
  assert.equal(h.events.find(e => e.kind === "userRpc").args.p_tenant, tenant);
  assert.equal(h.events.find(e => e.kind === "upload").key, `${tenant}/${hash(original)}/original.xlsx`);
});

test("roteamento operacional explícito usa JWT do usuário, IDs do caminho e mantém ações técnicas indisponíveis", async () => {
  const h = await setup();
  for (const [route, body, action] of [
    ["companies", undefined, "owners.list"], ["companies", { name: "Owner", source: "Fonte" }, "owners.create"],
    [`companies/${OWNER}/state`, undefined, "state.get"], [`companies/${OWNER}/assets`, { tag: "TAG" }, "assets.create"],
    [`companies/${OWNER}/history/${ASSET}`, undefined, "history.get"],
    [`companies/${OWNER}/book/${ASSET}`, undefined, "book.get"],
    [`companies/${OWNER}/reports/system/${ASSET}`, undefined, "reports.system"],
    [`companies/${OWNER}/reports/campaign/${OTHER}`, undefined, "reports.system"],
    ["import/preview", { companyId: OWNER, sourceId: "fixture" }, "imports.preview"],
    ["import/commit", { previewId: ASSET, confirm: true }, "imports.commit"],
  ]) {
    const result = await h.send(route, { body });
    assert.ok([200, 201].includes(result.status));
    assert.equal(result.data.action, action);
  }
  const preview = h.events.find(e => e.args?.p_action === "imports.preview");
  assert.equal(preview.args.p_payload.ownerId, OWNER);
  for (const [segment, action, body] of [
    ["contracts", "contracts.create", { name: "Contrato fonte fixture", modules: ["integridade"], assetIds: [ASSET], requestId: OTHER }],
    ["campaigns", "campaigns.create", { contractId: OTHER, module: "integridade", status: "rascunho", requestId: OTHER }],
    ["inspections", "inspections.create", { assetId: ASSET, campaignId: OTHER, type: "visual", status: "planejada", requestId: OTHER }],
    ["lvts", "lvts.create", { assetId: ASSET, inspectionId: OTHER, documentId: OTHER }],
    ["lvt-items", "lvt_items.create", { assetId: ASSET, lvtId: OTHER, itemKey: "1", sourceId: hash(original), locator: { sheet: "Aba fixture", row: 2 } }],
    ["photos", "photos.create", { assetId: ASSET, lvtItemId: OTHER, sourceId: hash(original), locator: { section: "Foto fixture" }, caption: "Foto fonte isolada" }],
    ["findings", "findings.create", { assetId: ASSET, lvtId: OTHER, sourceId: hash(original), locator: { sheet: "Aba fixture", row: 2 } }],
    ["rtis", "rtis.open", { documentId: OTHER, title: "RTI histórica fixture", assetId: null }],
    ["documents", "documents.create", { documentType: "rti", sourceId: hash(original), locator: { sheet: "Aba fixture", row: 2 }, openingEvidence: "Evidência fixture" }],
    ["relationships", "relationships.create", { fromId: ASSET, fromKind: "asset", toId: OTHER, toKind: "asset", relationType: "valvula_psv" }],
  ]) {
    const result = await h.send(`companies/${OWNER}/${segment}`, { body: { ...body, ownerId: OTHER } });
    assert.equal(result.status, 200, segment);
    const event = h.events.findLast(e => e.args?.p_action === action);
    assert.deepEqual(event.args, { p_tenant: TENANT, p_action: action, p_payload: { ...body, ownerId: OWNER } });
  }
  assert.equal((await h.send(`companies/${OWNER}/rtis/${OTHER}/close`, { body: {} })).status, 501);
  assert.equal((await h.send(`companies/${OWNER}/inspections/${OTHER}/approve`, { body: {} })).status, 501);
  assert.equal((await h.send(`companies/${OWNER}/assets/${ASSET}/classify`, { body: {} })).status, 501);
  assert.equal((await h.send(`companies/${OWNER}/constructor`, { body: {} })).status, 501);
  assert.equal((await h.send("import/preview", { body: { companyId: OWNER, ownerId: OTHER } })).status, 400);
  assert.equal((await h.send("companies", { method: "DELETE" })).status, 405);
  assert.equal(h.serviceCount(), 0);
});

test("relatório usa escopo canônico do caminho, exige piloto e preserva rascunho não emitível", async () => {
  const snapshot = { ownerId: OWNER, systemId: ASSET, canIssue: false, recordVersions: [{ id: OTHER, version: 1 }], items: [], photos: [] };
  const h = await setup({ rpc: async (_name, args) => {
    assert.equal(args.p_action, "reports.system");
    assert.equal(args.p_payload.ownerId, OWNER);
    return { data: snapshot, error: null };
  } });
  assert.deepEqual((await h.send(`companies/${OWNER}/reports/system/${ASSET}`)).data, snapshot);
  assert.deepEqual(h.events.find(e => e.args?.p_action === "reports.system").args.p_payload, { ownerId: OWNER, systemId: ASSET });
  assert.deepEqual((await h.send(`companies/${OWNER}/reports/campaign/${OTHER}`)).data, snapshot);
  assert.deepEqual(h.events.findLast(e => e.args?.p_action === "reports.system").args.p_payload, { ownerId: OWNER, campaignId: OTHER });
  assert.equal((await h.send(`companies/${OWNER}/reports/system/${ASSET}?ownerId=${OTHER}`)).status, 400);
  const denied = await setup({ grant: { pilot: false, role: "master" } });
  assert.equal((await denied.send(`companies/${OWNER}/reports/system/${ASSET}`)).status, 403);
  assert.equal(denied.events.some(e => e.args?.p_action === "reports.system"), false);
  const crossOwner = await setup({ rpc: async () => ({ data: null, error: { code: "P0001", message: "private-system-outside-owner" } }) });
  assert.equal((await crossOwner.send(`companies/${OWNER}/reports/system/${ASSET}`)).status, 400);
  assert.equal(h.serviceCount(), 0);
});

test("recomendação registrada retorna a RTI canônica da mesma transação sem nova criação ou atualidade inferida", async () => {
  const canonical = { finding: { id: ASSET }, rti: { id: OTHER, currentness: "unknown", status: "atualidade_desconhecida", sourceStatus: "ABERTA", sourceDate: "2020-01-01" } };
  const h = await setup({ rpc: async (_name, args) => {
    assert.equal(args.p_action, "findings.create");
    return { data: canonical, error: null };
  } });
  const body = { assetId: ASSET, lvtId: OTHER, description: "Achado fixture", recommendation: "Recomendação documental fixture", sourceId: hash(original), locator: { sheet: "Fonte fixture", row: 2 } };
  assert.deepEqual((await h.send(`companies/${OWNER}/findings`, { body })).data, canonical);
  assert.deepEqual(h.events.filter(e => e.kind === "userRpc" && e.args.p_action !== "access.get").map(e => e.args.p_action), ["findings.create"]);
  assert.equal(h.serviceCount(), 0);
  const noProof = await setup({ rpc: async () => ({ data: null, error: { code: "P0001", message: "private-domain-validation" } }) });
  const invalid = await noProof.send(`companies/${OWNER}/rtis`, { body: { title: "Sem fonte" } });
  assert.equal(invalid.status, 400);
  assert.doesNotMatch(JSON.stringify(invalid.data), /private-domain-validation/);
});

test("originais XLSX são parseados no servidor, hasheados e registrados por ingresso exclusivo", async () => {
  const h = await setup(), body = sourceBody();
  const result = await h.send("sources", { body });
  assert.equal(result.status, 200);
  const sha = hash(original), key = `${TENANT}/${sha}/original.xlsx`;
  assert.equal(result.data.id, sha);
  assert.deepEqual(result.data.sheets, workbook.sheets);
  assert.deepEqual(h.files.get(key), original);
  const upload = h.events.find(e => e.kind === "upload");
  assert.deepEqual(upload.settings, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: false });
  const registered = h.events.find(e => e.kind === "serviceRpc");
  assert.equal(registered.name, "pi_gestao_register_source");
  assert.equal(registered.args.p_tenant, TENANT);
  assert.equal(registered.args.p_actor, USER);
  assert.deepEqual(registered.args.p_payload.workbook, workbook);
  assert.equal(registered.args.p_payload.sha, sha);
  assert.equal(registered.args.p_payload.objectKey, key);
  assert.equal(h.events.some(e => e.kind === "userRpc" && e.args?.p_action === "sources.register"), false);
});

test("originais documentais binários usam validador isolado sem parser de listas nem conteúdo técnico inferido", async () => {
  for (const [name, bytes, format, extension, mime] of [
    ["LVT original fixture.xlsx", original, "document_xlsx", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["RTI original fixture.pdf", pdfOriginal, "document_pdf", "pdf", "application/pdf"],
  ]) {
    const h = await setup(), result = await h.sendDocument(name, bytes);
    assert.equal(result.status, 200);
    assert.equal(result.data.format, format);
    assert.deepEqual(result.data.sheets, []);
    assert.equal(result.data.metadata.extraction, "not_performed");
    assert.equal(h.events.filter(e => e.kind === "validateDocument").length, 1);
    assert.equal(h.events.some(e => e.kind === "parse"), false);
    const uploaded = h.events.find(e => e.kind === "upload");
    assert.equal(uploaded.key, `${TENANT}/${hash(bytes)}/original.${extension}`);
    assert.deepEqual(uploaded.settings, { contentType: mime, upsert: false });
    const registered = h.events.find(e => e.kind === "serviceRpc");
    assert.equal(registered.args.p_payload.name, name);
    assert.equal(registered.args.p_payload.workbook.format, format);
    assert.equal(h.events.some(e => ["rtis.open", "findings.create", "lvts.create", "documents.create"].includes(e.args?.p_action)), false);
    assert.equal((await h.sendDocument(name, bytes)).status, 200);
    assert.equal(h.files.size, 1);
    assert.equal(h.events.filter(e => e.kind === "download").length, 1);
  }
});

test("ingresso privado de foto usa validador próprio, hash imutável e limite de 8 MiB sem gerar item ou RTI", async () => {
  for (const [name, format, mime, extension] of [
    ["foto fixture.jpeg", "image_jpeg", "image/jpeg", "jpg"],
    ["foto fixture.png", "image_png", "image/png", "png"],
  ]) {
    const h = await setup(), bytes = Uint8Array.from([1, 2, 3]); // Validator is injected; no image validity is claimed here.
    const result = await h.sendPhoto(name, bytes);
    assert.equal(result.status, 200);
    assert.equal(result.data.format, format);
    assert.deepEqual(result.data.sheets, []);
    assert.equal(h.events.some(e => e.kind === "parse" || e.kind === "validateDocument"), false);
    assert.equal(h.events.filter(e => e.kind === "validatePhoto").length, 1);
    const upload = h.events.find(e => e.kind === "upload");
    assert.equal(upload.key, `${TENANT}/${hash(bytes)}/original.${extension}`);
    assert.deepEqual(upload.settings, { contentType: mime, upsert: false });
    assert.equal(h.events.some(e => ["lvt_items.create", "photos.create", "rtis.open"].includes(e.args?.p_action)), false);
  }
  for (const [settings, status] of [
    [{ headers: { "Content-Length": String(8 * 1024 * 1024 + 1) } }, 413],
    [{ headers: { "Content-Type": "application/pdf" } }, 415],
    [{ headers: { "X-Pires-Source-Name": "foto.svg" } }, 415],
  ]) {
    const h = await setup();
    assert.equal((await h.sendPhoto("foto.png", Uint8Array.from([1, 2, 3]), settings)).status, status);
    assert.equal(h.serviceCount(), 0);
    assert.equal(h.events.some(e => e.kind === "validatePhoto"), false);
  }
  const invalid = await setup({ validatePhotoError: true });
  const result = await invalid.sendPhoto("fixture.png", Uint8Array.from([1, 2, 3]));
  assert.equal(result.status, 400);
  assert.doesNotMatch(JSON.stringify(result.data), /private-photo-validator-detail/);
  assert.equal(invalid.serviceCount(), 0);
  const unauthorized = await setup({ grant: { pilot: false, role: "master" } });
  assert.equal((await unauthorized.sendPhoto("fixture.png", Uint8Array.from([1, 2, 3]))).status, 403);
  assert.equal(unauthorized.events.some(e => e.kind === "validatePhoto"), false);
});

test("rota documental valida nome, MIME, limites do stream e envelope sem escrever em falhas", async () => {
  for (const settings of [
    { headers: { "X-Pires-Source-Name": "%E0%A4%A" } },
    { headers: { "X-Pires-Source-Name": encodeURIComponent("../secret.pdf") } },
    { headers: { "X-Pires-Source-Name": encodeURIComponent("bad\r\nname.pdf") } },
    { headers: { "X-Pires-Source-Name": encodeURIComponent("a".repeat(237) + ".pdf") } },
    { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } },
    { headers: { "Content-Type": "application/pdf; charset=utf-8" } },
    { headers: { "Content-Length": String(32 * 1024 * 1024 + 1) } },
    { headers: { "Content-Length": "0" } },
    { headers: { "Content-Length": "3" } },
  ]) {
    const h = await setup(), result = await h.sendDocument("fixture.pdf", pdfOriginal, settings);
    assert.ok([400, 413, 415].includes(result.status), JSON.stringify(settings));
    assert.equal(h.events.some(e => e.kind === "validateDocument"), false);
    assert.equal(h.serviceCount(), 0);
  }
  const streamed = await setup();
  const overflowing = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(32 * 1024 * 1024));
    controller.enqueue(new Uint8Array(1)); controller.close();
  } });
  assert.equal((await streamed.sendDocument("fixture.pdf", overflowing)).status, 413);
  assert.equal(streamed.serviceCount(), 0);
  for (const options of [
    { validateDocumentError: true },
    { documentEnvelope: { format: "document_pdf", sheets: [{ rows: [] }], metadata: { extraction: "not_performed" } } },
    { documentEnvelope: { format: "document_pdf", sheets: [], metadata: { extraction: "performed" } } },
    { documentEnvelope: { format: "xlsx", sheets: [], metadata: { extraction: "not_performed" } } },
  ]) {
    const h = await setup(options), result = await h.sendDocument("fixture.pdf", pdfOriginal);
    assert.equal(result.status, 400);
    assert.equal(h.serviceCount(), 0);
    assert.doesNotMatch(JSON.stringify(result.data), /private-document-validator-detail/);
  }
  const h = await setup();
  assert.equal((await h.send("sources", { body: { name: "fixture.pdf", base64: Buffer.from(pdfOriginal).toString("base64") } })).status, 415);
  assert.equal(h.serviceCount(), 0);
});

test("arquivo documental sintético de 27 MiB cabe sem aumentar o limite do importador XLSX", async () => {
  const h = await setup(), bytes = new Uint8Array(27 * 1024 * 1024);
  bytes.set(original);
  const result = await h.sendDocument("large isolated fixture.xlsx", bytes, { headers: { "Content-Length": String(bytes.byteLength) } });
  assert.equal(result.status, 200);
  assert.equal(result.data.format, "document_xlsx");
  assert.equal(h.events.some(e => e.kind === "parse"), false);
  assert.equal(h.events.find(e => e.kind === "serviceRpc").args.p_payload.size, bytes.length);
});

test("Edge executa o validador documental real e recusa ZIP renomeado ou com macros antes de armazenar", async () => {
  const { validateDocument } = await import("../supabase/functions/_shared/document-original.mjs");
  const { zipSync, strToU8 } = require("fflate");
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const parts = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
  };
  const zip = p => zipSync(Object.fromEntries(Object.entries(p).map(([name, text]) => [name, strToU8(text)])), { level: 0 });
  const bytes = zip(parts), h = await setup({ validateDocument });
  const result = await h.sendDocument("document fixture.xlsx", bytes);
  assert.equal(result.status, 200);
  assert.equal(result.data.format, "document_xlsx");
  assert.equal(result.data.metadata.extraction, "not_performed");
  assert.deepEqual(result.data.sheets, []);
  assert.equal(h.events.find(e => e.kind === "validateDocument").metadata.mime, mime);
  assert.deepEqual(h.files.get(`${TENANT}/${hash(bytes)}/original.xlsx`), bytes);
  for (const invalid of [zip({ "fixture.txt": "Not an Excel document" }), zip({ ...parts, "xl/vbaProject.bin": "fixture-only" })]) {
    const denied = await setup({ validateDocument });
    assert.equal((await denied.sendDocument("document fixture.xlsx", invalid)).status, 400);
    assert.equal(denied.serviceCount(), 0);
  }
  const body = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n";
  const pdf = new TextEncoder().encode(body + `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 2 >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF\n`);
  const pdfHandler = await setup({ validateDocument });
  const pdfResult = await pdfHandler.sendDocument("document fixture.pdf", pdf);
  assert.equal(pdfResult.status, 200);
  assert.equal(pdfResult.data.format, "document_pdf");
  assert.equal(pdfResult.data.metadata.extraction, "not_performed");
});

test("Edge executa o validador de foto real sem associar o PNG ao LVT automaticamente", async () => {
  const { validatePhoto } = await import("../supabase/functions/_shared/document-original.mjs");
  const { deflateSync } = require("node:zlib");
  function crc(bytes) {
    let result = 0xffffffff;
    for (const byte of bytes) {
      result ^= byte;
      for (let n = 0; n < 8; n++) result = result & 1 ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
    }
    return (result ^ 0xffffffff) >>> 0;
  }
  function chunk(name, content) {
    const data = Buffer.concat([Buffer.from(name, "ascii"), content]), prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
    prefix.writeUInt32BE(content.length); suffix.writeUInt32BE(crc(data));
    return Buffer.concat([prefix, data, suffix]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]);
  const h = await setup({ validatePhoto }), result = await h.sendPhoto("isolated photo fixture.png", bytes);
  assert.equal(result.status, 200);
  assert.equal(result.data.format, "image_png");
  assert.equal(result.data.metadata.width, 1);
  assert.equal(result.data.metadata.height, 1);
  assert.equal(result.data.metadata.extraction, "not_performed");
  assert.equal(h.events.some(e => e.args?.p_action === "photos.create" || e.args?.p_action === "rtis.open"), false);
  for (const [name, content] of [["renamed.jpg", bytes], ["script.png", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')]]) {
    const invalid = await setup({ validatePhoto });
    assert.equal((await invalid.sendPhoto(name, content)).status, 400);
    assert.equal(invalid.serviceCount(), 0);
  }
});

test("revogação após parse ou consulta bloqueia serviço privilegiado antes de upload e download", async () => {
  const upload = await setup({ grant: (_tenant, count) => count > 1 ? { pilot: false } : {} });
  assert.equal((await upload.send("sources", { body: sourceBody() })).status, 403);
  assert.equal(upload.events.some(e => e.kind === "parse"), true);
  assert.equal(upload.serviceCount(), 0);
  const raw = await setup({ grant: (_tenant, count) => count > 1 ? { pilot: false } : {} });
  assert.equal((await raw.sendDocument("fixture.pdf", pdfOriginal)).status, 403);
  assert.equal(raw.serviceCount(), 0);
  const sha = hash(original), source = { id: sha, sha, name: "fixture.xlsx", size: original.length, format: "xlsx", objectKey: `${TENANT}/${sha}/original.xlsx` };
  const download = await setup({ grant: (_tenant, count) => count > 1 ? { pilot: false } : {}, rpc: async () => ({ data: source, error: null }) });
  assert.equal((await download.send(`companies/${OWNER}/sources/${sha}`)).status, 403);
  assert.equal(download.serviceCount(), 0);
  const duringDownload = await setup({ downloadBytes: original, grant: (_tenant, count) => count > 2 ? { pilot: false } : {}, rpc: async () => ({ data: source, error: null }) });
  const deniedBytes = await duringDownload.send(`companies/${OWNER}/sources/${sha}`);
  assert.equal(deniedBytes.status, 403);
  assert.equal(duringDownload.events.some(e => e.kind === "download"), true);
  assert.equal(deniedBytes.response.headers.get("Content-Disposition"), null);
});

test("fontes falsas, formatos não suportados e parser inválido não armazenam dados", async () => {
  for (const extra of [{ workbook }, { objectKey: "foreign" }, { sha: "a".repeat(64) }, { actor: OTHER }]) {
    const h = await setup();
    assert.equal((await h.send("sources", { body: { ...sourceBody(), ...extra } })).status, 400);
    assert.equal(h.serviceCount(), 0);
    assert.equal(h.events.some(e => e.kind === "parse"), false);
  }
  for (const name of ["fonte.xls", "../fonte.xlsx", "fonte\n.xlsx"]) {
    const h = await setup();
    assert.equal((await h.send("sources", { body: { ...sourceBody(), name } })).status, 415);
    assert.equal(h.serviceCount(), 0);
  }
  for (const base64 of ["", "a", "AA!A", "AA==extra", "AAAA\n", "AB=="]) {
    const h = await setup();
    assert.equal((await h.send("sources", { body: { ...sourceBody(), base64 } })).status, 400);
    assert.equal(h.serviceCount(), 0);
  }
  const invalid = await setup({ parseError: true });
  const result = await invalid.send("sources", { body: sourceBody() });
  assert.equal(result.status, 400);
  assert.equal(invalid.serviceCount(), 0);
  assert.doesNotMatch(JSON.stringify(result.data), /private-parser-detail/);
});

test("reenvio reutiliza somente bytes idênticos e nunca sobrescreve original", async () => {
  const h = await setup();
  assert.equal((await h.send("sources", { body: sourceBody() })).status, 200);
  const before = Uint8Array.from(h.files.values().next().value);
  assert.equal((await h.send("sources", { body: sourceBody() })).status, 200);
  assert.equal(h.files.size, 1);
  assert.deepEqual(h.files.values().next().value, before);
  assert.equal(h.events.filter(e => e.kind === "download").length, 1);
  assert.equal(h.events.filter(e => e.kind === "serviceRpc").length, 2);
  assert.ok(h.events.filter(e => e.kind === "upload").every(e => e.settings.upsert === false));
  const corrupt = await setup({ uploadError: { statusCode: "409" }, downloadBytes: Uint8Array.from([1, 2]) });
  assert.equal((await corrupt.send("sources", { body: sourceBody() })).status, 409);
  assert.equal(corrupt.events.some(e => e.kind === "serviceRpc"), false);
});

test("falha de registro mantém o original e informa resultado parcial sem apagar ou aprovar", async () => {
  const h = await setup({ registerError: { code: "42501", message: "private-sql-detail" } });
  const result = await h.send("sources", { body: sourceBody() });
  assert.equal(result.status, 403);
  assert.equal(result.data.code, "source_registration_unconfirmed");
  assert.equal(result.data.originalStored, true);
  assert.equal(result.data.sourceHash, hash(original));
  assert.equal(h.files.size, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /private-sql-detail/);
});

test("resposta perdida da gravação não declara sucesso nem apaga o original já armazenado", async () => {
  const h = await setup({ registerThrows: true });
  const result = await h.send("sources", { body: sourceBody() });
  assert.equal(result.status, 503);
  assert.equal(result.data.code, "source_registration_unconfirmed");
  assert.equal(result.data.originalStored, true);
  assert.equal(result.data.sourceHash, hash(original));
  assert.equal(h.files.size, 1);
  assert.doesNotMatch(JSON.stringify(result.data), /private-network-registration-detail/);
});

test("download requer vínculo autorizado, chave de objeto exata e integridade do original", async () => {
  const sha = hash(original), key = `${TENANT}/${sha}/original.xlsx`;
  const source = { id: sha, sha, name: "original com espaço.xlsx", size: original.length, objectKey: key, format: "xlsx" };
  const h = await setup({ downloadBytes: original, rpc: async (_name, args) => ({ data: args.p_action === "sources.get" ? source : {}, error: null }) });
  const result = await h.send(`companies/${OWNER}/sources/${sha}`);
  assert.equal(result.status, 200);
  assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), original);
  assert.match(result.response.headers.get("Content-Disposition"), /original%20com%20espa%C3%A7o.xlsx/);
  assert.equal(h.events.find(e => e.args?.p_action === "sources.get").args.p_payload.ownerId, OWNER);
  const foreign = await setup({ rpc: async () => ({ data: { ...source, objectKey: `${OTHER}/${sha}/original.xlsx` }, error: null }) });
  assert.equal((await foreign.send(`companies/${OWNER}/sources/${sha}`)).status, 502);
  assert.equal(foreign.serviceCount(), 0);
  const wrongBytes = await setup({ downloadBytes: Uint8Array.from([5, 6]), rpc: async () => ({ data: source, error: null }) });
  assert.equal((await wrongBytes.send(`companies/${OWNER}/sources/${sha}`)).status, 502);
});

test("download de originais mantém MIME, extensão, hash e limite sem expor endereço público", async () => {
  for (const [format, name, bytes, extension, mime, limit] of [
    ["document_pdf", "RTI original fixture.pdf", pdfOriginal, "pdf", "application/pdf", 32 * 1024 * 1024],
    ["document_xlsx", "LVT original fixture.xlsx", original, "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 32 * 1024 * 1024],
    ["image_jpeg", "Foto original fixture.jpeg", original, "jpg", "image/jpeg", 8 * 1024 * 1024],
    ["image_png", "Foto original fixture.png", original, "png", "image/png", 8 * 1024 * 1024],
  ]) {
    const sha = hash(bytes), source = { id: sha, sha, name, format, size: bytes.length, objectKey: `${TENANT}/${sha}/original.${extension}` };
    const h = await setup({ downloadBytes: bytes, rpc: async () => ({ data: source, error: null }) });
    const result = await h.send(`companies/${OWNER}/sources/${sha}`);
    assert.equal(result.status, 200);
    assert.equal(result.response.headers.get("Content-Type"), mime);
    assert.equal(result.response.headers.get("Cache-Control"), "no-store");
    assert.equal(result.response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(result.response.headers.get("Content-Disposition"), /^attachment;/);
    assert.equal(result.response.headers.has("Location"), false);
    assert.deepEqual(new Uint8Array(await result.response.arrayBuffer()), bytes);
    for (const changed of [
      { size: limit + 1 }, { objectKey: `${OTHER}/${sha}/original.${extension}` },
      { format: "unknown" }, { name: "../original." + extension }, { size: 0 },
    ]) {
      const invalid = await setup({ rpc: async () => ({ data: { ...source, ...changed }, error: null }) });
      assert.equal((await invalid.send(`companies/${OWNER}/sources/${sha}`)).status, 502);
      assert.equal(invalid.serviceCount(), 0);
    }
  }
});

test("limites de corpo, JSON e erros de serviços são sanitizados", async () => {
  const h = await setup();
  assert.equal((await h.send("companies", { body: {}, headers: { "Content-Length": String(12 * 1024 * 1024 + 1) } })).status, 413);
  assert.equal((await h.send("companies", { method: "POST", raw: "not json", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await h.send("companies", { body: [] })).status, 400);
  assert.equal((await h.send("companies", { body: {}, headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal(h.events.some(e => e.args?.p_action === "owners.create"), false);
  const broken = await setup({ serviceThrows: true });
  const error = await broken.send("sources", { body: sourceBody() });
  assert.equal(error.status, 503);
  assert.doesNotMatch(JSON.stringify(error.data), /private-secret|stack|Error:/);
  const sql = await setup({ rpc: async () => ({ data: null, error: { code: "XX000", message: "private-internal-sql" } }) });
  const unavailable = await sql.send("companies");
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(JSON.stringify(unavailable.data), /private-internal-sql/);
});

test("lista preparada retoma lotes com RPC do usuário, para em erro e limita o trabalho", async () => {
  let calls=0;const preparedLineList={schema:'fixture'};
  const h=await setup({preparedLineList,rpc:async (_name,args)=>{assert.equal(args.p_action,'line_lists.prepare');assert.equal(args.p_payload.ownerId,OWNER);assert.deepEqual(args.p_payload.manifest,preparedLineList);return {data:++calls<18?{done:false,processed:calls*100}:{id:ASSET,importedCount:1380},error:null};}});
  const result=await h.send(`companies/${OWNER}/perenco-line-list`,{body:{}});assert.equal(result.status,200);assert.equal(calls,18);assert.equal(result.data.importedCount,1380);assert.equal(h.serviceCount(),0);
  let interrupted=0;const b=await setup({preparedLineList,rpc:async()=>++interrupted===3?{data:null,error:{code:'42501'}}:{data:{done:false},error:null}});
  assert.notEqual((await b.send(`companies/${OWNER}/perenco-line-list`,{body:{}})).status,200);assert.equal(interrupted,3);
  let bounded=0;const c=await setup({preparedLineList,rpc:async()=>{bounded++;return {data:{done:false},error:null};}});
  assert.equal((await c.send(`companies/${OWNER}/perenco-line-list`,{body:{}})).data.code,'import_in_progress');assert.equal(bounded,20);
});

test("limite conectado de 8 MB é aplicado antes de parse ou armazenamento do XLSX", async () => {
  const h = await setup();
  const tooLarge = "A".repeat(4 * Math.ceil((8 * 1024 * 1024) / 3) + 4);
  const result = await h.send("sources", { body: { name: "acima-do-limite.xlsx", base64: tooLarge } });
  assert.equal(result.status, 413);
  assert.match(result.data.error, /8 MB/);
  assert.equal(h.events.some(e => e.kind === "parse"), false);
  assert.equal(h.serviceCount(), 0);
});
