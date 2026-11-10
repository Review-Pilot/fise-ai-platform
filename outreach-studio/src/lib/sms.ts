// Optional SMS via Twilio: same consent, DNC and business-hours rules as calls.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { db, newId, now, logEvent } from "./db";
import { getLead } from "./leads";
import { getSettings } from "./settings";
import { isBlocked, normalisePhone } from "./dnc";
import { isBusinessHours, nextBusinessWindow } from "./hours";
import { pendingBatch } from "./batches";
import { latestDraft } from "./email/build";

export function withOptOut(body: string): string {
  return /reply stop/i.test(body) ? body : `${body.trim()} Reply STOP to opt out`;
}

export function addLeadsToSmsBatch(leadIds: string[]) {
  const s = getSettings();
  const skipped: { id: string; reason: string }[] = [];
  let batchId: string | null = null;
  let added = 0;
  for (const id of leadIds) {
    const lead = getLead(id);
    if (!lead) continue;
    const mobile = lead.contacts.map((c) => (c.kind === "whatsapp" || c.kind === "phone" ? normalisePhone(c.value) : null)).find((p) => p && /^\+27[678]/.test(p));
    const draft = latestDraft(id);
    const reason = !mobile
      ? "No mobile number found"
      : isBlocked({ phone: mobile, domain: lead.domain })
        ? "On the do-not-contact list"
        : s.consent.consentFirstMode && lead.consent_status !== "granted"
          ? "Consent-first mode: SMS needs the prospect's consent (POPIA s69)"
          : !draft?.copy.smsMessage
            ? "Generate the outreach first (SMS text comes from it)"
            : null;
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    batchId ??= pendingBatch("sms");
    db()
      .prepare("INSERT INTO sms (id, lead_id, batch_id, phone, body, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)")
      .run(newId("sms"), id, batchId, mobile, withOptOut(draft!.copy.smsMessage), now());
    added++;
  }
  return { batchId, added, skipped };
}

export async function sendQueuedSms(smsId: string, at: Date = new Date()): Promise<{ status: string; runAt?: Date; why?: string }> {
  const row = db().prepare("SELECT * FROM sms WHERE id = ?").get(smsId) as { id: string; lead_id: string; phone: string; body: string; status: string } | undefined;
  if (!row || row.status !== "queued") return { status: "skipped" };
  const fail = (status: string, error: string) => {
    db().prepare("UPDATE sms SET status = ?, error = ? WHERE id = ?").run(status, error, smsId);
    logEvent(row.lead_id, "sms", status, error);
    return { status };
  };
  const blocked = isBlocked({ phone: row.phone });
  if (blocked) return fail("blocked", blocked);
  if (!isBusinessHours(at, 0)) return { status: "rescheduled", runAt: nextBusinessWindow(at, 0), why: "Outside business hours" };
  const { accountSid, authToken, from } = config.twilio;
  if (!accountSid || !authToken || !from) return fail("failed", "Twilio is not configured");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: row.phone, From: from, Body: row.body }),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  if (!res.ok) return fail("failed", json.message ?? `Twilio ${res.status}`);
  db().prepare("UPDATE sms SET status = 'sent', provider_id = ?, sent_at = ? WHERE id = ?").run(json.sid ?? "", now(), smsId);
  logEvent(row.lead_id, "sms", "sent", row.phone);
  return { status: "sent" };
}

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function verifyTwilio(url: string, params: Record<string, string>, signature: string, authToken: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
