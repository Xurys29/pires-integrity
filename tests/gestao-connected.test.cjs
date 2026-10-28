"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Cloud = require("../app/cloud.js");
const Connected = require("../app/gestao-connected.js");

const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const ownerCompany = "44444444-4444-4444-8444-444444444444";
const config = {
  mode: "connected",
  supabaseUrl: "https://fixtureproject.supabase.co",
  publishableKey: "sb_" + "publishable_" + "fixture_public_not_a_real_key",
  appUrl: "https://app.fixture.invalid",
  privacyEmail: "privacy@fixture.invalid",
  gestao: { backend: "supabase" },
};
function setup(options = {}) {
  const requests = [], sdkCalls = [], authCalls = [];
  let token = options.token === undefined ? "fixture-user-jwt" : options.token;
  const sdk = {
    auth: {
      async getSession() {
        return { data: { session: token ? { access_token: token } : null }, error: null };
      },
      async getUser() {
        authCalls.push("getUser");
        return { data: { user: token ? { id: userId, email: "operator@fixture.invalid", email_confirmed_at: "2026-01-01T00:00:00Z" } : null }, error: null };
      },
      async signInWithPassword(values) {
        authCalls.push({ signIn: values });
        token = "fixture-new-jwt";
        return { data: {}, error: null };
      },
      async signOut() {
        authCalls.push("signOut");
        token = null;
        return { error: null };
      },
    },
  };
  const adapter = Connected.create(config, {
    cloudApi: Cloud,
    sdkFactory(...args) { sdkCalls.push(args); return sdk; },
    async fetch(url, init) {
      requests.push({ url: String(url), ...init });
      return options.respond ? options.respond(String(url), init) : Response.json({ ok: true });
    },
  });
  return { adapter, requests, sdkCalls, authCalls, setToken(value) { token = value; } };
}

test("Gestão conectada exige flag explícita e não inicializa SDK no modo local", () => {
  for (const candidate of [undefined, {}, { mode: "demo", gestao: { backend: "supabase" } }, { mode: "connected" }, { mode: "connected", gestao: { backend: "local" } }])
    assert.equal(Connected.isEnabled(candidate), false);
  assert.equal(Connected.isEnabled(config), true);
  let touched = false;
  const adapter = Connected.create({ mode: "demo" }, {
    sdkFactory() { touched = true; throw Error("SDK must remain unused"); },
    fetch() { touched = true; throw Error("Network must remain unused"); },
  });
  assert.equal(adapter, null);
  assert.equal(touched, false);
});

test("adapta conta existente com storageKey compartilhada e token de usuário por requisição", async () => {
  const { adapter, requests, sdkCalls, setToken } = setup();
  assert.equal(sdkCalls.length, 1);
  assert.equal(sdkCalls[0][0], config.supabaseUrl);
  assert.equal(sdkCalls[0][1], config.publishableKey);
  assert.deepEqual(sdkCalls[0][2].auth, {
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    flowType: "pkce", storageKey: "pires-auth-v1",
  });
  await adapter.request("status");
  assert.equal(requests[0].url, config.supabaseUrl + "/functions/v1/gestao-api/status");
  assert.equal(new Headers(requests[0].headers).get("Authorization"), "Bearer fixture-user-jwt");
  assert.equal(new Headers(requests[0].headers).get("apikey"), config.publishableKey);
  assert.equal(new Headers(requests[0].headers).has("X-Pires-Tenant"), false);
  setToken("fixture-refreshed-jwt");
  await adapter.request("status");
  assert.equal(new Headers(requests[1].headers).get("Authorization"), "Bearer fixture-refreshed-jwt");
  assert.ok(requests.every(r => r.url.startsWith(config.supabaseUrl + "/functions/v1/gestao-api/")));
});

test("empresa de acesso é separada da dona dos ativos e necessária antes de consultar dados", async () => {
  const { adapter, requests } = setup();
  assert.equal(adapter.getTenant(), null);
  await assert.rejects(adapter.request("companies"), error => error.status === 400 && error.code === "tenant_required");
  assert.equal(requests.length, 0);
  for (const invalid of ["", "Brava", "../other", "a".repeat(36), {}])
    assert.throws(() => adapter.setTenant(invalid));
  adapter.setTenant(tenantA);
  assert.equal(adapter.getTenant(), tenantA);
  await adapter.request("companies", { name: "Empresa dona fixture", source: "Fonte sintética" });
  assert.equal(new Headers(requests[0].headers).get("X-Pires-Tenant"), tenantA);
  assert.equal(requests[0].method, "POST");
  assert.deepEqual(JSON.parse(requests[0].body), { name: "Empresa dona fixture", source: "Fonte sintética" });
  adapter.setTenant(tenantB);
  await adapter.request("companies");
  assert.equal(new Headers(requests[1].headers).get("X-Pires-Tenant"), tenantB);
  adapter.setTenant(null);
  await assert.rejects(adapter.request("companies"), error => error.code === "tenant_required");
  assert.equal(requests.length, 2);
});

test("login reutiliza auth existente e logout remove a empresa de acesso", async () => {
  const { adapter, authCalls, requests } = setup({ token: null });
  await assert.rejects(adapter.request("status"), error => error.status === 401 && error.code === "auth_required");
  assert.equal(requests.length, 0);
  await adapter.signIn("operator@fixture.invalid", "fixture-password");
  assert.deepEqual(authCalls[0], { signIn: { email: "operator@fixture.invalid", password: "fixture-password" } });
  assert.ok(authCalls.includes("getUser"));
  adapter.setTenant(tenantA);
  await adapter.signOut();
  assert.equal(adapter.getTenant(), null);
  await assert.rejects(adapter.request("status"), error => error.status === 401);
});

test("resposta 401 mantém erro autenticado sem recorrer à API local", async () => {
  const { adapter, requests } = setup({ respond: () => Response.json({ error: "Sessão expirada" }, { status: 401 }) });
  adapter.setTenant(tenantA);
  await assert.rejects(adapter.request("companies"), error => error.status === 401 && error.code === "auth_required");
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.startsWith(config.supabaseUrl));
});

test("download da fonte usa JWT e tenant, devolve bytes originais e nome seguro", async () => {
  const bytes = Uint8Array.from([0x50, 0x4b, 3, 4, 7, 8]);
  const { adapter, requests } = setup({ respond: () => new Response(bytes, {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename*=UTF-8''fonte%20original.xlsx" },
  }) });
  adapter.setTenant(tenantA);
  const result = await adapter.download(`companies/${ownerCompany}/sources/source-fixture`);
  assert.equal(result.name, "fonte original.xlsx");
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
  assert.equal(new Headers(requests[0].headers).get("Authorization"), "Bearer fixture-user-jwt");
  assert.equal(new Headers(requests[0].headers).get("X-Pires-Tenant"), tenantA);
  assert.ok(requests[0].url.endsWith(`/companies/${ownerCompany}/sources/source-fixture`));
});

test("download não permite nome de arquivo escapar para diretórios", async () => {
  const { adapter } = setup({ respond: () => new Response("fixture", {
    headers: { "Content-Disposition": 'attachment; filename="../../arquivo.xlsx"' },
  }) });
  adapter.setTenant(tenantA);
  const result = await adapter.download(`companies/${ownerCompany}/sources/source-fixture`);
  assert.ok(!/[\\/\r\n]/.test(result.name));
  assert.ok(result.name.endsWith(".xlsx"));
});

test("não envia PDF/XLS como lista nem gravações técnicas fora do recorte conectado", async () => {
  const { adapter, requests } = setup();
  adapter.setTenant(tenantA);
  for (const name of ["source.pdf", "source.xls"])
    await assert.rejects(adapter.request("sources", { name, base64: "UEsDBA==" }));
  for (const route of [`companies/${ownerCompany}/rtis/${userId}/close`, `companies/${ownerCompany}/revisions`, `companies/${ownerCompany}/assets/${userId}/operation`])
    await assert.rejects(adapter.request(route, { fixture: true }));
  assert.equal(requests.length, 0);
});

test("rotas operacionais explícitas preservam payloads, IDs, evidência e requestId sem abrir outra RTI no cliente", async () => {
  const canonical = { finding: { id: userId }, rti: { id: tenantB, currentness: "unknown", status: "atualidade_desconhecida", sourceStatus: "ABERTA", sourceDate: "2020-01-01" } };
  const { adapter, requests } = setup({ respond: () => Response.json(canonical) });
  adapter.setTenant(tenantA);
  for (const [segment, body] of [
    ["contracts", { name: "Contrato fonte fixture", source: "Fonte isolada", modules: ["integridade"], assetIds: [], requestId: userId }],
    ["campaigns", { contractId: userId, module: "integridade", status: "rascunho", requestId: userId }],
    ["inspections", { assetId: userId, campaignId: tenantB, status: "planejada", requestId: userId }],
    ["lvts", { assetId: userId, inspectionId: tenantB, documentId: userId }],
    ["lvt-items", { assetId: userId, lvtId: tenantB, itemKey: "1", sourceId: "fixture-sha", locator: { section: "Item fixture" } }],
    ["photos", { assetId: userId, lvtItemId: tenantB, sourceId: "fixture-photo-sha", locator: { section: "Foto fixture" }, caption: "Foto isolada" }],
    ["findings", { assetId: userId, lvtId: tenantB, recommendation: "Recomendação real apenas na fixture", sourceId: "fixture-sha", locator: { sheet: "Fonte fixture", row: 2 } }],
    ["rtis", { documentId: userId, assetId: null, title: "Histórico documental fixture" }],
    ["documents", { documentType: "rti", sourceId: "fixture-sha", locator: { sheet: "Fonte fixture", row: 2 } }],
    ["relationships", { fromId: userId, fromKind: "asset", toId: tenantB, toKind: "asset", relationType: "valvula_psv" }],
  ]) {
    const result = await adapter.request(`companies/${ownerCompany}/${segment}`, body);
    assert.deepEqual(result, canonical);
    assert.deepEqual(JSON.parse(requests.at(-1).body), body);
    assert.equal(requests.at(-1).method, "POST");
    assert.equal(new Headers(requests.at(-1).headers).get("X-Pires-Tenant"), tenantA);
  }
  assert.equal(requests.filter(r => r.url.endsWith("/rtis")).length, 1);
  const before = requests.length;
  await adapter.request(`companies/${ownerCompany}/book/${userId}`);
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).method, "GET");
});

test("relatório por sistema ou campanha usa somente leitura canônica e mantém rascunho não emitível", async () => {
  const snapshot = { draft: true, canIssue: false, snapshotVersion: 1, recordVersions: [{ id: userId, version: 2 }], lvtItems: [], photos: [], rtis: [] };
  const { adapter, requests } = setup({ respond: () => Response.json(snapshot) });
  adapter.setTenant(tenantA);
  for (const suffix of [`system/${userId}`, `campaign/${tenantB}`]) {
    assert.deepEqual(await adapter.request(`companies/${ownerCompany}/reports/${suffix}`), snapshot);
    assert.equal(requests.at(-1).method, "GET");
    assert.equal(new Headers(requests.at(-1).headers).get("X-Pires-Tenant"), tenantA);
  }
  await assert.rejects(adapter.request(`companies/${ownerCompany}/reports/system/${userId}`, { issue: true }), error => error.code === "unsupported_operation");
  assert.equal(requests.length, 2);
});

test("upload documental é binário, limitado e autenticado, sem base64 nem invocar importador", async () => {
  const response = { id: "a".repeat(64), format: "document_pdf", sheets: [], metadata: { extraction: "not_performed" } };
  const { adapter, requests } = setup({ respond: () => Response.json(response) });
  adapter.setTenant(tenantA);
  const file = new File(["%PDF-1.7\n% isolated fixture\n%%EOF\n"], "RTI original fixture.pdf", { type: "application/pdf" });
  assert.deepEqual(await adapter.uploadDocument(file), response);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, config.supabaseUrl + "/functions/v1/gestao-api/sources/document");
  assert.equal(requests[0].body, file);
  const headers = new Headers(requests[0].headers);
  assert.equal(headers.get("Authorization"), "Bearer fixture-user-jwt");
  assert.equal(headers.get("X-Pires-Tenant"), tenantA);
  assert.equal(headers.get("X-Pires-Source-Name"), encodeURIComponent(file.name));
  assert.equal(headers.get("Content-Type"), "application/pdf");
  const xlsx = new File([Uint8Array.from([0x50, 0x4b, 3, 4])], "LVT fixture.xlsx");
  await adapter.uploadDocument(xlsx);
  assert.equal(new Headers(requests[1].headers).get("Content-Type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok(requests.every(r => r.url.endsWith("/sources/document")));
  for (const invalid of [
    new File(["fixture"], "fixture.xls"),
    { name: "fixture.xlsx", size: 32 * 1024 * 1024 + 1, arrayBuffer() {} },
    { name: "fixture.pdf", size: 0, arrayBuffer() {} },
  ]) await assert.rejects(adapter.uploadDocument(invalid));
  assert.equal(requests.length, 2);
  adapter.setTenant(null);
  await assert.rejects(adapter.uploadDocument(file), error => error.code === "tenant_required");
  assert.equal(requests.length, 2);
});

test("revogação piloto e resultado incerto documental permanecem erros sem repetir nem fallback", async () => {
  const file = new File(["%PDF-1.7\n%%EOF\n"], "fixture.pdf", { type: "application/pdf" });
  const denied = setup({ respond: () => Response.json({ error: "Módulo não liberado", code: "access_denied" }, { status: 403 }) });
  denied.adapter.setTenant(tenantA);
  await assert.rejects(denied.adapter.uploadDocument(file), error => error.code === "access_denied" && error.status === 403);
  assert.equal(denied.requests.length, 1);
  let release;
  const delayed = setup({ respond: () => new Promise(resolve => { release = resolve; }) });
  delayed.adapter.setTenant(tenantA);
  const pending = delayed.adapter.uploadDocument(file);
  await new Promise(resolve => setImmediate(resolve));
  delayed.adapter.setTenant(tenantB);
  release(Response.json({ id: "a".repeat(64) }));
  await assert.rejects(pending, error => error.code === "tenant_changed" && /concluída/.test(error.message));
  assert.equal(delayed.requests.length, 1);
});

test("upload de foto segue bytes JPEG/PNG originais com tenant e limite próprio sem abrir RTI", async () => {
  const { adapter, requests } = setup({ respond: () => Response.json({ id: "f".repeat(64), format: "image_png", sheets: [], metadata: { extraction: "not_performed" } }) });
  adapter.setTenant(tenantA);
  const file = new File([Uint8Array.from([137, 80, 78, 71])], "foto isolada.png", { type: "image/png" });
  const source = await adapter.uploadPhoto(file);
  assert.equal(source.format, "image_png");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body, file);
  assert.ok(requests[0].url.endsWith("/sources/photo"));
  assert.equal(new Headers(requests[0].headers).get("X-Pires-Tenant"), tenantA);
  assert.equal(new Headers(requests[0].headers).get("Content-Type"), "image/png");
  assert.equal(new Headers(requests[0].headers).get("X-Pires-Source-Name"), encodeURIComponent(file.name));
  for (const invalid of [
    new File(["fixture"], "fixture.svg"),
    { name: "fixture.jpeg", size: 8 * 1024 * 1024 + 1, arrayBuffer() {} },
    { name: "fixture.png", size: 0, arrayBuffer() {} },
  ]) await assert.rejects(adapter.uploadPhoto(invalid));
  assert.equal(requests.length, 1);
  adapter.setTenant(null);
  await assert.rejects(adapter.uploadPhoto(file), error => error.code === "tenant_required");
  assert.equal(requests.length, 1);
});

test("mudança de tenant durante leitura descarta resposta anterior sem repetir requisição", async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const { adapter, requests } = setup({ respond: () => response });
  adapter.setTenant(tenantA);
  const pending = adapter.request("companies");
  await new Promise(resolve => setImmediate(resolve));
  adapter.setTenant(tenantB);
  release(Response.json([{ id: ownerCompany, name: "Dona dos ativos no tenant anterior" }]));
  await assert.rejects(pending, error => error.status === 409 && error.code === "tenant_changed");
  assert.equal(requests.length, 1);
  assert.equal(new Headers(requests[0].headers).get("X-Pires-Tenant"), tenantA);
});

test("mudança de tenant após gravação informa conclusão anterior sem tentar gravar novamente", async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const { adapter, requests } = setup({ respond: () => response });
  adapter.setTenant(tenantA);
  const pending = adapter.request("companies", { name: "Dona fixture", source: "Fonte fixture" });
  await new Promise(resolve => setImmediate(resolve));
  adapter.setTenant(tenantB);
  release(Response.json({ id: ownerCompany }));
  await assert.rejects(pending, error => error.status === 409 && error.code === "tenant_changed" && /concluída/.test(error.message));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
});

test("XLSX segue como bytes base64 originais e falha de rede não aciona fallback", async () => {
  const payload = { name: "fonte-original.XLSX", base64: "UEsDBAcIAQIDBA==" };
  const { adapter, requests } = setup();
  adapter.setTenant(tenantA);
  await adapter.request("sources", payload);
  assert.deepEqual(JSON.parse(requests[0].body), payload);
  const failing = setup({ respond() { throw Error("Fixture network unavailable"); } });
  failing.adapter.setTenant(tenantA);
  await assert.rejects(failing.adapter.request("companies"), error => error.status === 503 && error.code === "service_unavailable");
  assert.equal(failing.requests.length, 1);
  assert.ok(failing.requests.every(r => r.url.startsWith(config.supabaseUrl + "/functions/v1/gestao-api/")));
});

test("empresas de acesso aceitam somente o contrato confirmado id/name sem adivinhar campos", async () => {
  const valid = setup({ respond: () => Response.json([{ id: tenantA, name: "Licenciada fixture", role: "admin", private_extra: "omit" }]) });
  valid.adapter.setTenant(tenantA);
  assert.deepEqual(await valid.adapter.tenants(), [{ id: tenantA, name: "Licenciada fixture" }]);
  assert.ok(valid.requests[0].url.endsWith("/tenants"));
  assert.equal(new Headers(valid.requests[0].headers).has("X-Pires-Tenant"), false);
  for (const rows of [null, { rows: [] }, [{ company_id: tenantA, company_name: "Wrong contract" }], [{ id: tenantA, name: " " }], [{ id: tenantA, name: "A" }, { id: tenantA, name: "A duplicada" }]]) {
    const invalid = setup({ respond: () => Response.json(rows) });
    await assert.rejects(invalid.adapter.tenants(), error => error.code === "invalid_tenants");
  }
});
