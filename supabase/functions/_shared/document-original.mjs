import { Inflate } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

// Container checks for immutable documentary originals, NOT an operational importer.
// Workbook XML, formulas, images and attachments are never extracted or evaluated.
export const DOCUMENT_ORIGINAL_VERSION = "pires-document-original-2";
export const DOCUMENT_ORIGINAL_LIMITS = Object.freeze({
  fileBytes: 32 * 1024 * 1024,
  entries: 5000,
  directoryBytes: 2 * 1024 * 1024,
  // Authorized 2026-10-27: archival only; worksheet bodies are never inflated.
  // Only Content_Types is inflated, retaining its independent 256 KiB cap.
  declaredInflatedBytes: 256 * 1024 * 1024,
  declaredEntryBytes: 96 * 1024 * 1024,
  contentTypesBytes: 256 * 1024,
  nameBytes: 1024,
  pdfDictionaryDepth: 64,
  pdfTokens: 500_000,
});
export const PHOTO_ORIGINAL_LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, dimension: 12_000, pixels: 40_000_000, chunks: 4096 });
const utf8 = new TextDecoder("utf-8", { fatal: true });
const mainType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const typesNamespace = "http://schemas.openxmlformats.org/package/2006/content-types";
const fail = (message, code = "invalid_document") => {
  const error = new Error("Documento original: " + message);
  error.code = code;
  throw error;
};
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function decode(bytes) {
  try { return utf8.decode(bytes); }
  catch { fail("nome ou XML não UTF-8 não suportado.", "unsupported_document"); }
}
function safePath(name) {
  if (!name || /^[\/]/.test(name) || /[\\:\x00-\x1f\x7f]/.test(name) ||
      /%(?:2e|2f|5c)/i.test(name) || name.split("/").some((part, index, all) =>
        part === "." || part === ".." || !part && index !== all.length - 1))
    fail("caminho ZIP inseguro ou ambíguo.", "prohibited_document");
}
function checkExtras(bytes, start, length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), end = start + length;
  for (let cursor = start; cursor < end;) {
    if (cursor + 4 > end) fail("campo extra ZIP truncado.");
    const id = view.getUint16(cursor, true), size = view.getUint16(cursor + 2, true);
    if (cursor + 4 + size > end) fail("campo extra ZIP inválido.");
    if ([0x0001, 0x0017, 0x9901, 0x7075].includes(id))
      fail("ZIP64, criptografia ou nome alternativo ZIP não suportados.", "unsupported_document");
    cursor += 4 + size;
  }
}
function inspectZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50)
    fail("o original XLSX não contém um ZIP OOXML válido.");
  let end = -1;
  for (let cursor = bytes.length - 22, min = Math.max(0, bytes.length - 65557); cursor >= min; cursor--)
    if (view.getUint32(cursor, true) === 0x06054b50 && cursor + 22 + view.getUint16(cursor + 20, true) === bytes.length) { end = cursor; break; }
  if (end < 0) fail("diretório ZIP ausente ou truncado.");
  const count = view.getUint16(end + 10, true), directoryBytes = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) ||
      count === 65535 || start === 0xffffffff || directoryBytes === 0xffffffff)
    fail("ZIP64 e ZIP multidisco não suportados.", "unsupported_document");
  if (!count || count > DOCUMENT_ORIGINAL_LIMITS.entries || directoryBytes > DOCUMENT_ORIGINAL_LIMITS.directoryBytes)
    fail("limite de entradas/diretório ZIP excedido.", "document_limit");
  if (start + directoryBytes !== end) fail("diretório ZIP inconsistente.");
  const entries = new Map(), folded = new Set(), ranges = [];
  let cursor = start, declaredInflatedBytes = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) fail("entrada ZIP inválida.");
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true),
      crc = view.getUint32(cursor + 16, true), compressed = view.getUint32(cursor + 20, true),
      original = view.getUint32(cursor + 24, true), length = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true),
      disk = view.getUint16(cursor + 34, true), attributes = view.getUint32(cursor + 38, true),
      local = view.getUint32(cursor + 42, true), unixType = (attributes >>> 16) & 0xf000;
    if (cursor + 46 + length + extra + comment > end || !length || length > DOCUMENT_ORIGINAL_LIMITS.nameBytes)
      fail("entrada ou nome ZIP truncado/excessivo.");
    if (flags & (1 | 64 | 8192)) fail("ZIP criptografado não permitido.", "prohibited_document");
    if (flags & ~0x080e || ![0, 8].includes(method) || disk || original === 0xffffffff || compressed === 0xffffffff ||
        local === 0xffffffff || view.getUint16(cursor + 6, true) > 20)
      fail("recurso ZIP não suportado.", "unsupported_document");
    if (![0, 0x4000, 0x8000].includes(unixType)) fail("symlink ou arquivo especial ZIP não permitido.", "prohibited_document");
    const name = decode(bytes.subarray(cursor + 46, cursor + 46 + length));
    safePath(name);
    if (entries.has(name) || folded.has(name.toLowerCase())) fail("entrada ZIP duplicada ou ambígua.", "prohibited_document");
    if (/vbaProject|(?:^|\/)activeX(?:\/|$)|(?:^|\/)macrosheets?(?:\/|$)/i.test(name))
      fail("macros e controles ativos não permitidos.", "prohibited_document");
    checkExtras(bytes, cursor + 46 + length, extra);
    declaredInflatedBytes += original;
    if (original > DOCUMENT_ORIGINAL_LIMITS.declaredEntryBytes || declaredInflatedBytes > DOCUMENT_ORIGINAL_LIMITS.declaredInflatedBytes ||
        original > Math.max(1024 * 1024, compressed * 200))
      fail("limite declarado de expansão ZIP excedido.", "document_limit");
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50 ||
        view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method)
      fail("cabeçalho local ZIP divergente.");
    const localLength = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true),
      dataStart = local + 30 + localLength + localExtra, dataEnd = dataStart + compressed;
    if (localLength !== length || dataEnd > start || decode(bytes.subarray(local + 30, local + 30 + localLength)) !== name)
      fail("conteúdo ZIP truncado ou divergente.");
    checkExtras(bytes, local + 30 + localLength, localExtra);
    if (method === 0 && compressed !== original) fail("tamanho ZIP armazenado divergente.");
    let recordEnd = dataEnd;
    if (flags & 8) {
      let descriptor = dataEnd;
      if (descriptor + 4 <= start && view.getUint32(descriptor, true) === 0x08074b50) descriptor += 4;
      if (descriptor + 12 > start || view.getUint32(descriptor, true) !== crc ||
          view.getUint32(descriptor + 4, true) !== compressed || view.getUint32(descriptor + 8, true) !== original)
        fail("descritor ZIP ausente ou divergente.");
      recordEnd = descriptor + 12;
    } else if (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== original)
      fail("tamanhos ou CRC declarados divergentes nos cabeçalhos ZIP.");
    if (name.endsWith("/") && (original || compressed)) fail("diretório ZIP com conteúdo inesperado.");
    entries.set(name, { original, compressed, crc, method, dataStart });
    folded.add(name.toLowerCase()); ranges.push([local, recordEnd]);
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end) fail("tamanho do diretório ZIP divergente.");
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) fail("entradas ZIP sobrepostas.");
  return { entries, declaredInflatedBytes };
}
function contentTypes(bytes, entry) {
  if (!entry || !entry.original || entry.original > DOCUMENT_ORIGINAL_LIMITS.contentTypesBytes)
    fail("[Content_Types].xml ausente ou acima do limite.", "document_limit");
  let produced = 0;
  const chunks = [], accept = (chunk) => {
    produced += chunk.length;
    if (produced > entry.original || produced > DOCUMENT_ORIGINAL_LIMITS.contentTypesBytes)
      fail("expansão real de [Content_Types].xml excedeu o limite.", "document_limit");
    chunks.push(chunk);
  };
  try {
    if (entry.method === 0) accept(bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed));
    else {
      const inflate = new Inflate(accept);
      for (let offset = 0; offset < entry.compressed; offset += 1024) {
        const end = Math.min(offset + 1024, entry.compressed);
        inflate.push(bytes.subarray(entry.dataStart + offset, entry.dataStart + end), end === entry.compressed);
      }
    }
  } catch (error) {
    if (error?.code) throw error;
    fail("[Content_Types].xml não pôde ser descompactado.");
  }
  if (produced !== entry.original) fail("tamanho efetivo de [Content_Types].xml divergente.");
  const output = new Uint8Array(produced);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  if (crc32(output) !== entry.crc) fail("CRC de [Content_Types].xml divergente.");
  const xml = decode(output);
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) fail("DOCTYPE/ENTITY não permitidos.", "prohibited_document");
  // This small manifest has only a root and empty declarations. Bound depth before parsing.
  const stripped = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g, "");
  let depth = 0, tags = 0;
  for (const token of stripped.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    if (++tags > 10_000) fail("limite de elementos de Content_Types excedido.", "document_limit");
    if (/^<\//.test(token[0])) depth--;
    else if (!/\/\s*>$/.test(token[0])) depth++;
    if (depth > 4 || depth < 0) fail("estrutura Content_Types excessiva ou inválida.");
  }
  if (depth || XMLValidator.validate(xml) !== true) fail("XML Content_Types inválido.");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false,
    parseAttributeValue: false, processEntities: true, trimValues: false });
  const types = parser.parse(xml).Types;
  if (!types || types["@xmlns"] !== typesNamespace || String(types["#text"] || "").trim() ||
      Object.keys(types).some((key) => !["@xmlns", "Default", "Override", "#text"].includes(key)))
    fail("manifesto de tipos OOXML não suportado.", "unsupported_document");
  const list = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value],
    declarations = [...list(types.Default), ...list(types.Override)];
  const extensions = new Set(), paths = new Set();
  for (const item of list(types.Default)) {
    const extension = item?.["@Extension"];
    if (typeof extension !== "string" || !/^[A-Za-z0-9_-]+$/.test(extension) || extensions.has(extension.toLowerCase()))
      fail("extensão duplicada ou inválida em Content_Types.");
    extensions.add(extension.toLowerCase());
  }
  for (const item of list(types.Override)) {
    const path = item?.["@PartName"];
    if (typeof path !== "string" || !path.startsWith("/") || paths.has(path.toLowerCase()))
      fail("parte duplicada ou inválida em Content_Types.");
    safePath(path.slice(1)); paths.add(path.toLowerCase());
  }
  if (declarations.some((item) => typeof item?.["@ContentType"] !== "string" || !item["@ContentType"].trim() ||
      Object.keys(item).some((key) => !["@ContentType", "@PartName", "@Extension", "#text"].includes(key)) || String(item["#text"] || "").trim()))
    fail("declaração Content_Types inválida.");
  if (declarations.some((item) => /macroEnabled|vbaProject|macrosheet|activeX|oleObject|spreadsheetml\.template/i.test(item?.["@ContentType"] || "")))
    fail("conteúdo macro, ativo ou modelo não permitido.", "prohibited_document");
  const workbooks = list(types.Override).filter((item) => item?.["@ContentType"] === mainType);
  if (workbooks.length !== 1 || workbooks[0]["@PartName"] !== "/xl/workbook.xml")
    fail("o manifesto não identifica um workbook XLSX sem macros.", "unsupported_document");
}
function checkXlsx(bytes) {
  const { entries, declaredInflatedBytes } = inspectZip(bytes);
  for (const path of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"])
    if (!entries.get(path)?.original) fail("parte OOXML obrigatória ausente: " + path);
  contentTypes(bytes, entries.get("[Content_Types].xml"));
  return {
    validation: { level: "zip_container_and_content_types", entries: entries.size, declaredInflatedBytes,
      inflatedParts: ["[Content_Types].xml"], crcVerifiedParts: ["[Content_Types].xml"] },
    warnings: ["Arquivamento documental: células, fórmulas, fotos e anexos não foram extraídos nem avaliados.",
      "Integridade parcial: CRC dos demais componentes e semântica do workbook não foram verificados.",
      "Validação de formato não equivale a varredura integral de segurança ou aprovação técnica."],
  };
}

const whitespace = (byte) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
const delimiter = (byte) => byte === undefined || whitespace(byte) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(byte);
const asciiAt = (bytes, at, word) => [...word].every((char, index) => bytes[at + index] === char.charCodeAt(0));
function pdfNames(bytes) {
  let cursor = 0, lastClosedDictionary = null, previous = "";
  const dictionaries = [], prohibited = new Set(["JavaScript", "JS", "EmbeddedFiles", "EmbeddedFile", "Launch", "RichMedia", "Encrypt"]);
  let indirectStreams = 0, tokens = 0;
  function token(value) {
    if (++tokens > DOCUMENT_ORIGINAL_LIMITS.pdfTokens) fail("quantidade de tokens PDF excedida.", "document_limit");
    const dictionary = dictionaries.at(-1);
    if (dictionary) {
      if (value === "/Length") { dictionary.lengthSeen++; dictionary.stage = 1; dictionary.length = null; }
      else if (dictionary.stage === 1) { dictionary.length = /^\d+$/.test(value) ? Number(value) : null; dictionary.stage = 2; }
      else if (dictionary.stage === 2) { if (/^\d+$/.test(value)) dictionary.length = null; dictionary.stage = 0; }
    }
    previous = value;
  }
  while (cursor < bytes.length) {
    const byte = bytes[cursor];
    if (whitespace(byte)) { cursor++; continue; }
    if (byte === 37) { while (cursor < bytes.length && ![10, 13].includes(bytes[cursor])) cursor++; continue; }
    if (byte === 40) {
      let depth = 1; cursor++;
      while (cursor < bytes.length && depth) {
        if (bytes[cursor] === 92) { cursor += 2; continue; }
        if (bytes[cursor] === 40) depth++;
        if (bytes[cursor] === 41) depth--;
        if (depth > 64) fail("string PDF excessivamente aninhada.", "document_limit");
        cursor++;
      }
      if (depth) fail("string PDF truncada.");
      token("string"); continue;
    }
    if (byte === 60 && bytes[cursor + 1] !== 60) {
      cursor++;
      while (cursor < bytes.length && bytes[cursor] !== 62) cursor++;
      if (cursor === bytes.length) fail("string hexadecimal PDF truncada.");
      cursor++; token("string"); continue;
    }
    if (byte === 60 && bytes[cursor + 1] === 60) {
      if (dictionaries.length >= DOCUMENT_ORIGINAL_LIMITS.pdfDictionaryDepth) fail("profundidade de dicionários PDF excedida.", "document_limit");
      token("<<"); dictionaries.push({ lengthSeen: 0, stage: 0, length: null }); cursor += 2; continue;
    }
    if (byte === 62 && bytes[cursor + 1] === 62) { lastClosedDictionary = dictionaries.pop() || null; cursor += 2; token(">>"); continue; }
    if (byte === 47) {
      let name = ""; cursor++;
      while (cursor < bytes.length && !delimiter(bytes[cursor])) {
        if (name.length > 1024) fail("nome PDF excessivo.", "document_limit");
        if (bytes[cursor] === 35 && cursor + 2 < bytes.length) {
          const hex = String.fromCharCode(bytes[cursor + 1], bytes[cursor + 2]);
          if (/^[0-9a-f]{2}$/i.test(hex)) { name += String.fromCharCode(parseInt(hex, 16)); cursor += 3; continue; }
        }
        name += String.fromCharCode(bytes[cursor++]);
      }
      if (prohibited.has(name)) fail("PDF com JavaScript, anexo, ação ativa ou criptografia não permitido.", "prohibited_document");
      token("/" + name); continue;
    }
    if (delimiter(byte)) { token(String.fromCharCode(byte)); cursor++; continue; }
    let word = "";
    while (cursor < bytes.length && !delimiter(bytes[cursor])) {
      if (word.length > 1024) fail("token PDF excessivo.", "document_limit");
      word += String.fromCharCode(bytes[cursor++]);
    }
    if (word === "stream" && previous === ">>") {
      if (bytes[cursor] === 13) { cursor++; if (bytes[cursor] === 10) cursor++; }
      else if (bytes[cursor] === 10) cursor++;
      else fail("delimitador de stream PDF inválido.");
      if (lastClosedDictionary?.lengthSeen === 1 && Number.isSafeInteger(lastClosedDictionary.length)) {
        cursor += lastClosedDictionary.length;
        if (cursor > bytes.length) fail("stream PDF truncado.");
        if (bytes[cursor] === 13) cursor++;
        if (bytes[cursor] === 10) cursor++;
        if (!asciiAt(bytes, cursor, "endstream") || !delimiter(bytes[cursor + 9])) fail("tamanho do stream PDF divergente.");
      } else {
        indirectStreams++;
        for (; cursor < bytes.length; cursor++)
          if ([10, 13].includes(bytes[cursor - 1]) && asciiAt(bytes, cursor, "endstream") && delimiter(bytes[cursor + 9])) break;
        if (cursor === bytes.length) fail("fim de stream PDF ausente.");
      }
      cursor += 9; token("endstream"); lastClosedDictionary = null; continue;
    }
    token(word);
  }
  return indirectStreams;
}
function checkPdf(bytes) {
  const header = String.fromCharCode(...bytes.subarray(0, 9));
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n\t ]/.test(header)) fail("cabeçalho PDF inválido ou não suportado.");
  const tail = String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - 4096))),
    ending = /startxref[\x00\x09\x0a\x0c\x0d\x20]+(\d+)[\x00\x09\x0a\x0c\x0d\x20]+%%EOF[\x00\x09\x0a\x0c\x0d\x20]*$/.exec(tail);
  if (!ending) fail("PDF sem startxref/EOF final válido.");
  const xref = Number(ending[1]);
  if (!Number.isSafeInteger(xref) || xref < 9 || xref >= bytes.length ||
      !/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(String.fromCharCode(...bytes.subarray(xref, xref + 64))))
    fail("referência cruzada PDF fora do arquivo ou inválida.");
  const indirectStreams = pdfNames(bytes);
  return {
    validation: { level: "pdf_header_eof_and_lexical_names", indirectLengthStreams: indirectStreams },
    warnings: ["Arquivamento documental: texto, imagens, anexos e ações não foram extraídos nem executados.",
      "Verificação PDF básica: sem resolução de objetos, descompressão de streams, OCR ou varredura integral de segurança.",
      ...(indirectStreams ? ["Streams com comprimento indireto foram delimitados lexicalmente; conteúdo comprimido não foi inspecionado."] : []),
      "A validação não confirma inspeção, situação atual de RTI ou aprovação técnica."],
  };
}

export function validateDocument(input, options = {}) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail("arquivo vazio ou tipo de bytes inválido.");
  if (bytes.length > DOCUMENT_ORIGINAL_LIMITS.fileBytes) fail("arquivo acima de 32 MiB.", "document_limit");
  const name = typeof options.name === "string" ? options.name : "", extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase(),
    mime = typeof options.mime === "string" ? options.mime.split(";", 1)[0].trim().toLowerCase() : "",
    detected = asciiAt(bytes, 0, "%PDF-") ? "document_pdf" : bytes[0] === 80 && bytes[1] === 75 ? "document_xlsx" : null,
    format = options.format || detected;
  if (!["document_xlsx", "document_pdf"].includes(format) || detected !== format)
    fail("somente originais XLSX e PDF compatíveis são suportados.", "unsupported_document");
  if (extension && extension !== (format === "document_xlsx" ? "xlsx" : "pdf"))
    fail("extensão do original divergente ou não suportada.", "unsupported_document");
  if (mime && !["application/octet-stream", format === "document_pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mime))
    fail("tipo MIME do original divergente ou não suportado.", "unsupported_document");
  const result = format === "document_xlsx" ? checkXlsx(bytes) : checkPdf(bytes);
  return { format, sheets: [], metadata: { readerVersion: DOCUMENT_ORIGINAL_VERSION, extraction: "not_performed",
    fileBytes: bytes.length, limits: DOCUMENT_ORIGINAL_LIMITS, ...result } };
}
export const validateDocumentOriginal = validateDocument;

function dimensions(width, height) {
  if (!width || !height || width > PHOTO_ORIGINAL_LIMITS.dimension || height > PHOTO_ORIGINAL_LIMITS.dimension || width * height > PHOTO_ORIGINAL_LIMITS.pixels)
    fail("dimensões ou quantidade de pixels da foto excedem o limite.", "document_limit");
  return { width, height, pixels: width * height };
}
function rejectExecutableText(bytes) {
  // Reject common executable image polyglots without interpreting EXIF or image pixels.
  // Exact image endings separately reject appended HTML, ZIP and executable payloads.
  const forbidden = ["<?php", "<?=", "<script"];
  for (let cursor = 0; cursor < bytes.length; cursor++) {
    if (bytes[cursor] !== 60) continue;
    for (const word of forbidden)
      if ([...word].every((char, index) => (bytes[cursor + index] | 32) === char.charCodeAt(0)))
        fail("foto contém assinatura textual executável não permitida.", "prohibited_document");
  }
}
function checkPng(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8, count = 0, size = null, palette = false, imageBytes = 0, seenImage = false, afterImage = false;
  while (cursor < bytes.length) {
    if (++count > PHOTO_ORIGINAL_LIMITS.chunks) fail("quantidade de chunks PNG excedida.", "document_limit");
    if (cursor + 12 > bytes.length) fail("chunk PNG truncado.");
    const length = view.getUint32(cursor), end = cursor + 12 + length,
      type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8));
    if (end > bytes.length || !/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) fail("chunk PNG inválido.");
    if (crc32(bytes.subarray(cursor + 4, cursor + 8 + length)) !== view.getUint32(cursor + 8 + length)) fail("CRC do PNG divergente.");
    if (count === 1 && (type !== "IHDR" || length !== 13)) fail("cabeçalho IHDR PNG ausente ou inválido.");
    if (["acTL", "fcTL", "fdAT"].includes(type)) fail("PNG animado não suportado como foto original.", "unsupported_document");
    if (type === "IHDR") {
      if (count !== 1 || length !== 13) fail("IHDR PNG duplicado ou inválido.");
      const depth = bytes[cursor + 16], color = bytes[cursor + 17], combinations = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!combinations[color]?.includes(depth) || bytes[cursor + 18] || bytes[cursor + 19] || ![0, 1].includes(bytes[cursor + 20]))
        fail("perfil de pixels PNG não suportado.", "unsupported_document");
      size = { ...dimensions(view.getUint32(cursor + 8), view.getUint32(cursor + 12)), colorType: color };
    } else if (type === "PLTE") {
      if (palette || seenImage || !length || length > 768 || length % 3) fail("paleta PNG inválida.");
      palette = true;
    } else if (type === "IDAT") {
      if (afterImage || size.colorType === 3 && !palette) fail("ordem dos dados PNG inválida.");
      seenImage = true;
      imageBytes += length;
    } else if (type === "IEND") {
      if (length || !imageBytes || end !== bytes.length) fail("fim PNG ausente, prematuro ou com conteúdo anexado.");
      return { ...size, validation: { level: "png_structure_and_chunk_crc", chunks: count } };
    } else {
      if (type[0] === type[0].toUpperCase()) fail("chunk crítico PNG não suportado.", "unsupported_document");
      if (seenImage) afterImage = true;
    }
    cursor = end;
  }
  fail("IEND PNG ausente.");
}
function checkJpeg(bytes) {
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    fail("fim JPEG ausente ou com conteúdo anexado.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 2, frame = null, scans = 0, segments = 0;
  while (cursor < bytes.length) {
    if (++segments > PHOTO_ORIGINAL_LIMITS.chunks) fail("quantidade de segmentos JPEG excedida.", "document_limit");
    if (bytes[cursor++] !== 255) fail("marcador JPEG inválido.");
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++];
    if (marker === 217) {
      if (cursor !== bytes.length || !frame || !scans) fail("JPEG incompleto ou com conteúdo anexado.");
      return { ...frame, validation: { level: "jpeg_markers_and_dimensions", segments, scans } };
    }
    if (marker === 1) continue;
    if (marker === undefined || marker === 0 || marker === 216 || marker >= 208 && marker <= 215 || cursor + 2 > bytes.length)
      fail("marcador JPEG inesperado ou truncado.");
    const length = view.getUint16(cursor), end = cursor + length;
    if (length < 2 || end > bytes.length - 2) fail("segmento JPEG truncado.");
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (![192, 193, 194].includes(marker)) fail("codificação JPEG não suportada.", "unsupported_document");
      if (frame || length < 8 || bytes[cursor + 2] !== 8) fail("cabeçalho SOF JPEG inválido ou não suportado.");
      const components = bytes[cursor + 7];
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) fail("componentes JPEG inválidos.");
      frame = { ...dimensions(view.getUint16(cursor + 5), view.getUint16(cursor + 3)), components };
    }
    cursor = end;
    if (marker === 218) {
      const components = bytes[end - length + 2];
      if (!frame || length < 6 || !components || components > frame.components || length !== 6 + 2 * components) fail("cabeçalho SOS JPEG inválido.");
      scans++;
      // Read marker boundaries only. Entropy-coded pixels, APP/EXIF and thumbnails remain untouched.
      for (; cursor < bytes.length; cursor++) {
        if (bytes[cursor] !== 255) continue;
        let next = cursor + 1;
        while (bytes[next] === 255) next++;
        if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { cursor = next; continue; }
        break;
      }
    }
  }
  fail("fim JPEG ausente.");
}
export function validatePhoto(input, options = {}) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  if (!(bytes instanceof Uint8Array) || !bytes.length) fail("foto vazia ou tipo de bytes inválido.");
  if (bytes.length > PHOTO_ORIGINAL_LIMITS.fileBytes) fail("foto acima de 8 MiB.", "document_limit");
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte),
    jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    format = png ? "image_png" : jpeg ? "image_jpeg" : null,
    mime = png ? "image/png" : "image/jpeg", name = typeof options.name === "string" ? options.name : "",
    extension = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase();
  if (!format || options.format && options.format !== format) fail("somente fotos JPEG e PNG são suportadas.", "unsupported_document");
  if (extension && !(png ? ["png"] : ["jpg", "jpeg"]).includes(extension)) fail("extensão da foto divergente.", "unsupported_document");
  if (options.mime && options.mime !== mime) fail("tipo MIME da foto divergente.", "unsupported_document");
  rejectExecutableText(bytes);
  const result = png ? checkPng(bytes) : checkJpeg(bytes);
  return { format, sheets: [], metadata: { readerVersion: DOCUMENT_ORIGINAL_VERSION, extraction: "not_performed",
    fileBytes: bytes.length, limits: PHOTO_ORIGINAL_LIMITS, ...result, exif: "not_extracted", originalOrientation: "preserved",
    warnings: ["Original preservado sem redimensionamento, rotação ou extração de EXIF/metadados.",
      "Verificação estrutural sem decodificação dos pixels ou varredura integral de segurança; nenhuma foto foi associada automaticamente a ativo ou LVT."] } };
}
