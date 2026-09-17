import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { Fonts, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";

/** Small-caps label. */
export function Label({
  children,
  tone = "muted",
  strong,
  style,
}: {
  children: ReactNode;
  tone?: "muted" | "accent" | "slate" | "text" | "faint" | "verified";
  strong?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  const color = {
    muted: c.textSecondary,
    accent: c.accent,
    slate: c.slate,
    text: c.text,
    faint: c.textFaint,
    verified: c.verified,
  }[tone];
  return <Text style={[strong ? Type.labelStrong : Type.label, { color }, style]}>{children}</Text>;
}

/** A keyboard key, as in the reference's shortcut hints. */
export function KeyCap({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.key, { backgroundColor: c.surface, borderColor: c.border }]}>
      <Text style={[Type.mono, { color: c.textSecondary, fontSize: 11 }]}>{children}</Text>
    </View>
  );
}

/**
 * The trust label. The two values make different promises - checked against a
 * source, or written by a model - so they must be told apart at a glance.
 */
export function TrustBadge({ label }: { label: "sourced_verified" | "ai_generated" }) {
  const c = useColors();
  const verified = label === "sourced_verified";
  const fg = verified ? c.verified : c.generated;
  const bg = verified ? c.verifiedSoft : c.generatedSoft;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <View style={[styles.badgeMark, { borderColor: fg }]}>
        <Text style={{ color: fg, fontSize: 8, lineHeight: 10, fontFamily: Fonts.sansSemiBold }}>{verified ? "✓" : "~"}</Text>
      </View>
      <Text style={[Type.ui, { color: fg, fontSize: 12.5, letterSpacing: 0.3 }]}>
        {verified ? "Verified Source" : "AI-generated"}
      </Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: c.accent, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={c.onAccent} />
      ) : (
        <Text style={[Type.labelStrong, { color: c.onAccent, fontSize: 12.5 }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A quiet bordered button, like the reference's SAVE. */
export function OutlineButton({
  children,
  onPress,
  active,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.outline,
        {
          borderColor: active ? c.accent : c.border,
          backgroundColor: active ? c.accentSoft : c.backgroundElement,
          opacity: pressed ? 0.8 : 1,
        },
        style,
      ]}>
      {children}
    </Pressable>
  );
}

export function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  key: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeMark: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.2, alignItems: "center", justifyContent: "center" },
  primary: { borderRadius: 6, paddingVertical: 14, paddingHorizontal: Spacing.four, alignItems: "center" },
  outline: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
