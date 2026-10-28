"use strict";
// UI-only regression harness: all identities, assets and HTTP responses below
// are temporary fixtures. Nothing is seeded into the application or a database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  unit: "66666666-6666-4666-8666-666666666666",
  system: "77777777-7777-4777-8777-777777777777",
  line: "88888888-8888-4888-8888-888888888888",
  vessel: "99999999-9999-4999-8999-999999999999",
  valve: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tank: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  off: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  inspection: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  openRtiA: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  openRtiB: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  closedRti: "10101010-1010-4010-8010-101010101010",
  contract: "20202020-2020-4020-8020-202020202020",
  document: "30303030-3030-4030-8030-303030303030",
  ownerBAsset: "40404040-4040-4040-8040-404040404040",
  finding: "50505050-5050-4050-8050-505050505050",
};
const ORIGIN = "https://app.fixture.invalid";
const API = "https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const moduleLabels = {
  integridade: "Inspeção de Integridade",
  rtis: "Gestão de RTI",
  nr13: "Gestão NR-13",
  valvulas: "Gestão de Certificação de Válvulas",
};
const config = (integrated) => ({
  mode: "connected", ...(integrated ? { gestao: { backend: "supabase" } } : {}),
  supabaseUrl: "https://fixtureproject.supabase.co",
  publishableKey: "sb_" + "publishable_" + "ui_fixture_not_a_real_key",
  appUrl: ORIGIN, privacyEmail: "privacy@fixture.invalid",
});
function stateFixture(ownerId) {
  const company = { id: ownerId, name: ownerId === ids.ownerA ? "CLIENTE A FIXTURE ISOLADA" : "CLIENTE B FIXTURE ISOLADA", source: "Fonte sintética exclusiva de teste" };
  const asset = (id, tag, type, extra = {}) => ({
    id, tag, type, unitId: ids.unit, systemId: ids.system,
    operation: "nao_informado", technicalCondition: "nao_avaliado", technical: {},
    source: { fixture: true }, ...extra,
  });
  const rtiOrigin = { clientId: ownerId, contractId: ids.contract, assetId: ids.line, inspectionId: ids.inspection, findingId: ids.finding };
  return {
    company,
    unit: [{ id: ids.unit, name: "UNIDADE FIXTURE" }],
    system: [{ id: ids.system, unitId: ids.unit, name: "SISTEMA FIXTURE" }],
    asset: ownerId === ids.ownerA ? [
      asset(ids.line, "LINHA-FIXTURE", "linha", { operation: "em_operacao", operationEvidence: "Situação operacional documentada na fixture" }),
      asset(ids.vessel, "VASO-FIXTURE", "vaso", { operation: "em_operacao", technical: { fluid: { value: "AR FIXTURE", unit: null, source: "Fonte sintética" } } }),
      asset(ids.valve, "PSV-FIXTURE", "valvula"),
      asset(ids.tank, "TANQUE-FIXTURE", "tanque"),
      asset(ids.off, "PARADO-FIXTURE", "linha", { operation: "fora_de_operacao", operationEvidence: "Motivo de parada documentado na fixture" }),
    ] : [asset(ids.ownerBAsset, "ATIVO-EXCLUSIVO-B-FIXTURE", "linha")],
    contract: ownerId === ids.ownerA ? [{ id: ids.contract, name: "CONTRATO FIXTURE", source: "Fonte sintética", modules: ["integridade", "rtis", "nr13", "valvulas"], assetIds: [ids.line, ids.vessel, ids.valve, ids.tank, ids.off] }] : [],
    document: [{ id: ids.document, assetId: ids.vessel, module: "nr13", type: "DOCUMENTO FIXTURE", applicability: "pendente" }],
    revision: [],
    classification: ownerId === ids.ownerA ? [
      { id: "61616161-6161-4161-8161-616161616161", assetId: ids.vessel, reviewStatus: "revisado", inputs: { nrProfile: "cylindrical" }, result: { scope: "covered", profileId: "cylindrical", family: "vessel", category: "III", fluidClass: "C" } },
      // Deliberately incompatible saved input: a tank must not inherit vessel category.
      { id: "71717171-7171-4171-8171-717171717171", assetId: ids.tank, reviewStatus: "revisado", inputs: { nrProfile: "cylindrical" }, result: { scope: "covered", profileId: "cylindrical", family: "vessel", category: "III", fluidClass: "A" } },
    ] : [],
    deadline: ownerId === ids.ownerA ? [{ id: "81818181-8181-4181-8181-818181818181", assetId: ids.vessel, type: "externa", due: "2027-01-15", basis: "Prazo sintético documentado" }] : [],
    rti: ownerId === ids.ownerA ? [
      { id: ids.openRtiA, assetId: ids.line, contractId: ids.contract, title: "RTI ABERTA A FIXTURE", status: "aberta", currentness: "confirmed_current", currentnessConfirmedAt: "2026-10-26T12:00:00Z", currentnessEvidence: "Confirmação atual sintética exclusiva desta fixture", due: "2026-11-01", source: "Achado sintético", origin: rtiOrigin, cause: { status: "confirmed", description: "Causa confirmada somente na fixture" }, actions: [{ description: "Ação documentada somente na fixture" }] },
      { id: ids.openRtiB, assetId: ids.line, contractId: ids.contract, title: "RTI ABERTA B FIXTURE", status: "aberta", currentness: "unknown", sourceStatus: "aberta", sourceDate: "2019-01-01", due: "2026-11-03", source: "Outro achado sintético", origin: rtiOrigin, cause: { status: "investigation", description: "Causa em investigação na fixture" }, actions: [] },
      { id: ids.closedRti, assetId: ids.line, contractId: ids.contract, title: "RTI ENCERRADA FIXTURE", status: "encerrada", due: "2026-10-01", closedAt: "2026-10-20T00:00:00Z", closureEvidence: "Histórico sintético preservado", source: "Fonte sintética", origin: rtiOrigin },
    ] : [],
    inspection: ownerId === ids.ownerA ? [{ id: ids.inspection, assetId: ids.line, contractId: ids.contract, module: "integridade", type: "visual", done: "2026-10-26", executionSource: "Execução sintética; sem aprovação técnica" }] : [],
    delivery: [],
    findings: ownerId === ids.ownerA ? [{ id: ids.finding, assetId: ids.line, inspectionId: ids.inspection, description: "ACHADO ISOLADO FIXTURE" }] : [],
    relations: ownerId === ids.ownerA ? [{ fromAssetId: ids.vessel, toAssetId: ids.valve, kind: "valvula_psv" }] : [],
  };
}
function sdkFixture({ authenticated = true, role = "admin" } = {}) {
  return `
    window.__flowAuth = ${JSON.stringify({ authenticated, role })};
    window.__flowSdkCalls = [];
    window.PiresSupabase = { createClient(url,key,options) {
      const state = window.__flowAuth;
      const user = () => state.authenticated ? {id:${JSON.stringify(ids.user)},email:'operator@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z',is_anonymous:false} : null;
      return { auth: {
        getSession: async () => ({data:{session:state.authenticated?{access_token:'fixture-ui-jwt'}:null},error:null}),
        getUser: async () => ({data:{user:user()},error:null}),
        signInWithPassword: async (values) => {
          if(values.email==='wrong@fixture.invalid') return {data:{},error:{code:'invalid_credentials'}};
          state.authenticated=true;return {data:{},error:null};
        },
        signOut: async () => {state.authenticated=false;return {error:null};},
        onAuthStateChange: () => ({data:{subscription:{unsubscribe(){}}}})
      }, rpc: async (name,args) => {
        window.__flowSdkCalls.push({name,args});
        if(name==='pi_my_company_access') return {data:[{id:${JSON.stringify(ids.tenantA)},name:'EMPRESA DE ACESSO A FIXTURE'},{id:${JSON.stringify(ids.tenantB)},name:'EMPRESA DE ACESSO B FIXTURE'}],error:null};
        if(name==='pi_access_status_v3') return {data:{version:3,user_id:${JSON.stringify(ids.user)},status:'active',is_master:false,company_id:args?.p_company_id||${JSON.stringify(ids.tenantA)},company_role:state.role,activated_at:'2026-01-01T00:00:00Z',expires_at:'2027-01-01T00:00:00Z',server_now:'2026-10-26T16:00:00Z',license_scope:'company',plan_kind:'subscription'},error:null};
        return {data:null,error:{code:'unexpected_fixture_rpc'}};
      }};
    }};`;
}

async function staticServer() {
  const root = path.resolve(__dirname, "../app");
  const allowed = new Set(fs.readdirSync(root, { recursive: true }).filter(file => fs.statSync(path.join(root, file)).isFile()));
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, "http://fixture").pathname.slice(1);
    if (!allowed.has(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(path.join(root, file)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, base: "http://127.0.0.1:" + server.address().port };
}

async function makePage(browser, base, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage(), requests = [], errors = [], unexpected = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(error.message));
  const states = { [ids.tenantA]: stateFixture(ids.ownerA), [ids.tenantB]: stateFixture(ids.ownerB) };
  const owners = { [ids.tenantA]: ids.ownerA, [ids.tenantB]: ids.ownerB };
  const pendingStates = new Map();
  function holdState(ownerId) {
    let release, received;
    const wait = new Promise(resolve => { release = resolve; });
    const pending = new Promise(resolve => { received = resolve; });
    pendingStates.set(ownerId, { wait, received });
    return { pending, release() { pendingStates.delete(ownerId); release(); } };
  }
  await context.route("**/*", route => {
    if (route.request().url().startsWith(base + "/") || route.request().url().startsWith(API)) return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  await context.route("**/runtime-config.js", route => route.fulfill({ contentType: "text/javascript", body: "window.PIRES_CONFIG=" + JSON.stringify(config(options.integrated === true)) + ";" }));
  await context.route("**/vendor/supabase.js", route => route.fulfill({ contentType: "text/javascript", body: sdkFixture(options) }));
  await context.route(API + "**", async route => {
    const request = route.request();
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-pires-tenant", "Access-Control-Expose-Headers": "Content-Disposition" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const resource = request.url().slice(API.length), tenant = request.headers()["x-pires-tenant"];
    requests.push({ resource, tenant, method: request.method() });
    const json = (body, status = 200) => route.fulfill({ json: body, status, headers });
    if (!options.integrated) { unexpected.push("authOnly called " + resource); return json({ error: "Operational API must remain unused" }, 500); }
    if (request.method() !== "GET") { unexpected.push("write " + resource); return json({ error: "Read-only fixture" }, 405); }
    if (resource === "status") return json({ actor: "OPERATOR FIXTURE", user_id: ids.user, mode: "supabase_integrado", capabilities: { xlsx: true, pdf: false, xls: false, xlsxMaxBytes: 8388608, write: false } });
    if (resource === "tenants") return json([{ id: ids.tenantA, name: "EMPRESA DE ACESSO A FIXTURE" }, { id: ids.tenantB, name: "EMPRESA DE ACESSO B FIXTURE" }]);
    if (!owners[tenant]) { unexpected.push("tenant missing " + resource); return json({ error: "Tenant fixture required" }, 403); }
    if (resource === "companies") return json([states[tenant].company]);
    if (resource === `companies/${owners[tenant]}/state`) {
      const gate = pendingStates.get(owners[tenant]);
      if (gate) { gate.received(); await gate.wait; }
      return json(states[tenant]);
    }
    if (resource.startsWith(`companies/${owners[tenant]}/history/`)) return json([]);
    unexpected.push(resource);
    return json({ error: "Unexpected fixture route" }, 404);
  });
  await page.goto(base + "/gestao.html");
  return { page, context, requests, errors, unexpected, states, holdState };
}

module.exports = { ids, moduleLabels, makePage, staticServer, stateFixture };

async function navigate(page, client, module, view, item = "_", contract = "") {
  const hash = "#gestao/" + [client || "_", module || "modulos", view, item].join("/") + (contract ? "?contrato=" + contract : "");
  await page.evaluate(value => { location.hash = value; }, hash);
  await page.waitForFunction(({ module, view }) => {
    const node = document.getElementById("flowView");
    return node?.dataset.module === module && node.dataset.view === view;
  }, { module: module || "", view });
}
async function noHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    "Fluxo mobile não pode exigir rolagem horizontal");
}
async function main() {
  const { server, base } = await staticServer();
  const output = path.resolve(__dirname, "../output");
  fs.mkdirSync(output, { recursive: true });
  let browser;
  const checks = [];
  const record = name => checks.push({ name, passed: true });
  try {
    browser = await chromium.launch({ executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const h = await makePage(browser, base, { integrated: true });
    const page = h.page;
    await page.locator("#tenantAccess:not([hidden])").waitFor();
    await page.locator("#tenant").selectOption(ids.tenantA);
    await page.locator(`#company option[value='${ids.ownerA}']`).waitFor({ state: "attached" });
    await page.locator("#company").selectOption(ids.ownerA);
    await page.locator("#flowView > h1").filter({ hasText: "CLIENTE A FIXTURE" }).waitFor();
    assert.equal(await page.locator("#flowView .flow-module-card").count(), 4);
    assert.equal(await page.locator("#legacyPanels").isVisible(), false);
    assert.match(await page.locator("#flowBreadcrumb").innerText(), /CLIENTE A FIXTURE/);
    assert.notEqual(await page.locator("#tenant").inputValue(), await page.locator("#company").inputValue());
    record("cliente selecionado precede quatro módulos e difere do tenant licenciado");

    for (const [module, label] of Object.entries(moduleLabels)) {
      await page.locator(`#flowView .flow-module-card button[data-module='${module}']`).click();
      await page.waitForFunction(module => document.getElementById("flowView").dataset.module === module, module);
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
      assert.equal(await page.locator("#flowView").getAttribute("data-module"), module);
      await page.locator("#flowView button[data-flow-view=contratos]").click();
      await page.getByRole("heading", { name: "CONTRATO FIXTURE", exact: true }).waitFor();
      await page.getByRole("button", { name: "Ver escopo", exact: true }).click();
      await page.getByRole("heading", { name: "Escopo do contrato", exact: true }).waitFor();
      assert.match(page.url(), new RegExp("contrato=" + ids.contract));
      await page.locator("#flowBack").click();
      await page.waitForFunction(() => document.getElementById("flowView").dataset.view === "contratos");
      await page.locator("#flowBack").click();
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
      await page.locator("#flowBack").click();
      await page.locator("#flowView .flow-module-card").first().waitFor();
    }
    record("entrada e retorno dos quatro módulos mantêm contrato e escopo dentro do cliente");

    await navigate(page, ids.ownerA, "integridade", "ativos", ids.system);
    const lineCard = page.locator("#assets article").filter({ has: page.getByRole("heading", { name: "LINHA-FIXTURE", exact: true }) });
    await lineCard.waitFor();
    assert.equal(await lineCard.evaluate(node => node.classList.contains("has-open-rti")), true);
    const entry = lineCard.locator(".."), indicator = entry.locator(":scope > .operation-indicator");
    assert.equal(await indicator.getAttribute("data-tone"), "green");
    assert.equal(await lineCard.locator(".operation-indicator").count(), 0);
    assert.equal(((await lineCard.innerText()).match(/RTI: RTI ABERTA/g) || []).length, 2);
    assert.equal(await lineCard.locator(".light.red").count(), 1);
    assert.match(await lineCard.innerText(), /situação atual não confirmada/);
    assert.match(await lineCard.innerText(), /2019-01-01/);
    assert.equal(await indicator.evaluate(node => getComputedStyle(node, "::before").animationName), "none");
    const offCard = page.locator("#assets article").filter({ has: page.getByRole("heading", { name: "PARADO-FIXTURE", exact: true }) });
    assert.equal(await offCard.locator("..").locator(":scope > .operation-indicator").getAttribute("data-tone"), "red");
    assert.equal(await offCard.locator("..").locator(":scope > .operation-indicator").getAttribute("title"), "Motivo de parada documentado na fixture");
    assert.match(await offCard.locator("..").innerText(), /Motivo de parada documentado na fixture/);
    record("indicador operacional externo e reduzido, RTI no card inteiro e motivo da parada independentes");

    await navigate(page, ids.ownerA, "nr13", "ativos");
    const vessel = page.locator("#assets article").filter({ has: page.getByRole("heading", { name: "VASO-FIXTURE", exact: true }) });
    const tank = page.locator("#assets article").filter({ has: page.getByRole("heading", { name: "TANQUE-FIXTURE", exact: true }) });
    await vessel.waitFor();
    assert.match(await vessel.innerText(), /III/);
    assert.match(await vessel.innerText(), /AR FIXTURE/);
    assert.match(await vessel.innerText(), /2027-01-15/);
    assert.doesNotMatch(await tank.innerText(), /\bIII\b/);
    assert.match(await tank.innerText(), /incompatíveis|Pendente/);
    record("NR-13 distingue categoria, fluido e prazo e não herda categoria de vaso em tanque");

    await navigate(page, ids.ownerA, "nr13", "book", ids.vessel);
    await page.getByRole("heading", { name: "PSV-FIXTURE", exact: true }).waitFor();
    const relation = page.locator("#flowView section").filter({ has: page.getByRole("heading", { name: "PSV-FIXTURE", exact: true }) }).last();
    await relation.getByRole("button", { name: "Abrir ativo relacionado", exact: true }).click();
    await page.waitForFunction(id => location.hash.includes("/valvulas/book/" + id), ids.valve);
    await page.locator("#flowView > h1").filter({ hasText: "PSV-FIXTURE" }).waitFor();
    assert.match(await page.locator("#flowView h1").innerText(), /PSV-FIXTURE/);
    assert.match(await page.locator("#flowView").innerText(), new RegExp(ids.valve));
    await page.evaluate(hash => { location.hash = hash; }, `#gestao/${ids.ownerA}/nr13/book/${ids.ownerBAsset}`);
    await page.waitForFunction(() => document.getElementById("flowView").dataset.view === "inicio");
    assert.doesNotMatch(await page.locator("#flowView").innerText(), /ATIVO-EXCLUSIVO-B/);
    record("book usa relação canônica PSV do cliente e rejeita ID de outro cliente");

    await navigate(page, ids.ownerA, "rtis", "fila");
    for (const id of [ids.openRtiA, ids.openRtiB, ids.closedRti])
      assert.equal(await page.locator(`#flowView [data-rti-id='${id}']`).count(), 1);
    assert.equal(await page.locator("#flowView [data-rti-id]").count(), 3);
    await page.locator(`#flowView [data-rti-id='${ids.openRtiA}']`).getByRole("button", { name: "Abrir RTI", exact: true }).click();
    await page.getByRole("heading", { name: "Origem da RTI", exact: true }).waitFor();
    assert.match(await page.locator("#flowView").innerText(), new RegExp(ids.inspection));
    assert.match(await page.locator("#flowView").innerText(), /Causa confirmada somente na fixture/);
    await page.getByRole("button", { name: "Voltar ao achado de origem", exact: true }).click();
    await page.waitForFunction(id => location.hash.includes("/integridade/achados/" + id), ids.finding);
    assert.equal(await page.locator(`#flowView button[data-record-id='${ids.openRtiA}']`).count(), 1);
    assert.equal(await page.locator(`#flowView button[data-record-id='${ids.openRtiB}']`).count(), 1);
    await navigate(page, ids.ownerA, "rtis", "detalhe", ids.closedRti);
    assert.match(await page.locator("#flowView").innerText(), /encerrada preservada no histórico/);
    assert.match(await page.locator("#flowView").innerText(), /Histórico sintético preservado/);
    record("RTIs múltiplas mantêm IDs próprios, origem inspeção/achado e histórico encerrado");

    await page.setViewportSize({ width: 390, height: 844 });
    for (const module of Object.keys(moduleLabels)) {
      await navigate(page, ids.ownerA, module, "inicio");
      await noHorizontalOverflow(page);
    }
    for (const [module, view, item] of [["integridade", "ativos", ids.system], ["nr13", "ativos", "_"], ["nr13", "book", ids.vessel], ["rtis", "fila", "_"], ["rtis", "detalhe", ids.openRtiA], ["valvulas", "book", ids.valve]]) {
      await navigate(page, ids.ownerA, module, view, item);
      await noHorizontalOverflow(page);
    }
    const held = h.holdState(ids.ownerA);
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await held.pending;
    await page.locator("#tenant").selectOption(ids.tenantB);
    await page.locator(`#company option[value='${ids.ownerB}']`).waitFor({ state: "attached" });
    await page.locator("#company").selectOption(ids.ownerB);
    await page.locator("#flowView > h1").filter({ hasText: "CLIENTE B FIXTURE" }).waitFor();
    const lateResponse = page.waitForResponse(response => response.url() === API + `companies/${ids.ownerA}/state`);
    held.release();
    await lateResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.match(page.url(), new RegExp(ids.ownerB));
    assert.doesNotMatch(await page.locator("#flowView").innerText(), /CLIENTE A|LINHA-FIXTURE|RTI ABERTA A/);
    assert.equal(await page.locator("#detail").isVisible(), false);
    assert.equal(h.requests.some(request => request.method !== "GET"), false);
    assert.deepEqual(h.errors, []);
    assert.deepEqual(h.unexpected, []);
    record("mobile 390, troca de tenant e cliente limpam contexto anterior sem gravações operacionais");
    await h.context.close();

    const empty = await makePage(browser, base, { integrated: false });
    await empty.page.locator("#tenantAccess:not([hidden])").waitFor();
    await empty.page.locator("#tenant").selectOption(ids.tenantA);
    await empty.page.locator("#flowView .flow-module-card").first().waitFor();
    let viewChecks = 0;
    for (const width of [1440, 390]) {
      await empty.page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      for (const module of Object.keys(moduleLabels)) {
        await navigate(empty.page, null, module, "inicio");
        const viewButtons = await empty.page.locator("#flowView .flow-view-grid button[data-flow-view]").evaluateAll(nodes => nodes.map(node => node.dataset.flowView));
        assert.ok(viewButtons.length >= 5);
        for (const view of viewButtons) {
          await navigate(empty.page, null, module, view);
          assert.doesNotMatch(await empty.page.locator("#flowView").innerText(), /CLIENTE A|LINHA-FIXTURE|VASO-FIXTURE|RTI ABERTA/);
          assert.equal(await empty.page.locator("#flowView button:not([disabled])").filter({ hasText: /^(Salvar|Criar campanha|Registrar ação|Emitir|Cadastrar contrato)/ }).count(), 0);
          await noHorizontalOverflow(empty.page);
          viewChecks++;
        }
      }
    }
    await empty.page.setViewportSize({ width: 1440, height: 1000 });
    await navigate(empty.page, null, "", "inicio");
    await empty.page.locator("#flowView").screenshot({ path: path.join(output, "gestao-flow-empty-desktop.png") });
    await empty.page.setViewportSize({ width: 390, height: 844 });
    await navigate(empty.page, null, "nr13", "book");
    await noHorizontalOverflow(empty.page);
    await empty.page.locator("#flowView").screenshot({ path: path.join(output, "gestao-flow-empty-mobile.png") });
    assert.deepEqual(empty.requests, []);
    assert.deepEqual(empty.errors, []);
    assert.deepEqual(empty.unexpected, []);
    await empty.page.evaluate(() => { window.__flowAuth.role = "client"; window.dispatchEvent(new Event("focus")); });
    await empty.page.waitForFunction(() => document.getElementById("workspace").hidden);
    assert.equal(await empty.page.locator("#flowView .flow-module-card").count(), 0);
    assert.deepEqual(empty.requests, []);
    await empty.context.close();
    record("modo conta sem integração navega telas vazias e não chama gestao-api nem simula gravação");

    const invalid = await makePage(browser, base, { integrated: false, authenticated: false });
    await invalid.page.locator("#connectedLoginForm:not([hidden])").waitFor();
    await invalid.page.locator("#connectedLoginForm input[name=email]").fill("wrong@fixture.invalid");
    await invalid.page.locator("#connectedLoginForm input[name=password]").fill("wrong-password");
    await invalid.page.locator("#connectedLoginForm button").click();
    await invalid.page.waitForFunction(() => /senha inválid|credenciais|autenticar/i.test(document.getElementById("message").textContent));
    assert.equal(await invalid.page.locator("#workspace").isVisible(), false);
    assert.deepEqual(invalid.requests, []);
    await invalid.context.close();
    const clientRole = await makePage(browser, base, { integrated: false, role: "client" });
    await clientRole.page.locator("#tenantAccess:not([hidden])").waitFor();
    const previousMessage = await clientRole.page.locator("#message").innerText();
    await clientRole.page.locator("#tenant").selectOption(ids.tenantA);
    await clientRole.page.waitForFunction(previous => document.getElementById("message").textContent !== previous, previousMessage);
    assert.equal(await clientRole.page.locator("#workspace").isVisible(), false);
    assert.deepEqual(clientRole.requests, []);
    await clientRole.context.close();
    record("login inválido e papel Cliente não liberam dados nem chamadas operacionais");
    fs.writeFileSync(path.join(output, "gestao-flow-qa.json"), JSON.stringify({ fixtureOnly: true, productScreenshotsContainClientsOrAssets: false, moduleViewChecks: viewChecks, checks }, null, 2));
    console.log(`PASS fluxo dos quatro módulos: ${checks.length} grupos e ${viewChecks} telas desktop/mobile, identidade e relações canônicas, RTIs e estados operacionais; modo conta sem API operacional. Somente capturas vazias foram produzidas.`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
