/**
 * Pure ingestion error classification. Used to decide whether a thrown D1/SQLite
 * error is a recognized Beat dedupe uniqueness conflict (safe to count as a
 * skipped duplicate) or an arbitrary database failure that must surface.
 */

const UNIQUE_CONSTRAINT = "unique constraint failed";
const BEAT_DEDUPE_COLUMNS = ["original_url", "duplicate_fingerprint"];

/**
 * True only for a UNIQUE constraint violation on the Beat dedupe columns
 * (`beat_items.original_url` or the partial `duplicate_fingerprint` index).
 * Any other error — schema mishaps, D1 unavailability, or a unique violation on
 * an unrelated column — returns false so it is reported instead of masked.
 */
export function isBeatUniquenessConflict(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (!message.includes(UNIQUE_CONSTRAINT)) return false;
  return BEAT_DEDUPE_COLUMNS.some((column) => message.includes(column));
}
