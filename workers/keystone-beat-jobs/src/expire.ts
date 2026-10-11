import type { Env } from "./types.ts";

export type ExpireResult = {
  expired: number;
  checkedAt: string;
};

/**
 * Mark approved items past expires_at as expired.
 * Does NOT delete rows. Does NOT approve anything.
 *
 * Pending items are intentionally never auto-expired (Phase 4A): an unreviewed
 * candidate must stay actionable in the editor queue until a human approves or
 * rejects it. The transition is idempotent — once a row is 'expired' it no longer
 * matches `approval_status = 'approved'`, so repeated runs change nothing.
 */
export async function expireStale(env: Env, nowIso = new Date().toISOString()): Promise<ExpireResult> {
  const res = await env.DB.prepare(
    `UPDATE beat_items
     SET approval_status = 'expired', updated_at = ?
     WHERE expires_at IS NOT NULL
       AND expires_at <= ?
       AND approval_status = 'approved'`,
  )
    .bind(nowIso, nowIso)
    .run();
  const expired = res.meta?.changes ?? 0;
  return { expired, checkedAt: nowIso };
}
