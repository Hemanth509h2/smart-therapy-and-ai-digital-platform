import { pool } from "@/lib/db";
import { requireAdmin, route } from "@/lib/http";
import { purgeOld } from "@/lib/moderation";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  requireAdmin(req);
  await purgeOld();
  const { rows } = await pool().query(
    `SELECT r.target_type, r.target_id,
            count(*)::int AS report_count,
            array_agg(r.reason ORDER BY r.created_at) AS reasons,
            COALESCE(f.body, c.body) AS body,
            COALESCE(f.status, c.status) AS status
     FROM reports r
     LEFT JOIN feedback f ON r.target_type='feedback' AND f.id=r.target_id
     LEFT JOIN comments c ON r.target_type='comment' AND c.id=r.target_id
     WHERE NOT r.resolved
     GROUP BY r.target_type, r.target_id, f.body, c.body, f.status, c.status
     ORDER BY report_count DESC`
  );
  return { items: rows };
});
