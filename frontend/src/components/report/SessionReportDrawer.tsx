'use client';

import React, { useEffect, useState } from 'react';
import { Drawer, EmptyState, toast } from '@/components/practice/ui';
import SessionReportView from '@/components/report/SessionReportView';
import { Loader2, Sparkles, RefreshCw, Pencil, Save } from 'lucide-react';
import { fmtListDate, fullName, type PracticeSession } from '@/lib/practice';
import { apiFetch } from '@/lib/api';

// View / generate / edit the AI session report for one session. Shared by the
// Sessions list and the client profile's Session History tab.
export default function SessionReportDrawer({
  session,
  onClose,
}: {
  session: PracticeSession | null;
  onClose: () => void;
}) {
  const [report, setReport] = useState<any>(null);
  const [reportStats, setReportStats] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [savingReport, setSavingReport] = useState(false);

  useEffect(() => {
    setEditing(false);
    setReport(null);
    if (!session) return;
    setReportLoading(true);
    apiFetch(`/api/session-report?sessionId=${session.id}`)
      .then((r) => r.ok ? r.json() : { report: null, stats: null })
      .then((d) => {
        setReport(d.report);
        setReportStats(d.stats);
      })
      .catch(() => setReport(null))
      .finally(() => setReportLoading(false));
  }, [session]);

  const generateReport = async (sessionId: string) => {
    setGenerating(true);
    try {
      const res = await apiFetch('/api/session-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate report');
      setReport(data.report);
      setReportStats(data.stats);
      toast('Report generated successfully');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not generate report', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const saveReport = async () => {
    if (!session || !report) return;
    setSavingReport(true);
    try {
      const res = await apiFetch('/api/session-report', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, content: draft }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setReport(data.report);
      setEditing(false);
      toast('Report updated');
    } catch (e) {
      toast('Could not save report changes', 'error');
    } finally {
      setSavingReport(false);
    }
  };

  return (
    <Drawer
      open={!!session}
      onClose={onClose}
      title="Session report"
      subtitle={session ? `${fullName(session.client)} · ${fmtListDate(session.scheduledAt)}` : undefined}
      wide
    >
      {reportLoading || generating ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--ds-clay)' }} />
          <p className="ds-muted text-[13.5px]">{generating ? 'Generating report…' : 'Loading…'}</p>
        </div>
      ) : !report ? (
        <EmptyState compact title="No report yet" body="Generate an AI draft from the session transcript and notes.">
          {session && (
            <button className="ds-btn ds-btn-clay" onClick={() => generateReport(session.id)}>
              <Sparkles className="h-4 w-4" /> Generate report
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="ds-muted text-[12px]">
              {report.editedByTherapist ? 'Edited by therapist' : 'AI-generated draft'}
              {report.model ? ` · ${report.model}` : ''}
            </span>
            {!editing && session && (
              <div className="flex gap-2">
                <button className="ds-btn ds-btn-sm ds-btn-outline" onClick={() => generateReport(session.id)}>
                  <RefreshCw className="h-4 w-4" /> Regenerate
                </button>
                <button
                  className="ds-btn ds-btn-sm ds-btn-clay"
                  onClick={() => {
                    setDraft(report.content);
                    setEditing(true);
                  }}
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              </div>
            )}
          </div>
          {editing ? (
            <>
              <textarea
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                className="ds-input leading-relaxed"
                style={{ minHeight: '60vh', resize: 'vertical' }}
                aria-label="Report content"
              />
              <div className="flex justify-end gap-2">
                <button className="ds-btn ds-btn-sm ds-btn-ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="ds-btn ds-btn-sm ds-btn-clay" onClick={saveReport} disabled={savingReport}>
                  {savingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-2xl p-5" style={{ background: '#ffffff', border: '1px solid var(--ds-border)' }}>
              <SessionReportView
                content={report.content}
                stats={reportStats}
                meta={{
                  clientName: fullName(session?.client) || undefined,
                  dateLabel: new Date(report.generatedAt || session?.scheduledAt || Date.now()).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }),
                  statusLabel: report.editedByTherapist ? 'Edited by therapist' : 'AI-generated draft',
                }}
              />
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
