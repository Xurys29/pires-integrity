"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    N = window.IntegrityNR13;
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
  let state = null,
    company = "",
    page = 1,
    contract = "",
    scope = "",
    source = null,
    preview = null;
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
  async function api(route, body) {
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
      $("login").hidden = false;
      $("workspace").hidden = true;
      $("logout").hidden = true;
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
        .catch((e) => msg(e.message, true));
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
      else input.type = field.type || "text";
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
    const list = await api("companies");
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
      state = await api(path("state"));
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
  }
  async function refresh() {
    if (!company) return load();
    state = await api(path("state"));
    render();
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
    options(
      $("systemFilter"),
      state.system
        .filter((s) => !unit || s.unitId === unit)
        .map((s) => [s.id, s.name]),
      "Todos",
    );
    options($("typeFilter"), Object.entries(types), "Todos");
    filters.forEach(([id, v]) => ($(id).value = v));
    systems();
    assets();
    contracts();
  }
  function systems() {
    const p = $("systems");
    p.replaceChildren();
    for (const s of state.system) {
      const list = state.asset.filter((a) => a.systemId === s.id),
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
          $("systemFilter").value = s.id;
          page = 1;
          assets();
        },
        card,
      );
      p.append(card);
    }
  }
  function selectedAssets() {
    const q = $("search").value.toLocaleLowerCase("pt-BR"),
      u = $("unitFilter").value,
      s = $("systemFilter").value,
      t = $("typeFilter").value,
      r = $("rtiFilter").value;
    return state.asset.filter((a) => {
      const open = state.rti.some(
        (x) => x.assetId === a.id && x.status === "aberta",
      );
      return (
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
    if (!state) return;
    const list = selectedAssets(),
      pages = Math.max(1, Math.ceil(list.length / 12));
    page = Math.min(page, pages);
    for (const a of list.slice((page - 1) * 12, page * 12)) {
      const card = el("article", undefined, "card");
      card.append(el("h3", a.tag), el("span", types[a.type], "badge"));
      const op = el("p", operations[a.operation] || "Não informado");
      if (a.operation === "em_operacao")
        op.prepend(el("span", undefined, "light green"));
      card.append(op, el("p", "Condição técnica: Não avaliado", "badge"));
      const rtis = state.rti.filter(
        (r) => r.assetId === a.id && r.status === "aberta",
      );
      for (const r of rtis) {
        const n = el(
          "p",
          `RTI aberta: ${r.title} · ${r.due ? "Prazo: " + r.due : "Prazo não definido"}`,
        );
        n.prepend(el("span", undefined, "light red"));
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
                state.classification.filter((c) => c.assetId === a.id).at(-1)
                  ?.result.scope || "Não avaliado",
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
                state.classification.filter((c) => c.assetId === a.id).at(-1)
                  ?.result.fluidClass,
              ],
              [
                "Categoria",
                state.classification.filter((c) => c.assetId === a.id).at(-1)
                  ?.result.category,
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
        ["Última inspeção interna", last(a.id, "interna")],
        ["Próxima inspeção interna", due(a.id, "interna")],
        ["Última inspeção externa", last(a.id, "externa")],
        ["Próxima inspeção externa", due(a.id, "externa")],
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
      button("Abrir card e book", () => detail(a.id), card);
      p.append(card);
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
    const sel = el("select");
    options(
      sel,
      state.contract.map((c) => [c.id, c.name]),
      "Todos os ativos (sem filtro por contrato)",
    );
    sel.value = contract;
    sel.onchange = () => {
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
        con.modules.map((m) => [m, names[m]]),
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
  async function detail(id) {
    const a = state.asset.find((a) => a.id === id);
    if (!a) return;
    const p = $("detail");
    p.hidden = false;
    p.replaceChildren(el("h2", a.tag + " · book individual"));
    button("Fechar card", () => (p.hidden = true), p, "secondary");
    dl(p, [
      ["Empresa", state.company.displayName || state.company.name],
      ["Unidade", state.unit.find((u) => u.id === a.unitId)?.name],
      ["Sistema", state.system.find((s) => s.id === a.systemId)?.name],
      ["Tipo", types[a.type]],
      ["Operação", operations[a.operation]],
      ["Fonte da operação", a.operationEvidence],
      ["Condição técnica", "Não avaliado"],
      ["Inspeção interna anterior", last(id, "interna")],
      ["Inspeção interna próxima", due(id, "interna")],
      ["Inspeção externa anterior", last(id, "externa")],
      ["Inspeção externa próxima", due(id, "externa")],
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
      const link = el("a", "Baixar documento original de origem");
      link.href = "/api/" + path("sources/" + a.source.sourceId);
      p.append(link);
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
    p.scrollIntoView({ block: "start" });
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
    form(
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
        "Aceita XLSX e PDF de controle Execution Control. Outros PDFs exigem conferência separada. Uma aba não é presumida como um sistema. Confira cabeçalhos, unidade e conteúdo. Repetições de TAG são preservadas por linha de origem; alterações em uma fonte já importada exigem revisão.",
      ),
    );
    const input = el("input");
    input.type = "file";
    input.accept = ".xlsx,.pdf";
    p.append(input);
    button(
      "Ler arquivo e abas",
      async () => {
        if (!input.files[0]) throw Error("Anexe XLSX ou PDF de controle.");
        source = await api("sources", {
          name: input.files[0].name,
          base64: await base64(input.files[0]),
        });
        preview = null;
        if (source.format === "pdf_control") pdfMapping(p);
        else importMapping(p);
      },
      p,
    );
  };
  function pdfMapping(parent) {
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
        preview = p;
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
        const check = el("input");
        check.type = "checkbox";
        const label = el(
          "label",
          "Conferi os TAGs, a unidade e o sistema do PDF.",
        );
        label.prepend(check);
        box.append(label);
        button(
          "Gravar os registros conferidos do PDF",
          async () => {
            if (!check.checked)
              throw Error("Confirme a conferência da prévia.");
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
          },
          box,
        );
        parent.append(box);
      },
    );
  }
  function importMapping(parent) {
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
        label: "Nome exato da empresa que consta na fonte",
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
        preview = await api("import/preview", {
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
            `Prévia · ${preview.rows.length} registros da faixa ${b.start}–${b.end}`,
          ),
        );
        preview.warnings.forEach((w) => box.append(el("p", w, "notice")));
        const keys = Object.keys(preview.mapping);
        table(
          box,
          [
            "Linha de origem",
            "Ação",
            ...keys.map(
              (k) =>
                fieldLabel(k) +
                (preview.units[k] ? " (" + preview.units[k] + ")" : ""),
            ),
          ],
          preview.rows.map((r) => [
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
            if (!check.checked) throw Error("Confira e confirme a prévia.");
            commitButton.disabled = true;
            try {
              const result = await api("import/commit", {
                previewId: preview.id,
                confirm: true,
              });
              company = result.company.id;
              parent.remove();
              await load();
              msg(
                `Gravados ${result.inserted} novos registros; ${result.unchanged} inalterados. Empresa ${result.company.name}, unidade ${result.unit.name}, sistema ${result.system.name}.`,
              );
            } finally {
              commitButton.disabled = false;
            }
          },
          box,
        );
        panel.append(box);
      },
    );
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
          options: Object.entries(types),
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
  $("company").onchange = async () => {
    company = $("company").value;
    contract = "";
    scope = "";
    page = 1;
    $("detail").hidden = true;
    $("tools").replaceChildren();
    await load().catch((e) => msg(e.message, true));
  };
  $("refresh").onclick = () => refresh().catch((e) => msg(e.message, true));
  $("logout").onclick = async () => {
    await api("logout", {});
    location.reload();
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
      if (id === "unitFilter") {
        options(
          $("systemFilter"),
          state.system
            .filter(
              (s) =>
                !$("unitFilter").value || s.unitId === $("unitFilter").value,
            )
            .map((s) => [s.id, s.name]),
          "Todos",
        );
      }
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
  api("status")
    .then(load)
    .catch((e) => msg(e.message));
})();
