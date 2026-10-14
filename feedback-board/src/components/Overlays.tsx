"use client";
import { useEffect, useState } from "react";
import { api, deviceToken } from "@/lib/client";
import { toast } from "@/lib/ui";
import { CloseIcon } from "./icons";
import Captcha from "./Captcha";

/** Toasts, report dialog, create-post dialog and the shared CAPTCHA widget - mounted once in the layout. */
export default function Overlays() {
  return (
    <>
      <Toaster />
      <ReportDialog />
      <PrivacyDialog />
      <div className="captcha-slot"><Captcha /></div>
    </>
  );
}

function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3000);
    };
    window.addEventListener("fb:toast", on);
    return () => window.removeEventListener("fb:toast", on);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PrivacyDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("fb:privacy", on);
    return () => window.removeEventListener("fb:privacy", on);
  }, []);
  if (!open) return null;
  return (
    <Dialog title="How anonymous is this?" onClose={() => setOpen(false)}>
      <ul className="privacy-list">
        <li><strong>No account, no sign-in.</strong> We never collect your name, email or account.</li>
        <li><strong>No IP address stored.</strong> It&apos;s only used as a daily-salted hash in memory to stop spam.</li>
        <li><strong>Only your text is saved</strong>, with the time rounded to the minute.</li>
        <li><strong>Delete from this browser.</strong> Your posts are linked to a secret kept in this browser. Clearing browser data means you can&apos;t delete them later.</li>
        <li><strong>Be careful what you write.</strong> Writing style or personal details in the text can still identify you.</li>
      </ul>
      <div className="dialog-foot"><button className="btn-blue" onClick={() => setOpen(false)}>Got it</button></div>
    </Dialog>
  );
}

const REASONS = ["Spam or advertising", "Harassment or bullying", "Hateful or abusive content", "Contains personal information", "Something else"];

function ReportDialog() {
  const [target, setTarget] = useState<{ type: "feedback" | "comment"; id: string; onDone?: () => void } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { setTarget((e as CustomEvent).detail); setReason(""); };
    window.addEventListener("fb:report", on);
    return () => window.removeEventListener("fb:report", on);
  }, []);
  if (!target) return null;

  async function send() {
    if (!target) return;
    setBusy(true);
    try {
      await api("/reports", "POST", { target_type: target.type, target_id: target.id, reason, device_token: deviceToken() }, true);
      toast("Thanks - our team will review it");
      target.onDone?.();
      setTarget(null);
    } catch (e) { toast((e as Error).message); }
    setBusy(false);
  }

  return (
    <Dialog title={`Report ${target.type === "feedback" ? "post" : "comment"}`} onClose={() => setTarget(null)}>
      <div className="radio-list">
        {REASONS.map((r) => (
          <label key={r} className="radio">
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
            <span>{r}</span>
          </label>
        ))}
      </div>
      <div className="dialog-foot">
        <button className="btn-text" onClick={() => setTarget(null)}>Cancel</button>
        <button className="btn-blue" disabled={!reason || busy} onClick={send}>Report</button>
      </div>
    </Dialog>
  );
}
