// Email sending with warm-up, caps, random spacing and automatic safety stops.
import { Resend } from "resend";
import { config } from "./config";
import { db, now, logEvent } from "./db";
import { getSettings, updateSettings } from "./settings";
import { getEmail, renderEmail } from "./email/build";
import { hasBlockingErrors } from "./email/checks";
import { getLead, setStatus, updateLead } from "./leads";
import { isBlocked } from "./dnc";
import { unsubscribeUrls } from "./unsubscribe";
import { startSequence } from "./sequences";
import { isBusinessHours, nextBusinessWindow, toSast } from "./hours";

/** Warm-up: start at ~20/day and add N per week since the first send, up to the max. */
export function dailyLimit(at: Date = new Date()): number {
  const s = getSettings().sending;
  if (!s.firstSendDate) return s.warmupStartPerDay;
  const weeks = Math.floor((at.getTime() - new Date(s.firstSendDate).getTime()) / (7 * 86400_000));
  return Math.min(s.maxPerDay, s.warmupStartPerDay + Math.max(0, weeks) * s.warmupIncreasePerWeek);
}

function sastMidnightUtc(at: Date = new Date()): string {
  const s = toSast(at);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 2 * 3600_000).toISOString();
}

export function sentToday(at: Date = new Date()): number {
  return (db().prepare("SELECT COUNT(*) c FROM emails WHERE status = 'sent' AND sent_at >= ?").get(sastMidnightUtc(at)) as { c: number }).c;
}

export function sentToDomainToday(domain: string, at: Date = new Date()): number {
  return (
    db()
      .prepare("SELECT COUNT(*) c FROM emails WHERE status = 'sent' AND sent_at >= ? AND lower(to_email) LIKE ?")
      .get(sastMidnightUtc(at), `%@${domain.toLowerCase()}`) as { c: number }
  ).c;
}

export function bounceStats(days = 30) {
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const sent = (db().prepare("SELECT COUNT(*) c FROM emails WHERE status = 'sent' AND sent_at >= ?").get(since) as { c: number }).c;
  const bounces = (db().prepare("SELECT COUNT(*) c FROM events WHERE type = 'bounce' AND created_at >= ?").get(since) as { c: number }).c;
  const complaints = (db().prepare("SELECT COUNT(*) c FROM events WHERE type = 'complaint' AND created_at >= ?").get(since) as { c: number }).c;
  return { sent, bounces, complaints, bounceRate: sent ? bounces / sent : 0 };
}

export function pauseSending(reason: string) {
  updateSettings("sending", { paused: true, pauseReason: reason });
  logEvent(null, "email", "sending_paused", reason);
}

/** Called after every bounce/complaint webhook. */
export function enforceSafetyStops() {
  const s = getSettings().sending;
  const st = bounceStats();
  if (st.complaints > 0 && !s.paused) {
    pauseSending(`Spam complaint received (${st.complaints} in 30 days). Review your list and copy before resuming.`);
  } else if (st.sent >= 20 && st.bounceRate > s.bounceRateLimit && !s.paused) {
    pauseSending(`Bounce rate ${(st.bounceRate * 100).toFixed(1)}% is above ${(s.bounceRateLimit * 100).toFixed(0)}%.`);
  }
}

function randomDelayMs() {
  const { minDelaySeconds, maxDelaySeconds } = getSettings().sending;
  return (minDelaySeconds + Math.random() * Math.max(0, maxDelaySeconds - minDelaySeconds)) * 1000;
}

/** First send slot for today's next business window with jitter, used when a cap is hit. */
function tomorrowSlot(): Date {
  const start = nextBusinessWindow(new Date(Date.now() + 18 * 3600_000));
  return new Date(start.getTime() + Math.random() * 3 * 3600_000);
}

export type SendOutcome = { status: "sent" | "blocked" | "failed" | "skipped" } | { status: "rescheduled"; runAt: Date; why: string };

/** Sends one queued email. Every safety rule is re-checked here, at send time. */
export async function sendQueuedEmail(emailId: string, deps: { send?: typeof resendSend; now?: Date } = {}): Promise<SendOutcome> {
  const at = deps.now ?? new Date();
  const email = getEmail(emailId);
  if (!email || email.status !== "queued") return { status: "skipped" };
  const lead = getLead(email.lead_id);
  const s = getSettings();
  const fail = (status: "blocked" | "failed", error: string): SendOutcome => {
    db().prepare("UPDATE emails SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, error, now(), emailId);
    logEvent(email.lead_id, "email", status, error);
    return { status };
  };

  if (s.sending.paused) return { status: "rescheduled", runAt: new Date(Date.now() + 3600_000), why: `Sending paused: ${s.sending.pauseReason}` };
  if (!s.sending.dnsVerifiedAt) return fail("failed", "SPF/DKIM/DMARC not verified yet — run the DNS check in Settings");
  if (!config.resendKey || !config.fromEmail) return fail("failed", "RESEND_API_KEY / FROM_EMAIL not set");
  if (!lead) return fail("blocked", "Lead was deleted");
  if (!email.to_email) return fail("blocked", "No recipient");
  const blocked = isBlocked({ email: email.to_email, domain: lead.domain });
  if (blocked || lead.status === "Do not contact") return fail("blocked", blocked ?? "Lead is marked do not contact");
  // A requested demo is a reply to the prospect's own action: it skips the cold-send limits and business
  // hours, but not the do-not-contact list, the DNS check or the pause switch.
  const requested = email.kind === "demo_ready";
  if (email.kind !== "initial" && !requested && s.consent.consentFirstMode && lead.consent_status !== "granted") {
    return fail("blocked", "Consent-first mode: follow-ups need the prospect's consent");
  }
  // Re-render so unsubscribe links/colours are current, then re-check.
  const fresh = await renderEmail(emailId);
  if (hasBlockingErrors(fresh.checks)) return fail("blocked", "Pre-send checks failed");

  const domain = email.to_email.split("@")[1];
  if (!requested) {
    if (!isBusinessHours(at, 0)) return { status: "rescheduled", runAt: nextBusinessWindow(at, 0), why: "Outside business hours" };
    if (sentToday(at) >= dailyLimit(at)) return { status: "rescheduled", runAt: tomorrowSlot(), why: `Daily warm-up limit (${dailyLimit(at)}) reached` };
    if (sentToDomainToday(domain, at) >= s.sending.perDomainPerDay) return { status: "rescheduled", runAt: tomorrowSlot(), why: `Per-domain cap for ${domain}` };
  }

  const unsub = unsubscribeUrls(email.to_email, lead.id);
  const replyTo = config.replyToEmail || config.fromEmail.match(/<([^>]+)>/)?.[1] || config.fromEmail;
  try {
    const providerId = await (deps.send ?? resendSend)({
      from: config.fromEmail,
      to: email.to_email,
      replyTo,
      subject: fresh.subject,
      html: fresh.html,
      text: fresh.text,
      headers: {
        "List-Unsubscribe": `<${unsub.oneClick}>, <mailto:${replyTo}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    const sentAt = at;
    db().prepare("UPDATE emails SET status = 'sent', provider_id = ?, sent_at = ?, error = NULL, updated_at = ? WHERE id = ?").run(providerId, sentAt.toISOString(), now(), emailId);
    if (!s.sending.firstSendDate) updateSettings("sending", { firstSendDate: sentAt.toISOString() });
    updateLead(lead.id, { last_contacted_at: sentAt.toISOString(), consent_status: lead.consent_status === "none" ? "requested" : lead.consent_status });
    if (["New", "Qualified"].includes(lead.status)) setStatus(lead.id, "Contacted", "email sent");
    if (email.kind === "initial") startSequence(lead.id, sentAt, s.sequence.followup1Days);
    logEvent(lead.id, "email", "sent", `${email.kind}: ${fresh.subject}`);
    return { status: "sent" };
  } catch (e) {
    return fail("failed", e instanceof Error ? e.message : String(e));
  }
}

export async function resendSend(msg: {
  from: string; to: string; replyTo: string; subject: string; html: string; text: string; headers: Record<string, string>;
}): Promise<string> {
  const resend = new Resend(config.resendKey);
  const { data, error } = await resend.emails.send({
    from: msg.from,
    to: [msg.to],
    replyTo: msg.replyTo,
    subject: msg.subject,
    html: msg.html,
    text: msg.text, // html + text → multipart/alternative
    headers: msg.headers,
  });
  if (error) throw new Error(error.message);
  return data?.id ?? "";
}

export { randomDelayMs };
