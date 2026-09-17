import { useFocusEffect } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { ApiError } from "@/api/client";
import type { ScrollCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { Label, TrustBadge } from "@/ui/primitives";
import { useShellInfo } from "@/ui/shell";

/** The account's saved cards, newest first (API-CONTRACT §6). */
export default function SavedScreen() {
  const c = useColors();
  const { api } = useSession();
  const [cards, setCards] = useState<ScrollCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useShellInfo({ crumbs: ["Saved cards"] });

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
    setCards((current) => current?.filter((x) => x.id !== card.id) ?? null);
    try {
      await api(`/v1/saves/${card.id}`, { method: "DELETE" });
    } catch {
      setCards(before);
    }
  }

  if (error) return <Centered><Text style={[Type.ui, { color: c.danger }]}>{error}</Text></Centered>;
  if (!cards) return <Centered><ActivityIndicator color={c.accent} /></Centered>;
  if (cards.length === 0) {
    return (
      <Centered>
        <Text style={[Type.italic, { color: c.textSecondary, textAlign: "center", fontSize: 17 }]}>
          Nothing saved yet. Press S, or tap Save on a card, to keep it here.
        </Text>
      </Centered>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      contentContainerStyle={styles.list}
      data={cards}
      keyExtractor={(x) => x.id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Label tone="accent" strong>Saved cards</Label>
          <Text style={[Type.italic, { color: c.textSecondary }]}>
            {cards.length} card{cards.length === 1 ? "" : "s"} kept for later
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.item, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={styles.itemHead}>
            <Text style={[Type.displayCompact, { color: c.text, fontSize: 26, lineHeight: 32, flexShrink: 1 }]}>
              {item.topic.name}
            </Text>
            <TrustBadge label={item.trust_label} />
          </View>
          <Text style={[Type.bodySmall, { color: c.text }]}>{item.content}</Text>
          <View style={[styles.actions, { borderTopColor: c.border }]}>
            <Pressable onPress={() => void WebBrowser.openBrowserAsync(item.source_url)}>
              <Text style={[Type.ui, { color: c.slate, textDecorationLine: "underline", fontSize: 13 }]}>↗ Source</Text>
            </Pressable>
            <Pressable onPress={() => void unsave(item)}>
              <Label tone="muted" strong>Remove</Label>
            </Pressable>
          </View>
        </View>
      )}
    />
  );
}

function Centered({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.centered, { backgroundColor: c.background }]}>{children}</View>;
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.four },
  list: { padding: Spacing.four, gap: Spacing.three, alignItems: "center", paddingBottom: 80 },
  header: { width: "100%", maxWidth: MaxContentWidth, gap: 6, marginBottom: Spacing.two },
  item: { width: "100%", maxWidth: MaxContentWidth, borderWidth: 1, borderRadius: 6, padding: Spacing.four, gap: Spacing.three },
  itemHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: Spacing.three },
  actions: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, paddingTop: Spacing.three },
});
