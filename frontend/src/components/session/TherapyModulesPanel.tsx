'use client'
import { useMemo, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { MODULE_CATEGORIES, type ModuleItem } from '@/lib/modules'
import { GLASS } from './roomTheme'
import PanelShell from './PanelShell'

// Therapy Modules sidebar panel.
//
// Visual re-skin only: the module list, categories, per-therapist access filter
// and the launch call are the same ones ModuleSelectorPanel used
// (MODULE_CATEGORIES + resolveAllowedModuleIds + onLaunch(id, name)). No module
// data or launch mechanism changed.
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
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)

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
      if (categoryFilter && c.id !== categoryFilter) continue
      for (const m of c.modules) {
        if (q && !`${m.name} ${m.desc}`.toLowerCase().includes(q)) continue
        out.push({ mod: m, catId: c.id, catName: c.name, iconBg: c.iconBg, iconBorder: c.iconBorder })
      }
    }
    return out
  }, [categories, categoryFilter, query])

  return (
    <PanelShell
      title="Therapy Modules"
      subtitle="Select a module to use in session"
      onClose={onClose}
    >
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 7 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 10px',
              height: 34,
              borderRadius: 10,
              background: GLASS.fill,
              border: `1px solid ${GLASS.fillBorder}`,
            }}
          >
            <Search size={13} style={{ color: GLASS.inkFaint, flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search modules..."
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: GLASS.ink,
                fontSize: 11.5,
                fontFamily: "'DM Sans', sans-serif",
              }}
            />
          </div>
          <button
            onClick={() => setFilterOpen((o) => !o)}
            title="Filter by category"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: `1px solid ${filterOpen || categoryFilter ? GLASS.border : GLASS.fillBorder}`,
              background: filterOpen || categoryFilter ? GLASS.fill : 'transparent',
              color: categoryFilter ? GLASS.accent : GLASS.inkMuted,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>

        {filterOpen && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {[{ id: null as string | null, name: 'All' }, ...categories.map((c) => ({ id: c.id as string | null, name: c.name }))].map(
              (c) => {
                const active = categoryFilter === c.id
                return (
                  <button
                    key={c.id ?? 'all'}
                    onClick={() => setCategoryFilter(c.id)}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 20,
                      border: `1px solid ${active ? GLASS.accent : GLASS.fillBorder}`,
                      background: active ? GLASS.accent : 'transparent',
                      color: active ? GLASS.accentInk : GLASS.inkMuted,
                      fontSize: 9.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {c.name}
                  </button>
                )
              }
            )}
          </div>
        )}

        {/* Module rows */}
        {rows.length === 0 ? (
          <div style={{ fontSize: 10, color: GLASS.inkFaint, padding: '8px 0' }}>
            No modules match “{query}”.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {rows.map(({ mod, catName, iconBg, iconBorder }) => {
              // The registry stores one dot-separated descriptor string per
              // module — split it into the tag row rather than inventing fields.
              const tags = mod.desc.split('·').map((t) => t.trim()).filter(Boolean)
              return (
                <div
                  key={mod.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 11px',
                    borderRadius: 14,
                    background: GLASS.fill,
                    border: `1px solid ${GLASS.fillBorder}`,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: iconBg,
                      border: `1px solid ${iconBorder}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 16,
                      flexShrink: 0,
                    }}
                  >
                    {mod.emoji}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: GLASS.ink }}>{mod.name}</div>
                    <div
                      style={{
                        fontSize: 9.5,
                        color: GLASS.inkFaint,
                        marginTop: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {[catName, ...tags].join(' · ')}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                      {[catName, ...tags.slice(0, 1)].map((p) => (
                        <span
                          key={p}
                          style={{
                            padding: '1px 7px',
                            borderRadius: 20,
                            background: 'rgba(255,255,255,0.08)',
                            border: `1px solid ${GLASS.fillBorder}`,
                            fontSize: 8.5,
                            fontWeight: 600,
                            color: GLASS.inkMuted,
                          }}
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => onLaunch(mod.id, mod.name)}
                    style={{
                      padding: '6px 11px',
                      borderRadius: 10,
                      border: `1px solid ${GLASS.accentInk}40`,
                      background: GLASS.accent,
                      color: GLASS.accentInk,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Start Module
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PanelShell>
  )
}
