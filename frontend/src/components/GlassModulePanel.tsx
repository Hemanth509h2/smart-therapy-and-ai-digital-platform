'use client'

import { useEffect, useRef, useState, Suspense, useMemo } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { logModuleEvent } from '@/lib/sessionEvents'
import { 
  loadModule, 
  preloadModule, 
  isModuleLoaded,
  MODULE_METADATA, 
  MODULE_CATEGORIES,
  isSkillModule,
  getAvailableModuleIds
} from '@/lib/moduleRegistry'

// ============================================================================
// MODULE CONTENT — dynamically loaded via moduleRegistry
// ============================================================================

interface ModuleContentProps {
  activeModule: string | null
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
  isTherapist: boolean
}

function ModuleLoadingFallback({ moduleId }: { moduleId: string }) {
  const meta = MODULE_METADATA[moduleId]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4" style={{ minHeight: 300 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginBottom: 4 }}>
        Loading {meta?.title || 'module'}…
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
        Please wait while the activity loads
      </div>
    </div>
  )
}

function ModuleErrorFallback({ moduleId, onRetry }: { moduleId: string; onRetry: () => void }) {
  const meta = MODULE_METADATA[moduleId]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4" style={{ minHeight: 300 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#ff6b6b', marginBottom: 8 }}>
        Failed to load {meta?.title || 'module'}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 16 }}>
        The module couldn't be loaded. Please try again.
      </div>
      <button 
        onClick={onRetry}
        style={{
          padding: '8px 16px',
          borderRadius: 8,
          border: 'none',
          background: '#3fae6a',
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}

function ModuleNotFound({ moduleId }: { moduleId: string }) {
  const meta = MODULE_METADATA[moduleId]
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4" style={{ minHeight: 300 }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
      <div style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginBottom: 4 }}>
        {meta?.title || 'Module not found'}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
        This module is not available or not yet implemented.
      </div>
    </div>
  )
}

export function ModuleContent({
  activeModule,
  sessionId,
  role,
  isLocked,
  isTherapist,
}: ModuleContentProps) {
  const [loadedModule, setLoadedModule] = useState<React.ComponentType<any> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const loadAttempted = useRef<string | null>(null)

  // Load module when activeModule changes
  useEffect(() => {
    if (!activeModule) {
      setLoadedModule(null)
      setLoadError(false)
      loadAttempted.current = null
      return
    }

    // Skip if already loaded
    if (loadAttempted.current === activeModule && loadedModule) return

    setLoadError(false)
    loadAttempted.current = activeModule

    loadModule(activeModule).then(Component => {
      if (Component) {
        setLoadedModule(() => Component)
      } else {
        setLoadError(true)
      }
    })
  }, [activeModule])

  const handleRetry = () => {
    if (!activeModule) return
    setLoadError(false)
    loadModule(activeModule).then(Component => {
      if (Component) {
        setLoadedModule(() => Component)
      } else {
        setLoadError(true)
      }
    })
  }

  if (!activeModule) {
    const info = isTherapist ? 'Select a module below to begin' : 'Your therapist will choose an activity soon.'
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <span style={{ fontSize: 36, marginBottom: 12 }}>🎯</span>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#FFFFFF', marginBottom: 4 }}>
          Ready for Activity
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
          {info}
        </span>
      </div>
    )
  }

  if (loadError) {
    return <ModuleErrorFallback moduleId={activeModule} onRetry={handleRetry} />
  }

  if (!loadedModule) {
    return <ModuleLoadingFallback moduleId={activeModule} />
  }

  // Render the dynamically loaded module (capitalized for JSX)
  const DynamicModule = loadedModule
  return (
    <Suspense fallback={<ModuleLoadingFallback moduleId={activeModule} />}>
      <DynamicModule
        sessionId={sessionId}
        role={role}
        isLocked={isLocked}
      />
    </Suspense>
  )
}

// ============================================================================
// SKILL MODULE VIEW — for full-canvas SkillDevLayout
// ============================================================================

export function SkillModuleView({
  moduleId,
  sessionId,
  role,
  isLocked,
}: {
  moduleId: string | null
  sessionId: string
  role: 'therapist' | 'client'
  isLocked: boolean
}) {
  if (!moduleId || !isSkillModule(moduleId)) return null

  const [loadedModule, setLoadedModule] = useState<React.ComponentType<any> | null>(null)
  const [loadError, setLoadError] = useState(false)
  const loadAttempted = useRef<string | null>(null)

  useEffect(() => {
    if (!moduleId) return
    if (loadAttempted.current === moduleId && loadedModule) return

    setLoadError(false)
    loadAttempted.current = moduleId

    loadModule(moduleId).then(Component => {
      if (Component) {
        setLoadedModule(() => Component)
      } else {
        setLoadError(true)
      }
    })
  }, [moduleId])

  if (loadError) {
    return <ModuleErrorFallback moduleId={moduleId} onRetry={() => {}} />
  }

  if (!loadedModule) {
    return <ModuleLoadingFallback moduleId={moduleId} />
  }

  const DynamicModule = loadedModule
  return <DynamicModule sessionId={sessionId} role={role} isLocked={isLocked} />
}

// ============================================================================
// GLASS MODULE PANEL — Sidebar module selector
// ============================================================================

interface GlassModulePanelProps {
  sessionId: string
  activeModule: string | null
  isTherapist: boolean
  isLocked: boolean
  onModuleSwitch: (moduleId: string) => void
  onLockToggle: () => void
  onClose?: () => void
}

const RC = {
  panel: '#1a1f2e',
  tile: '#232946',
  tileActive: '#2d3561',
  border: '#2d3561',
  ink: '#e8e8f0',
  inkMuted: '#8b8da8',
  green: '#3fae6a',
  greenSoft: '#1a3d2e',
  greenDark: '#1e7a3a',
  red: '#ff5a5f',
  redSoft: '#3d1a1a',
}

export default function GlassModulePanel({
  sessionId,
  activeModule,
  isTherapist,
  isLocked,
  onModuleSwitch,
  onLockToggle,
  onClose,
}: GlassModulePanelProps) {
  const isActive = activeModule !== null
  const meta = activeModule ? MODULE_METADATA[activeModule] : null
  const availableIds = getAvailableModuleIds()

  const role = isTherapist ? 'therapist' : 'client'

  // Preload on hover for faster launch
  const handleMouseEnter = (moduleId: string) => {
    preloadModule(moduleId)
  }

  // Record a "module opened" event whenever the therapist launches/switches a
  // module. Logged from the therapist browser only (the actor) to avoid the
  // synced client duplicating it, and once per distinct open. This guarantees
  // every module appears in the session report's activity log even if the module
  // is later closed without an explicit "end" action.
  const loggedModuleRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isTherapist || !activeModule) {
      loggedModuleRef.current = null
      return
    }
    if (loggedModuleRef.current === activeModule) return
    loggedModuleRef.current = activeModule
    logModuleEvent(sessionId, { module: activeModule, type: 'module_opened', detail: 'Module opened' })
  }, [isTherapist, activeModule, sessionId])

  // Build categorized module list for therapist view
  const categorizedModules = useMemo(() => 
    MODULE_CATEGORIES.map(cat => ({
      ...cat,
      modules: availableIds
        .filter(id => MODULE_METADATA[id]?.category === cat.id)
        .map(id => ({ id, ...MODULE_METADATA[id] }))
    })).filter(cat => cat.modules.length > 0)
  , [availableIds])

  // Client view: mirror only the active module
  if (!isTherapist) {
    if (!activeModule) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: RC.panel }}>
          <div style={{ padding: '16px', borderBottom: `1px solid ${RC.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: RC.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Current Activity
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', color: RC.inkMuted }}>
            <span style={{ fontSize: 36, marginBottom: 12 }}>🎯</span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Waiting for activity…</span>
            <span style={{ fontSize: 11, marginTop: 4 }}>Your therapist will start a module soon.</span>
          </div>
        </div>
      )
    }

    const current = MODULE_METADATA[activeModule]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: RC.panel }}>
        <div style={{ padding: '16px', borderBottom: `1px solid ${RC.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 24 }}>{current?.icon || '🎯'}</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: RC.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Current Activity
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, color: RC.ink }}>{current?.title || 'Activity'}</div>
              <div style={{ fontSize: 11, color: RC.inkMuted }}>{current?.subtitle || ''}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          <ModuleContent
            activeModule={activeModule}
            sessionId={sessionId}
            role={role}
            isLocked={isLocked}
            isTherapist={false}
          />
        </div>
      </div>
    )
  }

  // Therapist view: full module selector with categories
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: RC.panel }}>
      {/* Header */}
      <div style={{ 
        padding: '12px 16px', 
        borderBottom: `1px solid ${RC.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🧩</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: RC.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Modules
            </div>
            {activeModule && (
              <div style={{ fontSize: 12, color: RC.green, fontWeight: 500 }}>
                Active: {MODULE_METADATA[activeModule]?.title || activeModule}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onLockToggle}
            title={isLocked ? 'Unlock for client' : 'Lock for client'}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isLocked ? RC.greenSoft : RC.tile,
              color: isLocked ? RC.green : RC.inkMuted,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s',
            }}
          >
            {isLocked ? <Lock size={16} /> : <LockOpen size={16} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close panel"
              style={{
                width: 32, height: 32, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: RC.tile, color: RC.inkMuted,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Module List — HORIZONTALLY SCROLLABLE */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '16px', paddingBottom: '16px' }}>
          {categorizedModules.map(category => (
            <div key={category.id} style={{ minWidth: '280px', flexShrink: 0 }}>
              <div style={{ 
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 0 8px', fontSize: 11, fontWeight: 700, 
                color: RC.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5,
                borderBottom: `1px solid ${RC.border}`,
              }}>
                <span style={{ fontSize: 14 }}>{category.icon}</span>
                {category.label}
                <span style={{ 
                  marginLeft: 'auto', fontSize: 10, padding: '1px 6px',
                  borderRadius: 999, background: RC.tile, color: RC.inkMuted,
                }}>
                  {category.modules.length}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {category.modules.map(module => {
                  const isCurrent = activeModule === module.id
                  const loaded = isModuleLoaded(module.id)
                  return (
                    <button
                      key={module.id}
                      onClick={() => onModuleSwitch(module.id)}
                      disabled={isCurrent}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: `1px solid ${isCurrent ? RC.green : loaded ? RC.border : 'transparent'}`,
                        background: isCurrent ? RC.greenSoft : loaded ? RC.tile : RC.panel,
                        color: isCurrent ? RC.greenDark : RC.ink,
                        cursor: isCurrent ? 'default' : 'pointer',
                        fontSize: 13, fontWeight: 500,
                        transition: 'all 0.15s',
                        textAlign: 'left',
                        width: '100%',
                      }}
                      onMouseEnter={(e) => {
                        handleMouseEnter(module.id)
                        if (!isCurrent) e.currentTarget.style.background = RC.tileActive
                      }}
                      onMouseLeave={(e) => {
                        if (!isCurrent) e.currentTarget.style.background = loaded ? RC.tile : RC.panel
                      }}
                    >
                      <span style={{ fontSize: 20, flexShrink: 0 }}>{module.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {module.title}
                        </div>
                        <div style={{ fontSize: 10, color: RC.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {module.subtitle}
                        </div>
                      </div>
                      {isCurrent && (
                        <span style={{
                          width: 20, height: 20, borderRadius: '50%',
                          background: RC.green, color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700,
                        }}>✓</span>
                      )}
                      {loaded && !isCurrent && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: RC.green, flexShrink: 0 }} title="Preloaded" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* No modules */}
          {categorizedModules.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: RC.inkMuted, minWidth: '280px' }}>
              <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>🧩</span>
              <p style={{ fontSize: 14 }}>No modules available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Re-export for SkillDevLayout
export { isSkillModule } from '@/lib/moduleRegistry'