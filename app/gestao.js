"use strict";
(() => {
  const initialRouteHash = window.location.hash;
  let initialRouteRestored = false;
  const $ = (id) => document.getElementById(id),
    N = window.IntegrityNR13,
    accountMode = window.PIRES_CONFIG?.mode === "connected",
    connectedMode = accountMode && window.PIRES_CONFIG?.gestao?.backend === "supabase",
    authOnlyMode = accountMode && !connectedMode;
  let connected = null, connectedError = null, flow = null, operational = null, activeModule = "", authOnlyTenant = null,
    accountGrant = null, accountUserId = null, connectedCapabilities = {};
  if (accountMode) {
    try {
      if (!window.PiresGestaoConnected) throw Error("Adaptador da Gestão conectada indisponível.");
      connected = connectedMode
        ? window.PiresGestaoConnected.create(window.PIRES_CONFIG)
        : window.PiresGestaoConnected.createAccount(window.PIRES_CONFIG);
    } catch (error) { connectedError = error; }
  }
  const names = {
    integridade: "Gestão de Integridade",
    nr13: "Gestão de NR-13",
    valvulas: "Certificação de Válvulas",
    rtis: "Acompanhamento de RTIs",
  };
  const types = {
    linha: "Linha",
    segmento: "Segmento",
    vaso: "Vaso",
    caldeira: "Caldeira",
    tanque: "Tanque",
    valvula: "Válvula",
    outro: "Outro",
  };
  const operations = {
    em_operacao: "Em operação",
    fora_de_operacao: "Fora de operação",
    descontinuado: "Descontinuado",
    nao_informado: "Não informado",
  };
  const statuses = {
    pendente: "Pendente",
    em_elaboracao: "Em elaboração",
    em_revisao: "Em revisão",
    devolvido: "Devolvido para correção",
    aprovado: "Aprovado",
    substituido: "Substituído por nova revisão",
  };
  let state = null, ownerList = [],
    company = "",
    page = 1,
    contract = "",
    scope = "",
    stateRequest = 0;
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function msg(text, error = false) {
    $("message").textContent = text;
    $("message").className = error ? "notice error" : "notice";
  }
  function requireLogin() {
    stateRequest++;
    state = null;
    company = "";
    ownerList = [];
    $("login").hidden = false;
    $("workspace").hidden = true;
    $("tenantAccess").hidden = true;
    $("logout").hidden = true;
    if (connected?.setTenant) connected.setTenant(null);
    authOnlyTenant = null;
    accountGrant = null; accountUserId = null;
    connectedCapabilities = {};
    $("tools").replaceChildren();
    $("company").replaceChildren();
    for (const id of ["systems", "assets", "contracts", "indicators"]) $(id).replaceChildren();
    flow?.reset();
  }
  async function api(route, body) {
    if (authOnlyMode) throw Error("O cadastro operacional não está disponível nesta etapa de avaliação das telas. Nenhuma gravação foi realizada.");
    if (connectedMode) {
      if (connectedError) throw connectedError;
      try { return await connected.request(route, body); }
      catch (error) {
        if ([401, 403].includes(error.status)) requireLogin();
        throw error;
      }
    }
    const r = await fetch("/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Pires-Request": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await r.json();
    if (r.status === 401) {
      requireLogin();
      throw Error(result.error);
    }
    if (!r.ok) throw Error(result.error);
    return result;
  }
  const path = (tail) =>
    "companies/" + encodeURIComponent(company) + "/" + tail;
  function button(text, fn, parent, cls) {
    const b = el("button", text, cls);
    b.type = "button";
    b.onclick = () =>
      Promise.resolve()
        .then(fn)
        .catch((e) => { if (e.status === 401) requireLogin(); msg(e.message, true); });
    parent?.append(b);
    return b;
  }
  function options(select, items, empty) {
    select.replaceChildren();
    if (empty !== undefined) select.append(new Option(empty, ""));
    for (const [value, label] of items) select.append(new Option(label, value));
  }
  const show = (v) =>
    v === undefined || v === null || v === "" ? "Não informado" : String(v);
  function dl(parent, pairs) {
    const d = el("dl");
    for (const [k, v] of pairs) {
      d.append(el("dt", k), el("dd", show(v)));
    }
    parent.append(d);
  }
  function form(parent, title, fields, submit, label = "Salvar") {
    const box = el("details");
    box.open = !parent.closest("#detail");
    box.append(el("summary", title));
    const f = el("form"),
      grid = el("div", undefined, "formgrid"),
      controls = {};
    for (const field of fields) {
      const l = el("label", field.label),
        input = el(
          field.options ? "select" : field.area ? "textarea" : "input",
        );
      input.name = field.key;
      if (field.options) options(input, field.options, field.empty);
      else if (!field.area) input.type = field.type || "text";
      if (field.value !== undefined) input.value = field.value;
      input.required = field.required !== false;
      if (field.type === "number") {
        input.min = "1";
        input.step = "1";
      }
      l.append(input);
      grid.append(l);
      controls[field.key] = input;
    }
    f.append(grid);
    const b = el("button", label);
    f.append(b);
    f.onsubmit = async (e) => {
      e.preventDefault();
      b.disabled = true;
      try {
        await submit(
          Object.fromEntries(
            Object.entries(controls).map(([k, v]) => [k, v.value]),
          ),
          controls,
        );
      } catch (err) {
        msg(err.message, true);
      } finally {
        b.disabled = false;
      }
    };
    box.append(f);
    parent.append(box);
    return { box, controls, f };
  }
  function tool(title) {
    $("tools").replaceChildren();
    const p = el("section", undefined, "panel");
    p.append(el("h2", title));
    button("Fechar", () => p.remove(), p, "secondary");
    $("tools").append(p);
    p.scrollIntoView({ block: "start" });
    return p;
  }
  function table(parent, headers, rows) {
    const wrap = el("div", undefined, "scroll"),
      t = el("table"),
      head = el("thead"),
      tr = el("tr");
    headers.forEach((h) => tr.append(el("th", h)));
    head.append(tr);
    t.append(head);
    const body = el("tbody");
    rows.forEach((row) => {
      const r = el("tr");
      row.forEach((v) => r.append(el("td", show(v))));
      body.append(r);
    });
    t.append(body);
    wrap.append(t);
    parent.append(wrap);
  }
  async function load() {
    if (authOnlyMode) return loadAccountWorkspace();
    if (connectedMode && !connected?.getTenant()) return;
    const request = ++stateRequest;
    if (connectedMode) {
      const status = await api("status");
      if (request !== stateRequest) return;
      connectedCapabilities = {...status.capabilities, preparedSources: status.preparedSources || []};
      connectedPermissions(connectedCapabilities.write === true);
    }
    const list = await api("companies");
    if (request !== stateRequest) return;
    ownerList = list;
    if (connectedMode && !initialRouteRestored) {
      initialRouteRestored = true;
      const requested = window.PiresGestaoFlow?.parseHash(initialRouteHash);
      if (requested && list.some(c => c.id === requested.clientId)) {
        company = requested.clientId;
        window.history.replaceState(null, "", initialRouteHash);
      }
    }
    options(
      $("company"),
      list.map((c) => [
        c.id,
        c.displayName ? c.displayName + " · fonte: " + c.name : c.name,
      ]),
      "Selecione a empresa",
    );
    if (company && list.some((c) => c.id === company))
      $("company").value = company;
    else company = "";
    $("login").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    if (company) {
      const nextState = await api(path("state"));
      if (request !== stateRequest) return;
      state = nextState;
      render();
    } else {
      state = null;
      ["systems", "assets", "contracts", "indicators"].forEach((id) =>
        $(id).replaceChildren(),
      );
      $("assets").append(
        el(
          "p",
          "Nenhuma empresa selecionada. Importe a fonte conferida ou cadastre com referência.",
        ),
      );
      $("detail").hidden = true;
    }
    if (!company) flow?.render();
  }
  async function loadAccountWorkspace() {
    const request = ++stateRequest, tenant = authOnlyTenant;
    accountGrant = null;
    $("workspace").hidden = true;
    if (!tenant) return;
    try {
      const grant = await connected.access(tenant);
      if (request !== stateRequest || tenant !== authOnlyTenant) return;
      if (!grant.allowed || grant.company_id !== tenant || grant.company_role === "client" || typeof grant.user_id !== "string")
        throw Error(grant.message || "O acesso a esta empresa não está autorizado.");
      if (accountUserId && accountUserId !== grant.user_id) {
        state = null; company = "";
        flow?.reset();
      }
      accountUserId = grant.user_id;
      accountGrant = { userId: grant.user_id, tenant, generation: request };
      state = null; company = "";
      $("company").replaceChildren(new Option("Cadastro de clientes indisponível nesta etapa", ""));
      $("login").hidden = true;
      $("workspace").hidden = false;
      $("logout").hidden = false;
      connectedPermissions(false);
      msg("Acesso confirmado. Escolha um dos quatro módulos para avaliar as telas. Nenhum cliente ou ativo está selecionado.");
      flow?.render();
    } catch (error) {
      if (request === stateRequest) {
        accountGrant = null; state = null; company = "";
        $("workspace").hidden = true;
        flow?.reset();
        if (error.status === 401) requireLogin();
      }
      throw error;
    }
  }
  async function connectedStart() {
    if (authOnlyMode) {
      const request = ++stateRequest;
      accountGrant = null;
      $("workspace").hidden = true;
      const user = await connected.user();
      if (request !== stateRequest) return;
      if (!user?.email_confirmed_at) { requireLogin(); throw Error("Entre com sua conta do aplicativo."); }
      if (accountUserId && accountUserId !== user.id) { authOnlyTenant = null; flow?.reset(); }
      accountUserId = user.id;
      const list = await connected.companies();
      if (request !== stateRequest) return;
      options($("tenant"), list.map((tenant) => [tenant.id, tenant.name]), "Selecione a empresa de acesso");
      authOnlyTenant = list.some((tenant) => tenant.id === authOnlyTenant) ? authOnlyTenant : list.length === 1 ? list[0].id : null;
      $("tenant").value = authOnlyTenant || "";
      $("tenantAccess").hidden = false;
      $("login").hidden = true;
      $("logout").hidden = false;
      $("workspace").hidden = true;
      if (authOnlyTenant) await loadAccountWorkspace();
      else msg(list.length ? "Selecione a empresa de acesso para avaliar as telas." : "Esta conta não possui empresa de acesso disponível.");
      return;
    }
    await api("status");
    let list;
    try { list = await connected.tenants(); }
    catch (error) { if (error.status === 401) requireLogin(); throw error; }
    const selected = connected.getTenant();
    options($("tenant"), list.map((t) => [t.id, t.name]), "Selecione a empresa de acesso");
    const id = list.some((t) => t.id === selected) ? selected : list.length === 1 ? list[0].id : null;
    connected.setTenant(id);
    $("tenant").value = id || "";
    $("tenantAccess").hidden = false;
    $("login").hidden = true;
    $("logout").hidden = false;
    $("workspace").hidden = true;
    if (id) await load();
    else msg(list.length ? "Selecione a empresa de acesso para consultar os ativos." : "Esta conta não possui empresa de acesso disponível para Gestão de Ativos.");
  }
  function connectedPermissions(write) {
    for (const id of ["newCompany", "newAsset", "importButton"])
      $(id).disabled = !write;
    $("connectedWriteNotice").hidden = write;
    if (connectedMode) $("rtiFilter").disabled = false;
  }
  async function refresh() {
    if (authOnlyMode) return loadAccountWorkspace();
    if (!company) return load();
    const request = ++stateRequest,
      nextState = await api(path("state"));
    if (request !== stateRequest) return;
    state = nextState;
    render();
  }
  function systemOptions(selected = "") {
    const unit = $("unitFilter").value,
      list = state.system.filter((s) => !unit || s.unitId === unit);
    options($("systemFilter"), list.map((s) => [s.id, s.name]), "Todos");
    $("systemFilter").value = list.some((s) => s.id === selected) ? selected : "";
  }
  function render() {
    const filters = ["unitFilter", "systemFilter", "typeFilter"].map((id) => [
      id,
      $(id).value,
    ]);
    options(
      $("unitFilter"),
      state.unit.map((u) => [u.id, u.name]),
      "Todas",
    );
    const unit = filters.find((x) => x[0] === "unitFilter")[1];
    $("unitFilter").value = state.unit.some((u) => u.id === unit) ? unit : "";
    systemOptions(filters.find((x) => x[0] === "systemFilter")[1]);
    options($("typeFilter"), Object.entries(types).filter(([key]) => !connectedMode || ["linha", "segmento"].includes(key)), "Todos");
    $("typeFilter").value = filters.find((x) => x[0] === "typeFilter")[1];
    systems();
    contracts();
    assets();
    if (!$("detail").hidden) detail($("detail").dataset.assetId, false);
    flow?.render();
  }
  function systems() {
    const p = $("systems");
    p.replaceChildren();
    for (const s of state.system) {
      const list = state.asset.filter((a) => a.systemId === s.id && belongsToModule(a)),
        card = el("article", undefined, "card");
      card.append(
        el("h3", s.name),
        el("p", state.unit.find((u) => u.id === s.unitId)?.name),
        el(
          "p",
          `${list.filter((a) => a.type === "linha").length} linhas · ${list.filter((a) => a.type === "segmento").length} segmentos · ${list.filter((a) => !["linha", "segmento"].includes(a.type)).length} equipamentos`,
        ),
      );
      if (s.coverage) card.append(el("p", s.coverage, "muted"));
      button(
        "Abrir sistema",
        () => {
          $("unitFilter").value = s.unitId;
          systemOptions(s.id);
          page = 1;
          assets();
        },
        card,
      );
      p.append(card);
    }
  }
  function belongsToModule(asset) {
    if (!activeModule) return true;
    if (activeModule === "valvulas") return asset.type === "valvula";
    if (activeModule === "nr13") return asset.type !== "valvula" && window.PiresAssetCards?.describe(asset, state).nr13.scope === "covered";
    return asset.type !== "valvula";
  }
  function selectedAssets() {
    const q = $("search").value.toLocaleLowerCase("pt-BR"),
      u = $("unitFilter").value,
      s = $("systemFilter").value,
      t = $("typeFilter").value,
      r = $("rtiFilter").value;
    return state.asset.filter((a) => {
      const open = window.PiresAssetCards?.describe(a, state).rti.open === true;
      return (
        belongsToModule(a) &&
        (!q ||
          `${a.tag} ${a.segment || ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(q)) &&
        (!u || a.unitId === u) &&
        (!s || a.systemId === s) &&
        (!t || a.type === t) &&
        (!contract ||
          state.contract
            .find((c) => c.id === contract)
            ?.assetIds.includes(a.id)) &&
        (!r || (r === "open" ? open : !open))
      );
    });
  }
  function assets() {
    const p = $("assets");
    p.replaceChildren();
    p.classList.toggle("nr13-card-grid", activeModule === "nr13");
    if (!state) return;
    const list = selectedAssets(),
      pages = Math.max(1, Math.ceil(list.length / 12));
    if (!list.some((a) => a.id === $("detail").dataset.assetId))
      $("detail").hidden = true;
    page = Math.min(page, pages);
    for (const a of list.slice((page - 1) * 12, page * 12)) {
      const entry = el("div", undefined, "asset-entry"),
        card = el("article", undefined, "card asset-card"),
        description = window.PiresAssetCards?.describe(a, state);
      card.dataset.assetId = a.id;
      if (description) {
        const operation = el("div", description.operation.label, "operation-indicator");
        operation.dataset.tone = description.operation.tone;
        operation.dataset.assetId = a.id;
        operation.classList.toggle("animated", description.operation.animated);
        if (description.operation.reason) {
          operation.title = description.operation.reason;
          operation.append(el("span", description.operation.reason, "operation-reason"));
        }
        card.classList.toggle("has-open-rti", description.rti.open);
        entry.append(operation);
      }
      if (activeModule === "nr13" && description) {
        card.classList.add("nr13-asset-card", "flow-module-card");
        const heading = el("div", undefined, "asset-card-heading");
        const symbol = el("span", "▤", "module-symbol"); symbol.setAttribute("aria-hidden", "true"); heading.append(symbol);
        heading.append(el("span", types[a.type], "eyebrow"), el("h3", a.tag));
        const scope = el("p", description.nr13.scopeLabel, "nr13-status");
        scope.dataset.scope = description.nr13.scope;
        card.append(heading, scope);
        dl(card, [
          ["Unidade", state.unit.find(u => u.id === a.unitId)?.name || "A confirmar"],
          ["Fluido", description.nr13.fluid],
          ["Pressão de operação", description.nr13.operatingPressure || "A confirmar"],
          ["Classe de pressão", description.nr13.pressureClass || "Não informada"],
          ["Classe do fluido", description.nr13.fluidClass || "A confirmar"],
          ...(a.type === "tanque" ? [["Volume", description.nr13.volume || "A confirmar"]] : [["Categoria NR-13", description.nr13.categoryLabel]]),
          ["Próxima inspeção", description.nr13.nextInspectionDate || "Prazo a definir"],
        ]);
        const pending = el("div", undefined, "asset-book-summary");
        pending.append(el("strong", description.book.pending.length ? `${description.book.pending.length} pendências cadastradas no book` : description.book.statusLabel),
          el("span", description.book.inspectionLabel), el("span", description.rti.label));
        card.append(pending);
      } else {
      card.append(el("h3", a.tag), el("span", types[a.type], "badge"));
      const op = el("p", operations[a.operation] || "Não informado");
      card.append(op, el("p", "Condição técnica: Não avaliado", "badge"));
      const rtis = state.rti.filter((r) => r.assetId === a.id);
      for (const r of rtis) {
        const summary = window.PiresAssetCards?.describeRti(r);
        const n = el(
          "p",
          `RTI: ${r.title} · fonte: ${summary?.sourceStatus || r.sourceStatus || r.status || "Situação não informada"} · ${summary?.currentnessLabel || "Atualidade desconhecida / registro histórico"} · ${r.sourceDate || "Data da fonte não informada"} · ${r.due ? "Prazo documentado: " + r.due : "Prazo não informado"}`,
        );
        if (summary?.open) n.prepend(el("span", undefined, "light red"));
        card.append(n);
      }
      const sys = state.system.find((s) => s.id === a.systemId),
        unit = state.unit.find((u) => u.id === a.unitId);
      dl(card, [
        ["Empresa", state.company.displayName || state.company.name],
        ["Unidade", unit?.name],
        ["Sistema", sys?.name],
        ["Segmento", a.segment],
        ...(!["linha", "segmento", "valvula"].includes(a.type)
          ? [
              [
                "Enquadramento",
                description?.nr13.scopeLabel || "Não avaliado",
              ],
              [
                "Justificativa do enquadramento",
                state.classification
                  .filter((c) => c.assetId === a.id)
                  .at(-1)
                  ?.result.criteria?.map((c) => c.join(": "))
                  .join("; "),
              ],
              [
                "Classe do fluido",
                description?.nr13.fluidClass,
              ],
              [
                "Categoria",
                description?.nr13.categoryLabel || "Pendente de confirmação",
              ],
            ]
          : []),
        ...technicalPairs(a),
        [
          "Situação documental",
          state.document.some(
            (d) =>
              d.assetId === a.id &&
              /relat[oó]rio/i.test(d.type) &&
              state.revision.some(
                (r) => r.documentId === d.id && r.attachments.length,
              ),
          )
            ? "Consultar book e revisões"
            : "Sem relatório no sistema",
        ],
        ...[
              ["Última inspeção interna", last(a.id, "interna")],
              ["Próxima inspeção interna", due(a.id, "interna")],
              ["Última inspeção externa", last(a.id, "externa")],
              ["Próxima inspeção externa", due(a.id, "externa")],
            ],
        ...(a.source?.format === "pdf_control"
          ? [
              [
                "Inspeção visual informada no controle",
                last(a.id, "visual", true),
              ],
              [
                "Medição de espessura informada no controle",
                last(a.id, "espessura", true),
              ],
            ]
          : []),
      ]);
      }
      if (connectedMode && connectedCapabilities.operations && activeModule === "integridade") {
        button("Abrir LVT desta TAG", () => flow.navigate("integridade", "lvt", a.id, contract), card);
        button("Consultar book", () => flow.navigate("integridade", "book", a.id, contract), card, "secondary");
      } else button(activeModule === "nr13" ? "Abrir book e pendências" : "Abrir card e book", () => flow ? flow.navigate(activeModule || "integridade", "book", a.id, contract) : detail(a.id), card, activeModule === "nr13" ? "module-access" : undefined);
      entry.append(card);
      p.append(entry);
    }
    if (!list.length) p.append(el("p", "Nenhum ativo nesta seleção."));
    $("pageLabel").textContent =
      `Página ${page} de ${pages} · ${list.length} ativos`;
    $("previous").disabled = page === 1;
    $("next").disabled = page === pages;
  }
  function technicalPairs(a) {
    const keys = [
      "fluid",
      "volume",
      "temperature",
      "operationPressure",
      "designPressure",
      "pmta",
      "material",
      "diameter",
      "thickness",
      "minimumThickness",
    ];
    const visible = ["linha", "segmento"].includes(a.type)
      ? keys.filter(
          (k) =>
            a.technical[k]?.value !== null &&
            a.technical[k]?.value !== undefined,
        )
      : keys;
    return visible.length
      ? visible.map((k) => {
          const v = a.technical[k];
          return [
            fieldLabel(k),
            v && v.value !== null
              ? `${show(v.value)} ${v.unit || ""}`
              : "Não informado",
          ];
        })
      : [["Dados técnicos", "Não informados na fonte recebida"]];
  }
  function last(id, type, brief = false) {
    const i = state.inspection
      .filter((i) => i.assetId === id && i.type === type && i.done)
      .sort((a, b) => b.done.localeCompare(a.done))[0];
    return i
      ? `${i.done} · ${brief ? "informado no controle, sem relatório" : i.executionSource}`
      : "Não informado";
  }
  function due(id, type) {
    const d = state.deadline
      .filter((d) => d.assetId === id && d.type === type)
      .at(-1);
    return d
      ? `${d.due} · ${d.due < new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) ? "Vencido" : "Prazo registrado"} · ${d.clause} (${d.normVersion})`
      : "Prazo pendente de definição";
  }
  const fieldLabel = (k) =>
    ({
      tag: "TAG",
      segment: "Segmento / repetição",
      fluid: "Fluido",
      material: "Material",
      diameter: "Diâmetro",
      volume: "Volume",
      temperature: "Temperatura",
      operationPressure: "Pressão de operação",
      designPressure: "Pressão de projeto",
      pmta: "PMTA",
      thickness: "Espessura",
      minimumThickness: "Espessura mínima",
      operation: "Condição operacional na fonte",
    })[k] || k;
  function contracts() {
    const p = $("contracts");
    p.replaceChildren(el("h2", "Contratos e escopos"));
    if (connectedMode) return;
    const sel = el("select");
    options(
      sel,
      state.contract.filter((c) => !activeModule || c.modules.includes(activeModule)).map((c) => [c.id, c.name]),
      "Todos os ativos (sem filtro por contrato)",
    );
    sel.value = contract;
    sel.onchange = () => {
      if (flow && activeModule) return flow.navigate(activeModule, "ativos", "_", sel.value);
      contract = sel.value;
      scope = "";
      page = 1;
      assets();
      contracts();
    };
    p.append(sel);
    if (contract) {
      const con = state.contract.find((c) => c.id === contract);
      if (!con) {
        contract = "";
        return contracts();
      }
      const sub = el("select");
      options(
        sub,
        con.modules.filter((m) => !activeModule || m === activeModule).map((m) => [m, names[m]]),
        "Todos os submódulos contratados",
      );
      sub.value = scope;
      sub.onchange = () => {
        scope = sub.value;
        indicators();
      };
      p.append(
        sub,
        el(
          "p",
          "RTI é um submódulo da Gestão de Ativos. O vínculo contratual referencia os ativos existentes e preserva seu histórico.",
        ),
      );
    }
    button(
      "Vincular contrato real",
      () => {
        const box = tool("Contrato e ativos atendidos");
        const { controls, f } = form(
          box,
          "Identificação do contrato",
          [
            { key: "name", label: "Identificação contratual" },
            { key: "source", label: "Documento / referência do contrato" },
          ],
          async (b) => {
            b.assetIds = [...f.querySelectorAll("[data-asset]:checked")].map(
              (n) => n.value,
            );
            b.modules = [...f.querySelectorAll("[data-module]:checked")].map(
              (n) => n.value,
            );
            await api(path("contracts"), b);
            box.remove();
            await refresh();
          },
        );
        for (const [key, label] of Object.entries(names)) {
          const l = el("label", label),
            i = el("input");
          i.type = "checkbox";
          i.value = key;
          i.dataset.module = "1";
          l.prepend(i);
          f.insertBefore(l, f.lastChild);
        }
        const all = el("details");
        all.append(el("summary", "Selecionar ativos já cadastrados"));
        for (const a of state.asset) {
          const l = el(
              "label",
              a.tag +
                " · " +
                state.system.find((s) => s.id === a.systemId)?.name,
            ),
            i = el("input");
          i.type = "checkbox";
          i.value = a.id;
          i.dataset.asset = "1";
          l.prepend(i);
          all.append(l);
        }
        f.insertBefore(all, f.lastChild);
      },
      p,
    );
    indicators().catch((e) => msg(e.message, true));
  }
  async function indicators() {
    const p = $("indicators");
    p.replaceChildren(el("h2", "Produção e pendências por contrato / escopo"));
    if (!contract) {
      p.append(
        el(
          "p",
          "Selecione um contrato real para consultar indicadores. Sem planejamento registrado, metas e percentuais permanecem indefinidos.",
        ),
      );
      return;
    }
    const current = contract,
      m = scope,
      data = await api(
        path("metrics") +
          "?contract=" +
          encodeURIComponent(contract) +
          "&module=" +
          encodeURIComponent(scope),
      );
    if (current !== contract || m !== scope) return;
    const labels = {
      planned: "Inspeções previstas",
      executed: "Inspeções realizadas",
      pending: "Inspeções pendentes",
      dailyTarget: "Meta diária (planejamento)",
      dailyProduction: "Produção diária registrada",
      expectedReports: "Relatórios esperados (inspeções realizadas)",
      deliveredReports: "Relatórios entregues",
      pendingReports: "Relatórios pendentes",
      inspectionBacklog: "Backlog de inspeções vencidas",
      reportBacklog: "Backlog de relatórios não entregues",
      openRTIs: "RTIs abertas",
    };
    const metrics = el("div", undefined, "metrics");
    for (const [k, label] of Object.entries(labels)) {
      const d = el("div", undefined, "metric");
      d.append(
        el("span", label),
        el("strong", data[k] === null ? "Não informado" : String(data[k])),
      );
      metrics.append(d);
    }
    p.append(
      metrics,
      el(
        "p",
        "Execução, entrega de relatório e aprovação documental são eventos separados. Produção registrada não afirma completude do levantamento.",
      ),
    );
    p.append(el("h3", "Curva S · quantidades acumuladas"));
    if (!data.curve.length || data.planned === null)
      p.append(
        el(
          "p",
          "Sem planejamento suficiente para comparar curvas prevista e realizada.",
        ),
      );
    else {
      const ns = "http://www.w3.org/2000/svg",
        svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 800 260");
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        "Curva S prevista e realizada; valores disponíveis na tabela",
      );
      const max = Math.max(
        1,
        ...data.curve.flatMap((r) => [r.planned || 0, r.done]),
      );
      for (const [key, color] of [
        ["planned", "#123e53"],
        ["done", "#ad6a09"],
      ]) {
        const line = document.createElementNS(ns, "polyline");
        line.setAttribute(
          "points",
          data.curve
            .map(
              (r, i) =>
                `${35 + (i * 730) / Math.max(1, data.curve.length - 1)},${225 - (r[key] * 195) / max}`,
            )
            .join(" "),
        );
        line.setAttribute("stroke", color);
        line.setAttribute("fill", "none");
        line.setAttribute("stroke-width", "3");
        svg.append(line);
      }
      p.append(
        el(
          "p",
          "Azul: prevista · dourado: realizada (quantidades, sem percentuais inventados)",
        ),
        svg,
      );
      table(
        p,
        ["Data", "Prevista acumulada", "Realizada acumulada"],
        data.curve.map((r) => [r.day, r.planned, r.done]),
      );
    }
  }
  async function detail(id, scroll = true) {
    const p = $("detail"),
      a = state.asset.find((a) => a.id === id);
    if (!a) {
      p.hidden = true;
      return;
    }
    p.dataset.assetId = id;
    p.hidden = false;
    p.replaceChildren(el("h2", a.tag + (connectedMode ? " · cadastro e origem" : " · book individual")));
    button("Fechar card", () => (p.hidden = true), p, "secondary");
    dl(p, [
      ["Empresa", state.company.displayName || state.company.name],
      ["Unidade", state.unit.find((u) => u.id === a.unitId)?.name],
      ["Sistema", state.system.find((s) => s.id === a.systemId)?.name],
      ["Tipo", types[a.type]],
      ["Operação", operations[a.operation]],
      ["Fonte da operação", a.operationEvidence],
      ["Condição técnica", "Não avaliado"],
      ...(!connectedMode ? [
        ["Inspeção interna anterior", last(id, "interna")],
        ["Inspeção interna próxima", due(id, "interna")],
        ["Inspeção externa anterior", last(id, "externa")],
        ["Inspeção externa próxima", due(id, "externa")],
      ] : []),
    ]);
    dl(
      p,
      Object.entries(a.technical).map(([k, v]) => [
        fieldLabel(k),
        `${show(v.value)} ${v.unit || ""} · fonte: ${typeof v.source === "string" ? v.source : JSON.stringify(v.source)}`,
      ]),
    );
    if (state.company.displayName)
      dl(p, [
        ["Nome histórico preservado", state.company.name],
        ["Confirmação da relação entre os nomes", state.company.aliasEvidence],
        [
          "Logo oficial",
          "Pendente de arquivo oficial; não foi usada a logo do prestador",
        ],
      ]);
    const origin = el("details");
    origin.append(
      el("summary", "Arquivo, aba, linha, mapeamento e unidades de origem"),
      el("pre", JSON.stringify(a.source, null, 2) || "Não informado"),
    );
    p.append(origin);
    if (a.source?.sourceId) {
      if (connectedMode) {
        button("Baixar documento original de origem", async () => {
          const { blob, name } = await connected.download(path("sources/" + a.source.sourceId)),
            url = URL.createObjectURL(blob), link = el("a");
          link.href = url;
          link.download = name;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, p);
      } else {
        const link = el("a", "Baixar documento original de origem");
        link.href = "/api/" + path("sources/" + a.source.sourceId);
        p.append(link);
      }
    }
    if (connectedMode) {
      p.append(el("p", "Este modo conectado cobre cadastro de linhas e importação XLSX rastreável. Book documental, enquadramento, prazos, execução, entregas e RTIs ainda não estão disponíveis. Nenhuma aprovação técnica é inferida pelo cadastro.", "notice"));
      button("Histórico do cadastro", () => history(id, p), p, "secondary");
      if (scroll) p.scrollIntoView({ block: "start" });
      return;
    }
    if (a.source?.format === "pdf_control") {
      dl(p, [
        ["Início informado no controle", a.source.raw.inspectionStartRaw],
        ["Término informado no controle", a.source.raw.inspectionEndRaw],
        ["Inspeção visual informada", last(id, "visual")],
        ["Medição de espessura informada", last(id, "espessura")],
        ["Marcação isométrico no controle", a.source.raw.isometric],
        ["Progresso da linha no controle", a.source.raw.progressRaw],
      ]);
      p.append(
        el(
          "p",
          "Marcações do controle não equivalem à entrega dos relatórios ou do isométrico, nem à aprovação técnica.",
          "notice",
        ),
      );
    }
    form(
      p,
      "Registrar situação operacional",
      [
        {
          key: "operation",
          label: "Situação",
          options: Object.entries(operations),
          value: a.operation,
        },
        { key: "evidence", label: "Fonte / evidência" },
      ],
      async (b) => {
        await api(path(`assets/${id}/operation`), b);
        await refresh();
        detail(id);
      },
    );
    const cls = state.classification.filter((c) => c.assetId === id);
    p.append(el("h3", "Gestão de NR-13 · enquadramento e revisão"));
    p.append(
      el(
        "p",
        "Enquadramento, classe do fluido e categoria são campos distintos. Não há aplicação automática da NR-13 a todos os equipamentos. O motor é o mesmo das calculadoras; caldeiras e casos fora do motor exigem análise específica.",
      ),
    );
    if (!cls.length)
      dl(p, [
        ["Enquadramento", "Não avaliado"],
        ["Justificativa", "Não informado"],
        ["Classe de fluido", "Não informado"],
        ["Categoria", "Não informado"],
      ]);
    for (const c of cls) {
      const box = el("div", undefined, "book");
      dl(box, [
        ["Situação", c.result.scope],
        [
          "Justificativa",
          c.result.criteria?.map((x) => x.join(": ")).join("\n"),
        ],
        ["Classe do fluido", c.result.fluidClass],
        ["Categoria", c.result.category],
        ["Revisão", c.reviewStatus],
        ["Motor", c.engineVersion],
        ["Fonte", c.evidence],
      ]);
      const d = el("details");
      d.append(
        el("summary", "Entradas, referências, critérios e ressalvas"),
        el("pre", JSON.stringify(c, null, 2)),
      );
      box.append(d);
      if (c.reviewStatus === "pendente")
        form(
          box,
          "Revisão do enquadramento",
          [
            {
              key: "status",
              label: "Decisão",
              options: [
                ["revisado", "Revisado"],
                ["devolvido", "Devolver para correção"],
              ],
            },
            { key: "reason", label: "Justificativa" },
          ],
          async (b) => {
            await api(path(`classifications/${c.id}/review`), b);
            await refresh();
            detail(id);
          },
        );
      p.append(box);
    }
    const latest = cls.at(-1);
    if (latest?.result.requirements?.length) {
      const refs = el("details");
      refs.append(
        el(
          "summary",
          "Referências documentais indicadas pelo enquadramento (validar aplicabilidade)",
        ),
      );
      latest.result.requirements.forEach((r) => refs.append(el("p", r)));
      p.append(refs);
    }
    button(
      "Enquadrar com o motor existente",
      () => classificationForm(p, a),
      p,
    );
    const saved = el("details");
    saved.append(
      el("summary", "Vincular avaliação NR-13 salva pela calculadora"),
    );
    const label = el("label", "Arquivo JSON da avaliação"),
      file = el("input");
    file.type = "file";
    file.accept = ".json";
    label.append(file);
    saved.append(label);
    const evidenceLabel = el("label", "Arquivo / referência da avaliação"),
      evidence = el("input");
    evidenceLabel.append(evidence);
    saved.append(evidenceLabel);
    button(
      "Importar avaliação para revisão",
      async () => {
        if (!file.files[0] || file.files[0].size > 2 * 1024 * 1024)
          throw Error("Selecione JSON de até 2 MB.");
        const snapshot = JSON.parse(await file.files[0].text());
        await api(path(`assets/${id}/classify`), {
          inputs: snapshot.inputs,
          snapshot,
          evidence: evidence.value,
        });
        await refresh();
        detail(id);
      },
      saved,
    );
    p.append(saved);
    button(
      "Registrar prazo técnico com referência",
      () => deadlineForm(p, a, cls),
      p,
    );
    p.append(
      el("h3", "Book e revisões documentais"),
      el(
        "p",
        "Os documentos aplicáveis devem ser definidos para este ativo e seu enquadramento. Não há lista universal. Anexar um documento não o aprova. Decisões são declarações do operador identificado, sem assinatura digital ou verificação de habilitação.",
      ),
    );
    form(
      p,
      "Adicionar item aplicável ao book",
      [
        {
          key: "module",
          label: "Submódulo do book",
          options: Object.entries(names),
        },
        {
          key: "type",
          label:
            "Documento (prontuário, registro, relatório, projeto, certificado ou outro)",
        },
        {
          key: "basis",
          label: "Justificativa de aplicabilidade e item normativo / critério",
        },
      ],
      async (b) => {
        await api(path("documents"), { ...b, assetId: id });
        await refresh();
        detail(id);
      },
    );
    for (const doc of state.document.filter((d) => d.assetId === id)) {
      const b = el("article", undefined, "panel book");
      b.append(
        el("h3", doc.type),
        el("p", doc.basis),
        el("p", "Aplicabilidade: " + doc.applicability),
      );
      form(
        b,
        "Validar aplicabilidade deste item",
        [
          {
            key: "status",
            label: "Decisão de aplicabilidade",
            options: [
              ["aplicavel", "Aplicável"],
              ["nao_aplicavel", "Não aplicável"],
            ],
          },
          { key: "basis", label: "Fundamentação e referência específica" },
          {
            key: "classificationId",
            label: "Enquadramento revisado (obrigatório no submódulo NR-13)",
            options: cls
              .filter((c) => c.reviewStatus === "revisado")
              .map((c) => [c.id, c.id]),
            empty: "Não se aplica ao submódulo",
            required: false,
          },
        ],
        async (x) => {
          await api(path(`documents/${doc.id}/applicability`), x);
          await refresh();
          detail(id);
        },
      );
      form(
        b,
        "Abrir nova revisão",
        [{ key: "revision", label: "Revisão" }],
        async (x) => {
          await api(path("revisions"), { ...x, documentId: doc.id });
          await refresh();
          detail(id);
        },
      );
      for (const rev of state.revision.filter((r) => r.documentId === doc.id)) {
        const r = el("div", undefined, "panel");
        r.append(
          el("h4", `${rev.revision} · ${statuses[rev.status]}`),
          el(
            "p",
            `Responsável: ${rev.responsible} · criação: ${rev.createdAt}`,
          ),
        );
        if (rev.decision)
          r.append(
            el("p", `${rev.decisionBy} · ${rev.decisionAt} · ${rev.decision}`),
          );
        for (const att of rev.attachments) {
          const link = el("a", att.name);
          link.href = "/api/" + path("attachments/" + att.id);
          r.append(link, el("p", "SHA-256: " + att.sha256, "muted"));
        }
        if (!["aprovado", "substituido"].includes(rev.status)) {
          const label = el(
              "label",
              "Anexar arquivo (até 10 MB; permanece pendente de revisão)",
            ),
            input = el("input");
          input.type = "file";
          label.append(input);
          r.append(label);
          button(
            "Gravar anexo",
            async () => {
              if (!input.files[0]) throw Error("Selecione o arquivo.");
              await api(path(`revisions/${rev.id}/attach`), {
                name: input.files[0].name,
                base64: await base64(input.files[0]),
              });
              await refresh();
              detail(id);
            },
            r,
          );
          const flow = {
            pendente: ["em_elaboracao"],
            em_elaboracao: ["em_revisao"],
            em_revisao: ["aprovado", "devolvido"],
            devolvido: ["em_elaboracao"],
          };
          form(
            r,
            "Alterar etapa desta revisão",
            [
              {
                key: "status",
                label: "Próxima etapa",
                options: (flow[rev.status] || []).map((s) => [s, statuses[s]]),
              },
              { key: "reason", label: "Motivo e evidência da decisão" },
            ],
            async (x) => {
              await api(path(`revisions/${rev.id}/transition`), x);
              await refresh();
              detail(id);
            },
          );
        }
        button(
          "Histórico desta revisão",
          () => history(rev.id, r),
          r,
          "secondary",
        );
        b.append(r);
      }
      p.append(b);
    }
    p.append(el("h3", "RTIs vinculadas"));
    for (const rti of state.rti.filter((r) => r.assetId === id)) {
      const b = el("div", undefined, "notice");
      b.append(
        el(
          "p",
          `${rti.title} · ${rti.status} · ${rti.due || "Prazo não definido"} · ${rti.source}`,
        ),
      );
      if (rti.status === "aberta")
        form(
          b,
          "Encerrar RTI com evidência",
          [{ key: "evidence", label: "Evidência de atendimento / decisão" }],
          async (b) => {
            await api(path(`rtis/${rti.id}/close`), b);
            await refresh();
            detail(id);
          },
        );
      p.append(b);
    }
    form(
      p,
      "Registrar RTI aberta",
      [
        { key: "title", label: "Identificação / descrição" },
        { key: "source", label: "Fonte da RTI" },
        {
          key: "due",
          label: "Vencimento definido",
          type: "date",
          required: false,
        },
        {
          key: "contractId",
          label: "Contrato com RTIs no escopo",
          options: state.contract
            .filter(
              (c) => c.modules.includes("rtis") && c.assetIds.includes(id),
            )
            .map((c) => [c.id, c.name]),
          empty: "Sem vínculo contratual",
          required: false,
        },
      ],
      async (b) => {
        await api(path("rtis"), { ...b, assetId: id });
        await refresh();
        detail(id);
      },
    );
    button(
      "Registrar planejamento / execução comprovada",
      () => inspectionForm(p, a),
      p,
    );
    button("Registrar entrega de relatório", () => deliveryForm(p, a), p);
    button("Histórico do cadastro", () => history(id, p), p, "secondary");
    if (scroll) p.scrollIntoView({ block: "start" });
  }
  async function history(id, p) {
    const data = await api(path("history/" + id)),
      box = el("details");
    box.open = true;
    box.append(
      el("summary", "Histórico · responsável, instante e versão registrada"),
      el("pre", JSON.stringify(data, null, 2)),
    );
    p.append(box);
  }
  function classificationForm(p, a) {
    form(
      p,
      "Enquadramento rastreável (motor das calculadoras)",
      [
        {
          key: "nrProfile",
          empty: "Selecione conforme a fonte",
          label: "Tipo / perfil documentado",
          options: N.CATALOG.map((c) => [c.id, c.name]),
        },
        {
          key: "nrMaterialKind",
          label: "Natureza construtiva",
          options: [
            ["unknown", "Não informado"],
            ["metal", "Metálico"],
            ["prfv", "PRFV"],
            ["other", "Outro"],
          ],
        },
        {
          key: "nrExclusion",
          label: "Revisão das exclusões",
          options: [
            ["unknown", "Pendente"],
            ["none", "Nenhuma identificada"],
            ...N.EXCLUSIONS.map((x) => [x[0], x[1]]),
          ],
        },
        { key: "nrDiameter", label: "Diâmetro informado", required: false },
        {
          key: "nrDiameterUnit",
          empty: "Selecione conforme a fonte",
          label: "Unidade de diâmetro",
          options: [
            ["mm", "mm"],
            ["m", "m"],
          ],
        },
        { key: "nrVolume", label: "Volume", required: false },
        {
          key: "nrVolumeUnit",
          empty: "Selecione conforme a fonte",
          label: "Unidade de volume",
          options: [
            ["m3", "m³"],
            ["L", "L"],
          ],
        },
        {
          key: "nrPressure",
          label: "Pressão de operação (não é PMTA nem pressão de projeto)",
          required: false,
        },
        {
          key: "nrPressureUnit",
          empty: "Selecione conforme a fonte",
          label: "Unidade da pressão",
          options: [
            ["kPa", "kPa"],
            ["bar", "bar"],
            ["MPa", "MPa"],
          ],
        },
        {
          key: "nrFluid",
          empty: "Selecione conforme a fonte",
          label: "Fluido / perigos (fundamentar)",
          options: [
            ["other", "Outro (conferir perigos)"],
            ["air", "Ar comprimido"],
            ["flammable", "Inflamável"],
            ["toxic", "Tóxico"],
            ["steam", "Vapor de água"],
          ],
        },
        {
          key: "nrToxicLimit",
          label: "Limite de tolerância toxicológica (ppm), se aplicável",
          required: false,
        },
        { key: "nrFluidSource", label: "Composição / FDS e fonte dos perigos" },
        {
          key: "nrRegime",
          label: "Regime documentado",
          options: [
            ["positive", "Pressão positiva"],
            ["vacuum", "Vácuo"],
            ["both", "Ambos"],
          ],
        },
        {
          key: "nrSupport",
          label: "Apoio do tanque, se aplicável",
          options: [
            ["unknown", "Não informado"],
            ["ground", "Apoiado no solo"],
            ["legs", "Pernas"],
            ["saddles", "Selas"],
            ["buried", "Enterrado"],
            ["structural", "Estrutural"],
          ],
        },
        {
          key: "nrTankDefinition",
          label: "Definição de tanque confirmada?",
          options: [
            ["unknown", "Não confirmado"],
            ["yes", "Sim, com fundamentação"],
          ],
        },
        { key: "evidence", label: "Referência e dados utilizados", area: true },
      ],
      async (b) => {
        const evidence = b.evidence;
        delete b.evidence;
        b.nrHead = "unknown";
        b.nrSource = evidence;
        await api(path(`assets/${a.id}/classify`), { inputs: b, evidence });
        await refresh();
        detail(a.id);
      },
    );
  }
  function deadlineForm(p, a, cls) {
    form(
      p,
      "Prazo definido pelo responsável (sem intervalo universal)",
      [
        {
          key: "classificationId",
          label: "Enquadramento revisado",
          options: cls
            .filter((c) => c.reviewStatus === "revisado")
            .map((c) => [c.id, c.id]),
        },
        {
          key: "type",
          label: "Inspeção",
          options: [
            ["interna", "Interna"],
            ["externa", "Externa"],
          ],
        },
        { key: "normVersion", label: "Versão aplicável da NR-13 / código" },
        { key: "clause", label: "Item normativo" },
        {
          key: "inputData",
          label: "Dados técnicos e categoria utilizados",
          area: true,
        },
        {
          key: "conditions",
          label: "Condições especiais e sua avaliação",
          area: true,
        },
        {
          key: "basis",
          label: "Justificativa / referência técnica do prazo",
          area: true,
        },
        { key: "start", label: "Marco inicial comprovado", type: "date" },
        { key: "due", label: "Data limite definida", type: "date" },
      ],
      async (b) => {
        await api(path("deadlines"), { ...b, assetId: a.id });
        await refresh();
        detail(a.id);
      },
    );
  }
  function inspectionForm(p, a) {
    const { controls } = form(
      p,
      "Inspeção · planejamento separado da execução",
      [
        {
          key: "id",
          label: "Registro planejado existente (ou novo registro)",
          options: state.inspection
            .filter((i) => i.assetId === a.id && !i.done)
            .map((i) => [
              i.id,
              `${i.type} · ${i.planned || "Sem data"} · ${state.contract.find((c) => c.id === i.contractId)?.name}`,
            ]),
          empty: "Novo registro",
          required: false,
        },
        {
          key: "contractId",
          label: "Contrato (se documentado)",
          options: state.contract
            .filter((c) => c.assetIds.includes(a.id))
            .map((c) => [c.id, c.name]),
          empty: "Sem vínculo contratual",
          required: false,
        },
        {
          key: "module",
          label: "Submódulo contratado",
          options: Object.entries(names),
        },
        {
          key: "type",
          label: "Tipo",
          options: [
            ["visual", "Visual (não presumir inspeção externa NR-13)"],
            ["interna", "Interna"],
            ["externa", "Externa"],
            ["espessura", "Espessura"],
            ["valvula", "Válvula"],
            ["outra", "Outra"],
          ],
        },
        {
          key: "planned",
          label: "Data prevista (se documentada)",
          type: "date",
          required: false,
        },
        {
          key: "planningSource",
          label: "Fonte do planejamento",
          required: false,
        },
        {
          key: "done",
          label: "Data executada (se comprovada)",
          type: "date",
          required: false,
        },
        {
          key: "executionSource",
          label: "Evidência de execução",
          required: false,
        },
      ],
      async (b) => {
        await api(path("inspections"), { ...b, assetId: a.id });
        await refresh();
        detail(a.id);
      },
    );
    controls.id.onchange = () => {
      const prior = state.inspection.find((i) => i.id === controls.id.value && i.assetId === a.id);
      for (const key of ["contractId", "module", "type", "planned", "planningSource", "done", "executionSource"])
        controls[key].value = prior?.[key] || ({ module: "integridade", type: "visual" }[key] || "");
      for (const key of ["contractId", "module", "type"])
        controls[key].disabled = Boolean(prior);
    };
  }
  function deliveryForm(p, a) {
    form(
      p,
      "Entrega documental (não equivale à aprovação)",
      [
        {
          key: "inspectionId",
          label: "Inspeção executada",
          options: state.inspection
            .filter((i) => i.assetId === a.id && i.done)
            .map((i) => [i.id, `${i.type} · ${i.done}`]),
        },
        {
          key: "revisionId",
          label: "Revisão de relatório com anexo",
          options: state.revision
            .filter((r) => r.assetId === a.id && r.attachments.length)
            .map((r) => [
              r.id,
              `${state.document.find((d) => d.id === r.documentId)?.type} · ${r.revision} · ${statuses[r.status]}`,
            ]),
        },
        { key: "delivered", label: "Data de entrega", type: "date" },
        { key: "source", label: "Comprovante / referência de entrega" },
      ],
      async (b) => {
        await api(path("deliveries"), b);
        await refresh();
        detail(a.id);
      },
    );
  }
  async function base64(file) {
    if (file.size > 20 * 1024 * 1024) throw Error("Arquivo excede 20 MB.");
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    return data.split(",")[1];
  }
  $("importButton").onclick = () => {
    const p = tool("Importação conferida · arquivo, aba, sistema e linhas");
    p.append(
      el(
        "p",
        connectedMode
          ? "O modo conectado aceita somente XLSX. PDF e XLS ainda não estão disponíveis. Confira empresa dona dos ativos, unidade, sistema, faixa e mapeamento antes de confirmar. Uma aba não é presumida como um sistema."
          : "Aceita XLSX e PDF de controle Execution Control. Outros PDFs exigem conferência separada. Uma aba não é presumida como um sistema. Confira cabeçalhos, unidade e conteúdo. Repetições de TAG são preservadas por linha de origem; alterações em uma fonte já importada exigem revisão.",
      ),
    );
    const input = el("input");
    input.type = "file";
    input.accept = connectedMode ? ".xlsx" : ".xlsx,.pdf";
    p.append(input);
    button(
      "Ler arquivo e abas",
      async () => {
        if (!input.files[0]) throw Error(connectedMode ? "Anexe um arquivo XLSX." : "Anexe XLSX ou PDF de controle.");
        if (connectedMode && !/\.xlsx$/i.test(input.files[0].name))
          throw Error("O modo conectado aceita somente XLSX. PDF e XLS ainda não estão disponíveis.");
        if (connectedMode && (input.files[0].size < 1 || input.files[0].size > (connectedCapabilities.xlsxMaxBytes || 8 * 1024 * 1024)))
          throw Error("A importação de listas XLSX aceita arquivos de até 8 MiB. Originais documentais usam o fluxo de documentos, sem interpretação automática.");
        const source = await api("sources", {
          name: input.files[0].name,
          base64: await base64(input.files[0]),
        });
        if (source.format === "pdf_control") pdfMapping(p, source);
        else importMapping(p, source);
      },
      p,
    );
  };
  function pdfMapping(parent, source) {
    const m = source.metadata;
    parent.append(
      el("h3", "Prévia do controle PDF"),
      el(
        "p",
        `Empresa histórica: ${m.companyName} · local: ${m.location} · sistema no título: ${m.system}`,
      ),
    );
    table(
      parent,
      ["Item do PDF", ...m.columns],
      source.sheets[0].rows.map((r) => [r.row, ...r.values]),
    );
    const f = form(
      parent,
      "Confirmar unidade, identidade documental e nome de apresentação",
      [
        {
          key: "sourceIdentity",
          label: "Identidade estável do documento",
          value: source.name,
        },
        {
          key: "companyId",
          label: "Cadastro histórico de destino",
          options: [
            ["", "Criar cadastro histórico separado"],
            ...Array.from($("company").options)
              .filter((o) => o.value)
              .map((o) => [o.value, o.textContent]),
          ],
          required: false,
        },
        { key: "unit", label: "Unidade / plataforma confirmada pelo usuário" },
        {
          key: "systemEvidence",
          label:
            "Fonte da unidade e da confirmação do sistema (sem inferir código)",
        },
        {
          key: "brandName",
          label:
            "Nome atual de apresentação, somente se a relação for confirmada",
          required: false,
        },
        {
          key: "brandEvidence",
          label: "Confirmação expressa da relação entre nomes",
          required: false,
        },
      ],
      async (b) => {
        const p = await api("import/preview", {
          ...b,
          sourceId: source.id,
          companyName: m.companyName,
          system: m.system,
        });
        const box = el("div", undefined, "panel");
        box.append(
          el("h3", `${p.rows.length} TAGs preenchidos para conferência`),
        );
        table(
          box,
          ["Item do PDF", "TAG", "Ação da reimportação"],
          p.rows.map((r) => [r.row, r.values.tag, r.action]),
        );
        p.warnings.forEach((w) => box.append(el("p", w, "notice")));
        const blockers = p.blockers || [];
        blockers.forEach((w) => box.append(el("p", w, "notice error")));
        const check = el("input");
        check.type = "checkbox";
        const label = el(
          "label",
          "Conferi os TAGs, a unidade e o sistema do PDF.",
        );
        label.prepend(check);
        box.append(label);
        const commitButton = button(
          "Gravar os registros conferidos do PDF",
          async () => {
            if (blockers.length) throw Error("Resolva os bloqueios da prévia antes de gravar.");
            if (!check.checked)
              throw Error("Confirme a conferência da prévia.");
            commitButton.disabled = true;
            try {
              const result = await api("import/commit", {
                previewId: p.id,
                confirm: true,
              });
              company = result.company.id;
              parent.remove();
              await load();
              msg(
                `${result.inserted} registros novos; ${result.unchanged} inalterados. Fonte PDF preservada; sem contrato inventado.`,
              );
            } finally {
              commitButton.disabled = blockers.length > 0;
            }
          },
          box,
        );
        commitButton.disabled = blockers.length > 0;
        parent.append(box);
      },
    );
  }
  function importMapping(parent, source) {
    const panel = el("div");
    parent.append(panel);
    const select = el("select");
    options(
      select,
      source.sheets.map((s) => [s.name, `${s.name} · ${s.maxRow} linhas`]),
    );
    panel.append(select);
    const raw = el("div");
    panel.append(raw);
    const draw = () => {
      raw.replaceChildren();
      const s = source.sheets.find((s) => s.name === select.value);
      raw.append(el("h3", "Conteúdo da aba (primeiras 70 linhas não vazias)"));
      const max = Math.min(s.maxColumn, 30);
      table(
        raw,
        ["Linha", ...Array.from({ length: max }, (_, i) => colName(i))],
        s.rows
          .slice(0, 70)
          .map((r) => [
            r.row,
            ...Array.from({ length: max }, (_, i) => r.values[i]),
          ]),
      );
    };
    select.onchange = draw;
    draw();
    const fields = [
      {
        key: "sourceIdentity",
        label: "ID estável da fonte (ID do Drive ou identificação documental)",
      },
      {
        key: "companyName",
        label: connectedMode ? "Nome do cliente destino (conferido no cadastro)" : "Nome exato da empresa que consta na fonte",
        value: connectedMode ? state?.company.name || "" : undefined,
      },
      {
        key: "companyCell",
        label: "Célula que comprova o nome da empresa (ex.: B2)",
      },
      {
        key: "companyId",
        label: "Destino",
        options: state
          ? [["", "Criar cadastro separado (sem união automática)"], ...[]]
          : [],
        required: false,
      },
      { key: "unit", label: "Unidade / plataforma (nome conferido)" },
      { key: "system", label: "Sistema conferido no conteúdo" },
      {
        key: "systemEvidence",
        label:
          "Referência de confirmação do sistema (célula / documento / confirmação do usuário)",
      },
      { key: "start", label: "Primeira linha de dados", type: "number" },
      { key: "end", label: "Última linha de dados", type: "number" },
      {
        key: "type",
        label: "O que cada linha representa?",
        options: [
          ["linha", "Linha de tubulação"],
          ["segmento", "Segmento de uma linha"],
        ],
      },
    ];
    if (connectedMode) fields.splice(2, 0,
      { key: "sourceCompanyName", label: "Nome literal da empresa na célula original (preservado)" },
      { key: "ownerMappingEvidence", label: "Confirmação da correspondência com o cliente (obrigatória quando os nomes diferem)", required: false },
    );
    fields.find((f) => f.key === "companyId").options = [
      ["", "Criar empresa separada"],
      ...Array.from($("company").options)
        .filter((o) => o.value)
        .map((o) => [o.value, o.textContent]),
    ];
    const { controls, f } = form(
      panel,
      "Mapeamento e contexto de uma faixa completa",
      fields,
      async (b) => {
        const mapping = {},
          units = {};
        for (const [k, control] of Object.entries(mapControls)) {
          if (control.col.value.trim())
            mapping[k] = control.col.value.trim().toUpperCase();
          if (control.unit?.value.trim()) units[k] = control.unit.value.trim();
        }
        const currentPreview = await api("import/preview", {
          ...b,
          sourceId: source.id,
          sheet: select.value,
          mapping,
          units,
        });
        const box = el("div", undefined, "panel");
        box.append(
          el(
            "h3",
            `Prévia · ${currentPreview.rows.length} registros da faixa ${b.start}–${b.end}`,
          ),
        );
        currentPreview.warnings.forEach((w) => box.append(el("p", w, "notice")));
        const blockers = currentPreview.blockers || [];
        blockers.forEach((w) => box.append(el("p", w, "notice error")));
        const keys = Object.keys(currentPreview.mapping);
        table(
          box,
          [
            "Linha de origem",
            "Ação",
            ...keys.map(
              (k) =>
                fieldLabel(k) +
                (currentPreview.units[k] ? " (" + currentPreview.units[k] + ")" : ""),
            ),
          ],
          currentPreview.rows.map((r) => [
            r.row,
            r.action,
            ...keys.map((k) => r.values[k]),
          ]),
        );
        const check = el("input");
        check.type = "checkbox";
        const label = el(
          "label",
          "Conferi a empresa, unidade, sistema, faixa completa e repetições legítimas.",
        );
        label.prepend(check);
        box.append(label);
        const commitButton = button(
          "Confirmar gravação desta prévia",
          async () => {
            if (blockers.length) throw Error("Resolva os bloqueios da prévia antes de gravar.");
            if (!check.checked) throw Error("Confira e confirme a prévia.");
            commitButton.disabled = true;
            try {
              const result = await api("import/commit", {
                previewId: currentPreview.id,
                confirm: true,
              });
              company = result.company.id;
              parent.remove();
              await load();
              msg(
                `Gravados ${result.inserted} novos registros; ${result.unchanged} inalterados. Empresa ${result.company.name}, unidade ${result.unit.name}, sistema ${result.system.name}.`,
              );
            } finally {
              commitButton.disabled = blockers.length > 0;
            }
          },
          box,
        );
        commitButton.disabled = blockers.length > 0;
        panel.append(box);
      },
    );
    if (connectedMode) {
      controls.companyId.value = company || "";
      controls.companyId.onchange = () => {
        controls.companyName.value = ownerList.find((owner) => owner.id === controls.companyId.value)?.name || "";
      };
    }
    const mapControls = {};
    for (const k of [
      "tag",
      "segment",
      "fluid",
      "material",
      "diameter",
      "volume",
      "temperature",
      "operationPressure",
      "designPressure",
      "pmta",
      "thickness",
      "minimumThickness",
      "operation",
    ]) {
      const label = el(
          "label",
          fieldLabel(k) + " · coluna (letra, sem inferência)",
        ),
        col = el("input");
      col.maxLength = 3;
      label.append(col);
      if (k === "tag") col.required = true;
      f.insertBefore(label, f.lastChild);
      let unit;
      if (
        [
          "diameter",
          "volume",
          "temperature",
          "operationPressure",
          "designPressure",
          "pmta",
          "thickness",
          "minimumThickness",
        ].includes(k)
      ) {
        const l = el("label", fieldLabel(k) + " · unidade original"),
          i = el("input");
        l.append(i);
        f.insertBefore(l, f.lastChild);
        unit = i;
      }
      mapControls[k] = { col, unit };
    }
  }
  function colName(n) {
    let s = "";
    for (n++; n; n = Math.floor((n - 1) / 26))
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  $("newCompany").onclick = () => {
    const p = tool("Empresa · nome documentado");
    form(
      p,
      "Cadastrar empresa sem presumir equivalência entre nomes",
      [
        { key: "name", label: "Nome exato da fonte" },
        { key: "source", label: "Arquivo / referência que comprova o nome" },
      ],
      async (b) => {
        const r = await api("companies", b);
        company = r.id;
        p.remove();
        await load();
        msg(r.reused ? "Cliente já existente selecionado. Nenhum cadastro duplicado foi criado." : "Cliente registrado com a referência documental informada.");
      },
    );
  };
  $("newAsset").onclick = () => {
    if (!company) return msg("Selecione a empresa.", true);
    const p = tool("Cadastro de ativo com fonte");
    const systems = state.system.map((s) => [
      s.id,
      `${state.unit.find((u) => u.id === s.unitId)?.name} / ${s.name}`,
    ]);
    form(
      p,
      "Unidade e sistema reais",
      [
        { key: "unit", label: "Unidade / plataforma" },
        { key: "system", label: "Sistema" },
      ],
      async (b) => {
        await api(path("hierarchy"), b);
        await refresh();
        p.remove();
        $("newAsset").click();
      },
    );
    form(
      p,
      "Ativo individual",
      [
        { key: "tag", label: "TAG" },
        { key: "systemId", label: "Unidade / sistema", options: systems },
        {
          key: "type",
          label: "Tipo",
          options: Object.entries(types).filter(([key]) => !connectedMode || ["linha", "segmento"].includes(key)),
          empty: "Selecione o tipo documentado",
        },
        {
          key: "source",
          label:
            "Fonte documental dos dados abaixo (arquivo / página / revisão)",
        },
        ...[
          "fluid",
          "material",
          "diameter",
          "volume",
          "temperature",
          "operationPressure",
          "designPressure",
          "pmta",
          "thickness",
          "minimumThickness",
        ].flatMap((k) => [
          {
            key: k,
            label: fieldLabel(k) + " (somente se documentado)",
            required: false,
          },
          ...(!["fluid", "material"].includes(k)
            ? [
                {
                  key: k + "Unit",
                  label: fieldLabel(k) + " · unidade da fonte",
                  required: false,
                },
              ]
            : []),
        ]),
      ],
      async (b) => {
        const system = state.system.find((s) => s.id === b.systemId),
          technical = {};
        for (const k of [
          "fluid",
          "material",
          "diameter",
          "volume",
          "temperature",
          "operationPressure",
          "designPressure",
          "pmta",
          "thickness",
          "minimumThickness",
        ])
          if (b[k])
            technical[k] = {
              value: b[k],
              unit: b[k + "Unit"] || null,
              source: b.source,
            };
        await api(path("assets"), {
          tag: b.tag,
          type: b.type,
          systemId: b.systemId,
          source: b.source,
          unitId: system.unitId,
          technical,
        });
        p.remove();
        await refresh();
      },
    );
  };
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    if (accountMode) return;
    try {
      await api("login", Object.fromEntries(new FormData(e.target)));
      e.target.elements.key.value = "";
      await load();
      msg(
        "Acesso privado iniciado. Nenhuma aprovação técnica é inferida pelo cadastro.",
      );
    } catch (e) {
      msg(e.message, true);
    }
  };
  $("connectedLoginForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!connected || connectedError) return;
    const submit = e.target.querySelector("button");
    submit.disabled = true;
    try {
      await connected.signIn(e.target.elements.email.value.trim(), e.target.elements.password.value);
      e.target.elements.password.value = "";
      await connectedStart();
    } catch (error) { msg(error.message, true); }
    finally { submit.disabled = false; }
  };
  function clearCompanyView() {
    stateRequest++;
    if (authOnlyMode) { accountGrant = null; $("workspace").hidden = true; }
    contract = "";
    scope = "";
    page = 1;
    state = null;
    $("search").value = "";
    for (const id of ["unitFilter", "systemFilter", "typeFilter", "rtiFilter"])
      $(id).value = "";
    for (const id of ["systems", "assets", "contracts", "indicators"])
      $(id).replaceChildren();
    $("detail").hidden = true;
    $("tools").replaceChildren();
    flow?.render();
  }
  $("company").onchange = async () => {
    company = $("company").value;
    clearCompanyView();
    await load().catch((e) => msg(e.message, true));
  };
  $("tenant").onchange = async () => {
    if (!connected) return;
    if (authOnlyMode) {
      authOnlyTenant = $("tenant").value || null;
      company = "";
      clearCompanyView();
      $("workspace").hidden = true;
      connectedPermissions(false);
      if (authOnlyTenant) await loadAccountWorkspace().catch((error) => msg(error.message, true));
      return;
    }
    connected.setTenant($("tenant").value || null);
    connectedCapabilities = {};
    company = "";
    clearCompanyView();
    $("company").replaceChildren();
    connectedPermissions(false);
    $("workspace").hidden = true;
    if (connected.getTenant()) await load().catch((error) => msg(error.message, true));
    else msg("Selecione a empresa de acesso para consultar os ativos.");
  };
  $("refresh").onclick = () => refresh().catch((e) => msg(e.message, true));
  $("logout").onclick = async () => {
    try {
      if (accountMode) await connected.signOut();
      else await api("logout", {});
      location.reload();
    } catch (error) { msg(error.message, true); }
  };
  for (const id of [
    "search",
    "unitFilter",
    "systemFilter",
    "typeFilter",
    "rtiFilter",
  ])
    $(id).addEventListener(id === "search" ? "input" : "change", () => {
      page = 1;
      if (id === "unitFilter" && state) systemOptions();
      assets();
    });
  $("previous").onclick = () => {
    page--;
    assets();
  };
  $("next").onclick = () => {
    page++;
    assets();
  };
  $("reduceMotion").checked =
    localStorage.getItem("pires-no-motion") === "true";
  document.body.classList.toggle("no-motion", $("reduceMotion").checked);
  $("reduceMotion").onchange = () => {
    document.body.classList.toggle("no-motion", $("reduceMotion").checked);
    localStorage.setItem("pires-no-motion", String($("reduceMotion").checked));
  };
  const flowContext = () => ({
      authenticated: !$("workspace").hidden && (!authOnlyMode || Boolean(accountGrant && accountGrant.tenant === authOnlyTenant && accountGrant.userId === accountUserId && accountGrant.generation === stateRequest)),
      tenantId: authOnlyMode ? authOnlyTenant : connectedMode ? connected?.getTenant() : null,
      client: state?.company && state.company.id === company ? state.company : null,
      clients: ownerList,
      state, mode: authOnlyMode ? "account" : connectedMode ? "connected" : "local",
      write: connectedMode && connectedCapabilities.write === true && connectedCapabilities.operations === true,
      capabilities: connectedCapabilities,
    });
  function operationalError(error) {
    if ([401, 403].includes(error.status)) requireLogin();
    msg(error.message, true);
  }
  async function downloadSource(sourceId) {
    if (connectedMode) {
      const { blob, name } = await connected.download(path("sources/" + sourceId)),
        url = URL.createObjectURL(blob), anchor = el("a");
      anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      const anchor = el("a"); anchor.href = "/api/" + path("sources/" + sourceId);
      document.body.append(anchor); anchor.click(); anchor.remove();
    }
  }
  if (window.PiresGestaoOperations) operational = window.PiresGestaoOperations.create({
    getContext: flowContext,
    write: (operation, body) => api(path(operation), body),
    upload: (file) => connected.uploadDocument(file),
    uploadPrepared: (referenceId) => connected.request("sources/reference", {referenceId}),
    uploadPhoto: (file) => connected.uploadPhoto(file),
    refresh,
    onError: operationalError,
    onSuccess: (result, operation) => {
      msg(result.rti?.id ? "Recomendação e RTI salvas. A mesma RTI já está disponível na gestão." : "Registro salvo e recarregado do banco.");
      if (operation === "field-items") window.location.hash = window.PiresGestaoFlow.routeHash(company, "integridade", "item", result.id, result.contractId || "");
    },
  });
  if (window.PiresGestaoFlow) flow = window.PiresGestaoFlow.create({
    container: $("flowView"), breadcrumb: $("flowBreadcrumb"), back: $("flowBack"), legacy: $("legacyPanels"),
    getContext: flowContext,
    async onSelectClient(id) {
      if (id && !ownerList.some(item => item.id === id)) return;
      company = id; $("company").value = id; clearCompanyView();
      await load().catch(error => msg(error.message, true));
    },
    onOperation: (parent, operation, defaults) => operational?.render(parent, operation, defaults),
    onInspectionRequest: (operation, body) => api(path(operation), body),
    onInspectionRefresh: refresh,
    onInspectionPhoto: (file) => connected.uploadPhoto(file),
    onProjectRequest: (operation, body) => { msg(""); return api(path(operation), body); },
    onProjectRefresh: refresh,
    async onProjectUpload(file) {
      if (!file || !/\.xlsx$/i.test(file.name) || file.size > 8 * 1024 * 1024) throw Error("Selecione uma lista XLSX de até 8 MiB.");
      const originalCompany = company, originalTenant = connected.getTenant();
      const base64 = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result).split(',')[1]); reader.onerror=()=>reject(Error('Falha ao ler a lista.')); reader.readAsDataURL(file); });
      if (company !== originalCompany || connected.getTenant() !== originalTenant) throw Error('O contexto mudou. Selecione o arquivo novamente.');
      return api('sources', {name:file.name, base64});
    },
    onAssets(module, contractId, systemId) {
      if (!state) return;
      activeModule = module;
      contract = state.contract.some((item) => item.id === contractId && item.modules.includes(module)) ? contractId : "";
      scope = module;
      if (systemId) { const system = state.system.find((s) => s.id === systemId); if (system) { $("unitFilter").value = system.unitId; systemOptions(system.id); } }
      systems(); contracts(); assets();
    },
    onLegacyBook: (id) => detail(id),
    onHistory: (id) => api(path("history/" + id)),
    onBook: (id) => api(path("book/" + id)),
    onDownload: (asset) => downloadSource(asset.source.sourceId),
    onDownloadSource: downloadSource,
    async onPhoto(photo) {
      const sourceId = photo.source?.sourceId || photo.sourceId;
      if (!sourceId) throw Error("Fonte original da foto não disponível.");
      const { blob } = await connected.download(path("sources/" + sourceId));
      if (!["image/jpeg", "image/png"].includes(blob.type) || blob.size > 8 * 1024 * 1024) throw Error("A fonte não é uma fotografia JPEG/PNG suportada.");
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("Não foi possível abrir a fotografia original.")); reader.readAsDataURL(blob); });
    },
    async onReport(systemId, campaignId, contractId = "") {
      const ownerId = company, tenantId = connected.getTenant(), routeHash = window.location.hash, helper = window.PiresGestaoReportPDF,
        current = () => company === ownerId && connected.getTenant() === tenantId && window.location.hash === routeHash && !$("workspace").hidden;
      if (contractId && !state.contract.some(record => record.id === contractId && record.modules?.includes("integridade")))
        throw Error("O contrato selecionado não está disponível para este rascunho.");
      if (!helper?.createPdf || !helper?.normalizePhoto) throw Error("O gerador de rascunho está indisponível.");
      msg(contractId ? "Consultando os registros persistidos deste contrato e sistema para montar o rascunho..." : "Consultando o acervo geral do sistema para montar o rascunho...");
      const snapshot = await api(path("reports/" + (contractId ? "contracts/" + contractId + "/" : "") + (campaignId ? "campaign/" + campaignId : "system/" + systemId)));
      if (!current()) return;
      if (snapshot.company?.id !== ownerId || snapshot.system?.id !== systemId || campaignId && snapshot.campaign?.id !== campaignId || contractId && snapshot.contract?.id !== contractId || snapshot.draft !== true || snapshot.canIssue !== false)
        throw Error("Não foi possível confirmar o escopo do rascunho retornado pela API.");
      const images = new Map(), originals = new Map(), pending = [];
      for (const photo of snapshot.photos || []) {
        if (!current()) return;
        const sourceId = photo.source?.sourceId || photo.sourceId;
        if (!sourceId) { pending.push(photo.id); continue; }
        msg("Carregando fotografia original " + (images.size + pending.length + 1) + " de " + snapshot.photos.length + "...");
        try {
          if (!originals.has(sourceId)) originals.set(sourceId, connected.download(path("sources/" + sourceId)));
          const { blob } = await originals.get(sourceId);
          if (!current()) return;
          if (!["image/jpeg", "image/png"].includes(blob.type) || blob.size > 8 * 1024 * 1024) throw Error("Formato de fotografia não suportado.");
          images.set(photo.id, await helper.normalizePhoto(new Uint8Array(await blob.arrayBuffer()), blob.type));
        } catch (error) {
          if ([401, 403].includes(error.status)) { operationalError(error); throw error; }
          pending.push(photo.id);
        }
      }
      if (!current()) return;
      const result = await helper.createPdf(snapshot, images);
      if (!current()) return;
      if (!result?.doc || result.metadata?.draft !== true || result.metadata?.canIssue !== false) throw Error("O gerador não confirmou a identificação de rascunho.");
      result.doc.save(result.filename || "relatorio-integridade-" + systemId + "-rascunho.pdf");
      msg((contractId ? "Rascunho do sistema no contrato selecionado gerado" : "Rascunho do acervo geral do sistema gerado") + " com os dados persistidos e as fotos disponíveis. Não é emissão nem aprovação técnica." + (pending.length || result.metadata.pending?.length ? " Existem pendências documentadas no PDF; confira fontes, itens e fotos ausentes." : ""));
    },
    onError: operationalError,
  });
  if (authOnlyMode && connected && !connectedError) {
    const verifyAccount = () => {
      if (authOnlyTenant && $("login").hidden)
        loadAccountWorkspace().catch((error) => msg(error.message, true));
    };
    if (typeof connected.subscribe === "function") {
      try {
        connected.subscribe((event, session) => {
          if (event === "SIGNED_OUT" || session?.user?.id && accountUserId && session.user.id !== accountUserId) {
            requireLogin();
            msg("Sessão encerrada ou alterada. Entre novamente para continuar.");
          } else if (["TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) setTimeout(verifyAccount, 0);
        });
      } catch { /* Focus and periodic checks still verify the existing account. */ }
    }
    window.addEventListener("focus", verifyAccount);
    setInterval(verifyAccount, 60000);
  }
  if (accountMode) {
    $("loginTitle").textContent = "Acessar Gestão de Ativos";
    $("localLoginHelp").hidden = true;
    $("loginForm").hidden = true;
    $("connectedLoginHelp").hidden = false;
    $("connectedLoginForm").hidden = false;
    $("companyLabel").textContent = "Cliente";
    $("environmentNotice").textContent = authOnlyMode
      ? "Gestão de Ativos · avaliação das telas e do fluxo. A conta e a licença existentes protegem o acesso. O cadastro operacional de clientes, contratos e campanhas ainda não está disponível nesta publicação."
      : "Gestão conectada à conta do aplicativo. A API valida o acesso individual ao piloto; clientes, listas e registros disponíveis persistem no espaço da empresa de acesso selecionada. Fontes históricas não confirmam situação técnica atual.";
    $("calculatorsLink").href = connected?.config.appUrl || "/";
    if (authOnlyMode) {
      options($("rtiFilter"), [], "Indisponível neste modo");
      $("rtiFilter").disabled = true;
    }
    connectedPermissions(false);
    if (connectedError) {
      $("connectedLoginForm").querySelector("button").disabled = true;
      msg(connectedError.message, true);
    } else connectedStart().catch((error) => msg(error.message, true));
  } else api("status").then(load).catch((error) => msg(error.message));
})();
