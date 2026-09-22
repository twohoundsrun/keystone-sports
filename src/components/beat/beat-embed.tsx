import { useEffect, useRef, useState } from "react";
import type { PublicBeatItem } from "@/lib/beat/types";
import { sanitizeXOembedHtml } from "@/lib/beat/sanitize-oembed";

declare global {
  interface Window {
    twttr?: { widgets?: { load: (el?: HTMLElement) => void } };
  }
}

const X_WIDGET = "https://platform.x.com/widgets.js";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function loadXWidgetsOnce(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.twttr?.widgets) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${X_WIDGET}"]`);
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      if (window.twttr?.widgets) resolve();
    });
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = X_WIDGET;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("X widgets failed to load"));
    document.body.appendChild(s);
  });
}

type Props = {
  item: PublicBeatItem;
};

/**
 * Lazy embed surface: IntersectionObserver gates third-party JS.
 * Reduced-motion visitors get the permalink + context only (no auto hydrate).
 */
export function BeatEmbed({ item }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced || item.mediaType === "link_out") return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setActive(true);
          io.disconnect();
        }
      },
      { rootMargin: "120px 0px", threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [item.mediaType, reduced]);

  useEffect(() => {
    if (!active || failed || item.mediaType !== "x_embed") return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setFailed(true);
    }, 4000);
    loadXWidgetsOnce()
      .then(() => {
        if (cancelled) return;
        window.twttr?.widgets?.load(rootRef.current ?? undefined);
        window.clearTimeout(timer);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
        window.clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, failed, item.mediaType]);

  if (item.mediaType === "link_out") {
    return null;
  }

  if (reduced || failed) {
    return (
      <p className="mt-3 text-sm text-muted">
        Embed skipped{reduced ? " (reduced motion)" : ""}.{" "}
        <a href={item.originalUrl} target="_blank" rel="noreferrer" className="font-semibold text-fg underline-offset-2 hover:text-accent hover:underline">
          Open original
        </a>
      </p>
    );
  }

  if (item.mediaType === "youtube_embed" && item.embedId) {
    return (
      <div ref={rootRef} className="mt-3 overflow-hidden rounded-md bg-elevated">
        {active ? (
          <iframe
            title={`${item.source} video`}
            src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.embedId)}`}
            className="aspect-video w-full"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <div className="flex aspect-video items-center justify-center text-sm text-muted">Video loads when visible</div>
        )}
      </div>
    );
  }

  if (item.mediaType === "x_embed") {
    return (
      <div ref={rootRef} className="mt-3 min-h-[4rem]">
        {active && item.oembedHtml ? (
          <div
            className="beat-x-embed text-sm [&_blockquote]:m-0"
            dangerouslySetInnerHTML={{ __html: sanitizeXOembedHtml(item.oembedHtml) }}
          />
        ) : active ? (
          <p className="text-sm text-muted">
            Loading post…{" "}
            <a href={item.originalUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              Open on X
            </a>
          </p>
        ) : (
          <p className="text-sm text-muted">Post loads when visible</p>
        )}
      </div>
    );
  }

  return null;
}
