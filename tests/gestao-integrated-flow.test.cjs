"use strict";
// Full local contract test: real adapter, Edge handler, XLSX parser and migration.
// Only external Auth, HTTP transport and Storage bytes are simulated. Licensing
// fixtures mirror the verified helper signatures; nothing touches a real project.
const { test } = require("node:test"), assert = require("node:assert/strict"),
  { createHash } = require("node:crypto"), { zipSync, strToU8 } = require("fflate"),
  Cloud = require("../app/cloud.js"), Connected = require("../app/gestao-connected.js"),
  { setup, ids } = require("./fixtures/gestao-postgres-fixture.cjs");

const APP_ORIGIN = "https://app.fixture.invalid";
const SUPABASE_ORIGIN = "https://fixtureproject.supabase.co";
const fixtureNames = Object.freeze({
  ownerName: "Empresa dona sintética",
  unitName: "Unidade sintética",
  systemName: "Sistema sintético",
  sheetName: "Lista fixture ",
});
const escapeXml = value => String(value).replace(/[&<>\"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function makeWorkbook(names = {}) {
  const values = { ...fixtureNames, ...names };
  const text = (address, value) => `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const row = (number, cells) => `<row r="${number}">${cells.join("")}</row>`;
  const rows = [
    row(1, [text("A1", values.ownerName)]),
    row(2, [text("A2", values.unitName)]),
    row(3, [text("A3", values.systemName)]),
    row(15, [text("A15", "TAG"), text("B15", "System"), text("C15", "Pressão")]),
  ];
  for (let n = 16; n <= 59; n++) {
    const cells = [text("A" + n, "TAG-FIXTURE-" + String(n - 15).padStart(4, "0"))];
    if (n === 16) cells.push(text("B16", "NULL"));
    // B17/C16 are absent cells; literal NULL above is source text, not absence.
    if (n === 17) cells.push('<c r="C17"><v>8</v></c>');
    rows.push(row(n, cells));
  }
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
  const packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
  const parts = {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${rel.slice(0, -1)}"><sheets><sheet name="${escapeXml(values.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}"><dimension ref="A1:C59"/><sheetData>${rows.join("")}</sheetData></worksheet>`,
  };
  const mtime = new Date("2026-01-01T00:00:00Z");
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, xml]) => [name, [strToU8(xml), { mtime }]])), { level: 0 });
}

// Wrap actual fixture SQL calls explicitly when Supabase's {data,error} shape is needed.
// No RPC names, tenant rights or gate implementation are simulated here.
async function rpcResult(fn) {
  try { return { data: await fn(), error: null }; }
  catch (error) { return { data: null, error: { code: error?.code, message: String(error?.message || error) } }; }
}

function createTransport({
  users, initialUser = null, userRpc, serviceRpc, createGestaoHandler, readXlsx,
  appOrigin = APP_ORIGIN, supabaseOrigin = SUPABASE_ORIGIN,
  storageMap = new Map(), onUpload,
}) {
  if (!users || typeof userRpc !== "function" || typeof serviceRpc !== "function" ||
      typeof createGestaoHandler !== "function" || typeof readXlsx !== "function")
    throw Error("Forneça usuários e callbacks reais de SQL/handler/leitor ao transport de teste.");
  const profiles = new Map(), tokenUsers = new Map(), tokens = {}, events = [];
  const b64 = value => Buffer.from(value).toString("base64url");
  for (const [name, value] of Object.entries(users)) {
    const supplied = typeof value === "string" ? { id: value } : value;
    if (!supplied || typeof supplied.id !== "string") throw Error("Usuário fixture exige id.");
    const user = {
      email: name.toLowerCase() + "@fixture.invalid",
      email_confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false,
      ...supplied,
    };
    // Deliberately fake three-part tokens, accepted only by this in-memory map.
    const token = b64("fixture-header") + "." + b64(JSON.stringify({ fixture: name, sub: user.id })) + "." + b64("fixture-signature");
    profiles.set(name, { name, user, token }); tokenUsers.set(token, user); tokens[name] = token;
  }
  let current = null;
  function setUser(nameOrId) {
    if (nameOrId === null) { current = null; return; }
    const profile = profiles.get(nameOrId) || [...profiles.values()].find(p => p.user.id === nameOrId);
    if (!profile) throw Error("Usuário não pertence ao mapa fixture.");
    current = profile;
  }
  setUser(initialUser);
  const authResult = user => user
    ? { data: { user: { ...user } }, error: null }
    : { data: { user: null }, error: { code: "invalid_fixture_token", message: "Token fora do mapa fixture" } };
  function createUserClient(token) {
    const user = tokenUsers.get(token);
    events.push({ kind: "userClient", userId: user?.id || null });
    return {
      auth: { async getUser(jwt) {
        events.push({ kind: "getUser", userId: tokenUsers.get(jwt)?.id || null });
        return authResult(jwt === token ? tokenUsers.get(jwt) : null);
      } },
      async rpc(name, args) {
        if (!user) return { data: null, error: { code: "42501", message: "Token fora do mapa fixture" } };
        events.push({ kind: "userRpc", userId: user.id, name, args });
        return userRpc(user.id, name, args);
      },
    };
  }
  function createServiceClient() {
    events.push({ kind: "serviceClient" });
    return {
      async rpc(name, args) {
        events.push({ kind: "serviceRpc", name, args });
        return serviceRpc(name, args);
      },
      storage: { from(bucket) {
        return {
          async upload(key, bytes, options) {
            if (!(bytes instanceof Uint8Array) || options?.upsert !== false)
              throw Error("Fixture Storage aceita somente bytes imutáveis e upsert:false.");
            const address = bucket + "/" + key;
            events.push({ kind: "upload", bucket, key, size: bytes.byteLength, options: { ...options } });
            if (storageMap.has(address)) return { data: null, error: { statusCode: "409", error: "Duplicate" } };
            const copy = Uint8Array.from(bytes);
            storageMap.set(address, copy);
            if (onUpload) await onUpload({ bucket, key, bytes: Uint8Array.from(copy), options: { ...options } });
            return { data: { path: key }, error: null };
          },
          async download(key) {
            events.push({ kind: "download", bucket, key });
            const bytes = storageMap.get(bucket + "/" + key);
            return bytes instanceof Uint8Array
              ? { data: new Blob([Uint8Array.from(bytes)]), error: null }
              : { data: null, error: { statusCode: "404" } };
          },
        };
      } },
    };
  }
  const handler = createGestaoHandler({ appOrigin, createUserClient, createServiceClient, readXlsx });
  async function adapterFetch(url, init = {}) {
    if (!String(url).startsWith(supabaseOrigin + "/functions/v1/gestao-api/"))
      throw Error("Transport fixture recusa destinos fora do handler local.");
    const headers = new Headers(init.headers);
    headers.set("Origin", appOrigin);
    const request = new Request(String(url), { ...init, headers });
    events.push({ kind: "request", method: request.method, route: new URL(url).pathname, tenant: headers.get("X-Pires-Tenant") });
    return handler(request);
  }
  function sdkFactory(url, publicKey, options) {
    events.push({ kind: "sdkClient", url, publicKey, options });
    return {
      auth: {
        async getSession() { return { data: { session: current ? { access_token: current.token } : null }, error: null }; },
        async getUser(jwt) { return authResult(jwt === undefined ? current?.user : tokenUsers.get(jwt)); },
        async signInWithPassword({ email }) {
          const profile = [...profiles.values()].find(p => p.user.email === email);
          if (!profile) return { data: { user: null }, error: { code: "invalid_credentials" } };
          current = profile;
          return { data: { user: { ...profile.user }, session: { access_token: profile.token } }, error: null };
        },
        async signOut() { current = null; return { error: null }; },
      },
    };
  }
  return {
    handler, adapterFetch, sdkFactory, setUser, tokens, storageMap, events,
    getUser: () => current ? { name: current.name, id: current.user.id, token: current.token } : null,
    config: { mode: "connected", gestao: { backend: "supabase" }, supabaseUrl: supabaseOrigin,
      publishableKey: "sb_" + "publishable_" + "integrated_fixture_not_real", appUrl: appOrigin,
      privacyEmail: "privacy@fixture.invalid" },
  };
}

test("fluxo integrado local: JWT/tenant → XLSX original → SQL real → 44 ativos → reimportação e persistência", async (t) => {
  const [{ createGestaoHandler }, { readXlsx }] = await Promise.all([
    import("../supabase/functions/_shared/gestao-api-core.mjs"),
    import("../supabase/functions/_shared/xlsx-reader.mjs"),
  ]);
  let fixture = await setup();
  t.after(async () => fixture.close());
  const transport = createTransport({
    users: { adminA: ids.adminA, adminB: ids.adminB, planner: ids.planner, client: ids.client },
    initialUser: "adminA", createGestaoHandler, readXlsx,
    userRpc(userId, name, args) {
      if (name === "pi_gestao_api")
        return rpcResult(() => fixture.call(args.p_tenant, args.p_action, args.p_payload, userId));
      assert.equal(name, "pi_my_company_access");
      return rpcResult(() => fixture.asRole("authenticated", userId, async (db) =>
        (await db.query("select public.pi_my_company_access() as value")).rows[0].value));
    },
    serviceRpc(name, args) {
      assert.equal(name, "pi_gestao_register_source");
      return rpcResult(() => fixture.register(args.p_tenant, args.p_actor, args.p_payload));
    },
    async onUpload({ bucket, key, bytes }) {
      assert.equal(bucket, "pi-gestao-sources");
      const [tenant, sha, file] = key.split("/");
      assert.equal(file, "original.xlsx");
      assert.equal(await fixture.putObject(tenant, sha, bytes.byteLength), key);
    },
  });
  const adapter = Connected.create(transport.config, {
    cloudApi: Cloud, sdkFactory: transport.sdkFactory, fetch: transport.adapterFetch,
  });
  assert.equal((await adapter.request("status")).user_id, ids.adminA);
  assert.deepEqual(await adapter.tenants(), [{ id: ids.tenantA, name: "Tenant fixture A" }]);
  adapter.setTenant(ids.tenantA);
  assert.equal((await adapter.request("status")).capabilities.write, true);
  const owner = await adapter.request("companies", {
    name: fixtureNames.ownerName, source: "Identificação comprovada em A1 da fonte sintética do teste",
  });
  assert.notEqual(owner.id, ids.tenantA);
  const original = makeWorkbook(), sha = createHash("sha256").update(original).digest("hex"),
    uploadBody = { name: "fonte-integrada-sintetica.xlsx", base64: Buffer.from(original).toString("base64") };
  const source = await adapter.request("sources", uploadBody);
  assert.equal(source.id, sha);
  assert.equal(source.format, "xlsx");
  const sheet = source.sheets[0];
  assert.equal(sheet.name, fixtureNames.sheetName);
  assert.equal(sheet.rows.find((r) => r.row === 16).values[1], "NULL");
  assert.equal(sheet.rows.find((r) => r.row === 17).values[1], null);
  assert.equal(sheet.rows.find((r) => r.row === 17).values[2], 8);
  assert.equal(transport.storageMap.size, 1);
  assert.deepEqual(transport.storageMap.values().next().value, original);
  const context = {
    sourceId: source.id, sourceIdentity: "fonte-integrada-identidade-estavel",
    companyId: owner.id, companyName: owner.name, companyCell: "A1",
    sheet: fixtureNames.sheetName, unit: fixtureNames.unitName, system: fixtureNames.systemName,
    systemEvidence: "Unidade A2 e sistema A3 explicitamente conferidos na fixture",
    start: 16, end: 59, type: "linha",
    mapping: { tag: "A", operationPressure: "C" }, units: { operationPressure: "bar" },
  };
  const preview = await adapter.request("import/preview", context);
  assert.equal(preview.rows.length, 44);
  assert.equal(preview.companyId, owner.id);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.rows[0].values.operationPressure, null);
  const committed = await adapter.request("import/commit", { previewId: preview.id, confirm: true });
  assert.equal(committed.inserted, 44);
  assert.equal(committed.unchanged, 0);
  assert.equal(committed.company.id, owner.id);
  const stateRoute = `companies/${owner.id}/state`;
  let state = await adapter.request(stateRoute);
  assert.equal(state.asset.length, 44);
  assert.equal(state.unit.length, 1);
  assert.equal(state.system.length, 1);
  assert.equal(state.system[0].name, fixtureNames.systemName);
  assert.notEqual(state.system[0].name, "NULL");
  const assetIds = state.asset.map((a) => a.id);
  const first = state.asset.find((a) => a.source.row === 16), second = state.asset.find((a) => a.source.row === 17);
  assert.equal(first.source.sourceId, sha);
  assert.equal(first.source.sheet, fixtureNames.sheetName);
  assert.deepEqual(first.source.mapping, context.mapping);
  assert.equal(first.source.raw.operationPressure, null);
  assert.equal(first.technical.operationPressure.value, null);
  assert.equal(second.technical.operationPressure.value, 8);
  assert.ok(state.asset.every((a) => a.operation === "nao_informado" && a.technicalCondition === "nao_avaliado"));
  for (const key of ["contract", "document", "revision", "classification", "deadline", "rti", "inspection", "delivery"])
    assert.deepEqual(state[key], []);
  const storedSource = (await fixture.db.query("select workbook from pi_gestao_private.sources where tenant_id=$1 and id=$2", [ids.tenantA, sha])).rows[0].workbook;
  assert.equal(storedSource.sheets[0].rows.find((r) => r.row === 16).values[1], "NULL");

  // Exercise the actual manual-creation payload emitted by the connected form.
  const reference = "Referência manual declarada na fixture; não é anexo nem relatório";
  const manual = await adapter.request(`companies/${owner.id}/assets`, {
    tag: "TAG-MANUAL-SINTETICA", type: "linha", unitId: state.unit[0].id, systemId: state.system[0].id,
    source: reference, technical: { operationPressure: { value: "9", unit: "bar", source: reference } },
  });
  assert.equal(manual.technicalCondition, "nao_avaliado");
  assert.equal(manual.technical.operationPressure.value, "9");
  assert.equal(manual.source.format, "manual");
  assert.ok(JSON.stringify(manual.source).includes(reference));
  assert.equal(Object.hasOwn(manual.source, "sourceId"), false);
  assert.equal(Object.hasOwn(manual.source, "fileHash"), false);
  const history = await adapter.request(`companies/${owner.id}/history/${manual.id}`);
  assert.ok(history.length > 0);
  assert.ok(history.every((event) => event.actor === ids.adminA));
  assert.ok(history.some((event) => event.event === "asset"));

  assert.equal((await adapter.request("sources", uploadBody)).id, sha);
  const secondPreview = await adapter.request("import/preview", context);
  assert.ok(secondPreview.rows.every((row) => row.action === "inalterado"));
  const reimport = await adapter.request("import/commit", { previewId: secondPreview.id, confirm: true });
  assert.equal(reimport.inserted, 0);
  assert.equal(reimport.unchanged, 44);
  state = await adapter.request(stateRoute);
  assert.equal(state.asset.length, 45);
  assert.deepEqual(state.asset.filter((a) => a.id !== manual.id).map((a) => a.id), assetIds);
  assert.equal(transport.storageMap.size, 1);
  const downloaded = await adapter.download(`companies/${owner.id}/sources/${sha}`);
  assert.deepEqual(new Uint8Array(await downloaded.blob.arrayBuffer()), original);
  assert.equal(downloaded.name, uploadBody.name);

  // A new PostgreSQL instance reopens the snapshot with the same real migration/functions.
  const snapshot = await fixture.db.dumpDataDir();
  await fixture.close();
  fixture = await setup({ loadDataDir: snapshot });
  state = await adapter.request(stateRoute);
  assert.equal(state.asset.length, 45);
  assert.deepEqual(state.asset.filter((a) => a.id !== manual.id).map((a) => a.id), assetIds);
  assert.deepEqual(new Uint8Array(await (await adapter.download(`companies/${owner.id}/sources/${sha}`)).blob.arrayBuffer()), original);

  // Business authorization is real SQL; only the Auth identity map changes here.
  const privilegedBeforeDenied = transport.events.filter((event) => event.kind === "serviceClient").length;
  await fixture.db.exec("update pi_access_private.tenant_rollout set writes_paused=true");
  assert.equal((await adapter.request("status")).capabilities.write, false);
  assert.equal((await adapter.request(stateRoute)).asset.length, 45);
  await assert.rejects(adapter.request("sources", uploadBody), (error) => error.status === 403);
  await fixture.db.exec("update pi_access_private.tenant_rollout set writes_paused=false");
  await fixture.db.query("update pi_access_private.fixture_licenses set active=false where company_id=$1", [ids.tenantA]);
  await assert.rejects(adapter.request(stateRoute), (error) => error.status === 403);
  await fixture.db.query("update pi_access_private.fixture_licenses set active=true where company_id=$1", [ids.tenantA]);
  transport.setUser("adminB"); adapter.setTenant(ids.tenantB);
  assert.deepEqual(await adapter.request("companies"), []);
  await assert.rejects(adapter.request(stateRoute), (error) => [400, 403].includes(error.status));
  await assert.rejects(adapter.download(`companies/${owner.id}/sources/${sha}`), (error) => [400, 403].includes(error.status));
  transport.setUser("client"); adapter.setTenant(ids.tenantA);
  assert.deepEqual(await adapter.tenants(), []);
  await assert.rejects(adapter.request("companies"), (error) => error.status === 403);
  await assert.rejects(adapter.request("sources", uploadBody), (error) => error.status === 403);
  transport.setUser("planner");
  assert.equal((await adapter.request("status")).capabilities.write, false);
  assert.equal((await adapter.request(stateRoute)).asset.length, 45);
  await assert.rejects(adapter.request("companies", { name: "Não criar", source: "Fixture" }), (error) => error.status === 403);
  await assert.rejects(adapter.request("sources", uploadBody), (error) => error.status === 403);
  assert.equal(transport.events.filter((event) => event.kind === "serviceClient").length, privilegedBeforeDenied);
  assert.ok(transport.events.filter((event) => event.kind === "upload").every((event) => event.options.upsert === false));
});
