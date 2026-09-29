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

describe("email generation", () => {
  it("builds a compliant, branded email with plain text, graphic and passing checks", async () => {
    const { createLead, getLead, updateLead } = await import("@/lib/leads");
    const { researchLead } = await import("@/lib/site/analyze");
    const { generateEmail } = await import("@/lib/email/build");
    const { hasBlockingErrors } = await import("@/lib/email/checks");
    const lead = createLead({ business_name: "Kin Electrical", website: site.url, keyword: "electrician", city: "Cape Town" });
    await researchLead(lead.id);
    // Fixture MX lookups fail, so mark the found email valid to exercise the send checks.
    const l = getLead(lead.id)!;
    updateLead(lead.id, { contacts: l.contacts.map((c) => (c.kind === "email" ? { ...c, valid: true, validationNote: "MX ok (test)" } : c)) });

    const { email, source } = await generateEmail(lead.id);
    expect(source).toBe("template");
    expect(email.to_email).toBe("thabo@kinelectrical-fixture.co.za");
    const failing = email.checks.filter((c) => !c.ok);
    expect(failing).toEqual([]);
    expect(hasBlockingErrors(email.checks)).toBe(false);

    const $ = cheerio.load(email.html);
    expect($("a[href]").length).toBeLessThanOrEqual(3);
    expect($("img").length).toBe(1);
    expect($("img").attr("alt")).toMatch(/Example Kin Electrical website chat/);
    expect($("img").attr("src")).toMatch(/^https:\/\/outreach\.fise\.test\/i\/.+\.png$/);
    expect(email.html).toMatch(/v:roundrect/); // Outlook bulletproof button
    expect(email.html).not.toMatch(/<script|<form|<iframe|@font-face/i);
    expect(Buffer.byteLength(email.html)).toBeLessThan(100_000);
    expect(email.text).toMatch(/Unsubscribe: https:\/\/outreach\.fise\.test\/u\//);
    expect(email.text).toMatch(/Kin Electrical/);
    expect(email.subject.length).toBeLessThan(50);
    // brand colour used for the band/button
    expect(email.html.toLowerCase()).toContain(getLead(lead.id)!.colors!.primary.toLowerCase());
    // graphic saved and small
    const img = path.join(process.env.DATA_DIR!, "images", email.image_file!);
    expect(fs.statSync(img).size).toBeLessThan(150_000);
    fs.writeFileSync(path.join(process.env.DATA_DIR!, "sample.html"), email.html);
  }, 60_000);

  it("flags rule breaks: off-domain links, spam words, long subjects", async () => {
    const { runChecks } = await import("@/lib/email/checks");
    const copy = {
      subject: "ACT NOW!!! Guaranteed 100% more leads for your business today",
      preheader: "x", greeting: "Hi", opening: "", benefits: [], comparison: "", ctaText: "Click here", closing: "",
      chatMockup: [], whatsappMessage: "", contactFormMessage: "", socialMessage: "", smsMessage: "",
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
