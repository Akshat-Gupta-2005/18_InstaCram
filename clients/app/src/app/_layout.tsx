import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
  useFonts,
} from "@expo-google-fonts/newsreader";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

import { SessionProvider, useSession } from "@/auth/session";
import { ThemeModeProvider, useTheme } from "@/constants/use-colors";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // One useFonts call can load families from several packages: each export is
  // just a font asset keyed by the name used as fontFamily.
  const [fontsLoaded, fontError] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Newsreader_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  return (
    <ThemeModeProvider>
      <SessionProvider>
        <RootNavigator fontsReady={fontsLoaded || fontError !== null} />
      </SessionProvider>
    </ThemeModeProvider>
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
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { status } = useSession();
  const { mode, colors } = useTheme();
  const ready = fontsReady && status !== "loading";

  // Hold the splash until the stored token is read AND the fonts are in, so a
  // signed-in user never sees the login screen flash past, and text never
  // re-flows from a fallback font into the real one. A font that fails to load
  // does not block the app - it falls back rather than hanging.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  const base = mode === "ink" ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: colors.background, card: colors.rail, text: colors.text, border: colors.border, primary: colors.accent },
  };

  const signedIn = status === "signedIn";
  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
