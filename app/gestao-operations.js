(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoOperations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const labels = { integridade: "Inspeção de Integridade", rtis: "Gestão de RTI", nr13: "Gestão NR-13", valvulas: "Certificação de Válvulas" };
  const relationTypes = [
    ["rti", "asset", "affects"], ["rti", "finding", "addresses"],
  ];
  function create(options) {
    const workflow = root.PiresGestaoWorkflow?.create(options);
    const document = options.document || root.document, context = options.getContext;
    const el = (tag, text) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
    const state = () => context().state || {};
    const records = (kind) => state()[kind] || state()[{ finding: "findings", relation: "relations" }[kind]] || [];
    const caption = (record) => record.tag || record.name || record.reference || record.title || record.itemKey && [record.itemKey, record.component].filter(Boolean).join(" · ") || record.description || record.id;
    const canWrite = () => context().mode === "connected" && context().write === true && Boolean(context().client);
    const key = () => [context().tenantId, context().client?.id].join("/");
    function render(parent, operation, defaults = {}) {
      if (workflow?.supports(operation)) return workflow.render(parent, operation, defaults);
      if (!canWrite()) return false;
      if (["documents", "photos"].includes(operation) && context().capabilities?.[operation === "photos" ? "photoOriginals" : "documentOriginals"] !== true) {
        parent.append(el("p", "O arquivamento de documentos originais não está disponível neste servidor. Nenhum arquivo foi enviado."));
        return false;
      }
      const module = defaults.module || "integridade", initialKey = key(), controls = {}, box = el("details"), form = el("form"), feedback = el("p"), grid = el("div");
      const titles = { contracts: "Cadastrar contrato e escopo", campaigns: "Criar campanha em rascunho", inspections: "Planejar inspeção", documents: "Vincular documento original", lvts: "Registrar LVT com original", "lvt-items": "Registrar item da LVT", photos: "Vincular foto original ao item", findings: "Registrar achado / recomendação real", rtis: "Registrar RTI histórica documentada", relationships: "Resolver vínculo confirmado de RTI" };
      box.className = "operation-drawer";
      box.append(el("summary", titles[operation]));
      form.dataset.operation = operation; grid.className = "formgrid";
      feedback.setAttribute("role", "status"); feedback.className = "notice";
      const requestId = ["contracts", "campaigns", "inspections"].includes(operation) ? root.crypto.randomUUID() : null;
      function field(name, label, settings = {}) {
        const wrap = el("label", label), input = el(settings.choices ? "select" : settings.area ? "textarea" : "input");
        input.name = name; input.required = settings.required !== false;
        if (settings.choices) {
          input.append(new Option(settings.empty || "Selecione", ""));
          for (const [value, text] of settings.choices) input.append(new Option(text, value));
        } else if (!settings.area) input.type = settings.type || "text";
        if (settings.accept) input.accept = settings.accept;
        if (settings.value !== undefined && settings.value !== null) input.value = settings.value;
        if (settings.min !== undefined) { input.min = settings.min; input.step = "1"; }
        wrap.append(input); grid.append(wrap); controls[name] = input; return input;
      }
      function select(name, label, kind, filter = () => true, required = true, value = defaults[name]) {
        return field(name, label, { choices: records(kind).filter(filter).map((r) => [r.id, caption(r)]), required, value });
      }
      function assetChecks(ids = records("asset").map((a) => a.id)) {
        const group = el("fieldset"); group.append(el("legend", "Ativos canônicos deste escopo"));
        const actions = el("div"); actions.className = "actions";
        for (const [title, checked] of [["Selecionar todos deste escopo", true], ["Limpar seleção", false]]) {
          const button = el("button", title); button.type = "button";
          button.onclick = () => { for (const input of group.querySelectorAll('[name="assetIds"]')) input.checked = checked; };
          actions.append(button);
        }
        group.append(actions);
        for (const asset of records("asset").filter((a) => ids.includes(a.id))) {
          const label = el("label", asset.tag), input = el("input"); input.type = "checkbox"; input.name = "assetIds"; input.value = asset.id;
          if (defaults.assetId === asset.id) input.checked = true;
          label.prepend(input); group.append(label);
        }
        grid.append(group); return group;
      }
      function locator() {
        field("page", "Página do original (se aplicável)", { type: "number", min: 1, required: false });
        field("sheet", "Aba do original (se aplicável)", { required: false });
        field("row", "Linha da aba (se aplicável)", { type: "number", min: 1, required: false });
        field("section", "Seção / referência exata no original", { required: false });
      }
      function locatorValue() {
        const value = {};
        for (const name of ["page", "sheet", "row", "section"]) if (controls[name]?.value.trim())
          value[name] = ["page", "row"].includes(name) ? Number(controls[name].value) : controls[name].value.trim();
        if (!Object.keys(value).length) throw Error("Informe página, aba/linha ou seção que localiza a evidência no original.");
        return value;
      }
      const activeContracts = (r) => r.recordClass !== "commercial_reference" && r.modules?.includes(module);
      if (operation === "contracts") {
        field("name", "Nome / número do contrato ou OS"); field("source", "Referência documental do contrato / OS"); assetChecks();
        grid.append(el("p", "Módulo: " + labels[module] + ". OS diferentes devem manter escopos próprios. Nenhum contrato é inferido da lista."));
      } else if (operation === "campaigns") {
        field("name", "Nome da campanha"); const contract = select("contractId", "Contrato / escopo", "contract", activeContracts);
        const system = select("systemId", "Sistema desta campanha", "system");
        let checks = assetChecks([]);
        const update = () => { const next = records("contract").find((c) => c.id === contract.value), old = checks, ids = next?.moduleAssetIds?.[module] || next?.assetIds || []; checks = assetChecks(records("asset").filter((a) => a.systemId === system.value && ids.includes(a.id)).map((a) => a.id)); old.remove(); };
        contract.onchange = update; system.onchange = update; update();
        field("plannedStart", "Início planejado (opcional)", { type: "date", required: false }); field("plannedEnd", "Fim planejado (opcional)", { type: "date", required: false });
        field("source", "Fonte / referência do planejamento"); grid.append(el("p", "Rascunho operacional. Criar campanha não registra execução, LVT ou aprovação."));
      } else if (operation === "inspections") {
        const campaign = select("campaignId", "Campanha em rascunho", "campaign", (r) => r.module === module && (!defaults.contractId || r.contractId === defaults.contractId) && (!defaults.assetId || r.assetIds?.includes(defaults.assetId)));
        select("assetId", "Ativo", "asset");
        field("type", "Modalidade", { choices: [["visual", "Visual / LVT"], ["espessura", "Medição de espessura"]], value: "visual" });
        field("plannedDate", "Data planejada (opcional)", { type: "date", required: false }); field("source", "Fonte do planejamento");
        campaign.onchange = () => {
          const record = records("campaign").find((r) => r.id === campaign.value), select = controls.assetId;
          select.replaceChildren(new Option("Selecione", ""));
          for (const asset of records("asset").filter((a) => record?.assetIds?.includes(a.id))) select.append(new Option(asset.tag, asset.id));
          if (defaults.assetId && record?.assetIds?.includes(defaults.assetId)) select.value = defaults.assetId;
        };
        campaign.onchange();
      } else if (operation === "documents") {
        field("reference", "Referência / identificação do documento original");
        field("documentType", "Tipo documental", { choices: [["lvt", "LVT"], ["rti", "RTI real"], ["relatorio", "Relatório"], ["outro", "Outro"]], value: defaults.documentType || "lvt" });
        field("original", "Arquivo original XLSX ou PDF", { type: "file", accept: ".xlsx,.pdf", required: false });
        if (context().capabilities?.preparedSources?.length) field("preparedReference", "Original já preparado do Drive", {required:false,choices:context().capabilities.preparedSources.map(x=>[x.id,x.name])});
        select("assetId", "Ativo confirmado (opcional)", "asset", () => true, false);
        select("contractId", "Contrato confirmado (opcional)", "contract", activeContracts, false);
        select("campaignId", "Campanha confirmada (opcional)", "campaign", (r) => r.module === module, false);
        locator(); field("sourceStatus", "Situação literal informada no documento", { required: false });
        field("sourceDate", "Data documental da situação", { type: "date", required: false });
        field("sourceDateMissingReason", "Motivo da ausência de data documental", { required: false });
        field("openingEvidence", "Trecho / evidência de abertura de RTI real", { area: true, required: false });
        grid.append(el("p", "Uma recomendação real documentada será registrada como RTI pelo fluxo do achado. Não há extração automática da LVT; uma WO vazia não cria recomendação. Documento histórico não confirma situação atual. Não anexe documento fabricado para teste."));
      } else if (operation === "lvts") {
        select("inspectionId", "Inspeção planejada", "inspection", (r) => r.module === module && r.type === "visual" && (!defaults.assetId || r.assetId === defaults.assetId));
        select("documentId", "Documento LVT original", "document", (r) => r.documentType === "lvt" && r.module === module && (!defaults.assetId || !r.assetId || r.assetId === defaults.assetId));
      } else if (operation === "lvt-items") {
        select("lvtId", "LVT da TAG", "lvt", (r) => !defaults.assetId || r.assetId === defaults.assetId);
        field("itemKey", "Identificação do item no checklist original");
        field("component", "Componente / localização", { required: false }); field("description", "Descrição documentada do item", { area: true, required: false });
        select("sourceDocumentId", "Original que contém o item", "document", (r) => r.module === module); locator();
      } else if (operation === "photos") {
        select("lvtItemId", "Item da LVT", "lvtItem", (r) => !defaults.assetId || r.assetId === defaults.assetId);
        field("original", "Fotografia original JPEG ou PNG (até 8 MiB)", { type: "file", accept: ".jpg,.jpeg,.png" });
        field("caption", "Legenda / identificação da foto"); locator();
      } else if (operation === "findings") {
        select("lvtItemId", "Item da LVT de origem", "lvtItem", (r) => !defaults.assetId || r.assetId === defaults.assetId);
        field("description", "Achado documentado", { area: true });
        field("recommendation", "Recomendação real documentada (gera RTI automaticamente)", { area: true, required: false });
        select("sourceDocumentId", "Documento que contém o achado", "document", (r) => r.module === module); locator();
        field("sourceStatus", "Situação literal da recomendação na fonte (se informada)", { required: false });
        field("sourceDate", "Data documental da recomendação (se informada)", { type: "date", required: false });
        field("sourceDateMissingReason", "Motivo da ausência de data documental", { required: false });
        grid.append(el("p", "Com recomendação preenchida, salvar cria a RTI na mesma operação e mantém o mesmo ID na origem e na gestão. O ID interno não é número de RTI emitida no passado. Sem recomendação, registra somente o achado."));
      } else if (operation === "rtis") {
        field("title", "Identificação / título da RTI real");
        select("documentId", "Original que comprova abertura de RTI", "document", (r) => r.documentType === "rti" && Boolean(r.openingEvidence));
        select("assetId", "Ativo confirmado (opcional)", "asset", () => true, false);
        select("findingId", "Achado confirmado (opcional)", "finding", () => true, false);
        grid.append(el("p", "Registra a RTI documental com o mesmo ID na gestão e na origem. Sem vínculo confirmado, o campo ficará pendente. Situação atual desconhecida; não cria RTI de TESTE e não encerra registros."));
      } else if (operation === "relationships") {
        const relation = field("relation", "Relação documentada", { choices: relationTypes.map((r, i) => [String(i), r.join(" → ")]) });
        field("fromId", "Registro de origem", { choices: [] }); field("toId", "Registro de destino", { choices: [] });
        relation.onchange = () => {
          const tuple = relationTypes[Number(relation.value)];
          for (const [name, kind] of [["fromId", tuple?.[0]], ["toId", tuple?.[1]]]) {
            controls[name].replaceChildren(new Option("Selecione", ""));
            for (const record of kind ? records(kind) : []) controls[name].append(new Option(caption(record), record.id));
          }
        };
        grid.append(el("p", "Disponível somente para resolver vínculo pendente de RTI documental. As demais relações são criadas junto aos registros de origem. Escolha IDs existentes deste cliente; a API valida o vínculo sem usar semelhança de TAG."));
      } else return false;
      const submit = el("button", titles[operation]); submit.type = "submit";
      if (operation === "findings") {
        submit.textContent = "Salvar achado";
        controls.recommendation.oninput = () => { submit.textContent = controls.recommendation.value.trim() ? "Salvar recomendação e RTI" : "Salvar achado"; };
      }
      form.append(grid, submit, feedback); box.append(form); parent.append(box);
      let uploadedSource = null, uploadedFile = null;
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (!canWrite() || key() !== initialKey) return;
        submit.disabled = true; feedback.textContent = "Enviando para validação e persistência...";
        try {
          const value = (name) => controls[name]?.value.trim() || null;
          let payload;
          if (operation === "contracts") payload = { name: value("name"), source: value("source"), modules: [module], assetIds: [...form.querySelectorAll('[name="assetIds"]:checked')].map((i) => i.value), requestId };
          if (operation === "campaigns") payload = { name: value("name"), contractId: value("contractId"), systemId: value("systemId"), module, assetIds: [...form.querySelectorAll('[name="assetIds"]:checked')].map((i) => i.value), plannedStart: value("plannedStart"), plannedEnd: value("plannedEnd"), source: value("source"), status: "rascunho", requestId };
          if (operation === "inspections") {
            const campaign = records("campaign").find((r) => r.id === value("campaignId"));
            payload = { assetId: value("assetId"), campaignId: campaign?.id, contractId: campaign?.contractId, module, type: value("type"), source: value("source"), status: "planejada", plannedDate: value("plannedDate"), requestId };
          }
          if (operation === "documents") {
            const file = controls.original.files[0];
            const prepared = value("preparedReference");
            if ((!file && !prepared) || (file && prepared)) throw Error("Selecione um arquivo local ou um original preparado.");
            if (file && !/\.(xlsx|pdf)$/i.test(file.name)) throw Error("Use o original XLSX ou PDF.");
            const location = locatorValue();
            if (value("documentType") === "rti" && (!value("openingEvidence") || !value("sourceStatus") || !value("sourceDate") && !value("sourceDateMissingReason"))) throw Error("RTI exige evidência real de abertura, situação literal da fonte e data documental ou motivo da ausência.");
            if (uploadedFile !== (prepared || file)) { uploadedSource = prepared ? await options.uploadPrepared(prepared) : await options.upload(file); uploadedFile = prepared || file; }
            if (key() !== initialKey || !canWrite()) return;
            payload = { module, documentType: value("documentType"), reference: value("reference"), sourceId: uploadedSource.id, locator: location };
            for (const name of ["assetId", "contractId", "campaignId", "sourceStatus", "sourceDate", "sourceDateMissingReason", "openingEvidence"]) if (value(name)) payload[name] = value(name);
          }
          if (operation === "lvts") {
            const inspection = records("inspection").find((r) => r.id === value("inspectionId"));
            payload = { assetId: inspection?.assetId, inspectionId: inspection?.id, documentId: value("documentId") };
          }
          if (operation === "findings") {
            const item = records("lvtItem").find((r) => r.id === value("lvtItemId")), source = records("document").find((r) => r.id === value("sourceDocumentId"))?.source;
            if (!source?.sourceId) throw Error("O documento precisa ter uma fonte original registrada.");
            payload = { assetId: item?.assetId, lvtItemId: item?.id, description: value("description"), sourceId: source.sourceId, locator: locatorValue() };
            for (const name of ["recommendation", "sourceStatus", "sourceDate", "sourceDateMissingReason"]) if (value(name)) payload[name] = value(name);
          }
          if (operation === "lvt-items") {
            const lvt = records("lvt").find((r) => r.id === value("lvtId")), source = records("document").find((r) => r.id === value("sourceDocumentId"))?.source;
            if (!source?.sourceId) throw Error("Selecione o original que contém o item.");
            payload = { assetId: lvt?.assetId, lvtId: lvt?.id, itemKey: value("itemKey"), component: value("component"), description: value("description"), sourceId: source.sourceId, locator: locatorValue() };
          }
          if (operation === "photos") {
            const item = records("lvtItem").find((r) => r.id === value("lvtItemId")), file = controls.original.files[0], location = locatorValue();
            if (!file) throw Error("Anexe a fotografia original do item.");
            if (uploadedFile !== file) { uploadedSource = await options.uploadPhoto(file); uploadedFile = file; }
            if (key() !== initialKey || !canWrite()) return;
            payload = { assetId: item?.assetId, lvtItemId: item?.id, sourceId: uploadedSource.id, locator: location, caption: value("caption") };
          }
          if (operation === "rtis") payload = { title: value("title"), documentId: value("documentId"), ...(value("assetId") ? { assetId: value("assetId") } : {}), ...(value("findingId") ? { findingId: value("findingId") } : {}) };
          if (operation === "relationships") {
            const tuple = relationTypes[Number(value("relation"))];
            if (!tuple) throw Error("Selecione uma relação tipada.");
            payload = { fromId: value("fromId"), fromKind: tuple[0], toId: value("toId"), toKind: tuple[1], relationType: tuple[2] };
          }
          const result = await options.write(operation, payload);
          if (key() !== initialKey) return;
          feedback.textContent = "Registro confirmado pela API: " + (result.id || "persistido") + (result.rti?.id ? ". RTI criada com ID interno: " + result.rti.id : "") + ". Atualizando os dados registrados...";
          await options.refresh();
          if (key() === initialKey) options.onSuccess?.(result, operation);
        } catch (error) {
          feedback.textContent = error.message + (error.code === "service_unavailable" ? " Confira os registros com Atualizar antes de repetir. A API conserva a identidade desta origem." : "");
          options.onError?.(error);
        } finally { if (form.isConnected) submit.disabled = !canWrite() || key() !== initialKey; }
      };
      return true;
    }
    return Object.freeze({ render });
  }
  return Object.freeze({ create, relationTypes });
});
