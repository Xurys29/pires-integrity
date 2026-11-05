'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ORIGIN, buildPlan, safePublicPath, validateOrigin, canonicalRedirect, inspectFile, classifyStatic, comparePublic, sha256 } = require('../scripts/compare-public-frontend.cjs');
const root = path.resolve(__dirname, '..');
const file = (name = 'fixture.js', body = '/* FIXTURE ONLY */', baseline = null) => ({ path: name, url: ORIGIN + '/' + name,
  kind: 'static', candidateSha256: sha256(body), baselineSha256: baseline === null ? null : sha256(baseline) });
const response = (body, mime = 'application/javascript', options = {}) => new Response(body, { status: 200, headers: { 'content-type': mime }, ...options });

test('local real manifest has 61 rows, 59 baseline static, 62 candidate static and 63 GET targets', () => {
  const p = buildPlan(root);
  assert.deepEqual(p.counts, { baselineManifest: 61, baselineStatic: 59, candidateStatic: 62, publicUrlsIncludingRuntime: 63, completeArchiveIncludingHeaders: 64 });
  assert.equal(p.expectedFetchUrls.length, 63);
  assert.equal(new Set(p.expectedFetchUrls).size, 63);
  assert.ok(p.expectedFetchUrls.every(url => url.startsWith(ORIGIN + '/')));
  assert.ok(!p.expectedFetchUrls.some(url => url.endsWith('/_headers')));
  assert.ok(!p.files.some(row => row.path === 'runtime-config.js'));
  assert.equal(p.runtime.kind, 'runtime_metadata');
  // Auth sharing changes cloud.js and equipe-api.js in addition to the prior11.
  assert.deepEqual(p.candidateStaticDiff, { unchanged: 46, changed: 13, added: 3 });
  assert.equal(Object.isFrozen(p), true); assert.equal(Object.isFrozen(p.files[0]), true);
});
test('origin and paths refuse alternate destinations, traversal, signed/query and encoded paths', () => {
  for (const value of [ORIGIN + '/', 'http://app.piresintegridade.com.br', 'https://example.invalid', ORIGIN + '?token=redacted']) assert.throws(() => validateOrigin(value));
  for (const value of ['../fixture.js', '/fixture.js', 'fixture.js?token=redacted', 'fixture.js#x', 'a%2fb.js', '_headers', 'a\\b.js']) assert.throws(() => safePublicPath(value));
  assert.equal(safePublicPath('assets/FIXTURE-file.ttf'), 'assets/FIXTURE-file.ttf');
});
test('GET options omit credentials, authentication, redirects and cache; matching candidate is hashed', async () => {
  const f = file();
  const r = await inspectFile(f, { fetchImpl: async (url, init) => {
    assert.equal(url, f.url); assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store'); assert.equal(init.referrerPolicy, 'no-referrer'); assert.deepEqual(init.headers, { Accept: '*/*' });
    return response('/* FIXTURE ONLY */');
  } });
  assert.equal(r.classification, 'candidate'); assert.equal(r.status, 200);
});
test('baseline and shared bytes are distinguished without returning their bodies', async () => {
  const r = await inspectFile(file('fixture.js', 'candidate fixture', 'old fixture'), { fetchImpl: async () => response('old fixture') });
  assert.equal(r.classification, 'baseline'); assert.ok(!JSON.stringify(r).includes('old fixture'));
  const same = await inspectFile(file('fixture.js', 'same fixture', 'same fixture'), { fetchImpl: async () => response('same fixture') });
  assert.equal(same.classification, 'candidate_and_baseline');
});
test('new asset 404 is recorded as missing and not misclassified by fallback response body', async () => {
  const r = await inspectFile(file(), { fetchImpl: async () => response('not read', 'text/html', { status: 404 }) });
  assert.equal(r.classification, 'missing'); assert.equal(r.status, 404); assert.equal(r.sha256, undefined);
});
test('explicit 404 document can match its bytes with status404 without accepting missing JS as a document', async () => {
  const body = '<html>FIXTURE custom404</html>';
  const r = await inspectFile(file('404.html', body), { fetchImpl: async () => response(body, 'text/html', { status: 404 }) });
  assert.equal(r.status, 404); assert.equal(r.classification, 'candidate');
});
test('only same-origin canonical HTML redirects are allowed', async () => {
  const f = file('gestao.html', '<html>FIXTURE</html>'); const seen = [];
  const r = await inspectFile(f, { fetchImpl: async url => {
    seen.push(url);
    return seen.length === 1 ? new Response(null, { status: 301, headers: { location: '/gestao' } }) : response('<html>FIXTURE</html>', 'text/html');
  } });
  assert.deepEqual(seen, [ORIGIN + '/gestao.html', ORIGIN + '/gestao']); assert.equal(r.classification, 'candidate');
  assert.equal(canonicalRedirect(ORIGIN + '/index.html', '/', 'index.html', 0), ORIGIN + '/');
});
test('redirects reject other origin, query, fragments, noncanonical targets and script redirects', () => {
  for (const location of ['https://example.invalid/gestao', '/gestao?sig=redacted', '/gestao?', '/gestao#', '/gestao#x', '/login', '//example.invalid/gestao', '/ge stao', 'https://user:pass@app.piresintegridade.com.br/gestao']) {
    assert.throws(() => canonicalRedirect(ORIGIN + '/gestao.html', location, 'gestao.html', 0));
  }
  assert.throws(() => canonicalRedirect(ORIGIN + '/fixture.js', '/fixture', 'fixture.js', 0));
  assert.throws(() => canonicalRedirect(ORIGIN + '/gestao.html', '/gestao', 'gestao.html', 2));
});
test('blocked redirect response records only sanitized code and makes no second request', async () => {
  let requests = 0;
  const r = await inspectFile(file('gestao.html'), { fetchImpl: async () => { requests++; return new Response(null, { status: 302, headers: { location: ORIGIN + '/gestao?secret=DO_NOT_RETURN' } }); } });
  assert.equal(requests, 1); assert.equal(r.errorCode, 'REDIRECT_NOT_ALLOWED'); assert.ok(!JSON.stringify(r).includes('DO_NOT_RETURN'));
});
test('canonical redirect chains and implicit followed response URLs are rejected', async () => {
  let calls = 0;
  const r = await inspectFile(file('gestao.html'), { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/gestao' } }); } });
  assert.equal(calls, 2); assert.equal(r.errorCode, 'REDIRECT_NOT_CANONICAL_HTML');
  const implicit = response('fixture'); Object.defineProperty(implicit, 'url', { value: 'https://example.invalid/hidden' });
  const second = await inspectFile(file(), { fetchImpl: async () => implicit }); assert.equal(second.errorCode, 'UNEXPECTED_RESPONSE_URL');
});
test('HTML fallback, challenge content and challenge headers cannot pass as executable code', async () => {
  const cases = [response('<html>fallback</html>', 'text/html'), response('<html>fallback</html>'), response('/* /cdn-cgi/challenge-platform/ FIXTURE */'),
    new Response('ignored', { headers: { 'content-type': 'application/javascript', 'cf-mitigated': 'challenge' } })];
  for (const body of cases) {
    const r = await inspectFile(file(), { fetchImpl: async () => body });
    assert.equal(r.classification, 'blocked_or_unreadable'); assert.ok(['MIME_NOT_ALLOWED', 'HTML_CHALLENGE'].includes(r.errorCode)); assert.equal(r.sha256, undefined);
  }
});
test('HTML challenge page is blocked even for an expected HTML route', async () => {
  const r = await inspectFile(file('gestao.html'), { fetchImpl: async () => response('<html><title>Just a moment...</title></html>', 'text/html') });
  assert.equal(r.errorCode, 'HTML_CHALLENGE');
});
test('body size is bounded by declared and streamed length', async () => {
  for (const body of [response('12345'), new Response('x', { headers: { 'content-type': 'application/javascript', 'content-length': '999' } })]) {
    const r = await inspectFile(file(), { fetchImpl: async () => body, maxBytes: 4 }); assert.equal(r.errorCode, 'BODY_TOO_LARGE');
  }
});
test('timeout aborts pending request and does not retain transport error details', async () => {
  let signal;
  const r = await inspectFile(file(), { fetchImpl: async (_url, init) => { signal = init.signal; return new Promise(() => {}); }, timeoutMs: 5 });
  assert.equal(r.errorCode, 'REQUEST_TIMEOUT'); assert.equal(signal.aborted, true);
  const fail = await inspectFile(file(), { fetchImpl: async () => { throw new Error('DO_NOT_RETURN_TOKEN'); } });
  assert.equal(fail.errorCode, 'FETCH_OR_STREAM_FAILED'); assert.ok(!JSON.stringify(fail).includes('DO_NOT_RETURN_TOKEN'));
});
test('runtime config is hashed separately without evaluating or printing public key/body values', async () => {
  const body = 'throw new Error("DO_NOT_EVAL_OR_RETURN_FIXTURE");';
  const r = await inspectFile({ ...file('runtime-config.js', body, body), kind: 'runtime_metadata' }, { fetchImpl: async () => response(body) });
  assert.equal(r.classification, 'baseline_config_hash'); assert.ok(!JSON.stringify(r).includes('DO_NOT_EVAL'));
});
test('aggregate classification distinguishes candidate, baseline with missing additions and mixed results', () => {
  const files = [file('old.js', 'new', 'old'), file('new.js')];
  assert.equal(classifyStatic(files, [{ classification: 'candidate' }, { classification: 'candidate' }]), 'matches_candidate_static');
  assert.equal(classifyStatic(files, [{ classification: 'baseline' }, { classification: 'missing' }]), 'matches_baseline_static_new_assets_absent');
  assert.equal(classifyStatic(files, [{ classification: 'baseline' }, { classification: 'candidate' }]), 'mixed_or_inconclusive');
});
test('fixture-only complete report is labeled fake and contains expected URLs, hashes and no content', async () => {
  const f = file(); const runtime = { ...file('runtime-config.js', 'fixture config', 'fixture config'), kind: 'runtime_metadata' };
  const plan = { origin: ORIGIN, sourceHead: 'fixture-only', files: [f], runtime, counts: {}, expectedFetchUrls: [f.url, runtime.url], limits: {} };
  const r = await comparePublic(plan, { fixture: true, fetchImpl: async url => response(url.endsWith('runtime-config.js') ? 'fixture config' : '/* FIXTURE ONLY */') });
  assert.equal(r.transport, 'FIXTURE_FAKE_FETCH'); assert.equal(r.authenticatedFlowTested, false); assert.equal(r.assetBodiesSaved, false);
  assert.equal(r.classification, 'matches_candidate_static'); assert.equal(r.runtimeConfig.valuesCollected, false); assert.equal(r.runtimeConfig.evaluated, false);
  assert.ok(!JSON.stringify(r).includes('/* FIXTURE ONLY */'));
});
test('denial stops subsequent paths and runtime without retry or inferring a network policy', async () => {
  const a = file('first.js'); const b = file('second.js'); const runtime = { ...file('runtime-config.js'), kind: 'runtime_metadata' };
  const plan = { origin: ORIGIN, sourceHead: 'fixture-only', files: [a, b], runtime, counts: {}, expectedFetchUrls: [a.url, b.url, runtime.url], limits: {} };
  let calls = 0;
  const r = await comparePublic(plan, { fixture: true, fetchImpl: async () => { calls++; return response('not retained', 'text/html', { status: 403 }); } });
  assert.equal(calls, 1); assert.equal(r.stoppedAfterError, 'HTTP_403'); assert.equal(r.results[1].classification, 'not_requested');
  assert.equal(r.runtimeConfig.classification, 'not_requested'); assert.equal(r.classification, 'mixed_or_inconclusive');
  assert.ok(!JSON.stringify(r).includes('allowlist'));
});
test('injected fake transport cannot generate a report labeled public network', async () => {
  let calls = 0;
  await assert.rejects(comparePublic({ origin: ORIGIN }, { fetchImpl: async () => { calls++; return response('FIXTURE'); } }), { code: 'CUSTOM_TRANSPORT_REQUIRES_FIXTURE' });
  assert.equal(calls, 0);
});
test('live comparison rejects a forged or shortened plan before any network operation', async () => {
  await assert.rejects(comparePublic({ origin: ORIGIN, files: [file()] }), { code: 'LIVE_PLAN_MUST_BE_BUILT_LOCALLY' });
  const p = buildPlan(root);
  assert.throws(() => p.files.pop(), TypeError);
  await assert.rejects(comparePublic({ ...p }), { code: 'LIVE_PLAN_MUST_BE_BUILT_LOCALLY' });
});
