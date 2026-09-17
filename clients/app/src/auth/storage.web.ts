/**
 * Where the session token is kept in the browser: localStorage.
 *
 * Weaker than the native keychain - any script running on the page can read it.
 * Acceptable for the developer login on a local machine. Real sign-in (Firebase)
 * manages its own browser persistence, and this file goes away with it.
 *
 * Every access is guarded: storage can be unavailable (private windows, blocked
 * site data), and that must read as "signed out", not crash the app.
 */
const KEY = "instacram.session";

export async function loadToken(): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(KEY, token);
  } catch {
    // Signed in for this page load only.
  }
}

export async function clearToken(): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // Nothing stored, or nothing reachable - either way, nothing to clear.
  }
}
