const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
const root = 'https://clock.example/';
const current = 'dice-and-coin-20261021-3';
const never = () => new Promise(() => {});

function harness({ network = async () => new Response('new'), brokenCache = false, failPut = false } = {}) {
  const handlers = {}, stores = new Map(), calls = [], timerDelays = [];
  let claims = 0, skips = 0;
  const key = request => new URL(typeof request === 'string' ? request : request.url, root).href;
  const caches = {
    async open(name) {
      if (brokenCache) throw new Error('Storage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(request) { return entries.get(key(request))?.clone(); },
        async put(request, response) {
          if (failPut) throw new Error('Quota exceeded');
          entries.set(key(request), response.clone());
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = {
    URL, Request, Response, AbortController, caches, console,
    setTimeout(fn, delay) { timerDelays.push(delay); return setTimeout(fn, 15); },
    clearTimeout,
    fetch: async (request, options) => { calls.push({ request, options }); return network(request, options); },
    self: {
      registration: { scope: root }, location: new URL(root),
      addEventListener(type, fn) { handlers[type] = fn; },
      async skipWaiting() { skips++; },
      clients: { async claim() { claims++; } }
    }
  };
  vm.runInNewContext(source, context);
  return {
    stores, calls, timerDelays,
    get claims() { return claims; }, get skips() { return skips; },
    async seed(url = root, value = 'saved', name = current) { await (await caches.open(name)).put(url, new Response(value)); },
    lifecycle(type) { let work; handlers[type]({ waitUntil(promise) { work = promise; } }); return work; },
    request(url = root, mode = 'navigate', method = 'GET') {
      let result;
      handlers.fetch({ request: { url, mode, method }, respondWith(promise) { result = promise; } });
      return result;
    }
  };
}

for (const [state, network] of [
  ['online', async () => new Response('remote')],
  ['hung', never],
  ['offline', async () => { throw new TypeError('offline'); }]
]) {
  test(`cached shell starts without network in ${state} state`, async () => {
    const h = harness({ network });
    await h.seed();
    await h.seed(root + 'script.js?v=20261021-3', 'saved-js');
    for (const url of [root, root + '?from=home', root + 'index.html?from=home']) {
      assert.equal(await (await h.request(url)).text(), 'saved');
    }
    assert.equal(await (await h.request(root + 'script.js?v=20261021-3', 'same-origin')).text(), 'saved-js');
    assert.equal(h.calls.length, 0);
    assert.equal(h.timerDelays.length, 0);
  });
}

test('cache miss can use normal network without replacing release cache', async () => {
  const h = harness();
  const response = await h.request();
  assert.equal(await response.text(), 'new');
  assert.equal(h.stores.get(current).size, 0);
  assert.deepEqual(h.timerDelays, [8000]);
});

for (const [failure, network] of [
  ['connection hang', never],
  ['body hang', async () => ({ ok: true, status: 200, headers: new Headers(), arrayBuffer: never })],
  ['HTTP 500', async () => new Response('error', { status: 500 })],
  ['HTTP 404', async () => new Response('missing', { status: 404 })],
  ['offline', async () => { throw new TypeError('offline'); }],
  ['body disconnect', async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error('disconnected'); } })]
]) {
  test(`cache-miss navigation offers retry after ${failure}`, async () => {
    const h = harness({ network });
    const response = await h.request();
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /もう一度開く/);
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.timerDelays, [8000]);
    if (failure.includes('hang')) assert.equal(h.calls[0].options.signal.aborted, true);
  });
}

test('missing JS fails as a resource instead of receiving HTML', async () => {
  const h = harness({ network: never });
  assert.equal((await h.request(root + 'script.js?v=20261021-3', 'same-origin')).type, 'error');
});

test('cache storage failure still permits a network start', async () => {
  const h = harness({ brokenCache: true });
  assert.equal(await (await h.request()).text(), 'new');
});

test('ads, APIs, other pages, unknown versions and POST bypass shell cache', () => {
  const h = harness();
  for (const [url, mode, method] of [
    ['https://adm.shinobi.jp/ad.js', 'no-cors', 'GET'],
    [root + 'api/data', 'same-origin', 'GET'],
    [root + 'other.html', 'navigate', 'GET'],
    [root + 'script.js?v=old', 'same-origin', 'GET'],
    [root, 'navigate', 'POST']
  ]) assert.equal(h.request(url, mode, method), undefined);
  assert.equal(h.calls.length, 0);
});

test('complete installation caches the canonical shell and waits for existing windows', async () => {
  const h = harness();
  await h.seed(root, 'old', 'dice-and-coin-previous');
  await h.lifecycle('install');
  assert.equal(h.skips, 0);
  assert.equal(h.claims, 0);
  assert.equal(h.stores.get(current).size, 18);
  assert.equal(h.stores.get(current).has(root + 'index.html'), false);
  assert.equal(h.stores.has('dice-and-coin-previous'), true);
  assert.ok(h.calls.every(c => c.request.cache === 'reload'));
});

test('every statically imported app module is in the same offline release without circular imports', async () => {
  const h = harness();
  await h.lifecycle('install');
  const checked = new Set();
  function visit(url, ancestors = []) {
    assert.equal(ancestors.includes(url), false, `Circular import: ${[...ancestors, url].join(' -> ')}`);
    if (checked.has(url)) return;
    assert.ok(h.stores.get(current).has(url), `Module missing from offline cache: ${url}`);
    const filename = path.join(__dirname, '..', new URL(url).pathname.slice(1));
    const module = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'));
    for (const dependency of module.dependencySpecifiers) {
      visit(new URL(dependency, url).href, [...ancestors, url]);
    }
    checked.add(url);
  }
  visit(root + 'script.js?v=20261021-3');
  assert.equal(checked.size, 5);
});

for (const failure of ['HTTP error', 'connection hang', 'body hang', 'quota']) {
  test(`failed installation preserves old release after ${failure}`, async () => {
    const h = harness({
      failPut: failure === 'quota',
      network: async request => {
        if (failure === 'quota' || !request.url.includes('script.js')) return new Response('new');
        if (failure === 'connection hang') return never();
        if (failure === 'body hang') return { ok: true, arrayBuffer: never };
        return new Response('error', { status: 500 });
      }
    });
    // Seed old data directly so the quota fixture affects only the new install.
    h.stores.set('dice-and-coin-previous', new Map([[root, new Response('old')]]));
    await assert.rejects(h.lifecycle('install'));
    assert.equal(h.stores.has(current), false);
    assert.equal(await h.stores.get('dice-and-coin-previous').get(root).clone().text(), 'old');
    assert.equal(h.skips, 0);
  });
}

test('activation removes only this app old caches', async () => {
  const h = harness();
  await h.seed();
  await h.seed(root, 'old', 'dice-and-coin-previous');
  await h.seed(root, 'unrelated', 'another-app-v1');
  await h.lifecycle('activate');
  assert.equal(h.stores.has('dice-and-coin-previous'), false);
  assert.equal(h.stores.has(current), true);
  assert.equal(h.stores.has('another-app-v1'), true);
  assert.equal(h.claims, 1);
});

test('cached navigation has no redirect history', async () => {
  const h = harness({ network: async () => {
    const r = new Response('<html>clock</html>', { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(r, 'redirected', { value: true });
    return r;
  } });
  await h.lifecycle('install');
  assert.equal((await h.request(root + 'index.html')).redirected, false);
});

