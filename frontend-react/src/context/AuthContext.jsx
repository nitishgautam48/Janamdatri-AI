import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  clearSession,
  getSavedUser,
  getToken,
  isGuest,
  setGuest as persistGuest,
  setSession,
} from "../lib/storage";

const AuthContext = createContext(null);

// One identity slot at a time: logged-in user, guest, or neither (the
// welcome gate). Switching identities is the one moment every screen's
// per-identity localStorage needs a fresh read - each page effect keys
// off `identityKey` (see useAuth) rather than caching state across a
// login/logout/guest transition.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => (getToken() ? getSavedUser() : null));
  const [guest, setGuestState] = useState(() => !getToken() && isGuest());
  const [identityKey, setIdentityKey] = useState(0);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setSession(data.token, data.user);
    setUser(data.user);
    setGuestState(false);
    setIdentityKey((k) => k + 1);
  }, []);

  const register = useCallback(async (email, password, name) => {
    const data = await api.register(email, password, name);
    setSession(data.token, data.user);
    setUser(data.user);
    setGuestState(false);
    setIdentityKey((k) => k + 1);
  }, []);

  const continueAsGuest = useCallback(() => {
    persistGuest();
    setGuestState(true);
    setIdentityKey((k) => k + 1);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    setGuestState(false);
    setIdentityKey((k) => k + 1);
  }, []);

  // api.js dispatches this the moment any authenticated call comes back
  // 401 with a token still set - it has already cleared localStorage, so
  // this just brings React state in line so the whole app re-renders as
  // logged-out instead of staying stuck showing a "logged in" UI that no
  // longer has a working session behind it.
  useEffect(() => {
    function onExpired() {
      setUser(null);
      setGuestState(false);
      setIdentityKey((k) => k + 1);
    }
    window.addEventListener("auth:expired", onExpired);
    return () => window.removeEventListener("auth:expired", onExpired);
  }, []);

  const value = {
    user,
    guest,
    isAuthed: !!user,
    hasIdentity: !!user || guest,
    identityKey,
    login,
    register,
    continueAsGuest,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
