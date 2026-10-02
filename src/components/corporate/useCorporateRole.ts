"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CORPORATE_MOCK_USERS,
  MOCK_ROLE_STORAGE_KEY,
  isCorporateRole,
  mockUserForRole,
  type CorporateRole,
  type CorporateUser,
} from "@/core/types/corporate";

export const MOCK_ROLE_EVENT = "cum:mock-role-change";

/** Baca role mock dari localStorage (default Super Admin agar semua menu terlihat). */
export function readMockRole(): CorporateRole {
  if (typeof window === "undefined") return "Super Admin";
  try {
    const raw = window.localStorage.getItem(MOCK_ROLE_STORAGE_KEY);
    if (isCorporateRole(raw)) return raw;
  } catch {
    // abaikan
  }
  return "Super Admin";
}

export function useCorporateRole() {
  const [role, setRole] = useState<CorporateRole>(() => readMockRole());
  const [user, setUser] = useState<CorporateUser>(() => mockUserForRole(readMockRole()));

  useEffect(() => {
    const sync = () => {
      const next = readMockRole();
      setRole(next);
      setUser(mockUserForRole(next));
    };
    window.addEventListener(MOCK_ROLE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(MOCK_ROLE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const switchRole = useCallback((next: CorporateRole) => {
    try {
      window.localStorage.setItem(MOCK_ROLE_STORAGE_KEY, next);
    } catch {
      // abaikan
    }
    setRole(next);
    setUser(mockUserForRole(next));
    window.dispatchEvent(new Event(MOCK_ROLE_EVENT));
  }, []);

  const mockUsers = CORPORATE_MOCK_USERS;

  return { role, user, mockUsers, switchRole };
}
