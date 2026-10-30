(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoFlow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const modules = Object.freeze({
    integridade: { name: "Inspeção de Integridade", description: "Sistemas, TAGs, itens da LVT, fotos e recomendações documentadas.", views: [["sistemas", "Sistemas e TAGs"], ["minhas", "Minhas inspeções"], ["contratos", "Contratos e escopos"], ["ativos", "Linhas e ativos"], ["campanhas", "Campanhas de inspeção"], ["lvt", "LVT e relatório visual"], ["espessura", "Medição de espessura"], ["achados", "Achados e RTIs"], ["relatorios", "Relatórios de integridade"]] },
    rtis: { name: "Gestão de RTI", description: "Uma mesma RTI acompanha o achado de origem, o prazo e as ações.", views: [["contratos", "Contratos e escopos"], ["campanhas", "Campanhas de RTI"], ["fila", "RTIs abertas e histórico"], ["detalhe", "Estrutura da RTI"], ["acoes", "Ações e reinspeção"], ["relatorios", "Relatório de RTI"]] },
    nr13: { name: "Gestão NR-13", description: "Enquadramento automático com dados documentados, prazos e book do ativo.", views: [["contratos", "Contratos e escopos"], ["ativos", "Ativos e enquadramento"], ["book", "Book NR-13"], ["inspecoes", "Inspeções e próximos prazos"], ["documentos", "Documentação NR-13"], ["relacoes", "Relações entre ativos e documentos"]] },
    valvulas: { name: "Gestão de Certificação de Válvulas", description: "Cadastro próprio de válvulas e PSVs, campanhas e certificados.", views: [["contratos", "Contratos e escopos"], ["ativos", "Válvulas e PSVs"], ["campanhas", "Campanhas de certificação"], ["certificados", "Certificados e revisões"], ["historico", "Histórico da válvula"]] },
  });
  const views = new Set(["inicio", "painel", "importar", "planejamento", "sistemas", "minhas", "execucao", "item", "contratos", "escopo", "ativos", "campanhas", "lvt", "espessura", "achados", "relatorios", "fila", "detalhe", "acoes", "book", "inspecoes", "documentos", "relacoes", "certificados", "historico", "registros"]);
  function routeHash(clientId, module = "", view = "inicio", itemId = "_", contractId = "") {
    return "#gestao/" + [clientId || "_", module || "modulos", view, itemId || "_"].map(encodeURIComponent).join("/") + (contractId ? "?contrato=" + encodeURIComponent(contractId) : "");
  }
  function parseHash(hash) {
    try {
      const [path, query = ""] = String(hash || "").replace(/^#/, "").split("?"), parts = path.split("/").map(decodeURIComponent);
      if (parts.length !== 5 || parts[0] !== "gestao") return null;
      const [, clientId, module, view, itemId] = parts, contractId = new URLSearchParams(query).get("contrato") || "";
      if (clientId !== "_" && !UUID.test(clientId) || itemId !== "_" && !UUID.test(itemId) || contractId && !UUID.test(contractId)) return null;
      if (module !== "modulos" && !Object.hasOwn(modules, module) || !views.has(view)) return null;
      if (module === "modulos" ? view !== "inicio" : !["inicio", "painel", "importar", "planejamento", "book", "registros", "escopo", "historico"].includes(view) && !(module === "integridade" && ["item", "execucao"].includes(view)) && !modules[module].views.some(([key]) => key === view)) return null;
      return { clientId, module: module === "modulos" ? "" : module, view, itemId, contractId };
    } catch { return null; }
  }
  function relationsFor(assetId, state) {
    const assets = new Map((state?.asset || []).map((asset) => [asset.id, asset]));
    if (!assets.has(assetId)) return [];
    return (state?.relations || state?.relation || []).filter((relation) => relation && (!relation.clientId || relation.clientId === state.company?.id) && assets.has(relation.fromAssetId) && assets.has(relation.toAssetId) && relation.fromAssetId !== relation.toAssetId && [relation.fromAssetId, relation.toAssetId].includes(assetId))
      .map((relation) => ({ relation, asset: assets.get(relation.fromAssetId === assetId ? relation.toAssetId : relation.fromAssetId) }));
  }
  function formatBRL(cents) {
    if (!Number.isSafeInteger(cents) || cents < 0) return "Valor a confirmar";
    const value = BigInt(cents);
    return "R$ " + (value / 100n).toLocaleString("pt-BR") + "," + String(value % 100n).padStart(2, "0");
  }
  function commercialReference(record) { return record?.recordClass === "commercial_reference"; }
  function safeSourceURL(value) {
    if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return null;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  }
  function create(options) {
    const document = options.document || root.document, container = options.container,
      breadcrumb = options.breadcrumb, back = options.back, legacy = options.legacy;
    let contextKey = "", current = null, previousRoute = "";
    const projects = root.PiresGestaoProjects?.create({...options, onProjectNavigate: navigate});
    const inspections = root.PiresGestaoInspection?.create({...options, onInspectionNavigate: navigate});
    const el = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const context = () => options.getContext();
    const data = () => context().state || {};
    const records = (kind) => data()[kind] || data()[{ finding: "findings", relation: "relations" }[kind]] || [];
    const assets = () => data().asset || [];
    const contracts = (module) => (data().contract || []).filter((contract) => !commercialReference(contract) && contract.modules?.includes(module));
    const commercialReferences = () => (data().contract || []).filter(commercialReference);
    const notice = (parent, text) => parent.append(el("p", text, "notice"));
    const operational = () => context().mode === "connected" && context().capabilities?.operations === true;
    function operation(parent, name, defaults = {}) {
      return options.onOperation?.(parent, name, { module: current.module, contractId: current.contractId || undefined, ...defaults }) === true;
    }
    function original(parent, source) {
      if (!source?.sourceId || !options.onDownloadSource) return;
      const button = el("button", "Baixar documento original"); button.type = "button";
      button.onclick = () => Promise.resolve(options.onDownloadSource(source.sourceId)).catch((error) => options.onError?.(error));
      parent.append(button);
      if (source.locator) {
        const locator = source.locator;
        const text = [locator.page && "Página " + locator.page, locator.sheet && "Aba " + locator.sheet, locator.row && "Linha " + locator.row, locator.section].filter(Boolean).join(" · ");
        if (text) parent.append(el("p", text, "source-caption"));
      }
    }
    function sourceSituation(parent, rti) {
      const summary = root.PiresAssetCards?.describeRti(rti);
      fields(parent, [["Situação literal da fonte", summary?.sourceStatus || rti?.sourceStatus || rti?.status], ["Data da situação na fonte", rti?.sourceDate], ["Motivo da ausência de data", rti?.sourceDateMissingReason], ["Atualidade", summary?.currentnessLabel || "Atualidade desconhecida — sem confirmação da situação atual"], ["Evidência de abertura no original", rti?.openingEvidence]]);
    }
    function link(parent, label, module, view, itemId = "_", contractId = current?.contractId || "") {
      const button = el("button", label);
      button.type = "button";
      button.dataset.flowView = view;
      if (module) button.dataset.module = module;
      if (itemId !== "_") button.dataset.recordId = itemId;
      button.onclick = () => navigate(module, view, itemId, contractId);
      parent.append(button);
      return button;
    }
    function unavailable(parent, label, reason = "Esta etapa apresenta o fluxo. A gravação deste processo ainda não está disponível.") {
      const button = el("button", label);
      button.type = "button";
      button.disabled = true;
      parent.append(button, el("p", reason, "muted"));
    }
    function fields(parent, pairs) {
      const list = el("dl");
      for (const [label, value] of pairs) {
        if (/^ID\b/.test(label)) continue;
        list.append(el("dt", label), el("dd", value === undefined || value === null || value === "" ? "A confirmar" : String(value)));
      }
      parent.append(list);
    }
    function section(parent, title, text) {
      const panel = el("section", undefined, "panel flow-section");
      panel.append(el("h2", title));
      if (text) panel.append(el("p", text));
      parent.append(panel);
      return panel;
    }
    function navigate(module = "", view = "inicio", itemId = "_", contractId = "") {
      const hash = routeHash(context().client?.id, module, view, itemId, contractId);
      if (root.location.hash === hash) render(); else root.location.hash = hash;
    }
    function replacement(module = "", view = "inicio", itemId = "_") {
      root.history.replaceState(null, "", routeHash(context().client?.id, module, view, itemId));
    }
    function hideLegacy() {
      legacy.hidden = true;
      for (const id of ["contracts", "indicators", "systems", "assetListPanel", "detail"]) {
        const node = document.getElementById(id);
        if (node) node.hidden = true;
      }
    }
    function heading(eyebrow, title, description) {
      const header = el("div", undefined, "flow-heading");
      header.append(el("span", eyebrow, "eyebrow"), el("h1", title));
      if (description) header.append(el("p", description));
      container.append(header);
    }
    function showModules() {
      const ctx = context();
      if (!ctx.client && options.onSelectClient) {
        heading("SEU ESPAÇO DE GESTÃO", "Qual cliente vamos acompanhar?", "Escolha a empresa para acessar seus módulos, sistemas e ativos.");
        const search = el("input"); search.type = "search"; search.placeholder = "Buscar cliente"; search.setAttribute("aria-label", "Buscar cliente"); search.className = "client-search";
        const grid = el("div", undefined, "client-grid"), empty = el("p", "Nenhum cliente encontrado.", "empty-state");
        container.append(search, grid, empty);
        const fill = () => {
          grid.replaceChildren();
          const clients = (ctx.clients || []).filter(c => c.name.toLocaleLowerCase("pt-BR").includes(search.value.trim().toLocaleLowerCase("pt-BR")));
          empty.hidden = clients.length > 0;
          for (const client of clients) {
            const card = el("button", undefined, "client-card"); card.type = "button";
            const mark = el("span", client.name.slice(0, 2).toUpperCase(), "client-monogram"); mark.setAttribute("aria-hidden", "true");
            card.append(mark, el("span", "EMPRESA CLIENTE", "eyebrow"), el("strong", client.displayName || client.name), el("span", "Ver módulos e ativos →", "card-link"));
            card.onclick = () => options.onSelectClient(client.id); grid.append(card);
          }
        };
        search.oninput = fill; fill(); return;
      }
      heading("GESTÃO DE ATIVOS / " + (ctx.client?.name || "MÓDULOS"), "Escolha o módulo", "Inspeções e documentos conectados ao histórico de cada ativo.");
      const preparation=el('div');
      if (operational() && ctx.client?.name === "Perenco") {
        if(!records('document').some(r=>r.recordClass==='line_list_review')) operation(preparation, "perenco-line-list", {});
        if(!assets().some(r=>r.tag==='TQ-04761'&&r.datasheet)) operation(preparation, "perenco-tq-book", {});
        const review=records("document").find(r=>r.recordClass==='line_list_review');
        if(review){
          const panel=section(preparation,"Campanha PCH-1 · lista organizada");
          fields(panel,[["Linhas cadastradas",review.importedCount],["Registros para revisão",review.pendingCount],["Campanhas por sistema",Object.keys(review.systems||{}).length],["Contrato","A confirmar"]]);
          original(panel,review.source);
          const drawer=el("details"),summary=el("summary","Conferir pendências da lista"),search=el("input"),list=el("div");search.type='search';search.placeholder='Buscar TAG ou sistema pendente';search.setAttribute('aria-label','Buscar pendências da line list');
          const fill=()=>{list.replaceChildren();const rows=(review.pendingRows||[]).filter(r=>[r.tag,r.system].join(' ').toLocaleLowerCase('pt-BR').includes(search.value.toLocaleLowerCase('pt-BR')));list.append(el('p',rows.length+' registros · exibindo até 30 por busca'));for(const r of rows.slice(0,30)){const item=section(list,r.tag+' · linha '+r.row,r.system);for(const issue of r.issues||[])item.append(el('p',typeof issue==='string'?issue:JSON.stringify(issue)));}};
          search.oninput=fill;fill();drawer.append(summary);for(const note of review.notes||[])drawer.append(el('p',note));drawer.append(search,list);panel.append(drawer);
        }
      }
      const symbols = { integridade: "◈", rtis: "↗", nr13: "13", valvulas: "⊕" };
      const subtitles = { integridade: "SISTEMAS E INSPEÇÕES", rtis: "RECOMENDAÇÕES E ATENDIMENTO", nr13: "EQUIPAMENTOS E BOOK", valvulas: "VÁLVULAS E CERTIFICADOS" };
      const grid = el("div", undefined, "flow-module-grid");
      for (const [id, module] of Object.entries(modules)) {
        const card = el("article", undefined, "flow-module-card"), symbol = el("span", symbols[id], "module-symbol"); symbol.setAttribute("aria-hidden", "true");
        card.append(symbol, el("span", subtitles[id], "eyebrow"), el("h2", module.name), el("p", module.description));
        const button = link(card, "Acessar módulo →", id, "inicio", "_", ""); button.setAttribute("aria-label", "Abrir " + module.name); button.className = "module-access";
        grid.append(card);
      }
      container.append(grid,preparation);
    }
    function showModule(module) {
      if (operational() && context().client && module !== "integridade") {
        const navigation = el("nav");
        for (const [view, label] of modules[module].views) {
          if (!["detalhe", "acoes", "relatorios", "historico"].includes(view)) link(navigation, label, module, view);
        }
        container.append(navigation);
        if (module === "rtis") showRtis("_"); else showAssets(module);
        return;
      }
      if (module === "integridade" && operational() && context().client) {
        container.append(el("h1", modules[module].name));
        const navigation = el("nav");
        for (const [view, label] of [["contratos", "Contratos e escopos"], ["campanhas", "Campanhas de inspeção"], ["relatorios", "Relatório por sistema"], ["espessura", "Medição de espessura"]]) link(navigation, label, module, view);
        container.append(navigation); showOperational(module, "sistemas", "_"); return;
      }
      container.append(el("h1", modules[module].name));
      notice(container, context().client ? "Cliente: " + context().client.name : "Cliente não selecionado. Estrutura de navegação disponível; cadastros e processos operacionais permanecem indisponíveis.");
      const grid = el("div", undefined, "grid flow-view-grid");
      for (const [view, label] of modules[module].views) {
        const card = el("article", undefined, "card");
        card.append(el("h2", label));
        link(card, "Abrir " + label, module, view);
        grid.append(card);
      }
      container.append(grid);
    }
    function showContracts(module, itemId) {
      const selectedReference = commercialReferences().find((reference) => reference.id === itemId);
      container.append(el("h1", itemId === "_" ? "Contratos e escopos · " + modules[module].name : selectedReference ? "Referência comercial do cliente" : "Escopo do contrato"));
      notice(container, selectedReference ? "A referência comercial pertence a este cliente. A definição do escopo operacional, a assinatura e a vigência permanecem separadas da confirmação de fechamento." : "O contrato pertence ao cliente e define o escopo deste módulo. Um mesmo ativo pode ser referenciado por outros escopos sem ser duplicado.");
      const list = contracts(module), selected = list.find((contract) => contract.id === itemId);
      if (itemId !== "_" && !selected && !selectedReference) notice(container, "Contrato não selecionado ou não disponível neste cliente e módulo.");
      if (itemId === "_" || selected) container.append(el("h2", "Contratos operacionais deste módulo"));
      for (const contract of selected ? [selected] : itemId === "_" ? list : []) {
        const panel = section(container, contract.name);
        fields(panel, [["Referência do contrato", contract.source], ["Módulo", modules[module].name], ["Ativos do escopo", (contract.assetIds || []).filter((id) => assets().some((asset) => asset.id === id)).length]]);
        link(panel, "Ver escopo", module, "escopo", contract.id, contract.id);
        link(panel, module === "integridade" ? "Sistemas deste escopo" : "Ativos deste escopo", module, module === "integridade" ? "sistemas" : "ativos", "_", contract.id);
      }
      if (!list.length && !selectedReference) notice(container, "Nenhum contrato ou escopo operacional disponível neste módulo. Nenhum contrato foi inferido da lista de ativos.");
      if (itemId === "_" || selectedReference) {
        const references = selectedReference ? [selectedReference] : commercialReferences();
        if (references.length) container.append(el("h2", "Referências comerciais deste cliente"));
        for (const reference of references) showCommercialReference(container, reference, module, Boolean(selectedReference));
      }
      if (!selectedReference) {
        if (!operation(container, "contracts")) unavailable(container, "Cadastrar contrato e definir escopo");
        if (context().mode === "local" && context().client) link(container, "Controles privados existentes de contrato", module, "registros");
      }
    }
    function showCommercialReference(parent, record, module, expanded) {
      const commercial = record.commercial || {}, reference = record.reference || {}, provenance = record.provenance || {}, confirmation = record.userConfirmation || {},
        panel = section(parent, record.name || reference.number || "Referência comercial"),
        confirmedDate = confirmation.confirmedDate || confirmation.confirmedDateISO,
        confirmed = record.status === "close_confirmed_by_owner" && UUID.test(confirmation.actorUserId || "") && typeof confirmation.statement === "string" && confirmation.statement.trim() && confirmedDate;
      panel.dataset.commercialReference = record.id;
      panel.append(el("p", reference.nature === "critical_analysis" ? "Análise crítica / referência comercial" : "Proposta/referência comercial", "badge"));
      panel.append(el("p", confirmed ? "Fechamento confirmado pelo titular" : "Confirmação de fechamento a conferir", "notice"));
      fields(panel, [["Cliente", context().client?.name], ["Prestadora", commercial.issuerNameRaw || reference.issuer], [confirmed ? "Valor confirmado" : "Valor documentado", commercial.currency === "BRL" ? formatBRL(commercial.amountCents) : "Moeda / valor a confirmar"], ["Referência", reference.number], ["Revisão", reference.revision], ["Data documental", provenance.documentDateRaw || provenance.sourceDate || provenance.sourceDateISO], ["Escopo operacional", "Escopo de ativos a definir"]]);
      for (const stage of Array.isArray(commercial.stages) ? [...commercial.stages].sort((a, b) => a.position - b.position) : [])
        fields(panel, [[stage.label || "Etapa " + stage.position, commercial.currency === "BRL" ? formatBRL(stage.amountCents) : "Moeda / valor a confirmar"]]);
      if (!expanded) { link(panel, "Consultar referência comercial", module, "escopo", record.id, ""); return; }
      const identity = section(panel, "Partes e serviço documentados");
      fields(identity, [["Prestadora documentada", commercial.issuerNameRaw], ["CNPJ da prestadora na fonte", commercial.issuerCnpjRaw || commercial.issuerCnpjDigits], ["Cliente documentado", commercial.customerNameRaw], ["CNPJ do cliente na fonte", commercial.customerCnpjRaw || commercial.customerCnpjDigits], ["Serviço descrito na fonte", commercial.serviceScopeRaw]]);
      const legal = section(panel, "Formalização e escopo operacional");
      fields(legal, [["Número do contrato assinado", record.signedNumber || "A confirmar"], ["Assinatura", record.signedDate || "A confirmar"], ["Vigência", typeof record.validity === "string" && record.validity || "A confirmar"], ["Ativos e módulos contratados", "A definir por escopo operacional documentado"]]);
      notice(legal, "A confirmação comercial do titular fica registrada separadamente da assinatura, da vigência e da definição dos ativos. Esta referência não é usada para planejar campanhas.");
      const evidence = section(panel, "Confirmação e fonte");
      fields(evidence, [["Confirmação do titular", confirmation.statement], ["Data da confirmação", confirmedDate], ["Referência da confirmação", confirmation.evidenceRef], ["Autorização para seguir", confirmation.proceedEvidenceRef], ["Referência documental", record.source], ["Original documental", provenance.originalBytesVerified === true ? "Bytes originais verificados conforme registro" : "Original ainda não verificado nesta instância"]]);
      const href = safeSourceURL(provenance.sourceURI);
      if (href) {
        const anchor = el("a", "Abrir fonte documental privada"); anchor.href = href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.referrerPolicy = "no-referrer"; evidence.append(anchor);
      } else notice(evidence, "Link documental seguro não disponível. A referência será preservada para conferência.");
    }
    function showAssets(module) {
      if (module === "integridade" && inspections?.renderAssetList(container, current)) return;
      container.append(el("h1", modules[module].views.find(([view]) => view === "ativos")?.[1] || "Ativos do módulo"));
      const contract = contracts(module).find((item) => item.id === current.contractId);
      const system = records("system").find((r) => r.id === current.itemId);
      if (module === "nr13") container.append(el("p", "Dados do equipamento no card. Documentos, histórico e pendências ao abrir o book.", "source-caption"));
      else fields(container, [["Cliente", context().client?.name || "Não selecionado"], ["Sistema", system?.name || "Nenhum sistema selecionado"], ["Contrato / escopo", contract?.name || "Nenhum escopo selecionado"]]);
      if (!context().client || !context().state) {
        notice(container, "Nenhum ativo selecionado. O cadastro operacional de clientes e ativos não está disponível neste modo de avaliação das telas.");
        link(container, module === "nr13" ? "Conhecer estrutura do book NR-13" : "Conhecer estrutura do ativo", module, "book");
        return;
      }
      legacy.hidden = false;
      document.getElementById("assetListPanel").querySelector(".nr13-management")?.remove();
      document.getElementById("assetListPanel").hidden = false;
      document.getElementById("systems").hidden = Boolean(system) || module === "nr13";
      options.onAssets?.(module, current.contractId, system?.id);
      if (module === "nr13" && operational()) {
        const pending = assets().filter(a => ["tanque","vaso","caldeira","outro"].includes(a.type) && root.PiresAssetCards?.describe(a, data()).nr13.scope !== "covered");
        if (pending.length) {
          const drawer = el("details", undefined, "operation-drawer"); drawer.append(el("summary", "Conferir enquadramento · " + pending.length + " ativos"));
          for (const asset of pending) { const row = section(drawer, asset.tag); row.append(el("p", root.PiresAssetCards?.describe(asset, data()).nr13.scopeLabel)); link(row, "Conferir documentação e enquadramento", "nr13", "book", asset.id); }
          container.append(drawer);
        }
      }
      if (operational()) {
        const management = module === "nr13" ? el("div", undefined, "nr13-management") : container;
        if (module === "nr13") document.getElementById("assetListPanel").append(management);
        operation(management, "documents", { documentType: "outro" });
        operation(management, "asset-register", { systemId: system?.id });
      }
    }
    function showBook(module, itemId) {
      const asset = assets().find((item) => item.id === itemId), state = data(),
        description = asset && root.PiresAssetCards?.describe(asset, state);
      const bookSection = (title, text) => {
        const box = el("details", undefined, "panel book-drawer");
        box.append(el("summary", title));
        if (text) box.append(el("p", text));
        container.append(box); return box;
      };
      container.append(el("h1", (module === "nr13" ? "Book NR-13" : "Histórico do ativo") + " · " + (asset?.tag || "ativo não selecionado")));
      if (!asset) notice(container, "Ativo não selecionado. Os campos abaixo representam a organização do book; não são registros preenchidos.");
      const identity = section(container, "Identificação e situação");
      fields(identity, [["Cliente", context().client?.name || "Não selecionado"], ["ID do ativo", asset?.id], ["TAG", asset?.tag], ["Unidade", state.unit?.find((unit) => unit.id === asset?.unitId)?.name], ["Sistema", state.system?.find((system) => system.id === asset?.systemId)?.name], ["Operação", description?.operation.label || "Não informado"], ["Motivo da situação", description?.operation.reason], ["Condição técnica", "Não avaliada automaticamente"]]);
      const nr = section(container, "Enquadramento NR-13");
      const scopeBadge = el("p", description?.nr13.scopeLabel || "Enquadramento pendente", "nr13-status");
      scopeBadge.dataset.scope = description?.nr13.scope || "pending"; nr.append(scopeBadge);
      fields(nr, [["Fluido", description?.nr13.fluid || "Não informado"], ["Classe do fluido", description?.nr13.fluidClass || "A confirmar"], ["Pressão de operação", description?.nr13.operatingPressure || "A confirmar"], ["Classe de pressão", description?.nr13.pressureClass || "Não informada"], ["Categoria NR-13", description?.nr13.categoryLabel || "Pendente de confirmação"], ["Próxima inspeção", description?.nr13.nextInspectionDate || "Prazo a definir"]]);
      if (asset && module === "nr13") {
        const pending = section(container, "Pendências para atendimento à NR-13"); pending.classList.add("book-pending");
        pending.append(el("p", "Conformidade a verificar · o enquadramento e a conclusão do book têm situações independentes.", "source-caption"));
        const overview = el("div", undefined, "book-overview");
        for (const [title, value] of [["Documentos vinculados", String(description.book.documentCount)], ["Histórico de inspeções", description.book.inspectionCount ? "Consultar registros" : "Pendente"], ["Próxima inspeção", description.nr13.nextInspectionDate || "A definir"], ["RTIs", description.rti.label]]) {
          const item = el("div"); item.append(el("span", title), el("strong", value)); overview.append(item);
        }
        pending.append(overview);
        if (description.book.pending.length) {
          const list = el("ul", undefined, "book-pending-list");
          for (const text of description.book.pending) { const item = el("li"); item.append(el("span", "Pendente", "pending-tag"), el("span", text)); list.append(item); }
          pending.append(list);
        } else notice(pending, "Nenhuma pendência específica cadastrada. A ausência de pendências cadastradas não confirma conformidade do ativo.");
        if (!description.book.inspectionCount) pending.append(el("p", "Falta registrar o histórico para definir as inspeções necessárias e seus prazos com base técnica. Ausência de registro não significa inspeção vencida.", "source-caption"));
      } else if (asset?.bookPending?.length) {
        const pending = section(container, "Pendências do book"), list = el("ul"); for (const item of asset.bookPending) list.append(el("li", item)); pending.append(list);
      }
      if (description?.nr13.reference || description?.nr13.basis) {
        const source = bookSection("Base do enquadramento registrado");
        fields(source, [["Documento", description.nr13.reference], ["Fundamentação registrada", description.nr13.basis], ["Localização na fonte", description.nr13.source?.locator?.section]]);
        original(source, description.nr13.source);
      }
      if (asset?.datasheet) { const sheet = bookSection("Ficha técnica documentada"); sheet.classList.add('book-specs'); fields(sheet, Object.entries(asset.datasheet)); }
      const auto = records("classification").filter(r=>r.assetId===asset?.id && r.classificationMethod==="automatic_nr13").at(-1);
      if (auto) {
        const panel = bookSection("Conferência automática dos critérios NR-13", auto.basis);
        fields(panel, [["Resultado do cálculo", ({ covered: "Enquadrado pelos critérios calculados", not_covered: "Fora do escopo pelos critérios calculados", excluded: "Exclusão identificada no cálculo", pending: "Conferência automática pendente" })[auto.result.scope] || "Pendente"], ["Categoria calculada", auto.result.category || (asset.type==='tanque' ? 'Não aplicável a tanques' : 'Pendente')]]);
        for (const check of auto.result.checks || []) panel.append(el("p",check));
        if(auto.result.missing?.length){const list=el("ul");for(const item of auto.result.missing)list.append(el("li",item));panel.append(el("h3","Dados necessários para concluir"),list);}
        panel.append(el("p","Calculado a partir dos dados documentados. Não constitui aprovação técnica nem confirma a condição atual do equipamento."));
      }
      for (const deadline of records("deadline").filter(d => d.assetId === asset?.id)) fields(nr, [["Inspeção " + deadline.type, deadline.due], ["Referência", deadline.reference]]);
      const origin = bookSection("Origem do cadastro");
      if (asset?.source) fields(origin, [["Arquivo de origem", asset.source.fileName || asset.source.file], ["Referência no documento", asset.source.locator?.section || (asset.source.locator?.page ? "Página " + asset.source.locator.page : null) || asset.source.section || (asset.source.sheet ? "Aba " + asset.source.sheet + " · linha " + asset.source.row : undefined)]]);
      else notice(origin, "Fonte não disponível para um ativo não selecionado.");
      if (asset?.source?.sourceId && options.onDownload) {
        const download = el("button", "Baixar documento original de origem");
        download.type = "button";
        download.onclick = () => Promise.resolve(options.onDownload(asset)).catch((error) => options.onError?.(error));
        origin.append(download);
      }
      const documents = bookSection("Documentação e revisões");
      const docs = (state.document || []).filter((doc) => asset && doc.assetId === asset.id && doc.recordClass !== 'classification');
      for (const doc of docs) {
        const line = section(documents, doc.reference || doc.type || doc.documentType, doc.basis);
        fields(line, [["ID documental", doc.id], ["Tipo", doc.documentType || doc.type]]);
        original(line, doc.source);
        for (const revision of (state.revision || []).filter((item) => item.documentId === doc.id && item.assetId === asset.id))
          fields(line, [["Revisão", revision.revision], ["Etapa documental", revision.status], ["Responsável informado", revision.responsible]]);
      }
      if (!docs.length) notice(documents, "Nenhum documento vinculado disponível. Presença de documento ou etapa documental não representa aprovação técnica do ativo.");
      if (asset && operational()) {
        const edges = records("relation"), inspections = records("inspection").filter((r) => r.assetId === asset.id),
          lvts = records("lvt").filter((r) => r.assetId === asset.id && inspections.some((i) => i.id === r.inspectionId)),
          explicitDocumentIds = new Set([
            ...edges.filter((r) => r.fromKind === "document" && r.toKind === "asset" && r.toId === asset.id && r.relationType === "documents_asset").map((r) => r.fromId),
            ...lvts.map((r) => r.documentId),
            ...records("rti").filter((r) => r.assetId === asset.id).map((r) => r.documentId),
          ]);
        for (const doc of records("document").filter((r) => explicitDocumentIds.has(r.id) && r.recordClass !== 'classification' && !docs.some((d) => d.id === r.id))) {
          const line = section(documents, doc.reference || doc.documentType);
          fields(line, [["ID documental", doc.id], ["Vínculo", "Relação explícita registrada"], ["Tipo", doc.documentType]]); original(line, doc.source);
        }
        const persisted = bookSection("Registros vinculados ao book"), button = el("button", "Consultar registros vinculados"); button.type = "button";
        button.onclick = async () => {
          const key = contextKey; button.disabled = true;
          try {
            const result = await options.onBook(asset.id);
            if (key !== contextKey || current?.itemId !== asset.id || !persisted.isConnected) return;
            button.remove();
            for (const record of result.records || []) {
              const panel = section(persisted, record.reference || record.title || record.name || record.description || record.id);
              fields(panel, [["ID do registro", record.id], ["Registro", ({ contract: "Contrato", campaign: "Campanha", inspection: "Inspeção", lvt: "LVT", finding: "Achado", rti: "RTI", document: "Documento original" })[record.kind] || "Registro vinculado"], ["Situação registrada", record.status]]);
              if (record.kind === "rti") { sourceSituation(panel, record); link(panel, "Consultar a mesma RTI", "rtis", "detalhe", record.id, ""); }
              original(panel, record.source);
            }
            if (!result.records?.length) notice(persisted, "Nenhum registro vinculado ao book disponível.");
            for (const record of result.relatedRecords || []) {
              const panel = section(persisted, record.reference || record.title || "Registro do ativo relacionado");
              fields(panel, [["Ativo relacionado", assets().find(a => a.id === record.assetId)?.tag], ["Vínculo", "Relação explícita comprovada"], ["Tipo", record.recordClass || record.kind]]); original(panel, record.source);
            }
          }
          catch (error) { options.onError?.(error); } finally { button.disabled = false; }
        };
        if (options.onBook) persisted.append(button);
      }
      const related = bookSection("Relações documentadas · válvulas, linhas, medições e RTIs");
      const relations = asset ? relationsFor(asset.id, state) : [];
      for (const { relation, asset: target } of relations) {
        const panel = section(related, target.tag, relation.kind || "Relação explícita registrada");
        // Routing an already explicit relation preserves the valve's own module;
        // this never creates a relation from a TAG or an asset type.
        const targetModule = target.type === "valvula" || ["certificado_valvula", "valvula_psv", "valvula"].includes(relation.kind) ? "valvulas" : relation.kind === "linha_integridade" || relation.kind === "medicao_espessura" ? "integridade" : module;
        link(panel, "Abrir ativo relacionado", targetModule, "book", target.id, "");
      }
      if (!relations.length) notice(related, "Nenhuma relação explícita disponível. TAG semelhante ou tipo do ativo não cria vínculo com outro ativo ou certificado.");
      const rtis = (state.rti || []).filter((rti) => asset && rti.assetId === asset.id);
      for (const rti of rtis) {
        const panel = section(related, "RTI · " + rti.title); sourceSituation(panel, rti);
        link(panel, "Consultar RTI · " + rti.id, "rtis", "detalhe", rti.id, "");
      }
      const inspections = bookSection("Histórico de integridade e medição de espessura", "Inspeções, LVT, relatório visual e medições devem manter identificação de origem e campanha. As ferramentas existentes não são convertidas automaticamente em registros deste book.");
      const inspectionRecords = (state.inspection || []).filter((record) => asset && record.assetId === asset.id);
      for (const record of inspectionRecords) fields(inspections, [["ID do registro", record.id], ["Tipo informado", record.type], ["Planejamento documentado", record.planned], ["Execução informada", record.done], ["Fonte de execução", record.executionSource]]);
      if (!inspectionRecords.length) notice(inspections, "Nenhum registro de inspeção ou medição vinculado disponível para este ativo.");
      if (asset && options.onHistory) {
        const history = bookSection("Histórico registrado do cadastro"), button = el("button", "Consultar histórico registrado");
        button.type = "button";
        button.onclick = async () => {
          const key = contextKey;
          button.disabled = true;
          try {
            const events = await options.onHistory(asset.id);
            if (key !== contextKey || current?.itemId !== asset.id || current.view !== "book" || !history.isConnected) return;
            for (const event of events) fields(history, [["Evento", event.event], ["Instante registrado", event.at], ["Operador registrado", event.actor]]);
            if (!events.length) notice(history, "Nenhum evento disponível.");
          } catch (error) { options.onError?.(error); }
          finally { button.disabled = false; }
        };
        history.append(button);
      }
      if (asset && operational()) {
        operation(container, "documents", { assetId: asset.id });
        operation(container, "relationships", { assetId: asset.id });
        operation(container, "asset-operation", { assetId: asset.id });
        operation(container, "asset-links", { assetId: asset.id });
        if (module === "nr13") { operation(container, "nr13-assess", { assetId: asset.id }); operation(container, "classifications", { assetId: asset.id }); operation(container, "deadlines", { assetId: asset.id }); }
        if (asset.type === "valvula") operation(container, "certificates", { assetId: asset.id });
      } else unavailable(container, "Vincular documento, ativo ou evidência", "Vínculos operacionais não estão disponíveis neste modo. Esta tela não emite aprovação técnica.");
      if (asset && context().mode === "local") link(container, "Consultar registros privados existentes", module, "registros", asset.id);
    }
    function showRtis(itemId) {
      const state = data(), validAssets = new Map(assets().map((asset) => [asset.id, asset])),
        project = contracts("rtis").find(c => c.id === current.contractId),
        list = (state.rti || []).filter((rti) => (!rti.assetId || validAssets.has(rti.assetId)) && (!project || (project.rtiIds || []).includes(rti.id) || rti.contractId === project.id && (project.assetIds || []).includes(rti.assetId)));
      if (["fila", "inicio", "acoes"].includes(current.view) && itemId === "_") {
        container.append(el("h1", "RTIs abertas e histórico"));
        notice(container, "A RTI documentada acompanha a origem com o mesmo ID, sem cópia. Várias RTIs da mesma TAG permanecem separadas. A situação histórica da fonte não confirma que a RTI continua aberta hoje; vínculos não confirmados permanecem pendentes.");
        const search = el("input"); search.type = "search"; search.placeholder = "Buscar por TAG ou recomendação"; search.setAttribute("aria-label", "Buscar RTI");
        const filter = el("select"); filter.setAttribute("aria-label", "Filtrar situação da RTI");
        for (const [value, label] of [["", "Todas as situações"], ["aberta", "Abertas com confirmação atual"], ["historica", "Situação histórica a confirmar"], ["encerrada", "Encerradas"]]) { const opt = el("option", label); opt.value = value; filter.append(opt); }
        const toolbar = el("div", undefined, "flow-filter"); toolbar.append(search, filter); container.append(toolbar);
        const cards = [];
        for (const rti of list) {
          const card = section(container, rti.title);
          card.dataset.rtiId = rti.id;
          fields(card, [["ID da RTI", rti.id], ["TAG confirmada", validAssets.get(rti.assetId)?.tag || "Vínculo com ativo pendente"], ["Prazo documentado", rti.due || "Pendente de definição"]]);
          sourceSituation(card, rti);
          link(card, "Abrir RTI", "rtis", "detalhe", rti.id, "");
          cards.push({ card, rti });
        }
        const apply = () => { for (const {card, rti} of cards) { const summary = root.PiresAssetCards?.describeRti(rti), text = [rti.title, rti.recommendation, validAssets.get(rti.assetId)?.tag].join(" ").toLocaleLowerCase("pt-BR"); card.hidden = !text.includes(search.value.trim().toLocaleLowerCase("pt-BR")) || filter.value === "aberta" && !summary?.open || filter.value === "historica" && summary?.currentness === "confirmed_current" || filter.value === "encerrada" && !(summary?.currentness === "confirmed_current" && rti.status === "encerrada"); } };
        search.oninput = apply; filter.onchange = apply;
        if (!list.length) notice(container, "Nenhuma RTI disponível neste cliente. Recomendações reais documentadas geram RTI pelo fluxo de achados; RTIs históricas podem ser vinculadas a seu original. Nenhum registro de teste é criado.");
        if (operational()) { operation(container, "documents", { documentType: "rti" }); operation(container, "rtis"); }
        link(container, "Conhecer estrutura da RTI", "rtis", "detalhe", "_", "");
        return;
      }
      const rti = list.find((item) => item.id === itemId), origin = rti?.origin || {},
        originAsset = validAssets.get(origin.assetId || rti?.assetId),
        originClientValid = !origin.clientId || origin.clientId === context().client?.id,
        originFinding = records("finding").find((item) => item.id === (origin.findingId || rti?.findingId) && item.assetId === originAsset?.id),
        inspection = originClientValid && (state.inspection || []).find((item) => item.id === (origin.inspectionId || originFinding?.inspectionId) && item.assetId === originAsset?.id),
        contract = originClientValid && (state.contract || []).find((item) => item.id === (origin.contractId || rti?.contractId || originFinding?.contractId) && (!originAsset || item.assetIds?.includes(originAsset.id))),
        finding = originClientValid && records("finding").find((item) => item.id === (origin.findingId || rti?.findingId) && item.assetId === originAsset?.id),
        document = records("document").find((item) => item.id === rti?.documentId),
        lvtItem = records("lvtItem").find((item) => item.id === (rti?.lvtItemId || finding?.lvtItemId) && item.assetId === originAsset?.id);
      container.append(el("h1", "RTI · " + (rti?.title || "não selecionada")));
      if (!rti) notice(container, "RTI não selecionada. Estrutura de consulta, sem achado ou prazo preenchido.");
      const source = section(container, "Origem da RTI");
      fields(source, [["ID interno da RTI", rti?.id], ["Número histórico emitido", rti?.issuedNumber || "Não informado — ID interno não substitui número emitido"], ["Origem", rti?.originType === "documented_recommendation" ? "Recomendação real documentada" : rti?.originType === "historical_rti_document" ? "RTI histórica documentada" : "Não informada"], ["Cliente de origem", originClientValid ? context().client?.name : undefined], ["Contrato / escopo", contract?.name || "Vínculo pendente"], ["Linha / TAG confirmada", originClientValid ? originAsset?.tag || "Vínculo pendente" : undefined], ["Inspeção de origem", inspection?.id], ["Achado", finding?.description || rti?.finding], ["Recomendação", rti?.recommendation || finding?.recommendation], ["Documento de origem", document?.reference], ["Localização no original", rti?.source?.locator ? JSON.stringify(rti.source.locator) : typeof rti?.source === "string" ? rti.source : undefined]]);
      sourceSituation(source, rti);
      original(source, rti?.source || document?.source);
      const details = section(container, "Causa, prazo e atendimento");
      const cause = typeof rti?.cause === "object" ? rti.cause : null,
        reinspection = typeof rti?.reinspection === "string" ? rti.reinspection : rti?.reinspection && [rti.reinspection.description, rti.reinspection.plannedDate].filter(Boolean).join(" · ");
      fields(details, [["Situação atual", root.PiresAssetCards?.describeRti(rti).statusLabel || "Atualidade desconhecida"], ["Causa", cause?.description], ["Confirmação da causa", cause?.status === "confirmed" ? "Causa registrada como confirmada" : "Em investigação / não confirmada"], ["Fonte da causa", cause?.evidence || cause?.source], ["Prazo", rti?.due || "Pendente de definição — sem data calculada"], ["Ações necessárias", rti?.actions?.map((action) => typeof action === "string" ? action : action.description).filter(Boolean).join("; ") || "Pendente de definição"], ["Reinspeção", reinspection || "Pendente de definição"], ["Evidência de encerramento", rti?.closureEvidence]]);
      section(container, "Relatório padrão de RTI", "Estrutura prevista: identificação e origem, achado, evidências, causa confirmada ou em investigação, prazo documentado, ações, reinspeção e histórico. A emissão será validada no módulo; nenhum relatório é gerado por esta tela.");
      const history = section(container, "Histórico e rastreio da origem");
      fields(history, [["ID canônico da RTI", rti?.id], ["Data de registro", rti?.createdAt], ["Data de encerramento", rti?.closedAt]]);
      for (const event of Array.isArray(rti?.history) ? rti.history.filter((item) => !item.rtiId || item.rtiId === rti.id) : [])
        fields(history, [["Evento de origem", event.description || event.event], ["Data", event.at], ["Responsável informado", event.actor]]);
      notice(history, rti?.status === "encerrada" ? "RTI encerrada preservada no histórico. Encerramento não representa aprovação técnica geral do ativo." : "O mesmo ID acompanhará o achado, a gestão da RTI e o histórico do ativo.");
      if (finding) link(history, "Voltar ao achado de origem", "integridade", "achados", finding.id, contract?.id || "");
      else unavailable(history, "Voltar ao achado de origem", "Disponível quando cliente, ativo e achado de origem estiverem vinculados por IDs válidos.");
      if (lvtItem) link(history, "Voltar ao item e fotos de origem", "integridade", "item", lvtItem.id, contract?.id || "");
      if (rti && operational()) { operation(container, "documents", { documentType: "outro", assetId: rti.assetId }); operation(container, "rti-updates", { id: rti.id }); }
      else notice(history, "Item e fotos de origem ainda não vinculados. Nenhum vínculo foi fabricado.");
      unavailable(container, "Registrar ação, prazo ou encerramento", "O recorte conectado registra somente a RTI real documentada e seus vínculos. Alteração de situação atual, ações, prazo e encerramento ainda não estão disponíveis.");
    }
    function showOperational(module, view, itemId) {
      if (!operational()) return false;
      if (module === "integridade" && ["sistemas", "relatorios"].includes(view)) {
        container.append(el(current.view === "inicio" ? "h2" : "h1", view === "sistemas" ? "Sistemas · quantitativos e TAGs" : "Relatório por sistema"));
        container.append(el("p", "Abra um sistema para acompanhar suas TAGs e inspeções.", "muted"));
        const scopeSelect = el("select"); scopeSelect.setAttribute("aria-label", "Contrato ou escopo da inspeção");
        const all = el("option", "Todos os escopos / acervo disponível"); all.value = ""; scopeSelect.append(all);
        for (const record of contracts(module)) { const opt = el("option", record.name); opt.value = record.id; scopeSelect.append(opt); }
        scopeSelect.value = current.contractId || ""; scopeSelect.onchange = () => navigate(module, view, "_", scopeSelect.value); container.append(scopeSelect);
        const selectedScope = contracts(module).find(c => c.id === current.contractId);
        const grid = el("div", undefined, "grid"); container.append(grid);
        for (const system of records("system")) {
          const list = assets().filter((a) => a.systemId === system.id && (!selectedScope || selectedScope.assetIds?.includes(a.id)));
          if (selectedScope && !list.length) continue;
          const ids = new Set(list.map((a) => a.id)),
            rtis = records("rti").filter((r) => ids.has(r.assetId)), items = records("lvtItem").filter((r) => ids.has(r.assetId)),
            photos = records("photo").filter((r) => items.some((i) => i.id === r.lvtItemId)), panel = section(grid, system.name);
          panel.dataset.systemId = system.id;
          const inspections = records("inspection").filter(r => ids.has(r.assetId) && (!current.contractId || r.contractId === current.contractId));
          panel.classList.add("system-card");
          panel.append(el("p", records("unit").find((u) => u.id === system.unitId)?.name || "Unidade a confirmar", "muted"));
          const metrics = el("div", undefined, "system-metrics");
          for (const [value, label] of [[list.length, "TAGs"], [photos.length, "Fotos"], [rtis.length, "RTIs documentadas"]]) {
            const metric = el("div"); metric.append(el("strong", value), el("span", label)); metrics.append(metric);
          }
          panel.append(metrics, el("p", inspections.filter(r => r.status === "planejada").length + " pendentes · " + inspections.filter(r => r.status === "em_andamento").length + " em andamento · " + inspections.filter(r => r.status === "concluida").length + " concluídas", "inspection-progress"));
          const withoutInspection = list.filter(a => !inspections.some(i => i.assetId === a.id)).length;
          if (withoutInspection) panel.append(el("p", withoutInspection + " TAGs sem inspeção registrada neste escopo", "muted"));
          link(panel, "Abrir TAGs deste sistema", module, "ativos", system.id, current.contractId);
          if (options.onReport) {
            const button = el("button", selectedScope ? "Gerar rascunho deste sistema no projeto" : "Gerar rascunho do acervo geral deste sistema"); button.type = "button";
            button.onclick = async () => { button.disabled = true; try { await options.onReport(system.id, undefined, current.contractId); } catch (error) { options.onError?.(error); } finally { button.disabled = false; } };
            panel.append(button);
          }
          const campaigns = records("campaign").filter((c) => c.systemId === system.id && c.module === module && (!current.contractId || c.contractId === current.contractId));
          for (const campaign of campaigns) {
            const group = section(panel, campaign.name, "Campanha · " + campaign.status);
            if (options.onReport) {
              const button = el("button", selectedScope ? "Gerar rascunho desta campanha no projeto" : "Gerar rascunho desta campanha"); button.type = "button";
              button.onclick = async () => { button.disabled = true; try { await options.onReport(system.id, campaign.id, current.contractId); } catch (error) { options.onError?.(error); } finally { button.disabled = false; } };
              group.append(button);
            }
          }
          if (!campaigns.length) notice(panel, "Sem campanha registrada para este sistema. O relatório depende do escopo e de evidências persistidas.");
        }
        if (!records("system").length) notice(container, "Nenhum sistema importado ou cadastrado neste cliente.");
        const setup = section(container, "Cadastro e documentos", "Cadastre a estrutura com base nos documentos do cliente.");
        operation(setup, "hierarchy"); operation(setup, "documents"); operation(setup, "asset-register");
        return true;
      }
      if (["integridade", "rtis", "valvulas"].includes(module) && view === "campanhas") {
        container.append(el("h1", module === "valvulas" ? "Campanhas de certificação" : module === "rtis" ? "Campanhas de RTI" : "Campanhas de inspeção"));
        notice(container, "Rascunhos operacionais persistem pela API. A lista e o contrato referenciam os mesmos IDs dos ativos; uma campanha não comprova execução.");
        const list = records("campaign").filter((r) => r.module === module && (!current.contractId || r.contractId === current.contractId));
        for (const campaign of list) {
          const panel = section(container, campaign.name); panel.dataset.campaignId = campaign.id;
          fields(panel, [["ID da campanha", campaign.id], ["Contrato", contracts(module).find((c) => c.id === campaign.contractId)?.name], ["Situação", campaign.status], ["Início planejado", campaign.plannedStart], ["Fim planejado", campaign.plannedEnd], ["Fonte do planejamento", campaign.source], ["Ativos do escopo", (campaign.assetIds || []).map((id) => assets().find((a) => a.id === id)?.tag).filter(Boolean).join("; ")]]);
          const inspections = records("inspection").filter(r => r.campaignId === campaign.id);
          fields(panel, [["Pendentes", inspections.filter(r => r.status === "planejada").length], ["Em andamento", inspections.filter(r => r.status === "em_andamento").length], ["Concluídas", inspections.filter(r => r.status === "concluida").length]]);
          link(panel, module === "valvulas" ? "Consultar certificados" : module === "rtis" ? "Consultar RTIs" : "Planejar inspeção e consultar LVT", module, module === "valvulas" ? "certificados" : module === "rtis" ? "fila" : "lvt", "_", campaign.contractId);
        }
        if (!list.length) notice(container, "Nenhuma campanha registrada neste escopo.");
        operation(container, "campaigns"); return true;
      }
      if (module === "integridade" && view === "lvt") {
        container.append(el("h1", "Inspeção planejada, LVT e fonte original"));
        notice(container, "Planejamento, original documental e LVT são registros separados. PDF é preservado como original; esta tela não extrai achados, resultados ou RTIs automaticamente.");
        const asset = assets().find((a) => a.id === itemId);
        if (asset) { fields(container, [["TAG", asset.tag], ["Sistema", records("system").find((s) => s.id === asset.systemId)?.name]]); link(container, "Consultar book do ativo", module, "book", asset.id); }
        const inspections = records("inspection").filter((r) => r.module === module && assets().some((a) => a.id === r.assetId) && (!asset || r.assetId === asset.id) && (!current.contractId || r.contractId === current.contractId));
        for (const inspection of inspections) {
          const panel = section(container, assets().find((a) => a.id === inspection.assetId)?.tag || "Inspeção planejada");
          fields(panel, [["ID da inspeção", inspection.id], ["Campanha", records("campaign").find((c) => c.id === inspection.campaignId)?.name], ["Tipo", inspection.type], ["Situação registrada", inspection.status], ["Data planejada", inspection.plannedDate || inspection.planned], ["Fonte", inspection.source]]);
          for (const lvt of records("lvt").filter((l) => l.inspectionId === inspection.id && l.assetId === inspection.assetId)) {
            const document = records("document").find((d) => d.id === lvt.documentId), detail = section(panel, lvt.recordClass === "field_lvt" ? "LVT · " + lvt.observedOn : "LVT do acervo documental");
            fields(detail, [["ID da LVT", lvt.id], ["Documento original", document?.reference]]); original(detail, document?.source);
            const grid = el("div", undefined, "grid"); detail.append(grid);
            for (const item of records("lvtItem").filter((i) => i.lvtId === lvt.id && i.assetId === inspection.assetId)) {
              const card = section(grid, item.itemKey || "Item documentado", item.component); card.dataset.lvtItemId = item.id;
              const photos = records("photo").filter((p) => p.lvtItemId === item.id), findings = records("finding").filter((f) => f.lvtItemId === item.id);
              fields(card, [["Descrição", item.description], ["Fotos originais", photos.length], ["Achados", findings.length], ["RTIs documentadas", records("rti").filter((r) => r.lvtItemId === item.id).length]]);
              link(card, "Abrir item, fotos e recomendação", module, "item", item.id, inspection.contractId);
            }
            operation(detail, lvt.recordClass === "field_lvt" ? "field-items" : "lvt-items", { assetId: inspection.assetId, lvtId: lvt.id });
            link(detail, "Consultar achados e RTIs desta origem", module, "achados", "_", inspection.contractId);
          }
          operation(panel, "field-lvts", { assetId: inspection.assetId, inspectionId: inspection.id });
          operation(panel, "inspection-updates", { id: inspection.id });
        }
        if (!inspections.length) notice(container, "Nenhuma inspeção planejada ou LVT registrada neste escopo.");
        operation(container, "inspections", { assetId: asset?.id }); operation(container, "documents", { documentType: "lvt", assetId: asset?.id }); operation(container, "lvts", { assetId: asset?.id }); return true;
      }
      if (module === "integridade" && view === "item") {
        const item = records("lvtItem").find((r) => r.id === itemId), asset = assets().find((a) => a.id === item?.assetId), lvt = records("lvt").find((r) => r.id === item?.lvtId && r.assetId === asset?.id);
        container.append(el("h1", (item?.itemKey || "Item da LVT") + " · " + (asset?.tag || "TAG não selecionada")));
        fields(container, [["Sistema", records("system").find((s) => s.id === asset?.systemId)?.name], ["Componente", item?.component], ["Condição encontrada", item?.description], ["Observações", item?.observations], ["ID do item", item?.id]]);
        original(container, item?.source);
        const photos = section(container, "Fotos originais deste item"), list = records("photo").filter((p) => p.lvtItemId === item?.id && p.assetId === asset?.id);
        for (const photo of list) {
          const panel = section(photos, photo.caption || "Fotografia documentada"); panel.dataset.photoId = photo.id;
          if (options.onPhoto) {
            const button = el("button", "Ver fotografia original"), image = el("img"); image.alt = photo.caption || "Foto original do item " + item.itemKey; image.hidden = true; image.className = "lvt-photo"; button.type = "button";
            button.onclick = async () => { const key = contextKey; button.disabled = true; try { const uri = await options.onPhoto(photo); if (key === contextKey && current?.itemId === item.id && image.isConnected) { image.src = uri; image.hidden = false; button.remove(); const enlarge = el("button", "Ampliar fotografia"); enlarge.type = "button"; enlarge.onclick = () => { const modal = el("dialog", undefined, "photo-dialog"), close = el("button", "Fechar fotografia"), full = el("img"); full.src = uri; full.alt = image.alt; close.type = "button"; close.onclick = () => modal.close(); modal.append(close, full, el("p", photo.caption)); document.body.append(modal); modal.onclose = () => { modal.remove(); enlarge.focus(); }; modal.showModal(); }; panel.append(enlarge); } } catch (error) { options.onError?.(error); } finally { button.disabled = false; } };
            panel.append(button, image);
          }
          original(panel, photo.source || { sourceId: photo.sourceId, locator: photo.locator });
        }
        if (!list.length) notice(photos, "Nenhuma foto original vinculada. A ausência de fotografia permanece pendente no relatório.");
        if (item && asset && lvt) {
          operation(photos, "photos", { assetId: asset.id, lvtItemId: item.id });
          const findings = section(container, "Achados, recomendações e a mesma RTI");
          for (const finding of records("finding").filter((f) => f.lvtItemId === item.id && f.assetId === asset.id)) {
            const panel = section(findings, finding.description); fields(panel, [["Recomendação documentada", finding.recommendation]]);
            for (const rti of records("rti").filter((r) => r.findingId === finding.id && r.lvtItemId === item.id)) { sourceSituation(panel, rti); link(panel, "Consultar a mesma RTI · " + rti.id, "rtis", "detalhe", rti.id, ""); }
          }
          operation(findings, "findings", { assetId: asset.id, lvtItemId: item.id });
          link(container, "Voltar à LVT desta TAG", module, "lvt", asset.id, lvt.contractId || "");
        }
        return true;
      }
      if (module === "integridade" && view === "achados") {
        container.append(el("h1", "Achados documentados e RTIs reais"));
        const list = records("finding").filter((r) => assets().some((a) => a.id === r.assetId));
        for (const finding of list.filter((r) => itemId === "_" || r.id === itemId)) {
          const panel = section(container, finding.description); panel.dataset.findingId = finding.id;
          fields(panel, [["ID do achado", finding.id], ["Ativo confirmado", assets().find((a) => a.id === finding.assetId)?.tag], ["LVT de origem", records("lvt").find((l) => l.id === finding.lvtId && l.assetId === finding.assetId)?.id]]);
          original(panel, finding.source);
          const rtis = records("rti").filter((r) => (r.findingId === finding.id || r.origin?.findingId === finding.id) && (!r.assetId || r.assetId === finding.assetId));
          for (const rti of rtis) { sourceSituation(panel, rti); link(panel, "Consultar a mesma RTI · " + rti.id, "rtis", "detalhe", rti.id, ""); }
          if (!rtis.length) notice(panel, "Nenhuma RTI vinculada. Uma recomendação real documentada é salva junto à RTI; achado sem recomendação permanece somente como achado.");
        }
        if (!list.length) notice(container, "Nenhum achado registrado. A ausência de informação permanece explícita.");
        operation(container, "findings"); operation(container, "rtis");
        link(container, "Ver fila de RTIs", "rtis", "fila", "_", ""); return true;
      }
      if (module === "integridade" && view === "espessura" || module === "valvulas" && view === "certificados" || module === "nr13" && view === "inspecoes") {
        const kind = module === "valvulas" ? "certificate" : module === "nr13" ? "deadline" : "measurement";
        container.append(el("h1", kind === "certificate" ? "Certificados de válvulas" : kind === "deadline" ? "Próximas inspeções documentadas" : "Medições de espessura"));
        const list = records(kind);
        for (const record of list) {
          const panel = section(container, record.reference || "Registro documentado");
          fields(panel, [["TAG", assets().find(a => a.id === record.assetId)?.tag], ["Data", record.measuredOn || record.issuedOn || record.due], ["Tipo", record.type], ["Resultado documental", record.resultText], ["Instrumento", record.instrument], ["Calibração", record.calibration]]);
          for (const reading of record.readings || []) fields(panel, [[reading.point, reading.value + " " + reading.unit]]);
          original(panel, record.source); link(panel, "Abrir histórico do ativo", module, "book", record.assetId);
        }
        if (!list.length) notice(container, "Nenhum registro documentado neste cliente. Informações ausentes permanecem a confirmar.");
        operation(container, "documents", { documentType: "outro" });
        operation(container, kind === "certificate" ? "certificates" : kind === "deadline" ? "deadlines" : "measurements");
        if (kind === "measurement") operation(container, "inspections");
        return true;
      }
      if (["documentos", "relacoes"].includes(view) && module === "nr13") {
        container.append(el("h1", view === "documentos" ? "Documentos originais NR-13" : "Relações explícitas do book"));
        for (const document of records("document").filter((r) => r.module === module)) {
          const panel = section(container, document.reference); fields(panel, [["ID documental", document.id], ["Tipo declarado", document.documentType], ["Aprovação técnica", "Não inferida da presença documental"]]); original(panel, document.source);
        }
        operation(container, view === "documentos" ? "documents" : "relationships", { documentType: "outro" }); return true;
      }
      return false;
    }
    function showPlanned(module, view, itemId) {
      const title = modules[module].views.find(([key]) => key === view)?.[1] || "Campanha e acompanhamento";
      container.append(el("h1", title));
      fields(container, [["Cliente", context().client?.name || "Não selecionado"], ["Módulo", modules[module].name], ["Contrato / escopo", contracts(module).find((contract) => contract.id === current.contractId)?.name || "Não selecionado"]]);
      if (view === "achados") {
        const list = records("finding").filter((finding) => assets().some((asset) => asset.id === finding.assetId));
        for (const finding of list.filter((finding) => itemId === "_" || finding.id === itemId)) {
          const panel = section(container, finding.description || "Achado documentado");
          fields(panel, [["ID do achado", finding.id], ["Ativo", assets().find((asset) => asset.id === finding.assetId)?.tag], ["Inspeção de origem", (data().inspection || []).some((inspection) => inspection.id === finding.inspectionId && inspection.assetId === finding.assetId) ? finding.inspectionId : null]]);
          for (const rti of (data().rti || []).filter((rti) => rti.origin?.findingId === finding.id && rti.assetId === finding.assetId && (!rti.origin.clientId || rti.origin.clientId === context().client?.id)))
            link(panel, "Consultar RTI existente · " + rti.id, "rtis", "detalhe", rti.id, "");
        }
        if (!list.length) notice(container, "Nenhum achado de inspeção disponível. A geração de RTI a partir do achado ainda não está ativa.");
        unavailable(container, "Abrir RTI a partir do achado", "Fluxo previsto: registrar achado na inspeção → criar uma RTI com ID único → acompanhar a mesma RTI na Gestão de RTI. Sem gravação automática nesta etapa.");
        link(container, "Ver fila de RTIs", "rtis", "fila", "_", "");
        return;
      }
      const sections = view === "lvt" ? [
        ["Identificação do levantamento visual", "Cliente, contrato/escopo, campanha, ativo, data e responsáveis."], ["Registro visual e evidências", "Localização, condições observadas, fotografias e referências documentais."], ["Achados e recomendações", "Achado identificado, origem e relação explícita com RTIs."], ["Relatório visual de integridade", "Revisão, evidências e análise do responsável; emissão ainda indisponível."],
      ] : view === "espessura" ? [
        ["Campanha de medição de espessura", "Contrato/escopo, conjunto de ativos, procedimento, instrumento e calibração."], ["Pontos, geratrizes e leituras", "Localização, datas, unidades, fontes e leituras ausentes explicitadas."], ["Comparação e relatório ME", "A ferramenta de medição existente será vinculada por IDs e evidência; não cria campanha automaticamente."],
      ] : module === "valvulas" ? [
        ["Campanha e escopo de válvulas", "Válvulas e PSVs mantêm cadastro próprio dentro deste cliente."], ["Ensaios e evidências", "Condições, instrumentos, referências e resultados serão definidos no módulo de certificação."], ["Certificado e histórico", "Revisões e relação explícita com o ativo protegido; nenhum vínculo é inferido pela TAG."],
      ] : module === "nr13" ? [
        ["Enquadramento e aplicabilidade", "Categoria, classe do fluido e enquadramento são campos diferentes, com fontes e revisão."], ["Inspeções, prazos e documentação", "Prazos somente quando documentados. Cadastro não significa aprovação."], ["Relações do book NR-13", "Certificados de válvulas, linhas, medições e RTIs somente por vínculos explícitos entre registros deste cliente."],
      ] : module === "rtis" ? [
        ["Ações e responsáveis", "Ação vinculada ao mesmo ID da RTI e à origem da inspeção."], ["Prazo e reinspeção", "Prazo pendente quando não documentado; não há cálculo automático nesta tela."], ["Relatório e histórico", "Causa confirmada ou em investigação, evidências e atendimento preservados."],
      ] : [
        ["Campanha e escopo de integridade", "Identificação da campanha, contrato/escopo, ativos e planejamento próprios."], ["Inspeção e levantamento visual", "LVT, relatório visual e achados mantêm rastreio até o ativo."], ["Medição de espessura e RTIs", "Campanhas e registros distintos, relacionados somente por origem documentada."],
      ];
      for (const [heading, text] of sections) section(container, heading, text);
      const planned = section(container, "Dados do processo · consulta da estrutura");
      const pairs = view === "lvt" ? [["Campanha / LVT", "Não selecionado"], ["Ativo / TAG", "Não selecionado"], ["Data do levantamento", "Não informada"], ["Procedimento / revisão", "Não informado"], ["Responsável", "Não informado"], ["Condição observada", "Pendente de registro"], ["Registro fotográfico", "Nenhuma evidência vinculada"], ["Achados e recomendações", "Nenhum achado registrado"]]
        : view === "espessura" ? [["Campanha", "Não selecionada"], ["Ativos do plano", "Nenhum ativo selecionado"], ["Data da medição", "Não informada"], ["Procedimento", "Não informado"], ["Instrumento / calibração", "Não informado"], ["Pontos e geratrizes", "Nenhuma leitura registrada"], ["Espessura mínima / fonte", "Não informada"], ["Relatório ME", "Nenhum relatório vinculado"]]
        : module === "valvulas" ? [["Campanha", "Não selecionada"], ["Válvula / PSV", "Não selecionada"], ["Procedimento de ensaio", "Não informado"], ["Instrumentos e calibração", "Não informados"], ["Resultados de ensaio", "Não registrados"], ["Certificado / revisão", "Nenhum certificado vinculado"], ["Ativo protegido", "Relação explícita pendente"]]
        : module === "nr13" ? [["Ativo", "Não selecionado"], ["Enquadramento", "Pendente de avaliação"], ["Categoria / classe do fluido", "Não informadas"], ["Próxima inspeção", "Prazo pendente de definição"], ["Documento / revisão", "Não selecionado"], ["Aplicabilidade", "Pendente de revisão"]]
        : module === "rtis" ? [["ID da RTI", "Não selecionado"], ["Achado de origem", "Não selecionado"], ["Responsável pela ação", "Não informado"], ["Prazo documentado", "Pendente de definição"], ["Reinspeção", "Pendente de definição"], ["Evidência de atendimento", "Não vinculada"]]
        : [["Campanha", "Não selecionada"], ["Modalidade", "Visual / LVT / medição — a definir no escopo"], ["Conjunto de ativos", "Nenhum ativo selecionado"], ["Planejamento", "Não informado"], ["Execução comprovada", "Não registrada"], ["Relatório / revisão", "Não vinculado"]];
      fields(planned, pairs);
      notice(container, "Nenhuma campanha ou resultado foi preenchido nesta tela. A estrutura está disponível para avaliação do fluxo.");
      unavailable(container, "Criar campanha ou emitir relatório");
    }
    function render() {
      const ctx = context();
      if (!ctx.authenticated) { container.replaceChildren(); breadcrumb.replaceChildren(); hideLegacy(); return; }
      const key = [ctx.tenantId || "local", ctx.client?.id || "_"].join("/");
      if (key !== contextKey) {
        contextKey = key;
        const requested = parseHash(root.location.hash);
        if (!requested || requested.clientId !== (ctx.client?.id || "_")) replacement();
      }
      current = parseHash(root.location.hash);
      const clientId = ctx.client?.id || "_";
      if (!current || current.clientId !== clientId || current.contractId && !contracts(current.module).some((contract) => contract.id === current.contractId)) {
        replacement(); current = parseHash(root.location.hash);
      }
      if (["book", "registros"].includes(current.view) && current.itemId !== "_" && !assets().some((asset) => asset.id === current.itemId) || current.module === "rtis" && current.view === "detalhe" && current.itemId !== "_" && !(data().rti || []).some((rti) => rti.id === current.itemId && (!rti.assetId || assets().some((asset) => asset.id === rti.assetId)))) {
        replacement(current.module); current = parseHash(root.location.hash);
      }
      if (current.itemId !== "_" && (
        current.view === "escopo" && !contracts(current.module).some((contract) => contract.id === current.itemId) && !commercialReferences().some((reference) => reference.id === current.itemId) ||
        current.view === "achados" && !records("finding").some((finding) => finding.id === current.itemId && assets().some((asset) => asset.id === finding.assetId)) ||
        current.view === "historico" && !assets().some((asset) => asset.id === current.itemId) ||
        current.module === "integridade" && current.view === "ativos" && !records("system").some((system) => system.id === current.itemId) ||
        current.module === "integridade" && current.view === "lvt" && !assets().some((asset) => asset.id === current.itemId) ||
        current.view === "item" && !records("lvtItem").some((item) => item.id === current.itemId && assets().some((asset) => asset.id === item.assetId) && records("lvt").some((lvt) => lvt.id === item.lvtId && lvt.assetId === item.assetId))
      )) { replacement(current.module); current = parseHash(root.location.hash); }
      if (current.view === "book" && current.module !== "valvulas" && assets().some((asset) => asset.id === current.itemId && asset.type === "valvula")) {
        replacement("valvulas", "book", current.itemId); current = parseHash(root.location.hash);
      }
      const globalImport = document.getElementById("importButton"); if(globalImport) globalImport.hidden = Boolean(data().projectDashboardVersion);
      container.classList.remove("project-presentation");
      container.dataset.client = ctx.client?.id || "";
      container.dataset.module = current.module;
      container.dataset.view = current.view;
      container.replaceChildren(); hideLegacy(); breadcrumb.replaceChildren();
      if (options.onSelectClient) {
        const managementHome = el("a", "Gestão de Ativos"); managementHome.href = "/gestao-inicio"; breadcrumb.append(managementHome, el("span", "/"));
        const clients = el("button", "Clientes"); clients.type = "button"; clients.onclick = () => options.onSelectClient(""); breadcrumb.append(clients);
        if (ctx.client) { breadcrumb.append(el("span", "/")); link(breadcrumb, ctx.client.name, "", "inicio", "_", ""); }
      } else link(breadcrumb, "Gestão de Ativos", "", "inicio", "_", "");

      if (current.module) { breadcrumb.append(el("span", "/")); link(breadcrumb, modules[current.module].name, current.module, "inicio", "_", ""); }
      if (current.contractId) { const project = contracts(current.module).find(c => c.id === current.contractId); breadcrumb.append(el("span", "/")); link(breadcrumb, project?.name || "Projeto", current.module, "painel", "_", current.contractId); }
      if (current.module && current.view !== "inicio") breadcrumb.append(el("span", " / " + (modules[current.module].views.find(([key]) => key === current.view)?.[1] || (current.view === "execucao" ? "Execução da inspeção" : current.view === "painel" ? "Painel" : current.view === "importar" ? "Importação" : current.view === "planejamento" ? "Planejamento" : current.view === "book" ? "Book do ativo" : current.view === "escopo" ? "Escopo do contrato" : "Consulta do registro"))));
      back.hidden = !current.module;
      back.onclick = () => {
        if (current.view === "inicio") navigate("", "inicio", "_", "");
        else if (current.module === "integridade" && current.view === "execucao") navigate("integridade", "minhas", "_", current.contractId);
        else if (current.contractId && ["painel", "importar", "planejamento", "sistemas", "campanhas", "relatorios"].includes(current.view)) navigate(current.module, current.view === "painel" ? "inicio" : "painel", "_", current.view === "painel" ? "" : current.contractId);
        else if (current.module === "integridade" && current.view === "item") { const item = records("lvtItem").find((r) => r.id === current.itemId); navigate("integridade", "lvt", item?.assetId || "_", current.contractId); }
        else if (current.module === "integridade" && current.view === "lvt" && current.itemId !== "_") { const asset = assets().find((a) => a.id === current.itemId); navigate("integridade", "ativos", asset?.systemId || "_", current.contractId); }
        else if (current.module === "integridade" && current.view === "ativos" && current.itemId !== "_") navigate("integridade", "sistemas", "_", current.contractId);
        else if (["book", "registros", "historico"].includes(current.view) && current.itemId !== "_") navigate(current.module, "ativos", "_", current.contractId);
        else if (current.view === "escopo") navigate(current.module, "contratos", "_", "");
        else if (current.module === "rtis" && current.view === "detalhe") navigate("rtis", "fila", "_", "");
        else if (current.view === "achados" && current.itemId !== "_") navigate(current.module, "achados", "_", current.contractId);
        else navigate(current.module, "inicio", "_", "");
      };
      if (inspections?.render(container, current)) { /* Dedicated execution and assignment screens. */ }
      else if (projects?.render(container,current)) { /* Project screens own their content. */ }
      else if (!current.module) showModules();
      else if (current.view === "inicio") showModule(current.module);
      else if (["contratos", "escopo"].includes(current.view)) showContracts(current.module, current.itemId);
      else if (current.view === "ativos") showAssets(current.module);
      else if (current.view === "book") showBook(current.module, current.itemId);
      else if (current.module === "rtis" && ["fila", "detalhe", "acoes"].includes(current.view)) showRtis(current.itemId);
      else if (current.view === "registros" && ctx.mode === "local" && ctx.client) {
        legacy.hidden = false;
        options.onAssets?.(current.module, current.contractId);
        if (current.itemId !== "_") { document.getElementById("detail").hidden = false; options.onLegacyBook?.(current.itemId); }
        else for (const id of ["contracts", "indicators"]) document.getElementById(id).hidden = false;
        notice(container, "Registros já existentes do ambiente privado. Os novos processos e campanhas continuam separados desta consulta.");
      } else if (!showOperational(current.module, current.view, current.itemId)) showPlanned(current.module, current.view, current.itemId);
      if (inspections?.enabled() && current.module === "integridade" && !["minhas", "execucao", "ativos", "lvt"].includes(current.view)) {
        const navigation = el("nav", undefined, "inspection-toolbar"); link(navigation, "Minhas inspeções", "integridade", "minhas", "_", current.contractId); container.prepend(navigation);
      }
      if (previousRoute !== root.location.hash) { previousRoute = root.location.hash; root.scrollTo?.(0, 0); container.focus?.({ preventScroll: true }); }
    }
    root.addEventListener("hashchange", render);
    return { render, navigate, reset() { contextKey = ""; render(); }, destroy() { root.removeEventListener("hashchange", render); } };
  }
  return Object.freeze({ modules, routeHash, parseHash, relationsFor, formatBRL, safeSourceURL, create });
});
