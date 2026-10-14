"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Menu, { MenuItem } from "@/components/Menu";
import QuickQuestion from "@/components/QuickQuestion";
import WaBar, { ReplyTarget, SimilarItem } from "@/components/WaBar";
import {
  BackIcon, ChevronDown, ChevronUp, CloseIcon, FlagIcon, LikeFilledIcon, LikeIcon, LinkIcon, Logo,
  SearchIcon, ShieldIcon, SortIcon, TrashIcon,
} from "@/components/icons";
import { avatarColor, handle, initial } from "@/lib/anon";
import { api, deviceToken, forgetOwn, newAuthorToken, ownTokens, rememberOwn, saveVoted, timeAgo, votedSet } from "@/lib/client";
import { CATEGORIES, category, compact, openPrivacy, openReport, openSurvey, toast } from "@/lib/ui";
import { surveyDone } from "@/components/Survey";

type Post = { id: string; category: string; body: string; vote_count: number; comment_count: number; created_at: string };
type Reply = { id: string; parent_id: string | null; body: string | null; removed: boolean; is_op: boolean; vote_count: number; created_at: string };

const Avatar = ({ id, size = 40 }: { id: string; size?: number }) => (
  <div className="av" style={{ width: size, height: size, fontSize: size * 0.42, background: avatarColor(id) }} aria-hidden>{initial(id)}</div>
);

/** Single-page board: feedback posts render as YouTube-style top-level comments, their comments as threaded replies. */
export default function Board() {
  const [items, setItems] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [sort, setSort] = useState<"top" | "new">("top");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [draftQ, setDraftQ] = useState("");
  const [sortOpen, setSortOpen] = useState(false);

  const [likedF, setLikedF] = useState<Set<string>>(new Set());
  const [likedC, setLikedC] = useState<Set<string>>(new Set());
  const [own, setOwn] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Record<string, Reply[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [surveyed, setSurveyed] = useState(false);

  useEffect(() => {
    setSurveyed(surveyDone());
    const on = () => setSurveyed(true);
    window.addEventListener("fb:survey-done", on);
    return () => window.removeEventListener("fb:survey-done", on);
  }, []);

  // Optional deep links: /?c=<category>&sort=new
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const c = sp.get("c");
    if (c && CATEGORIES.some((x) => x.key === c)) setCat(c);
    if (sp.get("sort") === "new") setSort("new");
    setReady(true);
  }, []);

  useEffect(() => { setLikedF(votedSet("f")); setLikedC(votedSet("c")); setOwn(ownTokens()); deviceToken(); }, []);

  const load = useCallback(async (from: string | null) => {
    setLoading(true); setErr("");
    try {
      const p = new URLSearchParams({ sort, total: "1" });
      if (cat) p.set("category", cat);
      if (q) p.set("q", q);
      if (from) p.set("cursor", from);
      const r = await api<{ items: Post[]; nextCursor: string | null; total: number }>(`/feedback?${p}`);
      setItems((prev) => (from ? [...prev, ...r.items.filter((x) => !prev.some((y) => y.id === x.id))] : r.items));
      setCursor(r.nextCursor);
      setTotal(r.total);
    } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }, [sort, cat, q]);

  useEffect(() => { if (ready) load(null); }, [load, ready]);

  // Shared links: /#f-<id> scrolls to (and if needed fetches) that post.
  useEffect(() => {
    const m = location.hash.match(/^#f-([0-9a-f-]{36})$/i);
    if (!m) return;
    const id = m[1];
    api<Post>(`/feedback/${id}`).then((p) => {
      setItems((xs) => (xs.some((x) => x.id === id) ? xs : [p, ...xs]));
      setTimeout(() => { document.getElementById(`f-${id}`)?.scrollIntoView({ block: "center" }); setFlash(id); }, 300);
    }).catch(() => toast("That post isn't available any more"));
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && load(cursor), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, load]);

  useEffect(() => { if (flash) { const t = setTimeout(() => setFlash(null), 2500); return () => clearTimeout(t); } }, [flash]);

  // ---------- threads ----------
  const loadThread = async (fid: string) => {
    const r = await api<{ items: Reply[] }>(`/feedback/${fid}/comments`);
    const list = [...r.items].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    setThreads((t) => ({ ...t, [fid]: list }));
    setItems((xs) => xs.map((x) => (x.id === fid ? { ...x, comment_count: list.filter((c) => !c.removed).length } : x)));
    return list;
  };
  const toggle = async (fid: string) => {
    const next = new Set(open);
    if (next.has(fid)) next.delete(fid);
    else { next.add(fid); if (!threads[fid]) await loadThread(fid).catch((e) => toast(e.message)); }
    setOpen(next);
  };

  // ---------- likes ----------
  async function likePost(id: string) {
    const on = !likedF.has(id);
    try {
      const r = await api<{ vote_count: number }>(`/feedback/${id}/vote`, on ? "PUT" : "DELETE", { device_token: deviceToken() });
      const s = new Set(likedF); on ? s.add(id) : s.delete(id); setLikedF(s); saveVoted("f", s);
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, vote_count: r.vote_count } : x)));
    } catch (e) { toast((e as Error).message); }
  }
  async function likeReply(fid: string, id: string) {
    const on = !likedC.has(id);
    try {
      const r = await api<{ vote_count: number }>(`/comments/${id}/vote`, on ? "PUT" : "DELETE", { device_token: deviceToken() });
      const s = new Set(likedC); on ? s.add(id) : s.delete(id); setLikedC(s); saveVoted("c", s);
      setThreads((t) => ({ ...t, [fid]: (t[fid] ?? []).map((c) => (c.id === id ? { ...c, vote_count: r.vote_count } : c)) }));
    } catch (e) { toast((e as Error).message); }
  }

  // ---------- posting ----------
  async function submit(text: string, cat: string) {
    if (replyTo) {
      const fid = replyTo.feedbackId;
      const token = own[fid] ?? newAuthorToken(); // the post's own token marks the poster's replies as the author
      const c = await api<Reply>(`/feedback/${fid}/comments`, "POST", { body: text, author_token: token }, true);
      rememberOwn(c.id, token); setOwn(ownTokens());
      await loadThread(fid);
      setOpen((o) => new Set(o).add(fid));
      setReplyTo(null);
      setFlash(c.id);
      setTimeout(() => document.getElementById(`c-${c.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
    } else {
      const token = newAuthorToken();
      const f = await api<Post>("/feedback", "POST", { category: cat, body: text, author_token: token }, true);
      rememberOwn(f.id, token); setOwn(ownTokens());
      setItems((xs) => [f, ...xs]);
      setTotal((n) => (n ?? 0) + 1);
      setFlash(f.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
      toast("Posted anonymously");
    }
  }

  function startReply(fid: string, h: string, quote: string) {
    setReplyTo({ feedbackId: fid, handle: h, quote });
    setFocusKey((k) => k + 1);
    if (!threads[fid]) loadThread(fid).catch(() => {});
  }

  // ---------- delete / share ----------
  async function deletePost(id: string) {
    if (!confirm("Delete your feedback? This can't be undone.")) return;
    try {
      await api(`/feedback/${id}`, "DELETE", { author_token: own[id] });
      forgetOwn(id); setOwn(ownTokens());
      setItems((xs) => xs.filter((x) => x.id !== id)); setTotal((n) => (n ? n - 1 : n));
      toast("Feedback deleted");
    } catch (e) { toast((e as Error).message); }
  }
  async function deleteReply(fid: string, id: string) {
    if (!confirm("Delete your reply?")) return;
    try {
      await api(`/comments/${id}`, "DELETE", { author_token: own[id] });
      forgetOwn(id); setOwn(ownTokens()); await loadThread(fid); toast("Reply deleted");
    } catch (e) { toast((e as Error).message); }
  }
  async function copyLink(id: string) {
    const url = `${location.origin}/#f-${id}`;
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast(url); }
  }

  // ---------- similar suggestions for the composer ----------
  const similarPool: SimilarItem[] = useMemo(() => {
    if (replyTo) {
      return (threads[replyTo.feedbackId] ?? []).filter((c) => c.body)
        .map((c) => ({ id: c.id, body: c.body!, vote_count: c.vote_count, liked: likedC.has(c.id) }));
    }
    return items.map((p) => ({ id: p.id, body: p.body, vote_count: p.vote_count, liked: likedF.has(p.id) }));
  }, [replyTo, threads, items, likedC, likedF]);

  const likeSimilar = (id: string) => (replyTo ? likeReply(replyTo.feedbackId, id) : likePost(id));

  return (
    <>
      <header className="top">
        {searching ? (
          <form className="top-search" onSubmit={(e) => { e.preventDefault(); setQ(draftQ.trim()); setSearching(false); }}>
            <button type="button" className="ib" onClick={() => setSearching(false)} aria-label="Back"><BackIcon /></button>
            <input autoFocus value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Search feedback" enterKeyHint="search" />
            {draftQ && <button type="button" className="ib" onClick={() => setDraftQ("")} aria-label="Clear"><CloseIcon /></button>}
            <button className="ib" aria-label="Search"><SearchIcon /></button>
          </form>
        ) : (
          <>
            <a className="brand" href="/"><Logo /><span>STAAD <b>Feedback</b></span></a>
            <button className="ib" onClick={() => { setDraftQ(q); setSearching(true); }} aria-label="Search"><SearchIcon /></button>
            <button className="ib" onClick={openPrivacy} aria-label="Privacy"><ShieldIcon /></button>
          </>
        )}
      </header>

      <main className="wrap">
        <section className="mini-hero">
          <p className="mh-eyebrow">STAAD · Smart Therapy &amp; AI Digital Platform</p>
          <h1>How did the demo land?</h1>
          <p>
            We&apos;re building STAAD for therapists and the people they care for. Tell us what worked, what didn&apos;t,
            and what you&apos;d change. No login, no names.
          </p>
          <div className="mh-row">
            <button className="mh-cta" onClick={() => { setReplyTo(null); setFocusKey((k) => k + 1); }}>Write a note</button>
            {surveyed ? (
              <span className="mh-done">Survey done · thanks</span>
            ) : (
              <button className="mh-cta secondary" onClick={openSurvey}>Take the 2-min survey</button>
            )}
          </div>
          <button className="mh-link" onClick={openPrivacy}>How we keep it anonymous</button>
          <QuickQuestion />
        </section>

        <div className="sec-head">
          <h2>{total === null ? "" : `${compact(total)} ${total === 1 ? "note" : "notes"}`}</h2>
          <div className="sortby">
            <button onClick={() => setSortOpen(!sortOpen)}><SortIcon />Sort by</button>
            {sortOpen && (
              <div className="pop" onMouseLeave={() => setSortOpen(false)}>
                <button className={sort === "top" ? "on" : ""} onClick={() => { setSort("top"); setSortOpen(false); }}>Top comments</button>
                <button className={sort === "new" ? "on" : ""} onClick={() => { setSort("new"); setSortOpen(false); }}>Newest first</button>
              </div>
            )}
          </div>
        </div>

        <div className="chips">
          <button className={!cat ? "on" : ""} onClick={() => setCat("")}>All</button>
          {CATEGORIES.map((c) => (
            <button key={c.key} className={cat === c.key ? "on" : ""} onClick={() => setCat(c.key)}>{c.plural}</button>
          ))}
        </div>

        {q && (
          <div className="results">
            Results for <b>&ldquo;{q}&rdquo;</b>
            <button onClick={() => { setQ(""); setDraftQ(""); }}>Clear</button>
          </div>
        )}
        {err && <p className="err">{err}</p>}

        <div className="list">
          {items.map((p) => {
            const cat = category(p.category);
            const h = handle(p.id);
            const replies = threads[p.id];
            const count = p.comment_count;
            const isOpen = open.has(p.id);
            const menu: MenuItem[] = [{ label: "Copy link", icon: <LinkIcon />, onClick: () => copyLink(p.id) }];
            if (own[p.id]) menu.push({ label: "Delete", icon: <TrashIcon />, onClick: () => deletePost(p.id), danger: true });
            menu.push({ label: "Report", icon: <FlagIcon />, onClick: () => openReport("feedback", p.id, () => setItems((xs) => xs.filter((x) => x.id !== p.id))) });

            return (
              <article key={p.id} id={`f-${p.id}`} className={`c ${flash === p.id ? "flash" : ""}`}>
                <div className="c-head">
                  <div className="c-av"><Avatar id={p.id} />{count > 0 && <i className="c-line" />}</div>
                  <div className="c-main">
                    <div className="c-by">
                      <span className="h">{h}</span>
                      <span className="t">{timeAgo(p.created_at)}</span>
                      {own[p.id] && <span className="you">you</span>}
                    </div>
                    <div className="c-cat"><i style={{ background: cat.color }} />{cat.label}</div>
                    <div className="c-text">{p.body}</div>
                    <div className="c-acts">
                      <button className={`yt-btn ${likedF.has(p.id) ? "on" : ""}`} onClick={() => likePost(p.id)} aria-label="Like" aria-pressed={likedF.has(p.id)}>
                        {likedF.has(p.id) ? <LikeFilledIcon /> : <LikeIcon />}<span>{p.vote_count ? compact(p.vote_count) : ""}</span>
                      </button>
                      <button className="yt-reply" onClick={() => startReply(p.id, h, p.body)}>Reply</button>
                    </div>
                  </div>
                  <Menu items={menu} small />
                </div>

                {count > 0 && (
                  <div className="c-thread">
                    <div className="tch tch-toggle">
                      <button className="toggle" onClick={() => toggle(p.id)}>
                        {compact(count)} {count === 1 ? "reply" : "replies"} {isOpen ? <ChevronUp /> : <ChevronDown />}
                      </button>
                    </div>
                    {isOpen && (replies ?? []).map((r) => {
                      const rh = r.is_op ? h : handle(r.id);
                      const rmenu: MenuItem[] = [];
                      if (own[r.id]) rmenu.push({ label: "Delete", icon: <TrashIcon />, onClick: () => deleteReply(p.id, r.id), danger: true });
                      rmenu.push({ label: "Report", icon: <FlagIcon />, onClick: () => openReport("comment", r.id, () => loadThread(p.id)) });
                      return (
                        <div key={r.id} id={`c-${r.id}`} className={`tch r ${flash === r.id ? "flash" : ""}`}>
                          <Avatar id={r.is_op ? p.id : r.id} size={24} />
                          <div className="c-main">
                            <div className="c-by">
                              {r.is_op ? <span className="h chip">{rh}</span> : <span className="h">{rh}</span>}
                              <span className="t">{timeAgo(r.created_at)}</span>
                              {own[r.id] && <span className="you">you</span>}
                            </div>
                            {r.removed ? <div className="c-text removed">This reply was removed</div> : <div className="c-text">{r.body}</div>}
                            {!r.removed && (
                              <div className="c-acts">
                                <button className={`yt-btn ${likedC.has(r.id) ? "on" : ""}`} onClick={() => likeReply(p.id, r.id)} aria-label="Like" aria-pressed={likedC.has(r.id)}>
                                  {likedC.has(r.id) ? <LikeFilledIcon /> : <LikeIcon />}<span>{r.vote_count ? compact(r.vote_count) : ""}</span>
                                </button>
                                <button className="yt-reply" onClick={() => startReply(p.id, rh, r.body ?? "")}>Reply</button>
                              </div>
                            )}
                          </div>
                          {!r.removed && <Menu items={rmenu} small />}
                        </div>
                      );
                    })}
                    {isOpen && !replies && <div className="tch r loading">Loading replies…</div>}
                  </div>
                )}
              </article>
            );
          })}

          {loading && Array.from({ length: items.length ? 2 : 5 }, (_, i) => (
            <div className="c sk" key={`sk${i}`} aria-hidden>
              <div className="c-head"><div className="av skb" /><div className="c-main"><i className="skb" style={{ width: "35%" }} /><i className="skb" style={{ width: "85%" }} /><i className="skb" style={{ width: "60%" }} /></div></div>
            </div>
          ))}
        </div>

        {!loading && items.length === 0 && !err && (
          <div className="empty">
            <h3>{q || cat ? "Nothing matches" : "It\u2019s quiet in here"}</h3>
            <p>{q || cat ? "Try a different search or category." : "Nobody has written anything yet. Yours can be the first note."}</p>
          </div>
        )}
        <div ref={sentinel} />
        {!loading && !cursor && items.length > 0 && <p className="end">You&apos;re all caught up</p>}
      </main>

      <WaBar replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSubmit={submit}
        similarPool={similarPool} onLikeSimilar={likeSimilar} focusKey={focusKey} />
    </>
  );
}
