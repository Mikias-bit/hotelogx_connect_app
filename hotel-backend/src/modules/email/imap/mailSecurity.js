import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { decryptToken } from '../../../utils/tokenCrypto.js';

export const IMAP_PROVIDERS = ['credentials', 'hostinger'];
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address,prefix,'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::',3,'ipv6');
for (const [address,prefix] of [['2001::',32],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(address,prefix,'ipv6');
export function isPublicAddress(address) {
  const type = isIP(address);
  return type === 4 ? !blocked.check(address,'ipv4') : type === 6 && globalV6.check(address,'ipv6') && !blocked.check(address,'ipv6');
}
export async function resolveMailHost(host, resolver = lookup) {
  if (typeof host !== 'string' || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || !host.includes('.') || isIP(host)) throw new Error('Enter a public mail server hostname');
  let timer;
  let addresses;
  try { addresses = await Promise.race([resolver(host,{ all: true }),new Promise((_,reject) => { timer=setTimeout(() => reject(new Error('Mail server DNS timed out')),5000); })]); }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(x => !isPublicAddress(x.address))) throw new Error('Mail server must resolve to a public address');
  // Connect to the vetted IP, with the original hostname for certificate checks.
  // This prevents a second DNS lookup from rebinding to a private/internal server.
  return { address: (addresses.find(x => x.family === 4) || addresses[0]).address, servername: host };
}
export function decryptMailPassword(value) {
  if (!/^[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]+$/i.test(value || '')) throw new Error('Mailbox credentials need to be entered again');
  const password = decryptToken(value);
  if (!password) throw new Error('Mailbox credentials could not be decrypted; reconnect');
  return password;
}
export function connectionSettings(input, existing = null) {
  const settings = input.settings || input;
  const email = String(input.email || input.address || '').trim().toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)) throw new Error('Valid mailbox email required');
  const imapHost = String(settings.imapHost || input.host || '').trim().toLowerCase();
  const smtpHost = String(settings.smtpHost || '').trim().toLowerCase();
  const imapPort = Number(settings.imapPort || input.port || 993);
  const smtpPort = Number(settings.smtpPort || 465);
  if (![993,143].includes(imapPort) || ![465,587].includes(smtpPort)) throw new Error('Use IMAP port 993/143 and SMTP port 465/587');
  const imapSecurity = settings.imapSecurity || (imapPort === 993 ? 'SSL/TLS' : 'STARTTLS');
  const smtpSecurity = settings.smtpSecurity || (smtpPort === 465 ? 'SSL/TLS' : 'STARTTLS');
  if (imapSecurity !== (imapPort === 993 ? 'SSL/TLS' : 'STARTTLS') || smtpSecurity !== (smtpPort === 465 ? 'SSL/TLS' : 'STARTTLS')) throw new Error('Mail encryption must match its port: TLS on 993/465, STARTTLS on 143/587');
  const imapUser = String(settings.imapUser || input.imapUser || email).trim();
  const smtpUser = String(settings.smtpUser || input.smtpUser || email).trim();
  if ([imapUser,smtpUser].some(x => !x || /[\r\n\0]/.test(x) || x.length > 320)) throw new Error('Valid mail server usernames required');
  const sameMailbox = existing && IMAP_PROVIDERS.includes(existing.provider) && existing.email.toLowerCase() === email && existing.imapHost === imapHost && (existing.imapUser || existing.email) === imapUser;
  const sameSmtp = sameMailbox && existing.smtpHost === smtpHost && (existing.smtpUser || existing.email) === smtpUser;
  const imapPassword = input.imapPassword || input.password || (sameMailbox ? decryptMailPassword(existing.imapPassword || existing.accessToken) : null);
  const smtpPassword = input.smtpPassword || input.password || (sameSmtp ? decryptMailPassword(existing.smtpPassword || existing.accessToken) : null);
  if ([imapPassword,smtpPassword].some(x => typeof x !== 'string' || !x || x.length > 4096 || x.includes('\0'))) throw new Error('IMAP and SMTP passwords are required');
  return { email, imapHost, imapPort, imapSecurity, imapUser, smtpHost, smtpPort, smtpSecurity, smtpUser, imapPassword, smtpPassword, sameMailbox: Boolean(sameMailbox) };
}
