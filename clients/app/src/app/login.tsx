import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/api/client";
import { useSession } from "@/auth/session";
import { Fonts, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { Label, PrimaryButton } from "@/ui/primitives";

/**
 * Developer login. A stand-in until real sign-in exists: Google (and
 * email/password) through Firebase will be offered on this same screen, and both
 * end in the same place - a session token.
 */
export default function LoginScreen() {
  const c = useColors();
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

  const input = [styles.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }];

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.center}>
        <View style={styles.form}>
          <View style={styles.brandBlock}>
            <Text style={[styles.brand, { color: c.accent }]}>InstaCram</Text>
            <Text style={[Type.italic, { color: c.textSecondary, textAlign: "center", fontSize: 17 }]}>
              One-page cards for priming and revision.
            </Text>
          </View>

          <View style={[styles.rule, { backgroundColor: c.border }]} />

          <View style={styles.fieldBlock}>
            <Label tone="muted">Developer ID</Label>
            <TextInput
              style={input}
              autoCapitalize="none"
              autoCorrect={false}
              value={id}
              onChangeText={setId}
              returnKeyType="next"
            />
          </View>
          <View style={styles.fieldBlock}>
            <Label tone="muted">Password</Label>
            <TextInput
              style={input}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
          </View>

          {error && <Text style={[Type.ui, { color: c.danger }]}>{error}</Text>}

          <PrimaryButton label="Sign in" onPress={submit} disabled={!canSubmit} busy={busy} />

          <Text style={[Type.italic, { color: c.textFaint, textAlign: "center", fontSize: 14 }]}>
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
    return err.message;
  }
  return "Something went wrong. Try again.";
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: Spacing.four },
  form: { width: "100%", maxWidth: 400, gap: Spacing.three },
  brandBlock: { gap: Spacing.two, alignItems: "center" },
  brand: { fontFamily: Fonts.serifSemiBold, fontSize: 44, textAlign: "center" },
  rule: { height: 1, marginVertical: Spacing.two },
  fieldBlock: { gap: 6 },
  input: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 14, paddingVertical: 12, fontSize: 17, fontFamily: Fonts.serif },
});
