# How STAAD Feedback works

STAAD Feedback is a small website where people at a conference or meeting leave anonymous feedback about
STAAD (Smart Therapy & AI Digital Platform) after seeing a demo. Anyone with the link can read, post,
reply and like. There are no accounts and no sign-in.

It is a separate Next.js app in `feedback-board/`, built from
`docx/Anonymous-Feedback-Comment-System-Design.docx`.

---

## 1. The three pages

| Page | Who uses it | What it does |
|---|---|---|
| `/` | Attendees (on their phones) | The board: read notes, post a note, reply, like, report |
| `/present` | The presenter (on the projector) | Big QR code to the board, live note count, latest notes |
| `/admin` | The team | Password-protected moderation: hide, restore or delete notes and replies |

### A typical meeting

1. The presenter opens `/present` on the projector.
2. Attendees scan the QR code, which opens `/` on their phone.
3. They read what others wrote, then type in the bar at the bottom and press send.
4. New notes show up on the projector within 10 seconds.
5. Afterwards the team reviews everything in `/admin`.

---

## 2. The board (`/`)

The whole board is one page.

- **Top section:** "How did the demo land?", a **Write a note** button (jumps to the typing bar), a **Take the 2-min survey** button (see section 6a) and a link to the privacy explanation.
- **Note count, Sort by (Top / Newest) and category tabs** (All, Ideas, Issues, Praise, Questions).
- **Notes:** laid out like YouTube comments. Each note shows:
  - a nickname such as `@quiet-otter-94`
  - the time ("5 minutes ago")
  - the category
  - the text
  - **Like**, **Reply** and a **⋮** menu (Copy link, Delete if it is yours, Report)
- **Replies:** "*n* replies" opens the thread under the note, joined by curved lines. Replies from the person who wrote the note are marked with the note's nickname as a highlighted label.
- **Typing bar (WhatsApp-style), fixed at the bottom:**
  - emoji picker, text box, category picker (Idea / Issue / Praise / Question) and send button
  - Enter sends; Shift+Enter makes a new line
  - pressing **Reply** shows a "Replying to @…" quote above the text box
- **Similar suggestions:** while someone types, notes or replies that say nearly the same thing appear above the bar, so they can like one instead of posting a duplicate (see section 5).
- **Search:** the search icon in the top bar searches note text.
- **Loading:** 20 notes at a time; more load automatically as you scroll.
- **Share links:** "Copy link" gives `/#f-<note id>`. Opening it scrolls to that note and highlights it.

### Nicknames

Nicknames like `@brave-lynx-f2` are generated from the note's or reply's random ID. They are only for
readability. They are not stored and not linked to a person, and the same person gets a different
nickname on every note.

---

## 3. How anonymity works

The goal (from the design doc): **no row in the feedback database can be traced back to a person**, even
by someone with full database access.

| Data | Stored? | How |
|---|---|---|
| Note and reply text | Yes | Plain text, length-limited (2000 / 1000 characters) |
| Category | Yes | Idea, Issue, Praise or Question |
| Time | Yes | Rounded down to the minute, to make timing matches harder |
| Name, email, account | No | Never collected; there are no accounts |
| IP address, browser info | No | IP is only turned into a daily-salted hash in memory for rate limits |
| Author key | Yes, hashed | SHA-256 of a random secret kept in the poster's browser |
| Like / report key | Yes, keyed hash | HMAC of a random browser token and the item ID |

### Deleting your own posts without an account

1. When you post, the browser creates a random 128-bit **author token** and keeps it in `localStorage` (`fb.own`).
2. The server stores only `SHA-256(author token)`.
3. To delete, the browser sends the token, and the server compares hashes.
4. If you clear your browser data, the token is gone, and so is your ability to delete that post.

### One like per device

1. Each browser creates a random **device token** (`fb.device` in `localStorage`).
2. The server stores `HMAC(server secret, device token + item ID)`.
3. The same browser can't like an item twice. Keys differ for every item, so one person's likes can't be grouped together.
4. This is a soft limit: a different browser or cleared storage can like again. Rate limits cap that.

### What it does *not* protect against

Someone watching live network traffic at the server, or a person being recognised from their writing
style or details they include in the text. The privacy dialog on the board says this plainly.

---

## 4. How a request flows

```
 Phone / laptop browser                    Next.js app (feedback-board)                    Postgres (Neon)
 ─────────────────────                     ────────────────────────────                    ───────────────
 Board, typing bar         ── HTTPS ──▶     API route (src/app/api/...)
 localStorage:                               1. rate limit (salted IP hash, in memory)
   author tokens                             2. CAPTCHA check (Turnstile, if configured)
   device token                              3. validate + block emails/phones/blocklist
   liked items                               4. hash author token / HMAC device token  ── SQL ──▶  feedback
                                             5. read/write                                      comments
                           ◀── JSON ──       6. respond (never returns hashes or keys)          votes
                                                                                                 comment_votes
                                                                                                 reports
```

- **Browser code:** `src/app/page.tsx` (board), `src/components/WaBar.tsx` (typing bar) and `src/lib/client.ts` (tokens, API calls).
- **Server code:** `src/app/api/**/route.ts`, plus shared helpers in `src/lib/` (`http.ts`, `crypto.ts`, `ratelimit.ts`, `filter.ts`, `db.ts`).

### Spam control

| Action | Limit per IP hash | Extra check |
|---|---|---|
| New note | 5 per hour | CAPTCHA |
| New reply | 20 per hour | CAPTCHA |
| Likes (notes and replies together) | 60 per hour | One per device per item |
| Reports | 10 per day | CAPTCHA, one per device per item |

- **Rate limits:** counted against a hash of the IP. The hash salt is random, kept only in memory, and changes every UTC day, so yesterday's hashes can't be recomputed.
- **CAPTCHA:** uses Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set. Without them (local development) it is skipped.
- **Content filter:** text containing an email address, a phone number or a word from `BLOCKLIST` is rejected before it is saved.

---

## 5. Similar suggestions

While someone types (at least 12 characters, checked 250 ms after they stop typing), the browser compares
the draft with what is already loaded. When replying, it compares against that thread's replies; when
writing a new note, against the loaded notes.

1. Both texts are normalised: lowercase, punctuation and common stop words removed, numbers kept.
2. They are split into 3-letter chunks (trigrams).
3. The score is the overlap of the two chunk sets (Jaccard similarity, 0 to 1).
4. Up to 3 matches scoring **0.45 or more** are shown, best first, each with a like button.

Matching runs entirely in the browser, so the draft never leaves the device. Code: `src/lib/similarity.ts`.

A server endpoint, `POST /api/feedback/:id/comments/similar`, does the same with Postgres `pg_trgm` for
very large threads (over 300 replies). The current board does not call it; it is there for when threads
get that large.

---

## 6. Moderation

- **Reporting:** anyone can report a note or reply from the ⋮ menu, picking a reason.
- **Auto-hide:** when an item has **3 open reports** (`AUTO_HIDE_REPORTS`), it is hidden from the board automatically.
- **Admin page** (`/admin`):
  - **All notes:** every note, with filters *Everything / On the board / Hidden*. Each note and reply has **Hide / Restore / Delete**.
  - **Reported:** the report queue with reasons. Acting on an item marks its reports resolved.
- **Admin sign-in:**
  - The password is `ADMIN_PASSWORD` from `.env`. It is sent in an `x-admin-password` header and compared in constant time.
  - It stays signed in for that browser tab (`sessionStorage`) until **Sign out**.
- **Same data as everyone:** admins moderate content, not people. The admin view shows the same anonymous data as the board.

### Retention

- **Deleted notes and replies** are soft-deleted (hidden immediately) and permanently removed after 30 days.
- **Resolved reports** are removed after 90 days.

The cleanup runs whenever the admin report queue is loaded.

---

## 6a. Quick survey

The **Take the 2-min survey** button on the board opens a short, anonymous form. The questions are stored in
the database (`survey_questions`) and **edited in `/admin` → Survey → Edit questions**. Changes go live straight away.

### Default questions (questions 1 and 6 are required)

1. How useful does STAAD look for therapy practice? *(rating 1-5)*
2. Which features stood out? *(multiple choice)*
3. What felt confusing, slow or missing? *(text)*
4. What would stop you from using it? *(multiple choice)*
5. Which languages do you need? *(multiple choice)*
6. How likely are you to recommend STAAD to a colleague? *(rating 0-10, gives an NPS score)*
7. What's one thing we should build next? *(text)*
8. Your role *(single choice)*
9. Would you try a pilot? *(single choice)*
10. Anything else? *(text)*

### Editing questions (admin)

- **Question types:**
  - **Rating scale:** from 0 or 1 up to 3-10, with optional low and high labels. A 0-10 scale also gets an NPS score.
  - **Single choice** and **multiple choice:** 2 to 12 options.
  - **Text answer.**
- **Changes you can make:** add, edit, mark required, and move up or down.
- **Removing:**
  - A question nobody has answered is **deleted**.
  - A question that already has answers is **archived** instead: hidden from the survey, but its results are kept. Archived questions can be restored.
- **Type lock:** once people have answered a question, its type can't change (edit the text and options, or archive it and add a new one). If you remove an option that people chose, results show it as "(removed option)".

### How answers are stored

- **Responses:** each response is a row in `survey_responses` (id, a one-per-browser HMAC key, time rounded to the minute).
- **Answers:** a row in `survey_answers` for each answered question:
  - `num` for ratings
  - `picks` for choices
  - `txt` for text
- **Anonymity:** no name, email or clinic is asked for. Text answers go through the same email/phone/blocklist filter as notes.
- **One response per browser:** a second submit is refused politely, and the board button changes to "Survey done · thanks".
- **Spam control:** CAPTCHA, and 5 submissions per hour per IP hash.

### Results (admin → Survey → Results)

- **Quick question:** the quick-question results.
- **Summary:** the number of responses, plus the headline numbers for the first rating questions (average, or NPS for a 0-10 scale).
- **Per question:** bar charts for ratings and choices, and every written answer, newest first. Archived questions with answers still appear, marked "archived".

### Quick questions

Under the top section of the board there are one-tap **quick questions**, shown one at a time ("Quick question · 1 of 3", with arrows and dots). Defaults:

- *Overall, how was the demo?* (Loved it / Good / Okay / Not for me)
- *Would you use STAAD in your practice?* (Yes / Maybe / No)

How they behave:

- **After tapping,** the person sees that question's live percentages, with their answer ticked. Tapping another answer changes it.
- **Moving on:** after a first answer the card moves on to the next unanswered question. The dots show which ones are answered.
- **One answer per browser per question:** stored as `HMAC(server secret, device token + question id + version)` in `quick_answers`.

**Editing (admin → Survey → Quick questions):**
- **Add, edit, reorder and Hide / Show** quick questions, each with 2-6 answers.
- **Clear** a question's answers, or **Delete** it.
- **Edits start fresh:** changing a question's text or answers clears its old answers (its `version` goes up).
- **Hidden questions** keep their results but aren't shown or answerable. A hidden question that's shown again goes to the end of the list.

**Where results show:** on the board after answering, in admin → Survey → Results (one chart per quick question), and on the projector screen, which rotates through them every 8 seconds.

---

## 7. Projector screen (`/present`)

- **QR code:** points to `NEXT_PUBLIC_PUBLIC_URL`, or to the current site address if that isn't set. **Set it to the public URL before a meeting**, otherwise the QR code points to `localhost`.
- **Live content:** shows the total note count, the quick-question results (rotating through the quick questions every 8 seconds), and the newest note (two when there are no quick questions). The data refreshes every 10 seconds.

---

## 8. Database

PostgreSQL (currently a Neon database). Schema: `schema.sql`; apply it with `npm run db:init`.
There are no links to any user table.

| Table | Holds |
|---|---|
| `feedback` | Notes: `category`, `body`, `author_hash`, `status` (visible / hidden / deleted), `vote_count`, `comment_count`, `created_at` (minute), `deleted_at` |
| `comments` | Replies: `feedback_id`, `body`, `author_hash`, `is_op` (written by the note's author), `status`, `vote_count`, `created_at` |
| `votes` | Likes on notes: (`feedback_id`, `voter_key`) |
| `comment_votes` | Likes on replies: (`comment_id`, `voter_key`) |
| `reports` | `target_type`, `target_id`, `reason`, `reporter_key`, `resolved` |
| `quick_questions` | `position`, `question`, `options[]`, `version`, `active` |
| `quick_answers` | `respondent_key` (HMAC, one per browser per question), `question_id`, `answer`, `created_at` (minute) |
| `survey_questions` | Editable survey: `position`, `kind` (scale / single / multi / text), `title`, `options[]`, `scale_min`, `scale_max`, `low_label`, `high_label`, `required`, `active` |
| `survey_responses` | One row per response: `respondent_key` (HMAC, one per browser), `created_at` (minute). Older fixed columns are unused |
| `survey_answers` | One row per answered question: `response_id`, `question_id`, `num` / `picks[]` / `txt` |
| `app_settings` | Key/value settings (currently unused; the old single quick question moved to `quick_questions`) |

`vote_count` and `comment_count` are stored on the row, so the list loads fast.

> The design doc asks for a **separate** database with its own credentials. Right now `DATABASE_URL` points at
> the main app's Neon database (the tables don't clash with the main app's). Move it to its own Neon project
> before going live.

---

## 9. API reference

All routes return JSON. Responses never include `author_hash`, `voter_key` or `reporter_key`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/feedback?category=&sort=new\|top&q=&cursor=&total=1` | | List notes, 20 per page (`total=1` adds the count) |
| POST | `/api/feedback` | `category, body, author_token` | Create a note (CAPTCHA) |
| GET | `/api/feedback/:id` | | One note |
| DELETE | `/api/feedback/:id` | `author_token` | Delete your own note |
| GET | `/api/feedback/:id/comments` | | Replies, oldest first |
| POST | `/api/feedback/:id/comments` | `body, author_token` | Add a reply (CAPTCHA) |
| POST | `/api/feedback/:id/comments/similar` | `draft` | Server-side similar replies (not stored or logged) |
| PUT / DELETE | `/api/feedback/:id/vote` | `device_token` | Like / unlike a note |
| DELETE | `/api/comments/:id` | `author_token` | Delete your own reply |
| PUT / DELETE | `/api/comments/:id/vote` | `device_token` | Like / unlike a reply |
| POST | `/api/reports` | `target_type, target_id, reason, device_token` | Report (CAPTCHA) |
| GET | `/api/survey` | | Active survey questions |
| POST | `/api/survey` | `answers` (question id → value), `device_token` | Submit the survey (CAPTCHA, one per browser) |
| GET | `/api/quick` | | Active quick questions with live counts |
| POST | `/api/quick` | `question_id, answer, device_token` | Answer (or change your answer to) a quick question |
| GET | `/api/admin/survey` | | Admin: results per question, plus quick question |
| GET / POST | `/api/admin/survey/questions` | question | Admin: list all questions (with answer counts) / add one |
| PATCH | `/api/admin/survey/questions/:id` | question, or `{move}`, or `{active}` | Admin: edit, reorder, archive / restore |
| DELETE | `/api/admin/survey/questions/:id` | | Admin: delete (or archive if it has answers) |
| GET / POST | `/api/admin/quick` | `question, options` | Admin: list all quick questions with counts / add one |
| PATCH | `/api/admin/quick/:id` | `{question, options}` or `{move}` or `{active}` or `{reset}` | Admin: edit, reorder, show/hide, clear answers |
| DELETE | `/api/admin/quick/:id` | | Admin: delete a quick question and its answers |
| GET | `/api/admin/notes?status=all\|visible\|hidden&cursor=` | | Admin: all notes |
| GET | `/api/admin/notes/:id/replies` | | Admin: all replies of a note |
| GET | `/api/admin/reports` | | Admin: open reports (also runs cleanup) |
| PATCH | `/api/admin/feedback/:id` or `/api/admin/comment/:id` | `status` | Admin: hide, restore or delete |

---

## 10. Configuration (`.env`)

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `HMAC_SECRET` | Yes | Secret for like/report keys. Changing it resets "one like per device" |
| `ADMIN_PASSWORD` | Yes | Password for `/admin` |
| `NEXT_PUBLIC_PUBLIC_URL` | For meetings | Public URL used in the `/present` QR code |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Recommended in production | Cloudflare Turnstile CAPTCHA |
| `BLOCKLIST` | No | Extra comma-separated blocked words |
| `AUTO_HIDE_REPORTS` | No | Reports needed to auto-hide (default 3) |

`.env` is git-ignored. `.env.example` lists all variables.

---

## 11. Running and deploying

```bash
cd feedback-board
cp .env.example .env     # fill in the values
npm install
npm run db:init          # create the tables
npm run dev              # http://localhost:3100
```

For Vercel, `vercel.json` is included (Next.js, Singapore region next to Neon).

1. Set **Root Directory** to `feedback-board`.
2. Add the environment variables above.
3. Set `NEXT_PUBLIC_PUBLIC_URL` to the deployed URL.

---

## 12. Known limits

- **Rate-limit counters live in memory.** On Vercel each server instance counts separately, and a restart resets them. Use a shared store (e.g. Upstash Redis) in `src/lib/ratelimit.ts` for strict limits.
- **One like per device is a soft limit:** another browser can like again.
- **The database is currently shared** with the main app (see section 8).
- **Times are rounded to the minute,** so notes posted in the same minute can appear in any order under "Newest".

---

## 13. File map

```
feedback-board/
├── schema.sql                 database tables
├── scripts/init-db.mjs        applies schema.sql
├── vercel.json                Vercel deploy settings
├── src/app/
│   ├── page.tsx               the board (single page)
│   ├── present/page.tsx       projector screen
│   ├── admin/page.tsx         moderation
│   ├── layout.tsx, globals.css
│   └── api/                   all server routes (see section 9)
├── src/components/
│   ├── WaBar.tsx              WhatsApp-style typing bar
│   ├── Survey.tsx             survey form (built from the questions in the database)
│   ├── QuickQuestion.tsx      one-tap quick questions (one at a time)
│   ├── SurveyAdmin.tsx        admin: results, question editor, quick-questions editor
│   ├── Overlays.tsx           toast, report dialog, privacy dialog, CAPTCHA
│   ├── Menu.tsx, Captcha.tsx, icons.tsx
└── src/lib/
    ├── client.ts              browser tokens, API helper, "x minutes ago"
    ├── anon.ts                nicknames and avatar colours
    ├── similarity.ts          similar-suggestion matching
    ├── survey.ts              survey / quick-question types
    ├── surveyStore.ts         server: load + validate survey and quick questions
    ├── http.ts                route wrapper, validation, rate limit, CAPTCHA, admin check
    ├── crypto.ts              SHA-256, HMAC, daily IP salt
    ├── ratelimit.ts, captcha.ts, filter.ts, moderation.ts, db.ts, ui.ts
```
