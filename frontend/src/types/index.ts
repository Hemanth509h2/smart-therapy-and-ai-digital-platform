export interface TherapyModule {
  id: string;
  name: string;
  init(sendStateUpdate: (state: any) => void): void;
  onInput(data: any): void;
  getState(): any;
  setState(state: any): void;
  destroy(): void;
}

export interface Participant {
  uid: string;
  name: string;
  role: 'therapist' | 'client';
  isOnline: boolean;
}

export interface SessionState {
  sessionId: string;
  activeModuleId: string | null;
  participants: Record<string, Participant>;
  currentState: any;
  timestamps: {
    createdAt: any;
    updatedAt: any;
  };
}
