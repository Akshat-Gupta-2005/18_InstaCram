import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useColorScheme } from "react-native";

import { SessionProvider, useSession } from "@/auth/session";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </ThemeProvider>
  );
}

/**
 * Which screens exist depends on whether someone is signed in. Stack.Protected
 * redirects automatically when a guard flips - signing out from anywhere lands on
 * the login screen, and signing in leaves it.
 *
 * Guards run on the client only; they decide what is SHOWN. What is ALLOWED is
 * decided by the server, which refuses any request without a valid token.
 */
function RootNavigator() {
  const { status } = useSession();

  // Hold the splash screen until the stored token has been read, so a signed-in
  // user never sees the login screen flash past.
  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  if (status === "loading") return null;

  const signedIn = status === "signedIn";
  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
