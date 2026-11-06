import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function UpsellAutomation() {
  const [config, setConfig] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getUpsellAutomation().then(setConfig).catch(() => setNotice('Unable to load automatic offer settings.')); }, []);
  async function save() {
    setBusy(true); setNotice('');
    try { setConfig(await api.saveUpsellAutomation(config)); setNotice('Automatic offer settings saved.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-line bg-white p-5">
    <h2 className="text-lg font-semibold">Automatic pre-arrival offers</h2>
    <p className="text-sm text-ink-3">One message per reservation with up to three selected catalogue extras. The default is 3 days before arrival; you can change it below. Bookings confirmed inside that window, including same-day arrivals, receive their offer after confirmation is received from the PMS. Extras already offered by staff or AI are skipped across email and WhatsApp.</p>
    {config && <div className="space-y-3">
      <label className="block text-sm"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /> Enable automatic pre-arrival offers</label>
      <label className="block text-sm">Days before arrival <input className="ml-2 w-20 rounded border p-2" type="number" min="0" max="365" value={config.daysBeforeArrival} onChange={e => setConfig({ ...config, daysBeforeArrival: Number(e.target.value) })} /></label>
      <label className="block text-sm">Channel <select className="ml-2 rounded border p-2" value={config.channel} onChange={e => setConfig({ ...config, channel: e.target.value })}><option value="email_first">Email first, otherwise WhatsApp</option><option value="email">Email only</option><option value="whatsapp">WhatsApp only</option></select></label>
      {config.channel !== 'email' && <div className="space-y-2">
        <label className="block text-sm">Approved WhatsApp template <input className="ml-2 rounded border p-2" value={config.whatsappTemplate} onChange={e => setConfig({ ...config, whatsappTemplate: e.target.value })} placeholder="pre_arrival_extras" /></label>
        <label className="block text-sm">Template language <input className="ml-2 w-24 rounded border p-2" value={config.whatsappLanguage} onChange={e => setConfig({ ...config, whatsappLanguage: e.target.value })} /></label>
        <p className="text-xs text-ink-3">Use an approved template with one body variable for the extras and prices. Its fixed text should invite a reply with quantity and date, and explain that availability and an exact quote follow. Without a template, WhatsApp offers are skipped.</p>
      </div>}
      <button className="rounded bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40" disabled={busy} onClick={save}>Save automatic offers</button>
    </div>}
    <p className="text-xs text-ink-3">Automatic offers also respect the hotel AI mode and staff takeover. Failed or uncertain sends are retained for review and are not repeated automatically.</p>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
