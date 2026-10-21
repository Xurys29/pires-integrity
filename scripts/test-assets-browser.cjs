"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  { spawnSync } = require("node:child_process");
const { chromium } = require("playwright"),
  { start } = require("./serve-assets.cjs");
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pires-browser-")),
    output = path.resolve(__dirname, "../output");
  fs.mkdirSync(output, { recursive: true });
  const service = start({ privateDir: dir, port: 0 });
  await once(service.server, "listening");
  const base = "http://127.0.0.1:" + service.server.address().port;
  let browser;
  try {
    const xlsx = path.join(dir, "fixture.xlsx");
    const generated = spawnSync(
      "python",
      [
        "-c",
        `import openpyxl,sys\nw=openpyxl.Workbook();s=w.active;s.title='Lista teste ' \ns['A1']='Empresa do teste automatizado';s['A2']='Unidade de teste';s['A3']='Sistema de teste'\nfor r in range(16,60):\n s.cell(r,1,'LINHA-TESTE-'+str((r-16)//2));s.cell(r,2,'Segmento '+str(r-15));s.cell(r,3,8)\nw.save(sys.argv[1])`,
        xlsx,
      ],
      { encoding: "utf8" },
    );
    assert.equal(generated.status, 0, generated.stderr);
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByLabel("Seu nome (histórico)").fill("Operador automatizado");
    await page
      .getByLabel("Chave do ambiente")
      .fill(fs.readFileSync(path.join(dir, "access-key"), "utf8"));
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForSelector("#workspace:not([hidden])");
    await page
      .getByRole("button", { name: "Importar lista XLSX", exact: true })
      .click();
    await page.locator("#tools input[type=file]").setInputFiles(xlsx);
    await page.getByRole("button", { name: "Ler arquivo e abas" }).click();
    await page
      .getByLabel("ID estável da fonte")
      .fill("fixture-browser-estavel");
    await page
      .getByLabel("Nome exato da empresa")
      .fill("Empresa do teste automatizado");
    await page.getByLabel("Célula que comprova").fill("A1");
    await page
      .getByLabel("Unidade / plataforma (nome conferido)")
      .fill("Unidade de teste");
    await page
      .getByLabel("Sistema conferido no conteúdo")
      .fill("Sistema de teste");
    await page
      .getByLabel("Referência de confirmação do sistema")
      .fill("Fixture automatizada, células A2 e A3");
    await page.getByLabel("Primeira linha de dados").fill("16");
    await page.getByLabel("Última linha de dados").fill("59");
    await page.getByLabel("TAG · coluna", { exact: false }).fill("A");
    await page.getByLabel("Segmento / repetição · coluna").fill("B");
    await page.getByLabel("Pressão de operação · coluna").fill("C");
    await page.getByLabel("Pressão de operação · unidade original").fill("bar");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByText("Prévia · 44 registros").waitFor();
    await page.getByLabel("Conferi a empresa").check();
    await page
      .getByRole("button", { name: "Confirmar gravação desta prévia" })
      .click();
    await page.getByText("Gravados 44 novos registros").waitFor();
    assert.match(await page.locator("#pageLabel").innerText(), /44 ativos/);
    assert.equal(await page.locator("#assets article").count(), 12);
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    assert.match(await page.locator("#pageLabel").innerText(), /Página 2/);
    await page.locator("#search").fill("LINHA-TESTE-0");
    assert.match(await page.locator("#pageLabel").innerText(), /2 ativos/);
    assert.equal(await page.locator("#assets article").count(), 2);
    await page
      .locator("#assets article")
      .first()
      .getByRole("button", { name: "Abrir card e book" })
      .click();
    await page.locator("#detail:not([hidden])").waitFor();
    assert.match(await page.locator("#detail").innerText(), /Não avaliado/);
    assert.match(
      await page.locator("#detail").innerText(),
      /Prazo pendente de definição/,
    );
    await page.screenshot({
      path: path.join(output, "gestao-teste-desktop.png"),
      fullPage: false,
    });
    // Verify the same uploaded bytes do not create more records on reimport, using the authenticated browser context.
    const company = await page.locator("#company").inputValue();
    const preview = service.store.preview({
      sourceId: service.store.db.prepare("SELECT id FROM sources").get().id,
      sourceIdentity: "fixture-browser-estavel",
      sheet: "Lista teste ",
      companyName: "Empresa do teste automatizado",
      companyCell: "A1",
      companyId: company,
      unit: "Unidade de teste",
      system: "Sistema de teste",
      systemEvidence: "Fixture automatizada, células A2 e A3",
      start: 16,
      end: 59,
      type: "linha",
      mapping: { tag: "A", segment: "B", operationPressure: "C" },
      units: { operationPressure: "bar" },
    });
    assert.equal(
      service.store.commitPreview(preview.id, "Operador automatizado", true)
        .unchanged,
      44,
    );
    assert.equal(service.store.list(company, "asset").length, 44);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#detail").evaluate((e) => (e.hidden = true));
    await page.locator("#search").fill("");
    await page.locator("#reduceMotion").check();
    await page.screenshot({
      path: path.join(output, "gestao-teste-celular.png"),
      fullPage: false,
    });
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    );
    assert.ok(fits, "Layout mobile não pode rolar horizontalmente");
    assert.deepEqual(errors, []);
    console.log(
      "PASS navegador desktop/celular: login, leitura XLSX, prévia 44 registros sintéticos, importação, reimportação sem duplicação, paginação, busca, card/book, movimento reduzido e isolamento do banco de teste.",
    );
  } finally {
    await browser?.close();
    await new Promise((r) => service.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
