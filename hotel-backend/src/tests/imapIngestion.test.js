import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ImapSmtpEmailAdapter } from '../modules/email/imap/ImapSmtpEmailAdapter.js';
import { ImapPollingService } from '../modules/email/imap/ImapPollingService.js';
import { ImapConnectionService } from '../modules/email/imap/ImapConnectionService.js';
import { connectionSettings,decryptMailPassword,resolveMailHost,isPublicAddress } from '../modules/email/imap/mailSecurity.js';
import { encryptToken } from '../utils/tokenCrypto.js';
const integration={ id:'i',hotelId:'h',email:'hotel@example.com',provider:'credentials',status:'connected',imapHost:'imap.example.com',smtpHost:'smtp.example.com',imapPort:993,smtpPort:465,imapPassword:'test-pass',smtpPassword:'test-pass',imapMailboxKey:'mailbox',imapUidValidity:'10',imapLastUid:'0',mailVerifiedAt:new Date() };
const resolveHost=async host=>({ address:'8.8.8.8',servername:host });
function client({ validity='10',next=4,uids=[1,2,3],missing=[],parseFailure=false }={}) {
  return { mailbox:{ uidValidity:BigInt(validity),uidNext:next },on(){},async connect(){},close(){this.closed=true;},async getMailboxLock(){return { release(){} };},
    async search(){return uids;},async fetchOne(uid,query,options){assert.equal(options.uid,true);if(missing.includes(Number(uid)))return false;return query.source?{source:Buffer.from(parseFailure?'broken':uid)}:{uid:Number(uid),size:200,internalDate:new Date(),flags:new Set()};} };
}
const parse=async source=>{ if(String(source)==='broken')throw new Error('MIME error');return { from:{ text:'Guest <guest@example.com>',value:[{address:'guest@example.com'}]},text:`Message ${source}`,messageId:`<m${source}@example.com>`,headers:new Map() }; };
const adapter=(c,extra={})=>new ImapSmtpEmailAdapter(integration,{ plaintext:true,resolveHost,createImap:()=>c,parse,...extra });

test('mail host resolution rejects private, loopback, link-local and mixed DNS answers',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  await assert.rejects(resolveMailHost('mail.example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
  assert.equal((await resolveMailHost('mail.example.com',async()=>[{address:'8.8.8.8',family:4}])).address,'8.8.8.8');
});
test('passwords must be encrypted at rest; plaintext and damaged tokens fail closed',()=>{
  const encrypted=encryptToken('app-password');assert.equal(decryptMailPassword(encrypted),'app-password');
  assert.throws(()=>decryptMailPassword('plain-password'));
  assert.throws(()=>decryptMailPassword('00:11:22'));
});
test('configuration requires both passwords and matching TLS ports',()=>{
  const input={email:integration.email,password:'secret',settings:{imapHost:integration.imapHost,smtpHost:integration.smtpHost}};
  assert.equal(connectionSettings(input).smtpPassword,'secret');
  assert.throws(()=>connectionSettings({...input,password:undefined}));
  assert.throws(()=>connectionSettings({...input,settings:{...input.settings,smtpPort:587,smtpSecurity:'None'}}));
  const separate=connectionSettings({...input,imapPassword:'incoming',smtpPassword:'outgoing'});
  assert.equal(separate.imapPassword,'incoming');assert.equal(separate.smtpPassword,'outgoing');
});
test('TLS uses pinned address and verified hostname; STARTTLS is mandatory on submission ports',async()=>{
  let imapOptions,smtpOptions;
  const a=new ImapSmtpEmailAdapter({...integration,imapPort:143,smtpPort:587},{plaintext:true,resolveHost,createImap:o=>{imapOptions=o;return client();},createSmtp:o=>{smtpOptions=o;return {close(){}};}});
  await a.imap();await a.smtp();
  assert.equal(imapOptions.host,'8.8.8.8');assert.equal(imapOptions.servername,'imap.example.com');assert.equal(imapOptions.doSTARTTLS,true);
  assert.equal(smtpOptions.requireTLS,true);assert.equal(smtpOptions.tls.rejectUnauthorized,true);assert.equal(smtpOptions.tls.servername,'smtp.example.com');
});
test('SMTP close destroys the actual socket, including after TLS negotiation',async()=>{
  let transportOptions;
  const socket=new EventEmitter();socket.destroy=()=>{socket.destroyed=true;socket.emit('close');};
  const a=adapter(client(),{socketFactory:()=>socket,createSmtp:options=>{transportOptions=options;return {close(){}};}});
  const transport=await a.smtp();
  const opened=new Promise((resolve,reject)=>transportOptions.getSocket({},(error,result)=>error?reject(error):resolve(result)));
  socket.emit('secureConnect');assert.equal((await opened).secured,true);
  transport.close();assert.equal(socket.destroyed,true);
});
test('connection verification authenticates SMTP after IMAP and sends no message',async()=>{
  let verified=false,closed=false;
  const c=client();const a=adapter(c,{createSmtp:()=>({verify:async()=>{verified=true;},close:()=>{closed=true;},sendMail:()=>assert.fail('must not send')})});
  assert.deepEqual(await a.verifyConnection(),{uidValidity:'10',lastUid:'3'});assert.equal(verified,true);assert.equal(c.closed,true);assert.equal(closed,true);
});
test('SMTP verification failure prevents saving credentials or completing onboarding',async()=>{
  let writes=0;
  const service=new ImapConnectionService({db:{emailIntegration:{findUnique:async()=>null,findFirst:async()=>null},hotel:{findUnique:async()=>({id:'h'})},$transaction:async()=>{writes++;}},withMailboxLock:async(_,fn)=>fn(async()=>{}),adapterFactory:()=>({verifyConnection:async()=>{throw new Error('smtp auth failed');}})});
  await assert.rejects(service.connect('h',{email:integration.email,password:'secret',settings:{imapHost:integration.imapHost,smtpHost:integration.smtpHost}}),/Mail connection failed/);assert.equal(writes,0);
});
test('UID batches process ascending IDs without skipping beyond their limit',async()=>{
  const a=adapter(client({uids:[3,1,2,2,0]}));
  const batch=await a.fetchBatch({limit:2});
  assert.deepEqual(batch.messages.map(m=>m.uid),[1,2]);assert.equal(batch.lastUid,'2');assert.equal(batch.hasMore,true);assert.equal(batch.messages[0].id,'mailbox:10:1');
});
test('UIDVALIDITY reset starts at zero and retains recovery boundary across batches',async()=>{
  const a=adapter(client({validity:'20',next:4}));a.integration={...integration,imapLastUid:'500'};
  const first=await a.fetchBatch({limit:2});assert.equal(first.lastUid,'2');assert.equal(first.recoveryUntilUid,'3');assert.ok(first.messages.every(m=>m.recovery));
  const b=adapter(client({validity:'20',next:5,uids:[3,4]}));b.integration={...integration,imapUidValidity:'20',imapLastUid:'2',imapRecoveryUntilUid:'3'};
  const next=await b.fetchBatch();assert.deepEqual(next.messages.map(m=>m.recovery),[true,false]);
});
test('expunged messages are skipped but MIME failure aborts the batch and closes connection',async()=>{
  const a=adapter(client({missing:[2]}));assert.deepEqual((await a.fetchBatch()).messages.map(m=>m.uid),[1,3]);
  const c=client({parseFailure:true});await assert.rejects(adapter(c).fetchBatch(),/MIME error/);assert.equal(c.closed,true);
});
test('no new UID avoids IMAP range reversal and returns an empty batch',async()=>{
  const c=client();c.search=()=>assert.fail('must not search when caught up');const a=adapter(c);a.integration={...integration,imapLastUid:'3'};
  const batch=await a.fetchBatch();assert.equal(batch.messages.length,0);assert.equal(batch.lastUid,'3');
});
test('large-message batches stop at their memory budget without skipping the next UID',async()=>{
  const c=client();const fetchOne=c.fetchOne;
  c.fetchOne=async(...args)=>{const result=await fetchOne(...args);if(args[1].size)result.size=20*1024*1024;return result;};
  const batch=await adapter(c).fetchBatch();
  assert.equal(batch.messages.length,2);assert.equal(batch.lastUid,'2');assert.equal(batch.hasMore,true);
});
test('SMTP replies preserve RFC threading and verify recipient acceptance',async()=>{
  let options;
  const a=adapter(client(),{createSmtp:()=>({sendMail:async o=>{options=o;return {accepted:['guest@example.com'],messageId:'sent'};},close(){}})});
  const sent=await a.send({to:'guest@example.com',subject:'Re: enquiry',bodyText:'Hello',inReplyTo:'<inbound@example.com>',rfcMessageId:'<stable@example.com>'});
  assert.equal(sent.success,true);assert.equal(options.inReplyTo,'<inbound@example.com>');assert.equal(options.messageId,'<stable@example.com>');assert.equal(options.headers['Auto-Submitted'],'auto-replied');
});
test('SMTP rejection is retryable, timeout after DATA remains uncertain, no second send',async()=>{
  for(const error of [Object.assign(new Error('rejected'),{responseCode:550}),Object.assign(new Error('lost DATA acknowledgement'),{code:'ETIMEDOUT',command:'DATA'})]){
    let sends=0;const a=adapter(client(),{createSmtp:()=>({sendMail:async()=>{sends++;throw error;},close(){}})});
    await assert.rejects(a.send({to:'guest@example.com',bodyText:'Hello'}));assert.equal(sends,1);assert.equal(error.definitelyNotSent===true,Boolean(error.responseCode));
  }
});
test('poll failure retains UID cursor; only successful full batch advances it',async()=>{
  const updates=[];let fail=true;
  const db={emailIntegration:{findUnique:async()=>integration,updateMany:async q=>{updates.push(q.data);return {count:1};}}};
  const polling=new ImapPollingService({db,withMailboxLock:async(_,fn)=>fn(async()=>{}),adapterFactory:()=>({fetchBatch:async()=>({messages:[{id:'id'}],uidValidity:'10',lastUid:'2',recoveryUntilUid:'0'})}),processor:{resumePending:async()=>{},process:async()=>{if(fail)throw new Error('AI failed');return {};}}});
  await assert.rejects(polling.pollIntegration('h'));assert.equal(updates.some(x=>x.imapLastUid),false);
  fail=false;await polling.pollIntegration('h');assert.equal(updates.at(-1).imapLastUid,'2');
});
