'use strict';
// All process responses below are compiler fixtures. These tests do not run Deno.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { parseArguments, buildCompilerPlan, runPreparedTypesCheck, EXPECTED_CORE_SHA256 } = require('../scripts/check-gestao-prepared-types.cjs');
const repoRoot = path.resolve(__dirname, '..');
const core = path.join(repoRoot, 'supabase/functions/_shared/gestao-api-core.mjs');
const fixture = path.join(repoRoot, 'tests/types/gestao-prepared-sources.ts');
const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function scope(t) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pires-prepared-runner-unit-'));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: false }));
  return tempRoot;
}
function compilerFixture(alter = () => undefined) {
  const calls = [];
  const spawn = (_program, args, options) => {
    calls.push({ args: [...args], cwd: options.cwd, shell: options.shell });
    if (args[0] === '--version') return { status: 0, stdout: 'deno 2.9.8 (COMPILER FIXTURE ONLY)\n', stderr: '' };
    const entry = args.at(-1), id = path.basename(entry).replace('.ts', '');
    const changed = alter({ id, entry, args, options });
    if (changed) return changed;
    if (id === 'gestao-prepared-sources') return { status: 0, stdout: '', stderr: '' };
    const code = id === 'missing-name' ? 'TS2741' : 'TS2322';
    return { status: 1, stdout: '', stderr: code + ' [ERROR]: deliberate compiler fixture\n at ' + pathToFileURL(entry).href + ':1:1\n' };
  };
  return { spawn, calls };
}
function run(t, fake, extra = {}) {
  const tempRoot = scope(t);
  const report = runPreparedTypesCheck({ denoPath: process.execPath, repoRoot, tempRoot, spawn: fake.spawn, ...extra });
  return { report, tempRoot };
}
test('prepared type runner plan pins config-free cached-only checks and separate negative entries', () => {
  const plan = buildCompilerPlan(path.resolve('fixture-workspace'));
  assert.deepEqual(plan.map(item => item.id), ['positive', 'invalid-id', 'invalid-name', 'missing-name', 'unknown-input']);
  for (const item of plan) assert.deepEqual(item.args.slice(0, 4), ['check', '--no-config', '--no-lock', '--cached-only']);
  assert.equal(buildCompilerPlan(path.resolve('fixture-workspace'), true).at(-1).id, 'baseline');
});
test('prepared type runner requires explicit existing compiler and rejects ambiguous CLI arguments', () => {
  assert.throws(() => parseArguments([]), { code: 'existing_deno_required' });
  assert.throws(() => parseArguments(['--deno', 'one', '--deno', 'two']), { code: 'invalid_arguments' });
  assert.throws(() => parseArguments(['--deno']), { code: 'invalid_arguments' });
  assert.throws(() => parseArguments(['--other', 'one']), { code: 'invalid_arguments' });
  assert.deepEqual(parseArguments(['--help']), { help: true });
});
test('prepared type runner compiler fixtures pass all five checks and remove only their own staged copies', t => {
  const before = [digest(core), digest(fixture)], fake = compilerFixture();
  const { report, tempRoot } = run(t, fake);
  assert.equal(report.compilerFixture, true);
  assert.equal(report.allPass, true);
  assert.equal(report.coreSha256, EXPECTED_CORE_SHA256);
  assert.equal(report.copiedBytesUnchanged, true);
  assert.equal(report.originalInputsUnchanged, true);
  assert.equal(report.originalFixtureResolvedCore.matchesCandidate, true);
  assert.equal(report.cleanupSucceeded, true);
  assert.equal(fs.existsSync(report.workspace), false);
  assert.deepEqual(fs.readdirSync(tempRoot), []);
  assert.deepEqual([digest(core), digest(fixture)], before);
  assert.equal(fake.calls.length, 6);
  assert.ok(fake.calls.every(call => call.shell === false));
});
test('prepared type runner never accepts a failed positive check as a successful rejection', t => {
  const fake = compilerFixture(({ id, entry }) => id === 'gestao-prepared-sources' ? { status: 1, stderr: 'TS2322 at ' + entry + ':1:1' } : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].passed, false);
  assert.equal(report.notRun.length, 4);
  assert.equal(report.cleanupSucceeded, true);
});
test('prepared type runner rejects a zero-exit positive process that still reports type diagnostics', t => {
  const fake = compilerFixture(({ id, entry }) => id === 'gestao-prepared-sources' ? { status: 0, stderr: 'TS2322 at ' + entry + ':1:1' } : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases[0].passed, false);
  assert.equal(report.cleanupSucceeded, true);
});
test('prepared type runner requires negative checks to fail rather than merely print a diagnostic', t => {
  const fake = compilerFixture(({ id, entry }) => id === 'invalid-id' ? { status: 0, stderr: 'TS2322 at ' + entry + ':1:1' } : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases[1].passed, false);
  assert.equal(report.cleanupSucceeded, true);
});
test('prepared type runner does not approve missing-module errors as contract rejections', t => {
  const fake = compilerFixture(({ id, entry }) => id === 'invalid-id' ? { status: 1, stderr: 'TS2307 at ' + entry + ':1:1' } : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases[1].passed, false);
  assert.equal(report.cleanupSucceeded, true);
});
test('prepared type runner requires the diagnostic location to name the negative entry, not a Check banner', t => {
  const fake = compilerFixture(({ id, entry }) => id === 'invalid-id' ? { status: 1, stderr: 'Check ' + entry + '\nTS2322 at unrelated.ts:1:1' } : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases[1].passed, false);
  assert.equal(report.cleanupSucceeded, true);
});
for (const [label, failure] of [
  ['ENOENT', { status: null, error: { code: 'ENOENT' }, stderr: '' }],
  ['timeout', { status: null, signal: 'SIGTERM', error: { code: 'ETIMEDOUT' }, stderr: '' }],
]) test('prepared type runner rejects process ' + label + ' and still cleans its own workspace', t => {
  const fake = compilerFixture(({ id }) => id === 'invalid-id' ? failure : undefined);
  const { report } = run(t, fake);
  assert.equal(report.allPass, false);
  assert.equal(report.cases[1].passed, false);
  assert.equal(report.cleanupSucceeded, true);
});
test('prepared type runner rejects a changed core before invoking any compiler', t => {
  const tempRoot = scope(t), changed = path.join(tempRoot, 'changed-public-core.mjs');
  fs.writeFileSync(changed, 'export const notThePinnedCore = true;\n');
  const fake = compilerFixture();
  assert.throws(() => runPreparedTypesCheck({ denoPath: process.execPath, corePath: changed, repoRoot, tempRoot, spawn: fake.spawn }), { code: 'core_hash_mismatch' });
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(fs.readdirSync(tempRoot), ['changed-public-core.mjs']);
});
test('prepared type runner refuses an unrecognized baseline without fetching or rewriting it', t => {
  const tempRoot = scope(t), baseline = path.join(tempRoot, 'unknown-baseline.mjs');
  fs.writeFileSync(baseline, '// deliberately not the known public baseline\n');
  const before = digest(baseline), fake = compilerFixture();
  assert.throws(() => runPreparedTypesCheck({ denoPath: process.execPath, baselineCorePath: baseline, repoRoot, tempRoot, spawn: fake.spawn }), { code: 'baseline_hash_mismatch' });
  assert.equal(fake.calls.length, 0);
  assert.equal(digest(baseline), before);
});
test('prepared type runner rejects compiler identification failure before making a workspace', t => {
  const tempRoot = scope(t);
  assert.throws(() => runPreparedTypesCheck({ denoPath: process.execPath, repoRoot, tempRoot, spawn: () => ({ status: null, error: { code: 'ENOENT' } }) }), { code: 'compiler_identification_failed' });
  assert.deepEqual(fs.readdirSync(tempRoot), []);
});
test('prepared type runner detects input changes during checks without altering repository sources', t => {
  const tempRoot = scope(t), supplied = path.join(tempRoot, 'supplied-public-core.mjs');
  fs.copyFileSync(core, supplied);
  const repoBefore = digest(core), fake = compilerFixture(({ id }) => {
    if (id === 'gestao-prepared-sources') fs.appendFileSync(supplied, '\n// change only this unit-owned supplied copy\n');
  });
  const report = runPreparedTypesCheck({ denoPath: process.execPath, corePath: supplied, repoRoot, tempRoot, spawn: fake.spawn });
  assert.equal(report.allPass, false);
  assert.equal(report.originalInputsUnchanged, false);
  assert.equal(report.cleanupSucceeded, true);
  assert.equal(digest(core), repoBefore);
});
test('prepared type runner does not delete a workspace whose ownership marker was changed', t => {
  const tempRoot = scope(t), sentinel = path.join(tempRoot, 'unrelated-sentinel.txt');
  fs.writeFileSync(sentinel, 'belongs to this unit test only');
  let changed = false;
  const fake = compilerFixture(({ options }) => {
    if (!changed) { changed = true; fs.writeFileSync(path.join(options.cwd, '.owner.json'), JSON.stringify({ nonce: 'different-owner' })); }
  });
  const report = runPreparedTypesCheck({ denoPath: process.execPath, repoRoot, tempRoot, spawn: fake.spawn });
  assert.equal(report.allPass, false);
  assert.equal(report.cleanupSucceeded, false);
  assert.equal(fs.existsSync(report.workspace), true);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'belongs to this unit test only');
});

