'use client'

import { useMemo, useRef, useState } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firestore'
import { CheckCircle2, Circle, FileText, Play, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { GLASS } from './roomTheme'
import { toast } from '@/components/practice/ui'
import { caughtErrorMessage } from '@/lib/apiError'
import { useModuleSettings } from '@/hooks/useModuleSettings'
import {
  AGENT_STEP_LABEL,
  MAX_NOTES_FILE_BYTES,
  NOTES_FILE_ACCEPT,
  checkCallPlanProgress,
  isKnownModule,
  makeCallPlan,
  type AgentStep,
  type CallPlan,
  type CallPlanTask,
} from '@/lib/callPlan'

// "Call Plan" tab of the AI Notes popup (therapist only). The therapist gives
// the AI agent the client's previous notes; it recommends modules and a task
// list for this call, which is saved on the session doc as `callPlan` (and so
// reaches the end-of-session report). "Check progress" lets the agent tick off
// tasks the transcript shows were covered.

interface TranscriptLine {
  text: string
  speaker: string
}

const card: React.CSSProperties = {
  background: GLASS.fill,
  border: `1px solid ${GLASS.fillBorder}`,
  borderRadius: 12,
  padding: '9px 11px',
}

const pillBtn = (primary = false): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '5px 11px',
  borderRadius: 20,
  border: `1px solid ${primary ? GLASS.accent : GLASS.border}`,
  background: primary ? GLASS.accent : GLASS.fill,
  color: primary ? GLASS.accentInk : GLASS.ink,
  fontSize: 10,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
})

const sectionTitle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: GLASS.ink, marginBottom: 6 }

export default function CallPlanTab({
  sessionId,
  plan,
  transcript,
  allowedModuleIds,
  clientName,
  onLaunchModule,
}: {
  sessionId: string
  plan: CallPlan | null
  transcript: TranscriptLine[]
  allowedModuleIds: string[]
  clientName?: string
  onLaunchModule?: (moduleId: string) => void
}) {
  const [replacing, setReplacing] = useState(false)
  const [mode, setMode] = useState<'upload' | 'paste'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [pasted, setPasted] = useState('')
  const [step, setStep] = useState<AgentStep | null>(null)
  const [checking, setChecking] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Modules an admin switched off are neither offered to the agent nor launchable.
  const { disabled } = useModuleSettings()
  const launchable = useMemo(
    () => allowedModuleIds.filter((id) => !disabled.has(id)),
    [allowedModuleIds, disabled]
  )

  const busy = step !== null || checking
  const savePlan = (next: CallPlan) => updateDoc(doc(db, 'sessions', sessionId), { callPlan: next })

  const handleMakePlan = async () => {
    if (busy) return
    setStep('reading')
    try {
      const next = await makeCallPlan({
        sessionId,
        allowedModuleIds: launchable,
        clientName,
        file: mode === 'upload' ? file : null,
        notesText: mode === 'paste' ? pasted : undefined,
        onStep: setStep,
      })
      await savePlan(next)
      setReplacing(false)
      setFile(null)
      setPasted('')
      toast('Your call plan is ready.', 'success')
    } catch (e) {
      toast(caughtErrorMessage(e, 'make the call plan'), 'error')
    } finally {
      setStep(null)
    }
  }

  const handleCheckProgress = async () => {
    if (!plan || busy) return
    setChecking(true)
    try {
      const { covered, next } = await checkCallPlanProgress({ sessionId, tasks: plan.tasks, transcript })
      const done = new Set(covered)
      await savePlan({
        ...plan,
        tasks: plan.tasks.map((t) => (!t.done && done.has(t.id) ? { ...t, done: true, doneBy: 'ai' } : t)),
        next,
        checkedAt: Date.now(),
      })
      toast(
        plan.tasks.some((t) => !t.done && done.has(t.id))
          ? 'Progress updated: covered tasks were ticked off.'
          : 'No new tasks have been covered yet.',
        'info'
      )
    } catch (e) {
      toast(caughtErrorMessage(e, 'check the call plan progress'), 'error')
    } finally {
      setChecking(false)
    }
  }

  const toggleTask = (task: CallPlanTask) => {
    if (!plan) return
    const tasks = plan.tasks.map((t) =>
      t.id === task.id ? { ...t, done: !t.done, doneBy: 'therapist' as const } : t
    )
    savePlan({ ...plan, tasks }).catch(() =>
      toast("We couldn't save the task change. Check your internet connection and try again.", 'error')
    )
  }

  const pickFile = (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_NOTES_FILE_BYTES) {
      toast('The file is larger than 5 MB.', 'warning')
      return
    }
    setFile(f)
  }

  const canLaunch = (id: string | null | undefined): id is string =>
    !!onLaunchModule && isKnownModule(id) && launchable.includes(id)

  // ---- No plan yet (or replacing it): upload / paste the previous notes ----
  if (!plan || replacing) {
    const ready = mode === 'upload' ? !!file : pasted.trim().length > 20
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 10.5, color: GLASS.inkMuted, lineHeight: 1.5 }}>
          Give the AI agent the client&apos;s previous session notes. It reads them, checks the STAAD module
          reports, and suggests modules and a task list for this call. The file is read once and not stored.
        </div>

        <div style={{ display: 'flex', gap: 5 }}>
          {(['upload', 'paste'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              style={{ ...pillBtn(), opacity: mode === m ? 1 : 0.55, background: mode === m ? GLASS.fill : 'transparent' }}
            >
              {m === 'upload' ? <Upload size={11} /> : <FileText size={11} />}
              {m === 'upload' ? 'Upload file' : 'Paste text'}
            </button>
          ))}
        </div>

        {mode === 'upload' ? (
          <div
            onClick={() => !busy && fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (!busy) pickFile(e.dataTransfer.files?.[0])
            }}
            style={{
              ...card,
              borderStyle: 'dashed',
              padding: '18px 12px',
              textAlign: 'center',
              cursor: busy ? 'default' : 'pointer',
              fontSize: 10.5,
              color: file ? GLASS.ink : GLASS.inkFaint,
            }}
          >
            {file ? file.name : 'Drop the notes here or click to choose · PDF, Word (.docx) or text · up to 5 MB'}
            <input
              ref={fileInput}
              type="file"
              accept={NOTES_FILE_ACCEPT}
              hidden
              onChange={(e) => {
                pickFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
        ) : (
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            disabled={busy}
            placeholder="Paste the previous session notes…"
            rows={7}
            style={{
              ...card,
              resize: 'vertical',
              color: GLASS.ink,
              fontSize: 11,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={handleMakePlan} disabled={!ready || busy} style={{ ...pillBtn(true), opacity: !ready || busy ? 0.5 : 1 }}>
            <Sparkles size={11} /> {step ? AGENT_STEP_LABEL[step] : 'Plan this call'}
          </button>
          {plan && replacing && !busy && (
            <button onClick={() => setReplacing(false)} style={pillBtn()}>
              Cancel
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---- The plan ----
  const doneCount = plan.tasks.filter((t) => t.done).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {plan.risk !== 'none' && (
        <div
          style={{
            ...card,
            background: 'rgba(232,137,122,0.18)',
            border: '1px solid rgba(232,137,122,0.4)',
            fontSize: 11,
            color: '#E8897A',
            lineHeight: 1.5,
          }}
        >
          {plan.risk === 'urgent' ? 'Urgent: ' : 'Watch: '}
          {plan.riskDetail || 'The previous notes flag a possible risk.'}
        </div>
      )}

      <div style={{ ...card, fontSize: 11, color: GLASS.inkMuted, lineHeight: 1.6 }}>
        {plan.focus && <div style={{ color: GLASS.ink, fontWeight: 600, marginBottom: 4 }}>{plan.focus}</div>}
        <div style={{ fontStyle: 'italic' }}>{plan.summary}</div>
        <div style={{ fontSize: 9, color: GLASS.inkFaint, marginTop: 6 }}>
          From {plan.source} · {new Date(plan.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {plan.usedModuleReports ? ' · grounded in STAAD module reports' : ''}
        </div>
      </div>

      {/* Recommended modules */}
      <div>
        <div style={sectionTitle}>Recommended modules</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {plan.modules.map((m) => (
            <div key={m.id} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: GLASS.ink }}>{m.name}</div>
                <div style={{ fontSize: 10, color: GLASS.inkMuted, lineHeight: 1.45, marginTop: 2 }}>{m.reason}</div>
                {m.sources && m.sources.length > 0 && (
                  <div style={{ fontSize: 9, color: GLASS.inkFaint, marginTop: 3 }}>Report: {m.sources.join(' · ')}</div>
                )}
              </div>
              {canLaunch(m.id) && (
                <button onClick={() => onLaunchModule?.(m.id)} title={`Launch ${m.name}`} style={pillBtn(true)}>
                  <Play size={10} /> Launch
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ ...sectionTitle, marginBottom: 0, flex: 1 }}>
            Tasks for this call · {doneCount}/{plan.tasks.length}
          </span>
          <button
            onClick={handleCheckProgress}
            disabled={busy}
            title="Let the AI agent tick off tasks the conversation has covered"
            style={{ ...pillBtn(), opacity: busy ? 0.5 : 1 }}
          >
            <RefreshCw size={10} /> {checking ? 'Checking…' : 'Check progress'}
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {plan.tasks.map((t) => (
            <div key={t.id} style={{ ...card, display: 'flex', gap: 8, alignItems: 'flex-start', opacity: t.done ? 0.6 : 1 }}>
              <button
                onClick={() => toggleTask(t)}
                title={t.done ? 'Mark not done' : 'Mark done'}
                style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', marginTop: 1 }}
              >
                {t.done ? <CheckCircle2 size={14} color="#4caf86" /> : <Circle size={14} color={GLASS.inkFaint} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: GLASS.ink,
                    lineHeight: 1.45,
                    textDecoration: t.done ? 'line-through' : 'none',
                  }}
                >
                  {t.text}
                </div>
                {t.done && t.doneBy === 'ai' && (
                  <div style={{ fontSize: 9, color: GLASS.inkFaint, marginTop: 2 }}>Marked by AI from the transcript</div>
                )}
              </div>
              {!t.done && canLaunch(t.moduleId) && (
                <button onClick={() => onLaunchModule?.(t.moduleId as string)} title="Launch this module" style={pillBtn()}>
                  <Play size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
        {plan.next && (
          <div style={{ fontSize: 10, color: GLASS.inkMuted, marginTop: 8, lineHeight: 1.45 }}>
            <span style={{ color: GLASS.accent, fontWeight: 600 }}>Next: </span>
            {plan.next}
          </div>
        )}
      </div>

      <div style={{ fontSize: 9, color: GLASS.inkFaint, lineHeight: 1.45 }}>
        AI suggestions, not clinical advice: you decide what to do in the session.{' '}
        <button
          onClick={() => setReplacing(true)}
          disabled={busy}
          style={{ background: 'none', border: 'none', padding: 0, color: GLASS.inkMuted, textDecoration: 'underline', cursor: 'pointer', fontSize: 9 }}
        >
          Make a new plan
        </button>
      </div>
    </div>
  )
}
