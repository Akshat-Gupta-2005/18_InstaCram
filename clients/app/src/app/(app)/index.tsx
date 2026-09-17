import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useSession } from "@/auth/session";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";

/**
 * Starting points. Not a catalogue: any field can be typed, and a new one is
 * generated on first request. These are fields worth trying first because some
 * already have cards, so they open instantly rather than as a cold start.
 */
const STARTERS = ["Java Data Structures", "Java Collections", "Behavioural Economics"];

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const { signOut } = useSession();
  const [field, setField] = useState("");

  function open(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    router.push({ pathname: "/feed/[field]", params: { field: trimmed } });
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <Text style={[styles.heading, { color: colors.text }]}>What do you want to learn?</Text>
        <Text style={[styles.sub, { color: colors.textSecondary }]}>
          Type a field. Cards you haven't seen come first; a brand-new field takes a minute or two to generate.
        </Text>

        <TextInput
          style={[styles.input, { backgroundColor: colors.backgroundElement, color: colors.text }]}
          placeholder="e.g. Java Concurrency"
          placeholderTextColor={colors.textSecondary}
          value={field}
          onChangeText={setField}
          onSubmitEditing={() => open(field)}
          returnKeyType="go"
          maxLength={100}
        />
        <Pressable
          onPress={() => open(field)}
          disabled={!field.trim()}
          style={[styles.primary, { backgroundColor: colors.accent, opacity: field.trim() ? 1 : 0.5 }]}>
          <Text style={[styles.primaryText, { color: colors.onAccent }]}>Start</Text>
        </Pressable>

        <Text style={[styles.section, { color: colors.textSecondary }]}>Try one of these</Text>
        <View style={styles.chips}>
          {STARTERS.map((name) => (
            <Pressable
              key={name}
              onPress={() => open(name)}
              style={[styles.chip, { backgroundColor: colors.backgroundElement }]}>
              <Text style={{ color: colors.text }}>{name}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => router.push("/saved")} style={styles.link}>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>Saved cards</Text>
          </Pressable>
          <Pressable onPress={() => void signOut()} style={styles.link}>
            <Text style={{ color: colors.textSecondary }}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", padding: Spacing.four },
  column: { width: "100%", maxWidth: Math.min(MaxContentWidth, 560), gap: Spacing.three },
  heading: { fontSize: 28, fontWeight: "700", marginTop: Spacing.four },
  sub: { fontSize: 15, lineHeight: 21 },
  input: { borderRadius: 12, paddingHorizontal: Spacing.three, paddingVertical: 14, fontSize: 16 },
  primary: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryText: { fontSize: 16, fontWeight: "600" },
  section: { fontSize: 13, textTransform: "uppercase", letterSpacing: 0.5, marginTop: Spacing.four },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: Spacing.five },
  link: { paddingVertical: Spacing.two },
});
