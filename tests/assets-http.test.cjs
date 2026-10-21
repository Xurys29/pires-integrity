"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { once } = require("node:events");
const { start } = require("../scripts/serve-assets.cjs");
test("HTTP privado exige autenticação, protege mutações e anexos e persiste após reinício do serviço", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pires-http-"));
  let service = start({ privateDir: dir, port: 0 });
  await once(service.server, "listening");
  let base = "http://127.0.0.1:" + service.server.address().port,
    cookie = "";
  t.after(async () => {
    if (service.server.listening)
      await new Promise((r) => service.server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function call(route, body, auth = true, extra = {}) {
    const r = await fetch(base + "/api/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(auth ? { cookie } : {}),
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-Pires-Request": "1" }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json(), response: r };
  }
  assert.equal((await call("companies", undefined, false)).status, 401);
  for (const route of [
    "/assets.sqlite",
    "/../.pires-private/access-key",
    "/_headers",
    "/lib/asset-store.cjs",
  ])
    assert.equal((await fetch(base + route)).status, 404);
  assert.equal(
    (await call("login", { key: "invalida", actor: "Teste HTTP" }, false))
      .status,
    401,
  );
  const login = await call(
    "login",
    {
      key: fs.readFileSync(path.join(dir, "access-key"), "utf8"),
      actor: "Teste HTTP",
    },
    false,
  );
  assert.equal(login.status, 200);
  assert.match(
    login.response.headers.get("set-cookie"),
    /HttpOnly; SameSite=Strict/,
  );
  cookie = login.response.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await call("companies", { name: "Bloqueado", source: "Teste" }, true, {
        Origin: "https://outra-origem.invalid",
      })
    ).status,
    403,
  );
  const noHeader = await fetch(base + "/api/companies", {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(noHeader.status, 403);
  const c = await call("companies", {
    name: "Empresa fixture HTTP",
    source: "Fonte fixture",
  });
  assert.equal(c.status, 201);
  const c2 = await call("companies", {
    name: "Outra fixture",
    source: "Outra fonte fixture",
  });
  const h = await call(`companies/${c.body.id}/hierarchy`, {
    unit: "Unidade teste",
    system: "Sistema teste",
  });
  const a = await call(`companies/${c.body.id}/assets`, {
    tag: "ATIVO TESTE",
    unitId: h.body.unit.id,
    systemId: h.body.system.id,
    type: "tanque",
  });
  assert.equal(a.status, 200);
  const forbidden = await call(
    `companies/${c2.body.id}/assets/${a.body.id}/operation`,
    { operation: "em_operacao", evidence: "Tentativa cruzada" },
  );
  assert.equal(forbidden.status, 400);
  const state = await call(`companies/${c2.body.id}/state`);
  assert.equal(state.body.asset.length, 0);
  await new Promise((r) => service.server.close(r));
  service = start({ privateDir: dir, port: 0 });
  await once(service.server, "listening");
  base = "http://127.0.0.1:" + service.server.address().port;
  assert.equal((await call("companies")).status, 401);
  const again = await call(
    "login",
    {
      key: fs.readFileSync(path.join(dir, "access-key"), "utf8"),
      actor: "Teste reinício",
    },
    false,
  );
  cookie = again.response.headers.get("set-cookie").split(";")[0];
  const restored = await call(`companies/${c.body.id}/state`);
  assert.equal(restored.body.asset.length, 1);
  assert.equal(restored.body.asset[0].tag, "ATIVO TESTE");
  assert.equal(restored.body.asset[0].technicalCondition, "nao_avaliado");
});
