import { tx } from "@/lib/db";
import { HOUR, json, limit, route, uuid, voterKey, HttpError } from "@/lib/http";

async function setVote(id: string, key: string, on: boolean) {
  return tx(async (q) => {
    try {
      const r = on
        ? await q(`INSERT INTO comment_votes (comment_id, voter_key) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, key])
        : await q(`DELETE FROM comment_votes WHERE comment_id=$1 AND voter_key=$2`, [id, key]);
      if (r.rowCount) {
        await q(`UPDATE comments SET vote_count = GREATEST(vote_count + $2, 0) WHERE id=$1`, [id, on ? 1 : -1]);
      }
    } catch (e) {
      if ((e as { code?: string }).code === "23503") throw new HttpError(404, "Comment not found");
      throw e;
    }
    const { rows } = await q(`SELECT vote_count FROM comments WHERE id=$1 AND status='visible'`, [id]);
    if (!rows.length) throw new HttpError(404, "Comment not found");
    return { vote_count: rows[0].vote_count as number };
  });
}

export const PUT = route(async (req, { params }) => {
  limit(req, "vote", 60, HOUR);
  const id = uuid(params.id);
  return setVote(id, voterKey((await json(req)).device_token, id), true);
});

export const DELETE = route(async (req, { params }) => {
  limit(req, "vote", 60, HOUR);
  const id = uuid(params.id);
  return setVote(id, voterKey((await json(req)).device_token, id), false);
});
