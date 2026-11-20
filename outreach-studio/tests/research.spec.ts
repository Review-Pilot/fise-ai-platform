import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFixtureSite } from "./fixtures/site";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-test-"));
process.env.ALLOW_PRIVATE_FETCH = "1";
delete process.env.ANTHROPIC_API_KEY; // heuristic path, no network to Claude

let site: Awaited<ReturnType<typeof startFixtureSite>>;
beforeAll(async () => {
  site = await startFixtureSite();
});
afterAll(() => site.close());

describe("researchLead (end to end against a fixture site)", () => {
  it("crawls politely, extracts contacts/colours/platform and scores the lead", async () => {
    const { createLead, getLead } = await import("@/lib/leads");
    const { researchLead } = await import("@/lib/site/analyze");
    const lead = createLead({ business_name: "Kin Electrical", website: site.url, source: "manual", keyword: "electrician" });
    await researchLead(lead.id);
    const l = getLead(lead.id)!;

    expect(l.research_status).toBe("done");
    expect(l.platform).toBe("WordPress");
    expect(l.can_install).toBe("yes");
    expect(l.has_chatbot).toBe(0);
    // robots.txt respected and crawler identifies itself
    expect(site.hits.some((h) => h.startsWith("/private"))).toBe(false);
    expect(site.hits.every((h) => h.includes("FiseOutreachBot"))).toBe(true);
    // contacts with sources
    const email = l.contacts.find((c) => c.kind === "email" && c.value.startsWith("thabo@"))!;
    expect(email.sourceUrl).toMatch(/\/contact\/$/);
    expect(l.contacts.some((c) => c.kind === "whatsapp" && c.value === "+27821234567")).toBe(true);
    expect(l.contacts.some((c) => c.kind === "contact_form")).toBe(true);
    // heuristic owner detection → named email ranks first (MX fails for the fixture domain, so it is marked invalid)
    expect(l.research!.ownerName).toBe("Thabo Mokoena");
    expect(email.personName).toBe("Thabo Mokoena");
    expect(email.valid).toBe(false);
    // brand colours: red primary from theme-color/CSS vars/logo, AA contrast
    expect(l.colors!.source).toBe("site");
    expect(l.colors!.primary).toMatch(/^#c8|^#c7|^#b/);
    expect(l.research!.logoUrl).toMatch(/logo\.png$/);
    expect(l.fit_score).toBeGreaterThan(50);
    expect(l.fit_reason).toMatch(/No chat widget/);
  }, 60_000);

  it("falls back to neutral colours when the site fails to load", async () => {
    const { createLead, getLead } = await import("@/lib/leads");
    const { researchLead } = await import("@/lib/site/analyze");
    const lead = createLead({ business_name: "Dead Site", website: "http://127.0.0.1:1/", source: "manual" });
    await researchLead(lead.id);
    const l = getLead(lead.id)!;
    expect(l.research_status).toBe("failed");
    expect(l.colors!.source).toBe("default");
    expect(l.qualified).toBe(1); // manual prospects are kept
  }, 30_000);
});
