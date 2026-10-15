-- Fail migration if duplicates already exist; reconcile them before enforcing uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS posts_auto_recap_date_unique ON posts (author_id, kind, date) WHERE author_id = 'auto' AND kind = 'recap';
