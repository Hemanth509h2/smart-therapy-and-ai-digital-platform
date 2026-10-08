'use client'
import { useMemo, useState } from 'react'
import { Blocks, Search, X } from 'lucide-react'
import { MODULE_CATEGORIES, type ModuleItem } from '@/lib/modules'
import { RC } from './roomTheme'

// The picker uses the same registry, permission filter, and launch callback as
// the previous selector. It is shown as an overlay above the call instead of in
// the session sidebar.
export default function TherapyModulesPanel({
  allowedModuleIds,
  onLaunch,
  onClose,
}: {
  allowedModuleIds?: string[] | null
  onLaunch: (moduleId: string, moduleName: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)

  const allowSet = allowedModuleIds == null ? null : new Set(allowedModuleIds)

  const categories = useMemo(
    () =>
      (allowSet
        ? MODULE_CATEGORIES.map((c) => ({ ...c, modules: c.modules.filter((m) => allowSet.has(m.id)) }))
        : MODULE_CATEGORIES
      ).filter((c) => c.modules.length > 0),
    // allowedModuleIds is a stable-enough array from the profile; keying on its
    // joined form avoids re-filtering on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allowedModuleIds?.join(',')]
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out: Array<{ mod: ModuleItem; catId: string; catName: string; iconBg: string; iconBorder: string }> = []
    for (const c of categories) {
      for (const m of c.modules) {
        if (q && !`${m.name} ${m.desc}`.toLowerCase().includes(q)) continue
        out.push({ mod: m, catId: c.id, catName: c.name, iconBg: c.iconBg, iconBorder: c.iconBorder })
      }
    }
    return out
  }, [categories, query])

  const visibleRows = showAll || query ? rows : rows.slice(0, 8)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Therapy modules"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: '24px 24px 104px',
        background: 'rgba(27,43,38,0.10)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <section
        style={{
          width: 'min(100%, 1050px)',
          maxHeight: 'min(52vh, 470px)',
          overflow: 'hidden auto',
          borderRadius: 22,
          border: `1px solid ${RC.border}`,
          background: 'rgba(255,255,255,0.98)',
          boxShadow: '0 20px 52px rgba(25,50,42,0.22)',
        }}
      >
        <header style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 9, padding: '14px 18px 11px', background: 'rgba(255,255,255,0.98)', borderBottom: `1px solid ${RC.border}` }}>
          <Blocks size={20} color={RC.green} />
          <h2 style={{ margin: 0, color: RC.greenDark, fontSize: 16, fontWeight: 700 }}>Modules</h2>
          <div style={{ flex: 1 }} />
          <label style={{ width: 190, maxWidth: '30vw', height: 31, display: 'flex', alignItems: 'center', gap: 6, padding: '0 9px', borderRadius: 9, border: `1px solid ${RC.border}`, background: RC.tile }}>
            <Search size={14} color={RC.inkMuted} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search modules" style={{ minWidth: 0, flex: 1, border: 0, outline: 0, background: 'transparent', color: RC.ink, fontSize: 12 }} />
          </label>
          <button onClick={() => setShowAll((value) => !value)} style={{ border: 0, background: 'transparent', color: RC.greenDark, cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {showAll ? 'Show fewer' : 'View all modules →'}
          </button>
          <button onClick={onClose} aria-label="Close modules" style={{ width: 30, height: 30, border: 0, borderRadius: 8, background: 'transparent', color: RC.inkMuted, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={19} />
          </button>
        </header>

        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: 12 }}>
          {visibleRows.map(({ mod, iconBg, iconBorder }) => (
            <button
              key={mod.id}
              onClick={() => onLaunch(mod.id, mod.name)}
              title={`Start ${mod.name}`}
              style={{ minHeight: 119, padding: '13px 8px 10px', borderRadius: 15, border: `1px solid ${RC.border}`, background: '#fff', color: RC.ink, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 3px 10px rgba(20,40,30,0.04)' }}
            >
              <span aria-hidden="true" style={{ width: 43, height: 43, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 23, background: iconBg, border: `1px solid ${iconBorder}` }}>{mod.emoji}</span>
              <span style={{ fontSize: 12, lineHeight: 1.25, fontWeight: 700, textAlign: 'center' }}>{mod.name}</span>
            </button>
          ))}
          {visibleRows.length === 0 && <p style={{ gridColumn: '1 / -1', margin: '8px 0', color: RC.inkMuted, fontSize: 13 }}>No modules match “{query}”.</p>}
        </div>
      </section>
    </div>
  )

}
