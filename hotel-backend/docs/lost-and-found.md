# Lost & Found

Manager and Front Office have dashboard buttons and sidebar links to the shared
hotel register at `/manager/lost-found` and `/front-office/lost-found`.

Each item requires an item category, item name, description, location found, and
place of storage. Staff can add, search and edit items. Search matches all five
fields; results are paginated in groups of 50. Refresh or refocus the page to fetch
changes made by other staff. Categories include suggestions and allow custom text.

The authenticated `/api/lost-found` GET, POST and PATCH `/:id` endpoints restrict
access to Manager and Front Office. Hotel and staff IDs come from authentication.
Updates require the item's last-read version to avoid overwriting another edit.
The `LostFoundItem` table stores records, author IDs and timestamps in PostgreSQL.

Deployment: apply migration `20261028020000_lost_and_found` using
`npm.cmd run prisma:deploy`, generate the client with `npm.cmd run prisma:generate`,
then deploy the backend and push the frontend for Netlify. The migration is additive.

Validation: `node --test src/tests/lostFound.test.js` exercises required fields,
role restrictions, shared access, hotel isolation, search, pagination and edit conflicts.
`node scripts/test-lost-found-database.mjs .env` applies migrations in a disposable
schema in the designated Neon test-data database and exercises the real database/API,
including concurrent edits. It removes only its generated test schema afterwards.
