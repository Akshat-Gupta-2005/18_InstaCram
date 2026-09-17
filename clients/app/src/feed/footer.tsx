import { useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AdjacentField, FeedPage } from "@/api/types";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";
import { fieldIsFinished, type FeedMode } from "@/feed/use-feed";

/**
 * The last page of the feed: what comes after the cards in hand. Exactly one of
 * the contract's three states (API-CONTRACT §3), never conflated:
 *
 *   generating  -> the waiting state, with a ready-count, not a bare spinner
 *   exhausted   -> the end card: count, adjacent fields, more topics
 *   otherwise   -> the next page is on its way
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
  height: number;
  loading: boolean;
  error: string | null;
  onExpand: () => Promise<unknown>;
  onRetry: () => void;
}) {
  const colors = useColors();

  let body: ReactNode;
  if (error) {
    body = (
      <>
        <Text style={[styles.title, { color: colors.text }]}>Couldn't load cards</Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>{error}</Text>
        <Button label="Try again" onPress={onRetry} />
      </>
    );
  } else if (!page) {
    body = <ActivityIndicator color={colors.accent} />;
  } else if (mode === "revision") {
    body = loading ? (
      <ActivityIndicator color={colors.accent} />
    ) : (
      <>
        <Text style={[styles.title, { color: colors.text }]}>That's everything you've seen here</Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          Revision cycles through cards you've already viewed. Come back later to go round again.
        </Text>
      </>
    );
  } else if (page.exhausted) {
    body = <EndCard page={page} onExpand={onExpand} />;
  } else if (page.generating) {
    body = <Waiting page={page} />;
  } else {
    body = <ActivityIndicator color={colors.accent} />;
  }

  return (
    <View style={[styles.page, { height }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.column}>
          {page && page.failed_topics.length > 0 && mode === "learn" && (
            // The contract asks for this to be said, not silently omitted.
            <Text style={[styles.notice, { color: colors.generated }]}>
              Couldn't load verified cards for {page.failed_topics.map((t) => t.name).join(", ")}.
            </Text>
          )}
          {body}
        </View>
      </ScrollView>
    </View>
  );
}

function Waiting({ page }: { page: FeedPage }) {
  const colors = useColors();
  const expanding = page.last_expansion?.status === "running";
  return (
    <>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={[styles.title, { color: colors.text }]}>Making more cards for {page.field.name}</Text>
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        {page.topics_pending > 0
          ? `${page.topics_pending} topic${page.topics_pending === 1 ? "" : "s"} in progress. Each card is checked against its source before it appears here, so they arrive a few at a time.`
          : expanding
            ? "Working out which topics belong in this field…"
            : "Checking for new cards…"}
      </Text>
    </>
  );
}

function EndCard({ page, onExpand }: { page: FeedPage; onExpand: () => Promise<unknown> }) {
  const colors = useColors();
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
      <Text style={[styles.title, { color: colors.text }]}>You've reached the end of {page.field.name}</Text>
      {end && (
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          {end.viewed_count} card{end.viewed_count === 1 ? "" : "s"} seen in this field.
        </Text>
      )}

      {finished ? (
        <Text style={[styles.text, { color: colors.textSecondary }]}>
          There's nothing more to add to this field right now.
        </Text>
      ) : (
        <Button label={expanding ? "Asking for more…" : "More topics"} onPress={expand} disabled={expanding} />
      )}

      <Button
        label="Revise what you've seen"
        variant="secondary"
        onPress={() => router.push({ pathname: "/feed/[field]", params: { field: page.field.name, mode: "revision" } })}
      />

      {end && end.adjacent_fields.length > 0 && (
        <View style={styles.adjacent}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Where to go next</Text>
          {end.adjacent_fields.map((f) => (
            <Pressable
              key={`${f.source}:${f.name}`}
              onPress={() => open(f)}
              style={[styles.field, { backgroundColor: colors.backgroundElement }]}>
              <Text style={[styles.fieldName, { color: colors.text }]}>{f.name}</Text>
              {/* The two kinds must look different: a suggested field with no
                  content opens as a cold start, and that should not surprise. */}
              <Text style={[styles.fieldMeta, { color: f.has_content ? colors.verified : colors.textSecondary }]}>
                {f.source === "overlap"
                  ? `${f.shared_topics} shared topic${f.shared_topics === 1 ? "" : "s"}`
                  : f.has_content
                    ? "Suggested · has cards"
                    : "Suggested · new field, cards will be generated"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const colors = useColors();
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        { backgroundColor: primary ? colors.accent : colors.backgroundElement, opacity: disabled ? 0.6 : 1 },
      ]}>
      <Text style={{ color: primary ? colors.onAccent : colors.text, fontWeight: "600", fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%" },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: Spacing.four },
  column: { width: "100%", maxWidth: Math.min(MaxContentWidth, 560), gap: Spacing.three, alignItems: "stretch" },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  text: { fontSize: 15, lineHeight: 22, textAlign: "center" },
  notice: { fontSize: 13, textAlign: "center" },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  adjacent: { gap: Spacing.two, marginTop: Spacing.three },
  field: { borderRadius: 12, padding: Spacing.three, gap: 2 },
  fieldName: { fontSize: 16, fontWeight: "600" },
  fieldMeta: { fontSize: 13 },
});
