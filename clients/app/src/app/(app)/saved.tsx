import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/api/client";
import type { ScrollCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";

/** The account's saved cards, newest first (API-CONTRACT §6). */
export default function SavedScreen() {
  const colors = useColors();
  const { api } = useSession();
  const [cards, setCards] = useState<ScrollCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reloaded whenever the screen comes into focus, so a card saved in the feed
  // is here on return.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      api<{ scrolls: ScrollCard[] }>("/v1/saves")
        .then((res) => {
          if (!cancelled) {
            setCards(res.scrolls);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load saved cards.");
        });
      return () => {
        cancelled = true;
      };
    }, [api]),
  );

  async function unsave(card: ScrollCard) {
    const before = cards;
    setCards((current) => current?.filter((c) => c.id !== card.id) ?? null);
    try {
      await api(`/v1/saves/${card.id}`, { method: "DELETE" });
    } catch {
      setCards(before);
    }
  }

  if (error) {
    return <Centered><Text style={{ color: colors.danger }}>{error}</Text></Centered>;
  }
  if (!cards) {
    return <Centered><ActivityIndicator color={colors.accent} /></Centered>;
  }
  if (cards.length === 0) {
    return (
      <Centered>
        <Text style={{ color: colors.textSecondary, textAlign: "center" }}>
          Nothing saved yet. Tap ☆ Save on a card to keep it here.
        </Text>
      </Centered>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={cards}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => (
        <View style={[styles.item, { backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.topic, { color: colors.textSecondary }]}>{item.topic.name}</Text>
          <Text style={[styles.content, { color: colors.text }]}>{item.content}</Text>
          <View style={styles.actions}>
            <Pressable onPress={() => void WebBrowser.openBrowserAsync(item.source_url)}>
              <Text style={{ color: colors.accent, fontWeight: "600" }}>Source ↗</Text>
            </Pressable>
            <Pressable onPress={() => void unsave(item)}>
              <Text style={{ color: colors.textSecondary, fontWeight: "600" }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <View style={[styles.centered, { backgroundColor: colors.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.four },
  list: { padding: Spacing.three, gap: Spacing.three, alignItems: "center" },
  item: { width: "100%", maxWidth: Math.min(MaxContentWidth, 640), borderRadius: 16, padding: Spacing.three, gap: Spacing.two },
  topic: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  content: { fontSize: 16, lineHeight: 23 },
  actions: { flexDirection: "row", justifyContent: "space-between", marginTop: Spacing.one },
});
