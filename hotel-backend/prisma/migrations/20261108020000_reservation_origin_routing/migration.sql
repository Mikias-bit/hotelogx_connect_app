ALTER TABLE "ReservationServiceRequest" ADD COLUMN "bookingSource" JSONB NOT NULL DEFAULT '{}';
-- Existing unresolved changes must have their source checked before resolution.
UPDATE "ReservationServiceRequest" SET status = 'awaiting_origin'
WHERE kind IN ('cancellation', 'amendment') AND status = 'pending';

-- Remove only this feature's former resolution escalation. Preserve other
-- escalations and any conversation with extra-bed approval still pending.
UPDATE "Conversation" c SET "aiStatus" = 'human-takeover', escalation = NULL
FROM "Guest" g
WHERE c."guestId" = g.id
  AND c.escalation LIKE '%"kind":"reservation_request"%'
  AND EXISTS (SELECT 1 FROM "ReservationServiceRequest" r WHERE r."conversationId" = c.id AND r."hotelId" = g."hotelId" AND r.status = 'awaiting_origin')
  AND NOT EXISTS (SELECT 1 FROM "ReservationServiceRequest" r WHERE r."conversationId" = c.id AND r."hotelId" = g."hotelId" AND r.status = 'pending');
