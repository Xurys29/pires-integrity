"use strict";
// Real vendored Supabase + real app scripts. Sessions and HTTP responses are
// explicitly synthetic, intercepted before networking. This is not a live login.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { once } = require("node:events");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");

const baseline = process.argv.includes("--baseline");
assert.ok(process.argv.slice(2).every(arg => arg === "--baseline"), "Only --baseline is supported");
const BASELINE = "564278636d435da49d77f1c02759068cef5b15a1";
const root = path.resolve(__dirname, "..");
const app = path.join(root, "app");
const output = path.join(root, "output/auth-client-browser-20261105", baseline ? "baseline" : "candidate");
const sourceCache = new Map();
function source(file) {
  if (!sourceCache.has(file)) sourceCache.set(file, baseline
    ? execFileSync("git", ["show", `${BASELINE}:app/${file}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 })
    : fs.readFileSync(path.join(app, file)));
  return sourceCache.get(file);
}
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const id = n => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const ids = { user: id(1), tenant: id(2), owner: id(3) };
const config = { mode: "connected", gestao: { backend: "supabase" },
  supabaseUrl: "https://auth-fixture.supabase.co", publishableKey: "sb_" + "publishable_" + "auth_fixture_only_not_a_real_key",
  appUrl: "https://app.fixture.invalid", privacyEmail: "privacy@fixture.invalid" };
const user = { id: ids.user, aud: "authenticated", role: "authenticated", email: "auth-browser@fixture.invalid",
  email_confirmed_at: "2026-01-01T00:00:00Z", confirmed_at: "2026-01-01T00:00:00Z", is_anonymous: false,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", identities: [],
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {} };
function session(phase, remaining = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return { access_token: [jwt({ alg: "HS256", typ: "JWT" }), jwt({ sub: user.id, aud: "authenticated", role: "authenticated", exp: now + remaining, iat: now - 3600, fixture_phase: phase }), "synthetic-not-a-signature"].join("."),
    refresh_token: "synthetic-refresh-only-not-a-secret", expires_at: now + remaining, expires_in: 3600, token_type: "bearer", user };
}
const instrumentation = `
;(() => {
  const original = PiresSupabase.createClient;
  window.__authFixture = { clients: [], events: [] };
  PiresSupabase = { createClient(...args) {
    const client = original(...args);
    const index = window.__authFixture.clients.push(client) - 1;
    client.auth.onAuthStateChange(event => { window.__authFixture.events.push({index, event}); });
    return client;
  }};
})();`;

async function fixture(browser, base, viewport, kind) {
  const initial = session("initial", kind === "expired-session" ? -120 : 3600), refreshed = session("refreshed"), relogged = session("relogged");
  const calls = [], unexpected = [], errors = [], warnings = [];
  let signedOut = false, refreshRejected = ["refresh-rejected", "expired-session"].includes(kind), refreshCount = 0;
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "warning") warnings.push(message.text()); });
  await context.addInitScript(({ stored }) => {
    if (!sessionStorage.getItem("auth-fixture-initialized")) {
      localStorage.setItem("pires-auth-v1", JSON.stringify(stored));
      sessionStorage.setItem("auth-fixture-initialized", "yes");
    }
  }, { stored: initial });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Expose-Headers": "X-Supabase-Api-Version", "X-Supabase-Api-Version": "2024-01-01" };
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base) {
      if (url.pathname === "/runtime-config.js") return route.fulfill({ contentType: "text/javascript", body: "window.PIRES_CONFIG=" + JSON.stringify(config) + ";" });
      if (url.pathname === "/vendor/supabase.js") return route.fulfill({ contentType: "text/javascript", body: source("vendor/supabase.js").toString() + instrumentation });
      return route.continue();
    }
    if (url.origin !== config.supabaseUrl) { unexpected.push(url.origin + url.pathname); return route.abort("blockedbyclient"); }
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const auth = request.headers().authorization;
    const phase = auth === "Bearer " + initial.access_token ? "initial" : auth === "Bearer " + refreshed.access_token ? "refreshed" : auth === "Bearer " + relogged.access_token ? "relogged" : "other";
    calls.push({ path: url.pathname, method: request.method(), phase });
    if (url.pathname === "/auth/v1/user") return signedOut ? json({ code: "bad_jwt", message: "Synthetic session ended" }, 401) : json(user);
    if (url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") === "refresh_token") {
        refreshCount++;
        if (refreshRejected) return json({ code: "refresh_token_not_found", message: "Synthetic refresh rejected" }, 400);
        return json(refreshed);
      }
      if (url.searchParams.get("grant_type") === "password") { signedOut = false; return json(relogged); }
    }
    if (url.pathname === "/auth/v1/logout") { signedOut = true; return json({}); }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const rpc = url.pathname.slice("/rest/v1/rpc/".length);
      if (rpc === "pi_access_status_v3") return json({ version: 3, user_id: ids.user, status: kind === "access-denied" ? "revoked" : "active", is_master: false,
        company_id: ids.tenant, company_role: "admin", activated_at: "2026-01-01T00:00:00Z", expires_at: null,
        server_now: new Date().toISOString(), license_scope: "company", plan_kind: "indefinite" });
      if (rpc === "pi_my_company_access") return json([{ id: ids.tenant, name: "ORGANIZAÇÃO SOMENTE FIXTURE" }]);
      if (rpc === "pi_pending_invites") return json([]);
      if (rpc === "pi_record_activity") return json(true);
      if (rpc === "pi_team_api") return kind === "access-denied" ? json({ code: "42501", message: "Synthetic denied" }, 403) : json({ manager: true });
    }
    const api = "/functions/v1/gestao-api/";
    if (url.pathname === api + "status") return json({ actor: "GESTOR SOMENTE FIXTURE", user_id: ids.user, mode: "supabase_integrado",
      capabilities: { operations: kind === "standalone", write: true, accessMode: "management", actorRole: "admin", inspectionScopeVersion: 1 } });
    if (url.pathname === api + "tenants") return json([{ id: ids.tenant, name: "ORGANIZAÇÃO SOMENTE FIXTURE" }]);
    if (url.pathname === api + "companies") return json([{ id: ids.owner, name: "CLIENTE SOMENTE FIXTURE" }]);
    unexpected.push(url.origin + url.pathname); return json({ code: "unexpected_fixture_route" }, 500);
  });
  return { page, context, calls, unexpected, errors, warnings, refreshCount: () => refreshCount,
    refreshWasRejected: () => refreshRejected, denyRefresh: () => { refreshRejected = true; } };
}
async function sdkCount(page) { return page.evaluate(() => window.__authFixture.clients.length); }
async function waitHome(page) { await page.locator("#home:not(.hidden)").waitFor(); await page.waitForFunction(() => document.getElementById("assetsModuleBadge")?.textContent === "Disponível para sua conta"); }
async function waitLogin(page) { await page.locator("#auth:not(.hidden)").waitFor(); }
async function refreshSDK(page) { return page.evaluate(async () => { const result = await window.__authFixture.clients[0].auth.refreshSession(); return { hasSession: !!result.data?.session, code: result.error?.code || null }; }); }
async function waitForCall(fixture, predicate, description) {
  const deadline = Date.now() + 10000;
  while (!fixture.calls.some(predicate)) {
    assert.ok(Date.now() < deadline, description);
    await fixture.page.waitForTimeout(25);
  }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(new URL(req.url, "http://fixture").pathname).replace(/^\//, "");
    if (!file) file = "index.html";
    if (!path.extname(file)) file += ".html";
    if (file.includes("..") || path.isAbsolute(file) || !fs.existsSync(path.join(app, file)) || !fs.statSync(path.join(app, file)).isFile()) return res.writeHead(404).end();
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpeg": "image/jpeg", ".jpg": "image/jpeg" }[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime }); res.end(source(file));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port, cases = [];
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.PIRES_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    for (const [device, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
      for (const kind of ["healthy", "refresh-rejected", "expired-session", "access-denied", "standalone"]) {
        const f = await fixture(browser, base, viewport, kind), page = f.page;
        try {
          await page.goto(base + (kind === "standalone" ? "/gestao.html#auth-client-fixture" : "/"), { waitUntil: "networkidle" });
          const expected = baseline && !["access-denied", "expired-session", "standalone"].includes(kind) ? 3 : 1;
          if (kind === "standalone") {
            await page.locator("#workspace:not([hidden])").waitFor();
            assert.match(await page.locator("#tenant").innerText(), /ORGANIZAÇÃO SOMENTE FIXTURE/);
            assert.match(await page.locator("#company").innerText(), /CLIENTE SOMENTE FIXTURE/);
            assert.equal(await sdkCount(page), 1);
            const refresh = await refreshSDK(page); assert.equal(refresh.hasSession, true);
            await page.locator("#refresh").click();
            await page.waitForFunction(() => !document.getElementById("workspace").hidden);
            assert.ok(f.calls.some(call => call.path.endsWith("/companies") && call.phase === "refreshed"));
          } else if (kind === "expired-session") {
            await waitLogin(page);
            assert.equal(await sdkCount(page), 1);
            assert.equal(await page.locator("#openManagement").isVisible(), false);
            assert.equal(await page.evaluate(() => localStorage.getItem("pires-auth-v1")), null);
            assert.ok(f.refreshCount() >= 1, "Expired session must attempt refresh and clear on rejection");
          } else if (kind === "access-denied") {
            await page.locator("#accessDenied:not(.hidden)").waitFor();
            assert.equal(await sdkCount(page), 1);
            assert.equal(await page.locator("#openManagement").isVisible(), false);
            assert.equal(f.calls.some(call => call.path.endsWith("/pi_team_api")), false);
          } else {
            await waitHome(page); assert.equal(await sdkCount(page), expected);
            assert.ok(f.calls.some(call => call.path.endsWith("/pi_team_api")), "Real home must execute the fallback Team API");
            const refresh = await refreshSDK(page);
            if (kind === "refresh-rejected") {
              assert.equal(refresh.hasSession, false); assert.equal(refresh.code, "refresh_token_not_found");
              // Current real SDK deliberately retains an unexpired access token
              // when a proactive refresh fails. Expired-session rejection is
              // independently tested above and must actually clear the login.
              assert.equal(await page.evaluate(() => !!localStorage.getItem("pires-auth-v1")), true);
              await waitHome(page);
              await page.locator("#logout").click(); await waitLogin(page);
              assert.equal(await page.locator("#openManagement").isVisible(), false);
            } else {
              assert.equal(refresh.hasSession, true); assert.equal(f.refreshCount(), 1);
              await page.evaluate(() => window.dispatchEvent(new Event("focus")));
              await page.waitForFunction(() => window.__authFixture.events.some(event => event.event === "TOKEN_REFRESHED"));
              await waitForCall(f, call => call.path.endsWith("/gestao-api/status") && call.phase === "refreshed", "Gestão must receive refreshed token");
              await waitForCall(f, call => call.path.endsWith("/pi_team_api") && call.phase === "refreshed", "Team must receive refreshed token");
              assert.ok(f.calls.some(call => call.path.endsWith("/gestao-api/status") && call.phase === "refreshed"));
              assert.ok(f.calls.some(call => call.path.endsWith("/pi_team_api") && call.phase === "refreshed"));
              await page.locator("#logout").click(); await waitLogin(page);
              assert.equal(await page.locator("#openManagement").isVisible(), false);
              assert.equal(await page.evaluate(() => localStorage.getItem("pires-auth-v1")), null);
              const staleCount = f.calls.filter(call => ["initial", "refreshed"].includes(call.phase)).length;
              await page.evaluate(() => window.dispatchEvent(new Event("focus")));
              await page.waitForTimeout(100);
              assert.equal(f.calls.filter(call => ["initial", "refreshed"].includes(call.phase)).length, staleCount, "No stale authenticated request after logout");
              await page.locator("#email").fill("auth-browser@fixture.invalid"); await page.locator("#password").fill("demo1234");
              await page.locator("#authSubmit").click(); await waitHome(page);
              assert.equal(await sdkCount(page), expected, "Logout and login must reuse the existing SDK");
              assert.ok(f.calls.some(call => call.path.endsWith("/gestao-api/status") && call.phase === "relogged"));
            }
          }
          const duplicateWarnings = f.warnings.filter(message => message.includes("Multiple GoTrueClient instances"));
          assert.equal(duplicateWarnings.length, expected - 1, "Actual vendor warning count");
          assert.deepEqual(f.errors, []); assert.deepEqual(f.unexpected, []);
          await page.screenshot({ path: path.join(output, `${device}-${kind}.png`), fullPage: true });
          cases.push({ device, kind, pass: true, sdkClients: await sdkCount(page), duplicateWarnings: duplicateWarnings.length,
            refreshRequests: f.refreshCount(), syntheticHttpCalls: f.calls.length, pageErrors: 0, unexpectedExternalRequests: 0 });
        } catch (error) {
          await page.screenshot({ path: path.join(output, `${device}-${kind}-failure.png`), fullPage: true });
          const observed = await page.evaluate(() => ({
            events: window.__authFixture?.events, sdkClients: window.__authFixture?.clients.length,
            sessionStored: !!localStorage.getItem("pires-auth-v1"),
            homeClass: document.getElementById("home")?.className,
            authClass: document.getElementById("auth")?.className,
            authError: document.getElementById("authError")?.textContent,
            badge: document.getElementById("assetsModuleBadge")?.textContent,
          }));
          fs.writeFileSync(path.join(output, "FAILURE.json"), JSON.stringify({ device, kind, error: error.message, observed, calls: f.calls,
            warnings: f.warnings, pageErrors: f.errors, unexpected: f.unexpected, precedingCases: cases }, null, 2) + "\n");
          throw error;
        } finally { await f.context.close(); }
      }
    }
    const result = { baseline, baselineCommit: baseline ? BASELINE : null, sourceHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      sourceTreeMode: baseline ? "immutable git baseline" : "working tree", authSources: Object.fromEntries(["cloud.js", "gestao-connected.js", "equipe-api.js"].map(file => [file, sha(source(file))])),
      source: "actual app scripts and real vendored Supabase; synthetic sessions and intercepted APIs only", liveProductionCalls: 0,
      sdkSha256: sha(source("vendor/supabase.js")), chromium: browser.version(), total: cases.length, pass: cases.length, fail: 0, cases };
    fs.writeFileSync(path.join(output, "RESULTS.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result, null, 2));
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
