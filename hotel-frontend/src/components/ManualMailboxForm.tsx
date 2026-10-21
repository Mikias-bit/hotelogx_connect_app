import { useState } from 'react';
import { connectEmail, useApp } from '@/lib/store';
import { Button } from './ui';
import type { EmailServerSettings } from '@/lib/types';

export function ManualMailboxForm({ onConnected }: { onConnected?: () => void }) {
  const email = useApp(s => s.integrations.email);
  const onboarding = useApp(s => s.onboarding.email);
  const [address,setAddress] = useState(email.account || onboarding.address || '');
  const [password,setPassword] = useState('');
  const [smtpPassword,setSmtpPassword] = useState('');
  const [busy,setBusy] = useState(false);
  const [settings,setSettings] = useState<EmailServerSettings>(onboarding.settings || onboarding.detection?.settings || { imapHost:'',imapPort:993,imapSecurity:'SSL/TLS',smtpHost:'',smtpPort:465,smtpSecurity:'SSL/TLS' });
  const inputClass = 'mt-1 w-full rounded-[9px] border border-line bg-surface px-2.5 py-2 text-sm';
  return <div className="mt-4 grid gap-3 rounded-[10px] border border-line p-4 sm:grid-cols-2">
    <label>Mailbox address<input className={inputClass} type="email" value={address} onChange={e=>setAddress(e.target.value)} /></label>
    <label>Mailbox password / app password<input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
    {(['imap','smtp'] as const).map(kind=><div key={kind} className="space-y-2">
      <label className="block">{kind.toUpperCase()} server<input className={inputClass} value={settings[`${kind}Host`]} onChange={e=>setSettings(s=>({...s,[`${kind}Host`]:e.target.value}))} placeholder={`${kind}.yourhotel.com`} /></label>
      <label className="block">{kind.toUpperCase()} port / encryption<select className={inputClass} value={settings[`${kind}Port`]} onChange={e=>setSettings(s=>({...s,[`${kind}Port`]:Number(e.target.value),[`${kind}Security`]:['993','465'].includes(e.target.value)?'SSL/TLS':'STARTTLS'}))}>
        <option value={kind==='imap'?993:465}>{kind==='imap'?993:465} — TLS</option><option value={kind==='imap'?143:587}>{kind==='imap'?143:587} — STARTTLS</option>
      </select></label>
      <label className="block">{kind.toUpperCase()} username (if different)<input className={inputClass} value={settings[`${kind}User`] || ''} placeholder={address} onChange={e=>setSettings(s=>({...s,[`${kind}User`]:e.target.value}))} /></label>
    </div>)}
    <label>SMTP password (if different)<input className={inputClass} type="password" autoComplete="new-password" value={smtpPassword} onChange={e=>setSmtpPassword(e.target.value)} /></label>
    <div className="sm:col-span-2"><Button disabled={busy || !address || !password || !settings.imapHost || !settings.smtpHost} onClick={async()=>{
      setBusy(true);
      try { if(await connectEmail('manual',settings,password,address,smtpPassword || undefined)) { setPassword('');setSmtpPassword('');onConnected?.(); } }
      finally { setBusy(false); }
    }}>{busy?'Checking IMAP and SMTP…':'Test and connect'}</Button>
    <p className="mt-2 text-xs text-ink-3">Checks sign-in and encrypted connections. No test email is sent.</p></div>
  </div>;
}
