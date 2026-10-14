"use client";
import { useEffect, useRef, useState } from "react";
import { findSimilar } from "@/lib/similarity";
import { CATEGORIES, category, compact } from "@/lib/ui";
import { CloseIcon, EmojiIcon, LikeFilledIcon, LikeIcon, SendIcon, TagIcon } from "./icons";

export type ReplyTarget = { feedbackId: string; handle: string; quote: string };
export type SimilarItem = { id: string; body: string; vote_count: number; liked: boolean };

const EMOJIS = ["👍", "❤️", "😂", "🔥", "👏", "🙏", "🎉", "😮", "🤔", "💡", "✅", "🚀"];

/** WhatsApp-style composer pinned to the bottom of the page: new feedback, or a reply when replyTo is set. */
export default function WaBar({ replyTo, onCancelReply, onSubmit, similarPool, onLikeSimilar, focusKey }: {
  replyTo: ReplyTarget | null;
  onCancelReply: () => void;
  onSubmit: (text: string, category: string) => Promise<void>;
  similarPool: SimilarItem[];
  onLikeSimilar: (id: string) => void;
  focusKey: number;
}) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState("idea");
  const [tray, setTray] = useState<"emoji" | "category" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [similar, setSimilar] = useState<SimilarItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (focusKey) ref.current?.focus(); }, [focusKey]);
  useEffect(() => { setErr(""); setTray(null); }, [replyTo]);

  // Similar suggestions (design: >=12 chars, 250ms debounce, local trigram match, top 3).
  useEffect(() => {
    setDismissed(false);
    if (text.trim().length < 12) return setSimilar([]);
    const t = setTimeout(() => setSimilar(findSimilar(text, similarPool)), 250);
    return () => clearTimeout(t);
  }, [text, similarPool]);

  // Auto-grow up to ~5 lines, like WhatsApp
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  async function send() {
    if (!text.trim() || busy) return;
    setErr(""); setBusy(true); setTray(null);
    try { await onSubmit(text.trim(), cat); setText(""); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  function insertEmoji(e: string) {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    setText(text.slice(0, at) + e + text.slice(at));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length); });
  }

  const c = category(cat);

  return (
    <div className="wa">
      {!dismissed && similar.length > 0 && (
        <div className="wa-card">
          <div className="wa-card-head">
            <span>{replyTo ? "Someone already replied this way." : "Someone already said something similar."} Like it instead?</span>
            <button onClick={() => setDismissed(true)} aria-label="Dismiss"><CloseIcon /></button>
          </div>
          {similar.map((s) => (
            <div className="wa-sim" key={s.id}>
              <p>{s.body}</p>
              <button className={`yt-btn ${s.liked ? "on" : ""}`} onClick={() => onLikeSimilar(s.id)} aria-label="Like">
                {s.liked ? <LikeFilledIcon /> : <LikeIcon />}<span>{s.vote_count ? compact(s.vote_count) : ""}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {tray === "emoji" && (
        <div className="wa-card wa-emojis">
          {EMOJIS.map((e) => <button key={e} onClick={() => insertEmoji(e)}>{e}</button>)}
        </div>
      )}
      {tray === "category" && !replyTo && (
        <div className="wa-card wa-cats">
          <div className="wa-card-head"><span>What kind of note is this?</span></div>
          <div className="wa-cat-grid">
            {CATEGORIES.map((x) => (
              <button key={x.key} className={cat === x.key ? "on" : ""} onClick={() => { setCat(x.key); setTray(null); ref.current?.focus(); }}>
                <span className="wa-cat-dot" style={{ background: x.color }} />{x.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <div className="wa-err">{err}</div>}

      <div className="wa-row">
        <div className="wa-input">
          {replyTo && (
            <div className="wa-quote">
              <div>
                <b>Replying to {replyTo.handle}</b>
                <p>{replyTo.quote}</p>
              </div>
              <button onClick={onCancelReply} aria-label="Cancel reply"><CloseIcon /></button>
            </div>
          )}
          <div className="wa-line">
            <button className="wa-ico" onClick={() => setTray(tray === "emoji" ? null : "emoji")} aria-label="Emoji"><EmojiIcon /></button>
            <textarea ref={ref} rows={1} maxLength={replyTo ? 1000 : 2000} value={text}
              placeholder={replyTo ? "Write a reply" : `Write a note · ${c.label}`}
              onChange={(e) => setText(e.target.value)}
              onFocus={() => tray === "emoji" || setTray(null)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
            {!replyTo && (
              <button className="wa-ico wa-catbtn" onClick={() => setTray(tray === "category" ? null : "category")} aria-label={`Category: ${c.label}`}>
                {text ? <span className="wa-cat-dot" style={{ background: c.color }} /> : <TagIcon />}
              </button>
            )}
          </div>
        </div>
        <button className="wa-send" disabled={!text.trim() || busy} onClick={send} aria-label="Send"><SendIcon /></button>
      </div>
    </div>
  );
}
