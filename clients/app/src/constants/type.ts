import { StyleSheet } from "react-native";

import { Fonts } from "@/constants/theme";

/**
 * Text styles, without colour - colour comes from the palette at the call site so
 * both themes share one set of styles.
 */
export const Type = StyleSheet.create({
  /** Small caps labels: rails, eyebrows, breadcrumbs. */
  label: { fontFamily: Fonts.sansMedium, fontSize: 11.5, letterSpacing: 1.4, textTransform: "uppercase" },
  labelStrong: { fontFamily: Fonts.sansSemiBold, fontSize: 11.5, letterSpacing: 1.4, textTransform: "uppercase" },
  /** The card title - the topic. */
  display: { fontFamily: Fonts.serifMedium, fontSize: 46, lineHeight: 54, letterSpacing: -0.5 },
  displayCompact: { fontFamily: Fonts.serifMedium, fontSize: 34, lineHeight: 40, letterSpacing: -0.3 },
  /** Screen headings. */
  heading: { fontFamily: Fonts.serifMedium, fontSize: 30, lineHeight: 38 },
  /** Reading text. */
  body: { fontFamily: Fonts.serif, fontSize: 20, lineHeight: 33 },
  bodyCompact: { fontFamily: Fonts.serif, fontSize: 18, lineHeight: 29 },
  bodySmall: { fontFamily: Fonts.serif, fontSize: 16.5, lineHeight: 26 },
  italic: { fontFamily: Fonts.serifItalic, fontSize: 16, lineHeight: 24 },
  /** UI text in sans. */
  ui: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 20 },
  uiStrong: { fontFamily: Fonts.sansSemiBold, fontSize: 14, lineHeight: 20 },
  mono: { fontFamily: Fonts.mono, fontSize: 12 },
});
