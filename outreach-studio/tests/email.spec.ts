import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as cheerio from "cheerio";
import { startFixtureSite } from "./fixtures/site";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-email-"));
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.PUBLIC_BASE_URL = "https://outreach.fise.test";
process.env.ALLOWED_LINK_DOMAINS = "fise.test";
delete process.env.ANTHROPIC_API_KEY;

let site: Awaited<ReturnType<typeof startFixtureSite>>;
beforeAll(async () => {
  site = await startFixtureSite();
  const { updateSettings } = await import("@/lib/settings");
  updateSettings("profile", { websiteUrl: "https://fise.test", demoUrl: "https://fise.test/demo", senderName: "Sam Dlamini", address: "12 Loop Street, Cape Town, 8001" });
});
afterAll(() => site.close());

async function fakePhoto(name: string) {
  const sharp = (await import("sharp")).default;
  const { imagesDir } = await import("@/lib/email/graphic");
  const file = `${name}.png`;
  fs.writeFileSync(path.join(imagesDir(), file), await sharp({ create: { width: 480, height: 700, channels: 3, background: "#ddd" } }).png().toBuffer());
  return file;
}

describe("email generation", () => {
  it("builds a compliant text-only email for a cold lead: no mock-up, no 15-minute demo, plain 'See how Fise works' button", async () => {
    const { createLead, getLead, updateLead } = await import("@/lib/leads");
    const { researchLead } = await import("@/lib/site/analyze");
    const { generateEmail } = await import("@/lib/email/build");
    const { hasBlockingErrors } = await import("@/lib/email/checks");
    const lead = createLead({ business_name: "Kin Electrical", website: site.url, keyword: "electrician", city: "Cape Town" });
    await researchLead(lead.id);
    const l = getLead(lead.id)!;
    updateLead(lead.id, { contacts: l.contacts.map((c) => (c.kind === "email" ? { ...c, valid: true, validationNote: "MX ok (test)" } : c)) });

    const { email, source } = await generateEmail(lead.id);
    expect(source).toBe("template");
    expect(email.to_email).toBe("thabo@kinelectrical-fixture.co.za");
    expect(email.checks.filter((c) => !c.ok)).toEqual([]);
    expect(hasBlockingErrors(email.checks)).toBe(false);

    const $ = cheerio.load(email.html);
    expect($("a[href]").length).toBeLessThanOrEqual(3);
    expect($("img").length).toBe(0); // nothing is made up: no photo until a real one exists
    expect(email.html).toContain("See how Fise works");
    expect(email.html).toContain("Prefer to talk it through first?");
    expect(email.html + email.text).not.toMatch(/15[- ]minute|book a/i);
    expect(email.html).toMatch(/v:roundrect/); // Outlook bulletproof button
    expect(email.html).not.toMatch(/<script|<form|<iframe|@font-face/i);
    expect(Buffer.byteLength(email.html)).toBeLessThan(100_000);
    expect(email.text).toMatch(/Unsubscribe: https:\/\/outreach\.fise\.test\/u\//);
    expect(email.subject.length).toBeLessThan(50);
    expect(email.html.toLowerCase()).toContain(getLead(lead.id)!.colors!.primary.toLowerCase());
    fs.writeFileSync(path.join(process.env.DATA_DIR!, "sample.html"), email.html);
  }, 60_000);

  it("uses a real photo: the example chatbot for leads without a demo, their own once built; 'Get your free demo' when the switch is on", async () => {
    const { createLead, updateLead, getLead } = await import("@/lib/leads");
    const { generateEmail, renderEmail } = await import("@/lib/email/build");
    const { updateSettings } = await import("@/lib/settings");
    const lead = createLead({ business_name: "Aqua Plumbing", website: "https://aquaplumbing.test", email: "nomsa@aquaplumbing.test", keyword: "plumber" });
    updateLead(lead.id, { contacts: [{ kind: "email", value: "nomsa@aquaplumbing.test", sourceUrl: "https://aquaplumbing.test/contact", foundAt: "", valid: true, emailType: "named" }] });
    const { email } = await generateEmail(lead.id);
    expect(cheerio.load(email.html)("img").length).toBe(0);

    // Example chatbot photo configured → cold leads get it (and the alt text says it is an example)
    updateSettings("demo", { showcaseImage: await fakePhoto("showcase"), showcaseAlt: "Example of a Fise chatbot. Customer asks: \"Do you do call-outs?\" The chatbot answers: \"Yes, 24/7.\"" });
    const withExample = await renderEmail(email.id);
    const $a = cheerio.load(withExample.html);
    expect($a("img").length).toBe(1);
    expect($a("img").attr("alt")).toMatch(/^Example of a Fise chatbot/);
    expect(withExample.checks.filter((c) => !c.ok)).toEqual([]);
    expect(withExample.html).toContain("See how Fise works");

    // Warm lead + their own built demo → their own photo and the free-demo button
    updateLead(lead.id, { consent_status: "granted", demo_status: "ready", demo_photo: await fakePhoto("own"), demo_photo_alt: "Screenshot of the Aqua Plumbing Fise chatbot. Customer asks: \"Burst geyser?\" The chatbot answers: \"We can help.\"" });
    expect(getLead(lead.id)!.demo_offer).toBeNull();
    const warm = await renderEmail(email.id);
    const $b = cheerio.load(warm.html);
    expect($b("img").attr("src")).toMatch(/\/i\/own\.png$/);
    expect($b("img").attr("alt")).toMatch(/^Screenshot of the Aqua Plumbing Fise chatbot/);
    expect(warm.html).toContain("Get your free demo");
    expect(warm.html).toContain("Press the button and we");
    expect(warm.text).toMatch(/Get your free demo: https:\/\/outreach\.fise\.test\/p\//);
    expect(warm.checks.filter((c) => !c.ok)).toEqual([]);

    // Manual switch beats automatic
    updateLead(lead.id, { demo_offer: 0 });
    expect((await renderEmail(email.id)).html).toContain("See how Fise works");
    // Turning automatic-for-warm off also turns it off
    updateLead(lead.id, { demo_offer: null });
    updateSettings("demo", { autoForWarm: false });
    expect((await renderEmail(email.id)).html).toContain("See how Fise works");
    updateSettings("demo", { autoForWarm: true });
  }, 60_000);

  it("flags rule breaks: off-domain links, spam words, long subjects", async () => {
    const { runChecks } = await import("@/lib/email/checks");
    const copy = {
      subject: "ACT NOW!!! Guaranteed 100% more leads for your business today",
      preheader: "x", greeting: "Hi", opening: "", benefits: [], comparison: "", ctaText: "Click here", closing: "",
      whatsappMessage: "", contactFormMessage: "", socialMessage: "", smsMessage: "",
    };
    const html = `<html><body><table><tr><td><a href="https://bit.ly/x">bit.ly/x</a><a href="http://1.2.3.4/">x</a>
      <a href="https://fise.test/a">evil.com</a><a href="https://fise.test/u/1">Unsubscribe</a><img src="https://fise.test/a.png"></td></tr></table></body></html>`;
    const checks = runChecks({ html, text: "short", copy, subject: copy.subject, ownDomains: ["fise.test"], unsubscribeUrl: "https://fise.test/u/1", address: "1 Road" });
    const failed = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.id, c.detail]));
    expect(Object.keys(failed)).toEqual(expect.arrayContaining(["links_count", "links_domains", "images_attrs", "subject_len", "subject_punct", "spam_words", "caps", "plaintext", "unsubscribe_text"]));
    expect(failed.links_domains).toMatch(/shortener/);
    expect(failed.links_domains).toMatch(/raw IP/);
    expect(failed.links_domains).toMatch(/doesn't match/);
  });
});
