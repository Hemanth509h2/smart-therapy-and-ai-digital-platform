"use client";
import { useState } from "react";
import { category } from "@/lib/ui";

type Row = { target_type: "feedback" | "comment"; target_id: string; report_count: number; reasons: string[]; body: string | null; status: string | null };

export default function Admin() {
  const [pw, setPw] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  async function call(path: string, method = "GET", body?: unknown) {
    const res = await fetch(`/api/admin${path}`, {
      method,
      headers: { "x-admin-password": pw, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }
  async function load() {
    setErr("");
    try { setRows((await call("/reports")).items); } catch (e) { setErr((e as Error).message); setRows(null); }
  }
  async function act(r: Row, status: "visible" | "hidden" | "deleted") {
    try { await call(`/${r.target_type}/${r.target_id}`, "PATCH", { status }); await load(); } catch (e) { setErr((e as Error).message); }
  }

  return (
    <main className="page">
      <h1 className="page-title">Moderation queue</h1>
      <p className="page-sub">You moderate content, not people - this view shows the same anonymous data as everyone else.</p>
      {rows === null ? (
        <form className="admin-login" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <input type="password" placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          <button className="btn-blue" disabled={!pw}>Sign in</button>
        </form>
      ) : rows.length === 0 ? (
        <div className="empty"><h3>All clear</h3><p>No open reports right now.</p></div>
      ) : (
        rows.map((r) => (
          <div className="admin-card" key={r.target_id}>
            <div className="post-by">
              <span className="name">{r.target_type === "feedback" ? "Post" : "Comment"}</span>
              <span className="when">{r.report_count} report{r.report_count === 1 ? "" : "s"}</span>
              <span className={`status ${r.status ?? ""}`}>{r.status ?? "gone"}</span>
            </div>
            <p className="post-text">{r.body}</p>
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {[...new Set(r.reasons)].map((x) => <span key={x} className="cat-tag" style={{ background: "var(--raised)" }}>{x}</span>)}
            </div>
            <div className="dialog-foot" style={{ justifyContent: "flex-start", marginTop: 0 }}>
              <button className="btn-text" onClick={() => act(r, "visible")}>Restore</button>
              <button className="btn-text" onClick={() => act(r, "hidden")}>Hide</button>
              <button className="btn-text" style={{ color: "var(--danger)" }} onClick={() => act(r, "deleted")}>Delete</button>
            </div>
          </div>
        ))
      )}
      {err && <p className="error">{err}</p>}
    </main>
  );
}
