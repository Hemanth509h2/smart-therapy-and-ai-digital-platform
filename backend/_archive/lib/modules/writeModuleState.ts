// Single place every module writes its shared state through.
//
// WHY THIS EXISTS
// Each module used to inline its own copy of this write, all of them ending in a
// bare `catch {}`. That swallowed every failure: a write rejected by rules, a
// missing document, or a dropped connection all looked exactly like success, so
// the therapist and child could silently drift out of sync with nothing in the
// UI or the console to show it. Twenty-eight modules shared that pattern.
//
// Scope note: only modules rebuilt in this batch use this helper so far. The
// remaining modules still carry their own inline write and are a separate,
// deliberate cleanup task — not something to migrate quietly.

import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface WriteModuleStateOptions {
  /** Module name used to attribute warnings, e.g. 'BubbleSplash'. */
  label?: string
}

/**
 * Merge `data` into liveSessions/{sessionId} and stamp timestamps.updatedAt.
 *
 * Keys should be dotted field paths exactly as before, e.g.
 * `{ 'moduleState.bsBubbles': bubbles }`, so migrating a module is a
 * call-site swap and nothing more.
 *
 * Returns true on success, false on failure — never throws, so a failed sync
 * cannot break a therapy session mid-activity. Failures are logged with the
 * module name rather than discarded.
 */
export async function writeModuleState(
  sessionId: string,
  data: Record<string, unknown>,
  opts: WriteModuleStateOptions = {}
): Promise<boolean> {
  if (!sessionId) {
    console.warn(`[${opts.label ?? 'module'}] writeModuleState called without a sessionId`)
    return false
  }
  try {
    await updateDoc(doc(db, 'liveSessions', sessionId), {
      ...data,
      'timestamps.updatedAt': new Date().toISOString(),
    })
    return true
  } catch (err) {
    // updateDoc requires an existing document, so a missing liveSessions doc is
    // the most likely cause after a rules rejection. Name both, since this used
    // to be invisible.
    console.warn(
      `[${opts.label ?? 'module'}] Failed to write module state to liveSessions/${sessionId}. ` +
        `The document may not exist, or the write may have been rejected. Fields: ` +
        `${Object.keys(data).join(', ')}`,
      err
    )
    return false
  }
}
