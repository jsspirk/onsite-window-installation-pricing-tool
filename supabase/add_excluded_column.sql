-- Run this once in the Supabase SQL Editor (project: qulbihqeiuupydhzvsao).
-- Adds the Include/Exclude toggle field for Quote Detail line items.
-- Defaults to false (included) so existing rows are unaffected.

alter table panes add column if not exists excluded boolean not null default false;
