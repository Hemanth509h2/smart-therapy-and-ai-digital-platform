'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { updateModuleState, subscribeToModuleState } from '@/services/sessionSync';
import { logModuleEvent } from '@/lib/sessionEvents';

interface MemoryCard {
  id: number;
  value: string;
  isFlipped: boolean;
  isMatched: boolean;
}

interface MemoryMatchModuleProps {
  sessionId: string;
  role: 'therapist' | 'client';
  isLocked: boolean;
}

export default function MemoryMatchModule({ sessionId, role, isLocked }: MemoryMatchModuleProps) {
  const { uid } = useAuthStore();
  const isTherapist = role === 'therapist';

  const [cards, setCards] = useState<MemoryCard[]>([]);
  const isInteractive = !isLocked;

  // Log the win once when every pair is matched (therapist browser only, so the
  // synced client doesn't double-log).
  const loggedWinRef = useRef(false);
  useEffect(() => {
    const allMatched = cards.length > 0 && cards.every(c => c.isMatched);
    if (allMatched && isTherapist && !loggedWinRef.current) {
      loggedWinRef.current = true;
      logModuleEvent(sessionId, {
        module: 'memory_match',
        type: 'completed',
        detail: `Matched all ${cards.length / 2} pairs in Memory Match (working memory)`,
      });
    }
    if (!allMatched) loggedWinRef.current = false;
  }, [cards, isTherapist, sessionId]);

  // Initialize cards
  useEffect(() => {
    const emojis = ['🦋', '🌻', '🐢', '🌈', '🎈', '⭐'];
    const initialCards: MemoryCard[] = [...emojis, ...emojis]
      .sort(() => Math.random() - 0.5)
      .map((val, i) => ({ id: i, value: val, isFlipped: false, isMatched: false }));
      
    setCards(initialCards);

    const unsubscribe = subscribeToModuleState(sessionId, 'memory_match', (syncedState) => {
      if (syncedState && syncedState.cards) {
        setCards(syncedState.cards);
      }
    });

    return () => unsubscribe();
  }, [sessionId]);

  const handleCardClick = (id: number) => {
    if (!isInteractive) return;

    const clickedCard = cards.find(c => c.id === id);
    if (!clickedCard || clickedCard.isFlipped || clickedCard.isMatched) return;

    const flippedCards = cards.filter(c => c.isFlipped && !c.isMatched);
    
    if (flippedCards.length === 2) return; // Prevent flipping more than 2

    const nextCards = cards.map(c => c.id === id ? { ...c, isFlipped: true } : c);
    setCards(nextCards);
    updateModuleState(sessionId, 'memory_match', { cards: nextCards }, uid || 'anonymous');

    const currentlyFlipped = nextCards.filter(c => c.isFlipped && !c.isMatched);
    
    if (currentlyFlipped.length === 2) {
      setTimeout(() => {
        const match = currentlyFlipped[0].value === currentlyFlipped[1].value;
        const evaluatedCards = nextCards.map(c => {
          if (c.id === currentlyFlipped[0].id || c.id === currentlyFlipped[1].id) {
            return { ...c, isMatched: match, isFlipped: match };
          }
          return c;
        });
        
        setCards(evaluatedCards);
        updateModuleState(sessionId, 'memory_match', { cards: evaluatedCards }, uid || 'anonymous');
      }, 1000);
    }
  };

  const handleReset = () => {
    if (!isInteractive) return;
    const emojis = ['🦋', '🌻', '🐢', '🌈', '🎈', '⭐'];
    const resetCards: MemoryCard[] = [...emojis, ...emojis]
      .sort(() => Math.random() - 0.5)
      .map((val, i) => ({ id: i, value: val, isFlipped: false, isMatched: false }));
    
    setCards(resetCards);
    updateModuleState(sessionId, 'memory_match', { cards: resetCards }, uid || 'anonymous');
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-border/60 shadow-sm max-w-md mx-auto">
      <div className="text-center mb-6">
        <h3 className="text-2xl font-heading text-primary">Memory Match</h3>
        <p className="text-xs text-muted-foreground mt-1 font-medium">Find the matching pairs to train working memory</p>
      </div>

      <div className="grid grid-cols-4 gap-3 bg-secondary/30 p-4 rounded-2xl border border-border/40">
        {cards.map(card => (
          <button
            key={card.id}
            onClick={() => handleCardClick(card.id)}
            disabled={!isInteractive}
            className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl transition-all duration-300 ${
              card.isFlipped || card.isMatched
                ? 'bg-white shadow-md border border-border/40 scale-100 rotate-y-180'
                : 'bg-primary/80 hover:bg-primary shadow-sm border border-transparent scale-95'
            }`}
          >
            <span className={card.isFlipped || card.isMatched ? 'opacity-100' : 'opacity-0'}>
              {card.value}
            </span>
          </button>
        ))}
      </div>

      {cards.every(c => c.isMatched) && cards.length > 0 && (
        <div className="mt-4 text-center text-[#4e684e] font-bold text-lg animate-bounce">
          🎉 All matched! Great job!
        </div>
      )}

      <button
        onClick={handleReset}
        disabled={!isInteractive}
        className="mt-6 px-6 py-2.5 bg-primary/10 text-primary hover:bg-primary hover:text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-50"
      >
        Shuffle & Reset
      </button>
    </div>
  );
}
