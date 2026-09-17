import { Stack, useLocalSearchParams } from "expo-router";

import { useIsWide } from "@/hooks/use-is-wide";
import { Reader } from "@/feed/reader";
import { SwipeFeed } from "@/feed/swipe-feed";
import { useFeed, type FeedMode } from "@/feed/use-feed";
import { useShellInfo } from "@/ui/shell";

/**
 * A field's feed. Wide screens get the desktop reader (one card at a time,
 * keyboard, peeking neighbours); phones get one full-screen card per swipe. Both
 * share useFeed, so paging, polling and view logging behave identically.
 */
export default function FeedScreen() {
  const params = useLocalSearchParams<{ field: string; mode?: string }>();
  const field = String(params.field ?? "");
  const mode: FeedMode = params.mode === "revision" ? "revision" : "learn";
  const wide = useIsWide();
  const feed = useFeed(field, mode);
  const title = feed.page?.field.name ?? field;

  // On wide screens the Reader reports its own, richer description (card number,
  // deck position); reporting here too would overwrite it, because a parent's
  // effects run after its children's.
  useShellInfo(wide || !feed.focused ? null : { crumbs: [title], mode, field: feed.page?.field.name, pending: feed.page?.topics_pending });

  return (
    <>
      <Stack.Screen options={{ title: mode === "revision" ? `Revise · ${title}` : title }} />
      {wide ? <Reader feed={feed} field={field} mode={mode} /> : <SwipeFeed feed={feed} field={field} mode={mode} />}
    </>
  );
}
