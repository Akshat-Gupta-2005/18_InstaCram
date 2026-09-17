import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { useSession } from "@/auth/session";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";

/**
 * Developer login. A stand-in until real sign-in exists: Google (and
 * email/password) through Firebase will be offered on this same screen, and both
 * end in the same place - a session token.
 */
export default function LoginScreen() {
  const colors = useColors();
  const { signInWithDevLogin } = useSession();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = id.trim() !== "" && password !== "" && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithDevLogin(id.trim(), password);
      // No navigation here: the root layout's guard moves a signed-in user on.
    } catch (err) {
      setError(describe(err));
      setBusy(false);
    }
  }

  const input = [styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
        <View style={styles.form}>
          <Text style={[styles.brand, { color: colors.text }]}>InstaCram</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            One-page cards for priming and revision.
          </Text>

          <TextInput
            style={input}
            placeholder="Developer ID"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            value={id}
            onChangeText={setId}
            returnKeyType="next"
          />
          <TextInput
            style={input}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error && <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={[styles.button, { backgroundColor: colors.accent, opacity: canSubmit ? 1 : 0.5 }]}>
            {busy ? (
              <ActivityIndicator color={colors.onAccent} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.onAccent }]}>Sign in</Text>
            )}
          </Pressable>

          <Text style={[styles.note, { color: colors.textSecondary }]}>
            Google sign-in is coming. For now, use the developer credentials from the project's .env.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function describe(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "invalid_credentials") return "That ID or password is incorrect.";
    if (err.code === "login_not_available") return `The server isn't set up for developer login: ${err.message}`;
    if (err.code === "network_error") return err.message;
    return err.message;
  }
  return "Something went wrong. Try again.";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.four },
  form: { width: "100%", maxWidth: Math.min(MaxContentWidth, 420), gap: Spacing.three },
  brand: { fontSize: 36, fontWeight: "700", textAlign: "center" },
  tagline: { fontSize: 15, textAlign: "center", marginBottom: Spacing.three },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 14, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: Spacing.two },
  buttonText: { fontSize: 16, fontWeight: "600" },
  error: { fontSize: 14 },
  note: { fontSize: 12, textAlign: "center", marginTop: Spacing.three },
});
