import { create } from 'zustand';

type Role = 'THERAPIST' | 'CLIENT' | 'ADMIN';

export interface UserState {
  uid: string | null;
  email: string | null;
  role: Role | null;
  profile: any | null;
  setAuthUser: (uid: string | null, email: string | null) => void;
  setRoleAndProfile: (role: Role | null, profile: any) => void;
  clearAuth: () => void;
}

// The last signed-in user's role and profile, kept so a reload can show the
// page at once instead of waiting for Firebase and /api/users/profile (see
// AuthProvider). Only a UI hint: the backend checks the token on every call,
// and AuthProvider replaces it with the fresh profile moments later.
const CACHE_KEY = 'staad:auth';

export interface CachedAuth {
  uid: string;
  email: string | null;
  role: Role;
  profile: any;
}

export function readCachedAuth(): CachedAuth | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const c = raw ? JSON.parse(raw) : null;
    return c?.uid && (c.role === 'ADMIN' || c.role === 'THERAPIST') ? c : null;
  } catch {
    return null;
  }
}

function writeCachedAuth(c: CachedAuth | null) {
  try {
    if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

export const useAuthStore = create<UserState>((set, get) => ({
  uid: null,
  email: null,
  role: null,
  profile: null,
  setAuthUser: (uid, email) => set({ uid, email }),
  setRoleAndProfile: (role, profile) => {
    set({ role, profile });
    const { uid, email } = get();
    // Guests and clients never get a cached session.
    if (uid && !uid.startsWith('guest:') && (role === 'ADMIN' || role === 'THERAPIST')) writeCachedAuth({ uid, email, role, profile });
    else writeCachedAuth(null);
  },
  clearAuth: () => {
    writeCachedAuth(null);
    set({ uid: null, email: null, role: null, profile: null });
  },
}));
