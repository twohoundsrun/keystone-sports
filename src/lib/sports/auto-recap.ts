import { applyView } from './filter';
import { checkedDate } from './time';
import { writeBrief } from './write-brief';

export async function autoRecapDraft(date?: string): Promise<{ ok: true; id: string; date: string } | { ok: false; error: string }> {
  const day = checkedDate(date);
  const { db } = await import('../publishing/runtime.server');
  const { loadRecapBoard, loadNews } = await import('./server');
  try {
    const existing = await db()
      .prepare("SELECT id FROM posts WHERE author_id = 'auto' AND kind = 'recap' AND date = ?")
      .bind(day)
      .first();
    if (existing) return { ok: false, error: `A recap draft already exists for ${day}. Review it in the Publisher dashboard.` };
    const board = await loadRecapBoard(day);
    if (board.warnings?.length) return { ok: false, error: 'Feeds are delayed. The recap was skipped — no draft was created.' };
    const games = applyView([...board.games, ...board.upcoming.slice(0, 6)], 'all', 'all', [], true);
    const finished = games.filter((g) => g.status === 'post');
    if (!finished.length) return { ok: false, error: `No completed games on ${day}. Recap skipped to save AI credit.` };
    const news = await loadNews();
    const articles = news.articles.filter((a) => (a.published?.slice(0, 10) ?? '') <= day);
    const brief = await writeBrief({ date: day, userId: 'auto', games, articles });
    if (!brief.ok) return { ok: false, error: brief.error };
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db()
      .prepare('INSERT INTO posts (id, author_id, date, kind, title, body, event_time, team_slug, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)')
      .bind(id, 'auto', day, 'recap', `${day} · Auto recap (draft)`, brief.text, now)
      .run();
    return { ok: true, id, date: day };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not create the recap draft.' };
  }
}
