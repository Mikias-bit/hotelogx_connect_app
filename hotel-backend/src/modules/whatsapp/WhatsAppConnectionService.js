import { encryptToken, decryptToken } from '../../utils/tokenCrypto.js';
import { validMetaId, verifiedConnection } from './MetaClient.js';

export class WhatsAppConnectionService {
  constructor({ db, request, env = process.env }) { Object.assign(this, { db, request, env }); }
  async verify({ wabaId, phoneNumberId, accessToken, pin, register = false }) {
    if (!validMetaId(wabaId) || !validMetaId(phoneNumberId) || !accessToken) throw new Error('A real WABA ID, Phone Number ID, and access token are required');
    const appId = this.env.META_APP_ID || this.env.WHATSAPP_APP_ID;
    const secret = this.env.META_APP_SECRET || this.env.WHATSAPP_APP_SECRET;
    if (!appId || !secret || !(this.env.META_WEBHOOK_VERIFY_TOKEN || this.env.VERIFY_TOKEN)) throw new Error('Configure Meta app credentials and webhook verification token on the server');
    const debug = await this.request('debug_token', `${appId}|${secret}`, { query: { input_token: accessToken } });
    const info = debug.data;
    if (!info?.is_valid || String(info.app_id) !== appId || (info.expires_at && info.expires_at * 1000 <= Date.now()) ||
        !['whatsapp_business_management', 'whatsapp_business_messaging'].every(scope => info.scopes?.includes(scope))) throw new Error('Token is expired, belongs to another app, or lacks WhatsApp permissions');
    let after;
    let found;
    for (let page = 0; page < 100; page++) {
      const phones = await this.request(`${wabaId}/phone_numbers`, accessToken, { query: { fields: 'id,display_phone_number,verified_name,quality_rating,status', limit: '100', ...(after ? { after } : {}) } });
      found = phones.data?.find(phone => phone.id === phoneNumberId);
      if (found || !phones.paging?.next) break;
      after = phones.paging?.cursors?.after;
      if (!after) throw new Error('Cannot verify all WABA phone numbers');
    }
    if (!found?.display_phone_number) throw new Error('Phone number does not belong to the authorized WhatsApp Business Account');
    if (found.status !== 'CONNECTED') {
      if (!register || !/^\d{6}$/.test(pin || '')) throw new Error('Phone is not registered for Cloud API. Supply its six-digit registration PIN to finish setup.');
      const registered = await this.request(`${phoneNumberId}/register`, accessToken, { method: 'POST', body: { messaging_product: 'whatsapp', pin } });
      if (registered.success !== true) throw new Error('Meta did not confirm phone registration');
    }
    return { phone: found, expiresAt: info.expires_at ? new Date(info.expires_at * 1000) : null };
  }
  async connect({ hotelId, targetType = 'guest', code, accessToken, wabaId, phoneNumberId, pin }) {
    if (!hotelId || !['guest', 'internal', 'both'].includes(targetType) || !validMetaId(wabaId) || !validMetaId(phoneNumberId)) throw new Error('Valid hotel, purpose, WABA ID and Phone Number ID are required');
    const owner = await this.db.whatsAppIntegration.findFirst({ where: { phoneNumberId } });
    if (owner && (owner.hotelId !== hotelId || owner.targetType !== targetType)) throw new Error('This phone is already assigned to another connection');
    if (code) {
      if (!(this.env.META_APP_ID || this.env.WHATSAPP_APP_ID) || !(this.env.META_APP_SECRET || this.env.WHATSAPP_APP_SECRET)) throw new Error('Configure Meta app credentials on the server');
      const token = await this.request('oauth/access_token', null, { query: { client_id: this.env.META_APP_ID || this.env.WHATSAPP_APP_ID,
        client_secret: this.env.META_APP_SECRET || this.env.WHATSAPP_APP_SECRET, code } });
      accessToken = token.access_token;
    }
    const { phone, expiresAt } = await this.verify({ wabaId, phoneNumberId, accessToken, pin, register: true });
    const subscription = await this.request(`${wabaId}/subscribed_apps`, accessToken, { method: 'POST' });
    if (subscription.success !== true) throw new Error('Meta did not confirm webhook subscription');
    // Unique phone ID plus a transaction prevents assignment to a second hotel.
    return this.db.$transaction(async tx => {
      const assigned = await tx.whatsAppIntegration.findFirst({ where: { phoneNumberId } });
      if (assigned && (assigned.hotelId !== hotelId || assigned.targetType !== targetType)) throw new Error('This phone is already assigned. Disconnect it before changing its purpose or hotel.');
      const conflicts = await tx.whatsAppIntegration.findMany({ where: { hotelId, targetType: { in: targetType === 'both' ? ['guest', 'internal'] : ['both'] } } });
      if (conflicts.some(verifiedConnection)) throw new Error('Disconnect the overlapping WhatsApp connection before changing its purpose');
      const integration = await tx.whatsAppIntegration.upsert({ where: { hotelId_targetType: { hotelId, targetType } },
        create: { hotelId, targetType, phoneNumber: phone.display_phone_number.replace(/\D/g, ''), phoneNumberId, wabaId, accessToken: encryptToken(accessToken), status: 'connected', verifiedAt: new Date(), tokenExpiresAt: expiresAt, displayPhoneNumber: phone.display_phone_number },
        update: { phoneNumber: phone.display_phone_number.replace(/\D/g, ''), phoneNumberId, wabaId, accessToken: encryptToken(accessToken), status: 'connected', verifiedAt: new Date(), tokenExpiresAt: expiresAt, displayPhoneNumber: phone.display_phone_number, lastError: null } });
      const hotel = await tx.hotel.findUnique({ where: { id: hotelId } });
      let steps; try { steps = JSON.parse(hotel.onboardingSteps || '[]'); } catch { steps = []; }
      const completed = targetType === 'both' ? ['wa-guest', 'wa-internal'] : [`wa-${targetType}`];
      await tx.hotel.update({ where: { id: hotelId }, data: { onboardingSteps: JSON.stringify([...new Set([...steps, ...completed])]), ...(targetType !== 'internal' ? { whatsappNumber: phone.display_phone_number } : {}) } });
      return integration;
    });
  }
  async status(hotelId) {
    const rows = await this.db.whatsAppIntegration.findMany({ where: { hotelId } });
    return Promise.all(rows.map(async row => {
      let connected = verifiedConnection(row);
      let quality = 'Unknown';
      let error = connected ? null : 'Reconnect to verify this WhatsApp account';
      if (connected) {
        try {
          const token = decryptToken(row.accessToken);
          const result = await this.verify({ ...row, accessToken: token });
          const apps = await this.request(`${row.wabaId}/subscribed_apps`, token);
          const appId = this.env.META_APP_ID || this.env.WHATSAPP_APP_ID;
          if (!apps.data?.some(app => String(app.whatsapp_business_api_data?.id || app.id) === appId)) throw new Error('Webhook app subscription missing; reconnect WhatsApp');
          quality = result.phone.quality_rating || 'Unknown';
        } catch (err) { connected = false; error = err.message; }
      }
      return { id: row.id, hotelId, targetType: row.targetType, connected, status: connected ? 'connected' : 'unverified', number: row.displayPhoneNumber || row.phoneNumber,
        displayPhoneNumber: row.displayPhoneNumber, phoneNumberId: row.phoneNumberId, wabaId: row.wabaId, waba: row.wabaId, quality, templates: 0,
        verifiedAt: row.verifiedAt, lastInboundAt: row.lastInboundAt, lastOutboundAt: row.lastOutboundAt, lastDeliveryStatus: row.lastDeliveryStatus, lastError: error };
    }));
  }
}
