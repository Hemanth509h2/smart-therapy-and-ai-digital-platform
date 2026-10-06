'use client';

import React, { useEffect, useState } from 'react';
import { fetchClientNotes, createNote, type ProgressNote } from '@/lib/progressApi';

const CARD =
  'rounded-[14px] border-[0.5px] border-[var(--glass-border)] shadow-[var(--glass-shadow)] bg-[var(--glass-bg)] dark:bg-[#16221e]';

interface Props {
  clientId: string;
  reportId?: string;
}

export default function TherapistNotesInput({ clientId, reportId }: Props) {
  const [notes, setNotes] = useState<ProgressNote[]>([]);
  const [content, setContent] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchClientNotes(clientId)
      .then((n) => !cancelled && setNotes(n))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const note = await createNote({ clientId, content: content.trim(), reportId, isPrivate });
      setNotes((prev) => [note, ...prev]);
      setContent('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${CARD} p-6`}>
      <h3 className="font-heading text-lg mb-4" style={{ color: 'var(--ink)' }}>
        Therapist Notes
      </h3>

      <form onSubmit={handleSubmit} className="space-y-3 mb-6">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Add a clinical progress note for this client..."
          rows={3}
          className="w-full rounded-lg border border-[var(--glass-border)] bg-transparent p-3 text-sm outline-none focus:ring-2 focus:ring-[var(--sage)]"
          style={{ color: 'var(--ink)' }}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private (therapist-only)
          </label>
          <button
            type="submit"
            disabled={saving || !content.trim()}
            className="rounded-full px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--c-accent)' }}
          >
            {saving ? 'Saving…' : 'Add Note'}
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </form>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--sage)] border-t-transparent" />
        </div>
      ) : notes.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-muted)' }}>
          No notes yet. Notes you add here track this client's clinical progress over time.
        </p>
      ) : (
        <ul className="space-y-3 max-h-96 overflow-y-auto pr-1">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-[var(--glass-border)] p-3">
              <p className="text-sm" style={{ color: 'var(--ink)' }}>
                {n.content}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                <span>{new Date(n.createdAt).toLocaleString()}</span>
                {n.isPrivate && (
                  <span className="rounded-full px-1.5 py-0.5" style={{ background: 'var(--c-accent-bg)', color: 'var(--c-accent)' }}>
                    Private
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
