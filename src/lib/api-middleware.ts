import { createMiddleware } from '@tanstack/react-start';
import { runtime } from '@/lib/publishing/runtime.server';
import { autoRecapDraft } from '@/lib/sports/auto-recap';
import {
  RECAP_SECRET_DENIED_ERROR,
  RECAP_SECRET_MISSING_ERROR,
  RECAP_SECRET_URL_ERROR,
  queryHasSecret,
  secretFromHeaders,
  secretsEqual,
} from '@/lib/sports/recap-secret';
import {
  INGEST_SECRET_URL_ERROR,
  queryHasSecret as ingestQueryHasSecret,
  secretFromHeaders as ingestSecretFromHeaders,
  secretsEqual as ingestSecretsEqual,
} from '@/lib/beat/ingest-secret';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// --- Stable ingest error codes (machine-readable, no internal details leaked) ---
const INGEST_AUTH_FAILED = { ok: false, code: 'AUTH_FAILED' } as const;
const INGEST_METHOD_NOT_ALLOWED = { ok: false, code: 'METHOD_NOT_ALLOWED' } as const;
const INGEST_INVALID_CONTENT_TYPE = { ok: false, code: 'INVALID_CONTENT_TYPE' } as const;
const INGEST_INVALID_JSON = { ok: false, code: 'INVALID_JSON' } as const;
const INGEST_BATCH_TOO_LARGE = { ok: false, code: 'BATCH_TOO_LARGE' } as const;
const INGEST_VALIDATION_FAILED = { ok: false, code: 'VALIDATION_FAILED' } as const;

// --- Ingest payload limits ---
const MAX_BATCH_SIZE = 50;
const MAX_HEADLINE_LEN = 280;
const MAX_CONTEXT_LEN = 1000;
const MAX_SOURCE_LEN = 200;
const MAX_ACCOUNT_LEN = 100;
const MAX_URL_LEN = 2048;
const MAX_OEMBED_HTML_LEN = 8000;
const MAX_BODY_BYTES = 512 * 1024; // 512 KB cap on raw request body

/**
 * Validate each candidate's fields before any database work.
 * Returns an array of error strings (empty if all valid).
 */
function validateIngestCandidates(candidates: unknown[]): string[] {
  const errors: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || typeof c !== 'object') {
      errors.push(`Candidate ${i}: not an object`);
      continue;
    }
    const obj = c as Record<string, unknown>;
    const originalUrl = String(obj.originalUrl ?? '').trim();
    if (!originalUrl) {
      errors.push(`Candidate ${i}: originalUrl required`);
      continue;
    }
    if (originalUrl.length > MAX_URL_LEN) {
      errors.push(`Candidate ${i}: originalUrl exceeds ${MAX_URL_LEN} chars`);
    }
    // URL must be valid https
    try {
      const u = new URL(originalUrl);
      if (u.protocol !== 'https:') errors.push(`Candidate ${i}: originalUrl must be https`);
    } catch {
      errors.push(`Candidate ${i}: originalUrl is not a valid URL`);
    }
    if (typeof obj.headline === 'string' && obj.headline.length > MAX_HEADLINE_LEN) {
      errors.push(`Candidate ${i}: headline exceeds ${MAX_HEADLINE_LEN} chars`);
    }
    if (typeof obj.text === 'string' && obj.text.length > MAX_CONTEXT_LEN) {
      errors.push(`Candidate ${i}: text exceeds ${MAX_CONTEXT_LEN} chars`);
    }
    if (typeof obj.context === 'string' && obj.context.length > MAX_CONTEXT_LEN) {
      errors.push(`Candidate ${i}: context exceeds ${MAX_CONTEXT_LEN} chars`);
    }
    if (typeof obj.suggestedContext === 'string' && obj.suggestedContext.length > MAX_CONTEXT_LEN) {
      errors.push(`Candidate ${i}: suggestedContext exceeds ${MAX_CONTEXT_LEN} chars`);
    }
    if (typeof obj.source === 'string' && obj.source.length > MAX_SOURCE_LEN) {
      errors.push(`Candidate ${i}: source exceeds ${MAX_SOURCE_LEN} chars`);
    }
    if (typeof obj.account === 'string' && obj.account.length > MAX_ACCOUNT_LEN) {
      errors.push(`Candidate ${i}: account exceeds ${MAX_ACCOUNT_LEN} chars`);
    }
    if (typeof obj.authorAccount === 'string' && obj.authorAccount.length > MAX_ACCOUNT_LEN) {
      errors.push(`Candidate ${i}: authorAccount exceeds ${MAX_ACCOUNT_LEN} chars`);
    }
    if (typeof obj.embedUrl === 'string') {
      if (obj.embedUrl.length > MAX_URL_LEN) {
        errors.push(`Candidate ${i}: embedUrl exceeds ${MAX_URL_LEN} chars`);
      }
      // embedUrl must also be valid https
      try {
        const eu = new URL(obj.embedUrl);
        if (eu.protocol !== 'https:') errors.push(`Candidate ${i}: embedUrl must be https`);
      } catch {
        errors.push(`Candidate ${i}: embedUrl is not a valid URL`);
      }
    }
    if (typeof obj.oembedHtml === 'string' && obj.oembedHtml.length > MAX_OEMBED_HTML_LEN) {
      errors.push(`Candidate ${i}: oembedHtml exceeds ${MAX_OEMBED_HTML_LEN} chars`);
    }
  }
  return errors;
}

function checkRecapSecret(provided: string): string | null {
  const env = runtime() as unknown as Record<string, unknown>;
  const expected = typeof env.KEYSTONE_AUTO_RECAP_SECRET === 'string' ? env.KEYSTONE_AUTO_RECAP_SECRET : '';
  if (!expected || !secretsEqual(provided, expected)) return RECAP_SECRET_DENIED_ERROR;
  return null;
}

/** Returns true if the provided secret matches the configured ingest secret. */
function ingestSecretValid(provided: string): boolean {
  const env = runtime() as unknown as Record<string, unknown>;
  const expected = typeof env.KEYSTONE_BEAT_INGEST_SECRET === 'string' ? env.KEYSTONE_BEAT_INGEST_SECRET : '';
  if (!expected) return false;
  return ingestSecretsEqual(provided, expected);
}

/** Canonical host redirects → https://keystonebeat.com (preserve path + query). */
function canonicalHostRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host)
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();
  if (host !== 'www.keystonebeat.com' && host !== 'keystone.twohoundsrun.com') return null;
  const target = new URL(request.url);
  target.protocol = 'https:';
  target.host = 'keystonebeat.com';
  return Response.redirect(target.toString(), 301);
}

export const apiMiddleware = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  if (!request) return next({});

  const apex = canonicalHostRedirect(request);
  if (apex) return apex;

  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  const method = request.method.toUpperCase();

  // Browser-facing Beat admin endpoints live under /editor so Cloudflare Access
  // injects the authenticated owner email. Public TanStack serverFns stay on
  // their default path and remain available to signed-out visitors.
  if (pathname === '/editor/api/beat/desk') {
    if (method !== 'GET') return json({ ok: false, error: 'GET only.' }, 405);
    const { db, identity, runtime: readRuntime } = await import('@/lib/publishing/runtime.server');
    const user = identity();
    if (!user.id) return json({ ok: false, error: 'Cloudflare Access identity is missing.' }, 401);
    if (!user.admin) return json({ ok: false, error: 'Only the configured owner can review Beat cards.' }, 403);
    try {
      const { listBeatItems, listPublicBeatRows } = await import('@/lib/beat/db.server');
      const { selectPublicBeatItems } = await import('@/lib/beat/order');
      const { readBeatM1Flag } = await import('@/lib/beat/flag');
      const database = db();
      const [adminItems, publicRows] = await Promise.all([
        listBeatItems(database),
        listPublicBeatRows(database),
      ]);
      return json({
        ok: true,
        access: {
          signedIn: true,
          admin: true,
          adminConfigured: user.adminConfigured,
          aiEnabled: readRuntime().KEYSTONE_AI_ENABLED === 'true' && Boolean(readRuntime().AI_API_KEY),
        },
        desk: {
          enabled: readBeatM1Flag(readRuntime() as unknown as Record<string, unknown>),
          generatedAt: new Date().toISOString(),
          items: selectPublicBeatItems(publicRows),
          adminItems,
          source: 'd1',
        },
      });
    } catch {
      return json({ ok: false, error: 'The Beat desk is temporarily unavailable.' }, 500);
    }
  }

  if (pathname === '/editor/api/beat/mutate') {
    if (method !== 'POST') return json({ ok: false, error: 'POST only.' }, 405);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return json({ ok: false, error: 'Content-Type must be application/json.' }, 415);
    }
    const { db, requireAdmin } = await import('@/lib/publishing/runtime.server');
    let adminId: string;
    try {
      adminId = requireAdmin();
    } catch {
      return json({ ok: false, error: 'Cloudflare Access owner identity is missing.' }, 401);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: 'Invalid JSON.' }, 400);
    }
    try {
      const { mutateBeatItemForAdmin } = await import('@/lib/beat/mutate.server');
      return json(await mutateBeatItemForAdmin(db(), adminId, body));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'Beat item not found.') return json({ ok: false, error: message }, 404);
      if (/required|invalid|expiration|too_big|too_small/i.test(message)) {
        return json({ ok: false, error: message || 'Invalid Beat action.' }, 422);
      }
      return json({ ok: false, error: 'The Beat action failed.' }, 500);
    }
  }

  if (pathname === '/api/auto-recap') {
    if (queryHasSecret(searchParams)) return json({ ok: false, error: RECAP_SECRET_URL_ERROR }, 400);
    const secret = secretFromHeaders(request.headers);
    if (!secret) return json({ ok: false, error: RECAP_SECRET_MISSING_ERROR }, 400);
    const denied = checkRecapSecret(secret);
    if (denied) return json({ ok: false, error: denied }, 422);
    try {
      const result = await autoRecapDraft(searchParams.get('date') ?? undefined);
      return json(result, result.ok ? 200 : 422);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : 'Auto-recap failed.' }, 500);
    }
  }

  // Bot-only Beat ingest — PENDING only. GET/POST .../check for duplicate lookup.
  if (pathname === '/api/editor/beat/ingest/check') {
    if (ingestQueryHasSecret(searchParams)) return json({ ok: false, code: 'INVALID_QUERY', error: INGEST_SECRET_URL_ERROR }, 400);
    const secret = ingestSecretFromHeaders(request.headers);
    // Generic AUTH_FAILED for both missing and invalid credentials.
    if (!secret || !ingestSecretValid(secret)) return json(INGEST_AUTH_FAILED, 401);
    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const { findBeatDuplicate } = await import('@/lib/beat/ingest.server');
      let body: Record<string, unknown> = {};
      if (method === 'POST') {
        body = (await request.json()) as Record<string, unknown>;
      }
      const originalUrl = String(body.originalUrl ?? searchParams.get('originalUrl') ?? '').trim();
      if (!originalUrl) return json({ ...INGEST_VALIDATION_FAILED, error: 'originalUrl required' }, 422);
      const result = await findBeatDuplicate(db(), {
        originalUrl,
        teamSlug: typeof body.teamSlug === 'string' ? body.teamSlug : searchParams.get('teamSlug'),
        headline: typeof body.headline === 'string' ? body.headline : undefined,
        duplicateFingerprint:
          typeof body.duplicateFingerprint === 'string' ? body.duplicateFingerprint : undefined,
      });
      return json({ ok: true, ...result });
    } catch {
      return json({ ok: false, code: 'INGEST_UNAVAILABLE' }, 500);
    }
  }

  if (pathname === '/api/editor/beat/ingest') {
    // Method check before auth so method errors are distinguishable.
    if (method !== 'POST') return json(INGEST_METHOD_NOT_ALLOWED, 405);
    if (ingestQueryHasSecret(searchParams)) return json({ ok: false, code: 'INVALID_QUERY', error: INGEST_SECRET_URL_ERROR }, 400);

    // --- Authentication: generic AUTH_FAILED for missing AND invalid credentials ---
    const secret = ingestSecretFromHeaders(request.headers);
    if (!secret || !ingestSecretValid(secret)) return json(INGEST_AUTH_FAILED, 401);

    // --- Content-Type enforcement ---
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return json(INGEST_INVALID_CONTENT_TYPE, 415);
    }

    // --- Body size cap (Content-Length header check) ---
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > MAX_BODY_BYTES) return json(INGEST_BATCH_TOO_LARGE, 413);

    try {
      const { db } = await import('@/lib/publishing/runtime.server');
      const { ingestPendingCandidates, loadNewsUrlsForDedupe } = await import('@/lib/beat/ingest.server');

      // --- Read body as text first, then enforce hard size cap ---
      // Content-Length can be missing or spoofed; this is the authoritative check.
      let bodyText: string;
      try {
        bodyText = await request.text();
      } catch {
        return json(INGEST_INVALID_JSON, 400);
      }
      if (bodyText.length > MAX_BODY_BYTES) return json(INGEST_BATCH_TOO_LARGE, 413);

      // --- Parse JSON safely ---
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return json(INGEST_INVALID_JSON, 400);
      }

      // --- Extract candidate list and enforce batch size ---
      const candidates = Array.isArray(body)
        ? body
        : Array.isArray((body as { candidates?: unknown[] })?.candidates)
          ? (body as { candidates: unknown[] }).candidates
          : [];
      if (candidates.length > MAX_BATCH_SIZE) return json(INGEST_BATCH_TOO_LARGE, 413);

      // --- Validate each candidate's fields before any database work ---
      const validationErrors = validateIngestCandidates(candidates);
      if (validationErrors.length > 0) {
        return json({ ...INGEST_VALIDATION_FAILED, errors: validationErrors }, 422);
      }

      const database = db();
      const newsUrls = await loadNewsUrlsForDedupe(database);
      const result = await ingestPendingCandidates(database, body as never, {
        newsUrls,
        createdBy: 'ingest:bot',
      });
      return json({ ok: true, approvalStatus: 'pending', ...result });
    } catch {
      // Sanitized: never leak internal error messages to the caller.
      return json({ ok: false, code: 'INGEST_UNAVAILABLE' }, 500);
    }
  }

  return next({});
});
