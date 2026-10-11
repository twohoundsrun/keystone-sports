/**
 * Framework-agnostic loader for the editor queue.
 *
 * The editor previously awaited the queue fetch with no catch/finally, so a
 * rejected request or a non-JSON response could leave `loading` stuck and never
 * surface the editor's error state. This helper owns the async lifecycle so the
 * guarantees are behaviorally testable without a DOM:
 *
 *  - `loading` is set on start and always returns to false for the latest request.
 *  - A superseded (stale) response never writes state, so an older page cannot
 *    overwrite a newer one and a stale failure cannot clear a newer success.
 *  - A rejected promise or thrown error becomes a sanitized error state and clears
 *    `data`, so the previous page is never shown as the current result.
 */

export type QueueLoadOutcome<T, D> =
  | { ok: true; data: T }
  | { ok: false; error: string; diagnostics?: D };

export type QueueLoadState<T, D> = {
  loading: boolean;
  error: string | null;
  data: T | null;
  errorDiagnostics: D | null;
};

export class QueueLoader<T, D, P> {
  token = 0;
  state: QueueLoadState<T, D> = {
    loading: false,
    error: null,
    data: null,
    errorDiagnostics: null,
  };
  request: (params: P) => Promise<QueueLoadOutcome<T, D>>;
  sanitizeError: (error: unknown) => string;
  listener: (state: QueueLoadState<T, D>) => void;

  constructor(
    request: (params: P) => Promise<QueueLoadOutcome<T, D>>,
    sanitizeError: (error: unknown) => string,
    listener: (state: QueueLoadState<T, D>) => void,
  ) {
    this.request = request;
    this.sanitizeError = sanitizeError;
    this.listener = listener;
  }

  getState(): QueueLoadState<T, D> {
    return this.state;
  }

  /** Runs one load. Returns true when this (latest) request wrote state, false if superseded. */
  async load(params: P): Promise<boolean> {
    const token = ++this.token;
    // Drop any previous page/error up front so stale contents are never shown as
    // the result of this load.
    this.emit({ loading: true, error: null, data: null, errorDiagnostics: null });

    let outcome: QueueLoadOutcome<T, D>;
    try {
      outcome = await this.request(params);
    } catch (error) {
      outcome = { ok: false, error: this.sanitizeError(error) };
    }

    // A newer request started while this one was in flight: drop this result so
    // it cannot overwrite fresher state or clear a newer request's loading flag.
    if (token !== this.token) return false;

    if (outcome.ok) {
      this.emit({ loading: false, error: null, data: outcome.data, errorDiagnostics: null });
    } else {
      this.emit({
        loading: false,
        error: outcome.error,
        data: null,
        errorDiagnostics: outcome.diagnostics ?? null,
      });
    }
    return true;
  }

  emit(patch: Partial<QueueLoadState<T, D>>): void {
    this.state = { ...this.state, ...patch };
    this.listener(this.state);
  }
}
