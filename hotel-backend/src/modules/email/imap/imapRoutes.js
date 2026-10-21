import { Router } from 'express';
import { config } from '../../../config/env.js';
import { prisma } from '../../../config/database.js';
import { authenticate } from '../../../middlewares/auth.js';
import { requireGmailManager } from '../gmail/gmailRoutes.js';
import { googleOidcVerifier,withGmailMailboxLock } from '../gmail/runtime.js';
import { imapPollingService } from './runtime.js';
export const imapWorkerRouter=Router();
imapWorkerRouter.post('/imap-poll',async(req,res)=>{
  try { await googleOidcVerifier.verifyAuthorizationHeader(req.headers.authorization,{ audience:config.imapWorker.audience,serviceAccountEmail:config.imapWorker.serviceAccount }); }
  catch(error) { return res.status(error.status || 401).json({ success:false,message:'Worker identity not authorized' }); }
  try { const result=await imapPollingService.pollConnectedMailboxes(); res.status(result.success?200:503).json(result); }
  catch { res.status(503).json({ success:false,message:'IMAP worker failed; retry required' }); }
});
export const imapManagerRouter=Router();
imapManagerRouter.use(authenticate,requireGmailManager);
imapManagerRouter.post('/sync',async(req,res)=>{
  try { res.json({ success:true,data:await imapPollingService.pollIntegration(req.user.hotelId) }); }
  catch { res.status(503).json({ success:false,message:'IMAP sync failed; check mailbox status and pending deliveries' }); }
});
imapManagerRouter.get('/deliveries',async(req,res)=>{
  try { res.json({ success:true,data:await prisma.imapInboundMessage.findMany({ where:{ hotelId:req.user.hotelId,status:'pending' },select:{ id:true,mailbox:true,providerMessageId:true,replyStatus:true,lastError:true,receivedAt:true },take:100 }) }); }
  catch { res.status(503).json({ success:false }); }
});
for(const [action,flag,nextStatus] of [['retry','confirmedNotSent','pending'],['confirm-sent','confirmedSent','sent']]) {
  imapManagerRouter.post(`/deliveries/:id/${action}`,async(req,res)=>{
    if(req.body?.[flag]!==true) return res.status(400).json({ success:false,message:'Verify delivery with your mail provider before confirming' });
    try {
      await withGmailMailboxLock(req.user.hotelId,async()=>{
        const row=await prisma.imapInboundMessage.updateMany({ where:{ id:req.params.id,hotelId:req.user.hotelId,status:'pending',replyStatus:{ in:['sending','uncertain'] } },data:{ replyStatus:nextStatus,lastError:null } });
        if(!row.count) throw new Error('No uncertain delivery');
      });
      res.json({ success:true });
    } catch { res.status(409).json({ success:false }); }
  });
}
