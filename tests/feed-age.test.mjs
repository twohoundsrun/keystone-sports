import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function moduleFunctions(path, names) {
  const code = stripTypeScriptTypes(readFileSync(path, "utf8"), { mode: "transform" }).replace(/\bexport /g, "");
  return new Function(code + `\nreturn {${names.join(",")}};`)();
}

const { gameCount, leagueFeedLine, leagueLabel } = moduleFunctions("src/lib/sports/feed-age.ts", [
  "gameCount",
  "leagueFeedLine",
  "leagueLabel",
]);

test("game count is a single phrase", () => {
  assert.equal(gameCount(1), "1 game");
  assert.equal(gameCount(3), "3 games");
  assert.equal(gameCount(3).includes("game s"), false);
});

test("league line names a delay without hiding the league", () => {
  const now = Date.parse("2026-10-05T20:00:00Z");
  const line = leagueFeedLine(
    [
      { league: "nfl", status: "ok", fetchedAt: "2026-10-05T19:59:50Z", games: 4 },
      { league: "nhl", status: "ok", fetchedAt: "2026-10-05T18:00:00Z", games: 2 },
      { league: "mlb", status: "unavailable", fetchedAt: "2026-10-05T20:00:00Z", games: 0 },
    ],
    now,
  );
  assert.equal(leagueLabel("college-football"), "NCAAF");
  assert.match(line, /NFL just now/);
  assert.match(line, /NHL delayed/);
  assert.match(line, /MLB unavailable/);
});
