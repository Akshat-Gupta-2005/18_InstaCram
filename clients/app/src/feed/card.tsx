import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ScrollCard } from "@/api/types";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors } from "@/constants/use-colors";
import { RichText } from "@/feed/rich-text";
import { KeyCap, Label, OutlineButton, TrustBadge } from "@/ui/primitives";

export type CardVariant = "reader" | "swipe";

/**
 * One card, in the reading-room style. The five MVP elements (IMPLEMENTATION-PLAN
 * W6): the source link, the trust label, "why this matters", the tap-to-reveal
 * recall prompt, and save.
 *
 * Every element is drawn from the card's real fields. Where the reference mock
 * shows data the product does not have - a package subtitle, a monograph code, a
 * diagram - the card shows what it does have (the source's site) or nothing.
 *
 * `reader` is the desktop column with keyboard hints; `swipe` is one full page on
 * a phone. Reveal state can be controlled from outside, so the reader's Space key
 * and a tap reach the same state.
 */
export function Card({
  card,
  fieldName,
  variant,
  height,
  revealed: revealedProp,
  onToggleReveal,
  onToggleSave,
}: {
  card: ScrollCard;
  fieldName: string;
  variant: CardVariant;
  /** Page height for the swipe variant. */
  height?: number;
  revealed?: boolean;
  onToggleReveal?: () => void;
  onToggleSave: (card: ScrollCard) => void;
}) {
  const c = useColors();
  const [ownRevealed, setOwnRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const revealed = revealedProp ?? ownRevealed;
  const toggleReveal = onToggleReveal ?? (() => setOwnRevealed((r) => !r));
  const reader = variant === "reader";
  const site = hostOf(card.source_url);

  async function copy() {
    await Clipboard.setStringAsync(`${card.topic.name}\n\n${card.content}\n\nSource: ${card.source_url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const body = (
    <View
      style={[
        styles.card,
        reader ? styles.cardReader : styles.cardSwipe,
        { backgroundColor: c.surface, borderColor: c.border },
      ]}>
      <View style={styles.eyebrowRow}>
        <View style={styles.eyebrow}>
          <Label tone="accent" strong>Concept card</Label>
          <Text style={[Type.mono, { color: c.textFaint }]} numberOfLines={1}>
            · {fieldName.toUpperCase()}
          </Text>
        </View>
        <TrustBadge label={card.trust_label} />
      </View>

      <View style={styles.titleBlock}>
        <Text style={[reader ? Type.display : Type.displayCompact, { color: c.text }]}>{card.topic.name}</Text>
        {site && <Label tone="slate">Source · {site}</Label>}
      </View>

      <RichText
        text={card.content}
        topic={card.topic.name}
        style={[reader ? Type.body : Type.bodyCompact, { color: c.text }]}
      />

      <View style={[styles.box, { backgroundColor: c.backgroundElement }]}>
        <View style={styles.boxHeading}>
          <Text style={{ color: c.accent, fontSize: 13 }}>◈</Text>
          <Label tone="accent" strong>Why this matters</Label>
        </View>
        <Text style={[Type.bodySmall, { color: c.text }]}>{card.why_it_matters}</Text>
      </View>

      <View style={[styles.box, { backgroundColor: c.backgroundElement }]}>
        <View style={[styles.boxHeading, styles.spread]}>
          <View style={styles.boxHeading}>
            <Text style={{ color: c.slate, fontSize: 13 }}>?</Text>
            <Label tone="slate" strong>Active retrieval · Self-check</Label>
          </View>
          {reader && <Text style={[Type.ui, { color: c.textFaint, fontSize: 12 }]}>Untimed</Text>}
        </View>
        <Text style={[Type.body, { color: c.text, fontSize: reader ? 21 : 19, lineHeight: reader ? 31 : 28 }]}>
          {card.recall.prompt}
        </Text>
        {revealed ? (
          <Pressable onPress={toggleReveal} style={[styles.answer, { borderLeftColor: c.accent }]}>
            <RichText text={card.recall.answer} style={[Type.bodySmall, { color: c.text }]} />
          </Pressable>
        ) : (
          <Pressable
            onPress={toggleReveal}
            accessibilityRole="button"
            accessibilityLabel="Reveal answer"
            style={({ pressed }) => [styles.reveal, { backgroundColor: c.surface, opacity: pressed ? 0.8 : 1 }]}>
            {reader && <KeyCap>SPACE</KeyCap>}
            <Label tone="text" strong>{reader ? "Tap to reveal answer" : "Tap to reveal"}</Label>
          </Pressable>
        )}
      </View>

      <View style={[styles.footer, { borderTopColor: c.border }]}>
        <Pressable onPress={() => void WebBrowser.openBrowserAsync(card.source_url)} style={styles.sourceLink}>
          <Text style={{ color: c.slate }}>↗</Text>
          <Text style={[Type.ui, { color: c.slate, textDecorationLine: "underline", fontSize: 13 }]} numberOfLines={1}>
            Source: {site ?? "original page"}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          <OutlineButton onPress={() => onToggleSave(card)} active={card.saved} accessibilityLabel={card.saved ? "Unsave" : "Save"}>
            <Text style={{ color: card.saved ? c.accent : c.textSecondary }}>{card.saved ? "★" : "☆"}</Text>
            <Label tone={card.saved ? "accent" : "text"} strong>{card.saved ? "Saved" : "Save"}</Label>
            {reader && <KeyCap>S</KeyCap>}
          </OutlineButton>
          <OutlineButton onPress={() => void copy()} accessibilityLabel="Copy card">
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>{copied ? "✓" : "⧉"}</Text>
          </OutlineButton>
        </View>
      </View>
    </View>
  );

  if (reader) return body;

  return (
    <View style={[styles.page, { height }]}>
      <ScrollView contentContainerStyle={styles.pageScroll} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </View>
  );
}

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1]!.replace(/^www\./, "") : null;
}

const styles = StyleSheet.create({
  page: { width: "100%", alignItems: "center" },
  pageScroll: { flexGrow: 1, justifyContent: "center", padding: Spacing.three },
  card: { width: "100%", maxWidth: MaxContentWidth, borderWidth: 1, gap: Spacing.four },
  cardReader: {
    borderRadius: 6,
    paddingHorizontal: 44,
    paddingVertical: 48,
    shadowColor: "#3B2A1A",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  cardSwipe: { borderRadius: 8, padding: Spacing.four, gap: Spacing.three },
  eyebrowRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.two, flexWrap: "wrap" },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
  titleBlock: { gap: Spacing.two },
  box: { borderRadius: 4, padding: Spacing.four, gap: Spacing.two },
  boxHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  spread: { justifyContent: "space-between" },
  reveal: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    borderRadius: 4,
    marginTop: Spacing.two,
  },
  answer: { borderLeftWidth: 3, paddingLeft: Spacing.three, marginTop: Spacing.two },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
    borderTopWidth: 1,
    paddingTop: Spacing.three,
    flexWrap: "wrap",
  },
  sourceLink: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  actions: { flexDirection: "row", gap: Spacing.two },
});
