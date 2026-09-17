/**
 * Small non-secret preferences (the theme) on iOS and Android. SecureStore is the
 * one persistent store already in the app; a theme name is not sensitive, but a
 * second storage dependency for one string would be. The web build uses
 * prefs.web.ts.
 */
import * as SecureStore from "expo-secure-store";

export async function loadPref(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(`instacram.pref.${key}`);
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(`instacram.pref.${key}`, value);
  } catch {
    // A preference that fails to save is simply not remembered.
  }
}
