import { Stack } from "expo-router";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";
import { useIsWide } from "@/hooks/use-is-wide";
import { ShellFrame, ShellProvider } from "@/ui/shell";

/**
 * Everything behind sign-in. The root layout only lets a signed-in user reach
 * this group.
 *
 * Wide screens get the reading-room frame (sidebar + top bar) around every
 * screen, with the navigator's own header hidden; phones get a slim header.
 */
export default function AppLayout() {
  const colors = useColors();
  const wide = useIsWide();

  const stack = (
    <Stack
      screenOptions={{
        headerShown: !wide,
        headerStyle: { backgroundColor: colors.rail },
        headerTintColor: colors.accent,
        headerTitleStyle: { fontFamily: Fonts.serifSemiBold, color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="index" options={{ title: "InstaCram" }} />
      <Stack.Screen name="feed/[field]" options={{ title: "" }} />
      <Stack.Screen name="saved" options={{ title: "Saved cards" }} />
    </Stack>
  );

  return <ShellProvider>{wide ? <ShellFrame>{stack}</ShellFrame> : stack}</ShellProvider>;
}
