import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('IMAP PostgreSQL migration, credential transactions and ingestion recovery',{skip:process.env.IMAP_DATABASE_TESTS!=='true'},async t=>{
  const schema=new URL(process.env.DATABASE_URL).searchParams.get('schema');assert.match(schema || '',/^imap_test_[a-f0-9]+$/);
  const {prisma:db}=await import('../config/database.js');
  const {createMailboxLock}=await import('../modules/email/gmail/MailboxLock.js');
  const {ImapConnectionService}=await import('../modules/email/imap/ImapConnectionService.js');
  const {ImapPollingService}=await import('../modules/email/imap/ImapPollingService.js');
  const {ImapInboundProcessor}=await import('../modules/email/imap/ImapInboundProcessor.js');
  const {decryptMailPassword}=await import('../modules/email/imap/mailSecurity.js');
  const hotelId='imap-test-hotel';
  await db.hotel.create({data:{id:hotelId,name:'Test',legalName:'',address:'',postcode:'',city:'',country:'',phone:'',email:'hotel@example.com',website:'',bookingEngine:'',whatsappNumber:'',vatNumber:'',description:''}});
  const lock=createMailboxLock(db,{schema});
  let failVerify=false;
  const connection=new ImapConnectionService({db,withMailboxLock:lock,adapterFactory:()=>({verifyConnection:async()=>{if(failVerify)throw new Error('SMTP failed');return {uidValidity:'10',lastUid:'100'};}})});
  const input={email:'hotel@example.com',password:'incoming-app-pass',smtpPassword:'outgoing-app-pass',settings:{imapHost:'imap.example.com',smtpHost:'smtp.example.com'}};
  let integration;
  try {
    await t.test('both credentials are encrypted, completion is atomic and new connection starts at baseline',async()=>{
      const result=await connection.connect(hotelId,input);assert.equal(result.verified,true);
      integration=await db.emailIntegration.findUnique({where:{hotelId}});
      assert.notEqual(integration.imapPassword,input.password);assert.equal(decryptMailPassword(integration.imapPassword),input.password);
      assert.equal(decryptMailPassword(integration.smtpPassword),input.smtpPassword);assert.equal(integration.accessToken,null);
      assert.equal(integration.imapLastUid,'100');assert.equal((await db.onboardingState.findUnique({where:{hotelId}})).emailDone,true);
      assert.equal(JSON.stringify(result).includes('app-pass'),false);
    });
    await t.test('failed verification leaves saved credentials and cursor intact',async()=>{
      failVerify=true;await assert.rejects(connection.connect(hotelId,{...input,password:'replacement'}));
      const row=await db.emailIntegration.findUnique({where:{hotelId}});assert.equal(row.imapPassword,integration.imapPassword);assert.equal(row.imapLastUid,'100');failVerify=false;
    });
    await t.test('credential refresh preserves an earlier retry cursor and rejects cross-hotel mailbox binding',async()=>{
      await db.emailIntegration.update({where:{hotelId},data:{imapLastUid:'90'}});
      await connection.connect(hotelId,input);assert.equal((await db.emailIntegration.findUnique({where:{hotelId}})).imapLastUid,'90');
      await assert.rejects(db.emailIntegration.create({data:{hotelId:'other',email:'HOTEL@example.com',provider:'hostinger'}}),{code:'P2002'});
    });
    let failAI=true,failSend=true,calls=0,sends=0;
    const message={id:`${integration.imapMailboxKey}:10:101`,threadId:'<thread@example.com>',internetMessageId:'<inbound@example.com>',sender:'guest@example.com',from:'Guest <guest@example.com>',subject:'Question',text:'Hello',receivedAt:new Date()};
    const processor=new ImapInboundProcessor({db,broadcast:()=>{},automate:async({database:tx,conversationId})=>{calls++;await tx.message.create({data:{id:randomUUID(),conversationId,author:'ai',channel:'email',body:'Welcome',at:'now'}});if(failAI)throw new Error('AI failure');return {replyText:'Welcome'};},send:async options=>{assert.equal(options.inReplyTo,message.internetMessageId);sends++;if(failSend)throw Object.assign(new Error('SMTP rejected'),{definitelyNotSent:true});return {success:true,messageId:'<sent@example.com>'};}});
    let messages=[message];
    const polling=new ImapPollingService({db,processor,withMailboxLock:lock,adapterFactory:()=>({fetchBatch:async()=>({messages,uidValidity:'10',lastUid:'101',recoveryUntilUid:'0',hasMore:false})})});
    await t.test('AI failure rolls back AI writes and retains old UID',async()=>{
      await assert.rejects(polling.pollIntegration(hotelId));assert.equal(await db.message.count({where:{author:'ai'}}),0);assert.equal(await db.imapInboundMessage.count(),1);assert.equal((await db.emailIntegration.findUnique({where:{hotelId}})).imapLastUid,'90');
    });
    await t.test('rejected SMTP send resumes persisted work after original email disappears',async()=>{
      failAI=false;await assert.rejects(polling.pollIntegration(hotelId));assert.equal(calls,2);assert.equal(sends,1);
      messages=[];failSend=false;await polling.pollIntegration(hotelId);assert.equal(calls,2);assert.equal(sends,2);
      messages=[message];await polling.pollIntegration(hotelId);assert.equal(sends,2);assert.equal(await db.message.count({where:{author:'guest'}}),1);
      assert.equal((await db.emailIntegration.findUnique({where:{hotelId}})).imapLastUid,'101');
    });
    await t.test('ambiguous SMTP acceptance is never resent automatically',async()=>{
      let attempts=0;const uncertain=new ImapInboundProcessor({db,broadcast:()=>{},automate:async()=>({replyText:'Hello'}),send:async()=>{attempts++;throw new Error('DATA response lost');}});
      await assert.rejects(lock(hotelId,assertOwned=>uncertain.process(integration,{...message,id:'uncertain'},{assertOwned})));
      await assert.rejects(lock(hotelId,assertOwned=>uncertain.resumePending(integration,assertOwned)));assert.equal(attempts,1);
    });
    await t.test('HTTP checks require manager identity; generic onboarding cannot overwrite verified credentials',async()=>{
      const {default:app}=await import('../app.js');const {signToken}=await import('../utils/jwt.js');
      const user=await db.user.create({data:{hotelId,email:'manager@example.com',name:'Manager',role:'manager'}});
      const token=signToken({id:user.id,hotelId});const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
      const base=`http://127.0.0.1:${server.address().port}/api`;
      try {
        assert.equal((await fetch(`${base}/email/test-connection`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})).status,401);
        const before=(await db.emailIntegration.findUnique({where:{hotelId}})).imapPassword;
        const saved=await fetch(`${base}/onboarding/step`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({stepKey:'email',data:{method:'manual',address:integration.email,password:'unverified-replacement',settings:{imapHost:'attacker.example'}}})});
        assert.equal(saved.status,200);assert.equal((await db.emailIntegration.findUnique({where:{hotelId}})).imapPassword,before);
        const status=await fetch(`${base}/email/status`,{headers:{Authorization:`Bearer ${token}`}});const json=await status.json();assert.equal(json.data.ingestionReady,true);assert.equal(JSON.stringify(json).includes('Password'),false);
        const worker=await fetch(`${base}/workers/email/imap-poll`,{method:'POST'});assert.ok([401,503].includes(worker.status));
      } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    });
  } finally {await db.$disconnect();}
});
