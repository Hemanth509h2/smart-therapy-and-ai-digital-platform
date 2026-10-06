'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { updateModuleState, subscribeToModuleState } from '@/services/sessionSync';
import { logModuleEvent } from '@/lib/sessionEvents';
import { staadSpeak, staadCancel } from '@/lib/voice/staadVoice';

interface CalcState {
  display: string;
  speech: string;
}

interface TalkingCalculatorModuleProps {
  sessionId: string;
  role: 'therapist' | 'client';
  isLocked: boolean;
}

export default function TalkingCalculatorModule({ sessionId, isLocked }: TalkingCalculatorModuleProps) {
  const { uid } = useAuthStore();
  const [state, setState] = useState<CalcState>({ display: '', speech: 'Hello' });
  const isInteractive = !isLocked;

  useEffect(() => {
    const unsubscribe = subscribeToModuleState(sessionId, 'talking_calculator', (syncedState) => {
      if (syncedState) {
        setState(syncedState);
      }
    });
    return () => unsubscribe();
  }, [sessionId]);

  const handlePress = (val: string) => {
    if (!isInteractive) return;

    let nextDisplay = state.display;
    let nextSpeech = '';

    if (val === 'C') {
      nextDisplay = '';
      nextSpeech = 'Cleared';
    } else if (val === '=') {
      try {
        const evalResult = eval(state.display);
        nextDisplay = String(evalResult);
        nextSpeech = `Equals ${evalResult}`;
        logModuleEvent(sessionId, {
          module: 'talking_calculator',
          type: 'calculation',
          detail: `Worked out ${state.display} = ${evalResult}`,
        });
      } catch (err) {
        nextDisplay = 'Error';
        nextSpeech = 'Try again';
      }
    } else {
      nextDisplay += val;
      nextSpeech = val;
    }

    const nextState = { display: nextDisplay, speech: nextSpeech };
    setState(nextState);
    updateModuleState(sessionId, 'talking_calculator', nextState, uid || 'anonymous');

    // Synthesis speech browser compatibility support
    // Numbers and operators are read out in English.
    staadCancel();
    staadSpeak({ text: nextSpeech, language: 'en-IN', type: 'feedback' });
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-border/60 shadow-sm max-w-sm mx-auto">
      <div className="text-center mb-6">
        <h3 className="text-2xl font-heading text-primary">Talking Calculator</h3>
        <p className="text-xs text-muted-foreground mt-1 font-medium">Hear the numbers and calculations spoken aloud</p>
      </div>

      <div className="w-full bg-secondary/30 border border-border/40 rounded-2xl p-4 mb-4 text-right">
        <div className="text-sm text-[#4e684e] font-semibold min-h-[20px]">{state.speech}</div>
        <div className="text-3xl font-bold text-primary tracking-tight mt-1 overflow-x-auto min-h-[40px]">
          {state.display || '0'}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 w-full">
        {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', 'C', '0', '=', '+'].map((btn) => (
          <button
            key={btn}
            onClick={() => handlePress(btn)}
            disabled={!isInteractive}
            className={`h-14 rounded-xl font-bold text-lg flex items-center justify-center transition-all ${
              btn === 'C' 
                ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                : btn === '=' 
                ? 'bg-primary text-white hover:bg-primary/90 shadow-md'
                : ['/', '*', '-', '+'].includes(btn)
                ? 'bg-[#eaeaea] text-primary hover:bg-slate-200'
                : 'bg-[#f8fcf8] text-primary border border-border/60 hover:bg-muted/30'
            }`}
          >
            {btn}
          </button>
        ))}
      </div>
    </div>
  );
}
