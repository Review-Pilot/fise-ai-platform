// Free-demo flow:
//   prospect presses "Build my free demo" on their landing page (or you press Build in the editor)
//   → quickstart builds a real Fise chatbot from their website
//   → a real screenshot (their chatbot answering a real question) is taken
//   → if they asked for it, a "your demo is ready" email is sent with sign-up instructions.
import { db, logEvent, newId, now } from "../db";
import { getLead, setStatus, updateLead } from "../leads";
import { getSettings, updateSettings } from "../settings";
import { enqueue } from "../jobs";
import { isBlocked } from "../dnc";
import { stopSequence } from "../sequences";
import { sastDayStartIso, tomorrowMorning } from "../hours";
import { bestEmail } from "../site/contacts";
import { getEmail, latestDraft, renderEmail } from "../email/build";
import { hasBlockingErrors } from "../email/checks";
import { captureChatPhoto } from "./photo";
import { platformQuickstart, type Quickstart } from "./quickstart";
import { demoOfferOn } from "./offer";
import type { EmailCopy, Lead } from "../types";

const WAIT_MS = 20_000;
const GIVE_UP_MS = 15 * 60_000;

export type RequestResult = { state: "building" | "ready" | "blocked"; message: string };

export function demosStartedToday(at: Date = new Date()): number {
  return (db().prepare("SELECT COUNT(*) c FROM leads WHERE demo_started_at >= ?").get(sastDayStartIso(at)) as { c: number }).c;
}

function pickQuestion(lead: Lead): string {
  const q = lead.research?.likelyCustomerQuestions?.find((x) => x.length > 8 && x.length < 120);
  return q ?? "What are your opening hours?";
}

/** What the landing page's "Build my free demo" button does. Only works while the free-demo switch is on for the lead. */
export async function requestDemoFromLanding(slug: string): Promise<RequestResult> {
  const row = db().prepare("SELECT id FROM leads WHERE landing_slug = ?").get(slug) as { id: string } | undefined;
  const lead = row ? getLead(row.id) : null;
  if (!lead) return { state: "blocked", message: "Page not found" };
  if (!demoOfferOn(lead)) return { state: "blocked", message: "The free demo is not available for this page" };
  return requestDemoBuild(lead.id, { notify: true });
}

/** Starts (or joins) a demo build. `notify` = email the prospect when it is ready. */
export async function requestDemoBuild(leadId: string, opts: { notify: boolean }): Promise<RequestResult> {
  const lead = getLead(leadId);
  if (!lead) return { state: "blocked", message: "Lead not found" };
  if (!lead.website) return { state: "blocked", message: "This lead has no website to build from" };
  if (lead.status === "Do not contact") return { state: "blocked", message: "This lead has opted out" };

  if (opts.notify) {
    // Asking for the demo is consent to receive it, and a clear sign of interest.
    updateLead(leadId, { consent_status: "granted", demo_notify: 1, demo_requested_at: now() });
    logEvent(leadId, "web", "demo_requested", "Pressed the free-demo button");
    if (["New", "Qualified", "Contacted"].includes(lead.status)) setStatus(leadId, "Replied", "requested demo");
    stopSequence(leadId, "requested a demo");
  }

  if (lead.demo_status === "ready") {
    if (opts.notify && !lead.demo_emailed_at) await queueDemoReadyEmail(leadId);
    return { state: "ready", message: "ready" };
  }
  if (lead.demo_status === "building") return { state: "building", message: "building" };

  updateLead(leadId, { demo_status: "building", demo_error: null, demo_chatbot_id: null, demo_started_at: null });
  enqueue("build_demo", { leadId });
  logEvent(leadId, "system", "demo_build_queued", opts.notify ? "requested by prospect" : "started by you");
  return { state: "building", message: "building" };
}

export type AdvanceResult = { state: "waiting" | "deferred"; runAt: Date } | { state: "done" | "failed" };

export interface AdvanceDeps {
  now?: Date;
  quickstart?: Quickstart;
  photo?: typeof captureChatPhoto;
}

/** One step of the build. The worker calls this repeatedly (every ~20 s) until it returns done/failed. */
export async function advanceDemoBuild(leadId: string, deps: AdvanceDeps = {}): Promise<AdvanceResult> {
  const at = deps.now ?? new Date();
  const qs = deps.quickstart ?? platformQuickstart;
  const lead = getLead(leadId);
  if (!lead || lead.demo_status !== "building") return { state: "done" };
  const s = getSettings();
  const fail = (why: string): AdvanceResult => {
    updateLead(leadId, { demo_status: "failed", demo_error: why });
    logEvent(leadId, "system", "demo_build_failed", why);
    return { state: "failed" };
  };

  if (!lead.demo_chatbot_id) {
    if (demosStartedToday(at) >= s.demo.maxPerDay) {
      logEvent(leadId, "system", "demo_deferred", `Daily demo limit (${s.demo.maxPerDay}) reached; will build tomorrow morning`);
      return { state: "deferred", runAt: tomorrowMorning(at) };
    }
    try {
      const created = await qs.create(lead);
      updateLead(leadId, { demo_chatbot_id: created.chatbotId, demo_chat_link: created.chatLink, demo_started_at: at.toISOString() });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return { state: "waiting", runAt: new Date(at.getTime() + WAIT_MS) };
  }

  if (lead.demo_started_at && at.getTime() - new Date(lead.demo_started_at).getTime() > GIVE_UP_MS) {
    return fail("The chatbot took too long to build (over 15 minutes)");
  }
  let st;
  try {
    st = await qs.status(lead.demo_chatbot_id);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (st.state === "building") return { state: "waiting", runAt: new Date(at.getTime() + WAIT_MS) };
  if (st.state === "failed") return fail(st.error ?? "The website scan failed");

  const chatLink = st.chatLink ?? lead.demo_chat_link!;
  try {
    const photo = await (deps.photo ?? captureChatPhoto)({
      chatLink,
      question: pickQuestion(lead),
      fileBase: lead.id,
      subject: `the ${lead.business_name} Fise chatbot`,
    });
    updateLead(leadId, { demo_photo: photo.file, demo_photo_alt: photo.alt });
  } catch (e) {
    // The demo itself works; only the email photo is missing.
    logEvent(leadId, "system", "demo_photo_failed", e instanceof Error ? e.message : String(e));
  }
  updateLead(leadId, { demo_status: "ready", demo_error: null, demo_chat_link: chatLink });
  logEvent(leadId, "system", "demo_ready", chatLink);

  const draft = latestDraft(leadId);
  if (draft && draft.status === "draft") await renderEmail(draft.id);
  const fresh = getLead(leadId)!;
  if (fresh.demo_notify && !fresh.demo_emailed_at) await queueDemoReadyEmail(leadId);
  return { state: "done" };
}

/** Creates the "your demo is ready" email and queues it. It answers the prospect's own request, so it
 *  skips the approval batch, but still respects the do-not-contact list, DNS check and pause switch. */
export async function queueDemoReadyEmail(leadId: string): Promise<string | null> {
  const lead = getLead(leadId);
  if (!lead) return null;
  const firstSent = db()
    .prepare("SELECT to_email FROM emails WHERE lead_id = ? AND kind = 'initial' AND status = 'sent' ORDER BY sent_at LIMIT 1")
    .get(leadId) as { to_email: string } | undefined;
  const to = firstSent?.to_email ?? bestEmail(lead.contacts)?.value;
  if (!to) {
    logEvent(leadId, "email", "demo_email_skipped", "No email address for this lead");
    return null;
  }
  const blocked = isBlocked({ email: to, domain: lead.domain });
  if (blocked) {
    logEvent(leadId, "email", "demo_email_skipped", blocked);
    return null;
  }
  const { profile } = getSettings();
  const question = pickQuestion(lead);
  const subjectFull = `Your Fise chatbot for ${lead.business_name} is ready`;
  const subject = subjectFull.length < 50 ? subjectFull : "Your Fise chatbot is ready";
  const copy: EmailCopy & { followupBody: string } = {
    subject,
    preheader: "Try it now. Sign-up steps are on the next page.",
    greeting: lead.contact_first_name ? `Hi ${lead.contact_first_name},` : `Hi ${lead.business_name} team,`,
    opening: "",
    benefits: [],
    comparison: "",
    ctaText: "Open your chatbot",
    closing: "",
    whatsappMessage: "",
    contactFormMessage: "",
    socialMessage: "",
    smsMessage: "",
    followupBody:
      `Thanks for asking for the demo. We built a chatbot from your website's public pages so you can see how it would answer your own customers.\n\n` +
      `Open it with the button below and try a few real questions, for example: "${question}"\n\n` +
      `If you like it, you can create your own Fise account in about a minute and put the chatbot on your website. The sign-up link is on the page the button opens. ` +
      `If you'd like a hand with setup, just reply to this email and ${profile.senderName} will help.`,
  };
  const id = newId("em");
  db()
    .prepare("INSERT INTO emails (id, lead_id, kind, to_email, subject, preheader, copy, status, created_at, updated_at) VALUES (?, ?, 'demo_ready', ?, ?, ?, ?, 'queued', ?, ?)")
    .run(id, leadId, to, subject, copy.preheader, JSON.stringify(copy), now(), now());
  const email = await renderEmail(id);
  if (hasBlockingErrors(email.checks)) {
    const why = email.checks.filter((c) => !c.ok && c.severity === "error").map((c) => c.label).join(", ");
    db().prepare("UPDATE emails SET status = 'failed', error = ? WHERE id = ?").run(`Checks failed: ${why}`, id);
    logEvent(leadId, "email", "demo_email_failed", why);
    return null;
  }
  updateLead(leadId, { demo_emailed_at: now() });
  enqueue("send_email", { emailId: id });
  logEvent(leadId, "email", "demo_email_queued", to);
  return id;
}

/** Takes the real "example" photo used in emails to leads that don't have their own demo yet. */
export async function captureShowcase(deps: { photo?: typeof captureChatPhoto } = {}) {
  const { demo } = getSettings();
  if (!demo.showcaseLink) throw new Error("Paste a Fise chat link in Settings → Free demo first");
  const photo = await (deps.photo ?? captureChatPhoto)({
    chatLink: demo.showcaseLink,
    question: demo.showcaseQuestion || "What are your opening hours?",
    fileBase: "showcase",
    subject: "an example Fise chatbot answering a customer's question",
  });
  updateSettings("demo", { showcaseImage: photo.file, showcaseAlt: photo.alt });
  return photo;
}

export { getEmail };
