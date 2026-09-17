import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useSession } from "@/auth/session";
import { Fonts, MaxContentWidth, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { useIsWide } from "@/hooks/use-is-wide";
import { Label, PrimaryButton } from "@/ui/primitives";
import { useShellInfo } from "@/ui/shell";

/**
 * Starting points. Not a catalogue: any field can be typed, and a new one is
 * generated on first request. These are worth trying first because they already
 * have cards, so they open at once rather than as a cold start.
 */
const STARTERS = ["Java Data Structures", "Science", "Java Streams"];

export default function HomeScreen() {
  const c = useColors();
  const router = useRouter();
  const wide = useIsWide();
  const { signOut } = useSession();
  const [field, setField] = useState("");

  useShellInfo({ crumbs: ["Fields"] });

  function open(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    router.push({ pathname: "/feed/[field]", params: { field: trimmed } });
  }

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={[styles.container, wide && styles.containerWide]}
      keyboardShouldPersistTaps="handled">
      <View style={styles.column}>
        <Label tone="accent" strong>Begin a field</Label>
        <Text style={[styles.heading, { color: c.text }]}>What do you want to learn?</Text>
        <Text style={[Type.bodySmall, { color: c.textSecondary }]}>
          Type a field. Cards you haven't seen come first. A brand-new field is written for you, a topic at a time - its
          first cards can take several minutes.
        </Text>

        <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
          <TextInput
            style={[styles.input, { color: c.text }]}
            placeholder="e.g. Java Concurrency"
            placeholderTextColor={c.textFaint}
            value={field}
            onChangeText={setField}
            onSubmitEditing={() => open(field)}
            returnKeyType="go"
            maxLength={100}
          />
          <PrimaryButton label="Start" onPress={() => open(field)} disabled={!field.trim()} style={styles.start} />
        </View>

        <Label tone="muted" style={styles.section}>Fields with cards</Label>
        <View style={styles.list}>
          {STARTERS.map((name, i) => (
            <Pressable
              key={name}
              onPress={() => open(name)}
              style={({ pressed }) => [
                styles.row,
                { borderBottomColor: c.border, opacity: pressed ? 0.7 : 1 },
                i === 0 && { borderTopColor: c.border, borderTopWidth: 1 },
              ]}>
              <Text style={[Type.mono, { color: c.textFaint }]}>{String(i + 1).padStart(2, "0")}</Text>
              <Text style={[Type.body, { color: c.text, flex: 1, fontSize: 21 }]}>{name}</Text>
              <Text style={{ color: c.accent, fontSize: 16 }}>→</Text>
            </Pressable>
          ))}
        </View>

        {!wide && (
          <View style={styles.footer}>
            <Pressable onPress={() => router.push("/saved")}>
              <Label tone="accent" strong>Saved cards</Label>
            </Pressable>
            <Pressable onPress={() => void signOut()}>
              <Label tone="muted">Sign out</Label>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: "center", padding: Spacing.four },
  containerWide: { paddingTop: 72 },
  column: { width: "100%", maxWidth: MaxContentWidth, gap: Spacing.three },
  heading: { fontFamily: Fonts.serifMedium, fontSize: 42, lineHeight: 50, letterSpacing: -0.4 },
  search: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 6, padding: 6, marginTop: Spacing.three, gap: 8 },
  input: { flex: 1, fontFamily: Fonts.serif, fontSize: 19, paddingHorizontal: 12, paddingVertical: 10 },
  start: { paddingVertical: 12 },
  section: { marginTop: Spacing.five },
  list: {},
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.three, paddingVertical: 18, borderBottomWidth: 1 },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: Spacing.five },
});
