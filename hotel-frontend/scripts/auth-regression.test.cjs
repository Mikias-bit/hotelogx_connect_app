const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const map = new Map();
  const localStorage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
  const window = new EventTarget();
  Object.assign(window, { localStorage, location: { hostname: 'test.example' } });
  return { window, localStorage, Event, FormData, console };
}
function load(file, globals, modules = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib', file), 'utf8').replaceAll('import.meta.env', '({ VITE_API_BASE_URL: "https://backend.example/api" })');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { ...globals, exports: {}, require: id => {
    if (!(id in modules)) throw new Error(`Unexpected module: ${id}`);
    return modules[id];
  } };
  vm.runInNewContext(output, context);
  return context.exports;
}

test('profile and Gmail requests with no token fail before calling the backend', async () => {
  const f = fixture(); let fetches = 0;
  f.localStorage.setItem('hotelogx.user.v1', '{"id":"cached"}');
  const { api } = load('api.ts', { ...f, fetch: async () => { fetches++; } });
  await assert.rejects(api.saveHotelProfile({ name: 'Hotel A' }), /sign in/i);
  await assert.rejects(api.getGoogleOAuthUrl(), /sign in/i);
  assert.equal(fetches, 0);
  assert.equal(f.localStorage.getItem('hotelogx.user.v1'), null);
});

test('authenticated profile save sends the token and preserves server errors', async () => {
  const f = fixture(); f.localStorage.setItem('token', 'test-token');
  let request;
  const { api } = load('api.ts', { ...f, fetch: async (url, options) => {
    request = { url, ...options };
    return { ok: false, status: 403, json: async () => ({ message: 'Manager access required' }) };
  } });
  await assert.rejects(api.saveHotelProfile({ name: 'Hotel A' }), /Manager access required/);
  assert.equal(request.headers.Authorization, 'Bearer test-token');
  assert.equal(f.localStorage.getItem('token'), 'test-token');
});

test('rejected session clears cached identity and reports that sign-in is needed', async () => {
  const f = fixture(); f.localStorage.setItem('token', 'expired'); f.localStorage.setItem('hotelogx.session.v1', 'cached');
  let expired = 0; f.window.addEventListener('hotelogx:session-expired', () => expired++);
  const { api } = load('api.ts', { ...f, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  await assert.rejects(api.saveHotelProfile({}), /session has expired/);
  assert.equal(f.localStorage.getItem('token'), null); assert.equal(f.localStorage.getItem('hotelogx.session.v1'), null); assert.ok(expired);
});

test('new hotel registration is public and surfaces duplicate-account errors', async () => {
  const f = fixture();
  const { api } = load('api.ts', { ...f, fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return { ok: false, status: 409, json: async () => ({ message: 'Email already registered. Please sign in.' }) };
  } });
  await assert.rejects(api.registerHotel({ email: 'manager@example.com' }), /already registered/);
});

test('late unauthorized request cannot erase a newly signed-in session', async () => {
  const f = fixture(); f.localStorage.setItem('token', 'old-session');
  const { api } = load('api.ts', { ...f, fetch: async () => {
    f.localStorage.setItem('token', 'new-session');
    return { ok: false, status: 401, json: async () => ({}) };
  } });
  await assert.rejects(api.saveHotelProfile({}), /session has expired/);
  assert.equal(f.localStorage.getItem('token'), 'new-session');
});

function session(f, api) {
  class Store { constructor(value) { this.state = value; } setState(fn) { this.state = fn(this.state); } }
  return load('session.ts', f, { '@tanstack/react-store': { Store, useStore: (store, select) => select(store.state) },
    './api': { api }, './store': { initBackendSync() {}, resetStoreState() {} } });
}
test('cached user cannot hydrate a session without a token or invoke a passwordless login', async () => {
  const f = fixture(); f.localStorage.setItem('hotelogx.session.v1', 'cached'); f.localStorage.setItem('hotelogx.user.v1', JSON.stringify({ id: 'cached', email: 'manager@example.com' }));
  const s = session(f, { getMe: () => { throw new Error('Must not fetch without token'); }, login: () => { throw new Error('Must not log in from cached details'); } });
  await s.hydrateSession(); assert.equal(s.sessionStore.state.user, null); assert.equal(s.sessionStore.state.ready, true);
  await assert.rejects(s.signIn('cached', { id: 'cached' }), /sign in/i);
});

test('verified server user hydrates, while API session-expired events immediately clear identity', async () => {
  const f = fixture(); f.localStorage.setItem('token', 'valid');
  const s = session(f, { getMe: async () => ({ user: { id: 'manager', name: 'Manager', email: 'manager@example.com', role: 'manager' } }) });
  await s.hydrateSession(); assert.equal(s.sessionStore.state.userId, 'manager');
  f.window.dispatchEvent(new Event('hotelogx:session-expired'));
  assert.equal(s.sessionStore.state.user, null);
});

test('profile state and completion change only after the backend confirms saving', async () => {
  class Store { constructor(value) { this.state = value; } setState(fn) { this.state = fn(this.state); } }
  let finish;
  const api = { saveHotelProfile: () => new Promise(resolve => { finish = resolve; }) };
  const s = load('store.ts', { console, setTimeout: () => 0 }, {
    '@tanstack/react-store': { Store }, './api': { api }, './data': { hotel: {}, planTiers: [], subscription: {} },
    './onboarding': {}, './utils': { clockNow: () => 'now', uid: () => 'id', money: () => '' },
  });
  const before = s.store.state.hotelProfile.name;
  const saving = s.updateHotelProfile({ name: 'Hotel A' });
  assert.equal(s.store.state.hotelProfile.name, before);
  assert.equal(s.store.state.onboarding.done.profile, false);
  finish({ success: true }); assert.equal(await saving, true);
  assert.equal(s.store.state.hotelProfile.name, 'Hotel A');
  api.saveHotelProfile = async () => { throw new Error('Session expired'); };
  assert.equal(await s.updateHotelProfile({ name: 'Unsaved' }), false);
  assert.equal(s.store.state.hotelProfile.name, 'Hotel A');
  assert.equal(s.store.state.toasts.at(-1).tone, 'urgent');
});
