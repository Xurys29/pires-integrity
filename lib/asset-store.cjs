"use strict";
const { DatabaseSync } = require("node:sqlite");
const { randomUUID, createHash } = require("node:crypto");
const NR = require("../app/nr13.js");
const { isDeepStrictEqual } = require("node:util");
const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" || Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest("hex");
const MODULES = ["integridade", "nr13", "valvulas", "rtis"];
const TYPES = [
  "linha",
  "segmento",
  "vaso",
  "caldeira",
  "tanque",
  "valvula",
  "outro",
];
const text = (v, label, max = 2000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw Error(`${label}: texto obrigatório (até ${max} caracteres).`);
  return v.trim();
};
const date = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw Error("Data inválida.");
  return v;
};
function column(v) {
  if (!/^[A-Z]{1,3}$/.test(v))
    throw Error("Coluna inválida; use letras, como A ou AB.");
  return [...v].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}
function validateTechnical(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error("Dados técnicos inválidos.");
  for (const [key, v] of Object.entries(data)) {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      !Object.hasOwn(v, "value")
    )
      throw Error("Cada dado técnico exige value, unit e source.");
    if (v.value !== null && v.value !== "") {
      if (!v.source) throw Error("Dado técnico exige fonte.");
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
        ].includes(key) &&
        !v.unit
      )
        throw Error("Grandeza técnica exige unidade.");
    }
  }
  return data;
}
function cleanCell(v) {
  if (typeof v === "string" && v.startsWith("="))
    throw Error(
      "Célula com fórmula: confira e forneça o valor documentado; fórmulas não são executadas.",
    );
  return v ?? null;
}
class Store {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS records(company TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(company,id),FOREIGN KEY(company) REFERENCES companies(id));
 CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY,company TEXT NOT NULL,record TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,sha TEXT NOT NULL,bytes BLOB NOT NULL,workbook TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS previews(id TEXT PRIMARY KEY,body TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS attachments(company TEXT NOT NULL,id TEXT NOT NULL,asset TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,sha TEXT NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(company,id),FOREIGN KEY(company) REFERENCES companies(id));
 CREATE TABLE IF NOT EXISTS imports(company TEXT NOT NULL,identity TEXT NOT NULL,asset TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(company,identity),FOREIGN KEY(company) REFERENCES companies(id));`);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(c, id, actor, event, body) {
    this.db
      .prepare(
        "INSERT INTO audit(company,record,actor,at,event,body) VALUES(?,?,?,?,?,?)",
      )
      .run(
        c,
        id,
        text(actor, "Responsável", 160),
        new Date().toISOString(),
        event,
        JSON.stringify(body),
      );
  }
  company(id) {
    const r = this.db.prepare("SELECT * FROM companies WHERE id=?").get(id);
    if (!r) throw Error("Empresa não encontrada.");
    const profile = this.db
      .prepare(
        "SELECT body FROM records WHERE company=? AND id=? AND kind='companyProfile'",
      )
      .get(id, id);
    return { ...r, ...(profile ? JSON.parse(profile.body) : {}) };
  }
  companies() {
    return this.db
      .prepare("SELECT id FROM companies ORDER BY name,id")
      .all()
      .map((c) => this.company(c.id));
  }
  createCompany(name, source, actor) {
    const id = randomUUID();
    name = text(name, "Nome da empresa", 200);
    source = text(source, "Fonte do nome");
    this.db
      .prepare("INSERT INTO companies VALUES(?,?,?)")
      .run(id, name, source);
    this.audit(id, id, actor, "empresa criada", { name, source });
    return this.company(id);
  }
  list(c, kind) {
    this.company(c);
    return this.db
      .prepare(
        "SELECT id,body,version FROM records WHERE company=? AND kind=? ORDER BY rowid",
      )
      .all(c, kind)
      .map((r) => ({ ...JSON.parse(r.body), id: r.id, version: r.version }));
  }
  get(c, id, kind) {
    this.company(c);
    const r = this.db
      .prepare("SELECT * FROM records WHERE company=? AND id=?")
      .get(c, id);
    if (!r || (kind && r.kind !== kind))
      throw Error("Registro não encontrado nesta empresa.");
    return { ...JSON.parse(r.body), id, version: r.version };
  }
  put(c, kind, body, actor, id = randomUUID()) {
    this.company(c);
    const copy = JSON.parse(JSON.stringify(body));
    delete copy.id;
    delete copy.version;
    this.db
      .prepare(
        "INSERT INTO records(company,id,kind,body) VALUES(?,?,?,?) ON CONFLICT(company,id) DO UPDATE SET body=excluded.body,version=records.version+1",
      )
      .run(c, id, kind, JSON.stringify(copy));
    this.audit(c, id, actor, kind, copy);
    return this.get(c, id, kind);
  }
  hierarchy(c, unitName, systemName, actor) {
    let unit = this.list(c, "unit").find((u) => u.name === unitName);
    if (!unit)
      unit = this.put(
        c,
        "unit",
        { name: text(unitName, "Unidade", 200) },
        actor,
      );
    let system = this.list(c, "system").find(
      (s) => s.unitId === unit.id && s.name === systemName,
    );
    if (!system)
      system = this.put(
        c,
        "system",
        { name: text(systemName, "Sistema", 200), unitId: unit.id },
        actor,
      );
    return { unit, system };
  }
  createAsset(c, b, actor) {
    const unit = this.get(c, b.unitId, "unit"),
      system = this.get(c, b.systemId, "system");
    if (system.unitId !== unit.id)
      throw Error("Sistema e unidade incompatíveis.");
    if (!TYPES.includes(b.type)) throw Error("Tipo de ativo inválido.");
    return this.put(
      c,
      "asset",
      {
        tag: text(b.tag, "TAG", 300),
        unitId: unit.id,
        systemId: system.id,
        type: b.type,
        technical: validateTechnical(b.technical || {}),
        operation: "nao_informado",
        technicalCondition: "nao_avaliado",
        source: b.source || null,
      },
      actor,
    );
  }
  contract(c, b, actor) {
    const name = text(b.name, "Contrato", 300),
      source = text(b.source, "Referência do contrato");
    if (
      !Array.isArray(b.modules) ||
      !b.modules.length ||
      b.modules.some((m) => !MODULES.includes(m))
    )
      throw Error("Escopo inválido.");
    if (!Array.isArray(b.assetIds)) throw Error("Informe ativos do escopo.");
    b.assetIds.forEach((id) => this.get(c, id, "asset"));
    return this.put(
      c,
      "contract",
      {
        name,
        source,
        modules: [...new Set(b.modules)],
        assetIds: [...new Set(b.assetIds)],
      },
      actor,
    );
  }
  source(name, bytes, workbook) {
    const id = hash(bytes);
    this.db
      .prepare("INSERT OR IGNORE INTO sources VALUES(?,?,?,?,?)")
      .run(
        id,
        text(name, "Nome do arquivo", 300),
        hash(bytes),
        bytes,
        JSON.stringify(workbook),
      );
    return {
      id,
      name,
      format: workbook.format || "xlsx",
      metadata: workbook.metadata || null,
      sheets: workbook.sheets.map((s) => ({
        name: s.name,
        maxRow: s.maxRow,
        maxColumn: s.maxColumn,
        rows: s.rows,
      })),
    };
  }
  sourceGet(id) {
    const r = this.db.prepare("SELECT * FROM sources WHERE id=?").get(id);
    if (!r) throw Error("Arquivo não encontrado.");
    return { ...r, workbook: JSON.parse(r.workbook) };
  }
  preview(b) {
    const src = this.sourceGet(b.sourceId);
    if (src.workbook.format === "pdf_control")
      return this.previewControl(b, src);
    const sheet = src.workbook.sheets.find((s) => s.name === b.sheet);
    if (!sheet) throw Error("Aba não encontrada (nome exato necessário).");
    text(b.sourceIdentity, "Identidade estável do arquivo", 500);
    text(b.companyName, "Empresa na fonte", 200);
    text(b.unit, "Unidade", 200);
    text(b.system, "Sistema", 200);
    text(b.systemEvidence, "Confirmação do sistema");
    const cell = /^([A-Z]{1,3})(\d+)$/.exec(b.companyCell || "");
    if (!cell)
      throw Error(
        "Informe a célula que comprova o nome da empresa, por exemplo B2.",
      );
    const companyValue = sheet.rows.find((r) => r.row === Number(cell[2]))
      ?.values[column(cell[1])];
    if (String(companyValue ?? "").trim() !== b.companyName.trim())
      throw Error(
        "Nome da empresa diverge da célula de origem; preserve o nome da fonte.",
      );
    if (b.companyId && this.company(b.companyId).name !== b.companyName.trim())
      throw Error(
        "Empresa existente tem outro nome; não há união automática de cadastros.",
      );
    if (
      !b.companyId &&
      this.companies().some((c) => c.name === b.companyName.trim())
    )
      throw Error(
        "Já existe empresa com este nome. Selecione o destino existente; não haverá união automática.",
      );
    const start = Number(b.start),
      end = Number(b.end);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 1 ||
      end < start ||
      end - start > 10000
    )
      throw Error("Faixa de linhas inválida.");
    const mapping = b.mapping;
    if (!mapping || !mapping.tag) throw Error("Mapeie a coluna TAG.");
    Object.values(mapping).forEach(column);
    const allowed = [
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
    ];
    if (Object.keys(mapping).some((k) => !allowed.includes(k)))
      throw Error("Campo de mapeamento desconhecido.");
    const quantities = [
      "diameter",
      "volume",
      "temperature",
      "operationPressure",
      "designPressure",
      "pmta",
      "thickness",
      "minimumThickness",
    ];
    for (const k of quantities)
      if (mapping[k] && !b.units?.[k])
        throw Error(`Informe a unidade original de ${k}; não inferir.`);
    const existing = b.companyId ? this.list(b.companyId, "asset") : [],
      warnings = [],
      rows = [];
    for (let n = start; n <= end; n++) {
      const row = sheet.rows.find((r) => r.row === n);
      if (!row || row.values.every((v) => v === null || v === "")) {
        warnings.push(`Linha ${n} vazia; não será importada.`);
        continue;
      }
      const values = Object.fromEntries(
        Object.entries(mapping).map(([k, col]) => [
          k,
          cleanCell(row.values[column(col)]),
        ]),
      );
      if (values.tag === null || !String(values.tag).trim())
        throw Error(
          `Linha ${n}: TAG ausente; confira se é cabeçalho ou continuação de segmento.`,
        );
      const identity = hash([b.sourceIdentity, b.sheet, n]);
      const digest = hash({
        values,
        units: b.units || {},
        unit: b.unit,
        system: b.system,
        type: b.type || "linha",
      });
      const prior = b.companyId
        ? this.db
            .prepare("SELECT * FROM imports WHERE company=? AND identity=?")
            .get(b.companyId, identity)
        : null;
      const action = prior
        ? prior.digest === digest
          ? "inalterado"
          : "conflito"
        : "novo";
      const same = existing.filter(
        (a) => a.tag === String(values.tag) && (!prior || a.id !== prior.asset),
      );
      if (same.length)
        warnings.push(
          `Linha ${n}: TAG repetido em ${same.length} registro(s); conferir segmento/repetição. Não será unido automaticamente.`,
        );
      rows.push({
        row: n,
        values,
        identity,
        digest,
        action,
        existingId: prior?.asset || null,
      });
    }
    if (!rows.length) throw Error("Nenhuma linha válida.");
    const tags = rows.map((r) => String(r.values.tag));
    for (const t of new Set(tags))
      if (tags.filter((x) => x === t).length > 1)
        warnings.push(
          `TAG ${t} repetido nesta faixa; cada linha de origem será preservada separadamente.`,
        );
    const p = {
      ...b,
      type: b.type || "linha",
      id: randomUUID(),
      rows,
      warnings,
      createdAt: new Date().toISOString(),
      fileName: src.name,
      fileHash: src.sha,
    };
    if (!["linha", "segmento"].includes(p.type))
      throw Error(
        "Importação de lista exige linha ou segmento explicitamente.",
      );
    this.db
      .prepare("INSERT INTO previews(id,body) VALUES(?,?)")
      .run(p.id, JSON.stringify(p));
    return p;
  }
  previewControl(b, src) {
    const meta = src.workbook.metadata,
      sheet = src.workbook.sheets[0];
    if (b.companyName !== meta.companyName)
      throw Error("Preserve o nome histórico no cabeçalho do PDF.");
    text(b.unit, "Unidade confirmada");
    text(b.systemEvidence, "Fonte da identificação da unidade e sistema");
    text(b.sourceIdentity, "Identidade estável do arquivo");
    if (b.system !== meta.system)
      throw Error("Sistema diverge do título do PDF.");
    if (b.companyId && this.company(b.companyId).name !== meta.companyName)
      throw Error("Nome histórico da empresa não corresponde ao destino.");
    if (
      !b.companyId &&
      this.companies().some((c) => c.name === meta.companyName)
    )
      throw Error("Selecione a empresa histórica existente.");
    if (b.brandName)
      text(b.brandEvidence, "Confirmação da relação entre os nomes");
    const rows = [],
      warnings = [];
    for (const row of sheet.rows) {
      const v = row.values;
      if (!v[0]) {
        warnings.push(`Item ${row.row} sem TAG: excluído da importação.`);
        continue;
      }
      const values = {
        tag: v[0],
        pAndId: v[1],
        module: v[2],
        systemColumn: v[3],
        inspectionStartRaw: v[4],
        inspectionEndRaw: v[5],
        visual: v[6],
        utm: v[7],
        isometric: v[8],
        progressRaw: v[9],
        comments: v[10],
      };
      const identity = hash([b.sourceIdentity, "Página 1", row.row]),
        digest = hash({
          values,
          unit: b.unit,
          system: b.system,
          type: "linha",
        }),
        prior = b.companyId
          ? this.db
              .prepare("SELECT * FROM imports WHERE company=? AND identity=?")
              .get(b.companyId, identity)
          : null;
      rows.push({
        row: row.row,
        page: 1,
        bbox: row.bbox,
        values,
        identity,
        digest,
        action: prior
          ? prior.digest === digest
            ? "inalterado"
            : "conflito"
          : "novo",
        existingId: prior?.asset || null,
      });
    }
    if (!rows.length) throw Error("Nenhum TAG preenchido no PDF.");
    if (b.companyId) {
      const existing = this.list(b.companyId, "asset");
      for (const row of rows)
        if (
          existing.some(
            (a) => a.tag === row.values.tag && a.id !== row.existingId,
          )
        )
          warnings.push(
            `Item ${row.row}: TAG já existe em outra origem; conferir repetição ou segmento, sem unir automaticamente.`,
          );
    }
    const tags = rows.map((r) => r.values.tag);
    for (const tag of new Set(tags))
      if (tags.filter((t) => t === tag).length > 1)
        warnings.push(
          `TAG ${tag} repetido; itens permanecem separados até revisão.`,
        );
    warnings.push(
      "Controle de execução não equivale a relatório entregue, aprovação documental ou liberação operacional.",
      "Código do sistema e colunas P&ID/Module/System não são preenchidos por inferência.",
      "O resumo global do documento não é meta, quantidade ou progresso deste sistema.",
    );
    const p = {
      ...b,
      id: randomUUID(),
      sourceFormat: "pdf_control",
      sheet: "Página 1",
      companyCell: "cabeçalho do PDF",
      fileName: src.name,
      fileHash: src.sha,
      sourceMetadata: meta,
      type: "linha",
      mapping: Object.fromEntries(
        Object.keys(rows[0].values).map((k, i) => [k, meta.columns[i]]),
      ),
      units: {},
      rows,
      warnings,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO previews(id,body) VALUES(?,?)")
      .run(p.id, JSON.stringify(p));
    return p;
  }
  commitPreview(id, actor, confirmation) {
    if (confirmation !== true)
      throw Error("Confirme a prévia antes de gravar.");
    return this.transaction(() => {
      const r = this.db.prepare("SELECT * FROM previews WHERE id=?").get(id);
      if (!r) throw Error("Prévia não encontrada.");
      if (r.consumed)
        throw Error("Prévia já gravada. Gere outra para reimportar.");
      const p = JSON.parse(r.body);
      if (p.rows.some((r) => r.action === "conflito"))
        throw Error(
          "Alterações na fonte exigem revisão; importação bloqueada para preservar histórico.",
        );
      if (
        !p.companyId &&
        this.companies().some((c) => c.name === p.companyName.trim())
      )
        throw Error(
          "Empresa criada desde a prévia; selecione o cadastro existente e confira novamente.",
        );
      const company = p.companyId
        ? this.company(p.companyId)
        : this.createCompany(
            p.companyName,
            `${p.sourceIdentity} / ${p.sheet}!${p.companyCell}`,
            actor,
          );
      const { unit, system } = this.hierarchy(
        company.id,
        p.unit,
        p.system,
        actor,
      );
      if (p.sourceFormat === "pdf_control" && !system.coverage)
        this.put(
          company.id,
          "system",
          {
            ...system,
            code: null,
            coverage:
              "Somente a lista recebida; completude do sistema não comprovada.",
            sourceTitle: p.sourceMetadata.system,
          },
          actor,
          system.id,
        );
      let inserted = 0,
        unchanged = 0;
      for (const row of p.rows) {
        const prior = this.db
          .prepare("SELECT * FROM imports WHERE company=? AND identity=?")
          .get(company.id, row.identity);
        if (prior) {
          if (prior.digest !== row.digest)
            throw Error("Fonte mudou desde a prévia; revise novamente.");
          unchanged++;
          continue;
        }
        const v = row.values;
        const source = {
          sourceId: p.sourceId,
          file: p.sourceIdentity,
          fileName: p.fileName,
          fileHash: p.fileHash,
          format: p.sourceFormat || "xlsx",
          sheet: p.sourceFormat === "pdf_control" ? null : p.sheet,
          row: p.sourceFormat === "pdf_control" ? null : row.row,
          page: row.page || null,
          item: p.sourceFormat === "pdf_control" ? row.row : null,
          bbox: row.bbox || null,
          mapping: p.mapping,
          units: p.units || {},
          raw: v,
          systemEvidence: p.systemEvidence,
          metadata: p.sourceMetadata || null,
        };
        const technical = {};
        for (const [k, value] of Object.entries(v))
          if (
            [
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
            ].includes(k)
          )
            technical[k] = { value, unit: p.units?.[k] || null, source };
        const asset = this.createAsset(
          company.id,
          {
            tag: String(v.tag),
            type: p.type,
            unitId: unit.id,
            systemId: system.id,
            technical,
            source,
          },
          actor,
        );
        this.put(
          company.id,
          "asset",
          {
            ...asset,
            segment: v.segment ?? null,
            operationSource: v.operation ?? null,
          },
          actor,
          asset.id,
        );
        this.db
          .prepare("INSERT INTO imports VALUES(?,?,?,?)")
          .run(company.id, row.identity, asset.id, row.digest);
        if (
          p.sourceFormat === "pdf_control" &&
          p.sourceMetadata.dateConvention.startsWith("DD/MM/YYYY") &&
          v.inspectionEndRaw
        ) {
          const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.inspectionEndRaw);
          if (!m) throw Error("Data do controle requer conferência.");
          const done = date(`${m[3]}-${m[2]}-${m[1]}`);
          for (const [key, type] of [
            ["visual", "visual"],
            ["utm", "espessura"],
          ])
            if (v[key] === "1,0")
              this.inspection(
                company.id,
                {
                  assetId: asset.id,
                  module: "integridade",
                  type,
                  done,
                  executionSource: `Informado no controle ${p.fileName}, página 1, item ${row.row}; campo ${key}; data original ${v.inspectionEndRaw}. Sem relatório de inspeção anexado.`,
                  recordSource: source,
                },
                actor,
              );
        }
        inserted++;
      }
      this.db.prepare("UPDATE previews SET consumed=1 WHERE id=?").run(id);
      if (p.brandName)
        this.put(
          company.id,
          "companyProfile",
          {
            displayName: p.brandName,
            sourceName: company.name,
            aliasEvidence: p.brandEvidence,
            aliasConfirmedBy: actor,
            logoStatus: "oficial_pendente",
          },
          actor,
          company.id,
        );
      this.audit(company.id, system.id, actor, "importação", {
        sourceId: p.sourceId,
        previewId: id,
        inserted,
        unchanged,
      });
      return {
        company: this.company(company.id),
        unit,
        system,
        inserted,
        unchanged,
      };
    });
  }
  updateOperation(c, id, b, actor) {
    const a = this.get(c, id, "asset");
    if (
      ![
        "em_operacao",
        "fora_de_operacao",
        "descontinuado",
        "nao_informado",
      ].includes(b.operation)
    )
      throw Error("Situação operacional inválida.");
    return this.put(
      c,
      "asset",
      {
        ...a,
        operation: b.operation,
        operationEvidence: text(b.evidence, "Fonte da situação operacional"),
      },
      actor,
      id,
    );
  }
  classify(c, id, b, actor) {
    const a = this.get(c, id, "asset");
    text(b.evidence, "Fonte dos dados de enquadramento");
    const profile = NR.CATALOG.find((p) => p.id === b.inputs?.nrProfile);
    if (a.type === "caldeira")
      throw Error(
        "O motor existente não enquadra caldeiras; manter Não avaliado até análise técnica específica.",
      );
    if (
      (a.type === "vaso" && profile?.family !== "vessel") ||
      (a.type === "tanque" && profile?.family !== "tank")
    )
      throw Error(
        "Perfil do enquadramento incompatível com o tipo cadastrado; revise a fonte do ativo.",
      );
    const result = NR.assess(b.inputs);
    if (b.snapshot) {
      if (
        b.snapshot.type !== "pmta" ||
        b.snapshot.results?.mode !== "nr13" ||
        b.snapshot.engineVersion !== NR.VERSION ||
        !isDeepStrictEqual(b.snapshot.inputs, b.inputs) ||
        !isDeepStrictEqual(b.snapshot.results, result)
      )
        throw Error(
          "A avaliação salva diverge do motor atual; revise as entradas na calculadora, sem substituir o documento original.",
        );
    }
    return this.put(
      c,
      "classification",
      {
        assetId: a.id,
        inputs: b.inputs,
        result,
        engineVersion: NR.VERSION,
        source: NR.SOURCE,
        evidence: b.evidence,
        sourceSnapshot: b.snapshot || null,
        sourceSnapshotHash: b.snapshot ? hash(b.snapshot) : null,
        reviewStatus: "pendente",
        reviewer: null,
      },
      actor,
    );
  }
  reviewClassification(c, id, b, actor) {
    const r = this.get(c, id, "classification");
    if (r.reviewStatus !== "pendente")
      throw Error(
        "Esta avaliação já foi revisada; crie nova avaliação para preservar o histórico.",
      );
    text(b.reason, "Justificativa da revisão");
    if (!["revisado", "devolvido"].includes(b.status))
      throw Error("Revisão inválida.");
    return this.put(
      c,
      "classification",
      {
        ...r,
        reviewStatus: b.status,
        reviewer: actor,
        reviewedAt: new Date().toISOString(),
        reviewReason: b.reason,
      },
      actor,
      id,
    );
  }
  bookItem(c, b, actor) {
    this.get(c, b.assetId, "asset");
    text(b.type, "Tipo de documento", 200);
    text(b.basis, "Justificativa de aplicabilidade / referência normativa");
    if (b.module && !MODULES.includes(b.module))
      throw Error("Submódulo inválido.");
    const r = this.put(
      c,
      "document",
      {
        assetId: b.assetId,
        type: b.type,
        basis: b.basis,
        module: b.module || "integridade",
        applicability: "pendente_de_validacao",
      },
      actor,
    );
    return r;
  }
  applicability(c, id, b, actor) {
    const d = this.get(c, id, "document");
    if (!["aplicavel", "nao_aplicavel"].includes(b.status))
      throw Error("Aplicabilidade inválida.");
    text(b.basis, "Fundamentação da aplicabilidade");
    if (d.module === "nr13") {
      const cl = this.get(c, b.classificationId, "classification");
      if (cl.assetId !== d.assetId || cl.reviewStatus !== "revisado")
        throw Error(
          "Item NR-13 exige enquadramento revisado do próprio ativo.",
        );
    }
    return this.put(
      c,
      "document",
      {
        ...d,
        applicability: b.status,
        applicabilityBasis: b.basis,
        classificationId: b.classificationId || null,
        applicabilityReviewer: actor,
        applicabilityAt: new Date().toISOString(),
      },
      actor,
      id,
    );
  }
  revision(c, b, actor) {
    const d = this.get(c, b.documentId, "document");
    text(b.revision, "Revisão", 80);
    if (
      this.list(c, "revision").some(
        (r) => r.documentId === d.id && r.revision === b.revision,
      )
    )
      throw Error("Revisão já existe.");
    return this.put(
      c,
      "revision",
      {
        documentId: d.id,
        assetId: d.assetId,
        revision: b.revision,
        status: "pendente",
        attachments: [],
        responsible: actor,
        createdAt: new Date().toISOString(),
      },
      actor,
    );
  }
  attach(c, id, b, actor) {
    const rev = this.get(c, id, "revision");
    if (["aprovado", "substituido"].includes(rev.status))
      throw Error("Revisão encerrada; crie nova revisão.");
    text(b.name, "Nome do anexo", 300);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64 || ""))
      throw Error("Anexo inválido.");
    const bytes = Buffer.from(b.base64, "base64");
    if (!bytes.length || bytes.length > 10 * 1024 * 1024)
      throw Error("Anexo deve ter até 10 MB.");
    const aid = randomUUID();
    return this.transaction(() => {
      this.db
        .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,?,?)")
        .run(
          c,
          aid,
          rev.assetId,
          b.name,
          "application/octet-stream",
          hash(bytes),
          bytes,
        );
      return this.put(
        c,
        "revision",
        {
          ...rev,
          attachments: [
            ...rev.attachments,
            {
              id: aid,
              name: b.name,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ],
        },
        actor,
        id,
      );
    });
  }
  transition(c, id, b, actor) {
    return this.transaction(() => {
      const r = this.get(c, id, "revision");
      const flow = {
        pendente: ["em_elaboracao"],
        em_elaboracao: ["em_revisao"],
        em_revisao: ["aprovado", "devolvido"],
        devolvido: ["em_elaboracao"],
        aprovado: [],
        substituido: [],
      };
      if (!flow[r.status]?.includes(b.status))
        throw Error("Transição documental não permitida.");
      text(b.reason, "Motivo / evidência da decisão");
      if (
        b.status === "aprovado" &&
        this.get(c, r.documentId, "document").applicability !== "aplicavel"
      )
        throw Error(
          "Valide a aplicabilidade do item antes da aprovação documental.",
        );
      if (b.status === "aprovado" && !r.attachments.length)
        throw Error("Aprovação exige anexo desta revisão e decisão explícita.");
      if (b.status === "aprovado")
        for (const old of this.list(c, "revision").filter(
          (x) => x.documentId === r.documentId && x.status === "aprovado",
        ))
          this.put(
            c,
            "revision",
            { ...old, status: "substituido", replacedBy: id },
            actor,
            old.id,
          );
      return this.put(
        c,
        "revision",
        {
          ...r,
          status: b.status,
          decision: b.reason,
          decisionBy: actor,
          decisionAt: new Date().toISOString(),
        },
        actor,
        id,
      );
    });
  }
  rti(c, b, actor) {
    this.get(c, b.assetId, "asset");
    if (b.contractId) {
      const con = this.get(c, b.contractId, "contract");
      if (!con.assetIds.includes(b.assetId) || !con.modules.includes("rtis"))
        throw Error("Ativo / submódulo fora do escopo do contrato.");
    }
    if (b.due) date(b.due);
    return this.put(
      c,
      "rti",
      {
        assetId: b.assetId,
        contractId: b.contractId || null,
        title: text(b.title, "RTI"),
        source: text(b.source, "Fonte da RTI"),
        due: b.due || null,
        status: "aberta",
      },
      actor,
    );
  }
  inspection(c, b, actor) {
    this.get(c, b.assetId, "asset");
    const con = b.contractId ? this.get(c, b.contractId, "contract") : null;
    if (
      !MODULES.includes(b.module) ||
      (con &&
        (!con.assetIds.includes(b.assetId) || !con.modules.includes(b.module)))
    )
      throw Error("Inspeção fora do escopo.");
    if (
      ![
        "visual",
        "interna",
        "externa",
        "espessura",
        "valvula",
        "outra",
      ].includes(b.type)
    )
      throw Error("Tipo de inspeção inválido.");
    if (!b.planned && !b.done)
      throw Error("Informe uma data comprovada de planejamento ou execução.");
    if (b.planned) date(b.planned);
    if (b.done) date(b.done);
    if (b.done && !b.executionSource) throw Error("Execução exige evidência.");
    if (b.planned && !b.planningSource)
      throw Error("Planejamento exige fonte.");
    if (b.id) {
      const prior = this.get(c, b.id, "inspection");
      if (prior.assetId !== b.assetId || prior.contractId !== b.contractId)
        throw Error(
          "Não é permitido mover uma inspeção entre ativo ou contrato.",
        );
      if (
        prior.done &&
        (prior.done !== b.done || prior.executionSource !== b.executionSource)
      )
        throw Error(
          "Execução registrada deve ser preservada; abra novo registro com justificativa.",
        );
    }
    return this.put(
      c,
      "inspection",
      {
        assetId: b.assetId,
        contractId: con?.id || null,
        module: b.module,
        type: b.type,
        planned: b.planned || null,
        done: b.done || null,
        planningSource: b.planningSource || null,
        executionSource: b.executionSource || null,
        recordSource: b.recordSource || null,
      },
      actor,
      b.id || randomUUID(),
    );
  }
  deadline(c, b, actor) {
    this.get(c, b.assetId, "asset");
    if (!["interna", "externa"].includes(b.type))
      throw Error("Tipo de prazo inválido.");
    for (const k of [
      "normVersion",
      "clause",
      "basis",
      "conditions",
      "inputData",
    ])
      text(b[k], k, 10000);
    date(b.start);
    date(b.due);
    if (b.due < b.start) throw Error("Prazo anterior ao marco inicial.");
    const classification = this.get(c, b.classificationId, "classification");
    if (
      classification.assetId !== b.assetId ||
      classification.reviewStatus !== "revisado"
    )
      throw Error("Prazo exige enquadramento revisado do próprio ativo.");
    return this.put(
      c,
      "deadline",
      {
        assetId: b.assetId,
        type: b.type,
        normVersion: b.normVersion,
        clause: b.clause,
        basis: b.basis,
        conditions: b.conditions,
        inputData: b.inputData,
        start: b.start,
        due: b.due,
        classificationId: classification.id,
        definedBy: actor,
      },
      actor,
    );
  }
  report(c, b, actor) {
    const i = this.get(c, b.inspectionId, "inspection");
    if (!i.done) throw Error("Relatório entregue exige inspeção executada.");
    const rev = this.get(c, b.revisionId, "revision");
    const doc = this.get(c, rev.documentId, "document");
    if (!/relat[oó]rio/i.test(doc.type))
      throw Error("A entrega deve referenciar um relatório.");
    if (rev.assetId !== i.assetId || !rev.attachments.length)
      throw Error("Relatório exige revisão com anexo do ativo.");
    date(b.delivered);
    return this.put(
      c,
      "delivery",
      {
        inspectionId: i.id,
        assetId: i.assetId,
        contractId: i.contractId,
        module: i.module,
        revisionId: rev.id,
        delivered: b.delivered,
        source: text(b.source, "Referência de entrega"),
      },
      actor,
    );
  }
  history(c, id) {
    this.get(c, id);
    return this.db
      .prepare(
        "SELECT actor,at,event,body FROM audit WHERE company=? AND record=? ORDER BY seq",
      )
      .all(c, id)
      .map((x) => ({ ...x, body: JSON.parse(x.body) }));
  }
  metrics(
    c,
    contractId,
    module,
    today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }),
  ) {
    const con = this.get(c, contractId, "contract");
    if (module && !con.modules.includes(module))
      throw Error("Submódulo fora do contrato.");
    const inspections = this.list(c, "inspection").filter(
        (i) => i.contractId === contractId && (!module || i.module === module),
      ),
      deliveries = this.list(c, "delivery").filter(
        (d) => d.contractId === contractId && (!module || d.module === module),
      );
    const uniqueDeliveries = new Set(deliveries.map((d) => d.inspectionId));
    const planned = inspections.filter((i) => i.planned),
      done = inspections.filter((i) => i.done),
      series = [
        ...new Set([
          ...planned.map((i) => i.planned),
          ...done.map((i) => i.done),
        ]),
      ]
        .sort()
        .map((day) => ({
          day,
          planned: planned.length
            ? planned.filter((i) => i.planned <= day).length
            : null,
          done: done.filter((i) => i.done <= day).length,
        }));
    return {
      planned: planned.length || null,
      executed: done.length,
      pending: planned.length ? planned.filter((i) => !i.done).length : null,
      dailyTarget: planned.length
        ? planned.filter((i) => i.planned === today).length
        : null,
      dailyProduction: done.filter((i) => i.done === today).length,
      curve: series,
      expectedReports: done.length,
      deliveredReports: uniqueDeliveries.size,
      pendingReports: done.filter((i) => !uniqueDeliveries.has(i.id)).length,
      inspectionBacklog: planned.length
        ? planned.filter((i) => !i.done && i.planned < today).length
        : null,
      reportBacklog: done.filter((i) => !uniqueDeliveries.has(i.id)).length,
      openRTIs: this.list(c, "rti").filter(
        (r) =>
          r.contractId === contractId &&
          r.status === "aberta" &&
          (!module || module === "rtis"),
      ).length,
      approvalSeparate: true,
    };
  }
}
module.exports = { Store, hash, MODULES, TYPES, date };
