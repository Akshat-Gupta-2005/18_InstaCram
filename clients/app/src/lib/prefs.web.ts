/** Small non-secret preferences in the browser. Guarded: storage can be unavailable. */
export async function loadPref(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(`instacram.pref.${key}`) ?? null;
  } catch {
    return null;
  }
}

export async function savePref(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(`instacram.pref.${key}`, value);
  } catch {
    // Not remembered; the app still works.
  }
}
