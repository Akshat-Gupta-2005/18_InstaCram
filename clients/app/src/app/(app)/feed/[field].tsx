import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, View, type LayoutChangeEvent, type ViewToken } from "react-native";

import type { ScrollCard } from "@/api/types";
import { useColors } from "@/constants/use-colors";
import { Card } from "@/feed/card";
import { FeedFooter } from "@/feed/footer";
import { useFeed, type FeedMode } from "@/feed/use-feed";

type Item = { kind: "card"; card: ScrollCard } | { kind: "footer" };

/**
 * The feed: one full-screen card per swipe, with the waiting state or the end card
 * as the final page.
 */
export default function FeedScreen() {
  const colors = useColors();
  const params = useLocalSearchParams<{ field: string; mode?: string }>();
  const field = String(params.field ?? "");
  const mode: FeedMode = params.mode === "revision" ? "revision" : "learn";

  const feed = useFeed(field, mode);
  const [height, setHeight] = useState(0);

  const items: Item[] = [...feed.cards.map((card) => ({ kind: "card" as const, card })), { kind: "footer" }];

  // FlatList requires these callbacks to keep one identity for its lifetime, so
  // they read the latest handlers through a ref, updated after each render.
  const handlers = useRef(feed);
  useEffect(() => {
    handlers.current = feed;
  });

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    for (const token of viewableItems) {
      if (!token.isViewable || token.index == null) continue;
      if (token.item.kind === "card") {
        handlers.current.onDisplayed(token.index);
      } else {
        handlers.current.onDisplayed(token.index);
        handlers.current.onReachedEnd();
      }
    }
  }).current;

  // A card counts as displayed only once most of it is on screen and it has
  // stayed there a moment - a card flicked past is not an impression.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 600 }).current;

  const onLayout = useCallback((e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height), []);

  const title = feed.page?.field.name ?? field;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} onLayout={onLayout}>
      <Stack.Screen options={{ title: mode === "revision" ? `Revise · ${title}` : title }} />
      {height > 0 && (
        <FlatList
          data={items}
          keyExtractor={(item) => (item.kind === "card" ? item.card.id : "footer")}
          renderItem={({ item }) =>
            item.kind === "card" ? (
              <Card card={item.card} height={height} onToggleSave={feed.toggleSave} />
            ) : (
              <FeedFooter
                page={feed.page}
                mode={mode}
                height={height}
                loading={feed.loading}
                error={feed.error}
                onExpand={feed.expand}
                onRetry={() => void feed.reload()}
              />
            )
          }
          pagingEnabled
          snapToInterval={height}
          decelerationRate="fast"
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: height, offset: height * index, index })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
