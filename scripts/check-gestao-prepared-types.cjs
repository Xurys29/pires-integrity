'use strict';
// Public, compile-only regression runner. It never runs the application or reads
// private originals. Deno must already exist; nothing is installed or downloaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');

const EXPECTED_CORE_SHA256 = '6e1bcae933c1797bf8db44fc778e41e0e7e6cba04c9054737cc87d24a59b0ccb';
// Public Git core at c650c03, before the type annotation. This is not a claim
// about the bytes of the deployed v6 bundle.
const EXPECTED_BASELINE_SHA256 = '16674a553adf197ae57c40dfe81c774b369375ba11ed66635a8af4feec47cff3';
const PREFIX = 'pires-prepared-types-';
const IMPORT = '../../supabase/functions/_shared/gestao-api-core.mjs';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const plain = value => String(value || '').replace(/\x1b\[[0-9;]*m/g, '');
function blocked(code, details = {}) { const error = new Error(code); error.code = code; error.details = details; throw error; }
function readFile(filename) {
  try { if (!fs.statSync(filename).isFile()) blocked('input_not_file'); return fs.readFileSync(filename); }
  catch (error) { if (error.code === 'input_not_file') throw error; blocked('input_unreadable'); }
}
function requireFileMetadata(filename) {
  try { if (!fs.statSync(filename).isFile()) blocked('input_not_file'); }
  catch (error) { if (error.code === 'input_not_file') throw error; blocked('input_unreadable'); }
}
function parseArguments(args) {
  const options = {};
  const names = { '--deno': 'denoPath', '--core': 'corePath', '--baseline-core': 'baselineCorePath' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' && args.length === 1) return { help: true };
    const key = names[args[i]];
    if (!key || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) blocked('invalid_arguments');
    options[key] = args[++i];
  }
  if (!options.denoPath) blocked('existing_deno_required');
  return options;
}
function buildCompilerPlan(workspace, includeBaseline = false) {
  const types = path.join(workspace, 'tests', 'types');
  const cases = [
    { id: 'positive', entry: path.join(types, 'gestao-prepared-sources.ts'), expectation: 'success', codes: [] },
    ...['invalid-id', 'invalid-name', 'missing-name', 'unknown-input'].map(id => ({
      id, entry: path.join(types, id + '.ts'), expectation: 'type_error', codes: ['TS2322', 'TS2741', 'TS2345'],
    })),
  ];
  if (includeBaseline) cases.push({
    id: 'baseline', entry: path.join(workspace, 'baseline', 'tests', 'types', 'gestao-prepared-sources.ts'),
    expectation: 'type_error', codes: ['TS2322', 'TS2344', 'TS4104'],
  });
  return cases.map(item => ({ ...item, args: ['check', '--no-config', '--no-lock', '--cached-only', item.entry] }));
}
function negativeSources() {
  const header = 'import { createGestaoHandler } from "' + IMPORT + '";\n' +
    'type Reference = NonNullable<Parameters<typeof createGestaoHandler>[0]["preparedSources"]>[number];\n';
  return {
    'invalid-id': header + 'export const invalid: Reference = { id: 17, name: "FIXTURE-ONLY.pdf" };\n',
    'invalid-name': header + 'export const invalid: Reference = { id: "fixture", name: 17 };\n',
    'missing-name': header + 'export const invalid: Reference = { id: "fixture" };\n',
    'unknown-input': header + 'declare const untrusted: unknown;\nexport const invalid: Reference = untrusted;\n',
  };
}
function stage(root, core, fixture) {
  const coreCopy = path.join(root, 'supabase', 'functions', '_shared', 'gestao-api-core.mjs');
  const fixtureCopy = path.join(root, 'tests', 'types', 'gestao-prepared-sources.ts');
  for (const [target, bytes] of [[coreCopy, core], [fixtureCopy, fixture]]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
    if (sha(fs.readFileSync(target)) !== sha(bytes)) blocked('staged_identity_mismatch');
  }
  return { coreCopy, fixtureCopy };
}
function processResult(result) {
  const diagnostics = plain((result.stdout || '') + (result.stderr || ''));
  const codes = [...new Set(diagnostics.match(/TS\d{4,5}/g) || [])];
  return { exitCode: result.status, signal: result.signal || null, processError: result.error ? String(result.error.code || 'process_error') : null, codes, diagnostics };
}
function removeOwned(root, tempRoot, nonce) {
  const real = fs.realpathSync(root);
  if (path.dirname(real) !== fs.realpathSync(tempRoot) || !path.basename(real).startsWith(PREFIX)) blocked('cleanup_ownership_failed');
  const marker = JSON.parse(fs.readFileSync(path.join(real, '.owner.json'), 'utf8'));
  if (marker.nonce !== nonce) blocked('cleanup_ownership_failed');
  fs.rmSync(real, { recursive: true, force: false });
}
function runPreparedTypesCheck(options) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const referenceCore = path.join(repoRoot, 'supabase', 'functions', '_shared', 'gestao-api-core.mjs');
  const fixturePath = path.join(repoRoot, 'tests', 'types', 'gestao-prepared-sources.ts');
  const corePath = path.resolve(options.corePath || referenceCore);
  const denoPath = path.resolve(options.denoPath || '');
  if (!options.denoPath) blocked('existing_deno_required');
  requireFileMetadata(denoPath);
  const core = readFile(corePath), fixture = readFile(fixturePath);
  const coreHash = sha(core);
  if (coreHash !== EXPECTED_CORE_SHA256) blocked('core_hash_mismatch', { expected: EXPECTED_CORE_SHA256, actual: coreHash });
  const text = fixture.toString('utf8');
  if (!text.includes('from "' + IMPORT + '"') || /@ts-(?:ignore|expect-error|nocheck)\b|\bas\s+any\b/.test(text)) blocked('unexpected_positive_fixture');
  const resolvedOriginal = fileURLToPath(new URL(IMPORT, pathToFileURL(fixturePath)));
  const originalCore = readFile(resolvedOriginal);
  const inputs = new Map([[corePath, coreHash], [fixturePath, sha(fixture)], [resolvedOriginal, sha(originalCore)]]);
  const baselinePath = options.baselineCorePath ? path.resolve(options.baselineCorePath) : null;
  let baseline;
  if (baselinePath) {
    baseline = readFile(baselinePath);
    if (sha(baseline) !== EXPECTED_BASELINE_SHA256) blocked('baseline_hash_mismatch', { actual: sha(baseline) });
    inputs.set(baselinePath, sha(baseline));
  }
  const spawn = options.spawn || cp.spawnSync;
  const tempRoot = path.resolve(options.tempRoot || os.tmpdir());
  const spawnOptions = { cwd: tempRoot, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false };
  const version = spawn(denoPath, ['--version'], spawnOptions);
  const versionText = plain(version.stdout);
  if (version.error || version.status !== 0 || version.signal || !/^deno \d+\.\d+\.\d+(?:[^\r\n]*)$/m.test(versionText)) blocked('compiler_identification_failed');
  const workspace = fs.mkdtempSync(path.join(tempRoot, PREFIX)), nonce = crypto.randomUUID();
  fs.writeFileSync(path.join(workspace, '.owner.json'), JSON.stringify({ nonce }), { flag: 'wx' });
  const report = {
    allPass: false, compilerFixture: spawn !== cp.spawnSync, compiler: versionText.trim(),
    corePath, coreSha256: coreHash, fixturePath, fixtureSha256: sha(fixture),
    originalFixtureResolvedCore: { path: resolvedOriginal, sha256: sha(originalCore), matchesCandidate: sha(originalCore) === coreHash },
    baseline: baseline ? { path: baselinePath, sha256: sha(baseline), reference: 'Public Git c650c03 before the type annotation; not deployed-bundle proof' } : null,
    workspace, copiedBytesUnchanged: false, originalInputsUnchanged: false, cleanupSucceeded: false, cases: [], notRun: [],
  };
  try {
    const copied = stage(workspace, core, fixture);
    if (baseline) stage(path.join(workspace, 'baseline'), baseline, fixture);
    for (const [id, source] of Object.entries(negativeSources())) fs.writeFileSync(path.join(workspace, 'tests', 'types', id + '.ts'), source, { flag: 'wx' });
    report.copiedBytesUnchanged = sha(fs.readFileSync(copied.coreCopy)) === coreHash && sha(fs.readFileSync(copied.fixtureCopy)) === sha(fixture);
    const plan = buildCompilerPlan(workspace, Boolean(baseline));
    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      let result;
      try { result = processResult(spawn(denoPath, item.args, { ...spawnOptions, cwd: workspace })); }
      catch { result = { exitCode: null, signal: null, processError: 'compiler_process_threw', codes: [], diagnostics: '' }; }
      const launched = !result.processError && !result.signal && Number.isInteger(result.exitCode);
      const basename = path.basename(item.entry).replaceAll('.', '[.]');
      const ownEntryMentioned = new RegExp(basename + '(?::[0-9]+:[0-9]+|[(][0-9]+,[0-9]+[)])').test(result.diagnostics);
      const passed = launched && (item.expectation === 'success'
        ? result.exitCode === 0 && result.codes.length === 0
        : result.exitCode !== 0 && result.codes.length > 0 && result.codes.every(code => item.codes.includes(code)) && ownEntryMentioned);
      report.cases.push({ id: item.id, expectation: item.expectation, passed, ...result });
      if (!passed) { report.notRun = plan.slice(i + 1).map(next => next.id); break; }
    }
    report.originalInputsUnchanged = [...inputs].every(([filename, digest]) => {
      try { return sha(fs.readFileSync(filename)) === digest; } catch { return false; }
    });
  } catch (error) { report.preparationError = error.code || 'runner_preparation_failed'; }
  finally {
    try { removeOwned(workspace, tempRoot, nonce); report.cleanupSucceeded = true; }
    catch { report.cleanupError = 'cleanup_ownership_or_removal_failed'; }
  }
  report.allPass = !report.preparationError && report.copiedBytesUnchanged && report.originalInputsUnchanged &&
    report.cleanupSucceeded && report.notRun.length === 0 && report.cases.length === (baseline ? 6 : 5) && report.cases.every(item => item.passed);
  return report;
}
if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) console.log('node scripts/check-gestao-prepared-types.cjs --deno EXISTING_DENO_PATH [--core COMPOSED_CORE_PATH] [--baseline-core OLD_PUBLIC_CORE_PATH]');
    else { const report = runPreparedTypesCheck(options); console.log(JSON.stringify(report, null, 2)); if (!report.allPass) process.exitCode = 1; }
  } catch (error) { console.log(JSON.stringify({ allPass: false, blocked: true, reason: error.code || 'runner_failed', details: error.details || {} })); process.exitCode = 1; }
}
module.exports = { EXPECTED_CORE_SHA256, EXPECTED_BASELINE_SHA256, parseArguments, buildCompilerPlan, runPreparedTypesCheck };

