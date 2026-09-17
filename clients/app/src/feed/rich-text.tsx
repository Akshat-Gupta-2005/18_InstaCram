import type { ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/constants/use-colors";

/**
 * Card text with the reference's two typographic touches, derived from the text
 * itself - nothing is invented:
 *
 *   - the first mention of the topic's own name is set in the accent colour, as
 *     the reference sets "HashMap" in its first sentence;
 *   - complexity notation such as O(1) or O(log n) is set as an inline code chip.
 *
 * Plain text in, styled spans out. If neither pattern occurs, it is plain text.
 */
export function RichText({
  text,
  topic,
  style,
}: {
  text: string;
  topic?: string;
  style?: StyleProp<TextStyle>;
}) {
  const c = useColors();
  const parts: ReactNode[] = [];
  let emphasised = false;

  // Split on complexity notation first; within the plain runs, emphasise the
  // first mention of the topic.
  const segments = text.split(/(O\([^()]{1,24}\))/g);
  segments.forEach((segment, i) => {
    if (/^O\([^()]{1,24}\)$/.test(segment)) {
      parts.push(
        <Text
          key={`c${i}`}
          style={{ fontFamily: Fonts.mono, fontSize: 0.82 * fontSizeOf(style), color: c.codeText, backgroundColor: c.codeBackground }}>
          {` ${segment} `}
        </Text>,
      );
      return;
    }
    if (!emphasised && topic) {
      const at = segment.indexOf(topic);
      if (at !== -1) {
        emphasised = true;
        parts.push(segment.slice(0, at));
        parts.push(
          <Text key={`t${i}`} style={{ fontFamily: Fonts.serifSemiBold, color: c.accent }}>
            {topic}
          </Text>,
        );
        parts.push(segment.slice(at + topic.length));
        return;
      }
    }
    parts.push(segment);
  });

  return <Text style={style}>{parts}</Text>;
}

function fontSizeOf(style: StyleProp<TextStyle>): number {
  return StyleSheet.flatten(style)?.fontSize ?? 18;
}
