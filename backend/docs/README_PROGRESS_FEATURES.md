# progress_features — setup notes

## Important: this is Next.js, not Express
STAAD runs on Next.js (App Router), not Express — I checked `server.js` directly
to confirm. So the "controller" files here are real, working logic, but they're
wired in as **Next.js Route Handlers**, not an Express app. Two tiny files
outside `progress_features/` are required for this to actually route:

- `src/app/api/progress-features/measurement/[clientId]/route.js`
- `src/app/api/progress-features/reports/[clientId]/route.js`

Both are one-line re-exports of the real logic inside `progress_features/`.
This is unavoidable — Next.js only registers API endpoints for files that
physically exist at the matching path.

## Where to copy this
Copy the whole `progress_features` folder into **`src/`**, so the final path is:
```
src/progress_features/backend/measurement/measurementService.js
src/progress_features/backend/measurement/measurementController.js
src/progress_features/backend/reports/reportService.js
src/progress_features/backend/reports/reportController.js
src/progress_features/frontend/components/MeasurementDashboard.jsx
src/progress_features/frontend/components/ProgressCharts.jsx
src/progress_features/frontend/components/ReportDownload.jsx
```
This lets the code use your existing `@/*` → `src/*` import alias.

Also copy the two API route files and the one page file (included in this zip)
into your project at these exact paths:
```
src/app/api/progress-features/measurement/[clientId]/route.js
src/app/api/progress-features/reports/[clientId]/route.js
src/app/progress-features/[clientId]/page.tsx
```

## Install two new dependencies
```bash
npm install chart.js react-chartjs-2
```
(`jspdf` is likely already in your `package.json` from earlier work — if not:
`npm install jspdf`.)

## What the metrics actually mean (real data, no dummy values)
Your schema doesn't have "task" or "performance score" fields, so these are
computed from the closest real data available — documented in
`measurementService.js`:
- **Attendance %** — completed sessions ÷ sessions already due (by date)
- **Task completion rate** — a proxy using `Session.confirmedByPatient`,
  since there's no separate tasks model
- **Average performance score** — averages `ProgressMetric.value` if that
  table exists in your database (from the earlier progress-tracking feature).
  If it doesn't exist yet, this returns `null` rather than a fake number.

## How to actually see it on the site
Visit:
```
/progress-features/<a real clientId>
```
Get a real client ID from your Clients page or Prisma Studio. There's no
button linking to this page yet — add one wherever makes sense (e.g. next to
the existing "View Progress" button) once you've confirmed it works.

## Testing checklist
1. `npm install chart.js react-chartjs-2`
2. Copy files to the paths above
3. `npx prisma generate` (only needed if ProgressMetric isn't in your client yet)
4. `npm run dev`
5. Go to `/progress-features/<clientId>` — should show 3 metric cards, 2
   charts, and a working PDF download button
