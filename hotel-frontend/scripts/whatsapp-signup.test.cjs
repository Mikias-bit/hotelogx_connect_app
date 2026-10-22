const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/lib/metaSignup.ts'), 'utf8')
  .replace(/import\.meta\.env\.VITE_META_APP_ID/g, "'app'").replace(/import\.meta\.env\.VITE_META_CONFIG_ID/g, "'config'");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function fixture() {
  let listener, callback, timeout;
  const sandbox = { exports: {}, clearTimeout() {}, window: {
    addEventListener: (type, fn) => { listener = fn; }, removeEventListener: () => { listener = null; },
    setTimeout: fn => { timeout = fn; return 1; }, FB: { login: fn => { callback = fn; } },
  } };
  vm.runInNewContext(compiled, sandbox);
  return { start: () => sandbox.exports.launchMetaSignup(), login: () => callback({ authResponse: { code: 'code' } }),
    event: (origin = 'https://www.facebook.com', event = 'FINISH') => listener({ origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data: { waba_id: '123', phone_number_id: '456' } }) }),
    listening: () => Boolean(listener), timeout: () => timeout() };
}
for (const codeFirst of [true, false]) test(`signup waits for both code and FINISH (code first: ${codeFirst})`, async () => {
  const f = fixture(); const promise = f.start();
  if (codeFirst) f.login(); else f.event();
  assert.equal(f.listening(), true);
  if (codeFirst) f.event(); else f.login();
  const result = await promise;
  assert.equal(result.code, 'code'); assert.equal(result.phoneNumberId, '456'); assert.equal(f.listening(), false);
});
test('untrusted origins cannot provide identifiers; timeout cleans up', async () => {
  const f = fixture(); const promise = f.start(); f.login(); f.event('https://attacker.example');
  assert.equal(f.listening(), true); f.timeout(); await assert.rejects(promise, /timed out/); assert.equal(f.listening(), false);
});
test('cancel rejects and removes the listener', async () => {
  const f = fixture(); const promise = f.start(); f.event('https://web.facebook.com', 'CANCEL');
  await assert.rejects(promise, /cancelled/); assert.equal(f.listening(), false);
});
