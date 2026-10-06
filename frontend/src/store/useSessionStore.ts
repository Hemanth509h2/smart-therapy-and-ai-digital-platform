import { create } from 'zustand';

interface SessionStore {
  activeSessionId: string | null;
  activeModuleId: string | null;
  isTherapistControl: boolean;
  therapistObserverMode: boolean;
  
  setActiveSessionId: (sessionId: string | null) => void;
  setActiveModuleId: (moduleId: string | null) => void;
  setTherapistControl: (control: boolean) => void;
  setObserverMode: (observe: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  activeSessionId: null,
  activeModuleId: null,
  isTherapistControl: true,
  therapistObserverMode: false,

  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  setActiveModuleId: (moduleId) => set({ activeModuleId: moduleId }),
  setTherapistControl: (control) => set({ isTherapistControl: control }),
  setObserverMode: (observe) => set({ therapistObserverMode: observe }),
}));
