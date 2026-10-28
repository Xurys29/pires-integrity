"use strict";
const fs = require("node:fs"), path = require("node:path"), { PGlite } = require("@electric-sql/pglite");
const ids = Object.freeze({
  tenantA: "10000000-0000-4000-8000-000000000001", tenantB: "10000000-0000-4000-8000-000000000002",
  adminA: "20000000-0000-4000-8000-000000000001", adminB: "20000000-0000-4000-8000-000000000002",
  planner: "20000000-0000-4000-8000-000000000003", inspector: "20000000-0000-4000-8000-000000000004",
  assistant: "20000000-0000-4000-8000-000000000005", client: "20000000-0000-4000-8000-000000000006",
  master: "20000000-0000-4000-8000-000000000007", stranger: "20000000-0000-4000-8000-000000000008",
});
async function setup(options = {}) {
  const db = new PGlite(options.loadDataDir ? { loadDataDir: options.loadDataDir } : undefined);
  try {
  if (!options.loadDataDir) {
  await db.exec(fs.readFileSync(path.join(__dirname, "gestao-postgres-fixture.sql"), "utf8"));
  const migrationPath = options.migrationPath || path.resolve(__dirname, "../../supabase/migrations/20261026150913_gestao_integrated_registry_review.sql");
  await db.exec(fs.readFileSync(migrationPath, "utf8"));
  for (const [id, name] of [[ids.tenantA, "Tenant fixture A"], [ids.tenantB, "Tenant fixture B"]]) {
    await db.query("insert into public.pi_companies(id,name) values($1,$2)", [id, name]);
    await db.query("insert into pi_access_private.fixture_licenses(company_id) values($1)", [id]);
  }
  for (const id of Object.values(ids).filter((value) => value.startsWith("2"))) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query("insert into auth.fixture_users(id) values($1)", [id]);
  }
  for (const [user, tenant, role] of [[ids.adminA, ids.tenantA, "admin"], [ids.adminB, ids.tenantB, "admin"], [ids.planner, ids.tenantA, "planner"], [ids.inspector, ids.tenantA, "inspector"], [ids.assistant, ids.tenantA, "assistant"], [ids.client, ids.tenantA, "client"]])
    await db.query("insert into public.pi_company_memberships values($1,$2,$3,'active')", [tenant, user, role]);
  await db.query("insert into pi_access_private.masters(user_id) values($1)", [ids.master]);
  // Synthetic grants live only in this isolated fixture; migration has no pilot seed.
  if (options.pilot !== false) {
    for (const [tenant,user] of [[ids.tenantA,ids.adminA],[ids.tenantB,ids.adminB],...[ids.planner,ids.inspector,ids.assistant,ids.client,ids.master].map(user=>[ids.tenantA,user]),[ids.tenantB,ids.master]])
      await db.query("insert into pi_gestao_private.pilot_access(tenant_id,user_id,reason) values($1,$2,'isolated synthetic fixture')",[tenant,user]);
  }
  }
  async function asRole(role, user, fn) {
    if (!["anon", "authenticated", "service_role"].includes(role)) throw Error("Fixture role inválida");
    await db.exec("set role " + role);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || ""]);
    try { return await fn(db); }
    finally { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); }
  }
  async function call(tenant, action, payload = {}, user = ids.adminA) {
    return asRole("authenticated", user, async () => (await db.query("select public.pi_gestao_api($1,$2,$3::jsonb) as value", [tenant, action, JSON.stringify(payload)])).rows[0].value);
  }
  async function register(tenant, actor, payload) {
    return asRole("service_role", null, async () => (await db.query("select public.pi_gestao_register_source($1,$2,$3::jsonb) as value", [tenant, actor, JSON.stringify(payload)])).rows[0].value);
  }
  async function putObject(tenant, sha, size, ext = "xlsx") {
    const objectKey = tenant + "/" + sha + "/original." + ext;
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('pi-gestao-sources',$1,$2::jsonb) on conflict(bucket_id,name) do nothing", [objectKey, JSON.stringify({ size })]);
    return objectKey;
  }
  return { db, ids, call, register, putObject, asRole, close: () => db.close() };
  } catch (error) { await db.close(); throw error; }
}
module.exports = { setup, ids };
