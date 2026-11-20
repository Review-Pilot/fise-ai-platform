import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fos-places-"));
process.env.GOOGLE_PLACES_API_KEY = "test-key";

const place = (id: string, website?: string, reviews = 40) => ({
  id, displayName: { text: `Biz ${id}` }, websiteUri: website, userRatingCount: reviews, businessStatus: "OPERATIONAL",
  formattedAddress: "Cape Town", nationalPhoneNumber: "021 555 0000",
});
const calls: { url: string; body: Record<string, unknown>; mask: string }[] = [];

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const mask = (init.headers as Record<string, string>)["X-Goog-FieldMask"];
    calls.push({ url, body, mask });
    if (mask === "places.id,places.location") {
      return new Response(JSON.stringify({ places: [{ id: "geo", location: { latitude: -33.9, longitude: 18.4 } }] }));
    }
    const page = body.pageToken === "p2" ? 2 : 1;
    const places =
      page === 1
        ? [place("a", "https://a.co.za"), place("b", "https://www.b.co.za/?utm_source=gmb"), place("c", "https://b.co.za/branch2")]
        : [place("a", "https://a.co.za"), place("d")];
    return new Response(JSON.stringify({ places, ...(page === 1 ? { nextPageToken: "p2" } : {}) }));
  });
});

describe("Google Places lead finder", () => {
  it("estimates cost and enforces the monthly budget", async () => {
    const { estimateSearch, createSearch } = await import("@/lib/places");
    const { updateSettings } = await import("@/lib/settings");
    const est = estimateSearch({ keywords: ["plumber", "electrician"], cities: ["Cape Town", "Durban"], radiusKm: 20, maxPages: 3 });
    expect(est.textRequests).toBe(12);
    expect(est.estimatedUsd).toBeCloseTo(12 * 0.035 + 2 * 0.005, 3);
    updateSettings("budget", { monthlyUsd: 0.1 });
    expect(() => createSearch({ keywords: ["plumber", "electrician"], cities: ["Cape Town", "Durban"], radiusKm: 20, maxPages: 3 })).toThrow(/budget/);
    updateSettings("budget", { monthlyUsd: 50 });
  });

  it("paginates, de-duplicates by place_id and domain, and caches Places data with an expiry", async () => {
    const { createSearch, runSearch, getCachedPlace } = await import("@/lib/places");
    const { listLeads } = await import("@/lib/leads");
    const { db } = await import("@/lib/db");
    const { id } = createSearch({ keywords: ["plumber"], cities: ["Cape Town"], radiusKm: 15, maxPages: 3 });
    await runSearch(id);
    const leads = listLeads();
    expect(leads.map((l) => l.place_id).sort()).toEqual(["a", "b", "d"]); // c shares b's domain
    expect(leads.find((l) => l.place_id === "b")!.locations).toBe(2);
    expect(leads.find((l) => l.place_id === "b")!.website).toBe("https://www.b.co.za/");
    const textCalls = calls.filter((c) => c.url.endsWith("searchText") && c.mask !== "places.id,places.location");
    expect(textCalls).toHaveLength(2);
    expect(textCalls[0].body.locationBias).toMatchObject({ circle: { radius: 15000 } });
    const s = db().prepare("SELECT * FROM searches WHERE id = ?").get(id) as { status: string; added: number };
    expect(s.status).toBe("done");
    expect(getCachedPlace("a")!.reviewCount).toBe(40);
    const row = db().prepare("SELECT expires_at FROM place_cache WHERE place_id = 'a'").get() as { expires_at: string };
    const days = (new Date(row.expires_at).getTime() - Date.now()) / 86400_000;
    expect(Math.round(days)).toBe(30);
    // research jobs were queued for new leads
    const jobs = db().prepare("SELECT COUNT(*) c FROM jobs WHERE type = 'research'").get() as { c: number };
    expect(jobs.c).toBe(3);
  });
});
