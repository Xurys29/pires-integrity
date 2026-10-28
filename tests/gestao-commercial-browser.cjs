"use strict";
// Read-only UI regression. All companies, references and HTTP responses are synthetic.
// This static server never starts the private API or connects to a database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { chromium } = require("playwright");
const Flow = require("../app/gestao-flow.js");

const id = n => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = { tenant: id(1), user: id(2), owner: id(3), unit: id(4), system: id(5), asset: id(6),
  operational: id(7), commercial: id(8), unsafe: id(9), document: id(10) };
const edgeRoot = "https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const sourceURL = "https://drive.fixture.invalid/file/commercial-fixture-001/view";
const config = { mode: "connected", gestao: { backend: "supabase" }, supabaseUrl: "https://fixtureproject.supabase.co",
  publishableKey: "sb_" + "publishable_" + "commercial_fixture_not_real", appUrl: "https://app.fixture.invalid", privacyEmail: "privacy@fixture.invalid" };
const owner = { id: ids.owner, name: "Cliente comercial sintético", source: "Fixture isolada de leitura" };
const reference = {
  id: ids.commercial, recordClass: "commercial_reference", modules: [], assetIds: [], moduleAssetIds: {},
  operationalScopeStatus: "pending", status: "close_confirmed_by_owner", name: "Referência comercial ALFA da fixture",
  commercial: { currency: "BRL", amountCents: Number.MAX_SAFE_INTEGER,
    stages: [{ position: 2, label: "Segunda e última parcela", amountCents: 4503599627370496 },
      { position: 1, label: "Primeira parcela", amountCents: 4503599627370495 }],
    issuerNameRaw: "Prestadora sintética ALFA Ltda.", issuerCnpjRaw: "00.000.000/0000-00", issuerCnpjDigits: "00000000000000",
    customerNameRaw: "Cliente documental da fixture", customerCnpjRaw: "11.111.111/1111-11", customerCnpjDigits: "11111111111111",
    serviceScopeRaw: "Serviço descritivo sintético, sem ativos definidos" },
  reference: { issuer: "Prestadora sintética ALFA Ltda.", number: "FIXTURE-COM-001", revision: "R2", sourceDocumentId: ids.document, nature: "proposal" },
  provenance: { sourceURI: sourceURL, documentDateRaw: "26/10/2026", sourceDate: "2026-10-26", originalBytesVerified: false,
    fileHash: null, materializationStatus: "not_materialized", locator: { page: 2 } },
  userConfirmation: { actorUserId: ids.user, statement: "Confirmação comercial sintética do titular", evidenceRef: "evidência sintética do teste",
    proceedEvidenceRef: "autorização sintética do teste", confirmedDate: "2026-10-26", confirmedAt: null },
  signedNumber: null, signedDate: null, validity: null, source: "Referência textual sintética, bytes não disponíveis",
};
// Deliberately invalid operational modules exercise class-based separation even for stale data.
const unsafeReference = { ...reference, id: ids.unsafe, name: "Análise crítica BETA da fixture", modules: ["integridade"],
  assetIds: [ids.asset], moduleAssetIds: { integridade: [ids.asset] },
  commercial: { ...reference.commercial, amountCents: Number.MAX_SAFE_INTEGER + 1, stages: [] },
  reference: { ...reference.reference, number: "FIXTURE-COM-002", nature: "critical_analysis" },
  provenance: { ...reference.provenance, sourceURI: "javascript:window.__unsafeCommercialLink=true" },
};
const operational = { id: ids.operational, name: "OS operacional sintética", modules: ["integridade"],
  assetIds: [ids.asset], moduleAssetIds: { integridade: [ids.asset] }, source: "OS fixture documentada" };
const state = { company: owner,
  unit: [{ id: ids.unit, name: "Unidade sintética" }], system: [{ id: ids.system, unitId: ids.unit, name: "Sistema sintético" }],
  asset: [{ id: ids.asset, tag: "TAG-COMERCIAL-FIXTURE", type: "linha", unitId: ids.unit, systemId: ids.system, technical: {} }],
  contract: [operational, reference, unsafeReference], campaign: [], inspection: [], document: [], lvt: [], lvtItem: [],
  photo: [], finding: [], relation: [], rti: [], revision: [], classification: [], deadline: [], delivery: [], findings: [], relations: [] };

function sdkFixture() {
  return `window.PiresSupabase={createClient(url,key,options){window.__commercialAuthOptions=options;return{auth:{
    getSession:async()=>({data:{session:{access_token:'fixture.header.signature'}},error:null}),
    getUser:async()=>({data:{user:{id:${JSON.stringify(ids.user)},email:'commercial@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null}),
    signInWithPassword:async()=>({data:{},error:null}),signOut:async()=>({error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
  }}}};`;
}
async function navigate(page, module, view, item = "_") {
  await page.evaluate(hash => { location.hash = hash; }, `#gestao/${ids.owner}/${module}/${view}/${item}`);
  await page.waitForFunction(({ module, view }) => {
    const node = document.getElementById("flowView");
    return node.dataset.module === module && node.dataset.view === view;
  }, { module, view });
}
async function fieldPairs(panel) {
  return panel.locator("dl").evaluateAll(lists => lists.flatMap(list => [...list.querySelectorAll("dt")].map(dt => [dt.textContent, dt.nextElementSibling.textContent])));
}
async function fits(page, width, screen) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 1000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.document <= size.viewport, `${screen}: ${size.document}px > ${size.viewport}px`);
}
function verifyPureBoundaries() {
  assert.equal(Flow.formatBRL(Number.MAX_SAFE_INTEGER), "R$ 90.071.992.547.409,91");
  assert.equal(Flow.formatBRL(4503599627370495), "R$ 45.035.996.273.704,95");
  assert.equal(Flow.formatBRL(4503599627370496), "R$ 45.035.996.273.704,96");
  assert.equal(Flow.formatBRL(1), "R$ 0,01");
  for (const invalid of [Number.MAX_SAFE_INTEGER + 1, -1, 1.2, "100", null, Infinity, NaN])
    assert.equal(Flow.formatBRL(invalid), "Valor a confirmar");
  assert.equal(Flow.safeSourceURL(sourceURL), sourceURL);
  for (const invalid of ["javascript:alert(1)", "data:text/html,fixture", "http://fixture.invalid/source", "/relative", "https://user:password@fixture.invalid/source", "https://fixture.invalid/\nsource", null])
    assert.equal(Flow.safeSourceURL(invalid), null);
  assert.equal(reference.commercial.stages.reduce((total, stage) => total + BigInt(stage.amountCents), 0n), BigInt(reference.commercial.amountCents));
}

(async () => {
  verifyPureBoundaries();
  const appRoot = path.resolve(__dirname, "../app"), calls = [], errors = [], unexpected = [], staticRequests = [];
  const originalState = JSON.stringify(state);
  const allowed = new Set(fs.readdirSync(appRoot, { recursive: true }).filter(file => fs.statSync(path.join(appRoot, file)).isFile()));
  const server = http.createServer((request, response) => {
    const file = new URL(request.url, "http://fixture").pathname.slice(1); staticRequests.push(file);
    if (!allowed.has(file)) return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" });
    response.end(fs.readFileSync(path.join(appRoot, file)));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/runtime-config.js", route => route.fulfill({ contentType: "text/javascript", body: "window.PIRES_CONFIG=" + JSON.stringify(config) + ";" }));
    await context.route("**/vendor/supabase.js", route => route.fulfill({ contentType: "text/javascript", body: sdkFixture() }));
    await context.route("https://**/*", async route => {
      const request = route.request();
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization,apikey,Content-Type,X-Pires-Tenant" };
      if (!request.url().startsWith(edgeRoot)) { unexpected.push(request.url()); return route.abort(); }
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const resource = request.url().slice(edgeRoot.length), headers = request.headers();
      calls.push({ method: request.method(), resource });
      assert.equal(request.method(), "GET", "Commercial consultation must never write");
      assert.equal(headers.authorization, "Bearer fixture.header.signature");
      const json = value => route.fulfill({ headers: cors, json: value });
      if (resource === "status") return json({ mode: "supabase_integrado", user_id: ids.user, actor: "commercial@fixture.invalid",
        capabilities: { write: Boolean(headers["x-pires-tenant"]), operations: true, documentOriginals: true, photoOriginals: true, xlsx: true, pdf: false, xls: false } });
      if (resource === "tenants") return json([{ id: ids.tenant, name: "Empresa licenciada sintética" }]);
      assert.equal(headers["x-pires-tenant"], ids.tenant);
      if (resource === "companies") return json([owner]);
      if (resource === `companies/${ids.owner}/state`) return json(state);
      unexpected.push(resource); return route.fulfill({ status: 404, headers: cors, json: { error: "Unexpected fixture read" } });
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:" + server.address().port + "/gestao.html");
    await page.locator(`#company option[value="${ids.owner}"]`).waitFor({ state: "attached" });
    await page.locator("#company").selectOption(ids.owner);
    await page.getByRole("heading", { name: owner.name, exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.__commercialAuthOptions.auth.storageKey)), "pires-auth-v1");

    for (const module of ["integridade", "rtis", "nr13", "valvulas"]) {
      await navigate(page, module, "contratos");
      const panels = page.locator("#flowView [data-commercial-reference]");
      assert.equal(await panels.count(), 2, `${module}: commercial references must not depend on modules[]`);
      const commercial = page.locator(`[data-commercial-reference="${ids.commercial}"]`);
      assert.match(await commercial.innerText(), /Proposta\/referência comercial/);
      assert.match(await commercial.innerText(), /Fechamento confirmado pelo titular/);
      assert.equal(await commercial.getByRole("button", { name: "Ver escopo", exact: true }).count(), 0);
      assert.equal(await commercial.getByRole("button", { name: "Ativos deste escopo", exact: true }).count(), 0);
      assert.equal(await page.locator(`#flowView button[data-record-id="${ids.unsafe}"][data-flow-view="ativos"]`).count(), 0);
      assert.equal(await page.locator(`#flowView button[data-record-id="${ids.operational}"][data-flow-view="escopo"]`).count(), module === "integridade" ? 1 : 0);
      await fits(page, 1440, `${module}: lista desktop`);
      await fits(page, 375, `${module}: lista mobile`);
    }

    await navigate(page, "integridade", "contratos");
    const commercial = page.locator(`[data-commercial-reference="${ids.commercial}"]`);
    assert.deepEqual((await fieldPairs(commercial)).filter(([label]) => ["Valor confirmado", "Primeira parcela", "Segunda e última parcela"].includes(label)), [
      ["Valor confirmado", "R$ 90.071.992.547.409,91"], ["Primeira parcela", "R$ 45.035.996.273.704,95"], ["Segunda e última parcela", "R$ 45.035.996.273.704,96"],
    ]);
    await commercial.getByRole("button", { name: "Consultar referência comercial", exact: true }).click();
    await page.waitForFunction(reference => location.hash.endsWith("/escopo/" + reference), ids.commercial);
    assert.ok(!new URLSearchParams((await page.evaluate(() => location.hash)).split("?")[1] || "").has("contrato"));
    const details = page.locator(`[data-commercial-reference="${ids.commercial}"]`);
    const pairs = new Map(await fieldPairs(details));
    assert.equal(pairs.get("Escopo operacional"), "Escopo de ativos a definir");
    assert.equal(pairs.get("Número do contrato assinado"), "A confirmar");
    assert.equal(pairs.get("Assinatura"), "A confirmar"); assert.equal(pairs.get("Vigência"), "A confirmar");
    assert.equal(pairs.get("Original documental"), "Original ainda não verificado nesta instância");
    assert.equal(pairs.get("CNPJ da prestadora na fonte"), reference.commercial.issuerCnpjRaw);
    assert.equal(pairs.get("Cliente documentado"), reference.commercial.customerNameRaw);
    assert.equal(pairs.get("Serviço descrito na fonte"), reference.commercial.serviceScopeRaw);
    assert.equal(pairs.get("Referência da confirmação"), reference.userConfirmation.evidenceRef);
    const source = details.getByRole("link", { name: "Abrir fonte documental privada", exact: true });
    assert.equal(await source.getAttribute("href"), sourceURL); assert.equal(await source.getAttribute("target"), "_blank");
    assert.deepEqual((await source.getAttribute("rel")).split(/\s+/).sort(), ["noopener", "noreferrer"]);
    assert.equal(await source.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(await details.getByRole("button").count(), 0, "Commercial details contain no operational action");
    await fits(page, 1440, "Referência detalhada desktop"); await fits(page, 375, "Referência detalhada mobile");

    await navigate(page, "integridade", "escopo", ids.unsafe);
    const unsafe = page.locator(`[data-commercial-reference="${ids.unsafe}"]`);
    assert.match(await unsafe.innerText(), /Análise crítica \/ referência comercial/);
    assert.equal(new Map(await fieldPairs(unsafe)).get("Valor confirmado"), "Valor a confirmar");
    assert.equal(await unsafe.locator("a").count(), 0, "Unsafe source URL must not become a link");
    assert.match(await unsafe.innerText(), /Link documental seguro não disponível/);
    assert.equal(await page.locator('a[href^="javascript:"]').count(), 0);
    assert.equal(await page.evaluate(() => window.__unsafeCommercialLink), undefined);
    await fits(page, 375, "Fonte insegura mobile");

    await navigate(page, "integridade", "campanhas");
    const contractSelect = page.locator('form[data-operation="campaigns"] select[name="contractId"]');
    await contractSelect.waitFor({ state: "attached" });
    assert.deepEqual(await contractSelect.locator("option").evaluateAll(options => options.map(option => option.value)), ["", ids.operational]);
    await page.locator('form[data-operation="campaigns"]').evaluate(form => form.closest("details").open = true);
    await contractSelect.evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event("change")); }, ids.commercial);
    assert.equal(await contractSelect.inputValue(), "", "Commercial reference cannot be selected as a campaign contract");
    await contractSelect.evaluate((select, value) => { select.value = value; select.dispatchEvent(new Event("change")); }, ids.unsafe);
    assert.equal(await contractSelect.inputValue(), "", "Commercial class excludes stale modules/asset IDs too");
    await fits(page, 1440, "Campanha desktop"); await fits(page, 375, "Campanha mobile");

    assert.deepEqual(calls.filter(call => call.method !== "GET"), []);
    assert.equal(JSON.stringify(state), originalState, "Read-only consultation preserves fixture originals");
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    assert.ok(!staticRequests.some(resource => resource.startsWith("api/")));
    await context.close();
    console.log("PASS referências comerciais (fixtures isoladas, somente leitura): quatro módulos, separação de contratos operacionais, centavos BRL exatos e duas parcelas, confirmação/assinatura/vigência/original honestos, links HTTPS seguros, referências excluídas de campanhas, desktop1440/mobile375 sem overflow e nenhuma gravação.");
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
