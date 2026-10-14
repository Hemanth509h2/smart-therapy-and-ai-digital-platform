import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const icon = (d: string) =>
  function Icon(props: P) {
    return <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden {...props}><path d={d} /></svg>;
  };

export const SearchIcon = icon("M20.87 20.17l-5.59-5.59A6.96 6.96 0 0017 10c0-3.87-3.13-7-7-7s-7 3.13-7 7 3.13 7 7 7c1.74 0 3.33-.64 4.58-1.71l5.59 5.59.7-.71zM10 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z");
export const PlusIcon = icon("M20 12h-8v8h-1v-8H3v-1h8V3h1v8h8v1z");
export const LikeIcon = icon("M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h14.43c1.06 0 1.98-.67 2.19-1.61l1.34-6c.27-1.24-.78-2.39-2.19-2.39zM7 20H4v-8h3v8zm12.98-6.83-1.34 6c-.1.48-.61.83-1.21.83H8v-8.61l5.6-6.06c.19-.21.48-.33.78-.33.26 0 .5.11.63.3.07.1.15.26.09.47l-1.52 4.94-.4 1.29h5.58c.41 0 .8.17 1.03.46.13.15.26.4.19.71z");
export const LikeFilledIcon = icon("M3 11h3v10H3V11zm15.77 0h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11v10h10.43c1.06 0 1.98-.67 2.19-1.61l1.34-6c.27-1.24-.78-2.39-2.19-2.39z");
export const CommentIcon = icon("M8 7h8v1H8V7zm0 4h8v-1H8v1zm-5 9.71V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H7.71L3 21.71zM4 19.29 7.29 16H19c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1v14.29z");
export const ShareIcon = icon("M15 5.63 20.66 12 15 18.37V14h-1c-3.96 0-7.14 1-9.75 3.09 1.84-4.07 5.11-6.4 9.89-7.1l.86-.13V5.63M14 3v6C6.22 10.13 3.11 15.33 2 21c2.78-3.97 6.44-6 12-6v6l8-8-8-8z");
export const BackIcon = icon("M21 11v1H5.64l6.72 6.72-.71.71-7.93-7.93 7.92-7.92.71.71L5.64 11H21z");
export const CloseIcon = icon("M12.7 12l6.65 6.65-.7.7L12 12.71l-6.65 6.64-.7-.7L11.29 12 4.65 5.35l.7-.7L12 11.29l6.65-6.64.7.7L12.71 12z");
export const ShieldIcon = icon("M12 2 4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm7 9.09c0 4.4-2.94 8.5-7 9.6-4.06-1.1-7-5.2-7-9.6V5.7l7-2.63 7 2.63v5.39z");
export const SortIcon = icon("M21 6H3V5h18v1zm-6 5H3v1h12v-1zm-6 6H3v1h6v-1z");
export const FlagIcon = icon("M13.18 4l.24 1.2.16.8H19v7h-5.18l-.24-1.2-.16-.8H6V4h7.18M14 3H5v18h1v-9h6.6l.4 2h7V5h-5.6L14 3z");
export const TrashIcon = icon("M11 17H9V8h2v9zm4-9h-2v9h2V8zm4-4v1h-1v16H6V5H5V4h4V3h6v1h4zm-2 1H7v15h10V5z");
export const ChevronDown = icon("M12 15.7 5.6 9.4l.8-.8 5.6 5.7 5.6-5.7.8.8z");
export const ChevronUp = icon("M18.4 14.6 12 8.3l-6.4 6.3.8.8 5.6-5.7 5.6 5.7z");

export const HomeIcon = icon("M12 4.44l7 6.09V20h-4v-6H9v6H5v-9.47l7-6.09m0-1.32-8 6.96V21h6v-6h4v6h6V10.08l-8-6.96z");
export const HomeFilledIcon = icon("M4 21V10.08l8-6.96 8 6.96V21h-6v-6h-4v6H4z");
export const FireIcon = icon("M12 22c-4.41 0-8-3.36-8-7.5 0-3.29 2.09-5.52 3.92-7.48.64-.69 1.25-1.34 1.73-1.98l.79-1.04.69 1.11C12.42 7.18 13.41 8.5 14.5 8.5c.55 0 .93-.36 1.2-1.04l.55-1.38.93 1.16C18.86 9.33 20 11.67 20 14.5c0 4.14-3.59 7.5-8 7.5zm-1.66-15.6c-.37.43-.78.87-1.2 1.32C7.5 9.48 5.5 11.62 5.5 14.5c0 3.31 2.92 6 6.5 6s6.5-2.69 6.5-6c0-1.84-.6-3.5-1.67-5.07-.53.4-1.17.57-1.83.57-1.62 0-2.88-1.22-4.16-3.6z");
export const FireFilledIcon = icon("M12 22c-4.41 0-8-3.36-8-7.5 0-3.29 2.09-5.52 3.92-7.48.64-.69 1.25-1.34 1.73-1.98l.79-1.04.69 1.11C12.42 7.18 13.41 8.5 14.5 8.5c.55 0 .93-.36 1.2-1.04l.55-1.38.93 1.16C18.86 9.33 20 11.67 20 14.5c0 4.14-3.59 7.5-8 7.5z");
export const CreateIcon = icon("M12 2a10 10 0 100 20 10 10 0 000-20zm0 1a9 9 0 110 18 9 9 0 010-18zm-.5 4.5v4h-4v1h4v4h1v-4h4v-1h-4v-4h-1z");
export const SendIcon = icon("M3 20.5V14l8-2-8-2V3.5L22 12 3 20.5z");

export const EmojiIcon = icon("M12 3a9 9 0 100 18 9 9 0 000-18zm0 1.2a7.8 7.8 0 110 15.6 7.8 7.8 0 010-15.6zM8.8 8.8a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zm6.4 0a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4zM7.6 13.4l-1.1.5c1 2.3 3.1 3.8 5.5 3.8s4.5-1.5 5.5-3.8l-1.1-.5c-.8 1.9-2.5 3.1-4.4 3.1s-3.6-1.2-4.4-3.1z");
export const TagIcon = icon("M3 3h8.6l9.7 9.7-8.6 8.6L3 11.6V3zm1.2 1.2v6.9l8.5 8.5 6.9-6.9-8.5-8.5H4.2zM7.5 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3z");
export const LinkIcon = icon("M14 7h3a5 5 0 010 10h-3v-1h3a4 4 0 000-8h-3V7zm-4 0v1H7a4 4 0 000 8h3v1H7A5 5 0 017 7h3zm-2 4.5h8v1H8v-1z");

export function MoreIcon(props: P) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden {...props}>
      <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1f4136" />
      <path d="M9 10.5A2.5 2.5 0 0111.5 8h9A2.5 2.5 0 0123 10.5v6a2.5 2.5 0 01-2.5 2.5H15l-4 3.5V19h.5A2.5 2.5 0 019 16.5v-6z" fill="#f6f2ea" />
      <path d="M12.5 12.5h7M12.5 15.5h4.5" stroke="#b07b4f" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
