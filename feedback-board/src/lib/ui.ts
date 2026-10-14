"use client";
// Tiny global UI events so any component can raise a toast, the report dialog or the composer.

export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("fb:toast", { detail: message }));
}

export function openReport(type: "feedback" | "comment", id: string, onDone?: () => void) {
  window.dispatchEvent(new CustomEvent("fb:report", { detail: { type, id, onDone } }));
}

export function openPrivacy() {
  window.dispatchEvent(new CustomEvent("fb:privacy"));
}

export function openSurvey() {
  window.dispatchEvent(new CustomEvent("fb:survey"));
}

export const CATEGORIES = [
  { key: "idea", label: "Idea", plural: "Ideas", color: "#b07b4f", emoji: "💡" },
  { key: "issue", label: "Issue", plural: "Issues", color: "#c8473a", emoji: "🐞" },
  { key: "praise", label: "Praise", plural: "Praise", color: "#2e7d57", emoji: "🎉" },
  { key: "question", label: "Question", plural: "Questions", color: "#3b6ba5", emoji: "❓" },
] as const;

export const category = (key: string) => CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];

export const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
