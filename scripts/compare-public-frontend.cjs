'use strict';

// Public GET comparison only. Default is --plan (no network).
// Notebook: node scripts/compare-public-frontend.cjs --live
// No assets/config bodies, authentication, backups, or app writes are retained.
// Exit0 means completed comparison (possibly the old baseline), not release approval;
// exit2 means inconclusive/partial, exit1 means local planning/execution error.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const ORIGIN = 'https://app.piresintegridade.com.br';
const ADDITIONS = Object.freeze(['gestao-inspection.css', 'gestao-inspection.js', 'gestao-tag-report.js']);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const coded = code => Object.assign(new Error(code), { code });
const localCanonicalPlans = new WeakSet();
function freezeTree(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeTree(child); Object.freeze(value); }
  return value;
}

function validateOrigin(origin) {
  if (origin !== ORIGIN) throw coded('ORIGIN_NOT_ALLOWED');
  return origin;
}

function safePublicPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(?:html|js|css|jpeg|ttf|txt)$/.test(value)) {
    throw coded('PUBLIC_PATH_NOT_ALLOWED');
  }
  return value;
}

function buildPlan(root, origin = ORIGIN) {
  validateOrigin(origin);
  const baselinePath = path.join(root, 'release', 'published-manifest.json');
  if (fs.statSync(baselinePath).size > 128 * 1024) throw coded('BASELINE_TOO_LARGE');
  const manifestBytes = fs.readFileSync(baselinePath);
  const rows = JSON.parse(manifestBytes.toString('utf8'));
  if (!Array.isArray(rows) || rows.length !== 61 || new Set(rows.map(row => row.path)).size !== 61) throw coded('BASELINE_COUNT_INVALID');
  for (const row of rows) {
    if (row.path !== '_headers') safePublicPath(row.path);
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 0) throw coded('BASELINE_ROW_INVALID');
  }
  if (!rows.some(row => row.path === '_headers') || !rows.some(row => row.path === 'runtime-config.js')) throw coded('BASELINE_SPECIAL_FILES_MISSING');
  const baseline = rows.filter(row => !['_headers', 'runtime-config.js'].includes(row.path));
  if (baseline.length !== 59 || ADDITIONS.some(name => rows.some(row => row.path === name))) throw coded('BASELINE_STATIC_COUNT_INVALID');
  const appRoot = fs.realpathSync(path.join(root, 'app'));
  const files = [...baseline.map(row => row.path), ...ADDITIONS].sort().map(name => {
    safePublicPath(name);
    const filename = path.join(appRoot, name);
    const real = fs.realpathSync(filename);
    if (!real.startsWith(appRoot + path.sep) || fs.lstatSync(filename).isSymbolicLink()) throw coded('CANDIDATE_PATH_NOT_REGULAR');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > MAX_BODY_BYTES) throw coded('CANDIDATE_SIZE_INVALID');
    const bytes = fs.readFileSync(real);
    const old = baseline.find(row => row.path === name);
    return { path: name, url: origin + '/' + name, kind: 'static', candidateSha256: sha256(bytes), candidateBytes: bytes.length,
      baselineSha256: old?.sha256 ?? null, baselineBytes: old?.bytes ?? null };
  });
  if (files.length !== 62) throw coded('CANDIDATE_STATIC_COUNT_INVALID');
  const runtime = rows.find(row => row.path === 'runtime-config.js');
  let sourceHead = null;
  try { sourceHead = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Local bytes remain authoritative. */ }
  const plan = { origin, sourceHead, baselineManifestSha256: sha256(manifestBytes), counts: { baselineManifest: 61, baselineStatic: 59,
    candidateStatic: 62, publicUrlsIncludingRuntime: 63, completeArchiveIncludingHeaders: 64 }, files,
    candidateStaticDiff: { unchanged: files.filter(file => file.candidateSha256 === file.baselineSha256).length,
      changed: files.filter(file => file.baselineSha256 && file.candidateSha256 !== file.baselineSha256).length,
      added: files.filter(file => !file.baselineSha256).length },
    runtime: { path: 'runtime-config.js', url: origin + '/runtime-config.js', kind: 'runtime_metadata', baselineSha256: runtime.sha256 },
    expectedFetchUrls: [...files.map(file => file.url), origin + '/runtime-config.js'],
    limits: { maxBodyBytes: MAX_BODY_BYTES, requestTimeoutMs: TIMEOUT_MS, maxRedirects: 2 },
    exclusions: ['_headers is archive metadata, not a public GET target', 'tracked app/runtime-config.js is never read or evaluated'] };
  freezeTree(plan);
  localCanonicalPlans.add(plan);
  return plan;
}

function canonicalRedirect(from, location, originalPath, count) {
  if (count >= 2 || typeof location !== 'string' || /[\u0000-\u0020\\?#]/.test(location)) throw coded('REDIRECT_NOT_ALLOWED');
  const next = new URL(location, from);
  if (next.origin !== ORIGIN || next.username || next.password || next.search || next.hash) throw coded('REDIRECT_NOT_ALLOWED');
  if (!originalPath.endsWith('.html')) throw coded('REDIRECT_NOT_CANONICAL_HTML');
  const canonical = originalPath === 'index.html' ? '/' : '/' + originalPath.slice(0, -5);
  const fromUrl = new URL(from);
  if (next.pathname !== canonical || fromUrl.pathname !== '/' + originalPath) throw coded('REDIRECT_NOT_CANONICAL_HTML');
  return next.href;
}

function acceptableMime(filename, header) {
  const mime = String(header || '').split(';')[0].trim().toLowerCase();
  const table = { '.js': ['text/javascript', 'application/javascript', 'application/x-javascript', 'text/ecmascript', 'application/ecmascript'],
    '.css': ['text/css'], '.html': ['text/html', 'application/xhtml+xml'], '.jpeg': ['image/jpeg'],
    '.ttf': ['font/ttf', 'application/x-font-ttf', 'application/font-sfnt', 'application/octet-stream'], '.txt': ['text/plain'] };
  return Boolean(table[path.extname(filename)]?.includes(mime));
}

async function readBounded(response, maxBytes) {
  const size = response.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > maxBytes)) throw coded('BODY_TOO_LARGE');
  if (!response.body?.getReader) throw coded('BODY_STREAM_REQUIRED');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw coded('BODY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { try { await reader.cancel(); } catch {} throw error; }
  finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

async function inspectFile(file, { fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BODY_BYTES } = {}) {
  safePublicPath(file.path);
  if (file.url !== ORIGIN + '/' + file.path) throw coded('FETCH_URL_NOT_ALLOWED');
  const controller = new AbortController();
  let timer;
  const state = { status: null, redirects: 0 };
  const task = async () => {
    let url = file.url;
    for (;;) {
      const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store',
        referrerPolicy: 'no-referrer', headers: { Accept: '*/*' }, signal: controller.signal });
      state.status = response.status;
      if (response.url && response.url !== url) throw coded('UNEXPECTED_RESPONSE_URL');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        try { await response.body?.cancel(); } catch {}
        url = canonicalRedirect(url, response.headers.get('location'), file.path, state.redirects++);
        continue;
      }
      if (response.status !== 200 && !(response.status === 404 && file.path === '404.html')) {
        try { await response.body?.cancel(); } catch {}
        return { path: file.path, status: response.status, classification: response.status === 404 ? 'missing' : 'http_error', redirects: state.redirects };
      }
      const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw coded('HTML_CHALLENGE');
      if (!acceptableMime(file.path, mime)) throw coded('MIME_NOT_ALLOWED');
      const bytes = await readBounded(response, maxBytes);
      const probe = bytes.subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '');
      if ((!file.path.endsWith('.html') && /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(probe)) ||
        /(?:cf-chl-|\/cdn-cgi\/challenge-platform\/|<title>\s*(?:just a moment|attention required))/i.test(probe)) throw coded('HTML_CHALLENGE');
      const hash = sha256(bytes);
      const candidate = hash === file.candidateSha256;
      const baseline = hash === file.baselineSha256;
      return { path: file.path, status: response.status, bytes: bytes.length, mime, sha256: hash, redirects: state.redirects,
        classification: file.kind === 'runtime_metadata' ? (baseline ? 'baseline_config_hash' : 'different_config_hash') :
          (candidate && baseline ? 'candidate_and_baseline' : candidate ? 'candidate' : baseline ? 'baseline' : 'unknown'),
        candidateMatch: file.kind === 'static' ? candidate : undefined, baselineMatch: baseline };
    }
  };
  try {
    return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(coded('REQUEST_TIMEOUT')); }, timeoutMs); })]);
  } catch (error) {
    const allowed = ['REDIRECT_NOT_ALLOWED', 'REDIRECT_NOT_CANONICAL_HTML', 'UNEXPECTED_RESPONSE_URL', 'BODY_TOO_LARGE',
      'BODY_STREAM_REQUIRED', 'HTML_CHALLENGE', 'MIME_NOT_ALLOWED', 'REQUEST_TIMEOUT'];
    return { path: file.path, status: state.status, classification: 'blocked_or_unreadable', errorCode: allowed.includes(error.code) ? error.code : 'FETCH_OR_STREAM_FAILED', redirects: state.redirects };
  } finally { clearTimeout(timer); controller.abort(); }
}

function classifyStatic(files, results) {
  const allCandidate = results.length === files.length && results.every(row => ['candidate', 'candidate_and_baseline'].includes(row.classification));
  if (allCandidate) return 'matches_candidate_static';
  const baseline = results.length === files.length && results.every((row, i) => files[i].baselineSha256 ?
    ['baseline', 'candidate_and_baseline'].includes(row.classification) : row.classification === 'missing');
  if (baseline) return 'matches_baseline_static_new_assets_absent';
  return 'mixed_or_inconclusive';
}

async function comparePublic(plan, options = {}) {
  validateOrigin(plan.origin);
  if (options.fixture && typeof options.fetchImpl !== 'function') throw coded('FIXTURE_TRANSPORT_REQUIRED');
  if (options.fetchImpl && options.fixture !== true) throw coded('CUSTOM_TRANSPORT_REQUIRES_FIXTURE');
  if (!options.fixture && !localCanonicalPlans.has(plan)) throw coded('LIVE_PLAN_MUST_BE_BUILT_LOCALLY');
  const results = [];
  let stopped = null;
  for (const file of plan.files) {
    const expected = { candidateSha256: file.candidateSha256, baselineSha256: file.baselineSha256 };
    if (stopped) { results.push({ path: file.path, classification: 'not_requested', reason: stopped, ...expected }); continue; }
    const row = await inspectFile(file, options);
    results.push({ ...row, ...expected });
    // Do not repeat a denied/challenged/broken transfer against the other paths.
    if (row.errorCode || [401, 403, 429].includes(row.status) || row.status >= 500) stopped = row.errorCode || 'HTTP_' + row.status;
  }
  const runtime = stopped ? { path: plan.runtime.path, classification: 'not_requested', reason: stopped } : await inspectFile(plan.runtime, options);
  const counts = {};
  for (const row of results) counts[row.classification] = (counts[row.classification] || 0) + 1;
  return { schemaVersion: 1, kind: 'public_readonly_frontend_comparison', transport: options.fixture ? 'FIXTURE_FAKE_FETCH' : 'PUBLIC_GET',
    checkedAtUtc: new Date().toISOString(), origin: plan.origin, sourceHead: plan.sourceHead, baselineManifestSha256: plan.baselineManifestSha256,
    counts: plan.counts, candidateStaticDiff: plan.candidateStaticDiff, expectedFetchUrls: plan.expectedFetchUrls, classification: classifyStatic(plan.files, results), classificationCounts: counts,
    results, stoppedAfterError: stopped, runtimeConfig: { ...runtime, valuesCollected: false, evaluated: false, baselineSha256: plan.runtime.baselineSha256 },
    limits: plan.limits, authenticatedFlowTested: false, headersFileFetched: false, assetBodiesSaved: false,
    limitations: ['Hashes compare current public bytes only; no application login, backend, permissions, or inspection flow is tested.',
      'Shared hashes cannot distinguish the candidate from the baseline; runtime hash is separate and its configuration values are not inspected.'] };
}

async function main(args) {
  let root = path.resolve(__dirname, '..'); let origin = ORIGIN; let live = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--live') live = true;
    else if (args[i] === '--plan') { if (args.includes('--live')) throw coded('CHOOSE_PLAN_OR_LIVE'); }
    else if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
    else if (args[i] === '--origin' && args[i + 1]) origin = args[++i];
    else throw coded('ARGUMENT_NOT_ALLOWED');
  }
  const plan = buildPlan(root, origin);
  const report = live ? await comparePublic(plan) : { ...plan, transport: 'NOT_RUN', mode: 'PLAN_ONLY', assetBodiesSaved: false };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (live && (report.classification === 'mixed_or_inconclusive' || report.runtimeConfig.status !== 200 || report.runtimeConfig.errorCode)) process.exitCode = 2;
}

module.exports = { ORIGIN, ADDITIONS, buildPlan, safePublicPath, validateOrigin, canonicalRedirect, acceptableMime, inspectFile, classifyStatic, comparePublic, sha256 };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  process.stderr.write(JSON.stringify({ errorCode: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'LOCAL_PLAN_OR_EXECUTION_FAILED', transport: 'NOT_COMPLETED', valuesCollected: false }) + '\n');
  process.exitCode = 1;
});
