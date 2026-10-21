const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, requestInterceptor, VirtualConsole } = require('jsdom');
const directory = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const never = () => new Promise(() => {});
const waitFor = async predicate => {
  for (let i = 0; i < 240; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('App did not reach expected state');
};
const saved = {
  dc_diceSettings: { count: 2, faces: 8 },
  dc_coinSettings: { count: 2, emphasizeSides: true },
  dc_diceHistory: [{ faces: 8, count: 2, results: [3, 7], total: 10, time: '10:01' }],
  dc_coinHistory: [{ count: 2, results: ['heads', 'tails'], heads: 1, tails: 1, time: '10:02' }]
};
async function openApp({ seed = saved, mode = 'failure', registrationFails = false, afterDOMContentLoaded = false } = {}) {
  const errors = [], registrations = [], deadlines = [];
  let dom, adRequested = false, loaded = false, initialized = 0;
  // jsdom does not run module scripts: this adapter evaluates the actual module
  // at the loader position. It tests app behavior, not browser async scheduling.
  const adapted = html.replace(/<script type="module" async src="script.js\?v=20261021-3"><\/script>/, '<script src="/__module-start.js"></script>');
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error));
  console.on('log', message => { if (message === 'DICE & COIN initialized') initialized++; });
  dom = new JSDOM(adapted, {
    url: 'https://app.example/', runScripts: 'dangerously', virtualConsole: console,
    resources: { interceptors: [requestInterceptor(request => {
      if (request.url.startsWith('https://adm.shinobi.jp/')) { adRequested = true; return never(); }
      const filename = new URL(request.url).pathname.slice(1);
      const text = filename === '__module-start.js' ? 'window.__evaluateApp();'
        : filename.endsWith('.css') ? '' : fs.readFileSync(path.join(directory, filename), 'utf8');
      return new Response(text, { headers: { 'Content-Type': filename.endsWith('.css') ? 'text/css' : 'application/javascript' } });
    })] },
    beforeParse(w) {
      Object.defineProperty(w, 'isSecureContext', { value: true });
      w.structuredClone = structuredClone;
      w.matchMedia = () => ({ matches: true, addEventListener() {} });
      w.ResizeObserver = class { observe() {} disconnect() {} };
      w.requestAnimationFrame = callback => w.setTimeout(() => callback(w.performance.now()), 16);
      w.cancelAnimationFrame = id => w.clearTimeout(id);
      const nativeTimeout = w.setTimeout.bind(w);
      w.setTimeout = (fn, delay, ...args) => {
        if (delay === 8000) deadlines.push(delay);
        return nativeTimeout(fn, delay === 8000 ? 20 : [320, 950].includes(delay) ? 5 : delay, ...args);
      };
      for (const [key, value] of Object.entries(seed)) w.localStorage.setItem(key, JSON.stringify(value));
      Object.defineProperty(w.navigator, 'serviceWorker', { value: {
        register(url, options) {
          registrations.push({ url, options });
          return registrationFails ? Promise.reject(new Error('SW failed')) : never();
        }
      } });
      w.addEventListener('load', () => { loaded = true; });
      w.__evaluateApp = () => {
        (async () => {
          if (afterDOMContentLoaded) w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
          const modules = new Map();
          function loadModule(url) {
            if (modules.has(url)) return modules.get(url);
            const filename = new URL(url).pathname.slice(1);
            const module = new vm.SourceTextModule(fs.readFileSync(path.join(directory, filename), 'utf8'), {
              context: dom.getInternalVMContext(), identifier: url,
              initializeImportMeta(meta) { meta.url = url; },
              importModuleDynamically: async () => {
                if (mode === 'hang') return never();
                throw new Error('3D import failed');
              }
            });
            modules.set(url, module);
            return module;
          }
          const module = loadModule('https://app.example/script.js?v=20261021-3');
          await module.link((specifier, parent) => loadModule(new URL(specifier, parent.identifier).href));
          await module.evaluate();
        })().catch(error => errors.push(error));
      };
    }
  });
  await waitFor(() => adRequested && initialized === 1);
  return { dom, errors, registrations, deadlines,
    get initialized() { return initialized; }, get loaded() { return loaded; } };
}
function snapshot(w) {
  return Object.fromEntries(Object.keys(saved).map(key => [key, JSON.parse(w.localStorage.getItem(key))]));
}
test('stage and action touches cancel native gestures without duplicate actions; other page touches remain available', async () => {
  const app = await openApp();
  try {
    const w = app.dom.window, d = w.document;
    const button = d.getElementById('rollBtn');
    button.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100 });
    let clicks = 0;
    button.addEventListener('click', () => clicks++);
    const finger = (x = 20) => ({ identifier: 1, clientX: x, clientY: 20 });
    const send = (target, type, points = [finger()]) => {
      const e = new w.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, {
        touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : points },
        changedTouches: { value: points }
      });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const stage = d.getElementById('diceStage');
    for (let i = 0; i < 2; i++) {
      assert.ok(send(stage, 'touchstart'));
      assert.ok(send(stage, 'touchend'));
    }
    for (let i = 0; i < 2; i++) {
      assert.ok(send(button, 'touchstart'));
      assert.ok(send(button, 'touchend'));
    }
    assert.equal(clicks, 1);
    assert.equal(button.disabled, true);
    button.disabled = false;
    send(button, 'touchstart'); send(button, 'touchmove', [finger(60)]); send(button, 'touchend');
    assert.equal(clicks, 1, 'a drag must not activate the button');
    send(button, 'touchstart', [finger(), { ...finger(), identifier: 2 }]); send(button, 'touchend');
    assert.equal(clicks, 1, 'a multi-touch must not activate the button');
    send(button, 'touchstart'); send(button, 'touchcancel'); send(button, 'touchend');
    assert.equal(clicks, 1);
    assert.equal(send(d.body, 'touchstart'), false);
    assert.equal(send(d.body, 'touchend'), false);
  } finally { app.dom.window.close(); }
});
test('app and independent SW loader precede unchanged blocking ad script', () => {
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>/g)].map(m => m[1]);
  const ad = scripts.filter(s => s.startsWith('https://adm.shinobi.jp/'));
  assert.deepEqual(ad, ['https://adm.shinobi.jp/s/1596a166ea799d6e2c02f5a97ee144c2']);
  assert.ok(scripts.indexOf('pwa.js') < scripts.indexOf(ad[0]));
  assert.ok(scripts.indexOf('script.js?v=20261021-3') < scripts.indexOf(ad[0]));
  assert.match(html, /<script type="module" async src="script.js\?v=20261021-3">/);
});
for (const mode of ['failure', 'hang']) {
  for (const registrationFails of [false, true]) {
    test(`ad hangs, 3D ${mode}, SW failure=${registrationFails}: settings/history restore and numeric actions still save`, async () => {
      const app = await openApp({ mode, registrationFails });
      let persisted;
      try {
        const w = app.dom.window, d = w.document;
        await waitFor(() => /数値で表示/.test(d.getElementById('diceStage').textContent));
        assert.equal(app.loaded, false); assert.equal(d.readyState, 'loading');
        assert.deepEqual(snapshot(w), saved);
        assert.match(d.getElementById('diceHistoryList').textContent, /10:01/);
        assert.equal(app.registrations.length, 1);
        assert.equal(app.registrations[0].options.updateViaCache, 'none');
        if (mode === 'hang') assert.ok(app.deadlines.includes(8000));
        d.getElementById('rollBtn').click();
        await waitFor(() => !d.getElementById('rollBtn').disabled);
        const dice = JSON.parse(w.localStorage.getItem('dc_diceHistory'));
        assert.equal(dice.length, 2); assert.deepEqual(dice[1], saved.dc_diceHistory[0]);
        assert.equal(dice[0].faces, 8); assert.equal(dice[0].results.length, 2);
        assert.ok(dice[0].results.every(n => n >= 1 && n <= 8));
        d.querySelector('[data-tab="coin"]').click();
        d.getElementById('tossBtn').click();
        await waitFor(() => !d.getElementById('tossBtn').disabled);
        const coin = JSON.parse(w.localStorage.getItem('dc_coinHistory'));
        assert.equal(coin.length, 2); assert.deepEqual(coin[1], saved.dc_coinHistory[0]);
        assert.ok(coin[0].results.every(n => ['heads', 'tails'].includes(n)));
        assert.equal(coin[0].results.length, 2);
        d.getElementById('settingsBtn').click();
        d.querySelector('[data-target="coinCount"][data-step="inc"]').click();
        d.getElementById('settingsConfirmBtn').click();
        assert.deepEqual(JSON.parse(w.localStorage.getItem('dc_coinSettings')), { count: 3, emphasizeSides: true });
        w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
        w.dispatchEvent(new w.Event('load'));
        assert.equal(app.initialized, 1); assert.equal(app.registrations.length, 1);
        assert.equal(app.errors.length, 0, app.errors.map(String).join('\n'));
        persisted = snapshot(w);
      } finally { app.dom.window.close(); }
      const reopened = await openApp({ seed: persisted, mode, registrationFails });
      try { assert.deepEqual(snapshot(reopened.dom.window), persisted); }
      finally { reopened.dom.window.close(); }
    });
  }
}
test('late async module starts even after DOMContentLoaded has already fired', async () => {
  const app = await openApp({ afterDOMContentLoaded: true });
  try {
    assert.equal(app.initialized, 1);
    assert.deepEqual(snapshot(app.dom.window), saved);
    assert.equal(app.errors.length, 0);
  } finally { app.dom.window.close(); }
});
