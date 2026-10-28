"use strict";
// UI contract test: fake account/HTTP records held only by this test process.
// It starts a read-only static file server, never the private asset API or a database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { createHash } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const { chromium } = require("playwright");

const id = (n) => "f0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = { tenant: id(1), user: id(2), owner: id(3), unit: id(4), system: id(5), asset: id(6), historicalRti: id(7),
  contract: id(8), campaign: id(9), inspection: id(10), lvtDocument: id(11), lvt: id(12), finding: id(13), rtiDocument: id(14), rti: id(15), relation: id(16),
  importedRti: id(17), lvtItem: id(18), photo: id(19) };
const edgeRoot = "https://fixtureproject.supabase.co/functions/v1/gestao-api/";
const config = { mode: "connected", gestao: { backend: "supabase" }, supabaseUrl: "https://fixtureproject.supabase.co",
  publishableKey: "sb_" + "publishable_" + "operations_fixture_not_real", appUrl: "https://app.fixture.invalid", privacyEmail: "privacy@fixture.invalid" };
const sourceId = "a".repeat(64);
function photoFixture() {
  const chunk = (type, bytes) => {
    const content = Buffer.concat([Buffer.from(type), bytes]), result = Buffer.alloc(bytes.length + 12);
    result.writeUInt32BE(bytes.length); content.copy(result, 4);
    let crc = 0xffffffff;
    for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length + 8); return result;
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND", Buffer.alloc(0))]);
}
const owner = { id: ids.owner, name: "Cliente do teste operacional", source: "Cadastro sintético isolado" };
const initialState = () => ({ company: owner,
  unit: [{ id: ids.unit, name: "Unidade do teste" }], system: [{ id: ids.system, unitId: ids.unit, name: "Sistema do teste" }],
  asset: [{ id: ids.asset, tag: "LINHA-OPERACIONAL-FIXTURE", type: "linha", unitId: ids.unit, systemId: ids.system,
    operation: "em_operacao", technical: {}, source: { format: "xlsx", sourceId, sheet: "Lista fixture ", row: 16 } }],
  contract: [], campaign: [], inspection: [], document: [], lvt: [], lvtItem: [], photo: [], finding: [], relation: [],
  rti: [{ id: ids.historicalRti, assetId: ids.asset, title: "RTI histórica da fixture", status: "unknown", sourceStatus: "aberta",
    currentness: "unknown", sourceDate: "2019-01-01", source: "Documento histórico da fixture", due: "2019-12-31" }],
  revision: [], classification: [], deadline: [], delivery: [],
});
function sdkScript() {
  return `window.__fixtureAuth=true;window.__fixtureRpc=[];window.PiresSupabase={createClient(url,key,options){
    window.__fixtureAuthOptions=options;
    return {auth:{
      getSession:async()=>({data:{session:window.__fixtureAuth?{access_token:'fixture.header.signature'}:null},error:null}),
      getUser:async()=>({data:{user:window.__fixtureAuth?{id:${JSON.stringify(ids.user)},email:'pilot@fixture.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'}:null},error:null}),
      signInWithPassword:async()=>{window.__fixtureAuth=true;return{data:{},error:null};},
      signOut:async()=>{window.__fixtureAuth=false;return{error:null};},
      onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})
    },rpc:async(name,args)=>{window.__fixtureRpc.push({name,args});
      if(name==='pi_my_company_access')return{data:[{id:${JSON.stringify(ids.tenant)},name:'Empresa de acesso da fixture'}],error:null};
      if(name==='pi_access_status_v3')return{data:{version:3,user_id:${JSON.stringify(ids.user)},status:'active',is_master:false,
        company_id:${JSON.stringify(ids.tenant)},company_role:'admin',activated_at:'2026-01-01T00:00:00Z',expires_at:null,
        server_now:'2026-10-26T12:00:00Z',license_scope:'company',plan_kind:'indefinite'},error:null};
      return{data:null,error:{code:'fixture_unknown_rpc'}};
    }};
  }};`;
}
async function setupContext(browser, configured, intercept) {
  const context = await browser.newContext();
  await context.route("**/runtime-config.js", route => route.fulfill({ contentType: "text/javascript", body: "window.PIRES_CONFIG=" + JSON.stringify(configured) + ";" }));
  await context.route("**/vendor/supabase.js", route => route.fulfill({ contentType: "text/javascript", body: sdkScript() }));
  await context.route("https://fixtureproject.supabase.co/**", intercept);
  return context;
}
async function navigate(page, module, view, item = "_", contract = "", client = ids.owner) {
  const hash = `#gestao/${client}/${module || "modulos"}/${view}/${item}` + (contract ? "?contrato=" + contract : "");
  await page.evaluate(next => { location.hash = next; }, hash);
  await page.waitForFunction(({ module, view }) => {
    const container = document.getElementById("flowView");
    return container.dataset.module === module && container.dataset.view === view;
  }, { module, view });
}
async function fillForm(form, values) {
  await form.evaluate(node => { for (let p = node; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true; });
  for (const [name, value] of Object.entries(values)) {
    const controls = form.locator(`[name="${name}"]`);
    const tag = await controls.first().evaluate(node => node.tagName.toLowerCase());
    const type = await controls.first().getAttribute("type");
    if (type === "file") await controls.setInputFiles(value);
    else if (type === "checkbox") {
      const chosen = Array.isArray(value) ? value : [value];
      for (const control of await controls.all()) await control.setChecked(chosen.includes(await control.inputValue()));
    } else if (tag === "select") await controls.selectOption(value);
    else await controls.fill(String(value));
  }
}
async function saveOperation(page, operation, values) {
  const form = page.locator(`form[data-operation="${operation}"]`);
  try { await form.waitFor({ state: "attached", timeout: 8000 }); }
  catch (error) {
    console.error("Fixture UI: " + JSON.stringify(await page.evaluate(() => ({ hash: location.hash,
      forms: [...document.querySelectorAll("form[data-operation]")].map(form => form.dataset.operation),
      message: document.getElementById("message").textContent, text: document.getElementById("flowView").textContent.slice(0, 700) }))));
    throw error;
  }
  await fillForm(form, values);
  if (operation === "findings" && values.recommendation)
    assert.equal(await form.locator('button[type="submit"]').innerText(), "Salvar recomendação e RTI");
  const written = page.waitForResponse(response => response.request().method() === "POST" && response.url() === `${edgeRoot}companies/${ids.owner}/${operation}`);
  const reloaded = page.waitForResponse(response => response.request().method() === "GET" && response.url() === `${edgeRoot}companies/${ids.owner}/state`);
  await form.locator('button[type="submit"]').click();
  assert.ok((await written).ok(), operation + " must be confirmed by the API fixture");
  assert.ok((await reloaded).ok(), operation + " must read persisted records back");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function mobileFits(page, screen) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.document <= size.viewport, `${screen}: rolagem horizontal ${size.document}px para ${size.viewport}px`);
}

(async () => {
  const appRoot = path.resolve(__dirname, "../app"), state = initialState(), calls = [], files = new Map(), errors = [], unexpected = [];
  const allowed = new Set(fs.readdirSync(appRoot, { recursive: true }).filter(file => fs.statSync(path.join(appRoot, file)).isFile()));
  const staticRequests = [];
  const server = http.createServer((request, response) => {
    const file = new URL(request.url, "http://fixture").pathname.slice(1); staticRequests.push(file);
    if (!allowed.has(file)) return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "application/octet-stream" });
    response.end(fs.readFileSync(path.join(appRoot, file)));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  let browser, denied = false, nextEdge = 100;
  const relate = (fromKind, fromId, toKind, toId, relationType) => state.relation.push({ id: id(nextEdge++), fromKind, fromId, toKind, toId, relationType });
  try {
    browser = await chromium.launch({ executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization,apikey,Content-Type,X-Pires-Tenant,X-Pires-Source-Name" };
    const context = await setupContext(browser, config, async route => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const resource = request.url().slice(edgeRoot.length), headers = request.headers();
      const json = (value, status = 200) => route.fulfill({ status, headers: cors, json: value });
      calls.push({ resource, method: request.method(), tenant: headers["x-pires-tenant"] });
      if (!request.url().startsWith(edgeRoot)) { unexpected.push(request.url()); return json({ error: "Unexpected fixture endpoint" }, 404); }
      assert.equal(headers.authorization, "Bearer fixture.header.signature");
      if (denied) return json({ error: "Vínculo da fixture revogado", code: "access_denied" }, 403);
      if (resource === "status") return json({ user_id: ids.user, actor: "pilot@fixture.invalid", mode: "supabase_integrado", tenant: headers["x-pires-tenant"] || null,
        capabilities: { write: Boolean(headers["x-pires-tenant"]), operations: true, documentOriginals: true, photoOriginals: true, xlsx: true, pdf: false, xls: false } });
      if (resource === "tenants") return json([{ id: ids.tenant, name: "Empresa de acesso da fixture" }]);
      assert.equal(headers["x-pires-tenant"], ids.tenant);
      if (resource === "companies") return json([owner]);
      if (resource === `companies/${ids.owner}/state`) return json({ ...state, findings: state.finding, relations: state.relation });
      if (resource.startsWith(`companies/${ids.owner}/sources/`) && request.method() === "GET") {
        const original = files.get(resource.split("/").at(-1));
        if (!original) return json({ error: "Original fixture ausente" }, 404);
        return route.fulfill({ status: 200, headers: { ...cors, "Access-Control-Expose-Headers": "Content-Disposition", "Content-Type": original.mime,
          "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(original.name) }, body: original.bytes });
      }
      if (resource === `companies/${ids.owner}/book/${ids.asset}`) {
        const linked = new Set([ids.asset]);
        for (let added = true; added;) {
          added = false;
          for (const relation of state.relation) {
            if (linked.has(relation.fromId) && !linked.has(relation.toId)) { linked.add(relation.toId); added = true; }
            if (linked.has(relation.toId) && !linked.has(relation.fromId)) { linked.add(relation.fromId); added = true; }
          }
        }
        const records = ["contract", "campaign", "inspection", "document", "lvt", "lvtItem", "photo", "finding", "rti"]
          .flatMap(kind => state[kind].filter(record => linked.has(record.id)).map(record => ({ ...record, kind: kind === "lvtItem" ? "lvt_item" : kind })));
        return json({ assetId: ids.asset, records, relations: state.relation.filter(record => linked.has(record.fromId) && linked.has(record.toId)) });
      }
      if (["sources/document", "sources/photo"].includes(resource)) {
        const bytes = request.postDataBuffer(), sha = createHash("sha256").update(bytes).digest("hex");
        assert.equal(headers["content-type"], resource === "sources/document" ? "application/pdf" : "image/png");
        const name = decodeURIComponent(headers["x-pires-source-name"]);
        files.set(sha, { bytes: Buffer.from(bytes), name, mime: headers["content-type"] });
        return json({ id: sha, sha, name, format: resource === "sources/document" ? "document_pdf" : "photo_png", metadata: { extraction: "not_performed" } });
      }
      const operation = resource.replace(`companies/${ids.owner}/`, ""), body = request.postDataJSON();
      if (request.method() !== "POST") { unexpected.push(resource); return json({ error: "Unexpected fixture read" }, 404); }
      let record;
      if (operation === "contracts") {
        assert.deepEqual(body.modules, ["integridade"]); assert.deepEqual(body.assetIds, [ids.asset]);
        assert.match(body.requestId, /^[a-f0-9-]{36}$/i);
        record = { ...body, id: ids.contract, moduleAssetIds: { integridade: body.assetIds } }; state.contract.push(record);
        relate("contract", ids.contract, "asset", ids.asset, "scope_asset");
      } else if (operation === "campaigns") {
        assert.equal(body.contractId, ids.contract); assert.equal(body.status, "rascunho"); assert.deepEqual(body.assetIds, [ids.asset]);
        assert.equal(body.systemId, ids.system);
        assert.equal(body.plannedStart, null); assert.equal(body.plannedEnd, null);
        record = { ...body, id: ids.campaign }; state.campaign.push(record);
        relate("campaign", ids.campaign, "contract", ids.contract, "under_contract"); relate("campaign", ids.campaign, "asset", ids.asset, "campaign_asset");
      } else if (operation === "inspections") {
        assert.equal(body.campaignId, ids.campaign); assert.equal(body.contractId, ids.contract); assert.equal(body.assetId, ids.asset);
        assert.equal(body.type, "visual"); assert.equal(body.status, "planejada");
        record = { ...body, id: ids.inspection }; state.inspection.push(record);
        relate("inspection", ids.inspection, "campaign", ids.campaign, "in_campaign"); relate("inspection", ids.inspection, "asset", ids.asset, "inspects");
      } else if (operation === "documents") {
        assert.ok(files.has(body.sourceId));
        record = { ...body, id: body.documentType === "lvt" ? ids.lvtDocument : ids.rtiDocument, type: body.documentType,
          source: { sourceId: body.sourceId, locator: body.locator, name: files.get(body.sourceId).name }, currentness: "unknown" };
        state.document.push(record);
        if (body.assetId) relate("document", record.id, "asset", body.assetId, "documents_asset");
        if (body.campaignId) relate("document", record.id, "campaign", body.campaignId, "in_campaign");
      } else if (operation === "lvts") {
        assert.equal(body.inspectionId, ids.inspection); assert.equal(body.documentId, ids.lvtDocument); assert.equal(body.assetId, ids.asset);
        record = { ...body, id: ids.lvt, campaignId: ids.campaign, contractId: ids.contract }; state.lvt.push(record);
        relate("lvt", ids.lvt, "inspection", ids.inspection, "records_inspection"); relate("lvt", ids.lvt, "document", ids.lvtDocument, "original_document");
      } else if (operation === "lvt-items") {
        assert.equal(body.lvtId, ids.lvt); assert.equal(body.assetId, ids.asset); assert.ok(files.has(body.sourceId));
        record = { ...body, id: ids.lvtItem, source: { sourceId: body.sourceId, locator: body.locator } }; state.lvtItem.push(record);
      } else if (operation === "photos") {
        assert.equal(body.lvtItemId, ids.lvtItem); assert.equal(body.assetId, ids.asset); assert.ok(files.has(body.sourceId));
        record = { ...body, id: ids.photo, source: { sourceId: body.sourceId, locator: body.locator, name: files.get(body.sourceId).name } }; state.photo.push(record);
      } else if (operation === "findings") {
        assert.equal(body.lvtItemId, ids.lvtItem); assert.equal(body.assetId, ids.asset); assert.equal(body.sourceId, state.document[0].source.sourceId);
        assert.equal(body.recommendation, "Recomendação sintética documentada");
        const rti = { id: ids.rti, assetId: ids.asset, findingId: ids.finding, lvtItemId: ids.lvtItem, documentId: ids.lvtDocument, title: body.recommendation,
          recommendation: body.recommendation, originType: "documented_recommendation", issuedNumber: null, status: "atualidade_desconhecida",
          currentness: "unknown", sourceStatus: body.sourceStatus, sourceDate: body.sourceDate, source: { sourceId: body.sourceId, locator: body.locator },
          contractId: ids.contract, campaignId: ids.campaign,
          origin: { assetId: ids.asset, findingId: ids.finding, lvtId: ids.lvt, lvtItemId: ids.lvtItem,
            inspectionId: ids.inspection, campaignId: ids.campaign, contractId: ids.contract, clientId: ids.owner } };
        state.rti.push(rti);
        record = { ...body, id: ids.finding, lvtId: ids.lvt, inspectionId: ids.inspection, rti, source: { sourceId: body.sourceId, locator: body.locator } }; state.finding.push(record);
        relate("finding", ids.finding, "lvt", ids.lvt, "found_in"); relate("finding", ids.finding, "asset", ids.asset, "affects");
        relate("rti", ids.rti, "finding", ids.finding, "addresses"); relate("rti", ids.rti, "document", ids.lvtDocument, "opening_document"); relate("rti", ids.rti, "asset", ids.asset, "affects");
      } else if (operation === "rtis") {
        assert.equal(body.documentId, ids.rtiDocument); assert.equal(body.assetId, undefined); assert.equal(body.findingId, undefined);
        record = { ...body, id: ids.importedRti, status: "atualidade_desconhecida", sourceStatus: "aberta", currentness: "unknown", sourceDate: "2026-10-24",
          originType: "historical_rti_document", issuedNumber: null, source: state.document.find(item => item.id === ids.rtiDocument).source };
        state.rti.push(record);
        relate("rti", ids.importedRti, "document", ids.rtiDocument, "opening_document");
      } else if (operation === "relationships") {
        assert.deepEqual(body, { fromId: ids.importedRti, fromKind: "rti", toId: ids.asset, toKind: "asset", relationType: "affects" });
        state.rti.find(item => item.id === ids.importedRti).assetId = ids.asset;
        record = { ...body, id: ids.relation }; state.relation.push(record);
      } else { unexpected.push(resource); return json({ error: "Unexpected fixture write" }, 404); }
      return json(record);
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/gestao.html");
    await page.locator(`#company option[value="${ids.owner}"]`).waitFor({ state: "attached" });
    await page.locator("#company").selectOption(ids.owner);
    await page.getByRole("heading", { name: owner.name, exact: true }).waitFor();
    const modules = await page.locator("#flowView .flow-module-grid button[data-module]").evaluateAll(nodes => nodes.map(node => node.dataset.module));
    assert.deepEqual(modules.sort(), ["integridade", "nr13", "rtis", "valvulas"]);
    for (const module of modules) {
      await page.locator(`#flowView button[data-module="${module}"]`).click();
      await page.waitForFunction(module => document.getElementById("flowView").dataset.module === module, module);
      await page.locator("#flowBreadcrumb button").first().click();
      await page.locator("#flowView .flow-module-card").first().waitFor();
    }
    await navigate(page, "integridade", "sistemas");
    await page.locator(`#flowView [data-system-id="${ids.system}"]`).getByRole("button", { name: "Abrir TAGs deste sistema", exact: true }).click();
    await page.waitForFunction(system => location.hash.includes("/integridade/ativos/" + system), ids.system);
    const line = page.locator(`#assets article[data-asset-id="${ids.asset}"]`);
    assert.equal(await line.locator(".light.red").count(), 0);
    assert.equal(await line.evaluate(node => node.classList.contains("has-open-rti")), false);
    assert.match(await line.innerText(), /Atualidade desconhecida|situação atual não confirmada/i);

    await navigate(page, "integridade", "contratos");
    await saveOperation(page, "contracts", { name: "Contrato operacional fixture", source: "OS sintética isolada", assetIds: [ids.asset] });
    await navigate(page, "integridade", "campanhas", "_", ids.contract);
    await saveOperation(page, "campaigns", { name: "Campanha rascunho fixture", contractId: ids.contract, systemId: ids.system, assetIds: [ids.asset], source: "Planejamento sintético isolado" });
    await page.reload();
    await page.locator(`#company option[value="${ids.owner}"]`).waitFor({ state: "attached" });
    await page.locator("#company").selectOption(ids.owner);
    await page.getByRole("heading", { name: owner.name, exact: true }).waitFor();
    await navigate(page, "integridade", "campanhas", "_", ids.contract);
    assert.equal(state.campaign.length, 1);
    assert.match(await page.locator("#flowView").innerText(), /Campanha rascunho fixture/);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);

    await navigate(page, "integridade", "ativos", ids.system, ids.contract);
    await page.locator(`#assets article[data-asset-id="${ids.asset}"]`).getByRole("button", { name: "Abrir LVT desta TAG", exact: true }).click();
    await page.waitForFunction(asset => location.hash.includes("/integridade/lvt/" + asset), ids.asset);
    await saveOperation(page, "inspections", { campaignId: ids.campaign, assetId: ids.asset, type: "visual", source: "Planejamento visual sintético" });
    const lvtBytes = Buffer.from("%PDF-1.7\n% SYNTHETIC LVT TEST BYTES ONLY\n%%EOF\n");
    await saveOperation(page, "documents", { reference: "LVT original fixture", documentType: "lvt",
      original: { name: "lvt-fixture.pdf", mimeType: "application/pdf", buffer: lvtBytes },
      assetId: ids.asset, contractId: ids.contract, campaignId: ids.campaign, page: "1", section: "Achado da fixture" });
    await saveOperation(page, "lvts", { inspectionId: ids.inspection, documentId: ids.lvtDocument });
    await saveOperation(page, "lvt-items", { lvtId: ids.lvt, itemKey: "Item 01 fixture", component: "Trecho sintético", description: "Item sintético documentado", sourceDocumentId: ids.lvtDocument, page: "1", section: "Item da fixture" });
    await page.locator(`#flowView [data-lvt-item-id="${ids.lvtItem}"]`).getByRole("button", { name: "Abrir item, fotos e recomendação", exact: true }).click();
    await page.waitForFunction(item => location.hash.includes("/integridade/item/" + item), ids.lvtItem);
    const imageBytes = photoFixture();
    await saveOperation(page, "photos", { lvtItemId: ids.lvtItem, original: { name: "foto-item-fixture.png", mimeType: "image/png", buffer: imageBytes }, caption: "Imagem sintética do teste isolado", section: "Foto 01 do item fixture" });
    await page.getByRole("button", { name: "Ver fotografia original", exact: true }).click();
    await page.locator(`#flowView [data-photo-id="${ids.photo}"] img:not([hidden])`).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("#flowView img")].some(image => image.complete && image.naturalWidth === 1));
    assert.deepEqual(files.get(state.photo[0].source.sourceId).bytes, imageBytes);
    await mobileFits(page, "Item e fotografia");
    await saveOperation(page, "findings", { lvtItemId: ids.lvtItem, description: "Achado sintético com origem", recommendation: "Recomendação sintética documentada", sourceDocumentId: ids.lvtDocument, page: "1", section: "Achado da fixture", sourceStatus: "Recomendação na fonte", sourceDate: "2026-10-24" });
    assert.equal(state.finding[0].rti.id, ids.rti);
    assert.equal(calls.filter(call => call.method === "POST" && call.resource.endsWith("/rtis")).length, 0);
    await page.locator(`#flowView button[data-record-id="${ids.rti}"]`).first().click();
    await page.waitForFunction(rti => location.hash.includes("/rtis/detalhe/" + rti), ids.rti);
    assert.match(await page.locator("#flowView").innerText(), new RegExp(ids.rti));
    await mobileFits(page, "Detalhe da RTI");
    await navigate(page, "rtis", "fila");
    await mobileFits(page, "Fila da RTI");
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await page.locator(`#flowView [data-rti-id="${ids.rti}"]`).count(), 1);
    assert.equal(state.rti.filter(rti => rti.id === ids.rti).length, 1);
    assert.equal(state.rti.find(rti => rti.id === ids.rti).issuedNumber, null);
    await navigate(page, "rtis", "fila");
    const rtiBytes = Buffer.from("%PDF-1.7\n% SYNTHETIC RTI TEST BYTES ONLY\n%%EOF\n");
    await saveOperation(page, "documents", { reference: "RTI documental fixture", documentType: "rti",
      original: { name: "rti-fixture.pdf", mimeType: "application/pdf", buffer: rtiBytes },
      page: "1", sourceStatus: "aberta", sourceDate: "2026-10-24", openingEvidence: "Trecho sintético de abertura documental" });
    await saveOperation(page, "rtis", { title: "RTI histórica importada fixture", documentId: ids.rtiDocument });
    assert.equal(calls.filter(call => call.method === "POST" && call.resource.endsWith("/rtis")).length, 1);
    assert.equal(state.rti.length, 3);

    await navigate(page, "nr13", "book", ids.asset);
    await saveOperation(page, "relationships", { relation: "0", fromId: ids.importedRti, toId: ids.asset });
    assert.equal(state.relation.filter(relation => relation.id === ids.relation).length, 1);
    assert.match(await page.locator("#flowView").innerText(), /LVT original fixture/);
    await page.getByRole("button", { name: "Consultar book persistido", exact: true }).click();
    await page.getByRole("heading", { name: "Recomendação sintética documentada", exact: true }).last().waitFor();
    assert.match(await page.locator("#flowView").innerText(), new RegExp(ids.importedRti));
    assert.deepEqual(files.get(state.document[0].source.sourceId).bytes, lvtBytes);
    assert.deepEqual(files.get(state.document[1].source.sourceId).bytes, rtiBytes);
    await navigate(page, "integridade", "ativos", ids.system, ids.contract);
    assert.equal(await line.locator(".light.red").count(), 0);
    assert.equal(await line.evaluate(node => node.classList.contains("has-open-rti")), false);

    denied = true;
    await page.getByRole("button", { name: "Atualizar", exact: true }).click();
    await page.locator("#connectedLoginForm:not([hidden])").waitFor();
    assert.equal(await page.locator("#workspace").isVisible(), false);
    assert.equal(await page.locator("#tenantAccess").isVisible(), false);
    assert.equal((await page.locator("#flowView").innerText()).trim(), "");
    assert.equal(await page.locator("#tools").locator("*").count(), 0);
    await page.evaluate(hash => { location.hash = hash; }, `#gestao/${ids.owner}/nr13/book/${ids.asset}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal((await page.locator("#flowView").innerText()).trim(), "");
    await context.close();

    const authOnlyCalls = [];
    const authContext = await setupContext(browser, { ...config, gestao: undefined }, async route => {
      authOnlyCalls.push(route.request().url()); await route.abort();
    });
    const authPage = await authContext.newPage(); authPage.on("pageerror", error => errors.push(error.message));
    await authPage.goto(base + "/gestao.html");
    await authPage.locator("#workspace:not([hidden])").waitFor();
    assert.equal(await authPage.locator("#flowView .flow-module-card").count(), 4);
    for (const module of modules) {
      await navigate(authPage, module, module === "rtis" ? "fila" : module === "integridade" ? "campanhas" : "book", "_", "", "_");
      assert.equal(await authPage.locator("form[data-operation]").count(), 0);
    }
    assert.equal(await authPage.locator("#newCompany").isDisabled(), true);
    assert.equal(await authPage.locator("#importButton").isDisabled(), true);
    assert.deepEqual(authOnlyCalls, []);
    const accountRpc = await authPage.evaluate(() => window.__fixtureRpc.map(item => item.name));
    assert.ok(accountRpc.includes("pi_my_company_access")); assert.ok(accountRpc.includes("pi_access_status_v3"));
    assert.deepEqual(await authPage.evaluate(() => Object.keys(localStorage)), []);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    assert.ok(!staticRequests.some(resource => resource.startsWith("api/")));
    console.log("PASS piloto operacional (SDK/HTTP e originais sintéticos isolados): quatro módulos, sistema/TAG/LVT/item/foto, contrato e campanha rascunho, recomendação com RTI atômica canônica em fila/origem, RTI histórica e vínculo explícito no book, originais preservados, releitura após recarga, 403 limpa workspace e auth-only sem API operacional.");
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
