"use client";
import { useEffect, useState } from "react";
import { api, deviceToken } from "@/lib/client";
import type { AnswerValue, Question } from "@/lib/survey";
import { CloseIcon } from "./icons";

export const SURVEY_DONE_KEY = "fb.survey-done";

export function surveyDone(): boolean {
  try { return localStorage.getItem(SURVEY_DONE_KEY) === "1"; } catch { return false; }
}

function Multi({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="sv-opts">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button type="button" key={o} className={`sv-opt ${on ? "on" : ""}`} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>{o}</button>
        );
      })}
    </div>
  );
}

function Single({ options, value, onChange }: { options: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="sv-opts">
      {options.map((o) => (
        <button type="button" key={o} className={`sv-opt ${value === o ? "on" : ""}`} aria-pressed={value === o}
          onClick={() => onChange(value === o ? null : o)}>{o}</button>
      ))}
    </div>
  );
}

function Scale({ from, to, value, onChange, low, high }: { from: number; to: number; value: number | null; onChange: (n: number) => void; low: string; high: string }) {
  const nums = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <>
      <div className={`sv-scale ${nums.length > 5 ? "nps" : ""}`} style={{ gridTemplateColumns: `repeat(${nums.length}, 1fr)` }}>
        {nums.map((n) => (
          <button type="button" key={n} className={value === n ? "on" : ""} aria-pressed={value === n} onClick={() => onChange(n)}>{n}</button>
        ))}
      </div>
      <div className="sv-ends"><span>{low}</span><span>{high}</span></div>
    </>
  );
}

function Field({ q, value, onChange }: { q: Question; value: AnswerValue | undefined; onChange: (v: AnswerValue | undefined) => void }) {
  switch (q.kind) {
    case "scale":
      return <Scale from={q.scale_min ?? 1} to={q.scale_max ?? 5} value={typeof value === "number" ? value : null}
        onChange={onChange} low={q.low_label ?? ""} high={q.high_label ?? ""} />;
    case "single":
      return <Single options={q.options} value={typeof value === "string" ? value : null} onChange={(v) => onChange(v ?? undefined)} />;
    case "multi":
      return <Multi options={q.options} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    case "text":
      return <textarea className="sv-text" rows={3} maxLength={1000} value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)} placeholder={q.required ? "" : "Optional"} />;
  }
}

/** The quick survey, opened from the board. Questions come from the database (edited in /admin). */
export default function Survey() {
  const [open, setOpen] = useState(false);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [a, setA] = useState<Record<string, AnswerValue | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const on = () => {
      setOpen(true); setErr(""); setSent(surveyDone());
      api<{ questions: Question[] }>("/survey").then((r) => setQuestions(r.questions)).catch((e) => setErr(e.message));
    };
    window.addEventListener("fb:survey", on);
    return () => window.removeEventListener("fb:survey", on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;
  const filled = (v: AnswerValue | undefined) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);
  const missing = (questions ?? []).filter((q) => q.required && !filled(a[q.id]));
  const ready = !!questions && missing.length === 0 && (questions ?? []).some((q) => filled(a[q.id]));

  function finish() {
    try { localStorage.setItem(SURVEY_DONE_KEY, "1"); } catch {}
    window.dispatchEvent(new CustomEvent("fb:survey-done"));
    setSent(true);
  }

  async function submit() {
    if (!ready) return;
    setBusy(true); setErr("");
    try {
      await api("/survey", "POST", { answers: a, device_token: deviceToken() }, true);
      finish();
      setA({});
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("already answered")) finish();
      else setErr(msg);
    }
    setBusy(false);
  }

  const requiredNums = (questions ?? []).map((q, i) => (q.required ? i + 1 : 0)).filter(Boolean);

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog sv" role="dialog" aria-modal aria-label="Quick survey">
        <div className="dialog-head">
          <h2>{sent ? "Thank you" : "Quick survey"}</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><CloseIcon /></button>
        </div>

        {sent ? (
          <div className="sv-done">
            <p>Your answers are in. They go straight to the team building STAAD, with nothing that identifies you.</p>
            <p>Want to say more? Leave a note on the board - others can reply and like it.</p>
            <div className="dialog-foot">
              <button className="btn-blue" onClick={() => setOpen(false)}>Back to the board</button>
            </div>
          </div>
        ) : questions === null ? (
          <p className="sv-intro">{err || "Loading…"}</p>
        ) : questions.length === 0 ? (
          <p className="sv-intro">There&apos;s no survey right now.</p>
        ) : (
          <>
            <p className="sv-intro">
              About {Math.max(1, Math.round(questions.length / 4))} minute{questions.length > 6 ? "s" : ""}.
              {requiredNums.length ? " Questions marked * are required." : ""} Anonymous, like the rest of the board.
            </p>

            {questions.map((q, i) => (
              <section className="sv-q" key={q.id}>
                <h3>{i + 1}. {q.title} {q.required && <em>*</em>}</h3>
                <Field q={q} value={a[q.id]} onChange={(v) => setA((x) => ({ ...x, [q.id]: v }))} />
              </section>
            ))}

            <p className="sv-note">Please don&apos;t include names, emails, phone numbers or your clinic&apos;s name.</p>
            {err && <p className="error">{err}</p>}
            <div className="dialog-foot sv-foot">
              {missing.length > 0 && <span className="count">Answer question{requiredNums.length > 1 ? "s" : ""} {requiredNums.join(" and ")} to submit</span>}
              <button className="btn-text" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-blue" disabled={!ready || busy} onClick={submit}>{busy ? "Sending…" : "Submit"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
