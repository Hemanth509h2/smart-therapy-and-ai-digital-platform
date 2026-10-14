'use client';

import React, { useMemo } from 'react';

interface RadarProps {
  playerRotation: number; // in radians
  playerX: number; // -3.0 to 3.0
  playerZ: number; // -3.0 to 3.0
  targetX?: number;
  targetZ?: number;
  isTargetFound?: boolean;
}

export default function TreasureHuntRadar({
  playerRotation,
  playerX,
  playerZ,
  targetX = 0,
  targetZ = -2.8,
  isTargetFound = false,
}: RadarProps) {
  // Normalize room coordinates (-4 to +4) to compass mini-map range (0 to 100)
  const blipPos = useMemo(() => {
    const nx = Math.max(15, Math.min(85, ((targetX + 4) / 8) * 100));
    const nz = Math.max(15, Math.min(85, ((targetZ + 4) / 8) * 100));
    return { x: nx, y: nz };
  }, [targetX, targetZ]);

  const pPos = useMemo(() => {
    const nx = Math.max(15, Math.min(85, ((playerX + 4) / 8) * 100));
    const nz = Math.max(15, Math.min(85, ((playerZ + 4) / 8) * 100));
    return { x: nx, y: nz };
  }, [playerX, playerZ]);

  // Rotation in degrees for CSS transform
  const angleDeg = (playerRotation * 180) / Math.PI;

  return (
    <div
      style={{
        position: 'relative',
        width: 104,
        height: 104,
        userSelect: 'none',
      }}
    >
      {/* Outer compass rim */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: '1.5px solid rgba(255, 230, 190, 0.45)',
          background: 'radial-gradient(circle, rgba(20, 24, 22, 0.88) 45%, rgba(12, 16, 14, 0.96) 100%)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45), inset 0 0 12px rgba(0, 0, 0, 0.8)',
          backdropFilter: 'blur(8px)',
        }}
      />

      {/* Cardinal Labels: N, E, S, W */}
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          fontWeight: 800,
          color: '#f3e5c8',
          letterSpacing: 0.5,
          fontFamily: 'system-ui, sans-serif',
          zIndex: 4,
        }}
      >
        N
      </span>
      <span
        style={{
          position: 'absolute',
          bottom: 3,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 10,
          fontWeight: 800,
          color: '#f3e5c8',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 4,
        }}
      >
        S
      </span>
      <span
        style={{
          position: 'absolute',
          left: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          fontWeight: 800,
          color: '#f3e5c8',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 4,
        }}
      >
        W
      </span>
      <span
        style={{
          position: 'absolute',
          right: 4,
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: 10,
          fontWeight: 800,
          color: '#f3e5c8',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 4,
        }}
      >
        E
      </span>

      {/* Inner radar square room grid */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 60,
          height: 60,
          border: '1px solid rgba(255, 230, 190, 0.28)',
          borderRadius: 4,
          background: 'rgba(255, 255, 255, 0.02)',
          overflow: 'hidden',
        }}
      >
        {/* Subtle grid lines */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255, 230, 190, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 230, 190, 0.1) 1px, transparent 1px)',
            backgroundSize: '15px 15px',
          }}
        />

        {/* Radar beam sweep */}
        <div
          style={{
            position: 'absolute',
            inset: -30,
            borderRadius: '50%',
            background: 'conic-gradient(from 0deg, transparent 0deg, transparent 310deg, rgba(94, 219, 142, 0.22) 360deg)',
            animation: 'radarSweep 4s linear infinite',
            pointerEvents: 'none',
          }}
        />

        {/* Target objective green radar blip */}
        {!isTargetFound && (
          <div
            title="Clue Hotspot"
            style={{
              position: 'absolute',
              left: `${blipPos.x}%`,
              top: `${blipPos.y}%`,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#5EDB8E',
              boxShadow: '0 0 8px #5EDB8E, 0 0 14px rgba(94, 219, 142, 0.8)',
              transform: 'translate(-50%, -50%)',
              animation: 'radarPing 1.8s ease-in-out infinite',
              zIndex: 3,
            }}
          />
        )}

        {/* Player position dot */}
        <div
          title="Player"
          style={{
            position: 'absolute',
            left: `${pPos.x}%`,
            top: `${pPos.y}%`,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 0 4px #ffffff',
            transform: 'translate(-50%, -50%)',
            zIndex: 2,
          }}
        />
      </div>

      {/* Center rotating pointer arrow needle */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 0,
          height: 0,
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
          transition: 'transform 0.15s ease-out',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        {/* White arrowhead */}
        <div
          style={{
            position: 'absolute',
            bottom: 2,
            left: -6,
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: '16px solid #ffffff',
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
          }}
        />
        {/* Needle tail */}
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: -4,
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '10px solid rgba(255, 230, 190, 0.6)',
          }}
        />
      </div>

      <style>{`
        @keyframes radarSweep {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
        @keyframes radarPing {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(1);
            opacity: 1;
          }
          50% {
            transform: translate(-50%, -50%) scale(1.4);
            opacity: 0.7;
          }
        }
      `}</style>
    </div>
  );
}
