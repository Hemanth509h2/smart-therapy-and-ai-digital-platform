'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Compass,
  Sparkles,
  Flag,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Square,
  Trophy,
  Footprints,
  Navigation,
  Layers,
} from 'lucide-react';
import { useAuthStore } from '@/store/useAuthStore';
import { updateModuleState, subscribeToModuleState } from '@/services/sessionSync';
import { logModuleEvent } from '@/lib/sessionEvents';

type Difficulty = 'easy' | 'medium' | 'hard';

interface MazeConfig {
  grid: number[][];
  size: number;
  label: string;
  badgeColor: string;
}

const MAZE_PRESETS: Record<Difficulty, MazeConfig> = {
  easy: {
    size: 5,
    label: 'Easy (5×5)',
    badgeColor: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    grid: [
      [0, 0, 1, 0, 0],
      [1, 0, 1, 0, 1],
      [0, 0, 0, 0, 0],
      [0, 1, 1, 1, 0],
      [0, 0, 0, 1, 0],
    ],
  },
  medium: {
    size: 7,
    label: 'Medium (7×7)',
    badgeColor: 'bg-amber-100 text-amber-800 border-amber-200',
    grid: [
      [0, 0, 0, 1, 0, 0, 0],
      [1, 1, 0, 1, 0, 1, 0],
      [0, 0, 0, 0, 0, 1, 0],
      [0, 1, 1, 1, 0, 1, 0],
      [0, 1, 0, 0, 0, 0, 0],
      [0, 1, 0, 1, 1, 1, 0],
      [0, 0, 0, 1, 0, 0, 0],
    ],
  },
  hard: {
    size: 9,
    label: 'Hard (9×9)',
    badgeColor: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    grid: [
      [0, 0, 1, 0, 0, 0, 1, 0, 0],
      [1, 0, 1, 0, 1, 0, 1, 0, 1],
      [0, 0, 0, 0, 1, 0, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 0, 0, 0, 0, 1, 0],
      [1, 1, 1, 1, 0, 1, 0, 1, 0],
      [0, 0, 0, 1, 0, 1, 0, 0, 0],
      [0, 1, 0, 1, 0, 1, 1, 1, 0],
      [0, 1, 0, 0, 0, 0, 0, 0, 0],
    ],
  },
};

interface MazeState {
  playerPos: { x: number; y: number };
  goalPos: { x: number; y: number };
  completed: boolean;
  moves?: number;
  difficulty?: Difficulty;
}

interface MazeModuleProps {
  sessionId: string;
  role: 'therapist' | 'client';
  isLocked: boolean;
}

export default function MazeModule({ sessionId, role, isLocked }: MazeModuleProps) {
  const { uid } = useAuthStore();
  const isTherapist = role === 'therapist';
  const isInteractive = !isLocked;

  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [state, setState] = useState<MazeState>({
    playerPos: { x: 0, y: 0 },
    goalPos: { x: 4, y: 4 },
    completed: false,
    moves: 0,
    difficulty: 'easy',
  });

  const currentMazeConfig = MAZE_PRESETS[difficulty] || MAZE_PRESETS.easy;
  const currentGrid = currentMazeConfig.grid;
  const gridSize = currentMazeConfig.size;

  useEffect(() => {
    const unsubscribe = subscribeToModuleState(sessionId, 'maze', (syncedState) => {
      if (syncedState) {
        setState(syncedState);
        if (syncedState.difficulty && syncedState.difficulty !== difficulty) {
          setDifficulty(syncedState.difficulty);
        }
      }
    });
    return () => unsubscribe();
  }, [sessionId, difficulty]);

  // Log reaching the goal once (therapist browser only).
  const loggedDoneRef = useRef(false);
  useEffect(() => {
    if (state.completed && isTherapist && !loggedDoneRef.current) {
      loggedDoneRef.current = true;
      logModuleEvent(sessionId, {
        module: 'maze',
        type: 'maze_solved',
        detail: `Reached the goal in ${difficulty.toUpperCase()} Maze (${gridSize}×${gridSize}) in ${state.moves || 0} moves (sustained attention · motor planning)`,
      });
    }
    if (!state.completed) loggedDoneRef.current = false;
  }, [state.completed, isTherapist, sessionId, state.moves, difficulty, gridSize]);

  const movePlayer = (dx: number, dy: number) => {
    if (!isInteractive || state.completed) return;

    const newX = state.playerPos.x + dx;
    const newY = state.playerPos.y + dy;

    // Check boundaries and wall hits (1 is wall)
    if (newX >= 0 && newX < gridSize && newY >= 0 && newY < gridSize && currentGrid[newY][newX] === 0) {
      const isGoal = newX === state.goalPos.x && newY === state.goalPos.y;
      const nextState: MazeState = {
        playerPos: { x: newX, y: newY },
        goalPos: state.goalPos,
        completed: isGoal,
        moves: (state.moves || 0) + 1,
        difficulty,
      };

      setState(nextState);
      updateModuleState(sessionId, 'maze', nextState, uid || 'anonymous');
    }
  };

  // Keyboard navigation support (Arrow keys)
  const movePlayerRef = useRef(movePlayer);
  movePlayerRef.current = movePlayer;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isInteractive) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowUp') movePlayerRef.current(0, -1);
        if (e.key === 'ArrowDown') movePlayerRef.current(0, 1);
        if (e.key === 'ArrowLeft') movePlayerRef.current(-1, 0);
        if (e.key === 'ArrowRight') movePlayerRef.current(1, 0);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInteractive]);

  const handleDifficultyChange = (newDiff: Difficulty) => {
    if (!isInteractive || !isTherapist) return;
    const config = MAZE_PRESETS[newDiff];
    setDifficulty(newDiff);
    const resetState: MazeState = {
      playerPos: { x: 0, y: 0 },
      goalPos: { x: config.size - 1, y: config.size - 1 },
      completed: false,
      moves: 0,
      difficulty: newDiff,
    };
    setState(resetState);
    updateModuleState(sessionId, 'maze', resetState, uid || 'anonymous');
  };

  const handleReset = () => {
    if (!isInteractive || !isTherapist) return;
    const resetState: MazeState = {
      playerPos: { x: 0, y: 0 },
      goalPos: { x: gridSize - 1, y: gridSize - 1 },
      completed: false,
      moves: 0,
      difficulty,
    };
    setState(resetState);
    updateModuleState(sessionId, 'maze', resetState, uid || 'anonymous');
  };

  const handleEnd = () => {
    if (!isInteractive || !isTherapist || state.completed) return;
    const endState: MazeState = {
      ...state,
      completed: true,
      difficulty,
    };
    setState(endState);
    updateModuleState(sessionId, 'maze', endState, uid || 'anonymous');
    logModuleEvent(sessionId, {
      module: 'maze',
      type: 'session_ended',
      detail: `Therapist ended the ${difficulty} maze activity at move ${state.moves || 0}`,
    });
  };

  // Adaptive tile dimensions for balanced, perfectly proportioned visibility
  const tileClasses = {
    easy: 'w-14 h-14 sm:w-16 sm:h-16 md:w-16 md:h-16',
    medium: 'w-10 h-10 sm:w-11 sm:h-11 md:w-11 md:h-11',
    hard: 'w-8 h-8 sm:w-9 sm:h-9 md:w-9 md:h-9',
  }[difficulty];

  const emojiClasses = {
    easy: 'text-2xl sm:text-3xl',
    medium: 'text-lg sm:text-xl',
    hard: 'text-sm sm:text-base',
  }[difficulty];

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-6 bg-white/95 rounded-3xl border border-slate-200/80 shadow-sm backdrop-blur-sm flex flex-col gap-6">
      {/* Header */}
      <div className="text-center shrink-0">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold tracking-wide uppercase mb-1.5">
          <Compass className="w-3.5 h-3.5 text-emerald-600" /> Focus & Motor Planning
        </div>
        <h3 className="text-2xl md:text-3xl font-heading text-slate-800 tracking-tight font-bold">
          Calming Maze
        </h3>
        <p className="text-xs md:text-sm text-slate-500 mt-1 font-medium max-w-md mx-auto">
          Guide the friendly chick through tranquil garden pathways to reach the star.
        </p>

        {/* Difficulty Level Switcher for Therapist / Status Indicator for Client */}
        <div className="mt-3 flex items-center justify-center gap-2">
          {isTherapist ? (
            <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 shadow-inner">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => {
                const active = difficulty === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDifficultyChange(d)}
                    className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all capitalize cursor-pointer ${
                      active
                        ? 'bg-white text-slate-800 shadow-xs border border-slate-200/60'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {d === 'easy' ? 'Easy (5×5)' : d === 'medium' ? 'Medium (7×7)' : 'Hard (9×9)'}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${currentMazeConfig.badgeColor}`}>
              <Layers className="w-3.5 h-3.5" />
              Level: {currentMazeConfig.label}
            </div>
          )}
        </div>
      </div>

      {/* 3-Column Layout: Left (Instructions & Stats), Middle (Maze), Right (Arrow Controls) */}
      <div className="flex-1 flex flex-col lg:flex-row items-center lg:items-start justify-center gap-6 xl:gap-8 min-h-0">
        
        {/* LEFT COLUMN: Instructions & Stats Panel */}
        <div className="w-full lg:w-80 xl:w-84 shrink-0 flex flex-col gap-4">
          {/* Guide Card */}
          <div className="p-5 bg-gradient-to-br from-slate-50 to-emerald-50/40 rounded-2xl border border-slate-200/80 shadow-xs">
            <div className="flex items-center gap-2 pb-3 mb-3.5 border-b border-slate-200/70 text-slate-800 font-bold text-sm tracking-wide uppercase">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>How to Play</span>
            </div>

            <ul className="space-y-3.5 text-sm text-slate-600">
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 shadow-xs">
                  1
                </span>
                <div className="leading-relaxed">
                  <span className="font-semibold text-slate-800">Start Position:</span> You begin at the top-left (<span className="text-base">🐣</span>).
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 shadow-xs">
                  2
                </span>
                <div className="leading-relaxed">
                  <span className="font-semibold text-slate-800">Clear Paths:</span> Follow open stone paths and avoid hedge walls (<span className="text-sm">🌿</span>).
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shrink-0 mt-0.5 shadow-xs">
                  3
                </span>
                <div className="leading-relaxed">
                  <span className="font-semibold text-slate-800">Reach the Star:</span> Reach the glowing star portal (<span className="text-base">🌟</span>) to win!
                </div>
              </li>
            </ul>

            <div className="mt-4 pt-3.5 border-t border-slate-200/70 flex items-center gap-2 text-xs text-slate-500 font-semibold">
              <Navigation className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Tip: Use arrow buttons or keyboard <strong>↑ ↓ ← →</strong> keys.</span>
            </div>
          </div>

          {/* Stats Card */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-around text-center">
            <div>
              <div className="flex items-center justify-center gap-1.5 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <Footprints className="w-4 h-4" /> Moves
              </div>
              <div className="text-3xl font-extrabold text-slate-800 mt-1 tabular-nums">
                {state.moves || 0}
              </div>
            </div>
            <div className="w-px h-10 bg-slate-200" />
            <div>
              <div className="flex items-center justify-center gap-1.5 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <Flag className="w-4 h-4" /> Status
              </div>
              <div className="text-sm font-bold mt-1.5">
                {state.completed ? (
                  <span className="text-emerald-700 bg-emerald-100/80 px-3 py-1 rounded-full">
                    Completed 🎉
                  </span>
                ) : (
                  <span className="text-amber-700 bg-amber-100/80 px-3 py-1 rounded-full">
                    Exploring
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* MIDDLE COLUMN: Clean & Balanced Maze */}
        <div className="flex-1 flex flex-col items-center justify-center min-w-0">
          {/* Maze Stage Card */}
          <div className="relative p-4 md:p-5 bg-gradient-to-b from-[#e8efe9] to-[#dbe7dc] rounded-3xl border-2 border-[#ccdccc] shadow-md flex items-center justify-center">
            <div
              className="grid gap-1.5 md:gap-2"
              style={{
                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
              }}
            >
              {currentGrid.map((row, y) =>
                row.map((cell, x) => {
                  const isPlayer = state.playerPos.x === x && state.playerPos.y === y;
                  const isGoal = state.goalPos.x === x && state.goalPos.y === y;
                  const isWall = cell === 1;

                  return (
                    <div
                      key={`${y}-${x}`}
                      className={`${tileClasses} rounded-xl md:rounded-2xl flex items-center justify-center transition-all duration-200 select-none relative ${
                        isWall
                          ? 'bg-gradient-to-b from-[#345339] to-[#243c27] border border-[#1b2d1e] shadow-[0_3px_5px_rgba(0,0,0,0.18),inset_0_1px_1px_rgba(255,255,255,0.22)]'
                          : isPlayer
                          ? 'bg-gradient-to-br from-amber-400 to-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.6)] border-2 border-white scale-105 z-10 animate-pulse'
                          : isGoal
                          ? 'bg-gradient-to-br from-yellow-300 via-amber-200 to-yellow-400 border-2 border-amber-300 shadow-[0_0_16px_rgba(234,179,8,0.7)] scale-100 z-5'
                          : 'bg-white/95 border border-slate-200/90 shadow-[inset_0_1px_3px_rgba(0,0,0,0.03)] hover:bg-white'
                      }`}
                    >
                      {/* Cell Decor / Characters */}
                      {isPlayer ? (
                        <span className={`${emojiClasses} drop-shadow-md select-none transform transition-transform`}>
                          🐣
                        </span>
                      ) : isGoal ? (
                        <span className={`${emojiClasses} drop-shadow-md select-none animate-bounce`}>
                          🌟
                        </span>
                      ) : isWall ? (
                        <span className="text-xs md:text-sm opacity-35 select-none">🌿</span>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300/70" />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Victory Banner Overlay */}
            {state.completed && (
              <div className="absolute inset-0 bg-white/95 backdrop-blur-xs rounded-3xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-300 z-20">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3 shadow-md">
                  <Trophy className="w-8 h-8" />
                </div>
                <h4 className="text-2xl font-bold text-emerald-800">Wonderful Job!</h4>
                <p className="text-sm text-slate-600 mt-1">
                  You completed the {difficulty.toUpperCase()} maze in {state.moves || 0} moves!
                </p>
                {isTherapist && (
                  <div className="mt-4 flex flex-wrap gap-2.5 justify-center">
                    <button
                      onClick={handleReset}
                      className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 shadow-sm transition-all cursor-pointer"
                    >
                      Play Again
                    </button>
                    {difficulty === 'easy' && (
                      <button
                        onClick={() => handleDifficultyChange('medium')}
                        className="px-5 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 shadow-sm transition-all cursor-pointer"
                      >
                        Try Medium (7×7)
                      </button>
                    )}
                    {difficulty === 'medium' && (
                      <button
                        onClick={() => handleDifficultyChange('hard')}
                        className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-sm transition-all cursor-pointer"
                      >
                        Try Hard (9×9)
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Arrow Controls (D-Pad) & Actions */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col items-center justify-center gap-4">
          <div className="w-full p-5 bg-slate-50/90 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col items-center">
            <div className="flex items-center gap-2 pb-3 mb-4 border-b border-slate-200/70 text-slate-700 font-bold text-xs uppercase tracking-wider w-full justify-center">
              <Compass className="w-4 h-4 text-emerald-600" />
              <span>Arrow Controls</span>
            </div>

            {/* Large, Chunky, Highly Visible D-Pad Controls */}
            <div className="flex flex-col items-center gap-2.5">
              <button
                onClick={() => movePlayer(0, -1)}
                disabled={!isInteractive || state.completed}
                aria-label="Move Up"
                className="w-16 h-15 sm:w-18 sm:h-16 bg-white hover:bg-emerald-600 hover:text-white text-slate-700 font-bold rounded-2xl border-2 border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700 cursor-pointer"
              >
                <ArrowUp className="w-8 h-8 stroke-[2.5]" />
              </button>

              <div className="flex gap-2.5 items-center">
                <button
                  onClick={() => movePlayer(-1, 0)}
                  disabled={!isInteractive || state.completed}
                  aria-label="Move Left"
                  className="w-16 h-15 sm:w-18 sm:h-16 bg-white hover:bg-emerald-600 hover:text-white text-slate-700 font-bold rounded-2xl border-2 border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700 cursor-pointer"
                >
                  <ArrowLeft className="w-8 h-8 stroke-[2.5]" />
                </button>

                <div className="w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center rounded-2xl bg-slate-100/80 border border-dashed border-slate-300 text-slate-400">
                  <Compass className="w-6 h-6 text-emerald-600/70" />
                </div>

                <button
                  onClick={() => movePlayer(1, 0)}
                  disabled={!isInteractive || state.completed}
                  aria-label="Move Right"
                  className="w-16 h-15 sm:w-18 sm:h-16 bg-white hover:bg-emerald-600 hover:text-white text-slate-700 font-bold rounded-2xl border-2 border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700 cursor-pointer"
                >
                  <ArrowRight className="w-8 h-8 stroke-[2.5]" />
                </button>
              </div>

              <button
                onClick={() => movePlayer(0, 1)}
                disabled={!isInteractive || state.completed}
                aria-label="Move Down"
                className="w-16 h-15 sm:w-18 sm:h-16 bg-white hover:bg-emerald-600 hover:text-white text-slate-700 font-bold rounded-2xl border-2 border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700 cursor-pointer"
              >
                <ArrowDown className="w-8 h-8 stroke-[2.5]" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mt-4 font-semibold text-center">
              Tap buttons or use keyboard keys
            </p>
          </div>

          {/* Therapist Controls Bar */}
          {isTherapist && (
            <div className="w-full flex flex-col gap-2">
              <button
                onClick={handleReset}
                disabled={!isInteractive}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-bold rounded-xl border border-slate-200 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Reset Maze
              </button>
              {!state.completed && (
                <button
                  onClick={handleEnd}
                  disabled={!isInteractive}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold rounded-xl border border-rose-200 transition-all shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Square className="w-4 h-4" />
                  End Activity
                </button>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
