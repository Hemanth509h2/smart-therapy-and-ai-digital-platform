import { pool } from "./db";

type Q = (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;

export async function recountComments(q: Q, feedbackId: string) {
  await q(
    `UPDATE feedback SET comment_count = (SELECT count(*) FROM comments WHERE feedback_id=$1 AND status='visible') WHERE id=$1`,
    [feedbackId]
  );
}

/** Soft-deleted rows purge after 30 days, resolved reports after 90 days. */
export async function purgeOld() {
  const p = pool();
  await p.query(`DELETE FROM comments WHERE status='deleted' AND deleted_at < now() - interval '30 days'`);
  await p.query(`DELETE FROM feedback WHERE status='deleted' AND deleted_at < now() - interval '30 days'`);
  await p.query(`DELETE FROM reports WHERE resolved AND created_at < now() - interval '90 days'`);
}
