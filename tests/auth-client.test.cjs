"use strict";
// Shared authentication lifecycle; synthetic SDK only, no production sessions.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Cloud = require("../app/cloud.js");
const Connected = require("../app/gestao-connected.js");
const Team = require("../app/equipe-api.js");

const userId = "11111111-1111-4111-8111-111111111111";
const tenantA = "22222222-2222-4222-8222-222222222222";
const tenantB = "33333333-3333-4333-8333-333333333333";
const config = {
  mode: "connected", supabaseUrl: "https://authfixture.supabase.co",
  publishableKey: "sb_" + "publishable_" + "synthetic_public_not_a_real_key",
  appUrl: "https://app.fixture.invalid", privacyEmail: "privacy@fixture.invalid",
  gestao: { backend: "supabase" },
};

function fixture() {
  const constructions = [], requests = [], rpc = [], listeners = new Set();
  let token = "synthetic-initial-session", currentUser = userId;
  const sdk = {
    auth: {
      async getUser() { return { data: { user: token ? { id: currentUser, email_confirmed_at: "2026-01-01T00:00:00Z" } : null } }; },
      async getSession() { return { data: { session: token ? { access_token: token } : null } }; },
      async signInWithPassword() { token = "synthetic-new-session"; return { error: null }; },
      async signOut() { token = null; for (const callback of listeners) callback("SIGNED_OUT", null); return { error: null }; },
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
    },
    async rpc(name, payload) {
      rpc.push({ name, payload, token });
      if (name === "pi_my_company_access") return { data: [{ id: tenantA, name: "Synthetic organization" }], error: null };
      if (name === "pi_access_status_v3") return { data: {
        version: 3, user_id: currentUser, status: "active", is_master: false,
        company_id: payload.p_company_id, company_role: payload.p_company_id ? "admin" : null,
        activated_at: "2026-01-01T00:00:00Z", expires_at: null, server_now: "2026-11-05T00:00:00Z",
        license_scope: "company", plan_kind: "indefinite",
      }, error: null };
      if (!token) return { data: null, error: { code: "42501" } };
      return { data: { ok: true }, error: null };
    },
  };
  function factory(...args) { constructions.push(args); return sdk; }
  function connected() { return Connected.create(config, { cloudApi: Cloud, sdkFactory: factory, fetch: async (url, init) => { requests.push({ url, ...init }); return Response.json({ ok: true }); } }); }
  function team() { return Team.create(config, { cloud: Cloud, factory }); }
  return { sdk, factory, constructions, requests, rpc, connected, team, setToken(value) { token = value; }, setUser(value) { currentUser = value; } };
}

test("account, Gestão account, operations and Equipe share one SDK in either creation order", () => {
  for (const order of ["account-first", "team-first"]) {
    const f = fixture();
    if (order === "team-first") f.team();
    const account = Cloud.create(config, f.factory);
    const accountView = Connected.createAccount(config, { cloudApi: Cloud, sdkFactory: f.factory });
    const operations = f.connected(), team = f.team();
    assert.equal(account.configured, true);
    assert.equal(typeof accountView.user, "function");
    assert.equal(typeof operations.request, "function");
    assert.equal(typeof team.call, "function");
    assert.equal(f.constructions.length, 1);
    assert.equal(Cloud.getClient(config, f.factory), f.sdk);
    assert.deepEqual(f.constructions[0][2].auth, { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "pires-auth-v1" });
  }
});

test("refresh and sign-in use the same live session across account, Gestão and Equipe", async () => {
  const f = fixture(), account = Cloud.create(config, f.factory), operations = f.connected(), team = f.team();
  operations.setTenant(tenantA); team.setTenant(tenantB);
  await operations.request("companies");
  f.setToken("synthetic-refreshed-session");
  await operations.request("companies"); await team.call("status");
  assert.equal(new Headers(f.requests[0].headers).get("Authorization"), "Bearer synthetic-initial-session");
  assert.equal(new Headers(f.requests[1].headers).get("Authorization"), "Bearer synthetic-refreshed-session");
  assert.equal(f.rpc.at(-1).token, "synthetic-refreshed-session");
  await account.signIn("synthetic@fixture.invalid", "synthetic-password");
  await operations.request("companies");
  assert.equal(new Headers(f.requests.at(-1).headers).get("Authorization"), "Bearer synthetic-new-session");
  assert.equal(f.constructions.length, 1);
});

test("logout blocks all adapters and re-login reuses the SDK without caching the old token", async () => {
  const f = fixture(), account = Cloud.create(config, f.factory), operations = f.connected(), team = f.team();
  operations.setTenant(tenantA); team.setTenant(tenantB);
  await team.signOut();
  assert.equal(await account.user(), null);
  assert.equal(team.getTenant(), null);
  await assert.rejects(operations.request("companies"), e => e.code === "auth_required");
  assert.equal(f.requests.length, 0);
  team.setTenant(tenantB);
  await assert.rejects(team.call("status"), e => e.code === "42501");
  await account.signIn("synthetic@fixture.invalid", "synthetic-password");
  await operations.request("companies");
  assert.equal(new Headers(f.requests[0].headers).get("Authorization"), "Bearer synthetic-new-session");
  assert.equal(f.constructions.length, 1);
});

test("shared SDK keeps tenant selections and cloud access cursors separate", async () => {
  const f = fixture(), first = Cloud.create(config, f.factory), second = Cloud.create(config, f.factory);
  assert.notEqual(first, second);
  await first.access(tenantA); await second.access(); await first.access();
  assert.deepEqual(f.rpc.filter(r => r.name === "pi_access_status_v3").map(r => r.payload.p_company_id), [tenantA, null, tenantA]);
  const operations = f.connected(), another = f.connected(), team = f.team();
  operations.setTenant(tenantA); team.setTenant(tenantB);
  assert.equal(another.getTenant(), null);
  await assert.rejects(another.request("companies"), e => e.code === "tenant_required");
  await operations.request("companies"); await team.call("status");
  assert.equal(new Headers(f.requests.at(-1).headers).get("X-Pires-Tenant"), tenantA);
  assert.equal(f.rpc.at(-1).payload.p_tenant, tenantB);
  assert.equal(f.constructions.length, 1);
});

test("changing the authenticated user clears each facade's selected company before reuse", async () => {
  const f = fixture(), account = Cloud.create(config, f.factory);
  await account.access(tenantA);
  f.setUser("44444444-4444-4444-8444-444444444444");
  await account.access();
  assert.equal(f.rpc.at(-1).payload.p_company_id, null);
  assert.equal(f.constructions.length, 1);
});

test("auth listeners unsubscribe independently without disposing the shared session", async () => {
  const f = fixture(), first = Cloud.create(config, f.factory), second = Cloud.create(config, f.factory), events = [];
  const a = first.subscribe(event => events.push("first:" + event));
  second.subscribe(event => events.push("second:" + event));
  a.unsubscribe(); await first.signOut();
  assert.deepEqual(events, ["second:SIGNED_OUT"]);
  assert.equal(f.constructions.length, 1);
});

test("cache uses normalized endpoint, public key and original factory, never tenant alone", () => {
  const f = fixture();
  assert.equal(Cloud.getClient(config, f.factory), Cloud.getClient({ ...config, supabaseUrl: config.supabaseUrl + "/" }, f.factory));
  Cloud.getClient({ ...config, supabaseUrl: "https://otherfixture.supabase.co" }, f.factory);
  Cloud.getClient({ ...config, publishableKey: config.publishableKey + "_other" }, f.factory);
  assert.equal(f.constructions.length, 3);
  const other = fixture();
  assert.notEqual(Cloud.getClient(config, other.factory), f.sdk);
  assert.equal(other.constructions.length, 1);
});

test("facade configuration is validated independently and public flags do not duplicate auth", () => {
  const f = fixture(), original = Cloud.create(config, f.factory);
  const changed = Cloud.create({ ...config, appUrl: "https://other.fixture.invalid", selfRegistrationEnabled: true }, f.factory);
  assert.equal(original.config.selfRegistrationEnabled, undefined);
  assert.equal(changed.config.selfRegistrationEnabled, true);
  assert.equal(changed.config.appUrl, "https://other.fixture.invalid");
  assert.equal(f.constructions.length, 1);
  for (const invalid of [{ ...config, appUrl: "http://unsafe.fixture.invalid" }, { ...config, privacyEmail: "" }, { ...config, publishableKey: "invalid" }])
    assert.throws(() => Cloud.getClient(invalid, f.factory), Cloud.CloudError);
  assert.equal(Cloud.getClient({ mode: "demo" }, f.factory), null);
  assert.equal(Cloud.create({ mode: "demo" }, f.factory).configured, false);
  assert.equal(f.constructions.length, 1);
});

test("failed construction can be retried and never poisons another factory", () => {
  const f = fixture(); let attempts = 0;
  function retry(...args) { if (++attempts === 1) throw Error("synthetic constructor failure"); return f.factory(...args); }
  assert.throws(() => Cloud.getClient(config, retry), /synthetic constructor failure/);
  assert.equal(Cloud.getClient(config, retry), f.sdk);
  assert.equal(Cloud.getClient(config, retry), f.sdk);
  assert.equal(attempts, 2);
  assert.throws(() => Cloud.getClient(config, null), Cloud.CloudError);
});

test("simultaneous module startup constructs a single SDK without sharing tenant state", async () => {
  const f = fixture();
  const facades = await Promise.all(Array.from({ length: 12 }, () => Promise.resolve().then(() => Cloud.create(config, f.factory))));
  assert.equal(new Set(facades).size, 12);
  assert.equal(f.constructions.length, 1);
});

test("an old or incompatible cloud adapter is rejected before any connected request", () => {
  const f = fixture();
  assert.throws(() => Connected.create(config, { cloudApi: { create() { throw Error("must not run"); } }, sdkFactory: f.factory, fetch() { throw Error("must not run"); } }), e => e.code === "configuration_unavailable");
  assert.equal(f.constructions.length, 0);
});
