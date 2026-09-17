import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ScrollCard } from "@/api/types";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";

/**
 * One card, one screen. The five MVP elements (IMPLEMENTATION-PLAN W6): the source
 * link, the trust label, "why this matters", the tap-to-reveal recall prompt, and
 * the save button.
 */
export function Card({
  card,
  height,
  onToggleSave,
}: {
  card: ScrollCard;
  height: number;
  onToggleSave: (card: ScrollCard) => void;
}) {
  const colors = useColors();
  const [revealed, setRevealed] = useState(false);

  const verified = card.trust_label === "sourced_verified";
  const trustColor = verified ? colors.verified : colors.generated;

  return (
    <View style={[styles.page, { height }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.backgroundElement }]}>
          <View style={styles.header}>
            <Text style={[styles.topic, { color: colors.textSecondary }]} numberOfLines={1}>
              {card.topic.name}
            </Text>
            <View style={[styles.badge, { borderColor: trustColor }]}>
              <Text style={[styles.badgeText, { color: trustColor }]}>
                {verified ? "Verified from source" : "AI-generated"}
              </Text>
            </View>
          </View>

          <Text style={[styles.content, { color: colors.text }]}>{card.content}</Text>

          <View style={styles.block}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Why this matters</Text>
            <Text style={[styles.body, { color: colors.text }]}>{card.why_it_matters}</Text>
          </View>

          <Pressable
            onPress={() => setRevealed((r) => !r)}
            style={[styles.recall, { backgroundColor: colors.backgroundSelected }]}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide answer" : "Reveal answer"}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Recall</Text>
            <Text style={[styles.body, { color: colors.text, fontWeight: "600" }]}>{card.recall.prompt}</Text>
            {revealed ? (
              <Text style={[styles.body, { color: colors.text }]}>{card.recall.answer}</Text>
            ) : (
              <Text style={[styles.hint, { color: colors.accent }]}>Tap to reveal</Text>
            )}
          </Pressable>

          <View style={styles.actions}>
            <Pressable onPress={() => void WebBrowser.openBrowserAsync(card.source_url)} style={styles.action}>
              <Text style={{ color: colors.accent, fontWeight: "600" }}>Source ↗</Text>
            </Pressable>
            <Pressable
              onPress={() => onToggleSave(card)}
              style={styles.action}
              accessibilityRole="button"
              accessibilityState={{ selected: card.saved }}>
              <Text style={{ color: card.saved ? colors.accent : colors.textSecondary, fontWeight: "600" }}>
                {card.saved ? "★ Saved" : "☆ Save"}
              </Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%", alignItems: "center" },
  scroll: { flexGrow: 1, justifyContent: "center", padding: Spacing.three },
  card: {
    width: "100%",
    maxWidth: Math.min(MaxContentWidth, 640),
    borderRadius: 20,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two },
  topic: { flexShrink: 1, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  content: { fontSize: 19, lineHeight: 28 },
  block: { gap: Spacing.one },
  label: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  body: { fontSize: 15, lineHeight: 22 },
  recall: { borderRadius: 14, padding: Spacing.three, gap: Spacing.one },
  hint: { fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", justifyContent: "space-between" },
  action: { paddingVertical: Spacing.two },
});
