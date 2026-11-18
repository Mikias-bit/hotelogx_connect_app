import { MewsClient } from './mewsClient.js';
import { decryptToken } from '../../utils/tokenCrypto.js';

// These reads intentionally bypass the legacy sync helper, which can fall back
// to partial/cached results. Automation must fail closed on a failed live read.
export async function checkinPmsReader(db, config) {
  const integration = await db.pmsIntegration.findUnique({ where: { hotelId: config.hotelId } });
  if (integration?.provider !== 'mews' || integration.status !== 'connected') throw new Error('Connect Mews first');
  const accessToken = decryptToken(integration.accessTokenEncrypted);
  const clientToken = decryptToken(integration.clientTokenEncrypted) || process.env.MEWS_CLIENT_TOKEN;
  if (!accessToken || !clientToken || !integration.baseUrl) throw new Error('PMS credentials unavailable');
  const client = new MewsClient({ clientToken, baseUrl: integration.baseUrl });
  const post = (path, body) => client._post(path, accessToken, body);
  const details = await post('/configuration/get', {});
  if (!details.Enterprise?.Id || details.Enterprise.Id !== config.mewsEnterpriseId) throw new Error('Mews enterprise does not match this hotel');
  return {
    validateService: async () => {
      const data = await post('/services/getAll', { ServiceIds: [config.stayServiceId], Limitation: { Count: 100 } });
      if (!data.Services?.some(s => s.Id === config.stayServiceId && s.IsActive !== false && (s.Data?.Discriminator === 'Bookable' || s.Type === 'Stay'))) throw new Error('Choose this hotel’s accommodation service');
    },
    reservation: async id => {
      const data = await post('/reservations/getAll/2023-06-06', { ServiceIds: [config.stayServiceId], ReservationIds: [id], Limitation: { Count: 100 } });
      if (!Array.isArray(data.Reservations)) throw new Error('Invalid PMS reservations response');
      return data.Reservations.find(r => r.Id === id && r.ServiceId === config.stayServiceId) || null;
    },
    customer: async id => {
      const data = await post('/customers/getAll', { CustomerIds: [id], Limitation: { Count: 100 } });
      if (!Array.isArray(data.Customers)) throw new Error('Invalid PMS customer response');
      return data.Customers.find(c => c.Id === id) || null;
    },
    updated: async (start, end, cursor) => {
      const data = await post('/reservations/getAll/2023-06-06', { ServiceIds: [config.stayServiceId],
        UpdatedUtc: { StartUtc: start.toISOString(), EndUtc: end.toISOString() }, Limitation: { Count: 100, ...(cursor ? { Cursor: cursor } : {}) } });
      if (!Array.isArray(data.Reservations)) throw new Error('Invalid PMS reservations response');
      return { reservations: data.Reservations, cursor: data.Cursor || null };
    },
  };
}
