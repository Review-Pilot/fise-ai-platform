// Every outbound send or call goes through a batch that you approve after previewing it.
import { db, newId, now, logEvent } from "./db";
import { enqueue } from "./jobs";
import { getEmail } from "./email/build";
import { hasBlockingErrors } from "./email/checks";
import { getLead } from "./leads";
import { isBlocked } from "./dnc";
import { getSettings } from "./settings";
import { nextBusinessWindow } from "./hours";
import { randomDelayMs } from "./sending";

export type BatchType = "email" | "call" | "sms";

export interface Batch {
  id: string;
  type: BatchType;
  status: "pending_approval" | "approved" | "cancelled" | "done";
  note: string | null;
  created_at: string;
  approved_at: string | null;
}

export function getBatch(id: string): Batch | null {
  return (db().prepare("SELECT * FROM batches WHERE id = ?").get(id) as Batch | undefined) ?? null;
}

export function listBatches(limit = 30): (Batch & { items: number })[] {
  return db()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM emails e WHERE e.batch_id = b.id) + (SELECT COUNT(*) FROM calls c WHERE c.batch_id = b.id)
        + (SELECT COUNT(*) FROM sms s WHERE s.batch_id = b.id) AS items FROM batches b ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as (Batch & { items: number })[];
}

export function pendingBatch(type: BatchType, note?: string): string {
  const existing = db()
    .prepare("SELECT id FROM batches WHERE type = ? AND status = 'pending_approval' AND COALESCE(note,'') = ? ORDER BY created_at DESC LIMIT 1")
    .get(type, note ?? "") as { id: string } | undefined;
  if (existing) return existing.id;
  const id = newId("bat");
  db().prepare("INSERT INTO batches (id, type, status, note, created_at) VALUES (?, ?, 'pending_approval', ?, ?)").run(id, type, note ?? null, now());
  return id;
}

/** Problems that stop an email from being sent (checked when adding and again at approval). */
export function emailProblems(emailId: string): string | null {
  const e = getEmail(emailId);
  if (!e) return "Email not found";
  if (e.status !== "draft") return `Email is ${e.status}`;
  if (!e.to_email) return "No recipient email";
  if (hasBlockingErrors(e.checks)) return "Fails pre-send checks";
  const lead = getLead(e.lead_id);
  if (!lead) return "Lead deleted";
  const blocked = isBlocked({ email: e.to_email, domain: lead.domain });
  if (blocked) return blocked;
  if (lead.status === "Do not contact") return "Lead is do-not-contact";
  if (e.kind === "initial") {
    const already = db()
      .prepare("SELECT 1 FROM emails WHERE lead_id = ? AND kind = 'initial' AND status IN ('queued','sent') AND id != ?")
      .get(e.lead_id, emailId);
    if (already) return "A first email was already sent to this lead";
  }
  return null;
}

export function addEmailsToBatch(emailIds: string[], note?: string): { batchId: string | null; added: string[]; skipped: { id: string; reason: string }[] } {
  const skipped: { id: string; reason: string }[] = [];
  const added: string[] = [];
  let batchId: string | null = null;
  for (const id of emailIds) {
    const problem = emailProblems(id);
    if (problem) {
      skipped.push({ id, reason: problem });
      continue;
    }
    batchId ??= pendingBatch("email", note);
    db().prepare("UPDATE emails SET batch_id = ?, updated_at = ? WHERE id = ?").run(batchId, now(), id);
    added.push(id);
  }
  return { batchId, added, skipped };
}

export function removeFromBatch(kind: "email" | "call" | "sms", itemId: string) {
  const table = kind === "email" ? "emails" : kind === "call" ? "calls" : "sms";
  db().prepare(`UPDATE ${table} SET batch_id = NULL WHERE id = ? AND status IN ('draft','pending')`).run(itemId);
}

/** Approve: re-validate every item and queue it with randomised spacing inside business hours. */
export function approveBatch(batchId: string): { queued: number; skipped: { id: string; reason: string }[] } {
  const batch = getBatch(batchId);
  if (!batch || batch.status !== "pending_approval") throw new Error("Batch is not awaiting approval");
  const skipped: { id: string; reason: string }[] = [];
  let queued = 0;
  let at = nextBusinessWindow(new Date(), 0);
  const d = db();

  if (batch.type === "email") {
    const ids = (d.prepare("SELECT id FROM emails WHERE batch_id = ? AND status = 'draft'").all(batchId) as { id: string }[]).map((r) => r.id);
    for (const id of ids) {
      const problem = emailProblems(id);
      if (problem) {
        skipped.push({ id, reason: problem });
        d.prepare("UPDATE emails SET batch_id = NULL WHERE id = ?").run(id);
        continue;
      }
      d.prepare("UPDATE emails SET status = 'queued', updated_at = ? WHERE id = ?").run(now(), id);
      enqueue("send_email", { emailId: id }, at);
      at = new Date(at.getTime() + randomDelayMs());
      queued++;
    }
  } else if (batch.type === "call") {
    const s = getSettings().calls;
    const rows = d.prepare("SELECT id, phone, lead_id, is_test FROM calls WHERE batch_id = ? AND status = 'pending'").all(batchId) as {
      id: string; phone: string; lead_id: string | null; is_test: number;
    }[];
    for (const r of rows) {
      const blocked = isBlocked({ phone: r.phone });
      if (blocked) {
        skipped.push({ id: r.id, reason: blocked });
        d.prepare("UPDATE calls SET status = 'blocked', error = ? WHERE id = ?").run(blocked, r.id);
        continue;
      }
      if (s.testMode && !r.is_test) {
        skipped.push({ id: r.id, reason: "Test mode is on — only your own number can be called" });
        continue;
      }
      d.prepare("UPDATE calls SET status = 'queued' WHERE id = ?").run(r.id);
      enqueue("place_call", { callId: r.id }, at);
      at = new Date(at.getTime() + 90_000 + Math.random() * 120_000);
      queued++;
    }
  } else {
    const rows = d.prepare("SELECT id, phone FROM sms WHERE batch_id = ? AND status = 'pending'").all(batchId) as { id: string; phone: string }[];
    for (const r of rows) {
      const blocked = isBlocked({ phone: r.phone });
      if (blocked) {
        skipped.push({ id: r.id, reason: blocked });
        d.prepare("UPDATE sms SET status = 'blocked', error = ? WHERE id = ?").run(blocked, r.id);
        continue;
      }
      d.prepare("UPDATE sms SET status = 'queued' WHERE id = ?").run(r.id);
      enqueue("send_sms", { smsId: r.id }, at);
      at = new Date(at.getTime() + 30_000 + Math.random() * 60_000);
      queued++;
    }
  }
  d.prepare("UPDATE batches SET status = 'approved', approved_at = ? WHERE id = ?").run(now(), batchId);
  logEvent(null, batch.type, "batch_approved", `${batchId}: ${queued} queued, ${skipped.length} skipped`);
  return { queued, skipped };
}

export function cancelBatch(batchId: string) {
  const d = db();
  d.prepare("UPDATE emails SET status = CASE WHEN status = 'queued' THEN 'draft' ELSE status END, batch_id = NULL WHERE batch_id = ? AND status IN ('draft','queued')").run(batchId);
  d.prepare("UPDATE calls SET status = 'cancelled' WHERE batch_id = ? AND status IN ('pending','queued')").run(batchId);
  d.prepare("UPDATE sms SET status = 'cancelled' WHERE batch_id = ? AND status IN ('pending','queued')").run(batchId);
  d.prepare("UPDATE batches SET status = 'cancelled' WHERE id = ?").run(batchId);
  logEvent(null, "system", "batch_cancelled", batchId);
}
