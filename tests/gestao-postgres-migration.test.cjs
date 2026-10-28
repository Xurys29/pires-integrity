"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto"), { PGlite } = require("@electric-sql/pglite");
const migration = fs.readFileSync(path.resolve(__dirname, "../supabase/migrations/20261026150913_gestao_integrated_registry_review.sql"), "utf8"), bootstrap = fs.readFileSync(path.resolve(__dirname, "fixtures/gestao-postgres-fixture.sql"), "utf8"), tables = ["pilot_access", "owners", "records", "sources", "previews", "imports", "audit", "record_origins", "record_relations"];
async function database(t) { const db = new PGlite(); t.after(() => db.close()); await db.exec(bootstrap); return db; }
async function oldMetadata(db) {
  const schema = (await db.query("select oid,nspowner,nspacl::text as acl,has_schema_privilege('authenticated',oid,'USAGE') as auth_usage,has_schema_privilege('service_role',oid,'USAGE') as service_usage from pg_namespace where nspname='pi_gestao_private'")).rows;
  const helpers = (await db.query("select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.proowner,p.proacl::text as acl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_gestao_private' and p.proname in ('has_company_role','has_company_role_legacy') order by p.proname")).rows;
  const value = { schema, helpers };
  return { value, sha: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
async function allMetadata(db) {
  return (await db.query("select (select coalesce(jsonb_agg(jsonb_build_array(c.oid,c.relname,c.relkind,c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='pi_gestao_private') as relations,(select coalesce(jsonb_agg(jsonb_build_array(t.oid,t.typname,t.typtype) order by t.typname),'[]') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='pi_gestao_private') as types,(select coalesce(jsonb_agg(jsonb_build_array(p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proacl::text,pg_get_functiondef(p.oid)) order by n.nspname,p.proname,p.oid),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pi_gestao_private' or (n.nspname='public' and p.proname in ('pi_gestao_api','pi_gestao_register_source'))) as functions")).rows[0];
}
async function failedMigration(db, sql, code) {
  await assert.rejects(db.exec(sql), code ? { code } : undefined);
  // Explicit BEGIN leaves the connection in failed transaction state after an error.
  // This local ROLLBACK closes it; none of the migration DDL can persist.
  await db.exec("rollback");
}
test("Postgres migration: schema ACL/legacy helpers stay identical; bound invoker RPC works without service schema USAGE", async (t) => {
  const db = await database(t), before = await oldMetadata(db);
  assert.equal(before.value.schema[0].auth_usage, true); assert.equal(before.value.schema[0].service_usage, false);
  await db.exec(migration);
  assert.deepEqual(await oldMetadata(db), before);
  const wrappers = (await db.query("select proname,prosecdef,(prosqlbody is not null) as parsed_body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('pi_gestao_api','pi_gestao_register_source') order by proname")).rows;
  assert.equal(wrappers.length, 2); assert.ok(wrappers.every(f => f.prosecdef === false && f.parsed_body === true));
  await db.exec("set role service_role");
  try {
    assert.equal((await db.query("select has_schema_privilege(current_user,'pi_gestao_private','USAGE') as allowed")).rows[0].allowed, false);
    await assert.rejects(db.query("select public.pi_gestao_register_source('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','{}')"), error => error.code === "42501" && /Piloto não autorizado/.test(error.message));
    await assert.rejects(db.query("select pi_gestao_private.ga_register_source(null,null,'{}')"), error => error.code === "42501" && /schema pi_gestao_private/.test(error.message));
  } finally { await db.exec("reset role"); }
  await db.exec("set role authenticated");
  try {
    assert.equal((await db.query("select pi_gestao_private.has_company_role(null,array['admin']) as sentinel")).rows[0].sentinel, false);
    await assert.rejects(db.query("select pi_gestao_private.has_company_role_legacy(null,array['admin'])"), { code: "42501" });
    await assert.rejects(db.query("select public.pi_gestao_register_source(null,null,'{}')"), { code: "42501" });
  } finally { await db.exec("reset role"); }
  assert.deepEqual(await oldMetadata(db), before);
});
test("Postgres migration: every reserved table, private ga name, type and public RPC overload collision aborts intact", async (t) => {
  const db = await database(t), old = await oldMetadata(db);
  for (const name of tables) {
    await db.exec(`create table pi_gestao_private.${name}(sentinel integer)`);
    const before = await allMetadata(db); await failedMigration(db, migration, "42710");
    assert.deepEqual(await allMetadata(db), before, name); assert.deepEqual(await oldMetadata(db), old, name);
    await db.exec(`drop table pi_gestao_private.${name}`);
  }
  const cases = [
    ["create type pi_gestao_private.records as enum('sentinel')", "drop type pi_gestao_private.records"],
    ["create function pi_gestao_private.ga_existing_sentinel() returns integer language sql as $$ select 1 $$", "drop function pi_gestao_private.ga_existing_sentinel()"],
    ["create function public.pi_gestao_api(p text) returns text language sql as $$ select p $$", "drop function public.pi_gestao_api(text)"],
    ["create function public.pi_gestao_register_source(p text) returns text language sql as $$ select p $$", "drop function public.pi_gestao_register_source(text)"],
  ];
  for (const [create, drop] of cases) {
    await db.exec(create); const before = await allMetadata(db); await failedMigration(db, migration, "42710");
    assert.deepEqual(await allMetadata(db), before); assert.deepEqual(await oldMetadata(db), old); await db.exec(drop);
  }
});
test("Postgres migration: a late DDL/audit setup failure rolls back all new objects and privilege changes", async (t) => {
  const db = await database(t), before = await allMetadata(db), old = await oldMetadata(db);
  const failing = migration.replace(/\bcommit;\s*$/i, () => "do $$ begin raise exception 'isolated late DDL failure'; end $$;\ncommit;\n");
  assert.notEqual(failing, migration); await failedMigration(db, failing, "P0001");
  assert.deepEqual(await allMetadata(db), before); assert.deepEqual(await oldMetadata(db), old);
  const aclDrift = "grant usage on schema pi_gestao_private to service_role";
  await db.exec(aclDrift); const drift = await oldMetadata(db); await failedMigration(db, migration, "55000"); assert.deepEqual(await oldMetadata(db), drift);
});
