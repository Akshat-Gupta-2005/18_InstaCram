# InstaCram app

One Expo codebase for the **website, iOS and Android** (Expo SDK 57, Expo Router). Decided 2026-09-17 — see `Docs/DECISIONS.md`.

## Run it

The backend has to be running first, from the repo root:

```bash
docker compose up -d          # Postgres, Qdrant, embeddings, LLM gateway, serving, pipeline
ollama serve                  # if it isn't already running - generation needs it
```

Then, in `clients/app`:

```bash
npm install
npm run web                   # website at http://localhost:8082
npm run android               # Android (emulator or Expo Go on a phone)
npm run ios                   # iOS - needs macOS, or Expo Go on an iPhone
```

**Port 8082, not Expo's usual 8081** — the embeddings service already holds 8081.

## Sign in

A **developer login** for now: the ID and password are `DEV_LOGIN_ID` and `DEV_LOGIN_PASSWORD` in the repo-root `.env`, and the server runs with `AUTH_MODE=dev-login`. The server checks them and issues a signed token; guessing or editing a token does not work.

Google sign-in is planned through Firebase Auth. It will be a second way to get a token, verified in the same place on the server, so the screens and API calls here do not change.

## Pointing the app at the API

The app calls `http://localhost:3000` by default, which works for the website and the iOS simulator. Anywhere else, create `clients/app/.env.local`:

```bash
# Android emulator - the emulator's name for your computer
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000

# A physical phone on the same Wi-Fi - your computer's LAN IP
EXPO_PUBLIC_API_URL=http://192.168.1.20:3000
```

`EXPO_PUBLIC_` values are compiled into the app and readable by anyone who has it, so they hold addresses, never secrets. Restart the dev server after changing it.

## Where things are

```
src/app/                 routes (Expo Router)
  _layout.tsx            session gate: signed-out users only see /login
  login.tsx              developer login
  (app)/index.tsx        "What do you want to learn?"
  (app)/feed/[field].tsx the feed - one card per swipe
  (app)/saved.tsx        saved cards
src/api/                 the one request function + types mirroring Docs/API-CONTRACT.md
src/auth/                session state; token in the keychain (native) or localStorage (web)
src/feed/use-feed.ts     paging, polling, view logging - read its header before changing it
src/feed/card.tsx        a card: source link, trust label, why it matters, recall, save
src/feed/footer.tsx      the last page: waiting state, or the end-of-field card
```

## Two rules the feed must keep

From `Docs/API-CONTRACT.md` §1 — both corrupt data silently if broken:

1. **Log a view when a card is displayed, never when it is fetched.** The app prefetches, so it holds cards it has not shown. `use-feed.ts` records a view only once a card has been mostly on screen for 600 ms.
2. **Poll at the server's cadence** — `retry_after_ms`, not a hardcoded interval.
