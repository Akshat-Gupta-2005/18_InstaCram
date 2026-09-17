/**
 * Where the serving API lives.
 *
 * EXPO_PUBLIC_ variables are inlined into the bundle at build time and are
 * visible to anyone who has the app, so this holds an address, never a secret.
 * It must be read with dot notation - `process.env.EXPO_PUBLIC_API_URL` - or Expo
 * does not inline it.
 *
 * The default suits the web build and the iOS simulator on the same machine. Set
 * EXPO_PUBLIC_API_URL in clients/app/.env.local for anything else:
 *   Android emulator   http://10.0.2.2:3000   (the emulator's name for the host)
 *   a physical phone   http://<this computer's LAN IP>:3000
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Cards per page; the server caps it at 30. */
export const PAGE_SIZE = 10;

/** Ask for the next page when this many unseen cards remain in hand (BUILD-PLAN §3). */
export const PREFETCH_REMAINING = 3;
