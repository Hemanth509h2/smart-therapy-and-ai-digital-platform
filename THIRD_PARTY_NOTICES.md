# Third-party licences

STAAD itself is proprietary (see `LICENSE`). It is built on open-source
software and assets whose licences allow commercial, closed-source use. This
file records what was checked and the obligations that apply.

Checked on 5 November 2026 against the production dependencies in each
`package-lock.json` (dev-only packages excluded) and `ai/requirements.txt`.

## Summary

| App | Production packages | Licences found |
|---|---|---|
| `frontend` | 695 | MIT, Apache-2.0, ISC, BSD-2/3-Clause, LGPL-3.0 (`sharp`), OFL-1.1, BlueOak, Zlib, 0BSD, CC0, Unlicense, MPL-2.0, CC-BY-4.0 |
| `backend-express` | 183 | MIT, Apache-2.0, ISC, BSD-2/3-Clause, BlueOak, Zlib, 0BSD, MIT-0, MPL-2.0 (dual) |
| `ai` (Python) | 5 | websockets (BSD-3-Clause), gunicorn (MIT), pypdf (BSD-3-Clause), psycopg (LGPL-3.0), pytest (MIT, test only) |

No GPL, AGPL, SSPL, BUSL or non-commercial licence is used in production.
Packages the lockfile listed without a licence were checked by hand:
`khroma` (MIT), `webgl-constants` (MIT), `rgbcolor` (MIT-style "feel free").

## Obligations

- **Permissive licences (MIT, BSD, ISC, Apache-2.0, Zlib, BlueOak):** keep
  their copyright and licence notices in what we distribute. The production
  builds keep the notices that ship inside each package; do not strip
  `LICENSE` files or `@license` comments from bundles.
- **Apache-2.0** (e.g. `@mediapipe/tasks-vision`, `firebase`, `livekit`
  packages): also keep any `NOTICE` file and note if we modify the code. We
  do not modify them.
- **MPL-2.0** (`@vercel/analytics`; `dompurify` is MPL-2.0 *or* Apache-2.0):
  file-level copyleft. Fine to use unmodified; if we ever edit one of their
  files, that file's source must be made available under MPL-2.0.
- **LGPL-3.0** (`sharp`'s `libvips` binaries, used by Next.js image handling
  in `frontend`; `psycopg` in `ai`): used as unmodified, dynamically loaded
  libraries, which the LGPL allows in closed-source software. If we modify
  them, the modified library source must be released and users must be able
  to replace it.
- **CC-BY-4.0** (`caniuse-lite`, browser-support data used at build time):
  attribution — data © the Can I Use contributors (caniuse.com).
- **OFL-1.1 fonts:** DM Sans, DM Serif Display, Manrope and Sora (self-hosted
  through the `@fontsource` packages) are under the SIL Open Font License 1.1:
  free to use and embed; the fonts may not be sold on their own.
- **Noto Emoji** (loaded from jsDelivr in the Drag & Drop Sorting module):
  Apache-2.0 (images) — © Google LLC.
- **MediaPipe face-landmark model** (`frontend/public/mediapipe`, downloaded
  at build time): Apache-2.0 — © Google LLC.

## Assets that still need a source on record

Before launch, record where each of these came from and under what licence
(a link to the purchase, the licence page or the generator's terms):

- 3D models: `frontend/public/assets/story-worlds/*.glb` (no author or licence
  metadata in the files).
- Sounds: the `.mp3` and `.wav` files under `frontend/public`.
- Lottie animations: the `.json` animations under `frontend/public`.
- AI-generated images (files named `ChatGPT Image …`): generated with OpenAI's
  ChatGPT; OpenAI's terms assign the output to the user. Keep a note of the
  account that generated them.
- Other module artwork under `frontend/public/assets` and
  `frontend/public/assests`.
