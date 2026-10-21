"use strict";
// Operator tool: the PDF and all extracted private data stay outside the repository.
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process"),
  { Store } = require("../lib/asset-store.cjs");
const args = process.argv.slice(2),
  option = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? null : args[i + 1];
  };
const dir = process.env.PIRES_PRIVATE_DIR || "/workspace/.pires-private",
  s = new Store(path.join(dir, "assets.sqlite"));
try {
  if (option("--commit")) {
    if (!args.includes("--confirmed"))
      throw Error("Use --confirmed após conferir a prévia.");
    console.log(
      JSON.stringify(
        s.commitPreview(
          option("--commit"),
          option("--actor") || "Operador do ambiente",
          true,
        ),
        null,
        2,
      ),
    );
  } else {
    const file = option("--file");
    if (!file || !option("--unit") || !option("--evidence"))
      throw Error(
        "Informe --file PDF --unit unidade --evidence fonte. Opcional: --name, --display-name, --name-evidence, --actor.",
      );
    const parsed = spawnSync(
      "python",
      [path.resolve(__dirname, "../lib/pdf-control.py"), file],
      { encoding: "utf8", timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
    );
    if (parsed.status !== 0)
      throw Error(parsed.stderr || "Falha na leitura do PDF.");
    const workbook = JSON.parse(parsed.stdout),
      name = option("--name") || path.basename(file),
      src = s.source(name, fs.readFileSync(file), workbook),
      c = s.companies().find((c) => c.name === workbook.metadata.companyName);
    const p = s.preview({
      sourceId: src.id,
      sourceIdentity: option("--identity") || name,
      companyId: c?.id || null,
      companyName: workbook.metadata.companyName,
      unit: option("--unit"),
      system: workbook.metadata.system,
      systemEvidence: option("--evidence"),
      brandName: option("--display-name") || null,
      brandEvidence: option("--name-evidence") || null,
    });
    fs.mkdirSync(path.join(dir, "review"), { recursive: true, mode: 0o700 });
    const target = path.join(dir, "review", "preview-" + p.id + ".json");
    fs.writeFileSync(target, JSON.stringify(p, null, 2), { mode: 0o600 });
    console.log(
      JSON.stringify(
        {
          previewId: p.id,
          privatePreviewFile: target,
          companyInSource: p.companyName,
          displayName: p.brandName,
          unit: p.unit,
          system: p.system,
          records: p.rows.length,
          actions: p.rows.reduce(
            (a, r) => ((a[r.action] = (a[r.action] || 0) + 1), a),
            {},
          ),
          warnings: p.warnings,
        },
        null,
        2,
      ),
    );
  }
} finally {
  s.close();
}
