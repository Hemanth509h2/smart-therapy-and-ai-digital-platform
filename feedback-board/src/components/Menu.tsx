"use client";
import { useEffect, useRef, useState } from "react";
import { MoreIcon } from "./icons";

export type MenuItem = { label: string; icon?: React.ReactNode; onClick: () => void; danger?: boolean };

export default function Menu({ items, small }: { items: MenuItem[]; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className={`icon-btn ${small ? "sm" : ""}`} onClick={() => setOpen(!open)} aria-label="More actions" aria-expanded={open}>
        <MoreIcon />
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={it.danger ? "danger" : ""} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
