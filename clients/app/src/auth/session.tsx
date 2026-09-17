/**
 * Who is signed in, and the one authenticated request function screens use.
 *
 * Today there is one way in: the developer ID + password (AUTH_MODE=dev-login on
 * the server), exchanged for a token. Google sign-in arrives through Firebase, and
 * is meant to slot in as a second `signInWith...` method that also ends by
 * calling `adopt(token)`. Nothing else here - storage, the 401 handling, `api` -
 * cares where the token came from.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { ApiError, request, type RequestOptions } from "@/api/client";
import type { LoginResponse } from "@/api/types";
import { clearToken, loadToken, saveToken } from "@/auth/storage";

type Status = "loading" | "signedOut" | "signedIn";

interface Session {
  status: Status;
  signInWithDevLogin: (id: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** An authenticated request. A rejected token signs the user out. */
  api: <T>(path: string, opts?: Omit<RequestOptions, "token">) => Promise<T>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadToken().then((stored) => {
      if (cancelled) return;
      setToken(stored);
      setStatus(stored ? "signedIn" : "signedOut");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback(async (next: string) => {
    await saveToken(next);
    setToken(next);
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setToken(null);
    setStatus("signedOut");
  }, []);

  const signInWithDevLogin = useCallback(
    async (id: string, password: string) => {
      const res = await request<LoginResponse>("/v1/auth/login", {
        method: "POST",
        body: { id, password },
      });
      await adopt(res.token);
    },
    [adopt],
  );

  const api = useCallback(
    async <T,>(path: string, opts: Omit<RequestOptions, "token"> = {}) => {
      try {
        return await request<T>(path, { ...opts, token });
      } catch (err) {
        // An expired or refused token cannot be fixed by retrying. Signing out
        // sends the user back to the login screen instead of leaving every screen
        // failing silently.
        if (err instanceof ApiError && err.status === 401) await signOut();
        throw err;
      }
    },
    [token, signOut],
  );

  const value = useMemo(
    () => ({ status, signInWithDevLogin, signOut, api }),
    [status, signInWithDevLogin, signOut, api],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}
