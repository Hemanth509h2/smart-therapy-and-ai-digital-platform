'use client'
import { useState } from 'react'
import { X } from 'lucide-react'
import { MODULE_CATEGORIES, type ModuleItem } from '@/lib/modules'

interface ModuleSelectorPanelProps {
  open: boolean
  onClose: () => void
  onLaunch: (moduleId: string, moduleName: string) => void
  // When provided, only these module ids are shown (per-therapist access).
  // null / undefined means unrestricted (all modules).
  allowedModuleIds?: string[] | null
}

export default function ModuleSelectorPanel({ open, onClose, onLaunch, allowedModuleIds }: ModuleSelectorPanelProps) {
  const hoverStyles = `
    .hover\\:bg-white-12:hover { background: #DBB69A; }
    .hover\\:bg-white-10:hover { background: #B5D3C9; }
  `
  const [currentCategory, setCurrentCategory] = useState<string | null>(null)

  // Per-therapist access filter; null/undefined keeps every module.
  const allowSet = allowedModuleIds == null ? null : new Set(allowedModuleIds)
  const CATEGORIES = allowSet
    ? MODULE_CATEGORIES
        .map((c) => ({ ...c, modules: c.modules.filter((m) => allowSet.has(m.id)) }))
        .filter((c) => c.modules.length > 0)
    : MODULE_CATEGORIES

  const category = currentCategory ? CATEGORIES.find(c => c.id === currentCategory) : null

  const handleBack = () => {
    setCurrentCategory(null)
  }

  const handleLaunch = (mod: ModuleItem) => {
    onLaunch(mod.id, mod.name)
  }

  return (
    <>
      <style>{hoverStyles}</style>
      <div
        style={{
          position: 'absolute',
        top: 48,
        left: 0,
        bottom: 64,
        width: 280,
        zIndex: 25,
        background: 'rgba(28, 28, 28, 0.55)',
        backdropFilter: 'blur(20px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
        borderRight: '1px solid rgba(255, 255, 255, 0.14)',
        borderRadius: 20,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'rgba(0,0,0,0.08)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 14 }}>🗂️</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
            {category ? category.name : 'Therapy Modules'}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: 'none',
            background: '#E8897A',
            color: '#FFFFFF',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={13} />
        </button>
      </div>

      {/* Breadcrumb */}
      <div
        style={{
          padding: '7px 14px',
          fontSize: 10,
          color: 'rgba(255,255,255,0.3)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        {category ? (
          <>
            <span
              onClick={handleBack}
              style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}
            >
              All
            </span>
            <span style={{ color: 'rgba(255,255,255,0.2)' }}> › {category.name}</span>
          </>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.35)' }}>All categories</span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {category ? (
          /* CATEGORY VIEW */
          <div className="flex flex-col gap-1">
            {/* Back button */}
            <button
              onClick={handleBack}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 11,
                cursor: 'pointer',
                padding: '6px 4px',
                textAlign: 'left',
              }}
            >
              ‹ Back
            </button>

            {/* Category description */}
            <div
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.35)',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 7,
                padding: '7px 10px',
                marginBottom: 4,
              }}
            >
              {category.desc}
            </div>

            {/* Module list */}
            <div className="flex flex-col" style={{ gap: 5 }}>
              {category.modules.map((mod) => (
                <div
                  key={mod.id}
                  className="group hover:bg-white-10"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '9px 11px',
                    borderRadius: 18,
                    background: '#A8C9BE',
                    border: '1px solid rgba(30,53,48,0.18)',
                    transition: 'background 0.15s',
                  }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 7,
                      background: 'rgba(30,53,48,0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      flexShrink: 0,
                    }}
                  >
                    {mod.emoji}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: '#1E3530' }}>
                      {mod.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(30,53,48,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mod.desc}
                    </div>
                  </div>
                  <button
                    onClick={() => handleLaunch(mod)}
                    className="opacity-0 group-hover:opacity-100"
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: '1px solid rgba(44,44,44,0.25)',
                      background: '#EFC93D',
                      color: '#2C2C2C',
                      fontSize: 10,
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    Launch
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ROOT VIEW — category folders */
          <div className="flex flex-col" style={{ gap: 6 }}>
            {CATEGORIES.map((cat) => (
              <div
                key={cat.id}
                onClick={() => setCurrentCategory(cat.id)}
                className="hover:bg-white-12"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 12px',
                  borderRadius: 18,
                  background: '#D4A98A',
                  border: '1px solid rgba(60,36,21,0.18)',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: cat.iconBg,
                    border: `1px solid ${cat.iconBorder}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    flexShrink: 0,
                  }}
                >
                  {cat.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#3C2415' }}>
                    {cat.name}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(60,36,21,0.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cat.desc}
                  </div>
                </div>
                <div className="flex items-center gap-1.5" style={{ flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: 9,
                      color: 'rgba(60,36,21,0.7)',
                      background: 'rgba(60,36,21,0.12)',
                      borderRadius: 8,
                      padding: '2px 7px',
                    }}
                  >
                    {cat.modules.length}
                  </div>
                  <span style={{ color: 'rgba(60,36,21,0.6)', fontSize: 11 }}>›</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
