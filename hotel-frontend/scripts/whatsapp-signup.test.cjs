const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/lib/metaSignup.ts'), 'utf8')
  .replace(/import\.meta\.env\.VITE_META_APP_ID/g, "'app'").replace(/import\.meta\.env\.VITE_META_CONFIG_ID/g, "'config'");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
function fixture() {
  let listener, callback, timeout, options;
  const sandbox = { exports: {}, clearTimeout() {}, window: {
    addEventListener: (type, fn) => { listener = fn; }, removeEventListener: () => { listener = null; },
    setTimeout: fn => { timeout = fn; return 1; }, FB: { login: (fn, opts) => { callback = fn; options = opts; } },
  } };
  vm.runInNewContext(compiled, sandbox);
  return { start: mode => sandbox.exports.launchMetaSignup(mode), options: () => options, login: () => callback({ authResponse: { code: 'code' } }),
    event: (origin = 'https://www.facebook.com', event = 'FINISH', phone_number_id = '456') => listener({ origin, data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data: { waba_id: '123', phone_number_id } }) }),
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

test('Coexistence accepts WABA-only completion and passes the Business app feature', async () => {
  const f = fixture(); const promise = f.start('coexistence');
  f.event('https://www.facebook.com', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', ''); f.login();
  const result = await promise;
  assert.equal(result.onboardingMode, 'coexistence'); assert.equal(result.phoneNumberId, '');
  assert.equal(f.options().extras.featureType, 'whatsapp_business_app_onboarding');
});
