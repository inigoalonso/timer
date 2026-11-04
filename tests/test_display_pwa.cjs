const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {runInNewContext} = require('node:vm');
const source = name => readFileSync(join(__dirname, '../static', name), 'utf8');
const parse = runInNewContext(source('display-links.js') + '\nparseDisplayLink;', {URL});
const origin = 'https://timer.example';
const link = origin + '/display/session_123#' + 'x'.repeat(32);

test('accepts same-origin display links and preserves fragment credentials', () => {
  assert.equal(parse(link, origin), link);
  const local = 'http://localhost:8000/display/id#' + 'a'.repeat(32);
  assert.equal(parse(local, 'http://localhost:8000'), local);
});

test('rejects controller, external, malformed and ambiguous QR payloads', () => {
  for (const value of [link.replace('/display/', '/control/'), link.replace(origin, 'https://evil.example'),
    link.replace('/display/', '/display/../control/'), link.replace('#', '?token=x#'),
    origin + '/display/session#short', origin + '/display/', '/display/session#' + 'x'.repeat(32),
    link.replace('https://', 'https://user:password@'), 'javascript:alert(1)', link + '/extra']) {
    assert.throws(() => parse(value, origin));
  }
});

function worker() {
  const handlers = {}, assets = [], deleted = [], fetched = [];
  const cache = {addAll: async values => assets.push(...values), match: async path => path === '/static/index.html' ? 'offline-shell' : 'cached-asset'};
  const context = {
    URL, Response,
    self: {location: {origin}, addEventListener: (type, handler) => { handlers[type] = handler; }},
    caches: {open: async () => cache, keys: async () => ['stage-time-display-old', 'unrelated'], delete: async key => deleted.push(key)},
    fetch: async request => { fetched.push(request); throw Error('Offline'); },
  };
  runInNewContext(source('display-sw.js'), context);
  return {handlers, assets, deleted, fetched};
}

test('worker caches only an explicit public shell and does not force activation', async () => {
  const app = worker();
  let task;
  app.handlers.install({waitUntil(value) { task = value; }});
  await task;
  assert.ok(app.assets.includes('/static/index.html'));
  assert.ok(app.assets.includes('/static/vendor/jsQR.js'));
  assert.ok(app.assets.every(path => path.startsWith('/static/') && !path.includes('#') && !path.includes('?')));
  app.handlers.activate({waitUntil(value) { task = value; }});
  await task;
  assert.deepEqual(app.deleted, ['stage-time-display-old']);
});

test('worker supplies offline HTML only to display navigation and never caches session responses', async () => {
  const app = worker();
  let result;
  app.handlers.fetch({request: {method: 'GET', mode: 'navigate', url: link}, respondWith(value) { result = value; }});
  assert.equal(await result, 'offline-shell');
  for (const [path, mode, method] of [['/control/session', 'navigate', 'GET'], ['/api/sessions', 'cors', 'POST'],
    ['/ws/session', 'cors', 'GET'], ['/display/session', 'cors', 'GET'], ['/static/app.js?token=secret', 'cors', 'GET']]) {
    let intercepted = false;
    app.handlers.fetch({request: {method, mode, url: origin + path}, respondWith() { intercepted = true; }});
    assert.equal(intercepted, false, path);
  }
});

function displayApp(path = '/display/', saved = null, search = '', standalone = false) {
  const nodes = new Map(), storage = new Map(saved ? [['stage-time:last-display', saved]] : []), navigations = [];
  const events = {};
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {hidden: false, value: '', textContent: '', srcObject: null});
    return nodes.get(id);
  };
  const context = {
    URL, URLSearchParams,
    location: {pathname: path, origin, href: path === '/display/' ? origin + path : link, search,
      assign: value => navigations.push(value), replace: value => navigations.push(value)},
    document: {getElementById: element, createElement: () => ({}), head: {append() {}}, addEventListener(type, handler) { events[type] = handler; }},
    navigator: {userAgent: 'iPhone', platform: 'iPhone', standalone},
    localStorage: {getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)},
    matchMedia: () => ({matches: standalone}), isSecureContext: true,
    addEventListener(type, handler) { events[type] = handler; }, cancelAnimationFrame() {},
  };
  context.window = context;
  runInNewContext(source('display-links.js') + '\n' + source('display-pwa.js'), context);
  return {app: context.DisplayApp, element, storage, navigations, events, context};
}

test('launcher restores a saved session, but change-session mode offers explicit resume', () => {
  assert.deepEqual(displayApp('/display/', link).navigations, [link]);
  const changing = displayApp('/display/', link, '?join=1');
  assert.deepEqual(changing.navigations, []);
  assert.equal(changing.element('savedDisplayActions').hidden, false);
  changing.element('resumeDisplay').onclick();
  assert.deepEqual(changing.navigations, [link]);
});

test('only authenticated display links are remembered; invalid credentials are forgotten', () => {
  const session = displayApp('/display/session_123');
  assert.equal(session.storage.size, 0);
  session.app.authenticated();
  assert.equal(session.storage.get('stage-time:last-display'), link);
  session.app.invalid();
  assert.equal(session.storage.size, 0);
  assert.deepEqual(session.navigations, ['/display/?join=1&expired=1']);
});

test('paste joining rejects controller links and forget removes saved credentials', () => {
  const launcher = displayApp('/display/', link, '?join=1');
  launcher.element('joinLink').value = link.replace('/display/', '/control/');
  launcher.element('joinDisplay').onsubmit({preventDefault() {}});
  assert.equal(launcher.navigations.length, 0);
  assert.match(launcher.element('joinStatus').textContent, /not a controller link/);
  launcher.element('forgetSavedDisplay').onclick();
  assert.equal(launcher.storage.size, 0);
  assert.equal(launcher.element('savedDisplayActions').hidden, true);
});

test('controller pages do not initialize PWA storage, permissions or service worker', () => {
  const controller = displayApp('/control/session');
  assert.equal(controller.app, null);
  assert.equal(controller.storage.size, 0);
  assert.equal(controller.events.pagehide, undefined);
});

test('standalone install help is hidden and iOS guidance is available in the browser', () => {
  assert.equal(displayApp('/display/', null, '', true).element('installDisplay').hidden, true);
  const browser = displayApp();
  browser.element('installDisplay').onclick();
  assert.equal(browser.element('installHelp').hidden, false);
  assert.match(browser.element('installInstructions').textContent, /Add to Home Screen/);
});

test('bundled decoder reads the same QR payload produced by the controller library', () => {
  const qrcode = runInNewContext(source('vendor/qrcode.js') + '\nqrcode;');
  const decode = require('../static/vendor/jsQR.js');
  const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
  const modules = qr.getModuleCount(), scale = 5, margin = 4, size = (modules + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < modules; row++) {
    for (let column = 0; column < modules; column++) {
      if (!qr.isDark(row, column)) continue;
      for (let vertical = 0; vertical < scale; vertical++) {
        for (let horizontal = 0; horizontal < scale; horizontal++) {
          const offset = (((row + margin) * scale + vertical) * size + (column + margin) * scale + horizontal) * 4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
      }
    }
  }
  assert.equal(decode(pixels, size, size).data, link);
});

function cameraApp() {
  const app = displayApp();
  let stopped = 0;
  app.context.jsQR = () => null;
  app.context.navigator.mediaDevices = {getUserMedia: async () => ({getTracks: () => [{stop() { stopped++; }}]})};
  app.context.requestAnimationFrame = () => 1;
  app.context.document.createElement = () => ({getContext: () => ({})});
  app.element('scanVideo').play = async () => {};
  return {...app, stopped: () => stopped};
}

test('camera stops on cancel, hiding the app and joining through paste', async () => {
  for (const action of ['cancel', 'hidden', 'join']) {
    const app = cameraApp();
    await app.element('scanDisplay').onclick();
    assert.equal(app.element('scanner').hidden, false);
    if (action === 'cancel') app.element('cancelScan').onclick();
    if (action === 'hidden') { app.context.document.hidden = true; app.events.visibilitychange(); }
    if (action === 'join') {
      app.element('joinLink').value = link;
      app.element('joinDisplay').onsubmit({preventDefault() {}});
    }
    assert.equal(app.stopped(), 1, action);
    assert.equal(app.element('scanVideo').srcObject, null);
    assert.equal(app.element('scanner').hidden, true);
  }
});

test('camera permission denial offers paste fallback and does not leave scanning active', async () => {
  const app = cameraApp();
  app.context.navigator.mediaDevices.getUserMedia = async () => { const error = Error('Denied'); error.name = 'NotAllowedError'; throw error; };
  await app.element('scanDisplay').onclick();
  assert.match(app.element('joinStatus').textContent, /Camera permission denied/);
  assert.equal(app.element('scanDisplay').disabled, false);
  assert.equal(app.element('scanner').hidden, true);
});

test('cancelling while camera permission is pending stops the late stream', async () => {
  const app = cameraApp();
  let resolveCamera, stopped = 0;
  app.context.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { resolveCamera = resolve; });
  const starting = app.element('scanDisplay').onclick();
  await Promise.resolve();
  app.events.pagehide();
  resolveCamera({getTracks: () => [{stop() { stopped++; }}]});
  await starting;
  assert.equal(stopped, 1);
  assert.equal(app.element('scanner').hidden, true);
});