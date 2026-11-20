import { db } from "./db";

const count = (sql: string, ...args: unknown[]) => (db().prepare(sql).get(...args) as { c: number }).c;

export function dashboardStats() {
  const leads = count("SELECT COUNT(*) c FROM leads");
  const qualified = count("SELECT COUNT(*) c FROM leads WHERE qualified = 1");
  const emailsSent = count("SELECT COUNT(*) c FROM emails WHERE status = 'sent'");
  const firstEmails = count("SELECT COUNT(DISTINCT lead_id) c FROM emails WHERE status = 'sent'");
  const replied = count("SELECT COUNT(*) c FROM leads WHERE replied_at IS NOT NULL");
  const callsMade = count("SELECT COUNT(*) c FROM calls WHERE is_test = 0 AND status IN ('in_progress','ended')");
  const demos = count("SELECT COUNT(*) c FROM leads WHERE status IN ('Demo booked','Won')");
  const won = count("SELECT COUNT(*) c FROM leads WHERE status = 'Won'");
  const unsubscribes = count("SELECT COUNT(*) c FROM events WHERE type = 'opt_out'");
  const placesCost = (db().prepare("SELECT COALESCE(SUM(cost),0) c FROM api_usage WHERE service LIKE 'places%'").get() as { c: number }).c;
  const byStatus = db().prepare("SELECT status, COUNT(*) c FROM leads GROUP BY status").all() as { status: string; c: number }[];
  const pendingApprovals = count("SELECT COUNT(*) c FROM batches WHERE status = 'pending_approval'");
  const openTasks = count("SELECT COUNT(*) c FROM tasks WHERE status = 'open'");
  const last14 = db()
    .prepare(
      `SELECT substr(sent_at,1,10) d, COUNT(*) c FROM emails WHERE status = 'sent' AND sent_at >= ? GROUP BY d ORDER BY d`,
    )
    .all(new Date(Date.now() - 14 * 86400_000).toISOString()) as { d: string; c: number }[];
  return {
    leads, qualified, emailsSent, firstEmails, replied, callsMade, demos, won, unsubscribes, placesCost, byStatus, pendingApprovals, openTasks, last14,
    replyRate: firstEmails ? replied / firstEmails : 0,
    costPerQualified: qualified ? placesCost / qualified : 0,
    costPerDemo: demos ? placesCost / demos : 0,
  };
}
