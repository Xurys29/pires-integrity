"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), { createHash, randomUUID } = require("node:crypto"), { setup, ids } = require("./fixtures/gestao-postgres-fixture.cjs"), { normalizeCommercialReference, buildAdministrativeImportSql } = require("../lib/commercial-reference.cjs");
// All names, references, amounts, dates, CNPJs and source IDs below are isolated
// technical fixtures. No real commercial payload is checked into this file.
function reference(label = "A", actor = ids.adminA) {
  return {
    recordClass: "commercial_reference", name: "Commercial fixture " + label, modules: [], assetIds: [], moduleAssetIds: {}, operationalScopeStatus: "pending", status: "close_confirmed_by_owner",
    commercial: { currency: "BRL", amountCents: 12345, amountBasis: "owner_confirmed", stages: [{ position: 1, label: null, amountCents: 12000 }, { position: 2, label: null, amountCents: 345 }], issuerNameRaw: "Issuer fixture", issuerCnpjRaw: "00.000.000/0000-00", customerNameRaw: "Customer fixture", customerCnpjRaw: null, serviceScopeRaw: "Commercial scope transcribed from synthetic fixture" },
    reference: { issuer: "Issuer fixture", number: "FIXTURE-" + label, revision: null, sourceDocumentId: "synthetic-source-" + label, nature: "proposal" },
    provenance: { sourceURI: "https://drive.google.com/file/d/synthetic-source-" + label + "/view?usp=sharing", documentDateRaw: "04/03/2001", sourceDate: "2001-03-04", originalBytesVerified: false, fileHash: null, materializationStatus: "not_materialized", sourceFieldEvidence: [{ field: "commercial.amountCents", page: 2 }] },
    userConfirmation: { actorUserId: actor, confirmedDate: "2002-05-06", confirmedAt: null, statement: "Owner confirmation in synthetic technical fixture", evidenceRef: "synthetic-confirmation", proceedEvidenceRef: "synthetic-proceed" },
    signedNumber: null, signedDate: null, validity: null, source: "Commercial reference; closure/amount declared by owner; signed instrument absent in fixture",
  };
}
async function fixture(t) { const f = await setup(); t.after(() => f.close()); return f; }
async function counts(f) { return (await f.db.query("select (select count(*)::int from pi_gestao_private.records) records,(select count(*)::int from pi_gestao_private.record_origins) origins,(select count(*)::int from pi_gestao_private.audit) audit,(select count(*)::int from pi_gestao_private.record_relations) relations,(select count(*)::int from pi_gestao_private.sources) sources")).rows[0]; }
function sql(ownerId, records, tenantId = ids.tenantA, actorUserId = ids.adminA) { return buildAdministrativeImportSql({ tenantId, ownerId, actorUserId, records }); }

test("Commercial references: integer cents/exact stages, absent dates, source text hash and raw CNPJ stay explicit", () => {
  const input = reference(), original = structuredClone(input), normalized = normalizeCommercialReference(input, { actorUserId: ids.adminA });
  assert.deepEqual(input, original); assert.equal(normalized.commercial.amountCents, 12345); assert.equal(normalized.commercial.stages[0].label, null); assert.equal(normalized.commercial.issuerCnpjRaw, "00.000.000/0000-00"); assert.equal(normalized.commercial.issuerCnpjDigits, "00000000000000"); assert.equal(normalized.commercial.customerCnpjDigits, null); assert.equal(normalized.signedDate, null); assert.equal(normalized.signedNumber, null); assert.equal(normalized.validity, null); assert.equal(normalized.userConfirmation.confirmedAt, null); assert.equal(normalized.provenance.sourceDate, "2001-03-04"); assert.equal(normalized.provenance.originalBytesVerified, false); assert.equal(normalized.provenance.fileHash, null);
  const withoutHash = reference("read-text-no-hash"); withoutHash.provenance.readableTextVerified = true; assert.equal(normalizeCommercialReference(withoutHash, { actorUserId: ids.adminA }).provenance.readableTextHash, null);
  const other = reference("B"); other.commercial.issuerCnpjRaw = null; other.commercial.sourceAmountRaw = "123.449999123"; other.reference.nature = "critical_analysis"; other.provenance.readableTextVerified = true; other.provenance.readableTextHash = createHash("sha256").update("isolated extracted text fixture").digest("hex"); other.provenance.sourceAmountRaw = "123.449999123";
  const raw = normalizeCommercialReference(other, { actorUserId: ids.adminA }); assert.equal(raw.commercial.issuerCnpjDigits, null); assert.equal(raw.commercial.sourceAmountRaw, "123.449999123"); assert.equal(raw.provenance.sourceAmountRaw, "123.449999123"); assert.equal(raw.commercial.amountCents, 12345); assert.equal(raw.provenance.readableTextSha256, other.provenance.readableTextHash); assert.equal(raw.provenance.fileHash, null);
});
test("Commercial references: bad currency, float cents, mismatched stages/dates/provenance/identity are rejected", () => {
  const variants = [
    r => r.commercial.currency = "USD", r => r.commercial.amountCents = 12.345, r => r.commercial.amountCents = -1, r => r.commercial.amountCents = Number.MAX_SAFE_INTEGER + 1,
    r => r.commercial.stages[1].amountCents = 344, r => r.commercial.stages[0].amountCents = 12000.1, r => r.commercial.issuerCnpjDigits = "11111111111111",
    r => r.provenance.sourceDate = "2001-02-30", r => r.signedNumber = "invented-signed-number", r => r.signedDate = "2001-03-04", r => r.validity = "30 days of proposal reused as contract term",
    r => r.provenance.originalBytesVerified = true, r => r.provenance.fileHash = "a".repeat(64), r => r.provenance.sourceURI = "https://example.invalid/file/d/synthetic-source-A/view",
    r => r.provenance.sourceURI = "https://drive.google.com/file/d/other-source/view", r => r.provenance.sourceURI = "https://name:password@drive.google.com/file/d/synthetic-source-A/view",
    r => r.userConfirmation.actorUserId = ids.adminB, r => r.userConfirmation.confirmedAt = "2002-05-06T10:00:00Z", r => r.assetIds = [randomUUID()], r => { r.provenance.readableTextVerified = true; r.provenance.readableTextHash = "not-a-hash"; },
  ];
  for (const mutate of variants) { const input = reference(); mutate(input); assert.throws(() => normalizeCommercialReference(input, { actorUserId: ids.adminA }), TypeError); }
});
test("Commercial references: authorized admin import persists full body through state RPC, without assets/DDL/ACL changes", async t => {
  const f = await fixture(t), owner = await f.call(ids.tenantA, "owners.create", { name: "Customer commercial fixture", source: "Fixture owner registration" }), otherOwner = await f.call(ids.tenantA, "owners.create", { name: "Unrelated owner fixture", source: "Fixture owner registration" });
  const definitions = (await f.db.query("select p.oid,p.proacl::text,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_gestao_private' order by p.oid")).rows;
  const before = await counts(f), first = reference(), second = reference("B"); second.commercial.issuerCnpjRaw = null; second.commercial.customerNameRaw = null; second.commercial.stages = []; second.reference.nature = "critical_analysis";
  first.source += " Quotes ' and backslash \\ and newline\nremain literal; $commercial_not_a_delimiter$";
  await f.db.exec(sql(owner.id, [first, second]));
  const state = await f.call(ids.tenantA, "state.get", { ownerId: owner.id }); assert.equal(state.contract.length, 2); assert.equal(state.asset.length, 0); assert.equal(state.campaign.length, 0); assert.equal(state.rti.length, 0); assert.equal(state.contract[0].recordClass, "commercial_reference"); assert.equal(state.contract[0].source, first.source); assert.equal(state.contract[0].commercial.issuerCnpjDigits, "00000000000000"); assert.equal(state.contract[1].commercial.issuerCnpjDigits, null); assert.deepEqual(state.contract[0].modules, []); assert.deepEqual(state.contract[0].assetIds, []); assert.deepEqual(state.contract[0].moduleAssetIds, {}); assert.equal(state.contract[0].signedDate, null); assert.equal(state.contract[0].status, "close_confirmed_by_owner");
  assert.deepEqual((await f.call(ids.tenantA, "state.get", { ownerId: otherOwner.id })).contract, []);
  const after = await counts(f); assert.equal(after.records - before.records, 2); assert.equal(after.origins - before.origins, 2); assert.equal(after.audit - before.audit, 2); assert.equal(after.relations, 0); assert.equal(after.sources, 0);
  assert.ok((await f.db.query("select source_id from pi_gestao_private.record_origins where kind='contract'")).rows.every(r => r.source_id === null));
  assert.deepEqual((await f.db.query("select p.oid,p.proacl::text,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_gestao_private' order by p.oid")).rows, definitions);
  await f.db.exec(sql(owner.id, [first, second])); assert.deepEqual(await counts(f), after, "Retry is canonical and adds no audit/record duplicates");
  await assert.rejects(f.call(ids.tenantA, "contracts.create", { ...first, ownerId: owner.id, requestId: randomUUID() }), /Módulos explícitos/);
  const changed = structuredClone(first); changed.commercial.amountCents++; changed.commercial.stages[1].amountCents++;
  await assert.rejects(f.db.exec(sql(owner.id, [reference("C"), changed])), { code: "23505" }); assert.deepEqual(await counts(f), after, "Conflict in second reference rolls back the entire batch");
});
test("Commercial references: fresh pilot/write/owner scope guards reject unauthorized administrative import", async t => {
  const f = await fixture(t), owner = await f.call(ids.tenantA, "owners.create", { name: "Scoped commercial fixture", source: "Fixture registration" }), before = await counts(f);
  await assert.rejects(f.db.exec(sql(owner.id, [reference("B", ids.adminB)], ids.tenantB, ids.adminB)), /Owner outside exact tenant/); assert.deepEqual(await counts(f), before);
  await f.db.query("update pi_gestao_private.pilot_access set revoked_at=now() where tenant_id=$1 and user_id=$2", [ids.tenantA, ids.adminA]);
  await assert.rejects(f.db.exec(sql(owner.id, [reference()])), { code: "42501" }); assert.deepEqual(await counts(f), before);
  await f.db.query("update pi_gestao_private.pilot_access set revoked_at=null where tenant_id=$1 and user_id=$2", [ids.tenantA, ids.adminA]);
  await f.db.exec("update pi_access_private.tenant_rollout set writes_paused=true"); await assert.rejects(f.db.exec(sql(owner.id, [reference()])), { code: "42501" }); assert.deepEqual(await counts(f), before);
  await f.db.exec("update pi_access_private.tenant_rollout set writes_paused=false");
  await assert.rejects(f.asRole("authenticated", ids.adminA, db => db.exec(sql(owner.id, [reference()]))), { code: "42501" }); assert.deepEqual(await counts(f), before);
});
