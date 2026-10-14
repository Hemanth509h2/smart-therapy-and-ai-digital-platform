import { tx } from "@/lib/db";
import { DAY, captcha, json, limit, route, str, uuid, voterKey, HttpError } from "@/lib/http";
import { recountComments } from "@/lib/moderation";

export const POST = route(async (req) => {
  limit(req, "report", 10, DAY);
  await captcha(req);
  const b = await json(req);
  const type = str(b.target_type, "target_type", 1, 20);
  if (type !== "feedback" && type !== "comment") throw new HttpError(400, "Invalid target_type");
  const targetId = uuid(b.target_id, "target_id");
  const reason = str(b.reason, "reason", 3, 300);
  const key = voterKey(b.device_token, targetId);
  const threshold = parseInt(process.env.AUTO_HIDE_REPORTS ?? "3", 10) || 3;
  const table = type === "feedback" ? "feedback" : "comments";

  await tx(async (q) => {
    const target = await q(`SELECT 1 FROM ${table} WHERE id=$1 AND status='visible'`, [targetId]);
    if (!target.rowCount) throw new HttpError(404, "Content not found");
    await q(
      `INSERT INTO reports (target_type, target_id, reason, reporter_key) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [type, targetId, reason, key]
    );
    const open = await q(`SELECT count(*)::int AS n FROM reports WHERE target_id=$1 AND NOT resolved`, [targetId]);
    if (open.rows[0].n >= threshold) {
      const hidden = await q(
        `UPDATE ${table} SET status='hidden' WHERE id=$1 AND status='visible' ${type === "comment" ? "RETURNING feedback_id" : "RETURNING id"}`,
        [targetId]
      );
      if (type === "comment" && hidden.rows[0]) await recountComments(q as never, hidden.rows[0].feedback_id);
    }
  });
});
