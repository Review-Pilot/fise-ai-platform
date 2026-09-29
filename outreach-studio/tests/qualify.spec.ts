import { describe, it, expect } from "vitest";
import { qualify } from "@/lib/qualify";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import type { SiteResearch } from "@/lib/types";

const base: SiteResearch = {
  finalUrl: "https://x.co.za", httpStatus: 200, fetchedAt: "", pages: [], blockedByRobots: [], parked: false,
  socialOnly: false, platform: "WordPress", platformEvidence: [], canInstall: "yes", canInstallReason: "",
  chatTools: [{ id: "contact_form", name: "Contact form", category: "contact_form", evidence: "" }],
  services: [], corporateSignals: [], chainSignals: [], likelyCustomerQuestions: [], wordCount: 500, ownerRunLikely: true,
};
const q = DEFAULT_SETTINGS.qualification;

describe("qualification", () => {
  it("scores an owner-run WordPress site with no chat highly and explains why", () => {
    const r = qualify({
      businessName: "Kin Electrical", research: base,
      place: { placeId: "p", name: "Kin", reviewCount: 64, rating: 4.8, hours: ["Saturday: Closed"] },
      contacts: [{ kind: "email", value: "thabo@kin.co.za", emailType: "named", valid: true, sourceUrl: "", foundAt: "" }],
      locations: 1, isManual: false,
    }, q);
    expect(r.qualified).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.reason).toMatch(/No chat widget/);
    expect(r.reason).toMatch(/WordPress = easy install/);
  });

  it("excludes chains, big brands, parked sites and too many reviews", () => {
    const place = { placeId: "p", name: "x", reviewCount: 50 };
    const contacts: never[] = [];
    expect(qualify({ businessName: "x", research: base, place, contacts, locations: 5, isManual: false }, q).qualified).toBe(false);
    expect(qualify({ businessName: "Spar Rondebosch", research: base, place, contacts, locations: 1, isManual: false }, q).disqualifyReason).toMatch(/brand/);
    expect(qualify({ businessName: "x", research: { ...base, parked: true, parkedReason: "for sale" }, place, contacts, locations: 1, isManual: false }, q).qualified).toBe(false);
    expect(qualify({ businessName: "x", research: base, place: { ...place, reviewCount: 2000 }, contacts, locations: 1, isManual: false }, q).disqualifyReason).toMatch(/above/);
  });

  it("excludes can't-install platforms by default but never auto-drops manual prospects", () => {
    const r = { ...base, canInstall: "no" as const, canInstallReason: "Google Sites" };
    expect(qualify({ businessName: "x", research: r, place: null, contacts: [], locations: 1, isManual: false }, q).qualified).toBe(false);
    expect(qualify({ businessName: "x", research: r, place: null, contacts: [], locations: 1, isManual: true }, q).qualified).toBe(true);
  });
});
