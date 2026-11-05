(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresLineDrawingModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  // Local schematic editing only. Grid cells and symbol shapes have no physical
  // units or normative meaning. All IDs/links are caller declarations, not proof.
  const SCHEMA = "pires-line-drawing-local-v1";
  // Keep the V1 renderer when adding future libraries; changing shapes requires
  // another internal schematic version, never a normative revision or approval.
  const SYMBOL_LIBRARY_VERSION = "pires-schematic-symbols-v1";
  const LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, depth: 32, jsonNodes: 200000,
    snapshots: 100, nodes: 500, segments: 1000, symbols: 500, points: 500, linkIds: 100, grid: 200 });
  const SCOPE_IDS = ["ownerId", "contractId", "systemId", "assetId", "lineId"], SCOPE = [...SCOPE_IDS, "tagLabel"];
  const CONTENT = ["scope", "symbolLibraryVersion", "grid", "nodes", "segments", "symbols", "inspectionPoints"];
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const SYMBOLS = Object.freeze([
    ["valve", "Válvula"], ["flange", "Flange"], ["reducer", "Redução"], ["tee", "Derivação T"],
    ["elbow", "Curva"], ["instrument", "Instrumento"],
  ].map(([kind, label]) => Object.freeze({ kind, label, source: "internal_schematic_non_normative" })));
  const FLAGS = Object.freeze({ draft: true, status: "local_schematic_draft", gridUnits: "none",
    canCertify: false, canIssue: false, approvedAsBuilt: false, identityVerified: false,
    declaredLinksVerified: false, declaredLinksMeaning: "tag_scoped_declarations_only", originalSourceVerified: false });
  const own = (value, key) => Object.hasOwn(value, key);
  function invalid(path, message) {
    const error = new TypeError(path + ": " + message); error.code = "invalid_line_drawing"; error.path = path; throw error;
  }
  function canonical(input) {
    let bytes = LIMITS.bytes, nodes = LIMITS.jsonNodes;
    const ancestors = new Set(), encoder = new TextEncoder();
    const emit = (value, path) => { bytes -= encoder.encode(value).length; if (bytes < 0) invalid(path, "JSON excede 8 MiB"); return value; };
    function visit(value, path, depth) {
      if (depth > LIMITS.depth) invalid(path, "JSON excede 32 níveis");
      if (--nodes < 0) invalid(path, "JSON excede limite de elementos");
      if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return emit(JSON.stringify(value), path);
      if (typeof value === "string") { if (!value.isWellFormed()) invalid(path, "Unicode inválido"); return emit(JSON.stringify(value), path); }
      if (!value || typeof value !== "object" || ancestors.has(value)) invalid(path, "somente JSON finito sem ciclos");
      const array = Array.isArray(value);
      if (array && value.length > LIMITS.segments) invalid(path, "lista excede 1000 elementos");
      if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, "somente objeto JSON simples");
      const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
      if (keys.some(key => typeof key !== "string" || !("value" in descriptors[key]))) invalid(path, "acessores e símbolos não são aceitos");
      ancestors.add(value); let result;
      if (array) {
        if (Object.keys(value).length !== value.length) invalid(path, "lista esparsa ou com propriedades extras");
        emit("[]" + ",".repeat(Math.max(0, value.length - 1)), path);
        result = "[" + Array.from({ length: value.length }, (_, i) => visit(descriptors[i]?.value, path + "[" + i + "]", depth + 1)).join(",") + "]";
      } else {
        const names = Object.keys(descriptors).sort(); emit("{}" + ",".repeat(Math.max(0, names.length - 1)), path);
        result = "{" + names.map(key => emit(JSON.stringify(key) + ":", path) + visit(descriptors[key].value, path + "." + key, depth + 1)).join(",") + "}";
      }
      ancestors.delete(value); return result;
    }
    return visit(input, "input", 0);
  }
  const copy = value => JSON.parse(canonical(value));
  function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function object(value, path, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, "objeto obrigatório");
    for (const key of Object.keys(value)) if (!fields.includes(key)) invalid(path + "." + key, "campo não reconhecido");
    for (const key of fields) if (!own(value, key)) invalid(path + "." + key, "campo explícito obrigatório");
  }
  function text(value, path) { if (typeof value !== "string" || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) invalid(path, "texto explícito de até 160 caracteres obrigatório"); }
  function id(value, path) { if (typeof value !== "string" || !UUID.test(value)) invalid(path, "UUID canônico declarado obrigatório"); }
  function scope(value, path, label = true) { object(value, path, label ? SCOPE : SCOPE_IDS); for (const key of SCOPE_IDS) id(value[key], path + "." + key); if (label) text(value.tagLabel, path + ".tagLabel"); }
  function sameScope(actual, expected, path, label = true) { scope(expected, path + ".expected", label || own(expected, "tagLabel")); for (const key of label ? SCOPE : SCOPE_IDS) if (actual[key] !== expected[key]) invalid(path + "." + key, "escopo declarado divergente"); }
  function rows(value, path, limit, identities) {
    if (!Array.isArray(value) || value.length > limit) invalid(path, "lista explícita excede limite " + limit);
    value.forEach((row, index) => { id(row?.id, path + "[" + index + "].id"); if (identities.has(row.id)) invalid(path, "ID repetido no desenho"); identities.add(row.id); });
  }
  function ids(value, path) {
    if (!Array.isArray(value) || value.length > LIMITS.linkIds) invalid(path, "lista de até 100 IDs declarados obrigatória");
    const seen = new Set(); value.forEach((value, index) => { id(value, path + "[" + index + "]"); if (seen.has(value)) invalid(path, "ID repetido"); seen.add(value); });
  }
  function anchor(value, path, nodeMap, segmentMap) {
    if (value?.kind === "node") { object(value, path, ["kind", "nodeId"]); if (!nodeMap.has(value.nodeId)) invalid(path, "nó de ancoragem não existe"); }
    else if (value?.kind === "segment") {
      object(value, path, ["kind", "segmentId", "ratio"]);
      if (!segmentMap.has(value.segmentId)) invalid(path, "segmento de ancoragem não existe");
      if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio) || value.ratio < 0 || value.ratio > 1) invalid(path + ".ratio", "fração esquemática explícita entre 0 e 1 obrigatória");
    } else invalid(path, "ancoragem explícita em nó ou segmento obrigatória");
  }
  function validateContent(content) {
    object(content, "content", CONTENT); scope(content.scope, "scope"); object(content.grid, "grid", ["columns", "rows"]);
    if (content.symbolLibraryVersion !== SYMBOL_LIBRARY_VERSION) invalid("symbolLibraryVersion", "versão da biblioteca esquemática desconhecida; preserve o renderer da versão salva");
    for (const key of ["columns", "rows"]) if (!Number.isSafeInteger(content.grid[key]) || content.grid[key] < 2 || content.grid[key] > LIMITS.grid) invalid("grid." + key, "malha esquemática deve ter entre 2 e 200 posições");
    const identities = new Set(), positions = new Set();
    rows(content.nodes, "nodes", LIMITS.nodes, identities); const nodeMap = new Map(content.nodes.map((node, index) => {
      const path = "nodes[" + index + "]"; object(node, path, ["id", "x", "y"]);
      for (const [axis, bound] of [["x", content.grid.columns], ["y", content.grid.rows]]) if (!Number.isSafeInteger(node[axis]) || node[axis] < 0 || node[axis] >= bound) invalid(path + "." + axis, "posição inteira explícita dentro da malha obrigatória");
      const position = node.x + ":" + node.y; if (positions.has(position)) invalid(path, "posição de nó repetida; reutilize o nó explícito"); positions.add(position); return [node.id, node];
    }));
    rows(content.segments, "segments", LIMITS.segments, identities); const connections = new Set(), segmentMap = new Map(content.segments.map((segment, index) => {
      const path = "segments[" + index + "]"; object(segment, path, ["id", "fromNodeId", "toNodeId"]);
      if (!nodeMap.has(segment.fromNodeId) || !nodeMap.has(segment.toNodeId) || segment.fromNodeId === segment.toNodeId) invalid(path, "segmento exige dois nós distintos existentes");
      const connection = [segment.fromNodeId, segment.toNodeId].sort().join(":"); if (connections.has(connection)) invalid(path, "segmento entre os mesmos nós repetido"); connections.add(connection); return [segment.id, segment];
    }));
    rows(content.symbols, "symbols", LIMITS.symbols, identities); content.symbols.forEach((symbol, index) => {
      const path = "symbols[" + index + "]"; object(symbol, path, ["id", "kind", "anchor"]);
      if (!SYMBOLS.some(entry => entry.kind === symbol.kind)) invalid(path + ".kind", "figura não pertence à biblioteca esquemática interna"); anchor(symbol.anchor, path + ".anchor", nodeMap, segmentMap);
    });
    rows(content.inspectionPoints, "inspectionPoints", LIMITS.points, identities); const labels = new Set();
    content.inspectionPoints.forEach((point, index) => {
      const path = "inspectionPoints[" + index + "]"; object(point, path, ["id", "label", "anchor", "links"]); text(point.label, path + ".label");
      if (labels.has(point.label.trim())) invalid(path + ".label", "rótulo de ponto repetido"); labels.add(point.label.trim()); anchor(point.anchor, path + ".anchor", nodeMap, segmentMap);
      if (point.links !== null) {
        // Without an LVT item, supplied IDs remain TAG-level declarations. Even
        // with an item ID, this prototype does not verify photo/item/RTI relations.
        object(point.links, path + ".links", ["scope", "lvtItemId", "photoIds", "rtiIds"]); scope(point.links.scope, path + ".links.scope", false); sameScope(point.links.scope, content.scope, path + ".links.scope", false);
        if (point.links.lvtItemId !== null) id(point.links.lvtItemId, path + ".links.lvtItemId");
        ids(point.links.photoIds, path + ".links.photoIds"); ids(point.links.rtiIds, path + ".links.rtiIds");
      }
    });
    return content;
  }
  async function digest(value) {
    const crypto = root.crypto || (typeof require === "function" ? require("node:crypto").webcrypto : null);
    if (!crypto?.subtle) invalid("digest", "SHA-256 local indisponível");
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value))));
    return "sha256:" + Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }
  const without = (value, field) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
  async function buildHistory(selectedScope, snapshots) {
    const body = { schema: SCHEMA, modelVersion: 1, scope: selectedScope, snapshots, ...FLAGS, signatures: [] };
    return freeze(copy({ ...body, historyDigest: await digest(body) }));
  }
  async function snapshot(content, previous) {
    const body = { internalRevision: previous ? previous.internalRevision + 1 : 1, content,
      contentDigest: await digest(content), previousSnapshotDigest: previous?.snapshotDigest || null };
    return { ...body, snapshotDigest: await digest(body) };
  }
  async function verifyHistory(input, expectedScope) {
    // Capture all caller declarations before the first await.
    const history = copy(input), expected = expectedScope === undefined ? undefined : copy(expectedScope);
    object(history, "history", ["schema", "modelVersion", "scope", "snapshots", ...Object.keys(FLAGS), "signatures", "historyDigest"]);
    if (history.schema !== SCHEMA || history.modelVersion !== 1) invalid("history", "schema/versão local incompatíveis");
    scope(history.scope, "history.scope"); if (expected !== undefined) sameScope(history.scope, expected, "history.scope");
    for (const [key, value] of Object.entries(FLAGS)) if (history[key] !== value) invalid("history." + key, "protótipo não admite certificação, emissão ou ato técnico");
    if (!Array.isArray(history.signatures) || history.signatures.length) invalid("history.signatures", "assinaturas não são aceitas");
    if (!Array.isArray(history.snapshots) || !history.snapshots.length || history.snapshots.length > LIMITS.snapshots) invalid("history.snapshots", "histórico deve conter de 1 a 100 rascunhos");
    let previous = null;
    for (const saved of history.snapshots) {
      object(saved, "snapshot", ["internalRevision", "content", "contentDigest", "previousSnapshotDigest", "snapshotDigest"]);
      validateContent(saved.content); sameScope(saved.content.scope, history.scope, "snapshot.scope");
      if (saved.internalRevision !== (previous ? previous.internalRevision + 1 : 1) || saved.previousSnapshotDigest !== (previous?.snapshotDigest || null)) invalid("snapshot", "histórico local fora de sequência");
      if (saved.contentDigest !== await digest(saved.content) || saved.snapshotDigest !== await digest(without(saved, "snapshotDigest"))) invalid("snapshot", "conteúdo ou histórico diverge do digest local");
      if (saved.contentDigest === previous?.contentDigest) invalid("snapshot", "salvamento sem alteração não deve acrescentar revisão"); previous = saved;
    }
    if (history.historyDigest !== await digest(without(history, "historyDigest"))) invalid("history.historyDigest", "histórico alterado; digest não é assinatura");
    return freeze(history);
  }
  async function createHistory(input) {
    const content = validateContent(copy(input)); return buildHistory(copy(content.scope), [await snapshot(content, null)]);
  }
  async function saveDraft(input, changed) {
    const historyInput = copy(input), content = validateContent(copy(changed));
    const history = await verifyHistory(historyInput, content.scope), last = history.snapshots.at(-1);
    if (await digest(content) === last.contentDigest) return history;
    if (history.snapshots.length >= LIMITS.snapshots) invalid("history.snapshots", "histórico atingiu limite de 100 rascunhos; não sobrescreva revisões");
    return buildHistory(copy(history.scope), [...history.snapshots, await snapshot(content, last)]);
  }
  async function importJson(text, expectedScope, existingHistory) {
    if (typeof text !== "string" || !text.isWellFormed() || new TextEncoder().encode(text).length > LIMITS.bytes) invalid("import", "JSON UTF-8 de até 8 MiB obrigatório");
    let history; try { history = JSON.parse(text); } catch { invalid("import", "JSON inválido"); }
    const expected = expectedScope === undefined ? undefined : copy(expectedScope), existing = existingHistory == null ? null : copy(existingHistory);
    const incoming = await verifyHistory(history, expected);
    if (existing !== null) {
      const saved = await verifyHistory(existing, expected); sameScope(incoming.scope, saved.scope, "import.scope");
      if (incoming.snapshots.length < saved.snapshots.length || saved.snapshots.some((snapshot, index) => snapshot.snapshotDigest !== incoming.snapshots[index]?.snapshotDigest))
        invalid("import.snapshots", "importação não pode substituir ou remover o histórico atual; retome uma versão antiga como novo rascunho");
    }
    // This compares the locally supplied chain only. Recomputed hashes neither
    // authenticate authorship nor provide forensic/remote retention guarantees.
    return incoming;
  }
  async function exportJson(history) { return canonical(await verifyHistory(history)); }
  return Object.freeze({ SCHEMA, SYMBOL_LIBRARY_VERSION, LIMITS, SYMBOLS, createHistory, saveDraft, verifyHistory, importJson, exportJson });
});
