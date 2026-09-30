import { definePlugin } from "nitro";
import { autoRecapDraft } from "../src/lib/sports/auto-recap";
import { addDays, dateKeyNY } from "../src/lib/sports/time";
import { db } from "../src/lib/publishing/runtime.server";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async () => {
    const runId = crypto.randomUUID();
    const recapDate = addDays(dateKeyNY(), -1);
    const startedAt = new Date().toISOString();

    await db()
      .prepare(
        "INSERT INTO recap_job_runs (id, recap_date, started_at, status) VALUES (?, ?, ?, 'running')",
      )
      .bind(runId, recapDate, startedAt)
      .run();

    try {
      const result = await autoRecapDraft(recapDate);
      const finishedAt = new Date().toISOString();
      const status = result.ok ? "created" : "skipped";
      const postId = result.ok ? result.id : null;
      const error = result.ok ? null : result.error;

      await db()
        .prepare(
          "UPDATE recap_job_runs SET finished_at = ?, status = ?, post_id = ?, error = ? WHERE id = ?",
        )
        .bind(finishedAt, status, postId, error, runId)
        .run();

      console.log(
        `[auto-recap] scheduled run: ${JSON.stringify({ runId, recapDate, ...result })}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      await db()
        .prepare(
          "UPDATE recap_job_runs SET finished_at = ?, status = 'failed', error = ? WHERE id = ?",
        )
        .bind(finishedAt, message, runId)
        .run();
      console.error("[auto-recap] scheduled run failed:", error);
    }
  });
});
