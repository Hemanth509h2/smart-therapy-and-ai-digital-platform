import { pool } from "@/lib/db";
import { requireAdmin, route } from "@/lib/http";
import { listQuestions, quickResults } from "@/lib/surveyStore";

export const dynamic = "force-dynamic";

/** Admin: survey results per question, plus the quick question. */
export const GET = route(async (req) => {
  requireAdmin(req);
  const db = pool();
  const [questions, responses, nums, picks, texts, answered, quick] = await Promise.all([
    listQuestions(true),
    db.query(`SELECT count(*)::int AS n FROM survey_responses r WHERE EXISTS (SELECT 1 FROM survey_answers a WHERE a.response_id = r.id)`).then((r) => r.rows[0].n as number),
    db.query(`SELECT question_id, num, count(*)::int AS n FROM survey_answers WHERE num IS NOT NULL GROUP BY 1, 2`).then((r) => r.rows),
    db.query(`SELECT question_id, p AS label, count(*)::int AS n FROM survey_answers, unnest(picks) p GROUP BY 1, 2 ORDER BY 3 DESC`).then((r) => r.rows),
    db.query(`SELECT a.question_id, a.txt, r.created_at FROM survey_answers a JOIN survey_responses r ON r.id = a.response_id
              WHERE a.txt IS NOT NULL ORDER BY r.created_at DESC LIMIT 1000`).then((r) => r.rows),
    db.query(`SELECT question_id, count(*)::int AS n FROM survey_answers GROUP BY 1`).then((r) => r.rows),
    quickResults(true),
  ]);
  const count = Object.fromEntries(answered.map((r) => [r.question_id, r.n]));

  const results = questions
    .filter((q) => q.active || count[q.id])
    .map((q) => {
      const base = { ...q, answered: count[q.id] ?? 0 };
      if (q.kind === "scale") {
        const rows = nums.filter((r) => r.question_id === q.id);
        const dist = [];
        for (let v = q.scale_min ?? 0; v <= (q.scale_max ?? 10); v++) dist.push({ label: String(v), n: rows.find((r) => r.num === v)?.n ?? 0 });
        const total = dist.reduce((a, d) => a + d.n, 0);
        const avg = total ? Math.round((dist.reduce((a, d) => a + Number(d.label) * d.n, 0) / total) * 10) / 10 : null;
        let nps = null;
        if (q.scale_min === 0 && q.scale_max === 10 && total) {
          const pro = dist.filter((d) => Number(d.label) >= 9).reduce((a, d) => a + d.n, 0);
          const det = dist.filter((d) => Number(d.label) <= 6).reduce((a, d) => a + d.n, 0);
          nps = Math.round(((pro - det) / total) * 100);
        }
        return { ...base, dist, avg, nps };
      }
      if (q.kind === "text") return { ...base, texts: texts.filter((t) => t.question_id === q.id).map((t) => ({ txt: t.txt, created_at: t.created_at })) };
      const found = picks.filter((p) => p.question_id === q.id);
      const dist = [...q.options.map((o) => ({ label: o, n: found.find((f) => f.label === o)?.n ?? 0 })),
        ...found.filter((f) => !q.options.includes(f.label)).map((f) => ({ label: `${f.label} (removed option)`, n: f.n }))];
      return { ...base, dist };
    });

  return { responses, results, quick };
});
