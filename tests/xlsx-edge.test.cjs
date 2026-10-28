"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"),
  fs = require("node:fs"), os = require("node:os"), path = require("node:path"),
  { spawnSync } = require("node:child_process"), { pathToFileURL } = require("node:url"),
  { zipSync, strToU8 } = require("fflate");
const reader = import(pathToFileURL(path.resolve(__dirname, "../supabase/functions/_shared/xlsx-reader.mjs")));
const mainType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const relType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
function parts(sheet = '<worksheet><dimension ref="A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ORIGINAL-TEXT</t></is></c></row></sheetData></worksheet>') {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/></Types>`,
    "_rels/.rels": `<Relationships><Relationship Id="rId1" Type="${relType}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Lista teste " sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="${relType}worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet,
  };
}
const archive = (items) => zipSync(Object.fromEntries(Object.entries(items).map(([name, xml]) => [name, strToU8(xml)])), { level: 0 });
test("XLSX Edge lê nomes exatos, linhas esparsas, tipos e repetições sem preencher campos ausentes", async () => {
  const { readXlsx } = await reader;
  const p = parts('<worksheet><dimension ref="A1:E17"/><sheetData><row r="16"><c r="A16" t="s"><v>0</v></c><c r="C16"><v>8.5</v></c><c r="D16" t="b"><v>1</v></c></row><row r="17"><c r="A17" t="s"><v>0</v></c><c r="B17" t="s"><v>1</v></c><c r="E17" t="inlineStr"><is><t>Sem inferência &amp; sem HTML</t></is></c></row></sheetData></worksheet>');
  p["xl/_rels/workbook.xml.rels"] = p["xl/_rels/workbook.xml.rels"].replace('</Relationships>', `<Relationship Id="texts" Type="${relType}sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  p["xl/sharedStrings.xml"] = '<sst><si><t>0007</t></si><si><r><t>Segmento </t></r><r><t>ç / α</t></r></si></sst>';
  const workbook = readXlsx(archive(p)), sheet = workbook.sheets[0];
  assert.equal(workbook.format, "xlsx");
  assert.equal(sheet.name, "Lista teste ");
  assert.equal(sheet.maxRow, 17);
  assert.equal(sheet.maxColumn, 5);
  assert.deepEqual(sheet.rows, [
    { row: 16, values: ["0007", null, 8.5, true] },
    { row: 17, values: ["0007", "Segmento ç / α", null, null, "Sem inferência & sem HTML"] },
  ]);
  assert.equal(workbook.metadata.formulaCells.length, 0);
});
test("XLSX Edge concorda com leitor Python nos valores; datas ficam seriais e fórmulas não são avaliadas", async (t) => {
  const { readXlsx } = await reader, dir = fs.mkdtempSync(path.join(os.tmpdir(), "pires-xlsx-edge-")), file = path.join(dir, "fixture.xlsx");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const create = spawnSync("python", ["-c", `import openpyxl,datetime,sys\nw=openpyxl.Workbook();s=w.active;s.title='Lista teste '\ns['A1']='Empresa & teste';s.merge_cells('A2:C2');s['A2']='Unidade conferida'\nfor r in range(16,60):\n s.cell(r,1,'TAG-FIXTURE-'+str(r-15));s.cell(r,3,8.5);s.cell(r,4,True)\ns['E16']='=1+2';s['F16']=datetime.date(2024,12,13)\nw.save(sys.argv[1])`, file], { encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  const python = spawnSync("python", [path.resolve(__dirname, "../lib/workbook.py"), file], { encoding: "utf8" });
  assert.equal(python.status, 0, python.stderr);
  const expected = JSON.parse(python.stdout).sheets[0], actual = readXlsx(fs.readFileSync(file));
  assert.equal(actual.sheets[0].name, expected.name);
  assert.equal(actual.sheets[0].maxRow, expected.maxRow);
  assert.equal(actual.sheets[0].rows.filter((r) => r.row >= 16).length, 44);
  for (const row of expected.rows) {
    const received = actual.sheets[0].rows.find((r) => r.row === row.row);
    assert.ok(received);
    assert.deepEqual(received.values.slice(0, 5), row.values.slice(0, 5));
  }
  assert.equal(actual.sheets[0].rows.find((r) => r.row === 16).values[4], "=1+2");
  assert.equal(actual.sheets[0].rows.find((r) => r.row === 16).values[5], 45639);
  assert.equal(actual.sheets[0].cellStyles.F16, 1);
  assert.equal(actual.metadata.cellStyleNumberFormats[1], "164");
  assert.deepEqual(actual.metadata.mergedRanges, [{ sheet: "Lista teste ", range: "A2:C2" }]);
  assert.deepEqual(actual.metadata.formulaCells, [{ sheet: "Lista teste ", address: "E16" }]);
  assert.equal(actual.metadata.dateSystem, "1900");
  assert.ok(actual.metadata.warnings.some((w) => /seriais/.test(w)));
});
test("XLSX Edge recusa PDF/XLS, macros, pacote truncado e caminhos ZIP inseguros", async () => {
  const { readXlsx, XLSX_LIMITS } = await reader;
  for (const bytes of [Buffer.from("%PDF-1.7"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), new Uint8Array(), new Uint8Array(XLSX_LIMITS.fileBytes + 1)])
    assert.throws(() => readXlsx(bytes), /XLSX:/);
  const p = parts(); p["xl/vbaProject.bin"] = "macro";
  assert.throws(() => readXlsx(archive(p)), /macros/);
  const badType = parts(); badType["[Content_Types].xml"] = badType["[Content_Types].xml"].replace(mainType, "application/vnd.ms-excel.sheet.macroEnabled.main+xml");
  assert.throws(() => readXlsx(archive(badType)), /macros/);
  const traversal = parts(); traversal["../outside.xml"] = "<x/>";
  assert.throws(() => readXlsx(archive(traversal)), /caminho ZIP/);
  const valid = archive(parts());
  assert.throws(() => readXlsx(valid.subarray(0, valid.length - 10)), /ZIP/);
});
test("XLSX Edge bloqueia vínculos externos, DOCTYPE/ENTITY e XML profundo sem fazer rede", async () => {
  const { readXlsx } = await reader;
  const external = parts(); external["xl/_rels/workbook.xml.rels"] = external["xl/_rels/workbook.xml.rels"].replace('</Relationships>', `<Relationship Id="external" Type="${relType}hyperlink" Target="https://example.invalid/private" TargetMode="External"/></Relationships>`);
  assert.throws(() => readXlsx(archive(external)), /relacionamento externo/);
  const entity = parts(); entity["xl/worksheets/sheet1.xml"] = '<!DOCTYPE worksheet [<!ENTITY x SYSTEM "file:///etc/passwd">]><worksheet>&x;</worksheet>';
  assert.throws(() => readXlsx(archive(entity)), /DOCTYPE\/ENTITY/);
  const deep = parts(); deep["docProps/deep.xml"] = '<x>'.repeat(45) + '</x>'.repeat(45);
  assert.throws(() => readXlsx(archive(deep)), /profundidade/);
  const quotedDepth = parts(); quotedDepth["docProps/deep.xml"] = '<x a="/>">'.repeat(45) + '</x>'.repeat(45);
  assert.throws(() => readXlsx(archive(quotedDepth)), /profundidade/);
  const malformed = parts(); malformed["xl/worksheets/sheet1.xml"] = '<worksheet><sheetData></worksheet>';
  assert.throws(() => readXlsx(archive(malformed)), /XML inválido/);
});
test("XLSX Edge impõe limites ZIP antes de inflar e verifica CRC do conteúdo", async () => {
  const { readXlsx } = await reader;
  const declaredBomb = archive(parts()), view = new DataView(declaredBomb.buffer, declaredBomb.byteOffset, declaredBomb.byteLength);
  let central = -1;
  for (let at = 0; at < declaredBomb.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) { central = at; break; }
  assert.ok(central > 0);
  view.setUint32(central + 24, 100_000_001, true);
  assert.throws(() => readXlsx(declaredBomb), /limites de descompactação/);
  const corrupt = archive(parts()), location = Buffer.from(corrupt).indexOf("ORIGINAL-TEXT");
  assert.ok(location > 0); corrupt[location] = "X".charCodeAt(0);
  assert.throws(() => readXlsx(corrupt), /CRC/);
  const many = parts(); for (let i = 0; i < 2001; i++) many[`extra/${i}.txt`] = "";
  assert.throws(() => readXlsx(archive(many)), /limites de entradas/);
});
test("XLSX Edge interrompe expansão real quando o tamanho descompactado do ZIP foi falsificado", async () => {
  const { readXlsx } = await reader, items = parts();
  items["docProps/bomb.xml"] = '<x>' + 'A'.repeat(1_000_000) + '</x>';
  const bytes = zipSync(Object.fromEntries(Object.entries(items).map(([name, xml]) => [name, strToU8(xml)])), { level: 9 }),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let patched = false;
  for (let at = 0; at < bytes.length - 46; at++) if (view.getUint32(at, true) === 0x02014b50) {
    const length = view.getUint16(at + 28, true), name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + length));
    if (name === "docProps/bomb.xml") { view.setUint32(at + 24, 16, true); patched = true; break; }
  }
  assert.ok(patched);
  assert.throws(() => readXlsx(bytes), /conteúdo XML efetivo excede/);
});
test("XLSX Edge bloqueia endereços excessivos/duplicados, preserva fórmulas e recusa erros de célula", async () => {
  const { readXlsx } = await reader;
  for (const sheet of [
    '<worksheet><dimension ref="A1:A50001"/><sheetData/></worksheet>',
    '<worksheet><dimension ref="A1:KO1"/><sheetData/></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="A2"><v>1</v></c></row></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="A1" t="e"><v>#VALUE!</v></c></row></sheetData></worksheet>',
    '<worksheet><sheetData><row r="1"><c r="A1"><v>0x10</v></c></row></sheetData></worksheet>',
  ]) assert.throws(() => readXlsx(archive(parts(sheet))), /XLSX:/);
  const formula = readXlsx(archive(parts('<worksheet><sheetData><row r="1"><c r="A1"><f>10/0</f><v>999</v></c><c r="B1"><f t="shared" si="0"/></c></row></sheetData></worksheet>')));
  assert.deepEqual(formula.sheets[0].rows[0].values, ["=10/0", "="]);
});
