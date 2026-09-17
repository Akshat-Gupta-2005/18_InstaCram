import { useColorScheme } from "react-native";

import { Colors } from "@/constants/theme";

/** The palette for the device's current light/dark setting. */
export function useColors() {
  const scheme = useColorScheme();
  return Colors[scheme === "dark" ? "dark" : "light"];
}
