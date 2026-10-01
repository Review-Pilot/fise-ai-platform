// AI phone calls via Vapi. Guard rails: disclosure in the first sentence, business hours only,
// no public holidays, daily cap, DNC check at dial time, test mode (own number only),
// explicit batch approval, and immediate opt-out on "no / stop / remove me".
import { config } from "./config";
import { db, newId, now, logEvent } from "./db";
import { getLead, setStatus, updateLead } from "./leads";
import { getSettings, updateSettings } from "./settings";
import { isBlocked, normalisePhone } from "./dnc";
import { isBusinessHours, nextBusinessWindow, toSast } from "./hours";
import { claudeEnabled, writeCallBrief, classifyCall } from "./claude";
import { optOut } from "./optout";
import { pendingBatch } from "./batches";
import type { Lead } from "./types";

export const OUTCOMES = ["booked", "interested", "not_interested", "call_back", "do_not_contact", "no_answer", "voicemail"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const DNC_PHRASES = /\b(remove (me|my number|us)|stop calling|don'?t (call|phone)|do not (call|phone|contact)|take (me|us|my number) off|never call)\b/i;

export interface CallRow {
  id: string;
  lead_id: string | null;
  batch_id: string | null;
  phone: string;
  is_test: number;
  status: string;
  brief: string | null;
  first_message: string | null;
  vapi_call_id: string | null;
  outcome: Outcome | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  ended_reason: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export function getCall(id: string): CallRow | null {
  return (db().prepare("SELECT * FROM calls WHERE id = ?").get(id) as CallRow | undefined) ?? null;
}

export function disclosure(company: string, senderName: string) {
  return `Hi, this is an automated assistant calling on behalf of ${senderName} at ${company}.`;
}

function templateBrief(lead: Lead | null) {
  const s = getSettings();
  const p = s.profile;
  const biz = lead?.business_name ?? "the business";
  const gap = lead?.comparison ?? "Visitors who arrive after hours may not get an answer straight away.";
  return {
    brief: [
      `You are a polite automated voice assistant calling ${biz} on behalf of ${p.senderName} at ${p.company}, a South African company that builds AI chatbots for business websites.`,
      `Say in your first sentence that you are an automated assistant calling on behalf of ${p.company}. Never claim to be human.`,
      `If asked how you got the number: it is listed publicly on their website or Google listing.`,
      `What Fise does: ${p.description}`,
      `Why it may help them: ${gap}`,
      `Goal: ask whether they'd like a free demo chatbot built from their own website, or permission to email details to the owner. Get an email address if they agree.`,
      `If they say no, not interested, stop, remove me or don't call: apologise, confirm they won't be contacted again, thank them and end the call immediately.`,
      `Keep the whole call under two minutes. Do not pressure, argue or make claims beyond these facts. If you reach voicemail, hang up without leaving a message.`,
    ].join("\n"),
    firstMessage: `${disclosure(p.company, p.senderName)} Is this a good moment for a 30-second question about ${biz}'s website?`,
  };
}

export async function buildBrief(lead: Lead | null): Promise<{ brief: string; firstMessage: string }> {
  const s = getSettings();
  let out = templateBrief(lead);
  if (lead && claudeEnabled()) {
    try {
      out = await writeCallBrief({
        business: lead.business_name,
        industry: lead.industry ?? lead.keyword,
        location: lead.research?.location ?? lead.city,
        observedGap: lead.comparison,
        chatTest: lead.chat_test?.observations,
        company: s.profile.company,
        senderName: s.profile.senderName,
        product: s.profile.description,
        offer: s.profile.offer,
      });
    } catch {
      /* template */
    }
  }
  // The disclosure is non-negotiable, whatever the generator produced.
  if (!/automated/i.test(out.firstMessage.split(/[.?!]/)[0] ?? "")) {
    out.firstMessage = `${disclosure(s.profile.company, s.profile.senderName)} ${out.firstMessage}`;
  }
  return out;
}

export function bestPhone(lead: Lead): string | null {
  const c = lead.contacts.find((x) => x.kind === "phone");
  return c ? normalisePhone(c.value) : null;
}

export function callsToday(at: Date = new Date()): number {
  const s = toSast(at);
  const midnight = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - 2 * 3600_000).toISOString();
  return (db().prepare("SELECT COUNT(*) c FROM calls WHERE is_test = 0 AND started_at >= ?").get(midnight) as { c: number }).c;
}

/** Test call to your own number (allowed in test mode, any time). */
export async function createTestCall(leadId?: string | null): Promise<string> {
  const s = getSettings().calls;
  const phone = normalisePhone(s.testNumber);
  if (!phone) throw new Error("Set your own phone number in Settings → Calls first");
  const lead = leadId ? getLead(leadId) : null;
  const { brief, firstMessage } = await buildBrief(lead);
  const id = newId("call");
  db()
    .prepare("INSERT INTO calls (id, lead_id, phone, is_test, status, brief, first_message, created_at) VALUES (?, ?, ?, 1, 'queued', ?, ?, ?)")
    .run(id, lead?.id ?? null, phone, brief, firstMessage, now());
  return id;
}

/** Adds leads to a call batch awaiting approval. */
export async function addLeadsToCallBatch(leadIds: string[]): Promise<{ batchId: string | null; added: number; skipped: { id: string; reason: string }[] }> {
  const s = getSettings();
  if (s.calls.testMode) throw new Error("Test mode is on. Make a test call to your own number, then switch test mode off in Settings → Calls.");
  const skipped: { id: string; reason: string }[] = [];
  let batchId: string | null = null;
  let added = 0;
  for (const id of leadIds) {
    const lead = getLead(id);
    if (!lead) continue;
    const phone = bestPhone(lead);
    const reason = !phone
      ? "No phone number found"
      : isBlocked({ phone, domain: lead.domain })
        ? "On the do-not-contact list"
        : lead.status === "Do not contact"
          ? "Lead is do-not-contact"
          : s.consent.consentFirstMode && lead.consent_status !== "granted"
            ? "Consent-first mode: automated calls need the prospect's consent (POPIA s69)"
            : db().prepare("SELECT 1 FROM calls WHERE lead_id = ? AND is_test = 0 AND status IN ('pending','queued','in_progress')").get(id)
              ? "Already has a call pending"
              : null;
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }
    batchId ??= pendingBatch("call");
    const { brief, firstMessage } = await buildBrief(lead);
    db()
      .prepare("INSERT INTO calls (id, lead_id, batch_id, phone, is_test, status, brief, first_message, created_at) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?)")
      .run(newId("call"), id, batchId, phone, brief, firstMessage, now());
    added++;
  }
  return { batchId, added, skipped };
}

export type CallOutcomeResult = { status: "started" | "blocked" | "failed" | "skipped" } | { status: "rescheduled"; runAt: Date; why: string };

export async function placeCall(callId: string, deps: { dial?: typeof vapiDial; now?: Date } = {}): Promise<CallOutcomeResult> {
  const at = deps.now ?? new Date();
  const call = getCall(callId);
  if (!call || call.status !== "queued") return { status: "skipped" };
  const s = getSettings();
  const fail = (status: "blocked" | "failed", error: string): CallOutcomeResult => {
    db().prepare("UPDATE calls SET status = ?, error = ? WHERE id = ?").run(status, error, callId);
    logEvent(call.lead_id, "call", status, error);
    return { status };
  };
  const blocked = isBlocked({ phone: call.phone });
  if (blocked) return fail("blocked", blocked);
  if (s.calls.testMode && (!call.is_test || normalisePhone(s.calls.testNumber) !== call.phone)) {
    return fail("blocked", "Test mode: only your own number may be called");
  }
  if (!call.is_test) {
    const lead = call.lead_id ? getLead(call.lead_id) : null;
    if (!lead || lead.status === "Do not contact") return fail("blocked", "Lead is do-not-contact or deleted");
    if (!isBusinessHours(at, 15)) return { status: "rescheduled", runAt: nextBusinessWindow(at, 15), why: "Outside Mon–Fri 08:00–17:00 SAST or a public holiday" };
    if (callsToday(at) >= s.calls.dailyCap) {
      return { status: "rescheduled", runAt: nextBusinessWindow(new Date(at.getTime() + 16 * 3600_000), 15), why: `Daily call cap (${s.calls.dailyCap}) reached` };
    }
  }
  const { apiKey, phoneNumberId, assistantId } = config.vapi;
  if (!apiKey || !phoneNumberId || !assistantId) return fail("failed", "VAPI_API_KEY / VAPI_PHONE_NUMBER_ID / VAPI_ASSISTANT_ID not set");
  const lead = call.lead_id ? getLead(call.lead_id) : null;
  try {
    const vapiId = await (deps.dial ?? vapiDial)({
      phone: call.phone,
      name: lead?.contact_first_name ?? lead?.business_name ?? "Test",
      brief: call.brief ?? "",
      firstMessage: call.first_message ?? "",
      callId,
      record: s.calls.recordCalls,
    });
    db().prepare("UPDATE calls SET status = 'in_progress', vapi_call_id = ?, started_at = ? WHERE id = ?").run(vapiId, at.toISOString(), callId);
    logEvent(call.lead_id, "call", "started", `${call.is_test ? "TEST " : ""}${call.phone}`);
    return { status: "started" };
  } catch (e) {
    return fail("failed", e instanceof Error ? e.message : String(e));
  }
}

export async function vapiDial(opts: { phone: string; name: string; brief: string; firstMessage: string; callId: string; record: boolean }): Promise<string> {
  const res = await fetch("https://api.vapi.ai/call", {
    method: "POST",
    headers: { authorization: `Bearer ${config.vapi.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      assistantId: config.vapi.assistantId,
      phoneNumberId: config.vapi.phoneNumberId,
      customer: { number: opts.phone, name: opts.name.slice(0, 40) },
      assistantOverrides: {
        firstMessage: opts.firstMessage,
        // Your Vapi assistant's system prompt should contain {{callBrief}} (see README).
        variableValues: { callBrief: opts.brief },
        metadata: { fiseCallId: opts.callId },
        artifactPlan: { recordingEnabled: opts.record },
        server: config.vapi.webhookSecret
          ? { url: `${config.publicBaseUrl}/api/webhooks/vapi`, secret: config.vapi.webhookSecret }
          : { url: `${config.publicBaseUrl}/api/webhooks/vapi` },
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string | string[] };
  if (!res.ok || !json.id) throw new Error(`Vapi ${res.status}: ${Array.isArray(json.message) ? json.message.join("; ") : json.message ?? "call failed"}`);
  return json.id;
}

/** Handles Vapi's end-of-call report: stores transcript/outcome and feeds the lead status. */
export async function handleEndOfCall(report: {
  vapiCallId: string;
  fiseCallId?: string;
  endedReason?: string;
  transcript?: string;
  recordingUrl?: string;
  summary?: string;
  structuredOutcome?: string;
}) {
  const call =
    (report.fiseCallId ? getCall(report.fiseCallId) : null) ??
    (db().prepare("SELECT * FROM calls WHERE vapi_call_id = ?").get(report.vapiCallId) as CallRow | undefined) ??
    null;
  if (!call) return null;
  const s = getSettings();
  const transcript = report.transcript ?? "";
  let outcome: Outcome | null = OUTCOMES.includes(report.structuredOutcome as Outcome) ? (report.structuredOutcome as Outcome) : null;
  let summary = report.summary ?? null;
  const reason = report.endedReason ?? "";
  if (!outcome) {
    if (/voicemail/i.test(reason)) outcome = "voicemail";
    else if (/no-answer|did-not-answer|busy|failed-to-connect/i.test(reason) || transcript.trim().length < 20) outcome = "no_answer";
    else if (claudeEnabled()) {
      const r = await classifyCall(transcript).catch(() => null);
      if (r) {
        outcome = r.outcome;
        summary ??= r.summary + (r.callbackTime ? ` (call back: ${r.callbackTime})` : "");
      }
    }
  }
  // Safety net: any opt-out phrase from the person wins over the classifier.
  const personLines = transcript
    .split("\n")
    .filter((l) => /^(user|customer|human)\s*:/i.test(l.trim()))
    .join("\n");
  if (DNC_PHRASES.test(personLines || transcript)) outcome = "do_not_contact";
  outcome ??= "call_back";

  db()
    .prepare("UPDATE calls SET status = 'ended', outcome = ?, summary = ?, transcript = ?, recording_url = ?, ended_reason = ?, ended_at = ? WHERE id = ?")
    .run(outcome, summary, transcript, s.calls.recordCalls ? report.recordingUrl ?? null : null, reason, now(), call.id);
  logEvent(call.lead_id, "call", "ended", `${outcome}${summary ? `: ${summary}` : ""}`);

  if (call.is_test) {
    if (transcript.trim().length > 20) updateSettings("calls", { testPassedAt: now() });
    return outcome;
  }
  if (call.lead_id) {
    switch (outcome) {
      case "do_not_contact":
      case "not_interested":
        optOut({ leadId: call.lead_id, phone: call.phone, channel: "call", reason: outcome === "do_not_contact" ? "Asked not to be called" : "Not interested (call)" });
        break;
      case "booked":
        updateLead(call.lead_id, { consent_status: "granted" });
        setStatus(call.lead_id, "Demo booked", "call");
        break;
      case "interested":
        updateLead(call.lead_id, { consent_status: "granted" });
        setStatus(call.lead_id, "Replied", "call");
        break;
      default:
        break;
    }
    updateLead(call.lead_id, { last_contacted_at: now() });
  }
  return outcome;
}
