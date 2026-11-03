(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresGestaoInspection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  const statusLabels = Object.freeze({ planejada: "Planejada", rascunho: "Rascunho", em_andamento: "Em andamento", em_revisao: "Enviada para revisão", pendencia_tecnica: "Pendente de gestão técnica", concluida: "Execução registrada" });
  const typeLabel = (type) => ({ visual: "Inspeção visual · LVT", espessura: "Medição de espessura" })[type] || "Modalidade a conferir";
  function describe(inspection) {
    const progress = inspection?.progress || {}, answered = Number.isInteger(progress.answered) ? progress.answered : 0,
      total = Number.isInteger(progress.total) ? progress.total : 0, status = inspection?.executionStatus || inspection?.status;
    return { type: typeLabel(inspection?.type), status: (statusLabels[status] || "Situação a conferir") + (inspection?.technicalReviewRequired ? " · pendência técnica" : ""), answered, total,
      action: inspection?.executionId ? status === "em_revisao" ? "Consultar inspeção" : "Continuar inspeção" : "Iniciar inspeção" };
  }
  function create(options) {
    const d = options.document || root.document, ctx = options.getContext;
    let generation = 0;
    const pending = new Map(), outcomes = new Map(), photoUploads = new WeakMap();
    const enabled = () => ctx().mode === "connected" && ctx().capabilities?.inspectionExecutionVersion >= 1 && Boolean(ctx().client);
    const state = () => ctx().state || {}, records = (kind) => state()[kind] || [];
    const contextKey = () => [ctx().tenantId, ctx().client?.id, root.location?.hash].join("/");
    const el = (tag, text, cls) => { const n = d.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
    const note = (parent, text, cls = "inspection-note") => { const p = el("p", text, cls); parent.append(p); return p; };
    function button(parent, label, run, cls) {
      const b = el("button", label, cls); b.type = "button"; b.onclick = run; parent.append(b); return b;
    }
    function section(parent, title, cls = "inspection-section") {
      const box = el("section", undefined, cls); box.append(el("h2", title)); parent.append(box); return box;
    }
    function pairs(parent, values) {
      const list = el("dl", undefined, "inspection-meta");
      for (const [caption, value] of values) list.append(el("dt", caption), el("dd", value === undefined || value === null || value === "" ? "Não informado" : String(value)));
      parent.append(list);
    }
    function input(parent, name, label, type = "text", value) {
      const l = el("label", label), n = el(type === "select" ? "select" : type === "textarea" ? "textarea" : "input"); n.name = name;
      if (type !== "select" && type !== "textarea") n.type = type;
      if (value !== undefined && value !== null) n.value = value;
      l.append(n); parent.append(l); return n;
    }
    function choice(select, value, caption) { const n = el("option", caption); n.value = value; select.append(n); return n; }
    function go(view, id = "_", contractId = "") { options.onInspectionNavigate?.("integridade", view, id, contractId); }
    const request = (operation, payload) => options.onInspectionRequest(operation, payload);
    async function write(operation, payload) {
      const fingerprint = operation + JSON.stringify(payload);
      if (!pending.has(fingerprint)) pending.set(fingerprint, root.crypto.randomUUID());
      const result = await request(operation, { ...payload, requestId: pending.get(fingerprint) });
      pending.delete(fingerprint); return result;
    }
    function fail(parent, error) {
      note(parent, error.message || "Não foi possível consultar a inspeção.", "inspection-feedback error");
    }
    async function load(parent, route, show, operation) {
      const token = ++generation, key = contextKey(), loading = note(parent, "Consultando inspeções…");
      try {
        const result = await request(operation);
        if (token !== generation || contextKey() !== key || !parent.isConnected) return;
        loading.remove(); show(result, token, key);
      } catch (error) { if (token === generation && contextKey() === key) { loading.remove(); fail(parent, error); } }
    }
    function assignment(parent, inspection, access, after) {
      if (!access.canAssign) return;
      if (!Array.isArray(access.professionals)) { note(parent, "O cadastro de profissionais não foi carregado. Atualize a consulta antes de alterar a atribuição."); return; }
      let version = inspection.version;
      const form = el("form", undefined, "inspection-assignment"); form.dataset.operation = "execution-assign";
      const select = input(form, "professionalId", "Inspetor responsável", "select");
      choice(select, "", "Não atribuído");
      for (const person of access.professionals || []) {
        const option = choice(select, person.id, person.name + (person.accessLinked === false ? " · acesso não vinculado" : ""));
        option.disabled = person.registrationState && person.registrationState !== "active";
      }
      if (inspection.assigneeProfessionalId && !access.professionals.some((person) => person.id === inspection.assigneeProfessionalId)) {
        choice(select, inspection.assigneeProfessionalId, (inspection.assigneeName || "Profissional atribuído") + " · cadastro a conferir").disabled = true;
      }
      select.value = inspection.assigneeProfessionalId || "";
      const submit = el("button", "Salvar atribuição"); submit.type = "submit";
      const feedback = el("p", undefined, "inspection-feedback"); feedback.setAttribute("role", "status"); form.append(submit, feedback);
      const initialKey = contextKey();
      form.onsubmit = async (event) => {
        event.preventDefault(); if (contextKey() !== initialKey) return; submit.disabled = true;
        feedback.textContent = "Salvando atribuição…";
        try {
          const saved = await write("execution-assign", { inspectionId: inspection.id, professionalId: select.value || null, expectedVersion: version });
          if (saved.inspection?.version) version = saved.inspection.version;
          if (contextKey() === initialKey) { feedback.textContent = "Atribuição salva."; await after(); }
        } catch (error) { feedback.textContent = error.message; } finally { if (form.isConnected) submit.disabled = false; }
      };
      parent.append(form);
    }
    function card(parent, asset, inspection, access, route, reload) {
      const box = el("article", undefined, "inspection-card"), summary = describe(inspection);
      box.dataset.assetId = asset.id;
      if (inspection) box.dataset.inspectionId = inspection.id;
      box.append(el("span", inspection ? summary.type : "Atividade a planejar", "inspection-eyebrow"), el("h2", asset.tag), el("p", records("system").find((s) => s.id === asset.systemId)?.name || "Sistema não informado", "inspection-system"));
      pairs(box, [["Identificação", asset.identification || asset.description || asset.tag], ["Data planejada", inspection?.plannedDate || inspection?.planned || "Não definida"], ["Inspetor", inspection?.assigneeName || "Não atribuído"], ["Andamento", inspection ? summary.status : "Sem atividade planejada"]]);
      if (inspection) {
        if (inspection.technicalReviewRequired) note(box, "Gestão técnica pendente", "inspection-technical-pending");
        if (summary.total) { const progress = el("progress"); progress.max = summary.total; progress.value = summary.answered; progress.setAttribute("aria-label", `${summary.answered} de ${summary.total} itens respondidos`); box.append(progress); }
        note(box, summary.total ? `${summary.answered} de ${summary.total} itens respondidos` : "Checklist / pontos a confirmar", "inspection-progress-label");
        button(box, summary.action, () => go("execucao", inspection.id, inspection.contractId || route.contractId), "inspection-primary");
        assignment(box, inspection, access, reload);
      } else note(box, "A gestão deve planejar a atividade para habilitar a execução.");
      button(box, "Book e histórico", () => go("book", asset.id, route.contractId), "secondary inspection-book");
      parent.append(box);
    }
    function list(parent, route, mine = false, assetId) {
      const host = el("div", undefined, "inspection-workspace"); parent.append(host);
      host.append(el("h1", mine ? "Minhas inspeções" : assetId ? "Inspeções desta TAG" : "TAGs e atividades de inspeção"));
      const navigation = el("nav", undefined, "inspection-toolbar");
      if (!mine) button(navigation, "Minhas inspeções", () => go("minhas", "_", route.contractId));
      if (mine) button(navigation, "Sistemas e TAGs", () => go("sistemas", "_", route.contractId), "secondary");
      host.append(navigation);
      load(host, route, (access) => {
        if (mine && !access.professionalId) { note(host, "Sua conta ainda não está vinculada a um profissional do corpo técnico. A gestão deve conferir o cadastro existente."); return; }
        const search = input(host, "inspectionSearch", "Buscar TAG ou sistema", "search"), kind = input(host, "inspectionType", "Tipo de inspeção", "select");
        choice(kind, "", "Todos os tipos"); choice(kind, "visual", "Visual / LVT"); choice(kind, "espessura", "Espessura");
        const queue = input(host, "inspectionQueue", "Fila de acompanhamento", "select"); choice(queue, "", "Todas as situações"); choice(queue, "technical", "Pendências técnicas"); choice(queue, "review", "Enviadas para revisão"); choice(queue, "unassigned", "Não atribuídas");
        const grid = el("div", undefined, "inspection-grid"), count = note(host, ""), pager = el("nav", undefined, "inspection-toolbar"); let page = 0;
        pager.setAttribute("aria-label", "Páginas de inspeções");
        const previous = button(pager, "Página anterior", () => { page--; fill(); }, "secondary"), pageLabel = el("span"), next = button(pager, "Próxima página", () => { page++; fill(); }, "secondary"); pager.insertBefore(pageLabel, next);
        host.append(grid, pager);
        const fill = () => {
          grid.replaceChildren();
          const scope = records("contract").find((c) => c.id === route.contractId), systemId = route.view === "ativos" && route.itemId !== "_" ? route.itemId : null;
          const all = (access.inspections || []).filter((i) => (!route.contractId || i.contractId === route.contractId) && (!mine || i.assigneeProfessionalId === access.professionalId) && (!kind.value || i.type === kind.value) && (!queue.value || queue.value === "technical" && i.technicalReviewRequired === true || queue.value === "review" && i.executionStatus === "em_revisao" || queue.value === "unassigned" && !i.assigneeProfessionalId));
          const entries = [];
          for (const asset of records("asset")) {
            if (assetId && asset.id !== assetId || systemId && asset.systemId !== systemId || scope && !scope.assetIds?.includes(asset.id)) continue;
            const text = [asset.tag, asset.identification, records("system").find((s) => s.id === asset.systemId)?.name].join(" ").toLocaleLowerCase("pt-BR");
            if (!text.includes(search.value.trim().toLocaleLowerCase("pt-BR"))) continue;
            const activities = all.filter((i) => i.assetId === asset.id);
            for (const inspection of activities) entries.push({ asset, inspection });
            if (!activities.length && !mine && !kind.value && !queue.value && !(access.inspections || []).some((i) => i.assetId === asset.id && (!route.contractId || i.contractId === route.contractId))) entries.push({ asset, inspection: null });
          }
          const pages = Math.max(1, Math.ceil(entries.length / 12)); page = Math.max(0, Math.min(page, pages - 1));
          const reload = async () => { const key = contextKey(), fresh = await request("execution"); if (key !== contextKey() || !host.isConnected) return; Object.assign(access, fresh); fill(); };
          for (const { asset, inspection } of entries.slice(page * 12, page * 12 + 12)) card(grid, asset, inspection, access, route, reload);
          count.textContent = entries.length ? entries.length + " atividades / TAGs nesta seleção" : "Nenhuma inspeção nesta seleção.";
          pageLabel.textContent = `Página ${page + 1} de ${pages}`; previous.disabled = page === 0; next.disabled = page === pages - 1; pager.hidden = !entries.length;
        };
        search.oninput = () => { page = 0; fill(); }; kind.onchange = queue.onchange = () => { page = 0; fill(); }; fill();
        if (access.writeAllowed === false) note(host, "Seu acesso atual permite consulta. Executar e salvar inspeções exige autorização operacional da organização.", "inspection-access-note");
      }, "execution");
      return true;
    }
    function sourceCaption(source) {
      const locator = source?.locator || {};
      return [source?.fileName, locator.sheet && "Aba " + locator.sheet, locator.row && "Linha " + locator.row, locator.page && "Página " + locator.page, locator.section].filter(Boolean).join(" · ");
    }
    function execution(parent, route) {
      const host = el("div", undefined, "inspection-workspace"); parent.append(host);
      load(host, route, (detail, token, key) => drawExecution(host, route, detail, token, key), "execution/" + route.itemId);
      return true;
    }
    function drawExecution(host, route, detail, token, key) {
      if (route.contractId && detail.inspection?.contractId !== route.contractId) { fail(host, Error("A atividade pertence a outro contrato. Abra a inspeção no contrato correspondente.")); return; }
      const inspection = detail.inspection, execution = detail.execution, asset = records("asset").find((a) => a.id === inspection.assetId), catalog = detail.catalog || {}, editable = detail.canExecute === true && execution?.status !== "em_revisao";
      let currentExecution = execution;
      host.dataset.inspectionId = inspection.id;
      if (execution) host.dataset.executionId = execution.id;
      host.append(el("span", typeLabel(inspection.type), "inspection-eyebrow"), el("h1", asset?.tag || "Inspeção"));
      const navigation = el("nav", undefined, "inspection-toolbar");
      button(navigation, "Minhas inspeções", () => go("minhas", "_", inspection.contractId || route.contractId), "secondary");
      button(navigation, "Gestão de RTI", () => options.onInspectionNavigate?.("rtis", "fila", "_", ""), "secondary");
      if (execution && inspection.type === "visual" && typeof options.onInspectionReport === "function") {
        const feedback = el("p", undefined, "inspection-feedback"); feedback.setAttribute("role", "status");
        const report = button(navigation, "Conferir rascunho desta TAG", async () => {
          report.disabled = true; feedback.textContent = "Conferindo os últimos registros salvos desta execução…";
          try { await options.onInspectionReport({ inspectionId: inspection.id, executionId: currentExecution.id, executionVersion: currentExecution.version, inspectionVersion: inspection.version }); if (contextKey() === key && token === generation) feedback.textContent = "Conferência dos registros salvos preparada. Alterações não salvas na ficha não integram esta cópia."; }
          catch (error) { if (contextKey() === key && token === generation) feedback.textContent = error.message; }
          finally { if (report.isConnected) report.disabled = false; }
        }, "secondary"); navigation.append(feedback);
      }
      if (asset) button(navigation, "Book e histórico", () => go("book", asset.id, inspection.contractId || route.contractId), "secondary"); host.append(navigation);
      const identity = section(host, "1. Atividade e responsável");
      pairs(identity, [["Sistema", records("system").find((s) => s.id === asset?.systemId)?.name], ["Tipo da atividade", typeLabel(inspection.type)], ["Data planejada", inspection.plannedDate || inspection.planned], ["Inspetor responsável", inspection.assigneeName || "Não atribuído"], ["Situação", describe({ ...inspection, executionStatus: execution?.status }).status]]);
      assignment(identity, inspection, detail, () => options.onInspectionRefresh?.());
      if (!detail.canExecute) note(host, detail.executionBlockReason || (detail.writeAllowed === false ? "Seu acesso atual permite consulta. Salvar e enviar a inspeção exige autorização operacional da organização." : "A execução está disponível somente ao profissional atribuído à atividade."), "inspection-access-note");
      if (execution?.technicalReviewRequired) note(host, "Gestão técnica pendente: os itens sinalizados serão conferidos sem presumir uma condição ou recomendação.", "inspection-technical-pending");
      if (outcomes.has(inspection.id)) note(host, outcomes.get(inspection.id), "inspection-feedback").setAttribute("role", "status");
      if (!execution) {
        if (inspection.type === "visual" && (catalog.status !== "verified" || !catalog.items?.length)) note(host, catalog.reason || "O catálogo de LVT com fontes conferidas ainda não está disponível.", "inspection-catalog-pending");
        const start = button(host, "Iniciar inspeção", async () => {
          start.disabled = true;
          try { await write("execution-start", { inspectionId: inspection.id, expectedVersion: inspection.version }); if (contextKey() === key) { outcomes.set(inspection.id, "Rascunho criado. Ao continuar, este mesmo registro será aberto."); await options.onInspectionRefresh?.(); } }
          catch (error) { fail(host, error); } finally { if (start.isConnected) start.disabled = !detail.canExecute; }
        }, "inspection-primary");
        start.disabled = !detail.canExecute; return;
      }
      const form = el("form", undefined, "inspection-execution-form"); form.dataset.operation = "inspection-execution";
      const fields = section(form, inspection.type === "espessura" ? "2. Instrumento e leituras" : "2. Checklist por item"), date = input(fields, "observedOn", "Data da execução", "date", execution.observedOn);
      date.disabled = !editable;
      let getValues;
      if (inspection.type === "visual") getValues = visualItems(fields, detail, editable, { token, key });
      else if (inspection.type === "espessura") getValues = thickness(fields, detail, editable);
      else { note(fields, "O preenchimento desta modalidade ainda exige conferência da gestão técnica."); getValues = () => ({}); }
      const actions = section(form, "3. Salvar e encaminhar"), feedback = el("p", undefined, "inspection-feedback"); feedback.setAttribute("role", "status");
      if (execution.status === "em_revisao") note(actions, "Inspeção enviada para revisão técnica. A emissão e as assinaturas continuam pendentes.");
      else note(actions, "Salvar preserva o rascunho nesta atividade. Uma recomendação de tratativa abre a RTI vinculada automaticamente. Enviar para revisão não emite relatório e não encerra RTIs.");
      const save = el("button", "Salvar rascunho"), submit = el("button", "Enviar para revisão"); save.type = submit.type = "submit"; save.dataset.action = "save"; submit.dataset.action = "submit"; submit.className = "inspection-primary";
      save.disabled = submit.disabled = !editable;
      if (inspection.type === "visual" && (catalog.status !== "verified" || !catalog.items?.length)) submit.disabled = true;
      actions.append(save, submit, feedback); host.append(form);
      form.onsubmit = async (event) => {
        event.preventDefault(); if (!editable || currentExecution.status === "em_revisao" || contextKey() !== key || token !== generation) return;
        const send = event.submitter?.dataset.action === "submit"; save.disabled = submit.disabled = true;
        let refreshing = false;
        feedback.textContent = send ? "Salvando e enviando para revisão…" : "Salvando rascunho…";
        try {
          const values = getValues();
          if (["good_condition", "treatment_required"].includes(values.outcome) && !date.value) throw Error("Informe a data em que a inspeção foi realizada. Ela é o marco das recomendações.");
          let saved = await write("execution-save", { inspectionId: inspection.id, expectedVersion: currentExecution.version, observedOn: date.value || null, ...values });
          currentExecution = saved.execution;
          if (contextKey() !== key || token !== generation) return;
          if (send) { saved = await write("execution-submit", { inspectionId: inspection.id, expectedVersion: currentExecution.version }); currentExecution = saved.execution; }
          if (contextKey() !== key || token !== generation) return;
          outcomes.set(inspection.id, send ? "Enviada para revisão técnica. O registro da inspeção foi preservado." : saved.execution.technicalReviewRequired ? "Rascunho salvo. A pendência está disponível à gestão técnica na fila de inspeções." : detail.outcomeWorkflowVersion === 1 && saved.execution.outcome === "good_condition" ? "Declaração de boas condições e cobertura salva com suas fotografias. O relatório e a revisão técnica continuam pendentes." : detail.outcomeWorkflowVersion === 1 && saved.execution.outcome === "treatment_required" ? "Tratativa salva com a RTI vinculada para acompanhamento na Gestão de RTI. O prazo depende da política aprovada e da data da inspeção." : "Rascunho salvo. Continue pelo mesmo registro da atividade.");
          refreshing = true;
          await options.onInspectionRefresh?.();
        } catch (error) { feedback.textContent = refreshing ? (currentExecution.status === "em_revisao" ? "O envio para revisão foi confirmado. A atualização da tela falhou; recarregue a consulta." : "O rascunho foi salvo. A atualização da tela falhou; recarregue a consulta.") : error.message; }
        finally { if (form.isConnected) { const locked = !editable || currentExecution.status === "em_revisao"; save.disabled = locked; submit.disabled = locked || inspection.type === "visual" && (catalog.status !== "verified" || !catalog.items?.length); } }
      };
    }
    function visualItems(parent, detail, editable, guard) {
      const catalog = detail.catalog || {}, execution = detail.execution, controls = [], workflowEnabled = detail.outcomeWorkflowVersion === 1;
      let refreshOutcome = () => {};
      if (catalog.status !== "verified" || !catalog.items?.length) {
        note(parent, catalog.reason || "O catálogo de LVT com fontes conferidas ainda não está disponível.", "inspection-catalog-pending");
        note(parent, "A gestão técnica deve conferir o modelo e as frases dos originais antes de liberar o checklist. Nenhum item será marcado como bom por ausência de informação.");
        return () => ({ answers: [] });
      }
      note(parent, sourceCaption(catalog.source), "inspection-source");
      if (!workflowEnabled) note(parent, "Este backend ainda não habilitou os dois caminhos de resultado; conferência genérica somente. Não será declarada boa condição por ausência de recomendação.", "inspection-technical-pending inspection-outcome-unavailable");
      for (const item of catalog.items) {
        const prior = execution.answers?.find((answer) => answer.catalogItemId === item.id) || {}, shell = execution.items?.find((entry) => entry.catalogItemId === item.id),
          box = section(parent, `${item.itemKey} · ${item.component}`, "inspection-item"); box.dataset.itemKey = item.itemKey; box.dataset.catalogItemId = item.id;
        const condition = input(box, "conditionId", "Condição observada", "select"); choice(condition, "", "Selecione a condição deste item");
        for (const value of item.conditions || []) choice(condition, value.id, value.text);
        choice(condition, "__not_covered__", "Condição não contemplada · encaminhar à gestão técnica"); condition.value = prior.notCovered ? "__not_covered__" : prior.conditionId || "";
        const recommendation = input(box, "recommendationId", "Recomendação do catálogo", "select"); choice(recommendation, "", "Não selecionada");
        const recommendationOptions = [];
        for (const value of item.recommendations || []) recommendationOptions.push({ value, option: choice(recommendation, value.id, value.text) }); recommendation.value = prior.recommendationId || "";
        condition.disabled = recommendation.disabled = !editable;
        const point = workflowEnabled ? input(box, "pointLabel", "Ponto de campo · rótulo declarado", "text", prior.pointLabel || "") : el("input");
        if (!workflowEnabled) point.value = prior.pointLabel || "";
        point.maxLength = 200; point.disabled = !editable;
        point.placeholder = "Identifique o ponto observado, sem localização presumida";
        const pointRows = (detail.points || []).filter((entry) => entry.lvtItemId === shell?.lvtItemId && entry.inspectionId === detail.inspection.id && entry.executionId === execution.id),
          pointRecord = pointRows.length === 1 && (!prior.pointId || pointRows[0].id === prior.pointId) ? pointRows[0] : null;
        if (!point.value && pointRecord?.label) point.value = pointRecord.label;
        if (workflowEnabled) note(box, pointRecord ? "Referência de campo salva: " + pointRecord.label + ". A posição no desenho ainda está pendente de vínculo ao documento." : "O rótulo registra uma referência de campo. A posição no isométrico permanece pendente de conferência e vínculo ao documento.", "inspection-source inspection-point-reference");
        const provenance = note(box, "", "inspection-source"), pendingNote = note(box, "", "inspection-technical-pending"), recommendationNote = note(box, "", "inspection-note"), actionNote = note(box, "", "inspection-action-note");
        const update = () => {
          const unknown = condition.value === "__not_covered__";
          recommendation.disabled = !editable || unknown || !condition.value;
          for (const entry of recommendationOptions) entry.option.disabled = unknown || !condition.value || Array.isArray(entry.value.conditionIds) && !entry.value.conditionIds.includes(condition.value);
          const selected = recommendationOptions.find((entry) => entry.value.id === recommendation.value);
          if (recommendation.value && (!selected || selected.option.disabled)) { recommendation.value = ""; recommendationNote.textContent = unknown ? "" : "A recomendação anterior foi retirada. Selecione uma opção compatível com a condição observada."; }
          else recommendationNote.textContent = "";
          pendingNote.textContent = unknown ? "Ao salvar, este item fica pendente para a gestão técnica. Nenhuma condição será presumida." : "";
          provenance.textContent = [sourceCaption(item.conditions?.find((x) => x.id === condition.value)?.source), sourceCaption(item.recommendations?.find((x) => x.id === recommendation.value)?.source)].filter(Boolean).join(" · ");
          const selectedRecommendation = item.recommendations?.find((entry) => entry.id === recommendation.value);
          actionNote.textContent = !workflowEnabled && typeof selectedRecommendation?.requiresTreatment === "boolean" ? "Esta escolha exige o backend atualizado dos dois caminhos de resultado. A gravação desta seleção não está habilitada nesta versão." : selectedRecommendation?.requiresTreatment === true ? "Esta escolha exige tratativa: informe o ponto e anexe foto. Ao salvar, a mesma RTI será aberta ou atualizada automaticamente, sem duplicação." : selectedRecommendation?.requiresTreatment === false ? "Esta escolha documental foi classificada sem tratativa; ela não abre uma nova RTI." : workflowEnabled && selectedRecommendation ? "Esta recomendação precisa de conferência da gestão técnica para definir a tratativa. Mantenha o rascunho pendente; nenhum prazo será presumido." : "";
          point.setAttribute("aria-required", workflowEnabled && selectedRecommendation?.requiresTreatment === true ? "true" : "false");
          refreshOutcome();
        };
        condition.onchange = update; recommendation.onchange = update; update();
        const ownPhoto = (p) => p.lvtItemId === shell?.lvtItemId && p.assetId === detail.inspection.assetId && p.inspectionId === detail.inspection.id && p.lvtId === execution.id && p.contractId === detail.inspection.contractId && p.systemId === detail.inspection.systemId && p.campaignId === detail.inspection.campaignId && p.module === detail.inspection.module,
          photoRecords = new Map(records("photo").filter(ownPhoto).map((p) => [p.id, p])),
          photoIds = new Set([...(prior.photoIds || []), ...records("photo").filter((p) => p.lvtItemId === shell?.lvtItemId).map((p) => p.id)]), photoCount = note(box, photoIds.size + " foto(s) vinculada(s) a este item");
        if (typeof options.onPhoto === "function") for (const photo of records("photo").filter((p) => p.lvtItemId === shell?.lvtItemId)) {
          const image = el("img"); image.alt = photo.caption || "Fotografia do item " + item.itemKey; image.className = "inspection-item-photo"; image.hidden = true;
          const preview = button(box, "Ver fotografia do item", async () => { preview.disabled = true; try { const source = await options.onPhoto(photo); if (contextKey() !== guard.key || guard.token !== generation) return; image.src = source; image.hidden = false; } catch (error) { fail(box, error); } finally { if (preview.isConnected) preview.disabled = false; } }, "secondary"); box.append(image);
        }
        const files = input(box, "photos_" + item.id, "Fotografias deste item", "file"); files.accept = "image/jpeg,image/png"; files.multiple = true; files.disabled = !editable || !shell?.lvtItemId;
        const photoFeedback = note(box, "", "inspection-feedback"); photoFeedback.setAttribute("role", "status");
        const upload = button(box, "Anexar fotos do item", async () => {
          if (!editable || !shell?.lvtItemId || contextKey() !== guard.key || guard.token !== generation) return;
          upload.disabled = true; photoFeedback.textContent = "Anexando fotografias ao item…";
          try {
            if (!files.files?.length) throw Error("Selecione ao menos uma fotografia deste item.");
            for (const file of files.files) {
              if (!/\.(jpe?g|png)$/i.test(file.name) || file.size < 1 || file.size > 8 * 1024 * 1024) throw Error("Selecione fotografias JPEG/PNG de até 8 MiB cada.");
              if (!photoUploads.has(file)) photoUploads.set(file, await options.onInspectionPhoto(file));
              if (contextKey() !== guard.key || guard.token !== generation) return;
              const source = photoUploads.get(file), saved = await write("photos", { assetId: detail.inspection.assetId, lvtItemId: shell.lvtItemId, sourceId: source.id, locator: { section: "Item " + item.itemKey }, caption: "Item " + item.itemKey });
              photoIds.add(saved.id);
              if (ownPhoto(saved)) photoRecords.set(saved.id, saved);
            }
            photoCount.textContent = photoIds.size + " foto(s) vinculada(s) a este item"; files.value = ""; photoFeedback.textContent = workflowEnabled ? "Fotos vinculadas. Selecione abaixo as que documentam a cobertura e salve o rascunho." : "Fotos vinculadas. Salve o rascunho para registrar a seleção completa do item."; refreshOutcome(true);
          } catch (error) { photoFeedback.textContent = error.message; } finally { if (upload.isConnected) upload.disabled = !editable || !shell?.lvtItemId; }
        }, "secondary"); upload.disabled = !editable || !shell?.lvtItemId;
        controls.push({ item, condition, recommendation, point, photoIds, photoRecords });
      }
      const getOutcome = workflowEnabled ? visualOutcome(parent, detail, controls, editable) : () => ({}); refreshOutcome = getOutcome.refresh || (() => {});
      return () => ({ ...getOutcome(), answers: controls.map(({ item, condition, recommendation, point, photoIds }) => {
        const selectedRecommendation = item.recommendations?.find((entry) => entry.id === recommendation.value), pointLabel = point.value.trim();
        if (!workflowEnabled && typeof selectedRecommendation?.requiresTreatment === "boolean") throw Error("Este backend ainda não habilitou os dois caminhos de resultado. A seleção classificada exige atualização antes de gravar.");
        if (workflowEnabled && (pointLabel.length > 200 || /[\u0000-\u001f\u007f]/.test(pointLabel))) throw Error("Item " + item.itemKey + ": confirme um rótulo de ponto de até 200 caracteres.");
        if (workflowEnabled && selectedRecommendation?.requiresTreatment === true && !pointLabel) throw Error("Item " + item.itemKey + ": informe o ponto de campo da tratativa.");
        if (recommendation.value && (!workflowEnabled || selectedRecommendation?.requiresTreatment !== false) && !photoIds.size) throw Error("Item " + item.itemKey + ": anexe ao menos uma fotografia antes de salvar a recomendação de tratativa.");
        return { catalogItemId: item.id, itemKey: item.itemKey, conditionId: condition.value === "__not_covered__" ? null : condition.value || null, recommendationId: recommendation.value || null, notCovered: condition.value === "__not_covered__", photoIds: [...photoIds], ...(workflowEnabled ? { pointLabel: pointLabel || null } : {}) };
      }) });
    }
    function visualOutcome(parent, detail, controls, editable) {
      const execution = detail.execution, box = section(parent, "Resultado e cobertura da inspeção", "inspection-outcome"),
        outcome = input(box, "outcome", "Resultado declarado desta execução", "select");
      choice(outcome, "pending", "Ainda sem conclusão");
      const goodChoice = choice(outcome, "good_condition", "Boas condições no escopo declarado"), treatmentChoice = choice(outcome, "treatment_required", "Há recomendação de tratativa · abrir RTI");
      choice(outcome, "technical_review", "Encaminhar para gestão técnica");
      outcome.value = ["pending", "good_condition", "treatment_required", "technical_review"].includes(execution.outcome) ? execution.outcome : "pending";
      outcome.disabled = !editable;
      const resultNote = note(box, "", "inspection-outcome-status"); resultNote.setAttribute("role", "status");
      note(box, "Ausência de recomendação ou de RTI não comprova boas condições. A declaração depende das respostas e da classificação conferida no catálogo.");
      const savedCoverage = execution.coverage && typeof execution.coverage === "object" ? execution.coverage : {},
        extent = input(box, "coverageExtent", "Cobertura realmente inspecionada", "select");
      choice(extent, "", "Selecione a cobertura observada"); choice(extent, "declared_section", "Trecho declarado da linha"); choice(extent, "declared_entire_line", "Toda a linha · declaração do inspetor"); extent.value = savedCoverage.extent || ""; extent.disabled = !editable;
      const description = input(box, "coverageDescription", "Trecho, limites e restrições da cobertura · declaração", "textarea", savedCoverage.description || "");
      description.maxLength = 2000; description.rows = 3; description.placeholder = "Identifique o início, o fim e as limitações do trecho realmente inspecionado"; description.disabled = !editable;
      const coverageNote = note(box, "", "inspection-coverage-note");
      note(box, "Uma foto parcial não comprova a linha inteira. Se necessário, use várias fotos e declare somente o trecho realmente inspecionado.");
      const photoList = el("fieldset", undefined, "inspection-coverage-photos"), legend = el("legend", "Fotografias que documentam esta cobertura"); photoList.append(legend); box.append(photoList);
      const selectedPhotos = new Set(Array.isArray(savedCoverage.photoIds) ? savedCoverage.photoIds : []), photoSummary = note(box, "", "inspection-coverage-photo-summary"),
        emptyPhotos = el("p", "Anexe fotos aos itens e atualize a consulta para conferir seus vínculos, se necessário.", "inspection-note");
      note(box, "O prazo da tratativa depende da matriz Pires aprovada. Enquanto a política estiver pendente, a Gestão de RTI mantém prazo manual justificado, contado a partir da inspeção realizada.");
      const facts = () => controls.map((control) => ({ ...control,
        selectedCondition: control.item.conditions?.find((entry) => entry.id === control.condition.value),
        selectedRecommendation: control.item.recommendations?.find((entry) => entry.id === control.recommendation.value) }));
      const ownRtis = () => records("rti").filter((rti) => rti.executionId === execution.id || rti.lvtId === execution.id);
      const photoPool = () => {
        const pool = new Map();
        for (const control of controls) for (const [id, photo] of control.photoRecords) if (control.photoIds.has(id)) pool.set(id, { photo, item: control.item });
        return pool;
      };
      function refreshPhotoList() {
        for (const node of Array.from(photoList.children)) if (node !== legend) node.remove();
        const pool = photoPool(), ids = [...new Set([...pool.keys(), ...selectedPhotos])]; let index = 0;
        for (const id of ids) {
          const entry = pool.get(id), label = el("label", undefined, "inspection-photo-choice"), checkbox = el("input"),
            caption = entry ? "Item " + entry.item.itemKey + " · foto " + (++index) + (entry.photo.caption ? " · " + entry.photo.caption : "") : "Foto da cobertura salva · vínculo a conferir";
          checkbox.type = "checkbox"; checkbox.name = "coveragePhotoIds"; checkbox.value = id; checkbox.checked = selectedPhotos.has(id); checkbox.disabled = !editable;
          checkbox.onchange = () => { if (checkbox.checked) selectedPhotos.add(id); else selectedPhotos.delete(id); refresh(); };
          label.append(checkbox, el("span", caption)); if (!entry) label.classList.add("inspection-photo-unavailable"); photoList.append(label);
        }
        if (!ids.length) photoList.append(emptyPhotos);
      }
      function refresh(photosChanged = false) {
        const values = facts(), classified = values.every((entry) => !entry.selectedRecommendation || typeof entry.selectedRecommendation.requiresTreatment === "boolean"),
          good = values.length > 0 && values.every((entry) => entry.condition.value !== "__not_covered__" && entry.selectedCondition?.supportsGoodCondition === true && (!entry.selectedRecommendation || entry.selectedRecommendation.requiresTreatment === false)),
          treatment = values.some((entry) => entry.selectedRecommendation?.requiresTreatment === true),
          conditionReview = values.some((entry) => entry.selectedCondition && typeof entry.selectedCondition.supportsGoodCondition !== "boolean");
        goodChoice.disabled = !editable || !good || ownRtis().length > 0; treatmentChoice.disabled = !editable || !classified || !treatment;
        if (ownRtis().length) resultNote.textContent = "Há RTI preservada desta execução. Uma retirada de recomendação não a apaga nem permite declarar boas condições automaticamente; encaminhe à gestão técnica.";
        else if (!classified) resultNote.textContent = "Uma recomendação ainda precisa de conferência da gestão técnica para definir a tratativa. Mantenha o rascunho pendente ou encaminhe à gestão técnica.";
        else if (conditionReview && outcome.value !== "treatment_required") resultNote.textContent = "As condições selecionadas ainda precisam de conferência da gestão técnica para liberar uma declaração de boas condições.";
        else if (!good && outcome.value === "good_condition") resultNote.textContent = "Boas condições exige resposta de todos os itens com suporte explícito no catálogo, sem condição não contemplada ou tratativa.";
        else if (outcome.value === "good_condition") resultNote.textContent = "A declaração de boas condições exige cobertura explícita e ao menos uma fotografia vinculada. Revisão e emissão técnicas permanecem pendentes.";
        else if (outcome.value === "treatment_required") resultNote.textContent = "Cada recomendação de tratativa abre ou atualiza a RTI vinculada ao item, ponto de campo, fotos, TAG e inspeção. Sem vencimento automático presumido.";
        else resultNote.textContent = "Nenhum resultado de boas condições foi presumido. Selecione o resultado somente após conferir os itens.";
        coverageNote.textContent = extent.value === "declared_entire_line" ? "Você está declarando cobertura de toda a linha. Essa escolha não é inferida da quantidade ou aparência das fotos; confirme os limites e as evidências." : extent.value === "declared_section" ? "O relatório deve identificar somente o trecho declarado, com suas limitações e fotografias." : "Cobertura ainda não declarada; uma fotografia não preenche este campo automaticamente.";
        photoSummary.textContent = selectedPhotos.size ? selectedPhotos.size + " foto(s) selecionada(s) explicitamente para a cobertura." : "Nenhuma fotografia selecionada para a cobertura.";
        if (photosChanged) refreshPhotoList();
      }
      outcome.onchange = extent.onchange = () => refresh();
      const getValues = () => {
        const values = facts(), selectedOutcome = outcome.value, selectedIds = [...selectedPhotos], pool = photoPool(),
          hasCoverage = Boolean(extent.value || description.value.trim() || selectedIds.length);
        if (selectedIds.some((id) => !pool.has(id))) throw Error("Uma fotografia da cobertura não está conferida nesta execução. Atualize os vínculos ou retire explicitamente essa seleção.");
        if (hasCoverage && (!["declared_section", "declared_entire_line"].includes(extent.value) || !description.value.trim())) throw Error("Declare a cobertura e descreva o trecho, os limites e as restrições realmente inspecionados.");
        if (description.value.trim().length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description.value)) throw Error("A descrição da cobertura deve ter até 2000 caracteres válidos.");
        if (["good_condition", "treatment_required"].includes(selectedOutcome) && values.some((entry) => entry.selectedRecommendation && typeof entry.selectedRecommendation.requiresTreatment !== "boolean")) throw Error("A classificação de tratativa das recomendações selecionadas precisa ser conferida no catálogo.");
        if (selectedOutcome === "good_condition") {
          if (!values.length || values.some((entry) => entry.condition.value === "__not_covered__" || entry.selectedCondition?.supportsGoodCondition !== true || entry.selectedRecommendation && entry.selectedRecommendation.requiresTreatment !== false)) throw Error("Boas condições exige todos os itens respondidos com suporte explícito do catálogo e sem tratativa.");
          if (ownRtis().length) throw Error("A RTI desta execução permanece preservada para revisão. Ela não pode ser apagada para declarar boas condições.");
          if (!hasCoverage || !selectedIds.length) throw Error("Boas condições exige cobertura declarada e ao menos uma fotografia vinculada. Use várias fotos quando necessário.");
        }
        if (selectedOutcome === "treatment_required" && !values.some((entry) => entry.selectedRecommendation?.requiresTreatment === true)) throw Error("Selecione uma recomendação explicitamente classificada como tratativa no catálogo.");
        return { outcome: selectedOutcome, coverage: hasCoverage ? { extent: extent.value, description: description.value.trim(), photoIds: selectedIds } : null };
      };
      getValues.refresh = refresh; refresh(true); return getValues;
    }
    function thickness(parent, detail, editable) {
      const instrument = input(parent, "instrument", "Instrumento utilizado", "text", detail.execution.instrument); instrument.disabled = !editable;
      note(parent, "Registre a identificação dos pontos que consta no desenho ou procedimento. Posições angulares e numeração não são preenchidas automaticamente.");
      const rows = [], list = el("div", undefined, "inspection-readings"); parent.append(list);
      const add = (value = {}) => {
        const row = el("div", undefined, "inspection-reading"), point = input(row, "point", "Ponto documentado", "text", value.point), measured = input(row, "value", "Leitura", "text", value.value), unit = input(row, "unit", "Unidade", "select");
        measured.inputMode = "decimal"; choice(unit, "", "Selecione"); choice(unit, "mm", "mm"); choice(unit, "in", "in"); unit.value = value.unit || "";
        point.disabled = measured.disabled = unit.disabled = !editable;
        const entry = { point, measured, unit, row }; rows.push(entry);
        if (editable) button(row, "Retirar leitura", () => { rows.splice(rows.indexOf(entry), 1); row.remove(); }, "secondary"); list.append(row);
      };
      for (const value of detail.execution.readings || []) add(value);
      if (editable) button(parent, "Adicionar leitura identificada no desenho", () => add(), "secondary");
      note(parent, "O relatório de espessura é separado do relatório visual da TAG. Salvar leituras não conclui atividades visuais ou pendentes.");
      return () => ({ instrument: instrument.value.trim() || null, readings: rows.map(({ point, measured, unit }) => ({ point: point.value.trim(), value: measured.value.trim(), unit: unit.value })) });
    }
    function render(parent, route) {
      if (!enabled() || route.module !== "integridade") return false;
      if (route.view === "minhas") return list(parent, route, true);
      if (route.view === "execucao") return execution(parent, route);
      if (route.view === "lvt") return list(parent, route, false, route.itemId === "_" ? null : route.itemId);
      return false;
    }
    return Object.freeze({ enabled, render, renderAssetList(parent, route) { return enabled() ? list(parent, route) : false; }, invalidate() { generation++; } });
  }
  return Object.freeze({ typeLabel, describe, create });
});
