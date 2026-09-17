/**
 * The feed's state: cards in hand, paging, polling, and view logging.
 *
 * Two client obligations from the API contract (§1) live here, and both corrupt
 * data silently if got wrong:
 *
 *   1. LOG A VIEW WHEN A CARD IS DISPLAYED, never when a page is fetched. Prefetch
 *      means the app holds cards it has not shown. The view log is the one dataset
 *      that cannot be rebuilt, and it is also the paging position: "the next page"
 *      is simply the cards not yet viewed.
 *   2. POLL AT THE CADENCE THE SERVER GIVES. `retry_after_ms`, not a hardcoded
 *      interval.
 *
 * Paging has no cursor, so a page can return cards already in hand - ones fetched
 * but not yet displayed, and therefore not yet viewed. They are de-duplicated by id.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { ApiError } from "@/api/client";
import type { ExpandResponse, FeedPage, ScrollCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { PAGE_SIZE, PREFETCH_REMAINING } from "@/config";

export type FeedMode = "learn" | "revision";

interface PendingView {
  scroll_id: string;
  viewed_at: string;
}

/**
 * A displayed card is sent this soon after it is recorded - short enough that a
 * refresh or a killed app rarely loses one, long enough that J-J-J batches.
 */
const FLUSH_AFTER_MS = 1000;
/** Retry cadence for views that failed to send. */
const FLUSH_EVERY_MS = 5000;

export function useFeed(field: string, mode: FeedMode) {
  const { api } = useSession();

  const [cards, setCards] = useState<ScrollCard[]>([]);
  const [page, setPage] = useState<FeedPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Index of the item on screen; cards.length means the footer (waiting/end card). */
  const [position, setPosition] = useState(0);

  const inHand = useRef(new Set<string>());
  const displayed = useRef(new Set<string>());
  const pendingViews = useRef<PendingView[]>([]);
  const inFlight = useRef(false);
  /** Stops an immediate reload from repeating when the last one brought nothing new. */
  const lastLoadAt = useRef<string | null>(null);

  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushViews = useCallback(async (keepalive = false) => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (pendingViews.current.length === 0) return;
    const batch = pendingViews.current;
    pendingViews.current = [];
    try {
      await api("/v1/views", { method: "POST", body: { views: batch }, keepalive });
    } catch {
      // Kept, not dropped: a lost view would hand the same card out again and
      // corrupt the one dataset that cannot be rebuilt. Retried on the next flush.
      pendingViews.current = [...batch, ...pendingViews.current];
    }
  }, [api]);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      // Views first, so the server does not hand back cards already shown.
      await flushViews();
      const res = await api<FeedPage>(mode === "revision" ? "/v1/feed/revision" : "/v1/feed", {
        method: "POST",
        body: { field, limit: PAGE_SIZE },
      });
      const fresh = res.scrolls.filter((s) => !inHand.current.has(s.id));
      for (const s of fresh) inHand.current.add(s.id);
      if (fresh.length > 0) setCards((current) => [...current, ...fresh]);
      setPage(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load cards.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [api, field, mode, flushViews]);

  // First page.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, mode]);

  // Flush on a timer (retries), once more on leaving the screen, and - the case
  // that lost views - when the page or app goes away. Leaving the screen inside
  // the app unmounts this hook, but a browser refresh or closed tab does not: no
  // cleanup runs, and a view waiting in memory was lost, so that card was handed
  // out again as the first card of the next visit. `keepalive` lets the request
  // outlive the page.
  useEffect(() => {
    const timer = setInterval(() => void flushViews(), FLUSH_EVERY_MS);
    const leaving = () => void flushViews(true);
    let unsubscribe: () => void;
    if (Platform.OS === "web") {
      const onVisibility = () => {
        if (document.visibilityState === "hidden") leaving();
      };
      window.addEventListener("pagehide", leaving);
      document.addEventListener("visibilitychange", onVisibility);
      unsubscribe = () => {
        window.removeEventListener("pagehide", leaving);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    } else {
      const sub = AppState.addEventListener("change", (state) => {
        if (state !== "active") leaving();
      });
      unsubscribe = () => sub.remove();
    }
    return () => {
      clearInterval(timer);
      unsubscribe();
      void flushViews();
    };
  }, [flushViews]);

  // Prefetch near the end of what is in hand; poll while the field is generating.
  useEffect(() => {
    if (!page || page.exhausted) return;
    const remaining = cards.length - position;
    if (remaining > PREFETCH_REMAINING) return;

    if (page.generating) {
      // Cold start or expansion: ask again at the server's cadence.
      const timer = setTimeout(() => void load(), page.retry_after_ms ?? 3000);
      return () => clearTimeout(timer);
    }

    // Not generating: fetch the next page once per position. If it brought
    // nothing new, do not immediately ask again - wait until the user moves.
    const key = `${position}:${cards.length}`;
    if (lastLoadAt.current === key) return;
    lastLoadAt.current = key;
    void load();
  }, [page, cards.length, position, load]);

  /**
   * Called as items come on screen, with the card itself (null for the footer).
   * Only cards count as views.
   *
   * The card is passed in rather than looked up by index, which removes any
   * dependence on this hook's state having caught up with what the list is
   * showing. (It was changed while chasing a card that was displayed and never
   * logged; a deterministic test then showed the old lookup recorded views fine,
   * and the likelier cause was the test itself scrolling past that card in under
   * the 600ms that counts as an impression - which is correct behaviour.)
   */
  const onDisplayed = useCallback(
    (index: number, card: ScrollCard | null) => {
      setPosition(index);
      if (!card) return;
      // Once per card per visit to the screen. Coming back to a card while
      // scrolling is not a new impression.
      if (displayed.current.has(card.id)) return;
      displayed.current.add(card.id);
      pendingViews.current.push({ scroll_id: card.id, viewed_at: new Date().toISOString() });
      if (!flushTimer.current) {
        flushTimer.current = setTimeout(() => void flushViews(), FLUSH_AFTER_MS);
      }
    },
    [flushViews],
  );

  /** Reaching the footer: flush and reload, which is what turns "done" into `exhausted`. */
  const onReachedEnd = useCallback(() => {
    lastLoadAt.current = null;
    void load();
  }, [load]);

  const toggleSave = useCallback(
    async (card: ScrollCard) => {
      const next = !card.saved;
      const apply = (saved: boolean) =>
        setCards((current) => current.map((c) => (c.id === card.id ? { ...c, saved } : c)));
      apply(next); // optimistic: the tap should feel instant
      try {
        await api(`/v1/saves/${card.id}`, { method: next ? "PUT" : "DELETE" });
      } catch {
        apply(!next);
      }
    },
    [api],
  );

  const expand = useCallback(async () => {
    if (!page) return;
    const res = await api<ExpandResponse>(`/v1/fields/${page.field.id}/expand`, { method: "POST" });
    // The tap returns before any topics exist. Mark the page as generating so
    // polling starts at once; the next poll replaces this with the server's view.
    setPage((p) => (p ? { ...p, exhausted: false, generating: true, retry_after_ms: res.retry_after_ms } : p));
    return res;
  }, [api, page]);

  return { cards, page, error, loading, position, onDisplayed, onReachedEnd, toggleSave, expand, reload: load };
}

/**
 * The contract's exhaustion signal (API-CONTRACT §4): a finished "more topics"
 * expansion that queued, linked and retried nothing. When true, stop offering it.
 */
export function fieldIsFinished(page: FeedPage | null): boolean {
  const e = page?.last_expansion;
  return (
    !!e &&
    e.kind === "more" &&
    e.status === "done" &&
    e.topics_queued === 0 &&
    e.topics_linked === 0 &&
    e.failed_retried === 0
  );
}
