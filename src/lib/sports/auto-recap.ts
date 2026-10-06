import { applyView } from './filter';
import { checkedDate } from './time';
import { writeBrief } from './write-brief';

async function logRecapRun(startedAt: string, result: { ok: true; id: string; date: string } | { ok: false; error: string }) {
  try {
    const { db } = await import('../publishing/runtime.server');
    const finishedAt = new Date().toISOString();
    const id = `recap_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    await db()
      .prepare(`INSERT INTO beat_job_runs (
        id, job_type, started_at, finished_at, apify_run_id,
        retrieved, discarded, deduped, pending_written, approx_cost_usd, error, summary_json
      ) VALUES (?, ?, ?, ?, NULL, ?, 0, 0, ?, NULL, ?, ?)`)
      .bind(
        id,
        "auto-recap",
        startedAt,
        finishedAt,
        result.ok ? 1 : 0,
        result.ok ? 1 : 0,
        result.ok ? null : result.error,
        JSON.stringify(result),
      )
      .run();
  } catch (error) {
    console.error("[auto-recap] could not write job run:", error);
  }
}

export async function autoRecapDraft(date?: string): Promise<{ ok: true; id: string; date: string } | { ok: false; error: string }> {
  const startedAt = new Date().toISOString();
  const day = checkedDate(date);
  const { db } = await import('../publishing/runtime.server');
  const { loadRecapBoard, loadNews } = await import('./server');
  const finish = async (result: { ok: true; id: string; date: string } | { ok: false; error: string }) => {
    await logRecapRun(startedAt, result);
    return result;
  };
  try {
    const existing = await db()
      .prepare("SELECT id FROM posts WHERE author_id = 'auto' AND kind = 'recap' AND date = ?")
      .bind(day)
      .first();
    if (existing) return finish({ ok: false, error: `A recap draft already exists for ${day}. Review it in the Publisher dashboard.` });
    const board = await loadRecapBoard(day);
    if (board.warnings?.length) return finish({ ok: false, error: 'Feeds are delayed. The recap was skipped — no draft was created.' });
    const games = applyView([...board.games, ...board.upcoming.slice(0, 6)], 'all', 'all', [], true);
    const finished = games.filter((g) => g.status === 'post');
    if (!finished.length) return finish({ ok: false, error: `No completed games on ${day}. Recap skipped to save AI credit.` });
    const news = await loadNews();
    const articles = news.articles.filter((a) => (a.published?.slice(0, 10) ?? '') <= day);
    const brief = await writeBrief({ date: day, userId: 'auto', games, articles });
    if (!brief.ok) return finish({ ok: false, error: brief.error });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare('INSERT INTO posts (id, author_id, date, kind, title, body, event_time, team_slug, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)')
      .bind(id, 'auto', day, 'recap', `${day} · Auto recap (draft)`, brief.text, now)
      .run();
    return finish({ ok: true, id, date: day });
  } catch (error) {
    return finish({ ok: false, error: error instanceof Error ? error.message : 'Could not create the recap draft.' });
  }
}
