import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MaxContentWidth, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { useHasCodexRoom } from "@/hooks/use-is-wide";
import { Card } from "@/feed/card";
import { FeedFooter } from "@/feed/footer";
import type { FeedMode, useFeed } from "@/feed/use-feed";
import { Dot, KeyCap, Label } from "@/ui/primitives";
import { useShellInfo } from "@/ui/shell";

/** A card counts as displayed after this long on screen - a card skipped past is not an impression. */
const DISPLAY_THRESHOLD_MS = 600;

/**
 * The desktop reader (reference: the 2026-09-17 mock). One card at a time in a
 * centred column, the previous and next cards peeking above and below, and the
 * keyboard as the main control: J/K to move, Space to reveal, S to save.
 *
 * Position is an index, not a scroll offset. That is what the phone layout could
 * not give: when the user waits on the last page and a new card arrives, the index
 * they are on simply becomes that card. There is no scroll position for a browser
 * to snap back to.
 */
export function Reader({
  feed,
  field,
  mode,
}: {
  feed: ReturnType<typeof useFeed>;
  field: string;
  mode: FeedMode;
}) {
  const c = useColors();
  const router = useRouter();
  const codexRoom = useHasCodexRoom();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState<string | null>(null);

  const { cards, page } = feed;
  const total = cards.length;
  const atEnd = index >= total;
  const card = atEnd ? null : cards[index]!;
  const fieldName = page?.field.name ?? field;

  // Record a view once the card has stayed on screen; report reaching the end once
  // per arrival. Keyed on the card's id as well as the index: a card arriving
  // while the user waits on the last page occupies the SAME index, and must count.
  const handlers = useRef(feed);
  useEffect(() => {
    handlers.current = feed;
  });
  const cardId = card?.id ?? null;
  const wasAtEnd = useRef(false);
  const { focused } = feed;
  useEffect(() => {
    // Hidden behind another screen: nothing here is being read. Coming back re-runs
    // this, and use-feed ignores a card already counted.
    if (!focused) return;
    if (cardId === null) {
      handlers.current.onDisplayed(index, null);
      if (!wasAtEnd.current) handlers.current.onReachedEnd();
      wasAtEnd.current = true;
      return;
    }
    wasAtEnd.current = false;
    const shown = handlers.current.cards[index];
    const timer = setTimeout(() => {
      if (shown) handlers.current.onDisplayed(index, shown);
    }, DISPLAY_THRESHOLD_MS);
    return () => clearTimeout(timer);
  }, [index, cardId, focused]);

  // Keyboard, on the web. Ignored while typing, and with modifier keys held, so
  // browser shortcuts keep working.
  const keyState = useRef({ total, card, index, focused });
  useEffect(() => {
    keyState.current = { total, card, index, focused };
  });
  useEffect(() => {
    if (Platform.OS !== "web") return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = keyState.current;
      // The listener is on the document, so a reader hidden in the stack hears
      // every key too. Only the one on screen may act.
      if (!s.focused) return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setIndex((i) => Math.min(i + 1, s.total));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setIndex((i) => Math.max(i - 1, 0));
          break;
        case " ":
          if (s.card) {
            e.preventDefault(); // otherwise the page scrolls
            const id = s.card.id;
            setRevealed((r) => (r === id ? null : id));
          }
          break;
        case "s":
          if (s.card) {
            e.preventDefault();
            void handlers.current.toggleSave(s.card);
          }
          break;
        case "Escape":
          // Back to the Home already underneath, not a new one on top: pushing
          // stacked a screen per trip and kept every reader below it mounted.
          router.dismissTo("/");
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  const verifiedCount = cards.filter((x) => x.trust_label === "sourced_verified").length;
  const generating = !!page?.generating;

  // Numbering. Learning numbers cards across the whole field, continuing from the
  // cards seen on earlier visits; revision re-reads seen cards, so it numbers
  // within the cards in hand. `total` above stays the in-hand count, for moving.
  const inField = mode === "learn";
  const offset = inField ? feed.seenBefore : 0;
  const deckTotal = inField ? Math.max(page?.progress?.total ?? 0, offset + total) : total;
  const number = Math.min(offset + index + 1, deckTotal);
  const remaining = Math.max(deckTotal - number, 0);

  useShellInfo(!focused ? null : {
    crumbs: [fieldName, atEnd ? (page?.exhausted ? "End of field" : "Up next") : `Card ${pad(number)} of ${pad(deckTotal)}`],
    mode,
    field: page?.field.name,
    deck: { position: number, total: deckTotal, generating },
    pending: page?.topics_pending,
  });

  const prev = index > 0 ? cards[index - 1] : null;
  const next = index < total - 1 ? cards[index + 1] : null;

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* The reading column and the keyboard panel are laid out side by side
            as one centred group. An earlier version floated the panel over the
            page; at 1440px the gutter was narrower than the panel and it covered
            the card's trust badge. */}
        <View style={styles.group}>
        <View style={styles.column}>
          {/* Progress rail */}
          <View style={styles.rail}>
            <View style={styles.railRow}>
              <Label tone="slate">
                {mode === "revision" ? "Revision track" : "Field track"} · {fieldName}
              </Label>
              <Text style={[Type.ui, { color: c.textSecondary, fontSize: 13 }]}>
                {deckTotal === 0
                  ? generating
                    ? "Cards on the way"
                    : "No cards yet"
                  : atEnd
                    ? `All ${deckTotal} cards read`
                    : `Card ${pad(number)} of ${pad(deckTotal)} · ${remaining} remaining${generating ? " · more on the way" : ""}`}
              </Text>
            </View>
            <View style={[styles.track, { backgroundColor: c.border }]}>
              <View
                style={[
                  styles.trackFill,
                  { backgroundColor: c.accent, width: `${deckTotal === 0 ? 0 : ((atEnd ? deckTotal : number) / deckTotal) * 100}%` },
                ]}
              />
            </View>
            <View style={styles.railRow}>
              <Text style={[Type.italic, { color: c.textSecondary }]}>No algorithmic infinite scroll</Text>
              {total > 0 && (
                <View style={styles.inline}>
                  <Dot color={c.verified} />
                  <Text style={[Type.italic, { color: c.textSecondary }]}>
                    {verifiedCount} of {total} checked against a source
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Previous card, peeking */}
          {prev ? (
            <Pressable onPress={() => setIndex(index - 1)} style={[styles.peek, styles.peekTop, { backgroundColor: c.rail, borderColor: c.border }]}>
              <Text style={{ color: c.textFaint }}>↑</Text>
              <Label tone="faint">Card {pad(offset + index)}</Label>
              <Text style={[Type.bodySmall, { color: c.textFaint, fontSize: 18 }]} numberOfLines={1}>
                {prev.topic.name}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.peekSpacer} />
          )}

          {card ? (
            <Card
              key={card.id}
              card={card}
              fieldName={fieldName}
              variant="reader"
              revealed={revealed === card.id}
              onToggleReveal={() => setRevealed((r) => (r === card.id ? null : card.id))}
              onToggleSave={feed.toggleSave}
            />
          ) : (
            <View style={[styles.endSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
              <FeedFooter
                page={page}
                mode={mode}
                loading={feed.loading}
                error={feed.error}
                onExpand={feed.expand}
                onRetry={() => void feed.reload()}
              />
            </View>
          )}

          {/* Next card, peeking */}
          {card &&
            (next ? (
              <Pressable onPress={() => setIndex(index + 1)} style={[styles.peek, styles.peekBottom, { backgroundColor: c.rail, borderColor: c.border }]}>
                <Text style={{ color: c.textFaint }}>↓</Text>
                <Label tone="faint">Card {pad(offset + index + 2)}</Label>
                <Text style={[Type.bodySmall, { color: c.textFaint, fontSize: 18, flex: 1 }]} numberOfLines={1}>
                  {next.topic.name}
                </Text>
                <KeyCap>J</KeyCap>
              </Pressable>
            ) : (
              <Pressable onPress={() => setIndex(index + 1)} style={[styles.peek, styles.peekBottom, { backgroundColor: c.rail, borderColor: c.border }]}>
                <Text style={{ color: c.textFaint }}>↓</Text>
                <Text style={[Type.italic, { color: c.textFaint, flex: 1 }]}>
                  {generating ? "More cards are being written" : "End of this field"}
                </Text>
                <KeyCap>J</KeyCap>
              </Pressable>
            ))}
        </View>
        {codexRoom && <Codex />}
        </View>
      </ScrollView>

      <HintBar />
    </View>
  );
}

/** The keyboard panel. Only shortcuts that exist are listed. */
function Codex() {
  const c = useColors();
  const rows: [string[], string][] = [
    [["J", "K"], "Next / Prev"],
    [["Space"], "Reveal answer"],
    [["S"], "Save card"],
    [["Esc"], "Fields"],
  ];
  return (
    <View style={[styles.codex, { backgroundColor: c.rail, borderColor: c.border }]}>
      <View style={styles.inline}>
        <Text style={{ color: c.slate, fontSize: 12 }}>⌨</Text>
        <Label tone="slate" strong>Keyboard codex</Label>
      </View>
      {rows.map(([keys, action]) => (
        <View key={action} style={styles.codexRow}>
          <View style={styles.inline}>
            {keys.map((k) => (
              <KeyCap key={k}>{k}</KeyCap>
            ))}
            {keys.length === 2 && <Text style={[Type.ui, { color: c.textFaint, fontSize: 12 }]}>or ↓ ↑</Text>}
          </View>
          <Text style={[Type.ui, { color: c.textSecondary, fontSize: 12.5 }]}>{action}</Text>
        </View>
      ))}
      <View style={[styles.codexState, { borderTopColor: c.border }]}>
        <View style={styles.codexRow}>
          <Label tone="muted">Session state</Label>
          <Label tone="text" strong>Flow mode</Label>
        </View>
        <Text style={[Type.italic, { color: c.textSecondary, fontSize: 13.5, lineHeight: 19 }]}>
          No feeds, no streaks, no metrics. Just the card in front of you.
        </Text>
      </View>
    </View>
  );
}

function HintBar() {
  const c = useColors();
  const hints: [string, string][] = [
    ["J", "Next"],
    ["K", "Prev"],
    ["Space", "Reveal"],
    ["S", "Save"],
  ];
  return (
    <View style={[styles.hintBar, { backgroundColor: c.background, borderTopColor: c.border }]}>
      <View style={styles.hints}>
        {hints.map(([k, label]) => (
          <View key={k} style={styles.inline}>
            <KeyCap>{k}</KeyCap>
            <Text style={[Type.ui, { color: c.textSecondary, fontSize: 12.5 }]}>{label}</Text>
          </View>
        ))}
      </View>
      <Label tone="faint">Anti-dopamine reader environment</Label>
    </View>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { alignItems: "center", paddingHorizontal: Spacing.five, paddingTop: Spacing.five, paddingBottom: 120 },
  group: { width: "100%", flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: Spacing.four },
  column: { flex: 1, maxWidth: MaxContentWidth },
  rail: { gap: 10, marginBottom: Spacing.four },
  railRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.three, flexWrap: "wrap" },
  track: { height: 3, borderRadius: 2, overflow: "hidden" },
  trackFill: { height: 3 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8 },
  peek: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: Spacing.four,
    borderWidth: 1,
    marginHorizontal: 16,
    opacity: 0.85,
  },
  peekTop: { paddingTop: 12, paddingBottom: 22, marginBottom: -10, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  peekBottom: { paddingTop: 22, paddingBottom: 12, marginTop: -10, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, zIndex: -1 },
  peekSpacer: { height: 12 },
  endSheet: { borderWidth: 1, borderRadius: 6, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  codex: {
    // Level with the top of the card, below the progress rail.
    marginTop: 118,
    width: 240,
    borderWidth: 1,
    borderRadius: 6,
    padding: Spacing.three,
    gap: 12,
  },
  codexRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  codexState: { borderTopWidth: 1, paddingTop: 12, gap: 6 },
  hintBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.five,
    borderTopWidth: 1,
  },
  hints: { flexDirection: "row", gap: Spacing.four },
});
