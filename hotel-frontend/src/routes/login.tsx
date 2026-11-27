import { useEffect, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Logo, Wordmark } from '@/components/Logo';
import { Button } from '@/components/ui';
import { roleHome, signIn } from '@/lib/session';
import { initBackendSync, resetStoreState, store } from '@/lib/store';
import { api } from '@/lib/api';
import { acceptHotelInvite, exchangeIdentitySession, hasIdentityCallback, identityCallback, identityEnabled, identityLogin } from '@/lib/identity';

export const Route = createFileRoute('/login')({ component: Login });
const steps = [
  {
    title: "The guest writes wherever they already are",
    body: "WhatsApp, Gmail, Outlook or your own mailbox. One thread per guest, whatever they use.",
  },
  {
    title: "The AI answers, and knows when not to",
    body: "It replies from your own policies and live availability, and escalates complaints, refunds and safety to a human.",
  },
  {
    title: "Work reaches the right department on WhatsApp",
    body: "Housekeeping and maintenance update rooms and tickets with a tap. No new app to learn.",
  },
  {
    title: "Everyone sees only what needs them",
    body: "Managers get a morning briefing instead of an inbox. Reception gets prepared answers instead of questions.",
  },
];


function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'invite' | 'request' | 'recovery'>('signin');
  const [provider, setProvider] = useState(identityEnabled ? 'netlify' : 'existing');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [name, setName] = useState(''), [hotelName, setHotelName] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [callbackPending, setCallbackPending] = useState(false);
  async function finish(result: { token: string; user: any; onboardingRequired?: boolean }, source: string) {
    resetStoreState();
    localStorage.setItem('token', result.token);
    localStorage.setItem('hotelogx.authProvider', source);
    await signIn(result.user.id, result.user);
    if (!await initBackendSync({ force: true })) throw new Error('Your account is verified, but the hotel profile could not be loaded. Please sign in again to retry.');
    const needsSetup = result.user.role === 'manager' && !store.state.onboarding.complete;
    if (sessionStorage.getItem('hotelogx.returnTo') === '/manager/access-requests') {
      sessionStorage.removeItem('hotelogx.returnTo');
      navigate({ to: '/manager/access-requests', replace: true });
      return;
    }
    navigate({ to: needsSetup ? '/onboarding' : roleHome[result.user.role as keyof typeof roleHome] || '/manager', replace: true });
  }
  useEffect(() => {
    if (!hasIdentityCallback()) return;
    setCallbackPending(true);
    identityCallback().then(async result => {
      if (result?.type === 'invite' && result.token) { setInviteToken(result.token); setMode('invite'); setPassword(''); }
      else if (result?.type === 'recovery') { setMode('recovery'); setPassword(''); }
      else if (result?.user) await finish(await exchangeIdentitySession(), 'netlify');
    }).catch(() => setError('This invitation or sign-in link could not be verified. Please reopen the latest email or ask for a new invitation.'))
      .finally(() => setCallbackPending(false));
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'request') {
        if (!await api.requestAccess({ name, hotelName, email })) throw new Error('Could not record your request. Please try again.');
        setNotice('Your request has been recorded for review. An invitation is required before you can set up a hotel.');
        return;
      }
      if (mode === 'invite' || mode === 'recovery') {
        if (password.length < 12 || password !== confirm) throw new Error('Use at least 12 characters and enter the same password twice.');
        if (mode === 'invite') await finish(await acceptHotelInvite(inviteToken, password), 'netlify');
        else {
          await (await import('@netlify/identity')).updateUser({ password });
          await finish(await exchangeIdentitySession(), 'netlify');
        }
      } else if (provider === 'netlify') await finish(await identityLogin(email.trim(), password), 'netlify');
      else {
        const result = await api.login({ email: email.trim(), password });
        if (!result) throw new Error('Invalid email or password.');
        await finish(result, 'existing');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete sign-in. Please try again.'); }
    finally { setBusy(false); }
  }
  const field = 'mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink';
  return <div className="grain grid min-h-dvh bg-paper lg:grid-cols-[1.05fr_1fr]">
      {/* left — positioning */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-pine-900 px-10 py-12 text-pine-100 lg:flex xl:px-14">
        <span
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 15%, #4c8574 0%, transparent 45%), radial-gradient(circle at 85% 80%, #3f5c96 0%, transparent 40%)",
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <Logo onDark />
            <Wordmark onDark className="text-[18px]" />
          </div>
          <p className="mt-3 text-[12.5px] tracking-[0.01em] text-pine-200">
            One intelligent layer for hotel operations &amp; guest communication
          </p>

          <h1 className="mt-12 max-w-lg font-display text-[38px] leading-[1.08] font-medium text-white xl:text-[44px]">
            An AI front office and operations assistant.
          </h1>
          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-pine-200">
            Not a chatbot, not another inbox. The AI handles routine guest communication and coordinates your departments —
            your team sees only what genuinely requires a person.
          </p>
        </div>

        <ol className="relative mt-12 space-y-5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3.5">
              <span className="tnum mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-pine-400/50 font-mono text-[11px] text-pine-200">
                {i + 1}
              </span>
              <div>
                <p className="text-[13.5px] font-medium text-white">{step.title}</p>
                <p className="mt-0.5 max-w-sm text-[12.5px] leading-snug text-pine-200/85">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <p className="relative mt-10 flex max-w-md items-start gap-2 border-t border-pine-400/25 pt-5 text-[12px] leading-snug text-pine-200/75">
          <Sparkles className="mt-px size-3.5 shrink-0" />
          Reservations always complete on your own booking engine — the AI checks availability and pricing in your PMS, then
          hands the guest a direct link. It never takes payment.
        </p>
      </section>


    <section className="flex items-center justify-center px-5 py-10 sm:px-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 flex items-center gap-2 lg:hidden"><Logo /><Wordmark /></div>
        <p className="text-xs font-semibold uppercase tracking-widest text-ink-4">Invitation-only access</p>
        <h1 className="mt-2 font-display text-3xl">{mode === 'invite' ? 'Accept your hotel invitation' : mode === 'request' ? 'Request access' : mode === 'recovery' ? 'Set a new password' : 'Sign in to Hotelogx One'}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-3">{mode === 'invite' ? 'Choose a password. We will connect your verified invitation to the hotel approved for you, then open its setup wizard.' : mode === 'request' ? 'Tell us about your hotel. Requesting access does not create an account or workspace.' : 'Your hotel and role are assigned by an administrator.'}</p>
        {error && <p role="alert" className="mt-4 rounded-lg border border-urgent-line bg-urgent-bg p-3 text-sm text-urgent">{error}</p>}
        {notice && <p role="status" className="mt-4 rounded-lg border border-line p-3 text-sm">{notice}</p>}
        {callbackPending ? <p role="status" className="mt-6">Checking your invitation?</p> : <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === 'signin' && identityEnabled && <label className="block text-sm">Account type<select className={field} value={provider} onChange={e => { setProvider(e.target.value); setPassword(''); setError(''); }}><option value="netlify">Invited hotel administrator (Netlify)</option><option value="existing">Existing hotel or staff account</option></select></label>}
          {mode === 'request' && <>
            <label className="block text-sm">Your name<input className={field} required maxLength={120} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>
            <label className="block text-sm">Hotel name<input className={field} required maxLength={200} autoComplete="organization" value={hotelName} onChange={e => setHotelName(e.target.value)} /></label>
          </>}
          {(mode === 'signin' || mode === 'request') && <label className="block text-sm">Work email<input className={field} required type="email" maxLength={254} autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>}
          {mode !== 'request' && <label className="block text-sm">{mode === 'signin' ? 'Password' : 'New password (at least 12 characters)'}<input className={field} required type="password" minLength={mode === 'signin' ? undefined : 12} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} /></label>}
          {(mode === 'invite' || mode === 'recovery') && <label className="block text-sm">Confirm password<input className={field} required type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>}
          <Button type="submit" className="w-full" icon={ArrowRight} disabled={busy || !!notice}>{busy ? 'Please wait?' : mode === 'request' ? 'Submit access request' : mode === 'invite' ? 'Accept invitation & continue' : mode === 'recovery' ? 'Save password & continue' : 'Sign in'}</Button>
        </form>}
        <div className="mt-6 border-t border-line pt-4 text-sm">
          {mode === 'signin' ? <><p className="text-ink-3">New hotel? Access is approved individually.</p><Button variant="quiet" disabled={busy || callbackPending} onClick={() => { setMode('request'); setError(''); setNotice(''); setPassword(''); }}>Request access</Button></> : <Button variant="quiet" disabled={busy || callbackPending} onClick={() => { setMode('signin'); setProvider(identityEnabled || inviteToken ? 'netlify' : 'existing'); setError(''); setNotice(''); setPassword(''); }}>Back to sign in</Button>}
        </div>
      </div>
    </section>
  </div>;
}
