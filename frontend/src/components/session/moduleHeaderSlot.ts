import { createContext } from 'react'

/**
 * Where a module may render its own header controls inside ModuleStage's top
 * row, so the room's bar and the module's bar become a single line. Null when
 * the module is mounted anywhere without that row (e.g. the sidebar panel), in
 * which case the module renders its header inline as usual.
 */
export const ModuleHeaderSlot = createContext<HTMLElement | null>(null)
