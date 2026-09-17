/**
 * Where the session token is kept on iOS and Android: the platform keychain /
 * keystore, via expo-secure-store. The web build uses storage.web.ts instead,
 * because SecureStore does not exist on web; Metro picks the file by platform.
 */
import * as SecureStore from "expo-secure-store";

const KEY = "instacram.session";

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // An unreadable keychain entry is treated as signed out, not as a crash.
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
