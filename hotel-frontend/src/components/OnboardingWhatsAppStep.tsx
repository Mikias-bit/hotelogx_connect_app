import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { launchMetaSignup } from '@/lib/metaSignup';
import { refreshWhatsAppStatus, toast } from '@/lib/store';
import type { WaConnectionType } from '@/lib/types';
import { Button, Card, SectionTitle } from './ui';
declare global { interface Window { FB?: any; fbAsyncInit?: () => void; } }
export function OnboardingWhatsAppStep({ connectionType }: { connectionType: WaConnectionType }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [mode, setMode] = useState<'standard' | 'coexistence'>('standard');
  const [both, setBoth] = useState(false);
  const [phoneNumberId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('Hello! This is a WhatsApp connection test from our hotel.');
  const refresh = async () => {
    const result = await refreshWhatsAppStatus();
    setStatus(result?.connections?.find((c: any) => [connectionType, 'both'].includes(c.targetType)) || null);
  };
  useEffect(() => { refresh().catch(err => setError(err.message)); }, [connectionType]);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (err) { setError(err instanceof Error ? err.message : 'WhatsApp request failed'); }
    finally { setBusy(false); }
  };
  const connect = () => run(async () => {
    const targetType = both ? 'both' : connectionType;
    if (manual) await api.connectManualWhatsApp({ targetType, phoneNumberId: phoneNumberId.trim(), wabaId: wabaId.trim(), accessToken: accessToken.trim(), pin });
    else await api.exchangeMetaEmbeddedSignup({ ...await launchMetaSignup(mode), targetType, pin });
    setToken(''); setPin(''); await refresh();
    toast('WhatsApp authorization verified', 'good', 'Send an inbound message to confirm webhook delivery.');
  });
  return <Card>
    <SectionTitle title={connectionType === 'guest' ? 'Guest WhatsApp' : 'Internal WhatsApp'} hint="Connect your business number through Meta" />
    {error && <p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {status?.connected ? <div className="space-y-3">
      <p>Verified connection: {status.number}</p>
      <p>{status.onboardingMode === 'coexistence' ? 'WhatsApp Business app + Hotelogx (Coexistence)' : 'Cloud API connection'}</p>
      {status.onboardingMode === 'coexistence' && <p className="text-sm">History: {status.historySyncStatus || 'Awaiting sync'}. {status.syncError || 'Keep the Business app open while history is shared.'}</p>}
      <p className="text-sm">Last inbound: {status.lastInboundAt ? new Date(status.lastInboundAt).toLocaleString() : 'Awaiting first message'}</p>
      <p className="text-sm">Last outbound status: {status.lastDeliveryStatus || 'No delivery receipt yet'}</p>
      <p className="text-sm">First send a WhatsApp message from your test phone to this business number. Then enter that test phone below to test a reply.</p>
      <input aria-label="Test recipient" placeholder="Test recipient, including country code" value={recipient} onChange={e => setRecipient(e.target.value)} className="w-full rounded border p-2" />
      <input aria-label="Test message" value={message} onChange={e => setMessage(e.target.value)} className="w-full rounded border p-2" />
      <Button disabled={busy || !recipient.trim() || !message.trim()} onClick={() => void run(async () => {
        const result = await api.sendWhatsAppTestMessage(recipient, message, connectionType);
        toast('Meta accepted the test message', 'good', result?.messageId || 'Check the recipient and refresh delivery status.'); await refresh();
      })}>Send test reply</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(refresh)}>Refresh status</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { await api.disconnectWhatsApp(); await refresh(); })}>Disconnect WhatsApp connections</Button>
    </div> : <div className="space-y-3">
      {status?.lastError && <p className="text-sm">{status.lastError}</p>}
      <label className="block text-sm"><input type="checkbox" checked={both} onChange={e => setBoth(e.target.checked)} /> Use one number for guests and internal messages</label>
      {!manual && <label className="block text-sm">How do you use this number?
        <select aria-label="WhatsApp connection method" value={mode} onChange={e => setMode(e.target.value as 'standard' | 'coexistence')} className="block w-full rounded border p-2">
          <option value="standard">New or existing Cloud API number</option>
          <option value="coexistence">Keep my WhatsApp Business app (Coexistence)</option>
        </select>
      </label>}
      {!manual && mode === 'coexistence' && <p className="text-sm">Use a number already active in the WhatsApp Business mobile app. Meta checks eligibility. Keep the app open and approve the connection and history sharing when prompted. Phone replies pause AI for that conversation; a reply already sent cannot be recalled.</p>}
      {(manual || mode === 'standard') && <label className="block text-sm">Six-digit registration PIN (needed only for an unregistered Cloud API number)
        <input type="password" autoComplete="off" maxLength={6} value={pin} onChange={e => setPin(e.target.value)} className="block w-full rounded border p-2" />
      </label>}
      <label className="block text-sm"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} /> Use existing Meta API credentials</label>
      {manual && <>
        <input aria-label="WABA ID" placeholder="WhatsApp Business Account ID" value={wabaId} onChange={e => setWabaId(e.target.value)} className="w-full rounded border p-2" />
        <input aria-label="Phone Number ID" placeholder="Phone Number ID" value={phoneNumberId} onChange={e => setPhoneId(e.target.value)} className="w-full rounded border p-2" />
        <input aria-label="Access token" autoComplete="off" type="password" placeholder="Meta access token" value={accessToken} onChange={e => setToken(e.target.value)} className="w-full rounded border p-2" />
      </>}
      <Button disabled={busy} onClick={() => void connect()}>{busy ? 'Verifying with Meta…' : manual ? 'Verify and connect' : 'Continue with Facebook'}</Button>
    </div>}
  </Card>;
}
