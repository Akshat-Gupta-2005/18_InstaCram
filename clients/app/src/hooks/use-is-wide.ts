import { useWindowDimensions } from "react-native";

import { CodexBreakpoint, WideBreakpoint } from "@/constants/theme";

/** Desktop reader layout (sidebar, centred column, keyboard) versus phone swipe layout. */
export function useIsWide(): boolean {
  return useWindowDimensions().width >= WideBreakpoint;
}

/** Room for the keyboard panel beside the card. */
export function useHasCodexRoom(): boolean {
  return useWindowDimensions().width >= CodexBreakpoint;
}
