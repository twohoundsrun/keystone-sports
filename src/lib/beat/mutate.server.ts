import { z } from "zod";
import type { Database } from "../publishing/runtime.server";
import { getBeatItemById, patchBeatItem } from "./db.server";
import type { BeatMutationInput } from "./types";

const categorySchema = z.enum(["breaking", "from_the_beat", "watch", "locker_room", "reaction"]);
const isoTimestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");

export const beatMutationSchema = z.object({
  id: z.string().min(1).max(80),
  action: z.enum(["approve", "reject", "pin", "unpin", "set_expiration", "edit_context", "change_category"]),
  context: z.string().trim().max(2000).optional(),
  category: categorySchema.optional(),
  expiresAt: z.union([isoTimestamp, z.null()]).optional(),
});

export function parseBeatMutationInput(input: unknown): BeatMutationInput {
  return beatMutationSchema.parse(input);
}

/** Shared mutation logic for the Access API boundary and server-side callers. */
export async function mutateBeatItemForAdmin(
  database: Database,
  adminId: string,
  input: unknown,
): Promise<{ ok: true; id: string }> {
  const data = parseBeatMutationInput(input);
  const existing = await getBeatItemById(database, data.id);
  if (!existing) throw new Error("Beat item not found.");

  const now = new Date().toISOString();
  if (data.action === "approve") {
    if (!existing.context?.trim()) {
      throw new Error("Add a Keystone context sentence explaining what this changes for Pennsylvania fans before approving.");
    }
    if (existing.category === "breaking" && !existing.expiresAt && data.expiresAt == null) {
      throw new Error("Breaking items require an expiration before approve.");
    }
    await patchBeatItem(database, data.id, {
      approvalStatus: "approved",
      approvedBy: adminId,
      approvedAt: now,
      expiresAt: data.expiresAt !== undefined ? data.expiresAt : existing.expiresAt ?? null,
    });
  } else if (data.action === "reject") {
    await patchBeatItem(database, data.id, {
      approvalStatus: "rejected",
      approvedBy: null,
      approvedAt: null,
    });
  } else if (data.action === "pin") {
    await patchBeatItem(database, data.id, { pinned: true });
  } else if (data.action === "unpin") {
    await patchBeatItem(database, data.id, { pinned: false });
  } else if (data.action === "set_expiration") {
    if (data.expiresAt === undefined) throw new Error("expiresAt required.");
    await patchBeatItem(database, data.id, { expiresAt: data.expiresAt });
  } else if (data.action === "edit_context") {
    if (data.context === undefined) throw new Error("context required.");
    await patchBeatItem(database, data.id, { context: data.context });
  } else if (data.action === "change_category") {
    if (!data.category) throw new Error("category required.");
    await patchBeatItem(database, data.id, { category: data.category });
  }

  return { ok: true, id: data.id };
}
