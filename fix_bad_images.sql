-- fix_bad_images.sql
-- URGENT: replaces report photos that were never appropriate report photos
-- to begin with — two of them appear to be private personal photos of
-- people at home, not infrastructure, that got randomly assigned by the
-- seed scripts' image pool. This UPDATE only touches rows currently
-- pointing at one of the 10 bad files; every other row is untouched.
--
-- For categories with a genuine matching photo in the remaining good set,
-- swaps in that photo. For categories with no appropriate photo available
-- (Waste, Fallen Tree, Illegal Dumping, Open Burning, Road Sign), clears
-- the image entirely rather than assigning something mismatched — a
-- report with no photo is honest; a report with the wrong photo isn't.

BEGIN;

UPDATE "Complaint"
SET "image" = CASE "categories"
  WHEN 'Road Damage'           THEN 'uploads/0875155a-9c73-4a91-a1d8-b9f8645ff1d9.jpg'
  WHEN 'Street Lighting'       THEN 'uploads/191037f6-c48f-4368-8ab3-6c9ac54d2e90.jpg'
  WHEN 'Drainage'              THEN 'uploads/067beb81-aa38-4875-8302-0f0f876a7588.jpg'
  WHEN 'Vandalism'             THEN 'uploads/606e2bef-dbe0-4071-b188-02f969ead250.webp'
  WHEN 'Overgrown Vegetation'  THEN 'uploads/01dcf303-5d18-4d04-901e-47710a911dad.jpg'
  WHEN 'Broken Sidewalk'       THEN 'uploads/d109eece-d094-48f8-9c39-1e925a936f26.png'
  ELSE NULL
END
WHERE "image" IN (
  'uploads/219e8d25-cfdd-421a-843b-3485a928146a.jpg',
  'uploads/31dfbbf5-5685-49b9-9d63-131093e32f95.jpg',
  'uploads/35c1fa2b-4b88-4be5-ba87-0bcf7af2611e.png',
  'uploads/787207c4-ab94-4a1e-bb32-5141564f971b.jpg',
  'uploads/7ef34019-c803-4d2b-9ec9-57eec4386aa0.jpg',
  'uploads/92c9384e-99db-4a4b-bb68-591a9387acbb.jpg',
  'uploads/af30f21b-3909-4363-a26b-234227986b81.png',
  'uploads/c30418c7-6d50-4765-afc7-84c89aa4d7f1.png',
  'uploads/cf528fb5-395c-463b-9017-82e7c72639b1.jpg',
  'uploads/e6b98283-4e2d-4854-bc1e-371409298a3c.jpg'
);

COMMIT;

-- Verify no bad images remain:
-- SELECT COUNT(*) FROM "Complaint" WHERE image IN (
--   'uploads/219e8d25-cfdd-421a-843b-3485a928146a.jpg',
--   'uploads/31dfbbf5-5685-49b9-9d63-131093e32f95.jpg',
--   'uploads/35c1fa2b-4b88-4be5-ba87-0bcf7af2611e.png',
--   'uploads/787207c4-ab94-4a1e-bb32-5141564f971b.jpg',
--   'uploads/7ef34019-c803-4d2b-9ec9-57eec4386aa0.jpg',
--   'uploads/92c9384e-99db-4a4b-bb68-591a9387acbb.jpg',
--   'uploads/af30f21b-3909-4363-a26b-234227986b81.png',
--   'uploads/c30418c7-6d50-4765-afc7-84c89aa4d7f1.png',
--   'uploads/cf528fb5-395c-463b-9017-82e7c72639b1.jpg',
--   'uploads/e6b98283-4e2d-4854-bc1e-371409298a3c.jpg'
-- );
-- Expect 0.
