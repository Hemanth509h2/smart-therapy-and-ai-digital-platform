'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { updateModuleState, subscribeToModuleState } from '@/services/sessionSync';
import { logModuleEvent } from '@/lib/sessionEvents';

interface MazeState {
  playerPos: { x: number; y: number };
  goalPos: { x: number; y: number };
  completed: boolean;
}

interface MazeModuleProps {
  sessionId: string;
  role: 'therapist' | 'client';
  isLocked: boolean;
}

export default function MazeModule({ sessionId, role, isLocked }: MazeModuleProps) {
  const { uid } = useAuthStore();
  const isTherapist = role === 'therapist';
  const [maze, setMaze] = useState<number[][]>([
    [0, 0, 1, 0, 0],
    [1, 0, 1, 0, 1],
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 1, 0],
  ]);

  const [state, setState] = useState<MazeState>({
    playerPos: { x: 0, y: 0 },
    goalPos: { x: 4, y: 4 },
    completed: false
  });

  const isInteractive = !isLocked;

  useEffect(() => {
    const unsubscribe = subscribeToModuleState(sessionId, 'maze', (syncedState) => {
      if (syncedState) {
        setState(syncedState);
      }
    });
    return () => unsubscribe();
  }, [sessionId]);

  // Log reaching the goal once (therapist browser only).
  const loggedDoneRef = useRef(false);
  useEffect(() => {
    if (state.completed && isTherapist && !loggedDoneRef.current) {
      loggedDoneRef.current = true;
      logModuleEvent(sessionId, {
        module: 'maze',
        type: 'maze_solved',
        detail: 'Reached the goal in the Maze activity (sustained attention · motor planning)',
      });
    }
    if (!state.completed) loggedDoneRef.current = false;
  }, [state.completed, isTherapist, sessionId]);

  const movePlayer = (dx: number, dy: number) => {
    if (!isInteractive || state.completed) return;

    const newX = state.playerPos.x + dx;
    const newY = state.playerPos.y + dy;

    // Check boundaries and wall hits (1 is wall)
    if (newX >= 0 && newX < 5 && newY >= 0 && newY < 5 && maze[newY][newX] === 0) {
      const isGoal = newX === state.goalPos.x && newY === state.goalPos.y;
      const nextState = {
        playerPos: { x: newX, y: newY },
        goalPos: state.goalPos,
        completed: isGoal
      };
      
      setState(nextState);
      updateModuleState(sessionId, 'maze', nextState, uid || 'anonymous');
    }
  };

  const handleReset = () => {
    if (!isInteractive) return;
    const resetState = {
      playerPos: { x: 0, y: 0 },
      goalPos: { x: 4, y: 4 },
      completed: false
    };
    setState(resetState);
    updateModuleState(sessionId, 'maze', resetState, uid || 'anonymous');
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-border/60 shadow-sm max-w-md mx-auto">
      <div className="text-center mb-6">
        <h3 className="text-2xl font-heading text-primary">Calming Maze</h3>
        <p className="text-xs text-muted-foreground mt-1 font-medium">Navigate with arrow buttons or touch directions to the end</p>
      </div>

      <div className="grid grid-cols-5 gap-1.5 p-2 bg-secondary/30 rounded-2xl border border-border/40">
        {maze.map((row, y) =>
          row.map((cell, x) => {
            const isPlayer = state.playerPos.x === x && state.playerPos.y === y;
            const isGoal = state.goalPos.x === x && state.goalPos.y === y;
            return (
              <div
                key={`${y}-${x}`}
                className={`w-14 h-14 rounded-xl flex items-center justify-center transition-all ${
                  cell === 1 
                    ? 'bg-[#4e684e] shadow-inner' 
                    : isPlayer 
                    ? 'bg-primary text-white scale-95 shadow-md font-bold'
                    : isGoal
                    ? 'bg-yellow-400 text-yellow-900 font-bold scale-95 animate-pulse'
                    : 'bg-white border border-border/30'
                }`}
              >
                {isPlayer ? '🐣' : isGoal ? '🌟' : ''}
              </div>
            );
          })
        )}
      </div>

      {state.completed && (
        <div className="mt-4 text-center text-[#4e684e] font-bold text-lg animate-bounce">
          🎉 Wonderful Job! You reached the goal!
        </div>
      )}

      {/* Control Buttons */}
      <div className="mt-6 flex flex-col items-center gap-2">
        <button 
          onClick={() => movePlayer(0, -1)}
          disabled={!isInteractive}
          className="w-12 h-12 bg-secondary text-primary font-bold hover:bg-primary hover:text-white rounded-xl transition-all disabled:opacity-50"
        >
          ▲
        </button>
        <div className="flex gap-2">
          <button 
            onClick={() => movePlayer(-1, 0)}
            disabled={!isInteractive}
            className="w-12 h-12 bg-secondary text-primary font-bold hover:bg-primary hover:text-white rounded-xl transition-all disabled:opacity-50"
          >
            ◀
          </button>
          <button 
            onClick={handleReset}
            disabled={!isInteractive}
            className="px-4 h-12 bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold rounded-xl transition-all disabled:opacity-50"
          >
            Reset
          </button>
          <button 
            onClick={() => movePlayer(1, 0)}
            disabled={!isInteractive}
            className="w-12 h-12 bg-secondary text-primary font-bold hover:bg-primary hover:text-white rounded-xl transition-all disabled:opacity-50"
          >
            ▶
          </button>
        </div>
        <button 
          onClick={() => movePlayer(0, 1)}
          disabled={!isInteractive}
          className="w-12 h-12 bg-secondary text-primary font-bold hover:bg-primary hover:text-white rounded-xl transition-all disabled:opacity-50"
        >
          ▼
        </button>
      </div>
    </div>
  );
}
