import { tx } from "@/lib/db";
import { json, requireAdmin, route, uuid, HttpError } from "@/lib/http";
import { recountComments } from "@/lib/moderation";

export const PATCH = route(async (req, { params }) => {
  requireAdmin(req);
  const id = uuid(params.id);
  const table = params.type === "feedback" ? "feedback" : params.type === "comment" ? "comments" : null;
  if (!table) throw new HttpError(400, "Invalid type");
  const { status } = await json(req);
  if (status !== "visible" && status !== "hidden" && status !== "deleted") throw new HttpError(400, "Invalid status");

  await tx(async (q) => {
    const { rows } = await q(
      `UPDATE ${table} SET status=$2, deleted_at = CASE WHEN $2='deleted' THEN date_trunc('minute', now()) ELSE NULL END
       WHERE id=$1 RETURNING ${table === "comments" ? "feedback_id" : "id"} AS fid`,
      [id, status]
    );
    if (!rows.length) throw new HttpError(404, "Not found");
    await q(`UPDATE reports SET resolved=true WHERE target_id=$1`, [id]);
    if (table === "comments") await recountComments(q as never, rows[0].fid);
  });
});
