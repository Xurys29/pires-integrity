"use strict";
// Browser contract test only: static files, fake SDK and intercepted HTTP fixtures.
// No private asset server, account, credential or remote service is initialized.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { chromium } = require("playwright");

const ids = {
  tenantA: "11111111-1111-4111-8111-111111111111",
  tenantB: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
  ownerA: "44444444-4444-4444-8444-444444444444",
  ownerB: "55555555-5555-4555-8555-555555555555",
  unitA: "66666666-6666-4666-8666-666666666666",
  systemA: "77777777-7777-4777-8777-777777777777",
  assetA: "88888888-8888-4888-8888-888888888888",
  importedAsset: "99999999-9999-4999-8999-999999999999",
  preview: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  manualUnit: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  manualSystem: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  manualAsset: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const connectedRoot = "https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const config = {
  mode: "connected", gestao: { backend: "supabase" },
  supabaseUrl: "https://fixtureproject.supabase.co",
  publishableKey: "sb_" + "publishable_" + "browser_fixture_not_a_real_key",
  appUrl: "https://app.fixture.invalid", privacyEmail: "privacy@fixture.invalid",
};
const sourceBytes = Buffer.from([0x50, 0x4b, 3, 4, 7, 8, 9, 10]);
async function openAssets(page, client) {
  await page.waitForFunction(id => location.hash.startsWith("#gestao/" + id + "/"), client);
  await page.evaluate(hash => { location.hash = hash; }, `#gestao/${client}/integridade/ativos/_`);
  await page.locator("#assetListPanel:not([hidden])").waitFor();
}
const owners = {
  [ids.tenantA]: { id: ids.ownerA, name: "Empresa dona A fixture", source: "Fonte sintética A" },
  [ids.tenantB]: { id: ids.ownerB, name: "Empresa dona B fixture", source: "Fonte sintética B" },
};
function fixtureState(tenant) {
  const company = owners[tenant];
  return {
    company,
    unit: tenant === ids.tenantA ? [{ id: ids.unitA, name: "Unidade fixture A" }] : [],
    system: tenant === ids.tenantA ? [{ id: ids.systemA, unitId: ids.unitA, name: "Sistema fixture A" }] : [],
    asset: tenant === ids.tenantA ? [{
      id: ids.assetA, tag: "LINHA-ORIGINAL-FIXTURE", unitId: ids.unitA, systemId: ids.systemA,
      type: "linha", technical: {}, operation: "nao_informado", technicalCondition: "nao_avaliado",
      source: { format: "xlsx", sourceId: "source-original-a", sheet: "Lista fixture ", row: 2 },
    }] : [],
    contract: [], document: [], revision: [], classification: [], deadline: [], rti: [], inspection: [], delivery: [],
  };
}

(async () => {
  const appRoot = path.resolve(__dirname, "../app");
  const allowed = new Set(fs.readdirSync(appRoot, { recursive: true }).filter(file => fs.statSync(path.join(appRoot, file)).isFile()));
  const staticRequests = [], apiRequests = [], unexpected = [], errors = [];
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, "http://fixture").pathname.slice(1);
    staticRequests.push(file);
    if (!allowed.has(file)) return res.writeHead(404).end();
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(fs.readFileSync(path.join(appRoot, file)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pires-connected-browser-"));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/runtime-config.js", route => route.fulfill({ contentType: "text/javascript", body: "window.PIRES_CONFIG = " + JSON.stringify(config) + ";" }));
    await context.route("**/vendor/supabase.js", route => route.fulfill({ contentType: "text/javascript", body: `
      window.__fixtureToken = null;
      window.__fixtureSdkOptions = [];
      window.PiresSupabase = { createClient(url,key,options) {
        window.__fixtureSdkOptions.push(options);
        return { auth: {
          getSession: async () => ({data:{session:window.__fixtureToken?{access_token:window.__fixtureToken}:null},error:null}),
          getUser: async () => ({data:{user:window.__fixtureToken?{id:${JSON.stringify(ids.user)},email:'operator@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:null},error:null}),
          signInWithPassword: async () => {window.__fixtureToken='fixture-browser-user-jwt';return {data:{},error:null};},
          signOut: async () => {window.__fixtureToken=null;return {error:null};}
        }};
      }};` }));
    const states = { [ids.tenantA]: fixtureState(ids.tenantA), [ids.tenantB]: fixtureState(ids.tenantB) };
    let rejectedSession = false, previewRequest = null, sourceUpload = null;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization,apikey,Content-Type,X-Pires-Tenant", "Access-Control-Expose-Headers": "Content-Disposition" };
    await context.route("https://fixtureproject.supabase.co/**", async route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const url = request.url(), headers = request.headers(), tenant = headers["x-pires-tenant"];
      apiRequests.push({ url, method: request.method(), headers, body: request.postDataJSON() });
      const json = (value, status = 200) => route.fulfill({ status, headers: cors, json: value });
      if (!url.startsWith(connectedRoot)) { unexpected.push(url); return route.abort(); }
      assert.equal(headers.authorization, "Bearer fixture-browser-user-jwt");
      assert.equal(headers.apikey, config.publishableKey);
      if (rejectedSession) return json({ error: "Sessão fixture expirada" }, 401);
      const resource = url.slice(connectedRoot.length);
      if (resource === "status") return json({
        actor: "Operador fixture", email: "operator@fixture.invalid", user_id: ids.user, mode: "supabase_integrado",
        pilot: true, tenant: tenant || null,
        capabilities: {
          xlsx: true, pdf: false, xls: false, operations: true, documentOriginals: true, photoOriginals: true,
          xlsxMaxBytes: 8 * 1024 * 1024, documentMaxBytes: 32 * 1024 * 1024, photoMaxBytes: 8 * 1024 * 1024,
          write: tenant === ids.tenantA,
        },
      });
      if (resource === "tenants") return json([
        { id: ids.tenantA, name: "Empresa licenciada A fixture" }, { id: ids.tenantB, name: "Empresa licenciada B fixture" },
      ]);
      assert.ok(owners[tenant], "Data requests require the selected licensed tenant");
      const owner = owners[tenant], state = states[tenant];
      if (resource === "companies" && request.method() === "GET") return json([owner]);
      if (resource === `companies/${owner.id}/state`) return json(state);
      if (resource === `companies/${owner.id}/hierarchy` && request.method() === "POST") {
        const values = request.postDataJSON(), unit = { id: ids.manualUnit, name: values.unit },
          system = { id: ids.manualSystem, unitId: ids.manualUnit, name: values.system };
        state.unit.push(unit); state.system.push(system);
        return json({ unit, system });
      }
      if (resource === `companies/${owner.id}/assets` && request.method() === "POST") {
        const values = request.postDataJSON();
        assert.equal(values.systemId, ids.manualSystem);
        assert.equal(values.unitId, ids.manualUnit);
        assert.equal(values.source, "Fonte manual sintética confirmada");
        const asset = { ...values, id: ids.manualAsset, operation: "nao_informado", technicalCondition: "nao_avaliado" };
        state.asset.push(asset);
        return json(asset);
      }
      if (resource === `companies/${owner.id}/history/${ids.assetA}`) return json([{ actor: "Fixture", at: "2026-01-01T00:00:00Z", event: "Fonte fixture", body: {} }]);
      if (resource.startsWith(`companies/${owner.id}/sources/`)) return route.fulfill({ status: 200, headers: { ...cors, "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename*=UTF-8''fonte-original-fixture.xlsx" }, body: sourceBytes });
      if (resource === "sources" && request.method() === "POST") {
        sourceUpload = request.postDataJSON();
        assert.equal(sourceUpload.name, "fixture.xlsx");
        assert.deepEqual(Buffer.from(sourceUpload.base64, "base64"), sourceBytes);
        return json({ id: "source-upload-fixture", name: "fixture.xlsx", format: "xlsx", sheets: [{ name: "Lista fixture ", maxRow: 2, maxColumn: 1, rows: [{ row: 1, values: [owner.name] }, { row: 2, values: ["LINHA-IMPORTADA-FIXTURE"] }] }] });
      }
      if (resource === "import/preview") {
        previewRequest = request.postDataJSON();
        assert.equal(previewRequest.companyId, owner.id);
        return json({ ...previewRequest, id: ids.preview, warnings: [], blockers: [], rows: [{ row: 2, action: "novo", values: { tag: "LINHA-IMPORTADA-FIXTURE" } }] });
      }
      if (resource === "import/commit") {
        assert.equal(request.postDataJSON().previewId, ids.preview);
        state.asset.push({ ...state.asset[0], id: ids.importedAsset, tag: "LINHA-IMPORTADA-FIXTURE", source: { format: "xlsx", sourceId: "source-upload-fixture", sheet: "Lista fixture ", row: 2 } });
        return json({ company: owner, unit: state.unit[0], system: state.system[0], inserted: 1, unchanged: 0 });
      }
      unexpected.push(resource);
      return json({ error: "Unexpected fixture route" }, 404);
    });
    await page.goto(base + "/gestao.html");
    await page.locator("#connectedLoginForm:not([hidden])").waitFor();
    assert.equal(await page.locator("#loginForm").isVisible(), false);
    assert.equal(await page.locator("#localLoginHelp").isVisible(), false);
    const sdkOptions = await page.evaluate(() => window.__fixtureSdkOptions);
    assert.equal(sdkOptions.length, 1);
    assert.equal(sdkOptions[0].auth.storageKey, "pires-auth-v1");
    await page.locator("#connectedLoginForm input[name=email]").fill("operator@fixture.invalid");
    await page.locator("#connectedLoginForm input[name=password]").fill("fixture-password");
    await page.locator("#connectedLoginForm button").click();
    await page.locator("#tenantAccess:not([hidden])").waitFor();
    assert.equal(await page.locator("#workspace").isVisible(), false);
    await page.locator("#tenant").selectOption(ids.tenantA);
    await page.locator(`#company option[value='${ids.ownerA}']`).waitFor({ state: "attached" });
    assert.notEqual(await page.locator("#tenant").inputValue(), ids.ownerA);
    await page.locator("#company").selectOption(ids.ownerA);
    await openAssets(page, ids.ownerA);
    await page.getByRole("heading", { name: "LINHA-ORIGINAL-FIXTURE", exact: true }).waitFor();
    await page.getByRole("button", { name: "Consultar book", exact: true }).click();
    await page.locator("#flowView[data-view=book]").waitFor();
    assert.match(await page.locator("#flowView").innerText(), /Não avaliad/);
    assert.equal(await page.locator("#flowView").getByText("Registrar RTI aberta", { exact: true }).count(), 0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByText("Baixar documento original de origem", { exact: true }).click();
    const download = await downloadPromise;
    const saved = path.join(temp, "source.xlsx");
    await download.saveAs(saved);
    assert.deepEqual(fs.readFileSync(saved), sourceBytes);
    assert.equal(download.suggestedFilename(), "fonte-original-fixture.xlsx");

    await openAssets(page, ids.ownerA);
    await page.getByRole("button", { name: "Cadastrar ativo", exact: true }).click();
    const hierarchyForm = page.locator("#tools form").filter({ has: page.locator("input[name=unit]") });
    await hierarchyForm.locator("input[name=unit]").fill("Unidade manual fixture");
    await hierarchyForm.locator("input[name=system]").fill("Sistema manual fixture");
    await hierarchyForm.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.locator(`#tools select[name=systemId] option[value='${ids.manualSystem}']`).waitFor({ state: "attached" });
    const assetForm = page.locator("#tools form").filter({ has: page.locator("input[name=tag]") });
    await assetForm.locator("input[name=tag]").fill("LINHA-MANUAL-FIXTURE");
    await assetForm.locator("select[name=systemId]").selectOption(ids.manualSystem);
    await assetForm.locator("select[name=type]").selectOption("linha");
    await assetForm.locator("input[name=source]").fill("Fonte manual sintética confirmada");
    await assetForm.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByRole("heading", { name: "LINHA-MANUAL-FIXTURE", exact: true }).waitFor();

    await page.getByRole("button", { name: "Importar lista XLSX", exact: true }).click();
    await page.locator("#tools input[type=file]").setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("SYNTHETIC PDF NOT PARSED") });
    await page.getByRole("button", { name: "Ler arquivo e abas", exact: true }).click();
    await page.waitForFunction(() => /XLSX/.test(document.querySelector("#message").textContent));
    assert.equal(apiRequests.filter(r => r.url.endsWith("/sources") && r.method === "POST").length, 0);
    await page.locator("#tools input[type=file]").setInputFiles({ name: "fixture.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: sourceBytes });
    await page.getByRole("button", { name: "Ler arquivo e abas", exact: true }).click();
    await page.getByLabel("ID estável da fonte").fill("source-identity-fixture");
    await page.locator("#tools input[name=companyName]").fill(owners[ids.tenantA].name);
    await page.locator("#tools input[name=sourceCompanyName]").fill(owners[ids.tenantA].name);
    await page.getByLabel("Célula que comprova").fill("A1");
    await page.locator("#tools select[name=companyId]").selectOption(ids.ownerA);
    await page.getByLabel("Unidade / plataforma (nome conferido)").fill("Unidade fixture A");
    await page.getByLabel("Sistema conferido no conteúdo").fill("Sistema fixture A");
    await page.getByLabel("Referência de confirmação do sistema").fill("Célula/fixture documentada");
    await page.getByLabel("Primeira linha de dados").fill("2");
    await page.getByLabel("Última linha de dados").fill("2");
    await page.getByLabel("TAG · coluna", { exact: false }).fill("A");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByRole("heading", { name: "Prévia · 1 registros da faixa 2–2", exact: true }).waitFor();
    await page.getByLabel("Conferi a empresa").check();
    await page.getByRole("button", { name: "Confirmar gravação desta prévia", exact: true }).click();
    await page.getByRole("heading", { name: "LINHA-IMPORTADA-FIXTURE", exact: true }).waitFor();
    assert.ok(sourceUpload);
    assert.equal(previewRequest.sourceIdentity, "source-identity-fixture");
    assert.equal(previewRequest.sourceCompanyName, owners[ids.tenantA].name);
    assert.equal(previewRequest.companyName, owners[ids.tenantA].name);
    await page.locator("#tenant").selectOption(ids.tenantB);
    await page.locator(`#company option[value='${ids.ownerB}']`).waitFor({ state: "attached" });
    assert.equal(await page.locator("#detail").isVisible(), false);
    assert.equal(await page.locator("#assets article").count(), 0);
    await page.locator("#company").selectOption(ids.ownerB);
    await openAssets(page, ids.ownerB);
    await page.getByText("Nenhum ativo nesta seleção.", { exact: true }).waitFor();
    assert.equal(await page.locator("#newCompany").isDisabled(), true);
    assert.equal(await page.locator("#newAsset").isDisabled(), true);
    assert.equal(await page.locator("#importButton").isDisabled(), true);
    rejectedSession = true;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.locator("#connectedLoginForm:not([hidden])").waitFor();
    assert.equal(await page.locator("#workspace").isVisible(), false);
    assert.equal(await page.locator("#loginForm").isVisible(), false);
    assert.equal(await page.locator("#tenantAccess").isVisible(), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    assert.ok(!staticRequests.some(url => url.startsWith("api/")));
    assert.ok(apiRequests.filter(r => !r.url.endsWith("/status") && !r.url.endsWith("/tenants")).every(r => r.headers["x-pires-tenant"]));
    console.log("PASS navegador conectado (SDK/HTTP fictícios): capabilities do piloto, conta existente, tenant separado da dona dos ativos, unidade/sistema/linha, consulta sem aprovação, fonte original autenticada, PDF recusado como lista, XLSX/prévia com nome original preservado/confirmação, isolamento ao trocar tenant, acesso somente leitura e expiração sem fallback local.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
