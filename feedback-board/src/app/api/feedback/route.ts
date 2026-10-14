import { pool } from "@/lib/db";
import { HOUR, authorHash, captcha, json, limit, route, str, HttpError } from "@/lib/http";
import { screen } from "@/lib/filter";

const CATEGORIES = ["idea", "issue", "praise", "question"];
const PAGE = 20;

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = req.nextUrl.searchParams;
  const category = sp.get("category");
  const top = sp.get("sort") === "top";
  const q = (sp.get("q") ?? "").trim().slice(0, 100);
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%` : null;
  const offset = Math.max(0, parseInt(sp.get("cursor") ?? "0", 10) || 0);
  if (category && !CATEGORIES.includes(category)) throw new HttpError(400, "Invalid category");

  const { rows } = await pool().query(
    `SELECT id, category, body, vote_count, comment_count, created_at FROM feedback
     WHERE status='visible' AND ($1::text IS NULL OR category=$1) AND ($4::text IS NULL OR body ILIKE $4)
     ORDER BY ${top ? "vote_count DESC, created_at DESC" : "created_at DESC"}, id
     LIMIT $2 OFFSET $3`,
    [category, PAGE + 1, offset, like]
  );
  const more = rows.length > PAGE;
  const out: Record<string, unknown> = { items: rows.slice(0, PAGE), nextCursor: more ? String(offset + PAGE) : null };
  if (sp.get("total") === "1") {
    out.total = (await pool().query(`SELECT count(*)::int AS n FROM feedback WHERE status='visible'`)).rows[0].n;
  }
  return out;
});

export const POST = route(async (req) => {
  limit(req, "feedback", 5, HOUR);
  await captcha(req);
  const b = await json(req);
  const category = str(b.category, "category", 1, 20);
  if (!CATEGORIES.includes(category)) throw new HttpError(400, "Invalid category");
  const body = str(b.body, "body", 1, 2000);
  screen(body);
  const { rows } = await pool().query(
    `INSERT INTO feedback (category, body, author_hash) VALUES ($1,$2,$3)
     RETURNING id, category, body, vote_count, comment_count, created_at`,
    [category, body, authorHash(b.author_token)]
  );
  return rows[0];
});
