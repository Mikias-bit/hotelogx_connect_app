import { API_BASE_URL } from './api';

export const identityEnabled = import.meta.env.VITE_NETLIFY_IDENTITY_ENABLED === 'true';
export const hasIdentityCallback = () => typeof window !== 'undefined' && /(?:^#|&)(invite_token|recovery_token|confirmation_token|access_token|email_change_token)=/.test(window.location.hash);
let callback: Promise<Awaited<ReturnType<typeof import('@netlify/identity')['handleAuthCallback']>>> | undefined;
export function identityCallback() {
  // One exchange per page, including React Strict Mode's effect replay.
  return callback ??= import('@netlify/identity').then(sdk => sdk.handleAuthCallback());
}

let exchange: Promise<{ token: string; user: any; onboardingRequired: boolean }> | undefined;
export function exchangeIdentitySession() {
  return exchange ??= exchangeSession().finally(() => { exchange = undefined; });
}
async function exchangeSession() {
  const sdk = await import('@netlify/identity');
  await sdk.getUser();
  await sdk.refreshSession();
  // The SDK maintains this cookie after browser login/acceptance/refresh.
  // It is verified by Cloud Run against the configured Identity /user endpoint.
  const raw = document.cookie.split('; ').find(c => c.startsWith('nf_jwt='))?.slice(7);
  if (!raw) throw new Error('Your invitation session expired. Please sign in again.');
  const response = await fetch(`${API_BASE_URL}/auth/identity`, { method: 'POST', headers: { Authorization: `Bearer ${decodeURIComponent(raw)}` } });
  const body = await response.json();
  if (!response.ok || !body.data?.token) throw new Error(body.message || 'Hotel access could not be verified.');
  return body.data as { token: string; user: any; onboardingRequired: boolean };
}

export async function identityLogin(email: string, password: string) {
  await (await import('@netlify/identity')).login(email, password);
  return exchangeIdentitySession();
}
export async function acceptHotelInvite(token: string, password: string) {
  await (await import('@netlify/identity')).acceptInvite(token, password);
  return exchangeIdentitySession();
}
export async function identityLogout() { await (await import('@netlify/identity')).logout(); }
