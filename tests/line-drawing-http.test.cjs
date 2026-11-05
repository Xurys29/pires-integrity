'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createDrawingPrototypeServer } = require('../scripts/serve-line-drawing.cjs');
const { createPreviewServer } = require('../scripts/serve-current.cjs');
async function open(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return 'http://127.0.0.1:' + server.address().port;
}
test('drawing prototype has an isolated read-only loopback server with no outbound API capability', async t => {
  const base = await open(t, createDrawingPrototypeServer());
  for (const route of ['/', '/index.html', '/model.js', '/editor.js', '/style.css']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 0);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(response.headers.get('content-security-policy').includes("connect-src 'none'"));
  }
  for (const route of ['/.env', '/runtime-config.js', '/supabase/inspection-execution.sql', '/app/gestao.html', '/package.json', '/%2e%2e%2f.env', '/api/save', '/model.js/anything'])
    assert.equal((await fetch(base + route)).status, 404, route);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
    assert.equal((await fetch(base + '/', { method, body: '{}' })).status, 405, method);
  assert.equal((await fetch(base + '/model.js', { method: 'HEAD' })).status, 200);
});
test('drawing prototype is not exposed by the current application preview', async t => {
  const base = await open(t, createPreviewServer({}));
  for (const route of ['/prototypes/line-drawing', '/line-drawing', '/line-drawing.html', '/model.js', '/editor.js'])
    assert.equal((await fetch(base + route)).status, 404, route);
});
