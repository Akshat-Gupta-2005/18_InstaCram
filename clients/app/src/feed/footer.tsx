import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AdjacentField, FeedPage } from "@/api/types";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { fieldIsFinished, type FeedMode } from "@/feed/use-feed";
import { Dot, Label, OutlineButton, PrimaryButton } from "@/ui/primitives";

/**
 * The page after the cards in hand. Exactly one of the contract's three states
 * (API-CONTRACT §3), never conflated:
 *
 *   generating  -> the waiting state, with a ready-count, not a bare spinner
 *   exhausted   -> the end card: count, adjacent fields, more topics
 *   otherwise   -> the next page is on its way
 *
 * Given a height it fills a swipe page; without one it sits inside the reader.
 */
export function FeedFooter({
  page,
  mode,
  height,
  loading,
  error,
  onExpand,
  onRetry,
}: {
  page: FeedPage | null;
  mode: FeedMode;
  height?: number;
  loading: boolean;
  error: string | null;
  onExpand: () => Promise<unknown>;
  onRetry: () => void;
}) {
  const c = useColors();

  let body: ReactNode;
  if (error) {
    body = (
      <>
        <Text style={[Type.heading, styles.center, { color: c.text }]}>Couldn't load cards</Text>
        <Text style={[Type.bodySmall, styles.center, { color: c.textSecondary }]}>{error}</Text>
        <PrimaryButton label="Try again" onPress={onRetry} />
      </>
    );
  } else if (!page) {
    body = <ActivityIndicator color={c.accent} />;
  } else if (mode === "revision") {
    body = loading ? (
      <ActivityIndicator color={c.accent} />
    ) : (
      <>
        <Label tone="slate" style={styles.center}>Revision</Label>
        <Text style={[Type.heading, styles.center, { color: c.text }]}>That's everything you've seen here</Text>
        <Text style={[Type.bodySmall, styles.center, { color: c.textSecondary }]}>
          Revision cycles through cards you've already viewed. Come back later to go round again.
        </Text>
      </>
    );
  } else if (page.exhausted) {
    body = <EndCard page={page} onExpand={onExpand} />;
  } else if (page.generating) {
    body = <Waiting page={page} />;
  } else {
    body = <ActivityIndicator color={c.accent} />;
  }

  const content = (
    <View style={styles.column}>
      {page && page.failed_topics.length > 0 && mode === "learn" && (
        // The contract asks for this to be said, not silently omitted.
        <Text style={[Type.italic, styles.center, { color: c.generated, fontSize: 14 }]}>
          Couldn't load verified cards for {page.failed_topics.map((t) => t.name).join(", ")}.
        </Text>
      )}
      {body}
    </View>
  );

  if (height === undefined) return content;
  return (
    <View style={[styles.page, { height }]}>
      <ScrollView contentContainerStyle={styles.scroll}>{content}</ScrollView>
    </View>
  );
}

function Waiting({ page }: { page: FeedPage }) {
  const c = useColors();
  const expanding = page.last_expansion?.status === "running";
  return (
    <>
      <ActivityIndicator color={c.accent} size="large" />
      <Label tone="slate" style={styles.center}>Writing cards</Label>
      <Text style={[Type.heading, styles.center, { color: c.text }]}>Making more cards for {page.field.name}</Text>
      <Text style={[Type.bodySmall, styles.center, { color: c.textSecondary }]}>
        {page.topics_pending > 0
          ? `${page.topics_pending} topic${page.topics_pending === 1 ? "" : "s"} in progress. Each card is checked against its source before it appears here, so they arrive a few at a time.`
          : expanding
            ? "Working out which topics belong in this field…"
            : "Checking for new cards…"}
      </Text>
      {/* Timings measured on this project's local model, so a first-time user is
          not left wondering whether anything is happening: a new field's first
          cards took ~9 minutes in live use, and single topics 1.5 to 10. */}
      <Text style={[Type.italic, styles.center, { color: c.textSecondary }]}>
        A new field's first cards can take several minutes. Topics are made one at a time, and each takes a few
        minutes. New cards appear here on their own - you can leave and come back.
      </Text>
    </>
  );
}

function EndCard({ page, onExpand }: { page: FeedPage; onExpand: () => Promise<unknown> }) {
  const c = useColors();
  const router = useRouter();
  const [expanding, setExpanding] = useState(false);
  const end = page.end_card;
  const finished = fieldIsFinished(page);

  async function expand() {
    setExpanding(true);
    try {
      await onExpand();
    } finally {
      setExpanding(false);
    }
  }

  function open(field: AdjacentField) {
    router.push({ pathname: "/feed/[field]", params: { field: field.name } });
  }

  return (
    <>
      <Label tone="accent" strong style={styles.center}>End of field</Label>
      <Text style={[Type.heading, styles.center, { color: c.text }]}>You've read everything in {page.field.name}</Text>
      {end && (
        <Text style={[Type.italic, styles.center, { color: c.textSecondary }]}>
          {end.viewed_count} card{end.viewed_count === 1 ? "" : "s"} seen in this field. The feed ends here - it never loops.
        </Text>
      )}

      {finished ? (
        <Text style={[Type.bodySmall, styles.center, { color: c.textSecondary }]}>
          There's nothing more to add to this field right now.
        </Text>
      ) : (
        <PrimaryButton label={expanding ? "Asking for more…" : "More topics"} onPress={expand} busy={expanding} />
      )}

      <OutlineButton
        onPress={() => router.push({ pathname: "/feed/[field]", params: { field: page.field.name, mode: "revision" } })}
        style={styles.centerButton}>
        <Label tone="text" strong>Revise what you've seen</Label>
      </OutlineButton>

      {end && end.adjacent_fields.length > 0 && (
        <View style={styles.adjacent}>
          <Label tone="muted">Where to go next</Label>
          {end.adjacent_fields.map((f) => (
            <Pressable
              key={`${f.source}:${f.name}`}
              onPress={() => open(f)}
              style={({ pressed }) => [
                styles.field,
                { backgroundColor: c.backgroundElement, borderColor: c.border, opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text style={[Type.body, { color: c.text, fontSize: 19, lineHeight: 26 }]}>{f.name}</Text>
              {/* The two kinds must look different: a suggested field with no
                  content opens as a cold start, and that should not surprise. */}
              <View style={styles.fieldMeta}>
                <Dot color={f.has_content ? c.verified : c.textFaint} />
                <Text style={[Type.ui, { color: c.textSecondary, fontSize: 12.5 }]}>
                  {f.source === "overlap"
                    ? `${f.shared_topics} shared topic${f.shared_topics === 1 ? "" : "s"}`
                    : f.has_content
                      ? "Suggested · has cards"
                      : "Suggested · new field, cards will be written"}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%" },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: Spacing.four },
  column: { width: "100%", maxWidth: MaxContentWidth, gap: Spacing.three, alignItems: "stretch" },
  center: { textAlign: "center" },
  centerButton: { alignSelf: "center" },
  adjacent: { gap: Spacing.two, marginTop: Spacing.four },
  field: { borderWidth: 1, borderRadius: 4, paddingHorizontal: Spacing.three, paddingVertical: 12, gap: 4 },
  fieldMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
});
