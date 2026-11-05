'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { DsDialog, Field, toast } from './ui';
import { apiFetch } from '@/lib/api';
import { apiErrorMessage, caughtErrorMessage } from '@/lib/apiError';

type Quality = 'GOOD' | 'SOME_ISSUES' | 'POOR';

const QUALITY: { value: Quality; label: string }[] = [
  { value: 'GOOD', label: 'Clear' },
  { value: 'SOME_ISSUES', label: 'Some problems' },
  { value: 'POOR', label: 'Hard to use' },
];

const RATING_WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

/**
 * Asked on the dashboard right after the therapist ends a video call (the
 * session room redirects to /?feedback=<sessionId>). Answers go to
 * POST /api/sessions/:id/feedback and show on the admin "Bugs & feedback" page.
 */
export function SessionFeedbackDialog({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setRating(0);
    setHover(0);
    setQuality(null);
    setComment('');
  }, [sessionId]);

  const submit = async () => {
    if (!sessionId || !rating) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, callQuality: quality, comment: comment.trim() }),
      });
      if (!res.ok) throw new Error(await apiErrorMessage(res, 'send your feedback'));
      toast('Thanks for your feedback.');
      onClose();
    } catch (e) {
      toast(caughtErrorMessage(e, 'send your feedback'), 'error');
    } finally {
      setSending(false);
    }
  };

  const shown = hover || rating;

  return (
    <DsDialog
      open={!!sessionId}
      onOpenChange={(o) => !o && onClose()}
      title="How did the session go?"
      description="Your answer helps us improve video sessions. It takes a few seconds."
      footer={
        <>
          <button className="ds-btn ds-btn-ghost" onClick={onClose}>
            Skip
          </button>
          <button className="ds-btn ds-btn-clay" onClick={submit} disabled={!rating || sending}>
            {sending && <Loader2 className="animate-spin" />}
            Send feedback
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <div className="flex justify-center gap-1" role="radiogroup" aria-label="Rating from 1 to 5 stars" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}: ${RATING_WORDS[n]}`}
                className="rounded-lg p-1 transition-transform hover:scale-110"
                onMouseEnter={() => setHover(n)}
                onFocus={() => setHover(n)}
                onBlur={() => setHover(0)}
                onClick={() => setRating(n)}
              >
                <Star
                  size={32}
                  strokeWidth={1.5}
                  color={n <= shown ? '#e0a92e' : 'var(--ds-border-strong)'}
                  fill={n <= shown ? '#f5c451' : 'transparent'}
                />
              </button>
            ))}
          </div>
          <p className="mt-1 h-5 text-center text-[13px]" style={{ color: 'var(--ds-muted)' }}>
            {RATING_WORDS[shown]}
          </p>
        </div>

        <Field label="Video and sound (optional)" htmlFor="sf-quality">
          <div id="sf-quality" className="grid grid-cols-3 gap-2">
            {QUALITY.map((q) => {
              const on = quality === q.value;
              return (
                <button
                  key={q.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setQuality(on ? null : q.value)}
                  className={on ? 'ds-btn ds-btn-sm ds-btn-clay' : 'ds-btn ds-btn-sm ds-btn-outline'}
                >
                  {q.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Anything else? (optional)" htmlFor="sf-comment" hint="Please don't include the client's personal or health details.">
          <textarea
            id="sf-comment"
            className="ds-input"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What worked, or what got in the way"
          />
        </Field>
      </div>
    </DsDialog>
  );
}
