"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"),
  path = require("node:path"), { pathToFileURL } = require("node:url"), { createHash } = require("node:crypto"),
  { deflateSync } = require("node:zlib"), { zipSync, strToU8 } = require("fflate");
const validator = import(pathToFileURL(path.resolve(__dirname, "../supabase/functions/_shared/document-original.mjs")));
const mainType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
function parts() {
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="${mainType}"/></Types>`,
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>',
  };
}
const archive = (items = parts(), options = { level: 0 }) => zipSync(Object.fromEntries(Object.entries(items).map(([name, data]) => [name, typeof data === "string" ? strToU8(data) : data])), options);
function centralEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = bytes.length - 22;
  let cursor = view.getUint32(end + 16, true);
  const result = [];
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    const length = view.getUint16(cursor + 28, true);
    result.push({ at: cursor, name: new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + length)), local: view.getUint32(cursor + 42, true) });
    cursor += 46 + length + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
  }
  return { view, entries: result, end };
}
function pdf(extra = "", stream = null, indirect = false, eol = "\n") {
  let body = `%PDF-1.7${eol}1 0 obj${eol}<< /Type /Catalog ${extra} >>${eol}endobj${eol}`;
  if (stream !== null) {
    const size = Buffer.byteLength(stream);
    body += `2 0 obj${eol}<< /Length ${indirect ? "3 0 R" : size} >>${eol}stream${eol}${stream}${eol}endstream${eol}endobj${eol}`;
    if (indirect) body += `3 0 obj${eol}${size}${eol}endobj${eol}`;
  }
  const xref = Buffer.byteLength(body);
  return Buffer.from(body + `xref${eol}0 1${eol}0000000000 65535 f ${eol}trailer${eol}<< /Root 1 0 R /Size 2 >>${eol}startxref${eol}${xref}${eol}%%EOF${eol}`);
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
test("original XLSX aceita 31 MiB de mídia sem extrair dados nem alterar bytes", async () => {
  const { validateDocument, validateDocumentOriginal } = await validator, source = parts();
  source["xl/media/photo1.jpeg"] = new Uint8Array(31 * 1024 * 1024);
  // The documentary path must not parse, repair or evaluate worksheet content.
  source["xl/worksheets/sheet1.xml"] = '<worksheet><sheetData><c><f>HYPERLINK("https://example.invalid")</f></c></sheetData></worksheet>';
  const bytes = archive(source), before = digest(bytes), result = validateDocument(bytes, { name: "Fonte fixture.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  assert.ok(bytes.length > 8 * 1024 * 1024 && bytes.length < 32 * 1024 * 1024);
  assert.equal(result.format, "document_xlsx");
  assert.deepEqual(result.sheets, []);
  assert.equal(result.metadata.extraction, "not_performed");
  assert.deepEqual(result.metadata.validation.inflatedParts, ["[Content_Types].xml"]);
  assert.deepEqual(result.metadata.validation.crcVerifiedParts, ["[Content_Types].xml"]);
  assert.match(result.metadata.warnings.join(" "), /Integridade parcial/);
  assert.equal(digest(bytes), before);
  assert.equal(validateDocumentOriginal, validateDocument);
});
test("original XLSX valida manifesto armazenado ou deflate com CRC e aceita ArrayBuffer", async () => {
  const { validateDocument } = await validator;
  for (const level of [0, 6]) {
    const source = parts(); source["[Content_Types].xml"] = source["[Content_Types].xml"].replaceAll("><", ">\n  <");
    const bytes = archive(source, { level });
    assert.equal(validateDocument(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { format: "document_xlsx" }).format, "document_xlsx");
  }
  const corrupt = archive(), text = Buffer.from(corrupt).indexOf(mainType);
  corrupt[text] = "X".charCodeAt(0);
  assert.throws(() => validateDocument(corrupt), /CRC/);
  const missing = parts(); delete missing["xl/workbook.xml"];
  assert.throws(() => validateDocument(archive(missing)), /obrigatória ausente/);
  const nonExcel = parts(); nonExcel["[Content_Types].xml"] = nonExcel["[Content_Types].xml"].replace(mainType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
  assert.throws(() => validateDocument(archive(nonExcel)), /não identifica um workbook XLSX/);
  const ambiguous = parts(); ambiguous["[Content_Types].xml"] = ambiguous["[Content_Types].xml"].replace("</Types>", '<Override PartName="/xl/workbook.xml" ContentType="application/xml"/></Types>');
  assert.throws(() => validateDocument(archive(ambiguous)), /parte duplicada/);
});
test("original XLSX bloqueia macros por caminho ou manifesto inclusive entidades de caractere", async () => {
  const { validateDocument } = await validator;
  for (const name of ["xl/vbaProject.bin", "xl/activeX/activeX1.bin", "xl/macrosheets/sheet1.xml"]) {
    const source = parts(); source[name] = "fixture";
    assert.throws(() => validateDocument(archive(source)), /macros|controles ativos/);
  }
  for (const type of ["application/vnd.ms-excel.sheet.macroEnabled.main+xml", "application/vnd.ms-excel.sheet.macroEnabl&#101;d.main+xml", "application/vnd.ms-office.vbaProject"]) {
    const source = parts(); source["[Content_Types].xml"] = source["[Content_Types].xml"].replace(mainType, type);
    assert.throws(() => validateDocument(archive(source)), /macro/);
  }
});
test("original XLSX bloqueia traversal, caminhos absolutos, duplicatas, symlinks e criptografia", async () => {
  const { validateDocument } = await validator;
  for (const name of ["../outside.xml", "/outside.xml", "C:/outside.xml", "xl\\bad.xml", "xl/%2e%2e/outside.xml", "xl//bad.xml", "xl/WORKBOOK.xml"]) {
    const source = parts(); source[name] = "fixture";
    assert.throws(() => validateDocument(archive(source)), /caminho ZIP|duplicada|ambígua/);
  }
  const symlink = archive(), symlinkZip = centralEntries(symlink);
  symlinkZip.view.setUint32(symlinkZip.entries[0].at + 38, (0xa1ff << 16) >>> 0, true);
  assert.throws(() => validateDocument(symlink), /symlink/);
  const encrypted = archive(), encryptionZip = centralEntries(encrypted);
  encryptionZip.view.setUint16(encryptionZip.entries[0].at + 8, 1, true);
  assert.throws(() => validateDocument(encrypted), /criptografado/);
});
test("original XLSX impõe limites centrais de arquivo, entradas, expansão e recursos ZIP", async () => {
  const { validateDocument, DOCUMENT_ORIGINAL_LIMITS: limits } = await validator;
  assert.throws(() => validateDocument(new Uint8Array(limits.fileBytes + 1)), /32 MiB/);
  const bomb = archive(), zip = centralEntries(bomb);
  zip.view.setUint32(zip.entries[0].at + 24, limits.declaredEntryBytes + 1, true);
  assert.throws(() => validateDocument(bomb), /expansão ZIP/);
  const zip64 = archive(), zip64Info = centralEntries(zip64);
  zip64Info.view.setUint16(zip64Info.end + 10, 65535, true);
  zip64Info.view.setUint16(zip64Info.end + 8, 65535, true);
  assert.throws(() => validateDocument(zip64), /ZIP64/);
  const many = archive(), manyZip = centralEntries(many);
  manyZip.view.setUint16(manyZip.end + 10, limits.entries + 1, true);
  manyZip.view.setUint16(manyZip.end + 8, limits.entries + 1, true);
  assert.throws(() => validateDocument(many), /limite de entradas/);
  const method = archive(), methodZip = centralEntries(method);
  methodZip.view.setUint16(methodZip.entries[0].at + 10, 99, true);
  assert.throws(() => validateDocument(method), /não suportado/);
  assert.throws(() => validateDocument(archive().subarray(0, 70)), /ZIP/);
});
test("original XLSX limita expansão real do manifesto e recusa DTD e XML malformado", async () => {
  const { validateDocument } = await validator;
  const source = parts(); source["[Content_Types].xml"] = source["[Content_Types].xml"].replace("</Types>", " ".repeat(200_000) + "</Types>");
  const bytes = archive(source, { level: 9 }), zip = centralEntries(bytes), entry = zip.entries.find((item) => item.name === "[Content_Types].xml");
  zip.view.setUint32(entry.at + 24, 16, true); zip.view.setUint32(entry.local + 22, 16, true);
  assert.throws(() => validateDocument(bytes), /expansão real/);
  for (const xml of ['<!DOCTYPE Types [<!ENTITY attack SYSTEM "file:///tmp/nope">]><Types/>', '<Types xmlns="x"><Override></Types>', '<Types>' + '<Default>'.repeat(20) + '</Default>'.repeat(20) + '</Types>']) {
    const invalid = parts(); invalid["[Content_Types].xml"] = xml;
    assert.throws(() => validateDocument(archive(invalid)), /DOCTYPE|XML|Content_Types/);
  }
});
test("original PDF verifica header/EOF/startxref sem OCR ou extrair informações", async () => {
  const { validateDocument } = await validator;
  for (const lineEnding of ["\n", "\r\n", "\r"]) {
    const bytes = pdf("/Title (Texto fixture)", "BT /F1 12 Tf (Texto) Tj ET", false, lineEnding), before = digest(bytes),
      result = validateDocument(bytes, { name: "Fonte fixture.PDF", mime: "application/pdf" });
    assert.equal(result.format, "document_pdf");
    assert.deepEqual(result.sheets, []);
    assert.equal(result.metadata.extraction, "not_performed");
    assert.equal(result.metadata.validation.indirectLengthStreams, 0);
    assert.equal(digest(bytes), before);
  }
  assert.throws(() => validateDocument(Buffer.from("%PDF-1.7\nfixture\n%%EOF\n")), /startxref/);
  assert.throws(() => validateDocument(Buffer.concat([pdf(), Buffer.from("trailing junk")])), /EOF/);
  assert.throws(() => validateDocument(Buffer.from(pdf().toString().replace(/startxref\n\d+/, "startxref\n999999"))), /referência cruzada/);
});
test("original PDF recusa nomes ativos e anexos sem confundir strings, comentários ou streams", async () => {
  const { validateDocument } = await validator;
  for (const name of ["JavaScript", "Java#53cript", "JS", "EmbeddedFiles", "EmbeddedFile", "Launch", "RichMedia", "Encrypt"])
    assert.throws(() => validateDocument(pdf(`/Action << /S /${name} >>`)), /JavaScript, anexo/);
  const text = "/JavaScript /EmbeddedFiles /JS não é um comando nesta fixture";
  assert.equal(validateDocument(pdf(`/Title (${text}) % ${text}\n`)).format, "document_pdf");
  assert.equal(validateDocument(pdf("", text)).format, "document_pdf");
  const indirect = validateDocument(pdf("", text, true));
  assert.equal(indirect.metadata.validation.indirectLengthStreams, 1);
  assert.match(indirect.metadata.warnings.join(" "), /comprimento indireto/);
});
test("original PDF limita profundidade e tokens antes de acumular estruturas adversariais", async () => {
  const { validateDocument, DOCUMENT_ORIGINAL_LIMITS: limits } = await validator;
  assert.throws(() => validateDocument(pdf("/Nested " + "<<".repeat(limits.pdfDictionaryDepth) + ">>".repeat(limits.pdfDictionaryDepth))), /profundidade de dicionários/);
  assert.throws(() => validateDocument(pdf("/Values [" + "0 ".repeat(limits.pdfTokens) + "]")), /tokens PDF/);
});
test("original rejeita formatos, nomes e MIME divergentes sem aceitar ZIP apenas renomeado", async () => {
  const { validateDocument } = await validator;
  for (const value of [new Uint8Array(), Buffer.from("PK not a zip"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), Buffer.from("plain text")])
    assert.throws(() => validateDocument(value));
  assert.throws(() => validateDocument(archive(), { name: "source.xlsm" }), /extensão/);
  assert.throws(() => validateDocument(archive(), { mime: "application/pdf" }), /MIME/);
  assert.throws(() => validateDocument(pdf(), { format: "document_xlsx" }), /somente originais/);
  assert.throws(() => validateDocument(archive({ "text.txt": "Not Excel" }), { name: "renamed.xlsx" }), /obrigatória/);
});
function pngChunk(type, data = Buffer.alloc(0)) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); result.write(type, 4, "ascii"); data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, result.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(width = 2, height = 3, extras = []) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const pixels = Buffer.alloc(3 * (1 + 2 * 3), 255);
  for (let row = 0; row < 3; row++) pixels[row * 7] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), ...extras,
    pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND")]);
}
// Isolated 2x3 white fixture generated by Pillow; it contains no user image or EXIF.
const jpegFixture = () => Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64");
function jpegApp(payload) {
  const source = jpegFixture(), segment = Buffer.alloc(payload.length + 4);
  segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(payload.length + 2, 2); payload.copy(segment, 4);
  return Buffer.concat([source.subarray(0, 2), segment, source.subarray(2)]);
}
test("foto original JPEG/PNG informa dimensões sem decodificar pixels ou transmitir EXIF", async () => {
  const { validatePhoto } = await validator;
  for (const [bytes, name, mime, format] of [[jpegFixture(), "fixture.jpg", "image/jpeg", "image_jpeg"], [png(), "fixture.png", "image/png", "image_png"]]) {
    const before = digest(bytes), result = validatePhoto(bytes, { name, mime });
    assert.equal(result.format, format);
    assert.deepEqual(result.sheets, []);
    assert.equal(result.metadata.extraction, "not_performed");
    assert.equal(result.metadata.width, 2); assert.equal(result.metadata.height, 3); assert.equal(result.metadata.pixels, 6);
    assert.equal(result.metadata.exif, "not_extracted"); assert.equal(result.metadata.originalOrientation, "preserved");
    assert.equal(digest(bytes), before);
  }
  const exif = "Exif\0\0FIXTURE-PRIVATE-METADATA", result = validatePhoto(jpegApp(Buffer.from(exif)));
  assert.ok(!JSON.stringify(result).includes("FIXTURE-PRIVATE-METADATA"));
});
test("foto original rejeita SVG/arquivo renomeado, MIME divergente e conteúdo anexado", async () => {
  const { validatePhoto } = await validator;
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from("MZ executable"), Buffer.from("GIF89a"), Buffer.from("%PDF-1.7"), new Uint8Array()])
    assert.throws(() => validatePhoto(bytes));
  assert.throws(() => validatePhoto(jpegFixture(), { name: "renamed.png" }), /extensão/);
  assert.throws(() => validatePhoto(png(), { mime: "image/jpeg" }), /MIME/);
  assert.throws(() => validatePhoto(Buffer.concat([jpegFixture(), Buffer.from("PK executable")])), /fim JPEG/);
  assert.throws(() => validatePhoto(Buffer.concat([png(), Buffer.from("<html>fixture</html>")])), /conteúdo anexado/);
  assert.throws(() => validatePhoto(jpegApp(Buffer.from("<?php echo 'fixture';"))), /executável/);
  assert.throws(() => validatePhoto(png(2, 3, [pngChunk("tEXt", Buffer.from("Comment\0<SCRIPT>fixture</SCRIPT>"))])), /executável/);
});
test("foto original impõe limites de bytes/dimensões/pixels sem inflar imagem", async () => {
  const { validatePhoto, PHOTO_ORIGINAL_LIMITS: limits } = await validator;
  assert.throws(() => validatePhoto(new Uint8Array(limits.fileBytes + 1)), /8 MiB/);
  for (const [width, height] of [[0, 3], [3, 0], [limits.dimension + 1, 1], [8000, 6000]])
    assert.throws(() => validatePhoto(png(width, height)), /dimensões|pixels/);
  const jpeg = jpegFixture(), frame = jpeg.indexOf(Buffer.from([255, 192]));
  assert.ok(frame > 0); jpeg.writeUInt16BE(limits.dimension + 1, frame + 7);
  assert.throws(() => validatePhoto(jpeg), /dimensões/);
});
test("foto PNG verifica CRC, chunks críticos e fim; JPEG verifica marcadores e cabeçalhos", async () => {
  const { validatePhoto } = await validator, badCrc = png(); badCrc[30] ^= 1;
  assert.throws(() => validatePhoto(badCrc), /CRC/);
  assert.throws(() => validatePhoto(png().subarray(0, png().length - 12)), /IEND/);
  assert.throws(() => validatePhoto(png(2, 3, [pngChunk("ABCD")])), /chunk crítico/);
  assert.throws(() => validatePhoto(png(2, 3, [pngChunk("acTL", Buffer.alloc(8))])), /animado/);
  const noFrame = jpegFixture(), frame = noFrame.indexOf(Buffer.from([255, 192])); noFrame[frame + 1] = 224;
  assert.throws(() => validatePhoto(noFrame), /SOS/);
  const truncated = jpegFixture().subarray(0, 45);
  assert.throws(() => validatePhoto(truncated), /fim JPEG/);
});
