// Follow-up sequences: email 1 → follow-up after N days → final after M days.
// Stopped automatically on reply, booking, unsubscribe, DNC, or (in consent-first mode) no consent.
import { db, now, logEvent } from "./db";

export function startSequence(leadId: string, firstSentAt: Date, followup1Days: number) {
  db()
    .prepare(
      `INSERT INTO sequences (lead_id, step, next_at, status, updated_at) VALUES (?, 1, ?, 'active', ?)
       ON CONFLICT(lead_id) DO UPDATE SET step = 1, next_at = excluded.next_at, status = 'active', stop_reason = NULL, updated_at = excluded.updated_at`,
    )
    .run(leadId, new Date(firstSentAt.getTime() + followup1Days * 86400_000).toISOString(), now());
}

export function stopSequence(leadId: string, reason: string) {
  const res = db()
    .prepare("UPDATE sequences SET status = 'stopped', stop_reason = ?, updated_at = ? WHERE lead_id = ? AND status = 'active'")
    .run(reason, now(), leadId);
  if (res.changes) logEvent(leadId, "email", "sequence_stopped", reason);
}

export function getSequence(leadId: string) {
  return db().prepare("SELECT * FROM sequences WHERE lead_id = ?").get(leadId) as
    | { lead_id: string; step: number; next_at: string | null; status: string; stop_reason: string | null }
    | undefined;
}

// ---------------------------------------------------------------------------------------------
// Tick: turn due sequence steps into follow-up drafts in a batch awaiting your approval.

import { newId } from "./db";
import { getLead } from "./leads";
import { getSettings } from "./settings";
import { isBlocked } from "./dnc";
import { claudeEnabled, writeFollowup } from "./claude";
import { renderEmail } from "./email/build";
import { addEmailsToBatch } from "./batches";
import type { EmailCopy } from "./types";

const STOP_STATUSES = ["Replied", "Demo booked", "Won", "Lost", "Do not contact"];

export async function sequenceTick(at: Date = new Date()): Promise<{ drafted: number; stopped: number }> {
  const s = getSettings();
  const due = db()
    .prepare("SELECT * FROM sequences WHERE status = 'active' AND next_at <= ?")
    .all(at.toISOString()) as { lead_id: string; step: number }[];
  let drafted = 0;
  let stopped = 0;
  for (const seq of due) {
    const lead = getLead(seq.lead_id);
    const first = db()
      .prepare("SELECT * FROM emails WHERE lead_id = ? AND kind = 'initial' AND status = 'sent' ORDER BY sent_at LIMIT 1")
      .get(seq.lead_id) as { to_email: string; subject: string; sent_at: string; copy: string } | undefined;
    const stopWhy = !lead
      ? "lead deleted"
      : STOP_STATUSES.includes(lead.status)
        ? `status ${lead.status}`
        : lead.replied_at
          ? "replied"
          : !first
            ? "first email not sent"
            : isBlocked({ email: first.to_email, domain: lead.domain })
              ? "unsubscribed / do not contact"
              : s.consent.consentFirstMode && lead.consent_status !== "granted"
                ? "consent-first mode: no follow-ups without the prospect's consent"
                : null;
    if (stopWhy) {
      stopSequence(seq.lead_id, stopWhy);
      stopped++;
      continue;
    }
    const kind = seq.step === 1 ? "followup1" : "followup2";
    const firstCopy = JSON.parse(first!.copy) as EmailCopy;
    let body: { subject: string; preheader: string; body: string; ctaText: string };
    if (claudeEnabled()) {
      body = await writeFollowup({
        step: seq.step === 1 ? "first follow-up" : "final, polite close-the-loop email",
        businessName: lead!.business_name,
        firstName: lead!.contact_first_name,
        previousSubject: first!.subject,
        previousPoints: firstCopy.benefits?.map((b) => b.title),
        comparison: lead!.comparison,
        sender: s.profile.senderName,
      });
    } else {
      body =
        seq.step === 1
          ? {
              subject: `Re: ${first!.subject}`.slice(0, 49),
              preheader: "A quick follow-up on my earlier note",
              body: `I wanted to follow up on my note from last week about a website assistant for ${lead!.business_name}.\n\nIt answers common questions like the ones your customers ask, takes their details when you're closed, and passes them straight to you.\n\nWould it be useful to see it on your own website content?`,
              ctaText: "Get your free demo",
            }
          : {
              subject: `Closing the loop, ${lead!.business_name}`.slice(0, 49),
              preheader: "My last note on this",
              body: `I haven't heard back, so I'll assume the timing isn't right and won't email again about this.\n\nIf after-hours enquiries ever become a priority, the demo link below stays open for you.`,
              ctaText: "Get your free demo",
            };
    }
    const copy: EmailCopy & { followupBody: string } = {
      ...firstCopy,
      subject: body.subject,
      preheader: body.preheader,
      ctaText: body.ctaText,
      followupBody: body.body,
    };
    const id = newId("em");
    db()
      .prepare("INSERT INTO emails (id, lead_id, kind, to_email, subject, preheader, copy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
      .run(id, seq.lead_id, kind, first!.to_email, body.subject, body.preheader, JSON.stringify(copy), now(), now());
    await renderEmail(id);
    addEmailsToBatch([id], "Follow-ups");
    logEvent(seq.lead_id, "email", "followup_drafted", `${kind} awaiting approval`);
    drafted++;
    if (seq.step === 1) {
      const next = new Date(new Date(first!.sent_at).getTime() + s.sequence.followup2Days * 86400_000);
      db().prepare("UPDATE sequences SET step = 2, next_at = ?, updated_at = ? WHERE lead_id = ?").run(next.toISOString(), now(), seq.lead_id);
    } else {
      db().prepare("UPDATE sequences SET step = 3, next_at = NULL, status = 'done', updated_at = ? WHERE lead_id = ?").run(now(), seq.lead_id);
    }
  }
  return { drafted, stopped };
}
