import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { Palettes, type Palette, type ThemeMode } from "@/constants/theme";
import { loadPref, savePref } from "@/lib/prefs";

interface ThemeState {
  mode: ThemeMode;
  colors: Palette;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * The chosen palette. Parchment by default - it is the design - and not tied to
 * the OS light/dark setting, because the choice is about how the page reads, and
 * it is the reader's to make with the toggle. Remembered between visits.
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("parchment");

  useEffect(() => {
    void loadPref("theme").then((saved) => {
      if (saved === "ink" || saved === "parchment") setMode(saved);
    });
  }, []);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: ThemeMode = current === "parchment" ? "ink" : "parchment";
      void savePref("theme", next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ mode, colors: Palettes[mode], toggle }), [mode, toggle]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeState {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used inside <ThemeModeProvider>");
  return theme;
}

/** The current palette. */
export function useColors(): Palette {
  return useTheme().colors;
}
