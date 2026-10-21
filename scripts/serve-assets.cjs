"use strict";
// Private single-operator cloud test service. Never included by the production static server.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { Store } = require("../lib/asset-store.cjs");
function start(options = {}) {
  const privateDir = path.resolve(
    options.privateDir ||
      process.env.PIRES_PRIVATE_DIR ||
      "/workspace/.pires-private",
  );
  const appRoot = path.resolve(__dirname, "../app");
  if (privateDir === appRoot || privateDir.startsWith(appRoot + path.sep))
    throw Error("O banco privado não pode ficar na pasta pública.");
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDir, 0o700);
  const keyPath = path.join(privateDir, "access-key");
  if (!fs.existsSync(keyPath))
    fs.writeFileSync(keyPath, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  const key = fs.readFileSync(keyPath, "utf8").trim();
  if (key.length < 32) throw Error("Chave de acesso inválida.");
  const store = new Store(path.join(privateDir, "assets.sqlite"));
  fs.chmodSync(path.join(privateDir, "assets.sqlite"), 0o600);
  const sessions = new Map();
  const equal = (a, b) => {
    const aa = Buffer.from(a),
      bb = Buffer.from(b);
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  };
  const allowed = new Set(
    fs
      .readdirSync(appRoot, { recursive: true })
      .filter(
        (f) =>
          !f.startsWith(".") &&
          !f.split("/").some((p) => p.startsWith("_")) &&
          fs.statSync(path.join(appRoot, f)).isFile(),
      ),
  );
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (status, value) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url, "http://local"),
        route = url.pathname;
      if (!route.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method))
          return send(405, { error: "Método não permitido." });
        const f =
          route === "/"
            ? options.rootPage || "gestao.html"
            : route === "/calculadoras"
              ? "index.html"
              : route.slice(1);
        if (!allowed.has(f)) return send(404, { error: "Não encontrado." });
        res.writeHead(200, {
          "Content-Type":
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".svg": "image/svg+xml",
            }[path.extname(f)] || "application/octet-stream",
        });
        return res.end(
          req.method === "HEAD"
            ? undefined
            : fs.readFileSync(path.join(appRoot, f)),
        );
      }
      const origin = req.headers.origin;
      if (origin) {
        let host;
        try {
          host = new URL(origin).host;
        } catch {
          return send(403, { error: "Origem inválida." });
        }
        if (host !== req.headers.host)
          return send(403, { error: "Origem não permitida." });
      }
      if (!["GET", "POST"].includes(req.method))
        return send(405, { error: "Método não permitido." });
      let body = {};
      if (req.method === "POST") {
        if (req.headers["x-pires-request"] !== "1")
          return send(403, { error: "Cabeçalho de proteção ausente." });
        let size = 0,
          chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 30 * 1024 * 1024)
            return send(413, { error: "Limite de 30 MB por requisição." });
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw Error("Corpo inválido.");
      }
      if (route === "/api/login" && req.method === "POST") {
        if (!equal(String(body.key || ""), key))
          return send(401, { error: "Chave inválida." });
        const sid = randomBytes(32).toString("hex");
        sessions.set(sid, {
          actor: String(body.actor || "").trim(),
          expires: Date.now() + 8 * 3600000,
        });
        if (!sessions.get(sid).actor || sessions.get(sid).actor.length > 160) {
          sessions.delete(sid);
          throw Error("Informe seu nome para o histórico.");
        }
        res.setHeader(
          "Set-Cookie",
          `pires_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return send(200, { ok: true });
      }
      const sid = /pires_session=([a-f0-9]{64})/.exec(
          req.headers.cookie || "",
        )?.[1],
        session = sessions.get(sid);
      if (!session || session.expires < Date.now())
        return send(401, {
          error: "Entre com a chave privada deste ambiente.",
        });
      const actor = session.actor;
      if (route === "/api/logout") {
        sessions.delete(sid);
        res.setHeader(
          "Set-Cookie",
          "pires_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return send(200, { ok: true });
      }
      if (route === "/api/status")
        return send(200, {
          actor,
          mode: "teste_privado",
          persistence:
            "SQLite em disco privado desta instância; não sincronizado com produção ou outros ambientes.",
          multiuser: false,
        });
      if (route === "/api/companies" && req.method === "GET")
        return send(200, store.companies());
      if (route === "/api/companies" && req.method === "POST")
        return send(
          201,
          store.transaction(() =>
            store.createCompany(body.name, body.source, actor),
          ),
        );
      if (route === "/api/sources" && req.method === "POST") {
        if (
          !/\.(xlsx|pdf)$/i.test(body.name || "") ||
          typeof body.base64 !== "string" ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)
        )
          throw Error("Selecione XLSX ou PDF de controle válido.");
        const bytes = Buffer.from(body.base64, "base64");
        if (bytes.length > 20 * 1024 * 1024)
          throw Error("XLSX limitado a 20 MB.");
        const dir = fs.mkdtempSync(path.join(privateDir, "xlsx-"));
        try {
          const isPDF = /\.pdf$/i.test(body.name),
            f = path.join(dir, isPDF ? "source.pdf" : "source.xlsx");
          fs.writeFileSync(f, bytes, { mode: 0o600 });
          const r = spawnSync(
            "python",
            [
              path.resolve(
                __dirname,
                isPDF ? "../lib/pdf-control.py" : "../lib/workbook.py",
              ),
              f,
            ],
            { encoding: "utf8", timeout: 60000, maxBuffer: 35 * 1024 * 1024 },
          );
          if (r.status !== 0)
            throw Error(
              "Não foi possível ler o arquivo; confira o formato e os limites. O leitor PDF aceita somente a grade Execution Control de uma página.",
            );
          return send(
            200,
            store.source(body.name, bytes, JSON.parse(r.stdout)),
          );
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      if (route === "/api/import/preview" && req.method === "POST")
        return send(200, store.preview(body));
      if (route === "/api/import/commit" && req.method === "POST")
        return send(
          200,
          store.commitPreview(body.previewId, actor, body.confirm),
        );
      const parts = route.split("/").filter(Boolean);
      if (parts[1] !== "companies" || !parts[2])
        return send(404, { error: "Rota não encontrada." });
      const c = parts[2];
      store.company(c);
      // Every company route performs company-scoped lookup; no record can be selected globally.
      const resource = parts[3],
        id = parts[4],
        action = parts[5];
      if (resource === "state" && req.method === "GET") {
        const kinds = [
          "unit",
          "system",
          "asset",
          "contract",
          "document",
          "revision",
          "classification",
          "deadline",
          "rti",
          "inspection",
          "delivery",
        ];
        const result = Object.fromEntries(
          kinds.map((k) => [k, store.list(c, k)]),
        );
        return send(200, { company: store.company(c), ...result });
      }
      if (resource === "metrics" && req.method === "GET")
        return send(
          200,
          store.metrics(
            c,
            url.searchParams.get("contract"),
            url.searchParams.get("module"),
          ),
        );
      if (resource === "history" && req.method === "GET")
        return send(200, store.history(c, id));
      if (resource === "sources" && req.method === "GET") {
        if (!store.list(c, "asset").some((a) => a.source?.sourceId === id))
          return send(404, { error: "Fonte não vinculada a esta empresa." });
        const original = store.sourceGet(id);
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(original.name)}`,
        });
        return res.end(original.bytes);
      }
      if (resource === "attachments" && req.method === "GET") {
        const a = store.db
          .prepare("SELECT * FROM attachments WHERE company=? AND id=?")
          .get(c, id);
        if (!a)
          return send(404, { error: "Anexo não encontrado nesta empresa." });
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
        });
        return res.end(a.bytes);
      }
      if (req.method !== "POST")
        return send(405, { error: "Método não permitido." });
      let result;
      if (resource === "hierarchy")
        result = store.transaction(() =>
          store.hierarchy(c, body.unit, body.system, actor),
        );
      else if (resource === "assets" && !id)
        result = store.createAsset(c, body, actor);
      else if (resource === "assets" && action === "operation")
        result = store.updateOperation(c, id, body, actor);
      else if (resource === "assets" && action === "classify")
        result = store.classify(c, id, body, actor);
      else if (resource === "classifications" && action === "review")
        result = store.reviewClassification(c, id, body, actor);
      else if (resource === "contracts")
        result = store.contract(c, body, actor);
      else if (resource === "documents" && action === "applicability")
        result = store.applicability(c, id, body, actor);
      else if (resource === "documents" && !id)
        result = store.bookItem(c, body, actor);
      else if (resource === "revisions" && !id)
        result = store.revision(c, body, actor);
      else if (resource === "revisions" && action === "transition")
        result = store.transition(c, id, body, actor);
      else if (resource === "revisions" && action === "attach")
        result = store.attach(c, id, body, actor);
      else if (resource === "rtis" && !id) result = store.rti(c, body, actor);
      else if (resource === "rtis" && action === "close") {
        const r = store.get(c, id, "rti");
        if (r.status !== "aberta") throw Error("RTI já encerrada.");
        result = store.put(
          c,
          "rti",
          {
            ...r,
            status: "encerrada",
            closedAt: new Date().toISOString(),
            closureEvidence:
              String(body.evidence || "").trim() ||
              (() => {
                throw Error("Informe evidência de encerramento.");
              })(),
          },
          actor,
          id,
        );
      } else if (resource === "inspections")
        result = store.inspection(c, body, actor);
      else if (resource === "deadlines")
        result = store.deadline(c, body, actor);
      else if (resource === "deliveries") result = store.report(c, body, actor);
      else return send(404, { error: "Rota não encontrada." });
      return send(200, result);
    } catch (e) {
      send(400, { error: e.message });
    }
  });
  server.on("close", () => store.close());
  server.listen(
    options.port ?? Number(process.env.PORT || 3002),
    options.host || process.env.HOST || "127.0.0.1",
  );
  return { server, store, privateDir };
}
if (require.main === module) {
  const { server } = start();
  server.on("listening", () =>
    console.log(
      `Gestão privada de teste iniciada na porta ${server.address().port}. Acesso por chave em /workspace/.pires-private/access-key; não compartilhe essa chave. Persistência local SQLite, sem conexão com produção.`,
    ),
  );
}
module.exports = { start };
