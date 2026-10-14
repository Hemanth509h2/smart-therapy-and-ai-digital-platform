"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/icons";
import { handle } from "@/lib/anon";
import { timeAgo } from "@/lib/client";
import { category } from "@/lib/ui";
import SurveyAdmin from "@/components/SurveyAdmin";

type Status = "visible" | "hidden" | "deleted";
type Note = { id: string; category: string; body: string; status: Status; vote_count: number; comment_count: number; created_at: string; open_reports: number };
type Reply = { id: string; body: string; status: Status; is_op: boolean; vote_count: number; created_at: string; open_reports: number };
type Report = { target_type: "feedback" | "comment"; target_id: string; report_count: number; reasons: string[]; body: string | null; status: string | null };

const KEY = "fb.admin";

export default function Admin() {
  const [pw, setPw] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<"notes" | "reports" | "survey">("notes");
  const [filter, setFilter] = useState<"all" | "visible" | "hidden">("all");
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [replies, setReplies] = useState<Record<string, Reply[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(async (path: string, method = "GET", body?: unknown, password?: string) => {
    const res = await fetch(`/api/admin${path}`, {
      method,
      headers: { "x-admin-password": password ?? pw, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw Object.assign(new Error("Wrong password"), { status: 401 });
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }, [pw]);

  const loadNotes = useCallback(async (from: string | null = null, password?: string) => {
    const p = new URLSearchParams({ status: filter });
    if (from) p.set("cursor", from);
    const r = await call(`/notes?${p}`, "GET", undefined, password);
    setNotes((prev) => (from && prev ? [...prev, ...r.items] : r.items));
    setCursor(r.nextCursor);
  }, [call, filter]);

  const loadReports = useCallback(async (password?: string) => {
    setReports((await call("/reports", "GET", undefined, password)).items);
  }, [call]);

  async function signIn(password: string, silent = false) {
    setErr("");
    try {
      await call("/reports", "GET", undefined, password);
      setAuthed(true);
      try { sessionStorage.setItem(KEY, password); } catch {}
    } catch (e) {
      if (!silent) setErr((e as Error).message === "Wrong password" ? "That password isn't right. It's ADMIN_PASSWORD in feedback-board/.env." : (e as Error).message);
      try { sessionStorage.removeItem(KEY); } catch {}
    }
    setChecking(false);
  }

  // stay signed in across refreshes (this tab only)
  useEffect(() => {
    let saved = "";
    try { saved = sessionStorage.getItem(KEY) ?? ""; } catch {}
    if (saved) { setPw(saved); signIn(saved, true); } else setChecking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!authed) return;
    setErr("");
    if (tab === "survey") return;
    (tab === "notes" ? loadNotes() : loadReports()).catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, tab, filter, loadNotes, loadReports]);

  function signOut() {
    try { sessionStorage.removeItem(KEY); } catch {}
    setAuthed(false); setPw(""); setNotes(null); setReports(null);
  }

  async function setStatus(type: "feedback" | "comment", id: string, status: Status, noteId?: string) {
    if (status === "deleted" && !confirm(`Delete this ${type === "feedback" ? "note" : "reply"}? It disappears from the board.`)) return;
    setBusy(id); setErr("");
    try {
      await call(`/${type}/${id}`, "PATCH", { status });
      if (type === "comment" && noteId) await loadReplies(noteId);
      if (tab === "notes") await loadNotes(); else await loadReports();
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  }

  async function loadReplies(id: string) {
    const r = await call(`/notes/${id}/replies`);
    setReplies((x) => ({ ...x, [id]: r.items }));
  }
  async function toggle(id: string) {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else { n.add(id); if (!replies[id]) await loadReplies(id).catch((e) => setErr(e.message)); }
    setOpen(n);
  }

  const Actions = ({ type, id, status, noteId }: { type: "feedback" | "comment"; id: string; status: Status | string | null; noteId?: string }) => (
    <div className="adm-acts">
      {status === "hidden" ? (
        <button disabled={busy === id} onClick={() => setStatus(type, id, "visible", noteId)}>Restore</button>
      ) : (
        <button disabled={busy === id} onClick={() => setStatus(type, id, "hidden", noteId)}>Hide</button>
      )}
      <button disabled={busy === id} className="danger" onClick={() => setStatus(type, id, "deleted", noteId)}>Delete</button>
    </div>
  );

  return (
    <>
      <header className="top">
        <Link className="brand" href="/"><Logo /><span>STAAD <b>Admin</b></span></Link>
        {authed && <button className="btn-text" onClick={signOut}>Sign out</button>}
      </header>

      <main className="page">
        <h1 className="page-title">Moderation</h1>
        <p className="page-sub">You moderate content, not people. This view shows the same anonymous data as the board.</p>

        {checking ? null : !authed ? (
          <form className="admin-login" onSubmit={(e) => { e.preventDefault(); signIn(pw); }}>
            <input type="password" placeholder="Admin password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <button className="btn-blue" disabled={!pw}>Sign in</button>
          </form>
        ) : (
          <>
            <div className="chips adm-tabs">
              <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>All notes</button>
              <button className={tab === "reports" ? "on" : ""} onClick={() => setTab("reports")}>Reported{reports?.length ? ` (${reports.length})` : ""}</button>
              <button className={tab === "survey" ? "on" : ""} onClick={() => setTab("survey")}>Survey</button>
            </div>

            {tab === "notes" && (
              <>
                <div className="adm-filter">
                  {(["all", "visible", "hidden"] as const).map((f) => (
                    <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "Everything" : f === "visible" ? "On the board" : "Hidden"}</button>
                  ))}
                </div>
                {notes === null ? <p className="page-sub">Loading…</p> : notes.length === 0 ? (
                  <div className="empty"><h3>No notes</h3><p>Nothing matches this filter.</p></div>
                ) : notes.map((n) => {
                  const c = category(n.category);
                  return (
                    <div className={`admin-card ${n.status === "hidden" ? "is-hidden" : ""}`} key={n.id}>
                      <div className="post-by">
                        <span className="name">{handle(n.id)}</span>
                        <span className="when">{timeAgo(n.created_at)}</span>
                        <span className="c-cat"><i style={{ background: c.color }} />{c.label}</span>
                        {n.status === "hidden" && <span className="status hidden">hidden</span>}
                        {n.open_reports > 0 && <span className="status deleted">{n.open_reports} report{n.open_reports === 1 ? "" : "s"}</span>}
                      </div>
                      <p className="post-text">{n.body}</p>
                      <div className="adm-row">
                        <span className="when">👍 {n.vote_count}</span>
                        {n.comment_count > 0 || replies[n.id]?.length ? (
                          <button className="toggle" onClick={() => toggle(n.id)}>{open.has(n.id) ? "Hide replies" : `Replies (${n.comment_count})`}</button>
                        ) : <span className="when">No replies</span>}
                        <Actions type="feedback" id={n.id} status={n.status} />
                      </div>
                      {open.has(n.id) && (
                        <div className="adm-replies">
                          {(replies[n.id] ?? []).length === 0 && <p className="when">No replies.</p>}
                          {(replies[n.id] ?? []).map((r) => (
                            <div className={`adm-reply ${r.status === "hidden" ? "is-hidden" : ""}`} key={r.id}>
                              <div className="post-by">
                                <span className="name">{r.is_op ? `${handle(n.id)} (author)` : handle(r.id)}</span>
                                <span className="when">{timeAgo(r.created_at)}</span>
                                {r.status === "hidden" && <span className="status hidden">hidden</span>}
                                {r.open_reports > 0 && <span className="status deleted">{r.open_reports} report{r.open_reports === 1 ? "" : "s"}</span>}
                              </div>
                              <p className="post-text">{r.body}</p>
                              <Actions type="comment" id={r.id} status={r.status} noteId={n.id} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {cursor && <button className="btn-text adm-more" onClick={() => loadNotes(cursor).catch((e) => setErr(e.message))}>Load more</button>}
              </>
            )}

            {tab === "survey" && <SurveyAdmin call={call} />}

            {tab === "reports" && (
              reports === null ? <p className="page-sub">Loading…</p> : reports.length === 0 ? (
                <div className="empty"><h3>All clear</h3><p>Nobody has reported anything.</p></div>
              ) : reports.map((r) => (
                <div className="admin-card" key={r.target_id}>
                  <div className="post-by">
                    <span className="name">{r.target_type === "feedback" ? "Note" : "Reply"}</span>
                    <span className="when">{r.report_count} report{r.report_count === 1 ? "" : "s"}</span>
                    <span className={`status ${r.status ?? ""}`}>{r.status === "visible" ? "on the board" : r.status ?? "gone"}</span>
                  </div>
                  <p className="post-text">{r.body}</p>
                  <div className="chip-row" style={{ marginBottom: 10 }}>
                    {[...new Set(r.reasons)].map((x) => <span key={x} className="cat-tag">{x}</span>)}
                  </div>
                  <Actions type={r.target_type} id={r.target_id} status={r.status} />
                </div>
              ))
            )}
          </>
        )}
        {err && <p className="error">{err}</p>}
      </main>
    </>
  );
}

