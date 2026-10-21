(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PiresCompactPDF = api;
})(globalThis, function () {
  "use strict";
  const clean = (v) =>
    String(v ?? "")
      .replace(/[\u2010-\u2015\u2212]/g, "-")
      .replace(/\u2265/g, ">=")
      .replace(/\u2264/g, "<=")
      .replace(/\u00D7/g, "x")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .trim();
  const show = (v) => clean(v) || "Não informado";
  const num = (v) =>
    typeof v === "number" && Number.isFinite(v)
      ? v.toLocaleString("pt-BR", { maximumFractionDigits: 6 })
      : "Não informado";
  function createPdf(snapshot, metadata = {}, Ctor) {
    const full =
      typeof module === "object" && module.exports
        ? require("./calculator-pdf.js")
        : globalThis.PiresCalculatorPdf;
    if (!full) throw Error("Validação do relatório indisponível.");
    full.validateSnapshot(snapshot);
    if (snapshot.results.mode !== "pmta")
      throw Error("O modelo de duas páginas aceita somente PMTA parcial.");
    if (typeof Ctor !== "function") throw Error("Biblioteca PDF indisponível.");
    const d = snapshot.inputs,
      r = snapshot.results,
      doc = new Ctor({
        unit: "mm",
        format: "a4",
        compress: true,
        putOnlyUsedFonts: true,
      });
    const company =
      typeof metadata.company === "object"
        ? metadata.company?.name
        : metadata.company;
    const id = clean(metadata.reportNumber) || "PMTA-" + clean(d.tag),
      revision = show(metadata.revision || "00");
    let y = 43,
      current = 1;
    const M = 15,
      W = 180,
      BOTTOM = 270;
    doc.setProperties({
      title: "Relatório de PMTA parcial / " + id,
      subject: "Resultado parcial preservado; revisão técnica pendente",
      creator: "Pires Integridade / PMTA duas páginas",
    });
    function font(size = 8.5, bold = false, color = [31, 51, 61]) {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      doc.setTextColor(...color);
    }
    function line(text, size = 8.5, bold = false, gap = 1) {
      font(size, bold);
      const rows = doc.splitTextToSize(show(text), W);
      const h = size * 0.3528 * 1.25;
      if (y + rows.length * h + gap > BOTTOM)
        throw Error(
          "O conteúdo excede o modelo de duas páginas. Reduza textos de apresentação ou exporte também o memorial integral; nenhum dado foi cortado.",
        );
      for (const row of rows) {
        doc.text(row, M, y);
        y += h;
      }
      y += gap;
    }
    function title(text) {
      y += 2;
      line(text, 10, true, 2);
      doc.setDrawColor(206, 216, 220);
      doc.line(M, y - 1, M + W, y - 1);
      y += 3;
    }
    function row(label, value) {
      line(label + ": " + show(value), 8.2, false, 0.6);
    }
    function header() {
      doc.setFillColor(18, 62, 83);
      doc.rect(0, 0, 210, 29, "F");
      font(13, true, [255, 255, 255]);
      doc.text("RELATÓRIO DE PMTA PARCIAL", M, 12);
      font(8, false, [255, 255, 255]);
      doc.text(
        "Casco cilíndrico e tampos elipsoidais 2:1 · revisão pendente",
        M,
        20,
      );
      font(8);
      const heading = `TAG ${show(d.tag)} | ${id} | Rev. ${revision}`;
      if (doc.getTextWidth(heading) > W)
        throw Error(
          "Identificação longa demais para o cabeçalho compacto; use o memorial integral.",
        );
      doc.text(heading, M, 36);
      y = 43;
    }
    function table(rows) {
      for (const [label, value] of rows) row(label, value);
    }
    header();
    if (metadata.fictitious)
      line(
        "AMOSTRA DE LAYOUT - DADOS SINTÉTICOS DE TESTE, SEM EQUIPAMENTO REAL.",
        8.5,
        true,
      );
    if (metadata.equipmentPhotoDataUrl) {
      const raw = metadata.equipmentPhotoDataUrl;
      if (
        !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/]+={0,2}$/i.test(raw) ||
        raw.length > 12 * 1024 * 1024
      )
        throw Error("Foto deve ser PNG ou JPEG incorporado.");
      const image = doc.getImageProperties(raw);
      if (
        !(image.width > 0 && image.height > 0) ||
        image.width * image.height > 30000000
      )
        throw Error("Foto inválida.");
      const scale = Math.min(W / image.width, 36 / image.height);
      doc.addImage(
        raw,
        image.fileType,
        M + (W - image.width * scale) / 2,
        y,
        image.width * scale,
        image.height * scale,
      );
      y += image.height * scale + 4;
      if (metadata.equipmentPhotoCaption)
        line(metadata.equipmentPhotoCaption, 7.5);
    }
    if (metadata.logoDataUrl) {
      const im = doc.getImageProperties(metadata.logoDataUrl),
        scale = Math.min(22 / im.width, 12 / im.height);
      doc.addImage(
        metadata.logoDataUrl,
        im.fileType,
        172,
        5,
        im.width * scale,
        im.height * scale,
      );
    }
    title("1. Identificação e premissas documentadas");
    table([
      ["Empresa / cliente", company],
      ["Relatório / avaliação", `${id} / ${show(snapshot.createdAt)}`],
      ["Serviço / material", `${show(d.service)} / ${show(d.material)}`],
      [
        "Código / edição",
        r.constructionCode
          ? `${r.constructionCode.profileId} / ${r.constructionCode.edition}`
          : "Registro legado; edição pendente de conferência",
      ],
      ["Fonte de S, E e geometria", d.pmtaSource],
      ...(r.constructionCode
        ? [["Fonte do código / edição", r.constructionCode.source]]
        : []),
    ]);
    row(
      "Pressão de operação / projeto",
      `${show(d.operationPressure)} / ${show(d.designPressure)} bar manométrico (grandezas distintas)`,
    );
    row(
      "Temperatura / S / E",
      `${show(d.temperature)} °C / ${show(d.stress)} MPa / ${show(d.efficiency)} adimensional`,
    );
    row(
      "D interno / L cilíndrico",
      `${show(d.diameter)} / ${show(d.length)} mm`,
    );
    row(
      "t nominal casco / tampo / CA",
      `${show(d.shell)} / ${show(d.headThickness)} / ${show(d.corrosionAllowance)} mm`,
    );
    title("2. Resultados preservados da avaliação");
    table([
      [
        "Pressão parcial do casco",
        `${num(r.shellPressure)} bar (circ. ${num(r.shellCircPressure)}; long. ${num(r.shellLongPressure)})`,
      ],
      ["Pressão parcial do tampo", `${num(r.headPressure)} bar`],
      [
        "Menor pressão parcial / margem ao projeto",
        `${num(r.componentPressure)} bar / ${num(r.pressureMargin)} bar`,
      ],
      [
        "Espessura requerida casco / tampo",
        `${num(r.shellRequired)} / ${num(r.headRequired)} mm`,
      ],
      [
        "Comparação aritmética casco / tampo",
        `${r.shellMeets ? "Atende" : "Não atende"} / ${r.headMeets ? "Atende" : "Não atende"} à espessura calculada`,
      ],
      ["Volume geométrico", `${num(r.volume)} m³`],
      [
        "PMTA completa do equipamento",
        "Pendente de avaliação dos demais componentes e carregamentos",
      ],
    ]);
    if (!r.shellMeets || !r.headMeets || r.pressureMargin < 0)
      line(
        "RESULTADO ARITMÉTICO INSUFICIENTE. Não constitui aprovação ou liberação operacional.",
        9,
        true,
      );
    line(
      "Pressões obtidas de espessuras nominais menos CA; não são pressões adotadas de operação ou de teste. Sem declaração de conformidade normativa global.",
      8,
      true,
    );
    if (metadata.notes) row("Observações", metadata.notes);
    doc.addPage();
    current = 2;
    header();
    title("3. Memória resumida · unidades e bases");
    const P = num(r.pressure),
      D = show(d.diameter),
      S = show(d.stress),
      E = show(d.efficiency),
      CA = show(d.corrosionAllowance);
    table([
      [
        "Conversões",
        "P [MPa] = P [bar] / 10; R [mm] = D / 2; SE [MPa] = S x E",
      ],
      [
        "Valores convertidos",
        `P_projeto = ${P} MPa; P_operacao = ${num(r.operation)} MPa`,
      ],
      [
        "Casco circunferencial",
        `t_circ = P x R / (S x E - 0,6P) = ${num(r.circumferential)} mm`,
      ],
      [
        "Casco longitudinal",
        `t_long = P x R / (2 x S x E + 0,4P) = ${num(r.longitudinal)} mm`,
      ],
      [
        "Requerida / efetiva do casco",
        `t_req = max(t_circ,t_long) + CA = ${num(r.shellRequired)} mm; t_ef = t_nominal - CA = ${num(r.effectiveShell)} mm`,
      ],
      [
        "Pressão circunferencial",
        "P_circ [bar] = 10 x S x E x t_ef / (R + 0,6 x t_ef)",
      ],
      [
        "Pressão longitudinal",
        "P_long [bar] = 10 x 2 x S x E x t_ef / (R - 0,4 x t_ef)",
      ],
      [
        "Tampo elipsoidal 2:1",
        `t = P x D / (2 x S x E - 0,2P) = ${num(r.headNet)} mm`,
      ],
      [
        "Requerida / efetiva do tampo",
        `t_req = t + CA = ${num(r.headRequired)} mm; t_ef = t_nominal - CA = ${num(r.effectiveHead)} mm`,
      ],
      [
        "Pressão do tampo",
        "P_tampo [bar] = 10 x 2 x S x E x t_ef / (D + 0,2 x t_ef)",
      ],
      [
        "Menor pressão e margem",
        "P_parcial = min(P_casco,P_tampo); margem [bar] = P_parcial - P_projeto [bar]",
      ],
      [
        "Volume",
        "V_cilindro = pi(D/1000)²(L/1000)/4; V_tampo = pi(D/1000)³/24; V_total = V_cilindro + 2V_tampo [m³]",
      ],
      [
        "Volumes parciais",
        `${num(r.cylinderVolume)} m³ (cilindro); ${num(r.oneHeadVolume)} m³ (um tampo)`,
      ],
      [
        "Bases da substituição",
        `P=${P} MPa; D=${D} mm; S=${S} MPa; E=${E}; CA=${CA} mm`,
      ],
      [
        "Domínio restrito",
        "P/(S x E) <= 0,385; t_ef/R <= 0,5; L_coroa = 0,90D; limite t_ef_tampo/L_coroa >= 0,002 quando verificado pelo motor versionado.",
      ],
    ]);
    title("4. Fontes e pendências");
    for (const source of snapshot.sources || [])
      line(typeof source === "string" ? source : source.title, 7.6);
    for (const warning of r.warnings) line("• " + warning, 7.6);
    if (snapshot.recommendations) line(snapshot.recommendations, 7.6);
    line(
      snapshot.note || "Avaliação indicativa. Revisão técnica pendente.",
      7.6,
      true,
    );
    const sign = metadata.signatures || {};
    for (const [role, person] of Object.entries(sign)) {
      if (person && Object.values(person).some(Boolean)) {
        const roleLabel =
          {
            plh: "Responsável técnico declarado",
            company: "Empresa inspetora declarada",
            inspector: "Inspetor declarado",
          }[role] || role;
        const labels = {
          name: "Nome",
          specialty: "Especialidade",
          registration: "Registro",
          cnpj: "CNPJ",
          qualification: "Qualificação",
        };
        line(
          `${roleLabel}: ${Object.entries(person)
            .filter(([key, v]) => key !== "signatureDataUrl" && v)
            .map(([key, v]) => `${labels[key] || key}: ${v}`)
            .join(" | ")}`,
          7.6,
        );
        if (person.signatureDataUrl)
          throw Error(
            "Imagem de assinatura requer o memorial integral; o modelo compacto não omite assinaturas silenciosamente.",
          );
      }
    }
    if (Object.values(sign).some((p) => p && Object.values(p).some(Boolean)))
      line(
        "Identificações declaradas; não autentica signatários nem aplica assinatura digital.",
        7.3,
      );
    for (let p = 1; p <= 2; p++) {
      doc.setPage(p);
      font(7);
      doc.text(
        "AVALIAÇÃO INDICATIVA · PMTA COMPLETA PENDENTE · SEM LIBERAÇÃO OPERACIONAL",
        M,
        283,
      );
      doc.text(`${p} / 2`, 195, 283, { align: "right" });
    }
    const output = {
      version: "compact-1",
      mode: "pmta",
      reportNumber: id,
      revision,
      pageCount: 2,
      technicalSigned: false,
      digitallySigned: false,
      engineVersion: snapshot.engineVersion || r.version,
      photoAttached: !!metadata.equipmentPhotoDataUrl,
    };
    doc.piresCalculatorReportMetadata = output;
    return { doc, metadata: output };
  }
  return { createPdf };
});
