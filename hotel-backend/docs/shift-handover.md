# Front Office shift handover

Front Office and managers share the Shift handover page. Each entry records the hotel, shift start date, outgoing shift, receiving shift, subject, information, optional room reference, priority and authenticated author.

Morning hands over to Evening, Evening to Night, and Night to Morning on the next calendar day. The date selector uses the hotel timezone. Night shift is dated by the day it starts; no fixed shift hours are assumed.

Outstanding shows unfinished items through the selected date, including older shifts. Acknowledging an item records receipt but leaves it outstanding. Completing or reopening requires a note. Corrections and progress can be added as updates without erasing the original entry. Shift history includes completed entries written by or received by the selected shift. History records staff names and full timestamps. Concurrent edits are rejected with a refresh message instead of overwriting another receptionist's update. The page refreshes every 30 seconds and offers a manual refresh.

## Deployment

Apply the checked-in migration `20261118010000_shift_handover` using the normal backend deployment process (`npm run prisma:deploy`), generate the Prisma client (`npm run prisma:generate`), and deploy both backend and frontend. This migration adds the ShiftHandover table and indexes. No existing operational records are changed. Migration files have been prepared locally; production deployment is separate.

## Validation

`node --test src/tests/shiftHandover.test.js` covers shift rollover, validation, role permissions, hotel isolation, carry-forward selection, audit events and concurrent update rejection.
