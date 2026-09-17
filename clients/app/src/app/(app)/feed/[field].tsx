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

  // Whether the last page (waiting state / end card) is on screen. Tracked so that
  // ARRIVING there triggers one reload, and staying there triggers none. An earlier
  // version reloaded on every visibility report while the footer was showing -
  // five identical feed requests in six seconds for a field with two cards.
  const footerShown = useRef(false);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    let footerNow = false;
    for (const token of viewableItems) {
      if (!token.isViewable || token.index == null) continue;
      // The card travels with the token, so recording a view needs no lookup into
      // this component's state.
      handlers.current.onDisplayed(token.index, token.item.kind === "card" ? token.item.card : null);
      if (token.item.kind === "footer") footerNow = true;
    }
    if (footerNow && !footerShown.current) handlers.current.onReachedEnd();
    footerShown.current = footerNow;
  }).current;

  // New cards arriving while the user waits on the last page are inserted just
  // before it - that is, exactly where the user is. They must take the screen.
  // Nothing about scrolling does that on its own: on the web the list pages with
  // CSS scroll-snap, and the browser re-snaps to the element that was snapped (the
  // waiting page), so a card that arrived stayed out of sight. Measured: a card
  // created while waiting was fetched, added to the list, and never displayed for
  // nine minutes. So the list is moved explicitly to the first new card. Verified
  // both ways by a deterministic browser test: on screen 3s after it existed with
  // this effect, never on screen without it.
  const listRef = useRef<FlatList<Item>>(null);
  const cardCount = useRef(feed.cards.length);
  useEffect(() => {
    const before = cardCount.current;
    cardCount.current = feed.cards.length;
    if (feed.cards.length > before && footerShown.current && height > 0) {
      listRef.current?.scrollToOffset({ offset: before * height, animated: false });
    }
  }, [feed.cards.length, height]);

  // A card counts as displayed only once most of it is on screen and it has
  // stayed there a moment - a card flicked past is not an impression.
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 600 }).current;

  const onLayout = useCallback((e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height), []);

  const title = feed.page?.field.name ?? field;

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]} onLayout={onLayout}>
      <Stack.Screen options={{ title: mode === "revision" ? `Revise · ${title}` : title }} />
      {/* The list is not rendered until the first page has arrived. Rendered
          earlier, it holds only the footer, which is therefore on screen; the
          cards then arrive ABOVE it, and the browser's scroll anchoring keeps the
          footer in view - leaving a spinner on screen with the cards scrolled out
          of sight, never displayed and never counted as viewed. */}
      {height > 0 && !feed.page && (
        <FeedFooter
          page={null}
          mode={mode}
          height={height}
          loading={feed.loading}
          error={feed.error}
          onExpand={feed.expand}
          onRetry={() => void feed.reload()}
        />
      )}
      {height > 0 && feed.page && (
        <FlatList
          ref={listRef}
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
