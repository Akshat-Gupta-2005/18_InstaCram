import { useFocusEffect, usePathname, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ScrollCard } from "@/api/types";
import { useSession } from "@/auth/session";
import { Fonts, Spacing } from "@/constants/theme";
import { Type } from "@/constants/type";
import { useColors, useTheme } from "@/constants/use-colors";
import { Dot, Label } from "@/ui/primitives";

/**
 * The desktop frame from the reference: a sidebar ("curriculum rails") and a top
 * bar with a breadcrumb. Screens describe themselves through useShellInfo; the
 * frame only displays what they report.
 *
 * Everything shown is real. Where the reference has a focus meter and citation
 * percentages, this frame shows the deck position, the saved-card count and the
 * field's generation status instead.
 */
export interface ShellInfo {
  crumbs: string[];
  mode?: "learn" | "revision";
  field?: string;
  deck?: { position: number; total: number; generating: boolean };
  pending?: number;
}

interface ShellState {
  info: ShellInfo;
  setInfo: (info: ShellInfo) => void;
  /** The last field opened, so "Active card deck" can return to it from anywhere. */
  lastField: string | null;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [info, setInfoState] = useState<ShellInfo>({ crumbs: [] });
  const [lastField, setLastField] = useState<string | null>(null);
  const setInfo = useCallback((next: ShellInfo) => {
    setInfoState(next);
    if (next.field) setLastField(next.field);
  }, []);
  const value = useMemo(() => ({ info, setInfo, lastField }), [info, setInfo, lastField]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/**
 * Called by a screen to describe itself to the frame while it is focused. Pass
 * null when a child component reports instead: effects run child-first, so a
 * parent reporting too would overwrite the child's more detailed description.
 */
export function useShellInfo(info: ShellInfo | null) {
  const shell = useContext(ShellContext);
  const key = info === null ? null : JSON.stringify(info);
  useFocusEffect(
    useCallback(() => {
      if (key !== null) shell?.setInfo(JSON.parse(key) as ShellInfo);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );
}

export function ShellFrame({ children }: { children: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.frame, { backgroundColor: c.background }]}>
      <Sidebar />
      <View style={styles.main}>
        <TopBar />
        <View style={styles.content}>{children}</View>
      </View>
    </View>
  );
}

function Sidebar() {
  const c = useColors();
  const router = useRouter();
  const pathname = usePathname();
  const shell = useContext(ShellContext)!;
  const { api } = useSession();
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const { info, lastField } = shell;

  // Refreshed as the user moves between screens, so a card saved in the reader
  // is counted when they look at the sidebar next.
  useEffect(() => {
    let cancelled = false;
    api<{ scrolls: ScrollCard[] }>("/v1/saves")
      .then((r) => !cancelled && setSavedCount(r.scrolls.length))
      .catch(() => !cancelled && setSavedCount(null));
    return () => {
      cancelled = true;
    };
  }, [api, pathname, info.deck?.position]);

  const onFeed = pathname.startsWith("/feed");
  const field = info.field ?? lastField;

  const deckCount = info.deck && onFeed ? `${pad(info.deck.position)}/${pad(info.deck.total)}` : undefined;

  return (
    <View style={[styles.sidebar, { backgroundColor: c.rail, borderRightColor: c.border }]}>
      <Pressable onPress={() => router.push("/")} style={styles.brand}>
        <View style={[styles.brandMark, { borderColor: c.accent }]}>
          <Text style={{ color: c.accent, fontSize: 11, fontFamily: Fonts.sansSemiBold }}>≡</Text>
        </View>
        <Text style={[styles.brandText, { color: c.accent }]}>InstaCram</Text>
      </Pressable>

      <Label tone="muted" style={styles.railHeading}>Curriculum rails</Label>

      <RailItem
        label="Active card deck"
        count={deckCount}
        active={onFeed && info.mode !== "revision"}
        big
        disabled={!field}
        onPress={() => field && router.push({ pathname: "/feed/[field]", params: { field } })}
      />
      <RailItem label="Fields" active={pathname === "/"} onPress={() => router.push("/")} />
      <RailItem
        label="Saved cards"
        count={savedCount === null ? undefined : String(savedCount)}
        active={pathname === "/saved"}
        onPress={() => router.push("/saved")}
      />
      <RailItem
        label="Revision"
        active={onFeed && info.mode === "revision"}
        disabled={!field}
        onPress={() => field && router.push({ pathname: "/feed/[field]", params: { field, mode: "revision" } })}
      />

      <View style={styles.flex} />

      <View style={[styles.statusBox, { backgroundColor: c.background, borderColor: c.border }]}>
        <View style={styles.statusHead}>
          <Label tone="muted">Generation</Label>
          {field && info.pending !== undefined && (
            <Dot color={info.pending > 0 ? c.generated : c.verified} />
          )}
        </View>
        <Text style={[Type.italic, { color: c.textSecondary, fontSize: 14.5, lineHeight: 21 }]}>
          {!field
            ? "Pick a field to begin."
            : info.pending === undefined
              ? field
              : info.pending > 0
                ? `${info.pending} topic${info.pending === 1 ? "" : "s"} being written for ${field}.`
                : `${field} is up to date.`}
        </Text>
      </View>
    </View>
  );
}

function RailItem({
  label,
  count,
  active,
  big,
  disabled,
  onPress,
}: {
  label: string;
  count?: string;
  active?: boolean;
  big?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ hovered }: { hovered?: boolean }) => [
        styles.railItem,
        { backgroundColor: active ? c.backgroundSelected : hovered ? c.backgroundElement : "transparent", opacity: disabled ? 0.45 : 1 },
      ]}>
      <Text
        style={
          big
            ? [styles.railBig, { color: active ? c.accent : c.text }]
            : [Type.labelStrong, { color: active ? c.accent : c.text, fontSize: 12, flexShrink: 1 }]
        }>
        {label}
      </Text>
      {count !== undefined && <Text style={[Type.mono, { color: c.textSecondary }]}>{count}</Text>}
    </Pressable>
  );
}

function TopBar() {
  const c = useColors();
  const { mode, toggle } = useTheme();
  const { signOut } = useSession();
  const { info } = useContext(ShellContext)!;
  const [menu, setMenu] = useState(false);

  return (
    <View style={[styles.topBar, { backgroundColor: c.background, borderBottomColor: c.border }]}>
      <View style={styles.crumbs}>
        {info.crumbs.map((crumb, i) => (
          <View key={`${i}:${crumb}`} style={styles.crumbs}>
            {i > 0 && <Text style={[Type.label, { color: c.textFaint }]}>/</Text>}
            <Label tone={i === info.crumbs.length - 1 && info.crumbs.length > 1 ? "accent" : "slate"} strong>
              {crumb}
            </Label>
          </View>
        ))}
      </View>

      <View style={styles.topActions}>
        {info.mode && (
          <View style={[styles.pill, { backgroundColor: c.backgroundElement }]}>
            <Dot color={info.mode === "learn" ? c.verified : c.slate} />
            <Label tone="text">{info.mode === "learn" ? "Learn mode" : "Revision mode"}</Label>
          </View>
        )}
        <Pressable
          onPress={toggle}
          accessibilityLabel={`Switch to ${mode === "parchment" ? "ink" : "parchment"} theme`}
          style={({ pressed }) => [styles.pill, { backgroundColor: c.backgroundElement, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={{ color: c.textSecondary, fontSize: 12 }}>{mode === "parchment" ? "▤" : "◐"}</Text>
          <Label tone="text">{mode === "parchment" ? "Parchment" : "Ink"}</Label>
        </Pressable>
        <View>
          <Pressable
            onPress={() => setMenu((m) => !m)}
            accessibilityLabel="Account"
            style={[styles.avatar, { backgroundColor: c.accent }]}>
            <Text style={{ color: c.onAccent, fontSize: 15 }}>◉</Text>
          </Pressable>
          {menu && (
            <View style={[styles.menu, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[Type.ui, { color: c.textSecondary, fontSize: 12 }]}>Signed in as developer</Text>
              <Pressable onPress={() => void signOut()} style={styles.menuItem}>
                <Label tone="accent" strong>Sign out</Label>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row" },
  main: { flex: 1 },
  content: { flex: 1 },
  flex: { flex: 1 },
  sidebar: { width: 268, borderRightWidth: 1, paddingHorizontal: Spacing.three, paddingVertical: Spacing.four, gap: 4 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, marginBottom: Spacing.five },
  brandMark: { width: 22, height: 20, borderWidth: 1.5, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  brandText: { fontFamily: Fonts.serifSemiBold, fontSize: 24 },
  railHeading: { paddingHorizontal: 8, marginBottom: Spacing.two },
  railItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.two,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 3,
  },
  railBig: { fontFamily: Fonts.serifMedium, fontSize: 19, letterSpacing: 1.2, textTransform: "uppercase", flexShrink: 1 },
  statusBox: { borderWidth: 1, borderRadius: 4, padding: Spacing.three, gap: Spacing.two },
  statusHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  topBar: {
    height: 68,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.five,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  crumbs: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  topActions: { flexDirection: "row", alignItems: "center", gap: Spacing.three },
  pill: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 3 },
  avatar: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  menu: {
    position: "absolute",
    top: 44,
    right: 0,
    minWidth: 190,
    borderWidth: 1,
    borderRadius: 6,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  menuItem: { paddingVertical: 4 },
});
