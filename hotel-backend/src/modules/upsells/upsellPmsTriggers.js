// A webhook is a refresh hint, never authority for a guest address or confirmation.
export function isReservationUpdate(payload) {
  const events = Array.isArray(payload?.Events) ? payload.Events : [payload];
  return events.some(event => /reservation|serviceorder/i.test(String(event?.Type || event?.Discriminator || event?.type || event?.event || '')));
}

export function createUpsellPmsTriggers({ db, sync, run, report = () => {} }) {
  return {
    async afterSync(hotelId) {
      try {
        if ((await db.upsellAutomationConfig.findUnique({ where: { hotelId } }))?.enabled) await run(hotelId);
      } catch (error) {
        // The scheduled worker can catch up; an offer failure must not invalidate a PMS sync.
        report(error);
      }
    },
    async afterWebhook(hotelId, payload, authenticated) {
      if (!authenticated || !isReservationUpdate(payload)) return;
      try {
        if (!(await db.upsellAutomationConfig.findUnique({ where: { hotelId } }))?.enabled) return;
        // Sync fetches authoritative dates and contacts, then invokes afterSync.
        await sync(hotelId);
      } catch (error) { report(error); }
    },
  };
}
