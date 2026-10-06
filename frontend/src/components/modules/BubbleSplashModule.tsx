'use client';

// RETIRED — not registered, not routed, not reachable.
//
// This 8-bubble click-to-pop activity was registered in the SLD category under
// the slug `bubble_splash` while carrying an SLD description ("Sight words ·
// reading fluency"). That routing meant launching "Bubble Splash" from the SLD
// category rendered THIS calming toy instead of the real 851-line sight-words
// module in sld/BubbleSplash.tsx, which was unreachable from any UI.
//
// It was not re-registered under Anxiety & Depression because Box Popping's
// Bubble Wrap mode already covers the same ground and does it far better:
// 48-120 drag-to-pop cells vs 8 click targets, pop animation and particles,
// progress milestones, intensity settings and an end-of-activity mood check-in.
// Adding this alongside it would have given therapists two near-identical
// calming activities, one clearly worse.
//
// Kept rather than deleted so the interaction can be revisited if a genuinely
// distinct use emerges. Note it also predates the current design system (light
// Tailwind card, not the dark glass panel) and writes to the legacy
// moduleStates/{sessionId}_{moduleId} collection rather than liveSessions.

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { updateModuleState, subscribeToModuleState } from '@/services/sessionSync';
import { logModuleEvent } from '@/lib/sessionEvents';

interface Bubble {
  id: number;
  x: number;
  y: number;
  popped: boolean;
  color: string;
}

interface BubbleSplashModuleProps {
  sessionId: string;
  role: 'therapist' | 'client';
  isLocked: boolean;
}

export default function BubbleSplashModule({ sessionId, role, isLocked }: BubbleSplashModuleProps) {
  const { uid } = useAuthStore();
  const isTherapist = role === 'therapist';
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const isInteractive = !isLocked;

  // Log when every bubble has been popped (therapist browser only).
  const loggedDoneRef = useRef(false);
  useEffect(() => {
    const allPopped = bubbles.length > 0 && bubbles.every(b => b.popped);
    if (allPopped && isTherapist && !loggedDoneRef.current) {
      loggedDoneRef.current = true;
      logModuleEvent(sessionId, {
        module: 'bubble_splash',
        type: 'completed',
        detail: `Popped all ${bubbles.length} bubbles in Bubble Splash (calming / anxiety relief)`,
      });
    }
    if (!allPopped) loggedDoneRef.current = false;
  }, [bubbles, isTherapist, sessionId]);

  useEffect(() => {
    // Generate initial bubbles if none synced
    const initialBubbles: Bubble[] = Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      x: 15 + (i % 4) * 22,
      y: 20 + Math.floor(i / 4) * 40,
      popped: false,
      color: ['#a8dadc', '#457b9d', '#e9c46a', '#e76f51', '#f4a261', '#2a9d8f'][i % 6]
    }));
    setBubbles(initialBubbles);

    const unsubscribe = subscribeToModuleState(sessionId, 'bubble_splash', (syncedState) => {
      if (syncedState && syncedState.bubbles) {
        setBubbles(syncedState.bubbles);
      }
    });

    return () => unsubscribe();
  }, [sessionId]);

  const handlePop = (id: number) => {
    if (!isInteractive) return;

    const nextBubbles = bubbles.map((b) => (b.id === id ? { ...b, popped: true } : b));
    setBubbles(nextBubbles);
    updateModuleState(sessionId, 'bubble_splash', { bubbles: nextBubbles }, uid || 'anonymous');
  };

  const handleReset = () => {
    if (!isInteractive) return;
    
    const resetBubbles = bubbles.map((b) => ({ ...b, popped: false }));
    setBubbles(resetBubbles);
    updateModuleState(sessionId, 'bubble_splash', { bubbles: resetBubbles }, uid || 'anonymous');
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-border/60 shadow-sm max-w-md mx-auto">
      <div className="text-center mb-6">
        <h3 className="text-2xl font-heading text-primary">Bubble Splash</h3>
        <p className="text-xs text-muted-foreground mt-1 font-medium">Pop the colourful bubbles together to relieve anxiety</p>
      </div>

      <div className="relative w-80 h-80 bg-secondary/20 rounded-2xl border border-border/40 overflow-hidden">
        {bubbles.map((bubble) => (
          <button
            key={bubble.id}
            onClick={() => handlePop(bubble.id)}
            disabled={bubble.popped || !isInteractive}
            className={`absolute w-16 h-16 rounded-full flex items-center justify-center transition-all ${
              bubble.popped 
                ? 'scale-75 opacity-10 bg-transparent border-dashed border border-muted' 
                : 'hover:scale-105 active:scale-95 shadow-md border border-white/20'
            }`}
            style={{
              left: `${bubble.x}%`,
              top: `${bubble.y}%`,
              backgroundColor: bubble.popped ? 'transparent' : bubble.color,
            }}
          >
            {!bubble.popped && <span className="text-white text-lg font-bold">✨</span>}
          </button>
        ))}
      </div>

      <div className="mt-6">
        <button
          onClick={handleReset}
          disabled={!isInteractive}
          className="px-6 py-2.5 bg-primary text-primary-foreground hover:bg-primary/95 text-sm font-semibold rounded-xl transition-all shadow-sm disabled:opacity-50"
        >
          Reset Bubbles
        </button>
      </div>
    </div>
  );
}
