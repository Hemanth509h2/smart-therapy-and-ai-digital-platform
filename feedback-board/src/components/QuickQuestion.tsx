"use client";
import { useEffect, useRef, useState } from "react";
import { api, deviceToken } from "@/lib/client";
import type { QuickResult } from "@/lib/survey";
import { toast } from "@/lib/ui";
import { BackIcon } from "./icons";

const KEY = "fb.quick.v2"; // { [questionId]: { v: version, a: answer } }
const AUTO_MS = 6000;      // auto-scroll every 6 s (only while the current question is answered)
const RESUME_MS = 8000;    // after someone interacts, wait 8 s before auto-scrolling again

type Mine = Record<string, { v: number; a: string }>;

function readMine(): Mine {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; }
}

/**
 * Quick questions, one at a time ("1 of 3", arrows, dots, swipe).
 * Stays on a question until it is answered, then moves on to the next unanswered one. Auto-scroll (every 6 s)
 * only runs on answered questions - in practice once everything is answered, to show the live results.
 * It pauses on hover, touch, focus or any interaction, when the tab is hidden, or with reduced motion.
 */
export default function QuickQuestions() {
  const [qs, setQs] = useState<QuickResult[] | null>(null);
  const [mine, setMine] = useState<Mine>({});
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    api<{ questions: QuickResult[] }>("/quick").then((r) => {
      if (!Array.isArray(r?.questions)) return setQs([]);
      const saved = readMine();
      // a remembered answer only counts for the same version of the question
      const valid: Mine = {};
      for (const q of r.questions) if (saved[q.id]?.v === q.version && q.options.includes(saved[q.id].a)) valid[q.id] = saved[q.id];
      setMine(valid);
      setQs(r.questions);
      const first = r.questions.findIndex((q) => !valid[q.id]);
      setI(first < 0 ? 0 : first);
    }).catch(() => setQs([]));

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onMq = () => setReduced(mq.matches);
    const onVis = () => setVisible(document.visibilityState === "visible");
    mq.addEventListener("change", onMq);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer.current); clearTimeout(pauseTimer.current);
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const n = qs?.length ?? 0;
  const current = qs && n ? qs[Math.min(i, n - 1)] : null;
  const currentAnswered = !!current && !!mine[current.id];
  // Never auto-scroll away from a question that hasn't been answered yet.
  const playing = n > 1 && currentAnswered && !hover && !paused && visible && !reduced && !busy;

  // auto-scroll
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => { setDir(1); setI((x) => (x + 1) % n); }, AUTO_MS);
    return () => clearTimeout(t);
  }, [playing, i, n]);

  if (!qs || n === 0) return null;
  const idx = Math.min(i, n - 1);
  const q = qs[idx];
  const my = mine[q.id]?.a;

  /** Someone used the card: pause auto-scroll, resume after a quiet period. */
  function interacted() {
    setPaused(true);
    clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => setPaused(false), RESUME_MS);
  }

  function show(k: number, d: 1 | -1) {
    clearTimeout(timer.current);
    setDir(d);
    setI(((k % n) + n) % n);
  }

  async function answer(a: string) {
    if (busy || a === my) return;
    interacted();
    setBusy(true);
    try {
      const r = await api<QuickResult>("/quick", "POST", { question_id: q.id, answer: a, device_token: deviceToken() });
      const nextMine = { ...mine, [q.id]: { v: r.version, a } };
      setMine(nextMine);
      setQs((xs) => xs!.map((x) => (x.id === q.id ? r : x)));
      try { localStorage.setItem(KEY, JSON.stringify({ ...readMine(), [q.id]: { v: r.version, a } })); } catch {}
      // after a first answer, move on to the next unanswered question
      const next = qs!.findIndex((x, k) => k > idx && !nextMine[x.id]);
      const target = next < 0 ? qs!.findIndex((x) => !nextMine[x.id]) : next;
      if (!my && target >= 0) { clearTimeout(timer.current); timer.current = setTimeout(() => show(target, 1), 1400); }
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }

  const go = (d: 1 | -1) => { interacted(); show(idx + d, d); };
  const answeredCount = qs.filter((x) => mine[x.id]).length;

  return (
    <div
      className="qq"
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onFocus={interacted}
      onTouchStart={(e) => { interacted(); touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null || n < 2) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 45) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="qq-head">
        <span className="qq-label">
          Quick question{n > 1 ? ` · ${idx + 1} of ${n}` : ""}
        </span>
        {n > 1 ? (
          <span className="qq-nav">
            <button onClick={() => go(-1)} aria-label="Previous question"><BackIcon /></button>
            <button onClick={() => go(1)} aria-label="Next question" className="flip"><BackIcon /></button>
          </span>
        ) : my && <span className="qq-total">{q.total} {q.total === 1 ? "answer" : "answers"}</span>}
      </div>

      <div className={`qq-slide ${dir > 0 ? "from-right" : "from-left"}`} key={q.id} aria-live="polite">
        <p className="qq-q">{q.question}</p>
        <div className={`qq-opts ${my ? "done" : ""}`}>
          {q.options.map((o) => {
            const pct = my && q.total ? Math.round(((q.counts[o] ?? 0) / q.total) * 100) : 0;
            return (
              <button key={o} className={my === o ? "on" : ""} disabled={busy} onClick={() => answer(o)} aria-pressed={my === o}>
                {my && <i style={{ width: `${pct}%` }} />}
                <span>{o}</span>
                {my && <b>{pct}%</b>}
              </button>
            );
          })}
        </div>
      </div>

      {n > 1 && (
        <div className="qq-foot">
          <span className="qq-dots">
            {qs.map((x, k) => (
              <button key={x.id} className={`${k === idx ? "cur" : ""} ${mine[x.id] ? "ans" : ""}`}
                onClick={() => { interacted(); show(k, k >= idx ? 1 : -1); }}
                aria-label={`Question ${k + 1}${mine[x.id] ? " (answered)" : ""}`}>
                {k === idx && playing && <i key={`${idx}-${q.id}`} style={{ animationDuration: `${AUTO_MS}ms` }} />}
              </button>
            ))}
          </span>
          <span className="qq-total">{my ? `${q.total} ${q.total === 1 ? "answer" : "answers"} · ` : ""}{answeredCount}/{n} answered</span>
        </div>
      )}
    </div>
  );
}
