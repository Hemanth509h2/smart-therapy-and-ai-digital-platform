import { create } from 'zustand';

export interface UserState {
  uid: string | null;
  email: string | null;
  role: 'THERAPIST' | 'CLIENT' | 'ADMIN' | null;
  profile: any | null;
  setAuthUser: (uid: string | null, email: string | null) => void;
  setRoleAndProfile: (role: 'THERAPIST' | 'CLIENT' | 'ADMIN' | null, profile: any) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<UserState>((set) => ({
  uid: null,
  email: null,
  role: null,
  profile: null,
  setAuthUser: (uid, email) => set({ uid, email }),
  setRoleAndProfile: (role, profile) => set({ role, profile }),
  clearAuth: () => set({ uid: null, email: null, role: null, profile: null }),
}));
