-- 003_credits_numeric.sql
-- Change credits_min and credits_max from INT to NUMERIC so the sync script
-- can store fractional credits (e.g. 1.5, 0.5) from the Cornell API.
-- Safe to run: NUMERIC is a superset of INT; existing integer values are preserved.

ALTER TABLE courses
  ALTER COLUMN credits_min TYPE NUMERIC(4,1),
  ALTER COLUMN credits_max TYPE NUMERIC(4,1);
