-- Migration number: 0012
-- Structured address parts for the learner Address suggestions (learner intake design 2026-10-11, Feature 1,
-- decision D7). Additive only: three nullable TEXT columns on learners, no defaults, no backfill, no table
-- rebuild (learners is referenced by foreign keys; nothing here touches it beyond ADD COLUMN). Existing rows
-- get NULL. All three are set together ONLY when the instructor picks a suggestion from the bundled G-NAF
-- street index; the free-text `address` column stays the record (PDF, ACTGDS untouched). The server validates
-- the shape (suburb <= 60 chars, state one of ACT/NSW/VIC/QLD/SA/WA/TAS/NT, postcode 4 digits) and that the
-- suburb appears in the address text (lib/address-suggest.ts#validateAddressParts); enum checks live there,
-- not in SQL CHECK (which would need a rebuild). Never sent to ACTGDS; editing them emits no event.
--   address_suburb    picked suburb/locality name as displayed ("Jacka")
--   address_state     state/territory code ("ACT", "NSW")
--   address_postcode  4-digit postcode ("2914")
-- D8 hook: the route design's homeDistrict() reads address_suburb first when set (R10, not built here).
--
-- ALTER TABLE ... ADD COLUMN is not idempotent: wrangler records applied migrations, so it runs once.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0012 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

ALTER TABLE learners ADD COLUMN address_suburb TEXT;
ALTER TABLE learners ADD COLUMN address_state TEXT;
ALTER TABLE learners ADD COLUMN address_postcode TEXT;
