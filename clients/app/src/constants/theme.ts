/**
 * The reading-room design system: a warm parchment page, serif reading type,
 * small-caps sans labels, and a deep red accent (reference: the 2026-09-17 mock).
 *
 * Two palettes. "parchment" is the default and the one the reference shows;
 * "ink" is its dark counterpart for reading at night. Both keep the same roles,
 * so a component never picks a raw colour.
 */
import '@/global.css';

export const Palettes = {
  parchment: {
    background: '#F8F3EB', // the page
    rail: '#F2ECE2', // sidebar and top bar
    surface: '#FFFDF9', // the card itself
    backgroundElement: '#F3ECE2', // boxes inside a card
    backgroundSelected: '#EAE1D4',
    border: '#E6DCCD',
    text: '#1E1915',
    textSecondary: '#6F665C',
    textFaint: '#A59B8F',
    accent: '#7A2412', // deep red: brand, emphasis, progress
    accentSoft: '#F4E1D8',
    onAccent: '#FFFFFF',
    slate: '#34506B', // breadcrumbs, subtitles, links
    verified: '#2F6B45',
    verifiedSoft: '#E5EFE4',
    generated: '#8A5A12',
    generatedSoft: '#F4E8D2',
    danger: '#B3261E',
    codeBackground: '#F4E6DF',
    codeText: '#7A2412',
  },
  ink: {
    background: '#15120F',
    rail: '#1B1814',
    surface: '#221E19',
    backgroundElement: '#2A251F',
    backgroundSelected: '#342D25',
    border: '#3A332A',
    text: '#EDE5D8',
    textSecondary: '#B5AA9B',
    textFaint: '#7D7367',
    accent: '#E0957A',
    accentSoft: '#3A2620',
    onAccent: '#15120F',
    slate: '#9DB6CF',
    verified: '#7FC495',
    verifiedSoft: '#22332A',
    generated: '#E2B35F',
    generatedSoft: '#3A2F1C',
    danger: '#EF8A80',
    codeBackground: '#3A2620',
    codeText: '#F0B7A2',
  },
} as const;

export type ThemeMode = keyof typeof Palettes;
export type Palette = { [K in keyof (typeof Palettes)['parchment']]: string };

/** Font family names are the @expo-google-fonts export names, identical on web and native. */
export const Fonts = {
  serif: 'Newsreader_400Regular',
  serifItalic: 'Newsreader_400Regular_Italic',
  serifMedium: 'Newsreader_500Medium',
  serifSemiBold: 'Newsreader_600SemiBold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** The reading column. Long lines tire the eye; the reference keeps cards narrow. */
export const MaxContentWidth = 700;

/** At or above this width the app uses the desktop reader layout (sidebar, peeks, keyboard). */
export const WideBreakpoint = 1000;

/**
 * At or above this width the keyboard panel also fits beside the card: sidebar
 * 268 + side padding 64 + card column 700 + gap 24 + panel 240 = 1296.
 */
export const CodexBreakpoint = 1320;
