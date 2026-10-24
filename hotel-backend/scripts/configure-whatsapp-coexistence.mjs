import { spawnSync } from 'node:child_process';
const args = Object.fromEntries(process.argv.slice(2).filter(v => v.startsWith('--') && v.includes('=')).map(v => v.slice(2).split('=')));
const project = args.project || 'hotelogx', appId = args['app-id'];
if (!/^\d+$/.test(appId || '')) throw new Error('Supply --app-id=YOUR_META_APP_ID');
const identifier = /^[a-zA-Z0-9_-]+$/;
function secret(name) {
  if (!identifier.test(name) || !identifier.test(project)) throw new Error('Invalid secret/project identifier');
  const command = `gcloud${process.platform === 'win32' ? '.cmd' : ''}`;
  const result = spawnSync(command, ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${project}`], { shell: process.platform === 'win32', encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Unable to read Meta secret from Secret Manager');
  return result.stdout.trim();
}
const token = `${appId}|${secret(args['app-secret-name'] || 'META_APP_SECRET')}`;
const url = `https://graph.facebook.com/v25.0/${appId}/subscriptions`;
async function request(body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(`Meta subscription request failed: HTTP ${response.status}, code ${result.error?.code || 'unknown'}`);
  return result;
}
const current = (await request()).data?.find(s => s.object === 'whatsapp_business_account');
if (!current?.active || !current.callback_url?.startsWith('https://')) throw new Error('Configure and verify the initial WhatsApp webhook in Meta first');
const required = ['messages', 'smb_message_echoes', 'history', 'smb_app_state_sync'];
const fields = [...new Set([...(current.fields || []).map(f => f.name), ...required])];
console.log(JSON.stringify({ callback: current.callback_url, existingFields: current.fields?.map(f => f.name), requiredFields: required }));
if (process.argv.includes('--apply')) {
  const result = await request({ object: 'whatsapp_business_account', callback_url: current.callback_url, verify_token: secret(args['verify-token-secret-name'] || 'VERIFY_TOKEN'), fields: fields.join(',') });
  if (result.success !== true) throw new Error('Meta did not confirm webhook configuration');
  const verified = (await request()).data?.find(s => s.object === 'whatsapp_business_account');
  if (!verified?.active || !required.every(name => verified.fields?.some(f => f.name === name))) throw new Error('Coexistence webhook subscription verification failed');
  console.log('Coexistence webhook fields enabled and verified; existing callback preserved.');
} else console.log('Read-only check. Add --apply to enable the required fields.');
