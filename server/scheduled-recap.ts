import { definePlugin } from "nitro";
import { autoRecapDraft } from "../src/lib/sports/auto-recap";
import { addDays, dateKeyNY } from "../src/lib/sports/time";

// Run at 07:15 UTC (03:15 EDT / 02:15 EST). This gives late-night games time to finish.
// Cloudflare cron uses UTC; the recap date must always be the preceding New York date.
export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("cloudflare:scheduled", async () => {
    const day = addDays(dateKeyNY(), -1);
    try {
      const result = await autoRecapDraft(day);
      if (!result.ok) {
        console.error(`[auto-recap] failed day=${day}: ${result.error}`);
        return;
      }
      console.log(`[auto-recap] created day=${day} id=${result.id}`);
    } catch (error) {
      console.error(`[auto-recap] exception day=${day}`, error);
    }
  });
});
