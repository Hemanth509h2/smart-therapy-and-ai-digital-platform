"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { timeAgo } from "@/lib/client";
import { category } from "@/lib/ui";

type Post = { id: string; category: string; body: string; vote_count: number; comment_count: number; created_at: string };

/** Projector screen for conferences and meetings: a big QR code to the board, plus the latest feedback live. */
export default function Present() {
  const [url, setUrl] = useState("");
  const [svg, setSvg] = useState("");
  const [latest, setLatest] = useState<Post[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    const target = process.env.NEXT_PUBLIC_PUBLIC_URL || window.location.origin;
    setUrl(target.replace(/^https?:\/\//, ""));
    QRCode.toString(target, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c2a25", light: "#ffffff" } })
      .then(setSvg);
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/feedback?sort=new&total=1", { cache: "no-store" }).then((x) => x.json());
        if (!alive) return;
        setLatest((r.items ?? []).slice(0, 2));
        setTotal(r.total ?? 0);
      } catch {}
    };
    poll();
    const t = setInterval(poll, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div className="present">
      <div className="present-left">
        <div className="kicker">STAAD · Smart Therapy &amp; AI Digital Platform</div>
        <h1>How did the demo land?</h1>
        <p>Scan the code and leave a note: an idea, a question, something that bugged you. No app, no login, no names.</p>
        <div className="present-url">{url}</div>
        {total !== null && (
          <div className="present-stats">
            <div><b>{total}</b><span>{total === 1 ? "note" : "notes"} so far</span></div>
          </div>
        )}
      </div>
      <div className="present-right">
        <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for ${url}`} />
        <div className="ticker" aria-live="polite">
          {latest.map((p) => (
            <div className="ticker-item" key={p.id}>
              <small><i style={{ background: category(p.category).color }} />{category(p.category).label} · {timeAgo(p.created_at)}</small>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
