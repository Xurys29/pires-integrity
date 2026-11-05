(function () {
  "use strict";
  const M = window.PiresLineDrawingModel, $ = id => document.getElementById(id), NS = "http://www.w3.org/2000/svg",
    PREFIX = "pires.line-drawing.v1:", VERSION = "pires-schematic-symbols-v1", STEP = 26, PAD = 55, C = Math.sqrt(3) / 2,
    scopeIds = ["ownerId", "contractId", "systemId", "assetId", "lineId"], scopeFields = [...scopeIds, "tagLabel"],
    UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const copy = value => JSON.parse(JSON.stringify(value)), uid = () => crypto.randomUUID(), eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blank = () => ({ scope: Object.fromEntries(scopeFields.map(k => [k, ""])), symbolLibraryVersion: VERSION, grid: { columns: 40, rows: 40 }, nodes: [], segments: [], symbols: [], inspectionPoints: [] });
  let draft = blank(), history = null, viewing = null, selected = null, pendingPoint = null, lineStart = null,
    tool = "line", zoom = .65, undo = [], redo = [], drag = null, busy = false, serial = 0, loadedRaw = null, loadedKey = null, persistedDigest = null, ignoreSelectClick = false;
  const svg = $("drawingCanvas"), viewport = $("canvasViewport"), content = () => viewing === null ? draft : history.snapshots[viewing].content;
  const validScope = scope => scope && scopeIds.every(k => UUID.test(scope[k] || "")) && typeof scope.tagLabel === "string" && scope.tagLabel.trim() && scope.tagLabel.length <= 160 && !/[\u0000-\u001f\u007f]/.test(scope.tagLabel);
  const keyFor = scope => PREFIX + scopeFields.map(k => encodeURIComponent(scope[k])).join("/");
  const dirty = () => history ? history.historyDigest !== persistedDigest || !eq(draft, history.snapshots.at(-1).content) : Boolean(draft.nodes.length || draft.symbols.length || draft.inspectionPoints.length || validScope(draft.scope));
  const atHistoryLimit = () => Boolean(history && history.snapshots.length >= M.LIMITS.snapshots);
  const writable = () => viewing === null && !busy && !atHistoryLimit();
  function say(text, error = false) { $("feedback").textContent = text; $("feedback").className = error ? "error" : "success"; }
  const node = (tag, attrs = {}, text) => { const n = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value)); if (text !== undefined) n.textContent = text; return n; };
  const html = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  // White-space margins keep labels visible even for a tiny imported grid.
  // This changes the artboard only, never graph coordinates or physical scale.
  function size(data = content()) { return { width: Math.max(740, (data.grid.columns + data.grid.rows - 2) * STEP * C + 2 * PAD), height: Math.max(220, (data.grid.columns + data.grid.rows - 2) * STEP / 2 + 2 * PAD) }; }
  function project(p, data = content()) { return { x: PAD + (data.grid.rows - 1 + p.x - p.y) * STEP * C, y: PAD + (p.x + p.y) * STEP / 2 }; }
  function snap(point, data = content()) {
    const dx = (point.x - PAD) / (STEP * C) - data.grid.rows + 1, sum = (point.y - PAD) * 2 / STEP;
    return { x: Math.max(0, Math.min(data.grid.columns - 1, Math.round((sum + dx) / 2))), y: Math.max(0, Math.min(data.grid.rows - 1, Math.round((sum - dx) / 2))) };
  }
  function svgPoint(event) { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
  function position(anchor, data = content()) {
    if (anchor.kind === "node") { const n = data.nodes.find(n => n.id === anchor.nodeId); return n ? { ...project(n, data), rotation: 0 } : null; }
    const s = data.segments.find(s => s.id === anchor.segmentId), a = s && data.nodes.find(n => n.id === s.fromNodeId), b = s && data.nodes.find(n => n.id === s.toNodeId);
    if (!a || !b) return null; const p = project(a, data), q = project(b, data);
    return { x: p.x + (q.x - p.x) * anchor.ratio, y: p.y + (q.y - p.y) * anchor.ratio, rotation: Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI };
  }
  function nearestAnchor(point, data, newId = uid()) {
    let best = null, distance = 18 / zoom;
    for (const n of data.nodes) { const p = project(n, data), d = Math.hypot(point.x - p.x, point.y - p.y); if (d < distance) { distance = d; best = { anchor: { kind: "node", nodeId: n.id } }; } }
    for (const s of data.segments) {
      const a = project(data.nodes.find(n => n.id === s.fromNodeId), data), b = project(data.nodes.find(n => n.id === s.toNodeId), data), dx = b.x - a.x, dy = b.y - a.y,
        ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))), d = Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
      if (d < distance) { distance = d; best = { anchor: { kind: "segment", segmentId: s.id, ratio: Math.round(ratio * 10000) / 10000 } }; }
    }
    if (best) return best;
    const p = snap(point, data), existing = data.nodes.find(n => n.x === p.x && n.y === p.y);
    return existing ? { anchor: { kind: "node", nodeId: existing.id } } : { anchor: { kind: "node", nodeId: newId }, newNode: { id: newId, ...p } };
  }
  function findOrAdd(data, point) { let n = data.nodes.find(n => n.x === point.x && n.y === point.y); if (!n) { n = { id: uid(), ...point }; data.nodes.push(n); } return n; }
  function basic(data) {
    for (const [kind, max] of [["nodes", M.LIMITS.nodes], ["segments", M.LIMITS.segments], ["symbols", M.LIMITS.symbols], ["inspectionPoints", M.LIMITS.points]]) if (data[kind].length > max) throw Error("Limite de " + max + " elementos para " + kind + ". Exporte o desenho antes de iniciar outro.");
    const positions = new Set(); for (const n of data.nodes) { const p = n.x + ":" + n.y; if (positions.has(p)) throw Error("Já existe um nó nessa posição. Os nós não são fundidos automaticamente."); positions.add(p); }
    return data;
  }
  function commit(next, message) {
    if (!writable()) return; basic(next); if (eq(next, draft)) return;
    undo.push(copy(draft)); if (undo.length > 60) undo.shift(); redo = []; draft = next; serial++; render(); if (message) say(message);
  }
  function change(fn, message) { try { const next = copy(draft); fn(next); commit(next, message); } catch (error) { say(error.message, true); } }
  function symbolDrawing(parent, kind, p, isSelected) {
    const g = node("g", { transform: `translate(${p.x} ${p.y}) rotate(${p.rotation || 0})`, fill: "#fbfdff", stroke: isSelected ? "#cc8a20" : "#175d9b", "stroke-width": 2, "stroke-linejoin": "round" });
    if (kind === "valve") g.append(node("path", { d: "M-12,-9 L0,0 L-12,9 Z M12,-9 L0,0 L12,9 Z" }));
    else if (kind === "flange") g.append(node("path", { d: "M-5,-13 V13 M5,-13 V13 M-14,0 H-5 M5,0 H14", fill: "none" }));
    else if (kind === "reducer") g.append(node("path", { d: "M-14,-10 L14,-5 L14,5 L-14,10 Z" }));
    else if (kind === "tee") g.append(node("path", { d: "M-14,0 H14 M0,0 V-17", fill: "none", "stroke-width": 4 }));
    else if (kind === "elbow") g.append(node("path", { d: "M-13,9 H-3 Q10,9 10,-4 V-14", fill: "none", "stroke-width": 4 }));
    else if (kind === "instrument") g.append(node("circle", { r: 11 }), node("path", { d: "M0,11 V20", fill: "none" }));
    parent.append(g);
  }
  function labelLines(text) { const result = [], letters = Array.from(text); for (let i = 0; i < letters.length; i += 20) result.push(letters.slice(i, i + 20).join("")); return result; }
  function draw(target, data, exporting = false) {
    if (data.symbolLibraryVersion !== VERSION) throw Error("Biblioteca do estado salvo não suportada. O desenho não será reinterpretado com outras figuras.");
    target.replaceChildren(); const dimensions = size(data); target.setAttribute("viewBox", `0 0 ${dimensions.width} ${dimensions.height}`);
    const grid = node("g", { stroke: "#b8d0eb", "stroke-width": .65, opacity: .65, "aria-hidden": true });
    const gridLine = (a, b) => { const p = project(a, data), q = project(b, data); grid.append(node("line", { x1: p.x, y1: p.y, x2: q.x, y2: q.y })); };
    for (let x = 0; x < data.grid.columns; x++) gridLine({ x, y: 0 }, { x, y: data.grid.rows - 1 });
    for (let y = 0; y < data.grid.rows; y++) gridLine({ x: 0, y }, { x: data.grid.columns - 1, y });
    for (let sum = 0; sum < data.grid.columns + data.grid.rows - 1; sum++) { const x = Math.max(0, sum - data.grid.rows + 1), end = Math.min(data.grid.columns - 1, sum); gridLine({ x, y: sum - x }, { x: end, y: sum - end }); }
    target.append(node("rect", { width: dimensions.width, height: dimensions.height, fill: "#fbfdff" }), grid);
    const layer = node("g"); target.append(layer);
    for (const s of data.segments) {
      const a = project(data.nodes.find(n => n.id === s.fromNodeId), data), b = project(data.nodes.find(n => n.id === s.toNodeId), data), active = !exporting && selected?.kind === "segment" && selected.id === s.id;
      if (!exporting) layer.append(node("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: "transparent", "stroke-width": 18, "data-kind": "segment", "data-id": s.id, class: "hit-target" }));
      layer.append(node("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: active ? "#cc8a20" : "#175d9b", "stroke-width": 3, "stroke-linecap": "round", "data-kind": "segment", "data-id": s.id }));
    }
    for (const n of data.nodes) {
      const p = project(n, data), active = !exporting && selected?.kind === "node" && selected.id === n.id;
      if (!exporting) layer.append(node("circle", { cx: p.x, cy: p.y, r: 11, fill: "transparent", "data-kind": "node", "data-id": n.id, class: "hit-target" }));
      layer.append(node("circle", { cx: p.x, cy: p.y, r: active ? 5 : 2.8, fill: active ? "#cc8a20" : "#175d9b", "data-kind": "node", "data-id": n.id }));
    }
    for (const s of data.symbols) {
      const p = position(s.anchor, data); if (!p) continue;
      const g = node("g", { "data-kind": "symbol", "data-id": s.id }); g.append(node("circle", { cx: p.x, cy: p.y, r: 18, fill: "transparent", class: "hit-target" })); symbolDrawing(g, s.kind, p, !exporting && selected?.kind === "symbol" && selected.id === s.id); layer.append(g);
    }
    for (const point of data.inspectionPoints) {
      const p = position(point.anchor, data); if (!p) continue;
      const g = node("g", { "data-kind": "point", "data-id": point.id }), active = !exporting && selected?.kind === "point" && selected.id === point.id,
        lines = labelLines(point.label), width = Math.min(320, Math.max(...lines.map(l => Array.from(l).length)) * 14 + 12), left = Math.max(8, Math.min(dimensions.width - width - 8, p.x + 13)), top = Math.max(24, p.y - 21 - (lines.length - 1) * 14);
      g.append(node("circle", { cx: p.x, cy: p.y, r: 15, fill: "transparent", class: "hit-target" }), node("circle", { cx: p.x, cy: p.y, r: 8, fill: "#fff", stroke: active ? "#cc8a20" : "#175d9b", "stroke-width": 2 }), node("circle", { cx: p.x, cy: p.y, r: 2.5, fill: "#175d9b" }), node("rect", { x: left - 4, y: top - 12, width, height: lines.length * 14 + 5, fill: "#fbfdff", opacity: .94, rx: 3 }));
      const text = node("text", { x: left, y: top, fill: "#164d80", "font-size": 11, "font-family": "system-ui,sans-serif", "font-weight": 600 });
      lines.forEach((line, i) => text.append(node("tspan", { x: left, dy: i ? 14 : 0 }, line))); g.append(text); layer.append(g);
    }
    if (!exporting && lineStart && tool === "line" && viewing === null) { const p = project(lineStart, data); layer.append(node("circle", { cx: p.x, cy: p.y, r: 7, fill: "#e9a83a", stroke: "white", "stroke-width": 2 })); }
  }
  function updateScopeInputs() {
    for (const key of scopeFields) { const input = $("scopeForm").elements[key]; input.value = draft.scope[key]; input.disabled = Boolean(history) || viewing !== null || busy; }
    $("generateIds").disabled = $("applyScope").disabled = Boolean(history) || viewing !== null || busy;
    $("scopeCaption").textContent = validScope(content().scope) ? content().scope.tagLabel : "Defina antes de salvar";
  }
  function selectionUI() {
    const info = $("selectionInfo"); info.replaceChildren(); const data = content();
    const names = { node: "Nó gráfico", segment: "Trecho do desenho", symbol: "Figura esquemática", point: "Ponto de levantamento" };
    if (selected) {
      info.append(html("strong", names[selected.kind]));
      if (selected.kind === "symbol") { const s = data.symbols.find(s => s.id === selected.id); info.append(html("p", M.SYMBOLS.find(x => x.kind === s?.kind)?.label || "Figura")); }
      if (selected.kind === "point") {
        const p = data.inspectionPoints.find(p => p.id === selected.id); info.append(html("p", p?.label));
        info.append(html("p", p?.links ? "TAG e IDs declarados, não verificados. Relações com item/fotos/RTIs não são comprovadas." : "Ponto sem vínculo declarado.", "small"));
        if (writable()) { const edit = html("button", "Editar ponto"); edit.type = "button"; edit.onclick = () => showPoint(p); info.append(edit); }
      }
      if (viewing !== null) info.append(html("p", "Estado salvo em visualização: somente leitura.", "small"));
      else info.append(html("p", "Arraste a seleção para reposicionar na malha. Sem dimensão física.", "small"));
    }
    $("deleteButton").disabled = !selected || !writable();
  }
  function historyUI() {
    const list = $("historyList"); list.replaceChildren(); $("historyCount").textContent = history?.snapshots.length || 0;
    if (!history) { list.append(html("p", "Nenhum estado salvo.", "empty")); return; }
    for (let index = history.snapshots.length - 1; index >= 0; index--) {
      const saved = history.snapshots[index], row = html("article", undefined, "history-entry"); row.dataset.revision = saved.internalRevision;
      row.append(html("strong", "Estado local " + saved.internalRevision), html("p", saved.content.segments.length + " trechos · " + saved.content.inspectionPoints.length + " pontos · " + saved.contentDigest.slice(7, 19)));
      const view = html("button", "Visualizar estado " + saved.internalRevision); view.type = "button"; view.disabled = busy; view.onclick = () => { if (busy) return; viewing = index; selected = null; pendingPoint = null; lineStart = null; $("pointPanel").hidden = true; render(); say("Histórico em somente leitura. Seu rascunho em edição foi preservado."); }; row.append(view); list.append(row);
    }
  }
  function render() {
    const data = content();
    try { draw(svg, data); } catch (error) { say(error.message, true); return; }
    const dimensions = size(data); svg.setAttribute("width", dimensions.width * zoom); svg.setAttribute("height", dimensions.height * zoom); svg.dataset.tool = tool;
    $("zoomLabel").textContent = Math.round(zoom * 100) + "%";
    $("counts").textContent = `${data.segments.length} trechos · ${data.symbols.length} símbolos · ${data.inspectionPoints.length} pontos`;
    $("dirtyIndicator").textContent = viewing !== null ? "Histórico · somente leitura" : history && history.historyDigest !== persistedDigest && eq(draft, history.snapshots.at(-1).content) ? "Importado · ainda não guardado" : dirty() ? "Alterações no rascunho" : history ? "Salvo neste navegador" : "Em branco · não salvo";
    $("dirtyIndicator").classList.toggle("pending", viewing === null && (dirty() || !history));
    $("historyNotice").hidden = viewing === null; if (viewing !== null) $("historyNoticeText").textContent = "Estado local " + history.snapshots[viewing].internalRevision + " · somente leitura · biblioteca V1 preservada";
    for (const b of document.querySelectorAll("[data-tool]")) { const active = b.dataset.tool === tool; b.classList.toggle("active", active); b.setAttribute("aria-pressed", active); b.disabled = !writable(); }
    $("symbolKind").disabled = !writable(); $("undoButton").disabled = !undo.length || !writable(); $("redoButton").disabled = !redo.length || !writable();
    for (const id of ["saveButton", "newButton", "exampleButton", "importButton", "resumeButton", "exportJsonButton", "exportSvgButton", "branchHistory", "leaveHistory"]) $(id).disabled = busy || id === "saveButton" && viewing !== null;
    if (atHistoryLimit()) $("branchHistory").disabled = true;
    $("toolHint").textContent = atHistoryLimit() ? "Limite de 100 estados: desenho preservado em somente leitura. Exporte JSON antes de iniciar outro desenho." : viewing !== null ? "Este estado salvo não pode ser editado. Retome explicitamente como novo rascunho." : ({ line: lineStart ? "Escolha o segundo ponto da malha. Esc cancela o início." : "Toque em dois pontos da malha para desenhar uma linha.", select: "Selecione e arraste um nó, trecho, figura ou ponto para mover.", symbol: "Toque em um nó, trecho ou posição da malha para inserir a figura.", point: "Toque para posicionar e confirme o rótulo do ponto no formulário." })[tool];
    selectionUI(); updateScopeInputs(); historyUI();
  }
  function setTool(value) { if (!writable()) return; tool = value; lineStart = null; pendingPoint = null; $("pointPanel").hidden = true; render(); }
  function confirmAction(title, text, label = "Continuar") {
    return new Promise(resolve => {
      $("confirmTitle").textContent = title; $("confirmText").textContent = text; $("confirmAccept").textContent = label;
      const dialog = $("confirmDialog"), finish = value => { dialog.removeEventListener("cancel", cancel); $("confirmCancel").onclick = null; $("confirmAccept").onclick = null; dialog.close(); resolve(value); }, cancel = event => { event.preventDefault(); finish(false); };
      $("confirmCancel").onclick = () => finish(false); $("confirmAccept").onclick = () => finish(true); dialog.addEventListener("cancel", cancel); dialog.showModal(); $("confirmCancel").focus();
    });
  }
  async function discardDraft() { return !dirty() || confirmAction("Substituir o rascunho em edição?", "Há alterações não salvas neste navegador. Exporte JSON ou salve antes para manter uma cópia. Os estados já salvos continuarão preservados.", "Substituir rascunho"); }
  async function run(action, localFeedback) {
    if (busy) return; busy = true; render();
    try { await action(); } catch (error) { const limits = /JSON excede|histórico atingiu limite/.test(error.message || ""), message = (error.message || "A operação local não foi concluída.") + (limits ? " Nenhum estado salvo foi apagado; o rascunho novo continua em memória. O limite pode impedir sua exportação com o histórico. Visualize um estado salvo para exportar o histórico preservado antes de iniciar outro desenho." : ""); say(message, true); if (localFeedback) localFeedback.textContent = message; }
    finally { busy = false; render(); }
  }
  function needScope() { if (!validScope(draft.scope)) { $("scopeDetails").open = true; $("tagLabel").focus(); throw Error("Defina a TAG e os IDs declarados do escopo antes de guardar o desenho."); } }
  async function candidate() { needScope(); return history ? M.saveDraft(history, copy(draft)) : M.createHistory(copy(draft)); }
  function download(name, text, type) { const url = URL.createObjectURL(new Blob([text], { type })), a = html("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const safeName = tag => String(tag).replace(/[^a-z0-9_-]/gi, "_").slice(0, 70) || "linha-local";
  async function save() {
    const captured = serial, next = await candidate(), key = keyFor(next.scope);
    if (captured !== serial) throw Error("O rascunho mudou durante a conferência. Salve novamente.");
    const raw = await M.exportJson(next);
    if (!navigator.locks?.request) throw Error("Este navegador não oferece o bloqueio local necessário para salvar com segurança entre abas. Exporte JSON para guardar o rascunho.");
    await navigator.locks.request("pires-line-drawing:" + key, { mode: "exclusive" }, () => {
      // Every writer in this prototype uses this origin-scoped lock. No await
      // separates the optimistic read, conflict guard and atomic local write.
      if (captured !== serial) throw Error("O rascunho mudou durante a conferência. Salve novamente.");
      const stored = localStorage.getItem(key);
      if (stored !== loadedRaw || loadedKey && key !== loadedKey) throw Error("Conflito com outro histórico ou aba. O último estado local e seu rascunho foram preservados; retome a cópia local antes de salvar.");
      try { localStorage.setItem(key, raw); } catch { throw Error("Não foi possível salvar neste navegador. O último estado local foi preservado. Exporte JSON para guardar o rascunho atual."); }
      history = next; loadedKey = key; loadedRaw = raw; persistedDigest = next.historyDigest; draft = copy(next.snapshots.at(-1).content); viewing = null;
    });
    say("Rascunho salvo somente neste navegador. Estados anteriores preservados.");
  }
  async function checkStoredLineage(next, text) {
    const key = keyFor(next.scope), stored = localStorage.getItem(key);
    let digest = null;
    if (stored !== null) { const existing = await M.importJson(stored, next.scope); await M.importJson(text, next.scope, existing); digest = existing.historyDigest; }
    return { key, stored, digest };
  }
  async function importHistory(text) {
    const expected = validScope(draft.scope) ? copy(draft.scope) : undefined, next = await M.importJson(text, expected, history || undefined), storage = await checkStoredLineage(next, text);
    history = next; draft = copy(next.snapshots.at(-1).content); loadedKey = storage.key; loadedRaw = storage.stored; persistedDigest = storage.digest; viewing = null; selected = null; pendingPoint = null; lineStart = null; undo = []; redo = []; serial++; $("pointPanel").hidden = true;
    say("Histórico importado e conferido localmente. Clique Salvar rascunho para guardar a cópia neste navegador.");
  }
  async function showResume() {
    const list = $("resumeList"); list.replaceChildren(); let found = 0;
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); if (!key?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      try {
        const saved = await M.importJson(raw), row = html("article", undefined, "resume-entry");
        row.append(html("h3", saved.scope.tagLabel), html("p", saved.snapshots.length + " estados locais · contrato declarado " + saved.scope.contractId));
        const open = html("button", "Retomar " + saved.scope.tagLabel), feedback = html("p", "", "small"); open.type = "button"; feedback.setAttribute("role", "status");
        open.onclick = async () => {
          if (!await discardDraft()) return;
          await run(async () => { await importHistory(raw); $("resumeDialog").close(); say("Cópia local retomada. IDs declarados, sem conferência em cadastro."); }, feedback);
        }; row.append(open, feedback); list.append(row); found++;
      } catch { const row = html("p", "Um rascunho local não passou na conferência e foi preservado sem alterações.", "small"); list.append(row); }
    }
    if (!found) list.append(html("p", "Nenhum rascunho local válido disponível neste navegador.", "empty")); $("resumeDialog").showModal();
  }
  function pointLinks() {
    if (!$("pointLinkScope").checked) return null;
    if (!validScope(draft.scope)) throw Error("Defina o escopo declarado antes de vincular o ponto.");
    const item = $("pointItemId").value.trim(); if (item && !UUID.test(item)) throw Error("O item opcional precisa de UUID declarado válido.");
    const previous = pendingPoint?.editingId && draft.inspectionPoints.find(p => p.id === pendingPoint.editingId)?.links;
    return { scope: Object.fromEntries(scopeIds.map(k => [k, draft.scope[k]])), lvtItemId: item || null, photoIds: previous?.photoIds || [], rtiIds: previous?.rtiIds || [] };
  }
  function showPoint(point, placement) {
    if (!writable()) return;
    pendingPoint = point ? { editingId: point.id, anchor: copy(point.anchor) } : { editingId: null, ...placement };
    $("pointPanel").hidden = false; $("pointPanelTitle").textContent = point ? "Editar ponto" : "Novo ponto"; $("pointLabel").value = point?.label || "";
    $("pointLinkScope").checked = Boolean(point?.links); $("pointLinkScope").disabled = !validScope(draft.scope); $("pointItemId").value = point?.links?.lvtItemId || ""; $("pointItemId").disabled = !$("pointLinkScope").checked;
    $("pointLabel").focus({ preventScroll: true }); $("pointPanel").scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  svg.addEventListener("click", event => {
    if (!writable()) return; const p = svgPoint(event), hit = event.target.closest("[data-kind]");
    if (tool === "select") { if (ignoreSelectClick) { ignoreSelectClick = false; return; } selected = hit ? { kind: hit.dataset.kind, id: hit.dataset.id } : null; render(); return; }
    ignoreSelectClick = false;
    if (tool === "line") {
      const point = snap(p); if (!lineStart) { lineStart = point; render(); return; }
      if (point.x === lineStart.x && point.y === lineStart.y) { say("Escolha outro ponto da malha para terminar o trecho.", true); return; }
      const start = lineStart; lineStart = null;
      change(data => { const a = findOrAdd(data, start), b = findOrAdd(data, point); if (data.segments.some(s => [s.fromNodeId, s.toNodeId].includes(a.id) && [s.fromNodeId, s.toNodeId].includes(b.id))) throw Error("Esse trecho já existe; nenhum segmento foi duplicado."); data.segments.push({ id: uid(), fromNodeId: a.id, toNodeId: b.id }); }, "Trecho gráfico adicionado. Sem medida física.");
    } else if (tool === "symbol") {
      const placement = nearestAnchor(p, draft); change(data => { if (placement.newNode) data.nodes.push(placement.newNode); data.symbols.push({ id: uid(), kind: $("symbolKind").value, anchor: placement.anchor }); }, "Figura esquemática interna adicionada; sem certificação.");
    } else if (tool === "point") showPoint(null, nearestAnchor(p, draft));
  });
  svg.addEventListener("pointerdown", event => {
    if (!writable() || tool !== "select" || event.button !== 0) return; const hit = event.target.closest("[data-kind]"); if (!hit) return;
    selected = { kind: hit.dataset.kind, id: hit.dataset.id }; drag = { ...selected, base: copy(draft), start: snap(svgPoint(event)), newNodeId: uid(), moved: false }; svg.setPointerCapture(event.pointerId); event.preventDefault(); selectionUI();
  });
  svg.addEventListener("pointermove", event => {
    if (!drag || !writable()) return; const point = svgPoint(event), target = snap(point), next = copy(drag.base), dx = target.x - drag.start.x, dy = target.y - drag.start.y;
    try {
      if (drag.kind === "node" || drag.kind === "segment") {
        const ids = drag.kind === "node" ? [drag.id] : (() => { const s = next.segments.find(s => s.id === drag.id); return [s.fromNodeId, s.toNodeId]; })();
        const nodes = next.nodes.filter(n => ids.includes(n.id)), shiftX = Math.max(-Math.min(...nodes.map(n => n.x)), Math.min(next.grid.columns - 1 - Math.max(...nodes.map(n => n.x)), dx)), shiftY = Math.max(-Math.min(...nodes.map(n => n.y)), Math.min(next.grid.rows - 1 - Math.max(...nodes.map(n => n.y)), dy));
        for (const n of nodes) { n.x += shiftX; n.y += shiftY; }
      } else {
        const placement = nearestAnchor(point, next, drag.newNodeId); if (placement.newNode) next.nodes.push(placement.newNode);
        next[drag.kind === "symbol" ? "symbols" : "inspectionPoints"].find(row => row.id === drag.id).anchor = placement.anchor;
      }
      basic(next); draft = next; drag.moved = !eq(next, drag.base); draw(svg, draft); selectionUI();
    } catch (error) { say(error.message, true); }
  });
  function endDrag() { if (!drag) return; if (drag.moved) { undo.push(drag.base); if (undo.length > 60) undo.shift(); redo = []; serial++; say("Posição gráfica alterada; ancoragens preservadas."); } drag = null; ignoreSelectClick = true; render(); }
  svg.addEventListener("pointerup", endDrag); svg.addEventListener("pointercancel", () => { if (drag) draft = drag.base; drag = null; render(); });
  async function removeSelected() {
    if (!selected || !writable()) return; const choice = { ...selected }, data = copy(draft), removedSegments = new Set(choice.kind === "segment" ? [choice.id] : choice.kind === "node" ? data.segments.filter(s => s.fromNodeId === choice.id || s.toNodeId === choice.id).map(s => s.id) : []);
    const dependent = anchor => anchor.kind === "node" && choice.kind === "node" && anchor.nodeId === choice.id || anchor.kind === "segment" && removedSegments.has(anchor.segmentId), points = data.inspectionPoints.filter(p => p.id === choice.id && choice.kind === "point" || dependent(p.anchor)), symbols = data.symbols.filter(s => s.id === choice.id && choice.kind === "symbol" || dependent(s.anchor));
    if ((points.length || symbols.length || removedSegments.size) && !await confirmAction("Apagar a seleção?", `${removedSegments.size} trecho(s), ${symbols.length} figura(s) e ${points.length} ponto(s) serão retirados do rascunho. Os estados já salvos serão preservados.`, "Apagar do rascunho")) return;
    if (!writable()) return;
    data.nodes = data.nodes.filter(n => !(choice.kind === "node" && n.id === choice.id)); data.segments = data.segments.filter(s => !removedSegments.has(s.id)); data.symbols = data.symbols.filter(s => !symbols.some(x => x.id === s.id)); data.inspectionPoints = data.inspectionPoints.filter(p => !points.some(x => x.id === p.id));
    selected = null; pendingPoint = null; $("pointPanel").hidden = true; commit(data, "Seleção retirada somente do rascunho em edição.");
  }
  function setZoom(value) {
    const previous = zoom, centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / previous, centerY = (viewport.scrollTop + viewport.clientHeight / 2) / previous;
    zoom = Math.max(.2, Math.min(2.5, value)); render(); viewport.scrollLeft = centerX * zoom - viewport.clientWidth / 2; viewport.scrollTop = centerY * zoom - viewport.clientHeight / 2;
  }
  document.querySelectorAll("button[data-tool]").forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $("zoomIn").onclick = () => setZoom(zoom * 1.25); $("zoomOut").onclick = () => setZoom(zoom / 1.25);
  $("fitButton").onclick = () => { const s = size(); setZoom(Math.min((viewport.clientWidth - 12) / s.width, (viewport.clientHeight - 12) / s.height)); viewport.scrollLeft = 0; viewport.scrollTop = 0; };
  $("symbolKind").onchange = () => setTool("symbol");
  $("undoButton").onclick = () => { if (!writable() || !undo.length) return; redo.push(copy(draft)); draft = undo.pop(); serial++; selected = null; lineStart = null; render(); say("Última edição desfeita. Histórico salvo preservado."); };
  $("redoButton").onclick = () => { if (!writable() || !redo.length) return; undo.push(copy(draft)); draft = redo.pop(); serial++; selected = null; render(); say("Edição refeita."); };
  $("deleteButton").onclick = removeSelected;
  $("scopeForm").onsubmit = event => {
    event.preventDefault(); if (!writable() || history) return; const scope = Object.fromEntries(scopeFields.map(k => [k, event.target.elements[k].value.trim()]));
    if (!validScope(scope)) { say("Preencha a TAG e todos os UUIDs declarados. Eles não serão validados em um cadastro.", true); return; }
    if (draft.inspectionPoints.some(p => p.links) && !eq(scope, draft.scope)) { say("O desenho tem pontos vinculados ao escopo atual. Inicie um Novo desenho para declarar outro escopo sem reinterpretar vínculos.", true); return; }
    change(next => { next.scope = scope; }, "Escopo local definido por declaração. Nenhuma identidade foi autenticada."); $("scopeDetails").open = false;
  };
  $("generateIds").onclick = () => { for (const key of scopeIds) if (!$("scopeForm").elements[key].value.trim()) $("scopeForm").elements[key].value = uid(); say("IDs locais gerados por sua ação. Informe a TAG e confirme Definir escopo local."); };
  $("pointLinkScope").onchange = () => { $("pointItemId").disabled = !$("pointLinkScope").checked; };
  $("pointForm").onsubmit = event => {
    event.preventDefault(); if (!pendingPoint || !writable()) return;
    try {
      const label = $("pointLabel").value.trim(), links = pointLinks(), editing = pendingPoint.editingId;
      if (!label || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) throw Error("Confirme um rótulo explícito de até 160 caracteres.");
      if (draft.inspectionPoints.some(p => p.id !== editing && p.label.trim() === label)) throw Error("Esse rótulo já existe no desenho. Use uma referência gráfica distinta.");
      const placement = copy(pendingPoint); change(next => { if (placement.newNode) next.nodes.push(placement.newNode); if (editing) { const p = next.inspectionPoints.find(p => p.id === editing); p.label = label; p.links = links; } else next.inspectionPoints.push({ id: uid(), label, anchor: placement.anchor, links }); }, "Ponto confirmado com rótulo declarado. Sem inferência de procedimento de inspeção.");
      pendingPoint = null; $("pointPanel").hidden = true;
    } catch (error) { say(error.message, true); }
  };
  $("cancelPoint").onclick = () => { pendingPoint = null; $("pointPanel").hidden = true; say("Inserção de ponto cancelada; nenhum rótulo foi presumido."); };
  $("saveButton").onclick = () => run(save); $("resumeButton").onclick = () => run(showResume);
  $("exportJsonButton").onclick = () => run(async () => { const saved = viewing === null ? await candidate() : await M.verifyHistory(history); download(safeName(saved.scope.tagLabel) + "-rascunho.json", await M.exportJson(saved), "application/json"); say("JSON exportado como rascunho local. A cópia do navegador não foi alterada."); });
  $("exportSvgButton").onclick = () => run(async () => {
    const selectedView = viewing, saved = selectedView === null ? await candidate() : await M.verifyHistory(history), snapshot = saved.snapshots[selectedView === null ? saved.snapshots.length - 1 : selectedView], data = snapshot.content, drawing = document.createElementNS(NS, "svg"), dimensions = size(data);
    draw(drawing, data, true); const original = Array.from(drawing.childNodes), header = node("g"); let y = 25;
    const text = (value, fontSize) => { const letters = Array.from(value), max = Math.floor((dimensions.width - 40) / (fontSize * 1.2)); for (let i = 0; i < letters.length; i += max) { header.append(node("text", { x: 20, y, fill: "#164d80", "font-size": fontSize, "font-family": "system-ui,sans-serif" }, letters.slice(i, i + max).join(""))); y += fontSize * 1.5; } y += 5; };
    text("RASCUNHO LOCAL · SEM ESCALA · PENDENTE DE REVISÃO", 15); text("TAG declarada: " + data.scope.tagLabel, 13); text("Estado interno " + snapshot.internalRevision + " · " + snapshot.contentDigest, 10); text("Não certificado nem as-built aprovado. IDs e vínculos declarados, não verificados. Biblioteca " + data.symbolLibraryVersion, 10);
    const headerHeight = y + 10, group = node("g", { transform: "translate(0 " + headerHeight + ")" }); group.append(...original);
    drawing.append(node("rect", { width: dimensions.width, height: headerHeight, fill: "#edf4ff" }), header, group); drawing.setAttribute("viewBox", `0 0 ${dimensions.width} ${dimensions.height + headerHeight}`); drawing.setAttribute("width", dimensions.width); drawing.setAttribute("height", dimensions.height + headerHeight);
    const metadata = node("metadata", {}, JSON.stringify({ schema: saved.schema, scope: data.scope, internalRevision: snapshot.internalRevision, contentDigest: snapshot.contentDigest, snapshotDigest: snapshot.snapshotDigest, symbolLibraryVersion: data.symbolLibraryVersion, draft: true, gridUnits: "none", canIssue: false, approvedAsBuilt: false, declaredLinksVerified: false, signatures: [] })); drawing.prepend(metadata);
    for (const n of drawing.querySelectorAll("[data-kind],[data-id]")) { n.removeAttribute("data-kind"); n.removeAttribute("data-id"); }
    download(safeName(data.scope.tagLabel) + "-rascunho.svg", new XMLSerializer().serializeToString(drawing), "image/svg+xml"); say("SVG exportado como levantamento gráfico sem escala, pendente de revisão.");
  });
  $("importButton").onclick = () => $("importFile").click();
  $("importFile").onchange = async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > M.LIMITS.bytes) { say("Importe JSON de até 8 MiB.", true); return; } if (!await discardDraft()) return; await run(async () => importHistory(await file.text())); };
  $("newButton").onclick = async () => { if (!await discardDraft()) return; draft = blank(); history = null; viewing = null; selected = null; pendingPoint = null; lineStart = null; loadedKey = null; loadedRaw = null; persistedDigest = null; undo = []; redo = []; serial++; $("pointPanel").hidden = true; render(); say("Novo desenho em branco. Nenhum histórico local anterior foi apagado."); };
  $("exampleButton").onclick = async () => {
    if (!await discardDraft()) return; const next = blank(); next.scope = { ownerId: "10000000-0000-4000-8000-000000000001", contractId: "10000000-0000-4000-8000-000000000002", systemId: "10000000-0000-4000-8000-000000000003", assetId: "10000000-0000-4000-8000-000000000004", lineId: "10000000-0000-4000-8000-000000000005", tagLabel: "EXEMPLO SINTÉTICO · SEM DADOS REAIS" };
    const a = findOrAdd(next, { x: 9, y: 10 }), b = findOrAdd(next, { x: 20, y: 10 }), c = findOrAdd(next, { x: 20, y: 20 }), s1 = { id: uid(), fromNodeId: a.id, toNodeId: b.id }, s2 = { id: uid(), fromNodeId: b.id, toNodeId: c.id }; next.segments.push(s1, s2); next.symbols.push({ id: uid(), kind: "valve", anchor: { kind: "segment", segmentId: s1.id, ratio: .5 } }); next.inspectionPoints.push({ id: uid(), label: "MARCA SINTÉTICA A", anchor: { kind: "node", nodeId: b.id }, links: null });
    draft = next; history = null; viewing = null; selected = null; pendingPoint = null; lineStart = null; loadedKey = null; loadedRaw = null; persistedDigest = null; undo = []; redo = []; serial++; $("pointPanel").hidden = true; render(); say("Exemplo inteiramente sintético, separado dos rascunhos salvos. Nenhum dado real foi usado.");
  };
  $("leaveHistory").onclick = () => { if (busy) return; viewing = null; selected = null; render(); say("Seu rascunho em edição foi recuperado sem alterar o histórico."); };
  $("branchHistory").onclick = async () => { if (viewing === null || busy || atHistoryLimit()) return; const restored = copy(history.snapshots[viewing].content), revision = history.snapshots[viewing].internalRevision; if (!await discardDraft()) return; viewing = null; undo.push(copy(draft)); redo = []; draft = restored; selected = null; serial++; render(); say("Estado local " + revision + " retomado como novo rascunho. Ao salvar, o histórico anterior será preservado."); };
  $("helpButton").onclick = () => $("helpDialog").showModal();
  window.addEventListener("storage", event => { if (event.key === loadedKey && event.newValue !== loadedRaw) say("Outra aba alterou a cópia local. Seu rascunho foi preservado; salvar será bloqueado até retomar a versão correta.", true); });
  window.addEventListener("beforeunload", event => { if (dirty()) { event.preventDefault(); event.returnValue = ""; } });
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") { lineStart = null; pendingPoint = null; $("pointPanel").hidden = true; render(); }
    if (document.querySelector("dialog[open]") || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); if (viewing === null) run(save); return; }
    if (!writable()) return; if (event.key.toLowerCase() === "l") setTool("line"); if (event.key.toLowerCase() === "v") setTool("select"); if (event.key.toLowerCase() === "p") setTool("point"); if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
  });
  window.PiresLineDrawingEditor = Object.freeze({ state: () => copy({ draft, history, viewing, selected, tool, zoom, dirty: dirty(), storageKey: loadedKey, persistedDigest }), screenPoint(point) { const p = svg.createSVGPoint(), q = project(point); p.x = q.x; p.y = q.y; const screen = p.matrixTransform(svg.getScreenCTM()); return { x: screen.x, y: screen.y }; } });
  if (!M || M.SYMBOL_LIBRARY_VERSION !== VERSION) { say("Modelo ou biblioteca local indisponível. O editor não iniciará outra versão silenciosamente.", true); return; }
  render(); requestAnimationFrame(() => { const s = size(); viewport.scrollLeft = Math.max(0, s.width * zoom / 2 - viewport.clientWidth / 2); viewport.scrollTop = Math.max(0, s.height * zoom / 3 - viewport.clientHeight / 2); });
})();
