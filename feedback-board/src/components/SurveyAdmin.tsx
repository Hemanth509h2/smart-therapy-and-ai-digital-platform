"use client";
import { useCallback, useEffect, useState } from "react";
import { timeAgo } from "@/lib/client";
import { KIND_LABELS, Question, QuestionKind, QuickResult } from "@/lib/survey";
import { ChevronDown, ChevronUp, CloseIcon } from "./icons";

type Call = (path: string, method?: string, body?: unknown) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Dist = { label: string; n: number };
type Result = Question & { answered: number; dist?: Dist[]; avg?: number | null; nps?: number | null; texts?: { txt: string; created_at: string }[] };
type AdminQuestion = Question & { answers: number };
type Draft = Omit<Question, "id" | "position" | "active">;

const NEW_DRAFT: Draft = { kind: "single", title: "", options: ["", ""], scale_min: 1, scale_max: 5, low_label: "", high_label: "", required: false };

/** Survey tab in /admin: results, the question editor and the quick-question editor. */
export default function SurveyAdmin({ call }: { call: Call }) {
  const [view, setView] = useState<"results" | "questions" | "quick">("results");
  return (
    <>
      <div className="adm-filter">
        <button className={view === "results" ? "on" : ""} onClick={() => setView("results")}>Results</button>
        <button className={view === "questions" ? "on" : ""} onClick={() => setView("questions")}>Edit questions</button>
        <button className={view === "quick" ? "on" : ""} onClick={() => setView("quick")}>Quick questions</button>
      </div>
      {view === "results" && <Results call={call} />}
      {view === "questions" && <QuestionsEditor call={call} />}
      {view === "quick" && <QuickEditor call={call} />}
    </>
  );
}

// ---------------------------------------------------------------- results

function Bars({ rows, total }: { rows: Dist[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <>
      {rows.map((r) => (
        <div className="sv-bar" key={r.label}>
          <span className="sv-bar-label" title={r.label}>{r.label}</span>
          <span className="sv-bar-track"><i style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="sv-bar-n">{r.n}<small> · {total ? Math.round((r.n / total) * 100) : 0}%</small></span>
        </div>
      ))}
    </>
  );
}

function Results({ call }: { call: Call }) {
  const [data, setData] = useState<{ responses: number; results: Result[]; quick: QuickResult[] } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    call("/survey").then((r) => {
      if (!Array.isArray(r?.results) || !Array.isArray(r?.quick)) throw new Error("The server sent unexpected data. Restart the dev server (npm run dev) and reload.");
      setData(r);
    }).catch((e) => setErr(e.message));
  }, [call]);
  if (err) return <p className="error">{err}</p>;
  if (!data) return <p className="page-sub">Loading…</p>;

  return (
    <>
      {data.quick.map((q) => (
        <div className={`admin-card sv-res ${q.active ? "" : "is-hidden"}`} key={q.id}>
          <h3>Quick · {q.question}{!q.active && <span className="status hidden" style={{ marginLeft: 8 }}>hidden</span>}</h3>
          <p className="when" style={{ margin: "-6px 0 10px" }}>{q.total} {q.total === 1 ? "answer" : "answers"}</p>
          <Bars rows={q.options.map((o) => ({ label: o, n: q.counts[o] ?? 0 }))} total={q.total} />
        </div>
      ))}

      <div className="sv-stats">
        <div className="admin-card"><b>{data.responses}</b><span>survey responses</span></div>
        {data.results.filter((r) => r.kind === "scale").slice(0, 2).map((r) => (
          <div className="admin-card" key={r.id}>
            <b>{r.nps != null ? r.nps : r.avg ?? "–"}{r.nps == null && r.avg != null && <small>/{r.scale_max}</small>}</b>
            <span>{r.nps != null ? "NPS · " : "avg. · "}{r.title}</span>
          </div>
        ))}
      </div>

      {data.responses === 0 && <div className="empty" style={{ marginBottom: 18 }}><h3>No survey answers yet</h3><p>Results appear here as soon as someone submits the survey.</p></div>}

      {data.responses > 0 && data.results.map((r, i) => (
        <div className="admin-card sv-res" key={r.id}>
          <h3>{i + 1}. {r.title}{!r.active && <span className="status hidden" style={{ marginLeft: 8 }}>archived</span>}</h3>
          <p className="when" style={{ margin: "-6px 0 10px" }}>
            {KIND_LABELS[r.kind]} · {r.answered} {r.answered === 1 ? "answer" : "answers"}
            {r.kind === "scale" && r.avg != null && ` · average ${r.avg}`}
            {r.nps != null && ` · NPS ${r.nps}`}
          </p>
          {r.dist && <Bars rows={r.dist} total={r.answered} />}
          {r.texts && (r.texts.length === 0 ? <p className="when">No written answers yet.</p> : r.texts.map((t, k) => (
            <div className="sv-answer" key={k}><p>{t.txt}</p><span className="when">{timeAgo(t.created_at)}</span></div>
          )))}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- question editor

function OptionsEditor({ options, onChange, max }: { options: string[]; onChange: (o: string[]) => void; max: number }) {
  return (
    <div className="qe-options">
      {options.map((o, i) => (
        <div className="qe-option" key={i}>
          <input value={o} maxLength={80} placeholder={`Option ${i + 1}`}
            onChange={(e) => onChange(options.map((x, k) => (k === i ? e.target.value : x)))} />
          <button type="button" className="icon-btn sm" aria-label="Remove option" disabled={options.length <= 2}
            onClick={() => onChange(options.filter((_, k) => k !== i))}><CloseIcon /></button>
        </div>
      ))}
      {options.length < max && <button type="button" className="qe-add" onClick={() => onChange([...options, ""])}>+ Add option</button>}
    </div>
  );
}

function QuestionForm({ draft, setDraft, lockKind }: { draft: Draft; setDraft: (d: Draft) => void; lockKind: boolean }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div className="qe-form">
      <label className="qe-field">
        <span>Question</span>
        <input value={draft.title} maxLength={200} placeholder="e.g. How easy was the booking flow?" onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="qe-row">
        <label className="qe-field">
          <span>Type</span>
          <select value={draft.kind} disabled={lockKind} onChange={(e) => {
            const kind = e.target.value as QuestionKind;
            setDraft({ ...draft, kind, options: (kind === "single" || kind === "multi") && draft.options.length < 2 ? ["", ""] : draft.options,
              scale_min: draft.scale_min ?? 1, scale_max: draft.scale_max ?? 5 });
          }}>
            {(Object.keys(KIND_LABELS) as QuestionKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="qe-check">
          <input type="checkbox" checked={draft.required} onChange={(e) => set("required", e.target.checked)} />
          Required
        </label>
      </div>
      {lockKind && <p className="when qe-hint">People have answered this question, so its type is locked.</p>}

      {(draft.kind === "single" || draft.kind === "multi") && (
        <div className="qe-field"><span>Options</span><OptionsEditor options={draft.options} max={12} onChange={(o) => set("options", o)} /></div>
      )}

      {draft.kind === "scale" && (
        <div className="qe-row">
          <label className="qe-field">
            <span>From</span>
            <select value={draft.scale_min ?? 1} onChange={(e) => set("scale_min", Number(e.target.value))}>
              <option value={0}>0</option><option value={1}>1</option>
            </select>
          </label>
          <label className="qe-field">
            <span>To</span>
            <select value={draft.scale_max ?? 5} onChange={(e) => set("scale_max", Number(e.target.value))}>
              {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="qe-field grow">
            <span>Low label</span>
            <input value={draft.low_label ?? ""} maxLength={40} placeholder="Not useful" onChange={(e) => set("low_label", e.target.value)} />
          </label>
          <label className="qe-field grow">
            <span>High label</span>
            <input value={draft.high_label ?? ""} maxLength={40} placeholder="Very useful" onChange={(e) => set("high_label", e.target.value)} />
          </label>
        </div>
      )}
      {draft.kind === "scale" && draft.scale_min === 0 && draft.scale_max === 10 && <p className="when qe-hint">A 0-10 scale also shows an NPS score in the results.</p>}
    </div>
  );
}

const toDraft = (q: Question): Draft => ({
  kind: q.kind, title: q.title, options: q.options.length ? q.options : ["", ""], scale_min: q.scale_min ?? 1, scale_max: q.scale_max ?? 5,
  low_label: q.low_label ?? "", high_label: q.high_label ?? "", required: q.required,
});

function QuestionsEditor({ call }: { call: Call }) {
  const [qs, setQs] = useState<AdminQuestion[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(() => call("/survey/questions").then((r) => {
    if (!Array.isArray(r?.questions)) throw new Error("The server sent unexpected data. Restart the dev server (npm run dev) and reload.");
    setQs(r.questions);
  }).catch((e) => setErr(e.message)), [call]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); await load(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  }
  const payload = (d: Draft) => ({ ...d, options: d.options.map((o) => o.trim()).filter(Boolean) });

  async function save() {
    const ok = await run(() => editing === "new" ? call("/survey/questions", "POST", payload(draft)) : call(`/survey/questions/${editing}`, "PATCH", payload(draft)));
    if (ok) setEditing(null);
  }
  async function remove(q: AdminQuestion) {
    const msg = q.answers > 0
      ? `"${q.title}" has ${q.answers} answers. It will be archived: hidden from the survey, but its results are kept.`
      : `Delete "${q.title}"?`;
    if (!confirm(msg)) return;
    await run(() => call(`/survey/questions/${q.id}`, "DELETE"));
  }

  if (!qs) return err ? <p className="error">{err}</p> : <p className="page-sub">Loading…</p>;
  const active = qs.filter((q) => q.active);
  const archived = qs.filter((q) => !q.active);

  return (
    <>
      <p className="page-sub">Changes go live on the board straight away. Questions people have already answered are archived instead of deleted, so results are kept.</p>

      {active.map((q, i) => (
        <div className="admin-card qe" key={q.id}>
          {editing === q.id ? (
            <>
              <QuestionForm draft={draft} setDraft={setDraft} lockKind={q.answers > 0} />
              <div className="qe-actions">
                <button className="btn-text" onClick={() => setEditing(null)}>Cancel</button>
                <button className="btn-blue" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </>
          ) : (
            <div className="qe-view">
              <div className="qe-move">
                <button className="icon-btn sm" aria-label="Move up" disabled={busy || i === 0} onClick={() => run(() => call(`/survey/questions/${q.id}`, "PATCH", { move: "up" }))}><ChevronUp /></button>
                <button className="icon-btn sm" aria-label="Move down" disabled={busy || i === active.length - 1} onClick={() => run(() => call(`/survey/questions/${q.id}`, "PATCH", { move: "down" }))}><ChevronDown /></button>
              </div>
              <div className="qe-main">
                <div className="qe-title">{i + 1}. {q.title}{q.required && <em> *</em>}</div>
                <div className="when">
                  {KIND_LABELS[q.kind]}
                  {q.kind === "scale" && ` · ${q.scale_min}-${q.scale_max}`}
                  {(q.kind === "single" || q.kind === "multi") && ` · ${q.options.length} options`}
                  {` · ${q.answers} ${q.answers === 1 ? "answer" : "answers"}`}
                </div>
                {(q.kind === "single" || q.kind === "multi") && <div className="qe-chips">{q.options.map((o) => <span key={o}>{o}</span>)}</div>}
              </div>
              <div className="adm-acts">
                <button onClick={() => { setEditing(q.id); setDraft(toDraft(q)); setErr(""); }}>Edit</button>
                <button className="danger" onClick={() => remove(q)}>{q.answers > 0 ? "Archive" : "Delete"}</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {editing === "new" ? (
        <div className="admin-card qe">
          <h3 className="qe-new-title">New question</h3>
          <QuestionForm draft={draft} setDraft={setDraft} lockKind={false} />
          <div className="qe-actions">
            <button className="btn-text" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-blue" disabled={busy} onClick={save}>{busy ? "Adding…" : "Add question"}</button>
          </div>
        </div>
      ) : (
        <button className="qe-add-q" onClick={() => { setEditing("new"); setDraft(NEW_DRAFT); setErr(""); }}>+ Add a question</button>
      )}

      {err && <p className="error">{err}</p>}

      {archived.length > 0 && (
        <div className="qe-archived">
          <button className="adm-filter-btn" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "Hide" : "Show"} archived questions ({archived.length})
          </button>
          {showArchived && archived.map((q) => (
            <div className="admin-card qe is-hidden" key={q.id}>
              <div className="qe-view">
                <div className="qe-main">
                  <div className="qe-title">{q.title}</div>
                  <div className="when">{KIND_LABELS[q.kind]} · {q.answers} answers</div>
                </div>
                <div className="adm-acts">
                  <button onClick={() => run(() => call(`/survey/questions/${q.id}`, "PATCH", { active: true }))}>Restore</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- quick questions editor

type QuickDraft = { question: string; options: string[] };
const NEW_QUICK: QuickDraft = { question: "", options: ["", ""] };

function QuickForm({ draft, setDraft }: { draft: QuickDraft; setDraft: (d: QuickDraft) => void }) {
  return (
    <div className="qe-form">
      <label className="qe-field">
        <span>Question</span>
        <input value={draft.question} maxLength={150} placeholder="e.g. Was the demo easy to follow?" onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
      </label>
      <div className="qe-field">
        <span>Answers (2 to 6, keep them short)</span>
        <OptionsEditor options={draft.options} max={6} onChange={(o) => setDraft({ ...draft, options: o })} />
      </div>
    </div>
  );
}

function QuickEditor({ call }: { call: Call }) {
  const [qs, setQs] = useState<QuickResult[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<QuickDraft>(NEW_QUICK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => call("/quick").then((r) => {
    if (!Array.isArray(r?.questions)) throw new Error("The server sent unexpected data. Restart the dev server (npm run dev) and reload.");
    setQs(r.questions);
  }).catch((e) => setErr(e.message)), [call]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); await load(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  }
  const clean = (d: QuickDraft) => ({ question: d.question, options: d.options.map((o) => o.trim()).filter(Boolean) });

  async function save(q?: QuickResult) {
    if (q) {
      const next = clean(draft);
      const changed = next.question.trim() !== q.question || JSON.stringify(next.options) !== JSON.stringify(q.options);
      if (changed && q.total > 0 && !confirm(`Changing this question or its answers clears its ${q.total} current answers. Continue?`)) return;
    }
    const ok = await run(() => (q ? call(`/quick/${q.id}`, "PATCH", clean(draft)) : call("/quick", "POST", clean(draft))));
    if (ok) setEditing(null);
  }

  if (!qs) return err ? <p className="error">{err}</p> : <p className="page-sub">Loading…</p>;
  const active = qs.filter((q) => q.active);
  const hidden = qs.filter((q) => !q.active);

  const Card = ({ q, i }: { q: QuickResult; i: number }) => (
    <div className={`admin-card qe ${q.active ? "" : "is-hidden"}`}>
      {editing === q.id ? (
        <>
          <QuickForm draft={draft} setDraft={setDraft} />
          {q.total > 0 && <p className="when qe-hint" style={{ marginTop: 10 }}>Saving a change to the text or answers clears its {q.total} answers.</p>}
          <div className="qe-actions">
            <button className="btn-text" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-blue" disabled={busy} onClick={() => save(q)}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </>
      ) : (
        <div className="qe-view">
          {q.active && (
            <div className="qe-move">
              <button className="icon-btn sm" aria-label="Move up" disabled={busy || i === 0} onClick={() => run(() => call(`/quick/${q.id}`, "PATCH", { move: "up" }))}><ChevronUp /></button>
              <button className="icon-btn sm" aria-label="Move down" disabled={busy || i === active.length - 1} onClick={() => run(() => call(`/quick/${q.id}`, "PATCH", { move: "down" }))}><ChevronDown /></button>
            </div>
          )}
          <div className="qe-main">
            <div className="qe-title">{q.active ? `${i + 1}. ` : ""}{q.question}</div>
            <div className="when">{q.total} {q.total === 1 ? "answer" : "answers"}{q.active ? "" : " · hidden from the board"}</div>
            <div className="qe-chips">{q.options.map((o) => <span key={o}>{o} · {q.counts[o] ?? 0}</span>)}</div>
          </div>
          <div className="adm-acts">
            <button onClick={() => { setEditing(q.id); setDraft({ question: q.question, options: q.options }); setErr(""); }}>Edit</button>
            <button onClick={() => run(() => call(`/quick/${q.id}`, "PATCH", { active: !q.active }))}>{q.active ? "Hide" : "Show"}</button>
            {q.total > 0 && <button onClick={() => confirm(`Clear the ${q.total} answers to "${q.question}"?`) && run(() => call(`/quick/${q.id}`, "PATCH", { reset: true }))}>Clear</button>}
            <button className="danger" onClick={() => confirm(`Delete "${q.question}"${q.total ? ` and its ${q.total} answers` : ""}?`) && run(() => call(`/quick/${q.id}`, "DELETE"))}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <p className="page-sub">One-tap questions shown one at a time at the top of the board, and rotating on the projector screen. Changes go live straight away.</p>
      {active.map((q, i) => <Card key={q.id} q={q} i={i} />)}
      {active.length === 0 && <div className="empty" style={{ marginBottom: 18 }}><h3>No quick questions on the board</h3><p>Add one below, or show a hidden one.</p></div>}

      {editing === "new" ? (
        <div className="admin-card qe">
          <h3 className="qe-new-title">New quick question</h3>
          <QuickForm draft={draft} setDraft={setDraft} />
          <div className="qe-actions">
            <button className="btn-text" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-blue" disabled={busy} onClick={() => save()}>{busy ? "Adding…" : "Add quick question"}</button>
          </div>
        </div>
      ) : (
        <button className="qe-add-q" onClick={() => { setEditing("new"); setDraft(NEW_QUICK); setErr(""); }}>+ Add a quick question</button>
      )}
      {err && <p className="error">{err}</p>}

      {hidden.length > 0 && (
        <>
          <p className="when" style={{ margin: "8px 0 12px" }}>Hidden from the board</p>
          {hidden.map((q, i) => <Card key={q.id} q={q} i={i} />)}
        </>
      )}
    </>
  );
}
