import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-send-"));
process.env.PUBLIC_BASE_URL = "https://outreach.fise.test";
process.env.ALLOWED_LINK_DOMAINS = "fise.test";
process.env.RESEND_API_KEY = "re_test";
process.env.FROM_EMAIL = "Sam <sam@mail.fise.test>";
delete process.env.ANTHROPIC_API_KEY;

const TUESDAY_10AM = new Date("2026-09-29T10:00:00+02:00");
type Sent = { to: string; headers: Record<string, string>; html: string; text: string; subject: string };
const sent: Sent[] = [];
const fakeSend = async (m: Sent) => {
  sent.push(m);
  return `prov_${sent.length}`;
};

async function makeLeadWithDraft(name: string, email: string) {
  const { createLead, updateLead } = await import("@/lib/leads");
  const { generateEmail } = await import("@/lib/email/build");
  const { finalisePalette } = await import("@/lib/color");
  const lead = createLead({ business_name: name, website: `https://${email.split("@")[1]}`, email, keyword: "plumber", city: "Durban" });
  updateLead(lead.id, {
    colors: finalisePalette("#0a7d4f", "#123", "#f59e0b", "site"),
    contacts: [{ kind: "email", value: email, sourceUrl: `https://${email.split("@")[1]}/contact`, foundAt: "", valid: true, emailType: "named" }],
    research: {
      finalUrl: "", httpStatus: 200, fetchedAt: "", pages: [], blockedByRobots: [], parked: false, socialOnly: false, platform: "WordPress",
      platformEvidence: [], canInstall: "yes", canInstallReason: "", chatTools: [], services: ["Geyser repairs"], corporateSignals: [], chainSignals: [],
      likelyCustomerQuestions: ["Can you fix a burst geyser today?", "Do you work in Umhlanga?", "How much is a call-out?"], wordCount: 300, location: "Durban North",
    },
  });
  const { email: draft } = await generateEmail(lead.id);
  return { leadId: lead.id, emailId: draft.id };
}

beforeAll(async () => {
  const { updateSettings } = await import("@/lib/settings");
  updateSettings("profile", { websiteUrl: "https://fise.test", demoUrl: "https://fise.test/demo", address: "12 Loop Street, Cape Town" });
});

describe("tokens and signatures", () => {
  it("unsubscribe tokens verify and reject tampering", async () => {
    const { unsubscribeToken, verifyUnsubscribeToken } = await import("@/lib/unsubscribe");
    const t = unsubscribeToken("A@B.co.za", "lead_1");
    expect(verifyUnsubscribeToken(t)).toEqual({ email: "a@b.co.za", leadId: "lead_1" });
    expect(verifyUnsubscribeToken(t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"))).toBeNull();
  });
  it("verifies Svix webhook signatures", async () => {
    const { verifySvix } = await import("@/lib/svix");
    const secret = `whsec_${Buffer.from("topsecret").toString("base64")}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"type":"email.bounced"}';
    const sig = createHmac("sha256", Buffer.from("topsecret")).update(`msg_1.${ts}.${body}`).digest("base64");
    const h = new Headers({ "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` });
    expect(verifySvix(body, h, secret)).toBe(true);
    expect(verifySvix(body + " ", h, secret)).toBe(false);
  });
});

describe("warm-up", () => {
  it("starts at 20/day and grows weekly up to the max", async () => {
    const { dailyLimit } = await import("@/lib/sending");
    const { updateSettings } = await import("@/lib/settings");
    expect(dailyLimit()).toBe(20);
    updateSettings("sending", { firstSendDate: new Date(Date.now() - 15 * 86400_000).toISOString() });
    expect(dailyLimit()).toBe(40);
    updateSettings("sending", { firstSendDate: new Date(Date.now() - 400 * 86400_000).toISOString() });
    expect(dailyLimit()).toBe(100);
    updateSettings("sending", { firstSendDate: null });
  });
});

describe("approval, sending and safety", () => {
  it("requires approval, re-checks DNC and DNS at send time, and sends multipart with one-click unsubscribe headers", async () => {
    const { addEmailsToBatch, approveBatch } = await import("@/lib/batches");
    const { sendQueuedEmail } = await import("@/lib/sending");
    const { getEmail } = await import("@/lib/email/build");
    const { getLead } = await import("@/lib/leads");
    const { getSequence } = await import("@/lib/sequences");
    const { updateSettings } = await import("@/lib/settings");
    const { db } = await import("@/lib/db");

    const a = await makeLeadWithDraft("Aqua Plumbing", "nomsa@aquaplumbing.test");
    const { batchId, added } = addEmailsToBatch([a.emailId]);
    expect(added).toEqual([a.emailId]);
    // Not sendable until approved
    expect((await sendQueuedEmail(a.emailId, { send: fakeSend, now: TUESDAY_10AM })).status).toBe("skipped");
    const approval = approveBatch(batchId!);
    expect(approval.queued).toBe(1);
    expect(getEmail(a.emailId)!.status).toBe("queued");
    expect((db().prepare("SELECT COUNT(*) c FROM jobs WHERE type = 'send_email'").get() as { c: number }).c).toBe(1);

    // DNS not verified → refuses
    expect((await sendQueuedEmail(a.emailId, { send: fakeSend, now: TUESDAY_10AM })).status).toBe("failed");
    db().prepare("UPDATE emails SET status = 'queued' WHERE id = ?").run(a.emailId);
    updateSettings("sending", { dnsVerifiedAt: new Date().toISOString() });

    // Outside business hours → rescheduled
    const night = await sendQueuedEmail(a.emailId, { send: fakeSend, now: new Date("2026-09-29T21:00:00+02:00") });
    expect(night.status).toBe("rescheduled");

    const r = await sendQueuedEmail(a.emailId, { send: fakeSend, now: TUESDAY_10AM });
    expect(r.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].headers["List-Unsubscribe"]).toMatch(/^<https:\/\/outreach\.fise\.test\/api\/unsub\/.+>, <mailto:sam@mail\.fise\.test\?subject=unsubscribe>$/);
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0].html).toMatch(/<table/);
    expect(sent[0].text).toMatch(/Unsubscribe: https:\/\//);
    const lead = getLead(a.leadId)!;
    expect(lead.status).toBe("Contacted");
    expect(lead.consent_status).toBe("requested");
    expect(getSequence(a.leadId)!.status).toBe("active");
    // A second first-email to the same lead is refused
    const { generateEmail } = await import("@/lib/email/build");
    const second = await generateEmail(a.leadId);
    expect(addEmailsToBatch([second.email.id]).skipped[0].reason).toMatch(/already sent/);
  });

  it("blocks do-not-contact recipients and enforces the per-domain cap", async () => {
    const { addEmailsToBatch, approveBatch } = await import("@/lib/batches");
    const { sendQueuedEmail } = await import("@/lib/sending");
    const { addDnc } = await import("@/lib/dnc");
    const { getEmail } = await import("@/lib/email/build");
    const { db } = await import("@/lib/db");

    const b = await makeLeadWithDraft("Blocked Co", "owner@blocked.test");
    addDnc("blocked.test", "test", "test");
    expect(addEmailsToBatch([b.emailId]).skipped[0].reason).toMatch(/do-not-contact/);
    // Even if it slipped into the queue, the send-time check stops it
    db().prepare("UPDATE emails SET status = 'queued' WHERE id = ?").run(b.emailId);
    expect((await sendQueuedEmail(b.emailId, { send: fakeSend, now: TUESDAY_10AM })).status).toBe("blocked");
    expect(getEmail(b.emailId)!.status).toBe("blocked");

    const c1 = await makeLeadWithDraft("Same Domain 1", "a@shared.test");
    const c2 = await makeLeadWithDraft("Same Domain 2", "b@shared.test");
    const c3 = await makeLeadWithDraft("Same Domain 3", "c@shared.test");
    const { batchId } = addEmailsToBatch([c1.emailId, c2.emailId, c3.emailId]);
    approveBatch(batchId!);
    expect((await sendQueuedEmail(c1.emailId, { send: fakeSend, now: TUESDAY_10AM })).status).toBe("sent");
    expect((await sendQueuedEmail(c2.emailId, { send: fakeSend, now: TUESDAY_10AM })).status).toBe("sent");
    const third = await sendQueuedEmail(c3.emailId, { send: fakeSend, now: TUESDAY_10AM });
    expect(third.status).toBe("rescheduled");
    expect((third as { why: string }).why).toMatch(/Per-domain cap/);
  });

  it("pauses sending automatically on a complaint or a bounce rate above 3%", async () => {
    const { enforceSafetyStops, bounceStats } = await import("@/lib/sending");
    const { getSettings, updateSettings } = await import("@/lib/settings");
    const { db, logEvent } = await import("@/lib/db");
    // Pretend 30 were sent and 1 bounced (3.3%)
    const insert = db().prepare("INSERT INTO emails (id, lead_id, kind, status, sent_at, created_at, updated_at) SELECT 'x' || ?, id, 'initial', 'sent', ?, ?, ? FROM leads LIMIT 1");
    for (let i = 0; i < 27; i++) insert.run(i, new Date().toISOString(), "", "");
    logEvent(null, "email", "bounce", "x");
    expect(bounceStats().sent).toBe(30);
    enforceSafetyStops();
    expect(getSettings().sending.paused).toBe(true);
    expect(getSettings().sending.pauseReason).toMatch(/Bounce rate 3\.3%/);
    updateSettings("sending", { paused: false, pauseReason: null });
    logEvent(null, "email", "complaint", "x");
    enforceSafetyStops();
    expect(getSettings().sending.pauseReason).toMatch(/complaint/);
    updateSettings("sending", { paused: false, pauseReason: null });
  });
});

describe("opt-outs, sequences and replies", () => {
  it("one-click unsubscribe blocks the lead on every channel and stops everything", async () => {
    const { optOut } = await import("@/lib/optout");
    const { isBlocked } = await import("@/lib/dnc");
    const { getLead, updateLead } = await import("@/lib/leads");
    const { getEmail } = await import("@/lib/email/build");
    const d = await makeLeadWithDraft("Opt Out Ltd", "jo@optout.test");
    updateLead(d.leadId, { contacts: [...getLead(d.leadId)!.contacts, { kind: "phone", value: "+27821112222", sourceUrl: "x", foundAt: "" }] });
    optOut({ leadId: d.leadId, email: "jo@optout.test", channel: "email", reason: "Unsubscribed (one-click)" });
    expect(isBlocked({ email: "jo@optout.test" })).toBeTruthy();
    expect(isBlocked({ phone: "082 111 2222" })).toBeTruthy();
    expect(getLead(d.leadId)!.status).toBe("Do not contact");
    expect(getEmail(d.emailId)!.status).toBe("cancelled");
  });

  it("consent-first mode stops follow-ups; with consent a follow-up draft waits for approval", async () => {
    const { sequenceTick, getSequence, startSequence } = await import("@/lib/sequences");
    const { updateLead } = await import("@/lib/leads");
    const { db } = await import("@/lib/db");
    const e = await makeLeadWithDraft("Seq One", "a@seqone.test");
    const f = await makeLeadWithDraft("Seq Two", "b@seqtwo.test");
    for (const x of [e, f]) {
      db().prepare("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date(Date.now() - 5 * 86400_000).toISOString(), x.emailId);
      startSequence(x.leadId, new Date(Date.now() - 5 * 86400_000), 4);
    }
    updateLead(f.leadId, { consent_status: "granted" });
    const r = await sequenceTick();
    expect(getSequence(e.leadId)!.status).toBe("stopped");
    expect(getSequence(e.leadId)!.stop_reason).toMatch(/consent-first/);
    expect(getSequence(f.leadId)!.step).toBe(2);
    const fu = db().prepare("SELECT e.status, e.kind, b.status bs, b.note FROM emails e JOIN batches b ON b.id = e.batch_id WHERE e.lead_id = ? AND e.kind = 'followup1'").get(f.leadId) as Record<string, string>;
    expect(fu).toMatchObject({ status: "draft", kind: "followup1", bs: "pending_approval", note: "Follow-ups" });
    expect(r.drafted).toBe(1);
  });

  it("replies stop the sequence; 'remove me' replies opt out", async () => {
    const { handleReply } = await import("@/lib/replies");
    const { getSequence } = await import("@/lib/sequences");
    const { getLead } = await import("@/lib/leads");
    const { isBlocked } = await import("@/lib/dnc");
    const { db } = await import("@/lib/db");
    const lead = db().prepare("SELECT lead_id FROM emails WHERE to_email = 'nomsa@aquaplumbing.test'").get() as { lead_id: string };
    expect(await handleReply({ from: "nomsa@aquaplumbing.test", subject: "Out of Office: back Monday", text: "" })).toBe("auto_reply");
    expect(getSequence(lead.lead_id)!.status).toBe("active");
    expect(await handleReply({ from: "Nomsa@AquaPlumbing.test", subject: "Re: your email", text: "Sounds interesting, tell me more" })).toBe("other");
    expect(getLead(lead.lead_id)!.status).toBe("Replied");
    expect(getSequence(lead.lead_id)!.status).toBe("stopped");
    const other = db().prepare("SELECT lead_id FROM emails WHERE to_email = 'a@shared.test'").get() as { lead_id: string };
    expect(await handleReply({ from: "a@shared.test", subject: "Re: hi", text: "Please remove me from your list." })).toBe("unsubscribe");
    expect(isBlocked({ email: "a@shared.test" })).toBeTruthy();
    expect(getLead(other.lead_id)!.status).toBe("Do not contact");
  });
});
