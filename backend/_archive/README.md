# Archive

Code that nothing in the backend imports, moved here on 2026-10-16 during the
backend restructure instead of being deleted. It is excluded from `tsconfig.json`,
so it is not built or type-checked, and its imports still point at the old
`src/lib` layout.

- `lib/` — old `src/lib` helpers: `practice`, `progressApi`, `session-diary`,
  `sessionEvents`, `translation`, `utils`, `firebase` (client SDK),
  `modules/writeModuleState`, `voice/*`. Most are browser-side code; the frontend
  has its own copies.
- `app/api/deepgram-token/` — the old Deepgram STT token route. Live STT uses Sarvam.

To bring a file back, move it into `src/` and fix its imports.
