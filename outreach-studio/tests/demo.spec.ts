import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-demo-"));
process.env.PUBLIC_BASE_URL = "https://outreach.fise.test";
process.env.ALLOWED_LINK_DOMAINS = "fise.test";
process.env.RESEND_API_KEY = "re_test";
process.env.FROM_EMAIL = "Sam <sam@mail.fise.test>";
delete process.env.ANTHROPIC_API_KEY;

const SAT_11PM = new Date("2026-10-03T23:00:00+02:00"); // Saturday night: cold sends would wait, requested demos don't
type Qs = import("@/lib/demo/quickstart").Quickstart;

function fakeQuickstart(plan: { statuses: ("building" | "ready" | "failed")[]; createError?: string }) {
  const calls = { create: 0, status: 0 };
  const qs: Qs = {
    async create() {
      calls.create++;
      if (plan.createError) throw new Error(plan.createError);
      return { chatbotId: "bot_1", chatLink: "https://fise-platform.test/chat/fise_abc123" };
    },
    async status() {
      const state = plan.statuses[Math.min(calls.status++, plan.statuses.length - 1)];
      return state === "failed" ? { state, error: "The website scan failed" } : { state, chatLink: "https://fise-platform.test/chat/fise_abc123" };
    },
  };
  return { qs, calls };
}

async function photoStub(args: { question: string; subject: string; fileBase: string }) {
  const sharp = (await import("sharp")).default;
  const { saveGraphic } = await import("@/lib/email/graphic");
  const saved = await saveGraphic(args.fileBase, await sharp({ create: { width: 480, height: 420, channels: 3, background: "#eee" } }).png().toBuffer());
  return { ...saved, question: args.question, reply: "We can help.", alt: `Screenshot of ${args.subject}. Customer asks: "${args.question}" The chatbot answers: "We can help."` };
}

async function makeLead(name: string, email: string, extra: Record<string, unknown> = {}) {
  const { createLead, updateLead } = await import("@/lib/leads");
  const { generateEmail } = await import("@/lib/email/build");
  const lead = createLead({ business_name: name, website: `https://${name.replace(/\W/g, "").toLowerCase()}.test`, email, keyword: "plumber", city: "Durban" });
  updateLead(lead.id, {
    contacts: [{ kind: "email", value: email, sourceUrl: "https://x.test/contact", foundAt: "", valid: true, emailType: "named" }],
    research: {
      finalUrl: "", httpStatus: 200, fetchedAt: "", pages: [], blockedByRobots: [], parked: false, socialOnly: false, platform: "WordPress", platformEvidence: [],
      canInstall: "yes", canInstallReason: "", chatTools: [], services: [], corporateSignals: [], chainSignals: [], wordCount: 300,
      likelyCustomerQuestions: ["Can you fix a burst geyser today?"],
    },
    ...extra,
  } as never);
  const { email: draft } = await generateEmail(lead.id);
  return { leadId: lead.id, draftId: draft.id };
}

beforeAll(async () => {
  const { updateSettings } = await import("@/lib/settings");
  updateSettings("profile", { websiteUrl: "https://fise.test", demoUrl: "https://fise.test/demo", senderName: "Sam Dlamini", address: "12 Loop Street, Cape Town" });
  updateSettings("sending", { dnsVerifiedAt: new Date().toISOString() });
});

describe("free demo flow", () => {
  it("landing button builds the chatbot, photographs it, and emails it with sign-up steps — even outside business hours", async () => {
    const { requestDemoFromLanding, advanceDemoBuild } = await import("@/lib/demo/flow");
    const { getLead, updateLead } = await import("@/lib/leads");
    const { sendQueuedEmail } = await import("@/lib/sending");
    const { getEmail } = await import("@/lib/email/build");
    const { getSequence, startSequence } = await import("@/lib/sequences");
    const { db } = await import("@/lib/db");
    const a = await makeLead("Aqua Plumbing", "nomsa@aquaplumbing.test", { status: "Contacted", demo_offer: 1 });
    db().prepare("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ?").run(new Date().toISOString(), a.draftId);
    startSequence(a.leadId, new Date(), 4);
    const slug = getLead(a.leadId)!.landing_slug!;

    const r = await requestDemoFromLanding(slug);
    expect(r.state).toBe("building");
    let l = getLead(a.leadId)!;
    expect(l.consent_status).toBe("granted"); // asking for the demo is consent
    expect(l.status).toBe("Replied");
    expect(getSequence(a.leadId)!.status).toBe("stopped"); // no follow-ups after they engaged
    expect(db().prepare("SELECT COUNT(*) c FROM jobs WHERE type = 'build_demo'").get()).toEqual({ c: 1 });
    // pressing again while building does not start a second build
    await requestDemoFromLanding(slug);
    expect(db().prepare("SELECT COUNT(*) c FROM jobs WHERE type = 'build_demo'").get()).toEqual({ c: 1 });

    const { qs, calls } = fakeQuickstart({ statuses: ["building", "building", "ready"] });
    const deps = { quickstart: qs, photo: photoStub, now: SAT_11PM };
    expect((await advanceDemoBuild(a.leadId, deps)).state).toBe("waiting"); // created
    expect((await advanceDemoBuild(a.leadId, deps)).state).toBe("waiting"); // scanning
    expect((await advanceDemoBuild(a.leadId, deps)).state).toBe("waiting"); // scanning
    expect((await advanceDemoBuild(a.leadId, deps)).state).toBe("done"); // ready → photo → email queued
    expect(calls.create).toBe(1);
    l = getLead(a.leadId)!;
    expect(l.demo_status).toBe("ready");
    expect(l.demo_chat_link).toBe("https://fise-platform.test/chat/fise_abc123");
    expect(l.demo_photo).toMatch(/\.png$/);
    expect(l.demo_emailed_at).toBeTruthy();

    // The first (already sent) email is untouched; the demo-ready email is queued and passes every check
    const ready = db().prepare("SELECT id FROM emails WHERE lead_id = ? AND kind = 'demo_ready'").get(a.leadId) as { id: string };
    const em = getEmail(ready.id)!;
    expect(em.status).toBe("queued");
    expect(em.to_email).toBe("nomsa@aquaplumbing.test");
    expect(em.checks.filter((c) => !c.ok)).toEqual([]);
    const $ = cheerio.load(em.html);
    expect($("a[href]").length).toBeLessThanOrEqual(3);
    expect($("a[href]").toArray().map((el) => new URL($(el).attr("href")!).hostname).every((h) => h === "outreach.fise.test" || h === "fise.test")).toBe(true);
    expect(em.html).toContain("Open your chatbot");
    expect(em.html).toContain("create your own Fise account");
    expect($("img").attr("src")).toMatch(/\/i\/.+\.png$/);
    expect($("img").attr("alt")).toMatch(/^Screenshot of the Aqua Plumbing Fise chatbot/);
    expect(em.html + em.text).not.toMatch(/15[- ]minute/i);
    expect(em.subject).toBe("Your Fise chatbot for Aqua Plumbing is ready");

    // Sending on a Saturday night works because they asked for it; headers + multipart still present
    const sent: { headers: Record<string, string>; text: string }[] = [];
    const res = await sendQueuedEmail(ready.id, { now: SAT_11PM, send: async (m) => { sent.push(m); return "prov_1"; } });
    expect(res.status).toBe("sent");
    expect(sent[0].headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent[0].text).toMatch(/Unsubscribe: https:\/\//);
    expect(getSequence(a.leadId)!.status).toBe("stopped"); // sending it does not restart the sequence
    // Asking again after it was emailed does not email twice
    updateLead(a.leadId, { demo_notify: 1 });
    await requestDemoFromLanding(slug);
    expect(db().prepare("SELECT COUNT(*) c FROM emails WHERE lead_id = ? AND kind = 'demo_ready'").get(a.leadId)).toEqual({ c: 1 });
  });

  it("does nothing for leads with the switch off, opted-out leads, or blocked addresses", async () => {
    const { requestDemoFromLanding, requestDemoBuild } = await import("@/lib/demo/flow");
    const { getLead } = await import("@/lib/leads");
    const { addDnc } = await import("@/lib/dnc");
    const { db } = await import("@/lib/db");
    const cold = await makeLead("Cold Co", "a@coldco.test"); // cold + automatic → switch off
    const r1 = await requestDemoFromLanding(getLead(cold.leadId)!.landing_slug!);
    expect(r1.state).toBe("blocked");
    expect(getLead(cold.leadId)!.demo_status).toBe("none");

    const dnc = await makeLead("Opted Out", "b@optedout.test", { demo_offer: 1 });
    addDnc("b@optedout.test", "test", "test");
    const { optOut } = await import("@/lib/optout");
    optOut({ leadId: dnc.leadId, email: "b@optedout.test", channel: "email", reason: "test" });
    expect((await requestDemoBuild(dnc.leadId, { notify: true })).state).toBe("blocked");
    expect(db().prepare("SELECT COUNT(*) c FROM jobs WHERE type='build_demo' AND json_extract(payload,'$.leadId') = ?").get(dnc.leadId)).toEqual({ c: 0 });
  });

  it("warm leads get the button automatically (when the setting is on), cold leads don't", async () => {
    const { demoOfferOn, isWarm } = await import("@/lib/demo/offer");
    const { getLead, updateLead } = await import("@/lib/leads");
    const { updateSettings } = await import("@/lib/settings");
    const x = await makeLead("Warm Co", "w@warmco.test");
    expect(demoOfferOn(getLead(x.leadId)!)).toBe(false);
    updateLead(x.leadId, { status: "Replied" });
    expect(isWarm(getLead(x.leadId)!)).toBe(true);
    expect(demoOfferOn(getLead(x.leadId)!)).toBe(true);
    updateSettings("demo", { autoForWarm: false });
    expect(demoOfferOn(getLead(x.leadId)!)).toBe(false);
    updateLead(x.leadId, { demo_offer: 1 });
    expect(demoOfferOn(getLead(x.leadId)!)).toBe(true);
    updateSettings("demo", { autoForWarm: true });
  });

  it("failed builds are recorded and nothing is emailed; the daily limit defers builds to tomorrow morning; the example photo works", async () => {
    const { requestDemoBuild, advanceDemoBuild, captureShowcase } = await import("@/lib/demo/flow");
    const { getLead } = await import("@/lib/leads");
    const { updateSettings, getSettings } = await import("@/lib/settings");
    const { db } = await import("@/lib/db");

    const f = await makeLead("Fail Co", "f@failco.test", { demo_offer: 1 });
    await requestDemoBuild(f.leadId, { notify: true });
    const bad = fakeQuickstart({ statuses: ["failed"] });
    await advanceDemoBuild(f.leadId, { quickstart: bad.qs, photo: photoStub });
    expect((await advanceDemoBuild(f.leadId, { quickstart: bad.qs, photo: photoStub })).state).toBe("failed");
    expect(getLead(f.leadId)!.demo_status).toBe("failed");
    expect(getLead(f.leadId)!.demo_error).toMatch(/scan failed/);
    expect(db().prepare("SELECT COUNT(*) c FROM emails WHERE lead_id = ? AND kind = 'demo_ready'").get(f.leadId)).toEqual({ c: 0 });

    const e = await makeLead("Error Co", "e@errorco.test", { demo_offer: 1 });
    await requestDemoBuild(e.leadId, { notify: false });
    const broken = fakeQuickstart({ statuses: ["ready"], createError: "Quickstart failed (503)" });
    expect((await advanceDemoBuild(e.leadId, { quickstart: broken.qs })).state).toBe("failed");

    updateSettings("demo", { maxPerDay: 1 });
    const g = await makeLead("Cap Co", "c@capco.test", { demo_offer: 1 });
    await requestDemoBuild(g.leadId, { notify: false });
    const ok = fakeQuickstart({ statuses: ["building"] });
    const now = new Date("2026-10-05T10:00:00+02:00");
    // another demo was already started today → this one waits for tomorrow 08:00 SAST
    db().prepare("UPDATE leads SET demo_started_at = ? WHERE id = ?").run(now.toISOString(), f.leadId);
    const r = await advanceDemoBuild(g.leadId, { quickstart: ok.qs, now });
    expect(r.state).toBe("deferred");
    expect((r as { runAt: Date }).runAt.toISOString()).toBe(new Date("2026-10-06T08:00:00+02:00").toISOString());
    expect(ok.calls.create).toBe(0);
    updateSettings("demo", { maxPerDay: 10 });

    // Example photo from a configured showcase chatbot
    await expect(captureShowcase({ photo: photoStub })).rejects.toThrow(/Free demo/);
    updateSettings("demo", { showcaseLink: "https://fise-platform.test/chat/fise_show", showcaseQuestion: "Do you do call-outs?" });
    const p = await captureShowcase({ photo: photoStub });
    expect(getSettings().demo.showcaseImage).toBe(p.file);
    expect(getSettings().demo.showcaseAlt).toMatch(/^Screenshot of an example Fise chatbot/);
  });
});
