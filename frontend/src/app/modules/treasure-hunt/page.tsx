'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Shield, User } from 'lucide-react';
import TreasureQuest from '@/components/modules/skill/TreasureQuest';
import { useAuthStore } from '@/store/useAuthStore';

export default function TreasureHuntPage() {
  const { role, profile } = useAuthStore();
  const [selectedRole, setSelectedRole] = useState<'client' | 'therapist'>(
    role === 'THERAPIST' ? 'therapist' : 'client'
  );
  const [soundOn, setSoundOn] = useState(true);

  const clientName = profile
    ? `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'Harini B'
    : 'Harini B';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#1b2420',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Floating Action Bar */}
      <header
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          right: 14,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pointerEvents: 'none',
        }}
      >
        {/* Back Link */}
        <Link
          href="/modules"
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 16px',
            borderRadius: 999,
            background: 'rgba(28, 38, 33, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            transition: 'transform 0.15s ease',
          }}
        >
          <ArrowLeft size={16} />
          <span>Exit to Modules</span>
        </Link>

        {/* Role Mode Quick Switcher */}
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 4px',
            borderRadius: 999,
            background: 'rgba(28, 38, 33, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
          }}
        >
          <button
            onClick={() => setSelectedRole('client')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              cursor: 'pointer',
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              background: selectedRole === 'client' ? '#4a7c6f' : 'transparent',
              color: selectedRole === 'client' ? '#ffffff' : '#b2c0b9',
              transition: 'all 0.15s ease',
            }}
          >
            <User size={13} />
            <span>Client View</span>
          </button>
          <button
            onClick={() => setSelectedRole('therapist')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: 'none',
              cursor: 'pointer',
              padding: '5px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 800,
              background: selectedRole === 'therapist' ? '#6b5ce7' : 'transparent',
              color: selectedRole === 'therapist' ? '#ffffff' : '#b2c0b9',
              transition: 'all 0.15s ease',
            }}
          >
            <Shield size={13} />
            <span>Therapist View</span>
          </button>
        </div>
      </header>

      {/* 3D Game Container */}
      <main
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        <TreasureQuest
          role={selectedRole}
          userName={clientName}
          isLocked={false}
        />
      </main>
    </div>
  );
}
