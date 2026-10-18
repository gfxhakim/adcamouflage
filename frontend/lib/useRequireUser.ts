"use client";

import { useEffect, useRef, useState } from "react";

import { fetchMe, signOut, type UserProfile } from "@/lib/auth";

/**
 * Loads the signed-in user for an /app page. The middleware has already gated
 * the route on the session cookie being present; if the API rejects it
 * (expired, or signed with an old secret) we clear it and go back to the
 * landing page to sign in again. Returns null while loading or signed out.
 */
export function useRequireUser(): UserProfile | null {
  const [user, setUser] = useState<UserProfile | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    fetchMe()
      .then((profile) => {
        if (cancelled || !mountedRef.current) return;
        if (!profile) {
          void signOut()
            .catch(() => undefined)
            .finally(() => window.location.assign("/"));
          return;
        }
        setUser(profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  return user;
}

export default useRequireUser;
