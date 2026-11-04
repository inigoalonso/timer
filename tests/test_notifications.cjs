const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {runInNewContext, createContext, runInContext} = require('node:vm');
const {join} = require('node:path');
const Milestones = runInNewContext(readFileSync(join(__dirname, '../static/notifications.js'), 'utf8') + '\nMilestoneNotifications;');
const running = {mode: 'running', title: 'Keynote'};

function fixture() {
  const alerts = [];
  const notifier = new Milestones(text => alerts.push(text));
  notifier.enabled = true;
  return {alerts, notifier};
}

test('notifies once at each milestone, including overtime', () => {
  const {alerts, notifier} = fixture();
  for (const remaining of [301000, 300000, 299000, 61000, 60000, 1000, 0, -1000]) notifier.update(running, remaining, true);
  assert.deepEqual(alerts, ['5 minutes left', '1 minute left', 'Time is up']);
});

test('no retrospective alerts when enabled or resynchronized', () => {
  const {alerts, notifier} = fixture();
  notifier.update(running, 50000, true);
  notifier.update(running, 40000, false);
  notifier.update(running, -1000, true);
  assert.deepEqual(alerts, []);
});

test('pause and time adjustments do not duplicate milestones; prepared resets them', () => {
  const {alerts, notifier} = fixture();
  notifier.update(running, 301000, true);
  notifier.update(running, 300000, true);
  notifier.update({mode: 'paused'}, 300000, true);
  notifier.update(running, 360000, true);
  notifier.update(running, 300000, true);
  assert.equal(alerts.length, 1);
  notifier.update({mode: 'prepared'}, 600000, true);
  notifier.update(running, 301000, true);
  notifier.update(running, 300000, true);
  assert.equal(alerts.length, 2);
});

test('delayed tick delivers only the latest crossed milestone', () => {
  const {alerts, notifier} = fixture();
  notifier.update(running, 301000, true);
  notifier.update(running, -1000, true);
  assert.deepEqual(alerts, ['Time is up']);
  assert.equal(notifier.fired.size, 3);
});

test('disabled notifications never deliver', () => {
  const {alerts, notifier} = fixture();
  notifier.enabled = false;
  notifier.update(running, 301000, true);
  notifier.update(running, 0, true);
  assert.deepEqual(alerts, []);
});

function browser(role, permission = 'granted', supported = true) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', checked: false, disabled: false, hidden: false,
      dataset: {}, style: {}, children: [], attributes: {}, classList: {toggle() {}},
      setAttribute(name, value) { this.attributes[name] = value; }, querySelectorAll: () => [],
      focus() { this.focused = true; },
      parentElement: {clientWidth: 1000}, replaceChildren() {}, append() {},
    });
    return elements.get(id);
  };
  const alerts = [];
  const commands = [];
  const tabs = ['run', 'playlist', 'links'].map(name => {
    const tab = element('tab-'+name); tab.dataset.tab = name; return tab;
  });
  let requests = 0;
  class BrowserNotification {
    static permission = permission;
    static async requestPermission() { requests++; return BrowserNotification.permission; }
    constructor(title, options) { alerts.push({title, ...options}); }
  }
  const context = createContext({
    document: {
      getElementById: element, body: {classList: {toggle() {}}},
      querySelectorAll: selector => selector === '[data-tab]' ? tabs : [], createElement: () => element(Symbol()), addEventListener() {},
    },
    location: {pathname: `/${role}/session`, hash: '#token', protocol: 'https:', host: 'timer.test', href: 'https://timer.test'},
    localStorage: {getItem: () => null}, performance: {now: () => 1000},
    WebSocket: class {static OPEN = 1; send(message) { commands.push(JSON.parse(message)); }},
    crypto: {randomUUID: () => 'test-request'},
    setInterval() {}, setTimeout() {}, clearTimeout() {}, addEventListener() {},
    isSecureContext: true, innerHeight: 900,
  });
  context.window = context;
  if (supported) context.Notification = BrowserNotification;
  runInContext(readFileSync(join(__dirname, '../static/notifications.js'), 'utf8'), context);
  runInContext(readFileSync(join(__dirname, '../static/app.js'), 'utf8'), context);
  return {context, element, alerts, commands, requests: () => requests};
}

function runCountdown(context) {
  runInContext(`
    state={mode:'running',deadline_utc_ms:302000,title:'Keynote',playlist:[],playlist_index:null,playlist_phase:null};
    online=true;synced=true;anchor=1000;clock=1000;render();
    clock=2000;render();clock=242000;render();clock=302000;render();render();
  `, context);
}

test('controller requests permission only after opt-in and delivers all three notifications', async () => {
  const app = browser('control');
  assert.equal(app.requests(), 0);
  app.element('notificationsEnabled').checked = true;
  await app.element('notificationsEnabled').onchange();
  assert.equal(app.element('notificationStatus').textContent, 'On');
  runCountdown(app.context);
  assert.deepEqual(app.alerts.map(alert => alert.title), ['5 minutes left', '1 minute left', 'Time is up']);
  assert.equal(app.alerts[0].body, 'Keynote');
  app.element('notificationsEnabled').checked = false;
  await app.element('notificationsEnabled').onchange();
  assert.equal(app.element('notificationStatus').textContent, 'Off');
});

test('display never requests permission or delivers notifications', () => {
  const app = browser('display');
  assert.equal(app.element('notificationControls').hidden, true);
  runCountdown(app.context);
  assert.equal(app.requests(), 0);
  assert.deepEqual(app.alerts, []);
});

test('default browser permission is requested on user opt-in', async () => {
  const app = browser('control', 'default');
  assert.equal(app.requests(), 0);
  app.element('notificationsEnabled').checked = true;
  await app.element('notificationsEnabled').onchange();
  assert.equal(app.requests(), 1);
  assert.equal(app.element('notificationsEnabled').checked, false);
  runCountdown(app.context);
  assert.deepEqual(app.alerts, []);
});

test('blocked or unsupported browsers disable opt-in without errors', () => {
  for (const app of [browser('control', 'denied'), browser('control', 'default', false)]) {
    assert.equal(app.element('notificationsEnabled').disabled, true);
    runCountdown(app.context);
    assert.deepEqual(app.alerts, []);
    assert.equal(app.requests(), 0);
  }
});

test('unified transport pauses a running timer and resumes a paused timer', () => {
  const app = browser('control');
  runCountdown(app.context);
  assert.equal(app.element('start').dataset.label, 'Pause');
  app.element('start').onclick();
  assert.equal(app.commands.at(-1).action, 'pause');
  runInContext("pending=null;state.mode='paused';state.paused_remaining_ms=1000;render();", app.context);
  assert.equal(app.element('start').dataset.label, 'Resume');
  app.element('start').onclick();
  assert.equal(app.commands.at(-1).action, 'start');
});

test('tabs switch visible panels and support keyboard navigation', () => {
  const app = browser('control');
  app.element('tab-playlist').onclick();
  assert.equal(app.element('playlist').hidden, false);
  assert.equal(app.element('run').hidden, true);
  assert.equal(app.element('tab-playlist').attributes['aria-selected'], 'true');
  assert.equal(app.element('tab-playlist').tabIndex, 0);
  app.element('tab-playlist').onkeydown({key: 'ArrowRight', preventDefault() {}});
  assert.equal(app.element('links').hidden, false);
  assert.equal(app.element('tab-links').focused, true);
  app.element('tab-links').onkeydown({key: 'Home', preventDefault() {}});
  assert.equal(app.element('run').hidden, false);
});

test('save controls appear only for dirty playlists without blocking tabs offline', () => {
  const app = browser('control');
  runCountdown(app.context);
  assert.equal(app.element('playlistSaveBar').hidden, true);
  runInContext('playlistDirty=true;online=false;render();', app.context);
  assert.equal(app.element('playlistSaveBar').hidden, false);
  assert.equal(app.element('draftBadge').hidden, false);
  assert.equal(app.element('runNotice').hidden, false);
  assert.equal(app.element('nextPresentation').disabled, true);
  app.element('tab-links').onclick();
  assert.equal(app.element('links').hidden, false);
});

test('display shows connection warnings only when disconnected and never shows settings', () => {
  const app = browser('display');
  runCountdown(app.context);
  assert.equal(app.element('displayTools').hidden, false);
  assert.equal(app.element('settings').hidden, true);
  assert.equal(app.element('displayConnection').hidden, true);
  runInContext('disconnected();', app.context);
  assert.equal(app.element('displayConnection').hidden, false);
  assert.match(app.element('displayConnection').textContent, /Disconnected/);
  const controller = browser('control');
  assert.equal(controller.element('displayTools').hidden, true);
});

test('playlist reordering marks drafts dirty and rejects invalid destinations', () => {
  const app = browser('control');
  runCountdown(app.context);
  runInContext("playlistDraft=[{title:'First',duration_seconds:600,qa_duration_seconds:0},{title:'Second',duration_seconds:900,qa_duration_seconds:60}];reorderPresentation(0,1);", app.context);
  assert.equal(runInContext('playlistDraft[0].title', app.context), 'Second');
  assert.equal(app.element('playlistSaveBar').hidden, false);
  runInContext('reorderPresentation(0,null);reorderPresentation(0,99);', app.context);
  assert.equal(runInContext('playlistDraft[0].title', app.context), 'Second');
});