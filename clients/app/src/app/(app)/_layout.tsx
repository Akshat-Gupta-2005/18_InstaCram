import { Stack } from "expo-router";

import { useColors } from "@/constants/use-colors";

/** Everything behind sign-in. The root layout only lets a signed-in user reach this group. */
export default function AppLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="index" options={{ title: "InstaCram" }} />
      <Stack.Screen name="feed/[field]" options={{ title: "" }} />
      <Stack.Screen name="saved" options={{ title: "Saved cards" }} />
    </Stack>
  );
}
