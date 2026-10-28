import { Inflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Bounded OOXML reader, shared by the Edge function and isolated Node tests.
// It never evaluates formulas, follows relationships over the network, or fills merges.
export const XLSX_READER_VERSION = "pires-xlsx-ooxml-1";
export const XLSX_LIMITS = Object.freeze({
  fileBytes: 8 * 1024 * 1024,
  entries: 2000,
  inflatedBytes: 24 * 1024 * 1024,
  xmlBytes: 12 * 1024 * 1024,
  rows: 50_000,
  columns: 300,
  cells: 100_000,
  valueSlots: 500_000,
  sheets: 100,
});
const decoder = new TextDecoder("utf-8", { fatal: true });
const list = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const fail = (message) => { throw new Error("XLSX: " + message); };
const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text",
  parseTagValue: false, parseAttributeValue: false, trimValues: false,
  ignoreDeclaration: true, removeNSPrefix: true, alwaysCreateTextNode: true,
  processEntities: true,
});
const text = (node) => typeof node === "string" ? node : node?.["#text"] ?? "";
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

function inspectZip(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > XLSX_LIMITS.fileBytes)
    fail("arquivo vazio ou acima de 8 MB no leitor conectado.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50)
    fail("somente XLSX OOXML não criptografado; XLS, PDF e outros formatos não são suportados.");
  let end = -1;
  for (let at = bytes.length - 22, min = Math.max(0, bytes.length - 65557); at >= min; at--)
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  if (end < 0) fail("diretório ZIP ausente ou inválido.");
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) ||
      count === 65535 || start === 0xffffffff || size === 0xffffffff || !count || count > XLSX_LIMITS.entries || start + size !== end)
    fail("ZIP multidisco, ZIP64 ou limites de entradas não suportados.");
  const entries = new Map(), folded = new Set();
  let at = start, inflated = 0, xmlBytes = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) fail("entrada ZIP inválida.");
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true),
      compressed = view.getUint32(at + 20, true), original = view.getUint32(at + 24, true),
      length = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true);
    if (at + 46 + length + extra + comment > end || flags & 1 || ![0, 8].includes(method) ||
        original === 0xffffffff || compressed === 0xffffffff || local + 30 > start)
      fail("entrada ZIP criptografada, ZIP64 ou método não suportado.");
    let name;
    try { name = decoder.decode(bytes.subarray(at + 46, at + 46 + length)); }
    catch { fail("nome de entrada ZIP inválido."); }
    if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0") || name.split("/").some((p) => p === ".." || p === ".") ||
        entries.has(name) || folded.has(name.toLowerCase())) fail("caminho ZIP ambíguo ou inseguro.");
    if (/vbaProject|activeX|externalLinks|embeddings/i.test(name)) fail("macros, vínculos externos e objetos incorporados não são suportados.");
    inflated += original;
    if (/\.(xml|rels)$/i.test(name)) xmlBytes += original;
    if (inflated > XLSX_LIMITS.inflatedBytes || xmlBytes > XLSX_LIMITS.xmlBytes)
      fail("planilha excede os limites de descompactação/XML.");
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method)
      fail("cabeçalho local ZIP divergente.");
    const localNameLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true),
      dataStart = local + 30 + localNameLength + localExtra;
    if (dataStart + compressed > start || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name)
      fail("conteúdo ZIP truncado ou divergente.");
    entries.set(name, { original, crc, method, compressed, dataStart }); folded.add(name.toLowerCase());
    at += 46 + length + extra + comment;
  }
  if (at !== end) fail("diretório ZIP inconsistente.");
  return entries;
}

function extractXml(bytes, entries) {
  const files = new Map();
  let xmlBytes = 0;
  for (const [name, entry] of entries) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    let produced = 0;
    const chunks = [], accept = (chunk) => {
      produced += chunk.length;
      xmlBytes += chunk.length;
      if (produced > entry.original || xmlBytes > XLSX_LIMITS.xmlBytes)
        fail("conteúdo XML efetivo excede o tamanho declarado ou o limite de leitura.");
      chunks.push(chunk);
    };
    try {
      if (entry.method === 0) {
        if (entry.compressed !== entry.original) fail("tamanho ZIP armazenado divergente.");
        accept(bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed));
      } else {
        // Small compressed chunks bound the allocation before the callback checks actual output.
        const inflate = new Inflate(accept);
        if (!entry.compressed) inflate.push(new Uint8Array(), true);
        for (let offset = 0; offset < entry.compressed; offset += 1024) {
          const end = Math.min(offset + 1024, entry.compressed);
          inflate.push(bytes.subarray(entry.dataStart + offset, entry.dataStart + end), end === entry.compressed);
        }
      }
    } catch (error) {
      if (error?.message?.startsWith("XLSX:")) throw error;
      fail("não foi possível descompactar o XML.");
    }
    if (produced !== entry.original) fail("tamanho XML divergente.");
    const content = new Uint8Array(produced);
    let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
    if (crc32(content) !== entry.crc) fail("CRC do XML divergente.");
    files.set(name, content);
  }
  return files;
}

function parseXml(bytes, name) {
  let xml;
  try { xml = decoder.decode(bytes); } catch { fail(`XML não UTF-8: ${name}.`); }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) fail("DOCTYPE/ENTITY não são permitidos.");
  if (/&(?!(?:amp|lt|gt|quot|apos);|#(?:[0-9]+|x[A-Fa-f0-9]+);)/.test(xml)) fail("entidade XML inválida.");
  let depth = 0, total = 0, cursor = 0;
  while ((cursor = xml.indexOf("<", cursor)) !== -1) {
    const special = [["<!--", "-->"], ["<![CDATA[", "]]>"], ["<?", "?>"]].find(([start]) => xml.startsWith(start, cursor));
    if (special) {
      const end = xml.indexOf(special[1], cursor + special[0].length);
      if (end < 0) fail("XML truncado.");
      cursor = end + special[1].length;
      continue;
    }
    let end = cursor + 1, quote = "";
    for (; end < xml.length; end++) {
      const char = xml[end];
      if (quote) { if (char === quote) quote = ""; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === ">") break;
    }
    if (end === xml.length) fail("XML truncado.");
    let tail = end - 1;
    while (tail > cursor && /\s/.test(xml[tail])) tail--;
    if (++total > 250_000) fail("XML excede o limite de elementos.");
    if (xml[cursor + 1] === "/") depth--;
    else if (xml[tail] !== "/") depth++;
    if (depth > 40 || depth < 0) fail("XML excede o limite de profundidade ou está malformado.");
    cursor = end + 1;
  }
  if (XMLValidator.validate(xml) !== true) fail(`XML inválido: ${name}.`);
  try { return parser.parse(xml); } catch { fail(`XML não reconhecido: ${name}.`); }
}
function partTarget(source, target) {
  if (typeof target !== "string" || !target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//") || /[\\\0?#]/.test(target))
    fail("alvo de relacionamento externo ou inválido.");
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") { if (!parts.length) fail("relacionamento fora do pacote."); parts.pop(); }
    else parts.push(piece);
  }
  return parts.join("/");
}
function relationSource(name) {
  return name === "_rels/.rels" ? "" : name.replace(/(^|\/)\_rels\//, "$1").replace(/\.rels$/, "");
}
function address(value) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/.exec(value || "");
  if (!match) fail("endereço de célula inválido.");
  let col = 0;
  for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (row > XLSX_LIMITS.rows || col > XLSX_LIMITS.columns) fail("aba excede 50 mil linhas ou 300 colunas.");
  return { row, col };
}
function range(value) {
  const refs = String(value).split(":");
  if (refs.length > 2) fail("faixa de células inválida.");
  const first = address(refs[0]), last = address(refs.at(-1));
  if (first.row > last.row || first.col > last.col) fail("faixa de células invertida.");
  return { first, last };
}
function richText(node) {
  if (node?.t !== undefined) return list(node.t).map(text).join("");
  return list(node?.r).map((r) => text(r.t)).join("");
}

export function readXlsx(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  const entries = inspectZip(bytes);
  const files = extractXml(bytes, entries);
  const xml = new Map();
  for (const [name, content] of files) {
    xml.set(name, parseXml(content, name));
  }
  const types = xml.get("[Content_Types].xml")?.Types;
  if (!types) fail("pacote OOXML ausente.");
  const overrides = list(types.Override);
  if (overrides.some((t) => /macroEnabled|vbaProject|spreadsheetml\.template/i.test(t["@ContentType"] || "")))
    fail("somente pasta de trabalho XLSX sem macros.");
  const rels = new Map();
  for (const [name, document] of xml) if (name.endsWith(".rels")) {
    const source = relationSource(name), links = new Map();
    for (const item of list(document.Relationships?.Relationship)) {
      const id = item["@Id"], type = item["@Type"], target = item["@Target"];
      if (!id || !type || links.has(id) || item["@TargetMode"] === "External" || /externalLink|hyperlink|vbaProject/i.test(type))
        fail("relacionamento externo, duplicado ou não suportado.");
      const path = partTarget(source, target);
      if (!entries.has(path)) fail("alvo interno do pacote ausente.");
      links.set(id, { type, path });
    }
    rels.set(source, links);
  }
  const office = [...(rels.get("")?.values() || [])].filter((r) => r.type.endsWith("/officeDocument"));
  if (office.length !== 1 || !overrides.some((t) => t["@PartName"] === "/" + office[0].path && t["@ContentType"] === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"))
    fail("pasta de trabalho XLSX não reconhecida.");
  const workbookPath = office[0].path, workbook = xml.get(workbookPath)?.workbook, workbookRels = rels.get(workbookPath);
  if (!workbook || !workbookRels) fail("pasta de trabalho ou relacionamentos ausentes.");
  const sheetNodes = list(workbook.sheets?.sheet);
  if (!sheetNodes.length || sheetNodes.length > XLSX_LIMITS.sheets) fail("quantidade de abas não suportada.");
  const sharedPart = [...workbookRels.values()].find((r) => r.type.endsWith("/sharedStrings"));
  const shared = sharedPart ? list(xml.get(sharedPart.path)?.sst?.si).map(richText) : [];
  const stylePart = [...workbookRels.values()].find((r) => r.type.endsWith("/styles")), styles = stylePart && xml.get(stylePart.path)?.styleSheet;
  const metadata = {
    readerVersion: XLSX_READER_VERSION, limits: XLSX_LIMITS, dateRepresentation: "excel_serial_or_explicit_iso",
    dateSystem: ["1", "true"].includes(workbook.workbookPr?.["@date1904"]) ? "1904" : "1900",
    numberFormats: list(styles?.numFmts?.numFmt).map((f) => ({ id: f["@numFmtId"], code: f["@formatCode"] })),
    cellStyleNumberFormats: list(styles?.cellXfs?.xf).map((f) => f["@numFmtId"] ?? "0"),
    mergedRanges: [], formulaCells: [], formulaRanges: [], warnings: [],
  };
  const names = new Set();
  let cells = 0, valueSlots = 0;
  const sheets = sheetNodes.map((sheetNode) => {
    const name = sheetNode["@name"], relationship = workbookRels.get(sheetNode["@id"]);
    if (typeof name !== "string" || !name || names.has(name) || !relationship?.type.endsWith("/worksheet")) fail("aba duplicada ou tipo de aba não suportado.");
    names.add(name);
    const sheet = xml.get(relationship.path)?.worksheet;
    if (!sheet) fail("conteúdo da aba ausente.");
    const bounds = sheet.dimension?.["@ref"] ? range(sheet.dimension["@ref"]).last : { row: 1, col: 1 };
    let maxRow = bounds.row, maxColumn = bounds.col;
    const usedRows = new Set(), rows = [], cellStyles = {};
    for (const rowNode of list(sheet.sheetData?.row)) {
      const n = Number(rowNode["@r"]);
      if (!Number.isInteger(n) || n < 1 || n > XLSX_LIMITS.rows || usedRows.has(n)) fail("linha ausente, duplicada ou fora do limite.");
      usedRows.add(n); maxRow = Math.max(maxRow, n);
      const values = [], usedColumns = new Set();
      for (const cell of list(rowNode.c)) {
        if (++cells > XLSX_LIMITS.cells) fail("planilha excede o limite de células preenchidas.");
        const ref = cell["@r"], point = address(ref);
        if (point.row !== n || usedColumns.has(point.col)) fail("endereço de célula duplicado ou fora da linha.");
        usedColumns.add(point.col); maxColumn = Math.max(maxColumn, point.col);
        valueSlots += Math.max(0, point.col - values.length);
        if (valueSlots > XLSX_LIMITS.valueSlots) fail("planilha excede o limite de valores materializados.");
        while (values.length < point.col) values.push(null);
        if (cell["@s"] !== undefined) {
          const style = Number(cell["@s"]);
          if (!Number.isInteger(style) || style < 0 || style >= metadata.cellStyleNumberFormats.length) fail("estilo de célula inválido.");
          cellStyles[ref] = style;
        }
        const raw = text(cell.v), type = cell["@t"] || "n";
        let value = null;
        if (cell.f !== undefined) {
          value = "=" + text(cell.f);
          metadata.formulaCells.push({ sheet: name, address: ref });
          if (cell.f?.["@ref"]) { range(cell.f["@ref"]); metadata.formulaRanges.push({ sheet: name, range: cell.f["@ref"] }); }
        } else if (type === "inlineStr") value = richText(cell.is);
        else if (type === "s") {
          const id = Number(raw);
          if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id >= shared.length) fail("índice de texto compartilhado inválido.");
          value = shared[id];
        } else if (type === "b") {
          if (!["0", "1"].includes(raw)) fail("valor booleano inválido.");
          value = raw === "1";
        } else if (["str", "d"].includes(type)) value = raw;
        else if (type === "e") fail("célula contém erro do Excel; conferir a fonte.");
        else if (type === "n") {
          if (raw !== "") {
            if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw.trim())) fail("valor numérico inválido.");
            value = Number(raw);
            if (!Number.isFinite(value)) fail("valor numérico inválido.");
          }
        } else fail("tipo de célula não suportado.");
        if (typeof value === "string" && value.length > 32767) fail("texto de célula excede o limite do Excel.");
        values[point.col - 1] = value;
      }
      while (values.length && values.at(-1) === null) values.pop();
      if (values.length) rows.push({ row: n, values });
    }
    for (const merge of list(sheet.mergeCells?.mergeCell)) {
      range(merge["@ref"]);
      metadata.mergedRanges.push({ sheet: name, range: merge["@ref"] });
    }
    rows.sort((a, b) => a.row - b.row);
    return { name, rows, maxRow, maxColumn, cellStyles };
  });
  if (metadata.mergedRanges.length) metadata.warnings.push("Células mescladas preservadas sem preenchimento; conferir mapeamento e continuações antes de importar.");
  if (metadata.formulaCells.length) metadata.warnings.push("Fórmulas preservadas como texto iniciado por =, sem execução ou uso de resultados em cache.");
  if (sheets.some((s) => Object.keys(s.cellStyles).length)) metadata.warnings.push("Números com estilo de data permanecem como seriais originais; estilos e sistema 1900/1904 foram preservados, sem interpretar datas automaticamente.");
  return { format: "xlsx", sheets, metadata };
}
