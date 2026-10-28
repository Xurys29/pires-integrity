"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  { createHash } = require("node:crypto"),
  { setup } = require("./fixtures/gestao-postgres-fixture.cjs");

async function fixture(t) {
  const f = await setup();
  t.after(() => f.close());
  return f;
}
function workbook(tags = ["LINHA-1", "LINHA-1"], company = "Empresa fixture") {
  return {
    format: "xlsx",
    metadata: { mergedRanges: [], formulaRanges: [], formulaCells: [] },
    sheets: [{
      name: "Lista ", maxRow: tags.length + 15, maxColumn: 3,
      rows: [
        { row: 1, values: [company] },
        ...tags.map((tag, i) => ({ row: 16 + i, values: [tag, "Parte " + (i + 1), i === 1 ? null : 8] })),
      ],
    }],
  };
}
async function source(f, wb, label = "fixture", tenant = f.ids.tenantA, actor = f.ids.adminA) {
  const sha = createHash("sha256").update(label + JSON.stringify(wb)).digest("hex"),
    payload = { sha, name: "fixture.xlsx", size: 10, objectKey: await f.putObject(tenant, sha, 10), workbook: wb };
  return { payload, registered: await f.register(tenant, actor, payload) };
}
function previewInput(sourceId, count = 2, companyName = "Empresa fixture", ownerId = null) {
  return {
    sourceId, sourceIdentity: "id-estavel-fixture", companyName, companyCell: "A1", sheet: "Lista ",
    unit: "Unidade fixture", system: "Sistema fixture", systemEvidence: "Fonte conferida fixture",
    start: 16, end: 15 + count, type: "linha", mapping: { tag: "A", segment: "B", operationPressure: "C" },
    units: { operationPressure: "bar" }, ownerId,
  };
}
async function counts(f) {
  const result = {};
  for (const table of ["owners", "records", "imports", "audit"])
    result[table] = (await f.db.query(`select count(*)::integer as n from pi_gestao_private.${table}`)).rows[0].n;
  return result;
}
async function assertUnconsumed(f, id) {
  assert.equal((await f.db.query("select consumed from pi_gestao_private.previews where id=$1", [id])).rows[0].consumed, false);
}

test("Postgres Gestão: gateway aplica matriz de papéis e não concede acesso direto às tabelas/helpers", async (t) => {
  const f = await fixture(t), { ids } = f,
    owner = await f.call(ids.tenantA, "owners.create", { name: "Empresa fixture", source: "Fonte fixture" });
  assert.notEqual(owner.id, ids.tenantA, "Empresa cliente não é o tenant licenciado");
  for (const reader of [ids.planner, ids.inspector, ids.assistant]) {
    assert.equal((await f.call(ids.tenantA, "owners.list", {}, reader)).length, 1);
    assert.equal((await f.call(ids.tenantA, "state.get", { ownerId: owner.id }, reader)).company.id, owner.id);
    await assert.rejects(f.call(ids.tenantA, "owners.create", { name: "Não gravar", source: "Fixture" }, reader), { code: "42501" });
  }
  for (const denied of [ids.client, ids.stranger, ids.adminB])
    await assert.rejects(f.call(ids.tenantA, "owners.list", {}, denied), { code: "42501" });
  const masterOwner = await f.call(ids.tenantB, "owners.create", { name: "Empresa master fixture", source: "Fonte fixture" }, ids.master);
  assert.equal((await f.call(ids.tenantB, "owners.list", {}, ids.master))[0].id, masterOwner.id);
  await assert.rejects(f.asRole("anon", null, (db) => db.query("select public.pi_gestao_api($1,'owners.list','{}')", [ids.tenantA])), { code: "42501" });
  await assert.rejects(f.asRole("authenticated", ids.adminA, (db) => db.query("select * from pi_gestao_private.owners")), { code: "42501" });
  await assert.rejects(f.asRole("authenticated", ids.adminA, (db) => db.query("select pi_gestao_private.ga_owner($1,$2)", [ids.tenantA, owner.id])), { code: "42501" });
  await assert.rejects(f.call(ids.tenantA, "documents.approve", { ownerId: owner.id }), { code: "0A000" });
});

test("Postgres Gestão: rollout, pausa e revogações são reavaliados a cada operação", async (t) => {
  const f = await fixture(t), { ids } = f;
  await f.db.exec("update pi_access_private.tenant_rollout set writes_paused=true");
  assert.equal((await f.call(ids.tenantA, "access.get")).write, false);
  assert.deepEqual(await f.call(ids.tenantA, "owners.list"), []);
  await assert.rejects(f.call(ids.tenantA, "owners.create", { name: "Não gravar", source: "Fixture" }), { code: "42501" });
  await f.db.exec("update pi_access_private.tenant_rollout set enabled=false");
  for (const user of [ids.adminA, ids.master])
    await assert.rejects(f.call(ids.tenantA, "owners.list", {}, user), { code: "42501" });
  await f.db.exec("update pi_access_private.tenant_rollout set enabled=true,writes_paused=false");
  await f.db.query("update public.pi_company_memberships set access_state='revoked' where user_id=$1", [ids.adminA]);
  await assert.rejects(f.call(ids.tenantA, "owners.list"), { code: "42501" });
  await f.db.query("update public.pi_company_memberships set access_state='active' where user_id=$1", [ids.adminA]);
  await f.db.query("update pi_access_private.fixture_licenses set active=false where company_id=$1", [ids.tenantA]);
  for (const user of [ids.adminA, ids.master])
    await assert.rejects(f.call(ids.tenantA, "owners.list", {}, user), { code: "42501" });
  await f.db.query("update pi_access_private.fixture_licenses set active=true where company_id=$1", [ids.tenantA]);
  await f.db.query("update auth.fixture_users set verified=false where id=$1", [ids.adminA]);
  await assert.rejects(f.call(ids.tenantA, "owners.list"), { code: "42501" });
  assert.deepEqual(await counts(f), { owners: 0, records: 0, imports: 0, audit: 0 });
});

test("Postgres Gestão: ingresso de originais é exclusivo do serviço, imutável e isolado por tenant", async (t) => {
  const f = await fixture(t), { ids } = f,
    { payload, registered } = await source(f, workbook());
  assert.equal(registered.id, payload.sha);
  await assert.rejects(f.asRole("authenticated", ids.adminA, (db) => db.query(
    "select public.pi_gestao_register_source($1,$2,$3::jsonb)", [ids.tenantA, ids.adminA, JSON.stringify(payload)],
  )), { code: "42501" });
  await assert.rejects(f.asRole("anon", null, (db) => db.query(
    "select public.pi_gestao_register_source($1,$2,$3::jsonb)", [ids.tenantA, ids.adminA, JSON.stringify(payload)],
  )), { code: "42501" });
  const before = await counts(f);
  assert.equal((await f.register(ids.tenantA, ids.adminA, payload)).id, payload.sha);
  assert.deepEqual(await counts(f), before, "Registrar o mesmo original não duplica auditoria");
  const altered = structuredClone(payload);
  altered.workbook.sheets[0].rows[1].values[0] = "ALTERADO";
  await assert.rejects(f.register(ids.tenantA, ids.adminA, altered), /imutável/);
  await assert.rejects(f.register(ids.tenantA, ids.planner, payload), { code: "42501" });
  await assert.rejects(f.register(ids.tenantB, ids.adminB, payload), /caminho imutável/);
  await assert.rejects(f.register(ids.tenantA, ids.adminA, { ...payload, size: 11 }), /Tamanho declarado/);
  assert.equal((await f.call(ids.tenantA, "sources.get", { sourceId: payload.sha })).objectKey, payload.objectKey);
  await assert.rejects(f.call(ids.tenantA, "sources.get", { sourceId: payload.sha }, ids.master), /revisão restrita/);
  const privatePreview = await f.call(ids.tenantA, "imports.preview", previewInput(payload.sha));
  await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: privatePreview.id, confirm: true }, ids.master), { code: "42501" });
  await assertUnconsumed(f, privatePreview.id);
  await assert.rejects(f.call(ids.tenantB, "sources.get", { sourceId: payload.sha }, ids.adminB), /Fonte não encontrada/);
  assert.deepEqual((await f.db.query("select workbook from pi_gestao_private.sources where tenant_id=$1 and id=$2", [ids.tenantA, payload.sha])).rows[0].workbook, payload.workbook);
  assert.deepEqual(await counts(f), before);
});

test("Postgres Gestão: owners e IDs de unidade/sistema não atravessam tenant ou empresa cliente", async (t) => {
  const f = await fixture(t), { ids } = f,
    ownerA = await f.call(ids.tenantA, "owners.create", { name: "Empresa A fixture", source: "Fonte fixture", actorUserId: ids.adminB, tenantId: ids.tenantB }),
    ownerA2 = await f.call(ids.tenantA, "owners.create", { name: "Empresa A2 fixture", source: "Fonte fixture" }),
    ownerB = await f.call(ids.tenantB, "owners.create", { name: "Empresa B fixture", source: "Fonte fixture" }, ids.adminB),
    hierarchyA = await f.call(ids.tenantA, "hierarchy.create", { ownerId: ownerA.id, unit: "U", system: "S" }),
    hierarchyA2 = await f.call(ids.tenantA, "hierarchy.create", { ownerId: ownerA2.id, unit: "U", system: "S" }),
    before = await counts(f);
  await assert.rejects(f.call(ids.tenantB, "state.get", { ownerId: ownerA.id }, ids.adminB), /não encontrada neste tenant/);
  await assert.rejects(f.call(ids.tenantA, "state.get", { ownerId: ownerB.id }), /não encontrada neste tenant/);
  await assert.rejects(f.call(ids.tenantA, "assets.create", {
    ownerId: ownerA.id, unitId: hierarchyA2.unit.id, systemId: hierarchyA2.system.id, tag: "TAG-FIXTURE", type: "linha",
  }), /Sistema e unidade inválidos/);
  await assert.rejects(f.call(ids.tenantA, "assets.create", {
    ownerId: ownerA.id, unitId: hierarchyA.unit.id, systemId: hierarchyA2.system.id, tag: "TAG-FIXTURE", type: "linha",
  }), /Sistema e unidade inválidos/);
  assert.deepEqual(await counts(f), before);
  const audit = (await f.db.query("select actor_user_id,tenant_id from pi_gestao_private.audit where owner_id=$1", [ownerA.id])).rows;
  assert.ok(audit.length > 0);
  assert.ok(audit.every((row) => row.actor_user_id === ids.adminA && row.tenant_id === ids.tenantA));
});

test("Postgres Gestão: 44 linhas sintéticas mantêm repetições/origem/nulls e reimportam sem duplicação", async (t) => {
  const f = await fixture(t), { ids } = f,
    tags = Array.from({ length: 44 }, (_, i) => "LINHA-" + Math.floor(i / 2)),
    { payload } = await source(f, workbook(tags), "lista-44-fixture"),
    input = previewInput(payload.sha, 44),
    preview = await f.call(ids.tenantA, "imports.preview", input);
  assert.equal(preview.rows.length, 44);
  assert.ok(preview.warnings.some((warning) => /repetida/.test(warning)));
  assert.deepEqual(preview.blockers, []);
  assert.equal((await counts(f)).owners, 0, "Conferir prévia não cria empresa");
  await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: preview.id, confirm: false }), /Confirme/);
  const committed = await f.call(ids.tenantA, "imports.commit", { previewId: preview.id, confirm: true, rows: [{ values: { tag: "FORJADO" } }], actorUserId: ids.adminB });
  assert.equal(committed.inserted, 44);
  assert.equal(committed.unchanged, 0);
  assert.notEqual(committed.company.id, ids.tenantA);
  const state = await f.call(ids.tenantA, "state.get", { ownerId: committed.company.id });
  assert.equal(state.asset.length, 44);
  assert.equal(new Set(state.asset.map((asset) => asset.id)).size, 44);
  assert.equal(state.asset.filter((asset) => asset.tag === tags[0]).length, 2);
  const first = state.asset.find((asset) => asset.source.row === 16),
    missing = state.asset.find((asset) => asset.source.row === 17);
  assert.equal(first.tag, tags[0]);
  assert.equal(first.source.fileHash, payload.sha);
  assert.equal(first.source.sourceId, payload.sha);
  assert.equal(first.source.sheet, "Lista ");
  assert.equal(first.source.file, input.sourceIdentity);
  assert.equal(first.source.page, null);
  assert.equal(first.source.item, null);
  assert.equal(first.technical.operationPressure.value, 8);
  assert.equal(first.technical.operationPressure.unit, "bar");
  assert.equal(missing.technical.operationPressure.value, null);
  assert.equal(missing.source.raw.operationPressure, null);
  assert.ok(state.asset.every((asset) => asset.operation === "nao_informado" && asset.technicalCondition === "nao_avaliado"));
  for (const kind of ["contract", "document", "revision", "classification", "deadline", "rti", "inspection", "delivery"])
    assert.deepEqual(state[kind], []);
  await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: preview.id, confirm: true }), /já gravada/);
  const retry = await f.call(ids.tenantA, "imports.preview", { ...input, ownerId: committed.company.id }),
    reimported = await f.call(ids.tenantA, "imports.commit", { previewId: retry.id, ownerId: committed.company.id, confirm: true });
  assert.equal(reimported.inserted, 0);
  assert.equal(reimported.unchanged, 44);
  assert.deepEqual((await f.call(ids.tenantA, "state.get", { ownerId: committed.company.id })).asset, state.asset);
  assert.equal((await f.call(ids.tenantA, "sources.get", { sourceId: payload.sha, ownerId: committed.company.id }, ids.planner)).objectKey, payload.objectKey);
});

test("Postgres Gestão: conflitos, HOLD/XX, mesclas e fórmulas bloqueiam lote sem mutações parciais", async (t) => {
  const f = await fixture(t), { ids } = f,
    initial = await source(f, workbook(["LINHA-1", "LINHA-2"]), "inicial"),
    initialInput = previewInput(initial.payload.sha),
    first = await f.call(ids.tenantA, "imports.preview", initialInput),
    committed = await f.call(ids.tenantA, "imports.commit", { previewId: first.id, confirm: true }),
    changed = await source(f, workbook(["LINHA-1", "LINHA-ALTERADA"]), "alterada"),
    conflict = await f.call(ids.tenantA, "imports.preview", { ...initialInput, sourceId: changed.payload.sha, ownerId: committed.company.id });
  assert.deepEqual(conflict.rows.map((row) => row.action), ["inalterado", "conflito"]);
  let before = await counts(f);
  await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: conflict.id, confirm: true }), /lote bloqueado/);
  assert.deepEqual(await counts(f), before);
  await assertUnconsumed(f, conflict.id);
  const cases = [
    { name: "TAG pendente", tags: ["HOLD-01", "LINHA-XX", "ABCXXDEF"], metadata: {} },
    { name: "Mescla pendente", metadata: { mergedRanges: [{ sheet: "Lista ", range: "A16:A17" }] } },
    { name: "Fórmula pendente", metadata: { formulaRanges: [{ sheet: "Lista ", range: "C16:C17" }] } },
    { name: "Empresa pendente", metadata: { formulaCells: [{ sheet: "Lista ", address: "A1" }] } },
  ];
  for (const entry of cases) {
    const tags = entry.tags || ["LINHA-1", "LINHA-2"], wb = workbook(tags, entry.name);
    Object.assign(wb.metadata, entry.metadata);
    const src = await source(f, wb, entry.name),
      p = await f.call(ids.tenantA, "imports.preview", previewInput(src.payload.sha, tags.length, entry.name));
    assert.ok(p.blockers.length > 0, entry.name);
    assert.deepEqual(p.rows.map((row) => row.values.tag), tags);
    if (entry.tags) assert.equal(p.blockers.length, 2, "XX no interior de palavra legítima não bloqueia");
    before = await counts(f);
    await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: p.id, confirm: true }), /Prévia bloqueada/);
    assert.deepEqual(await counts(f), before);
    await assertUnconsumed(f, p.id);
  }
  const wb = workbook(["LINHA-1", "LINHA-2"], "Fórmula literal fixture");
  wb.sheets[0].rows[1].values[2] = "=1+1";
  const formula = await source(f, wb, "formula-literal");
  before = await counts(f);
  await assert.rejects(f.call(ids.tenantA, "imports.preview", previewInput(formula.payload.sha, 2, "Fórmula literal fixture")), /Célula com fórmula/);
  assert.deepEqual(await counts(f), before);
  const rollback = await source(f, workbook(["LINHA-1", "LINHA-2"], "Rollback fixture"), "rollback"),
    p = await f.call(ids.tenantA, "imports.preview", previewInput(rollback.payload.sha, 2, "Rollback fixture"));
  await f.db.exec(`create function public.fixture_reject_second_asset() returns trigger language plpgsql as $$
    begin if NEW.action='asset' and NEW.body->>'tag'='LINHA-2' then raise exception 'falha de auditoria fixture';end if;return NEW;end $$;
    create trigger fixture_reject_second_asset before insert on pi_gestao_private.audit for each row execute function public.fixture_reject_second_asset();`);
  before = await counts(f);
  await assert.rejects(f.call(ids.tenantA, "imports.commit", { previewId: p.id, confirm: true }), /falha de auditoria fixture/);
  assert.deepEqual(await counts(f), before, "Erro no segundo ativo reverte empresa, hierarquia, primeiro ativo, importação e auditoria");
  await assertUnconsumed(f, p.id);
  await f.db.exec("drop trigger fixture_reject_second_asset on pi_gestao_private.audit;drop function public.fixture_reject_second_asset()");
  assert.equal((await f.call(ids.tenantA, "imports.commit", { previewId: p.id, confirm: true })).inserted, 2);
});
