// Google Places API (New) — official Text Search + Place Details. No Maps HTML scraping.
//
// Storage: Google's terms only allow place_id to be stored indefinitely. Everything else
// from Places goes into place_cache with an expiry (default 30 days) and is refreshed
// from Place Details when needed; expired rows are purged by the maintenance job.
import { config } from "./config";
import { db, now, recordUsage, newId, logEvent } from "./db";
import { getSettings } from "./settings";
import { createLead, domainOf, normaliseWebsite } from "./leads";
import { enqueue } from "./jobs";
import type { PlaceSummary } from "./types";

const API = "https://places.googleapis.com/v1";
const PLACE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "regularOpeningHours.weekdayDescriptions",
  "primaryTypeDisplayName",
  "businessStatus",
  "location",
];
const MAX_PAGES = 3; // Text Search returns at most 60 results (3 × 20).
const GEOCODE_PER_1000 = 5; // Text Search Essentials (ID + location only), used to centre the radius.

export interface SearchRequest {
  keywords: string[];
  cities: string[];
  radiusKm: number;
  maxPages: number;
}

export function monthSpend(): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const row = db()
    .prepare("SELECT COALESCE(SUM(cost),0) s FROM api_usage WHERE service LIKE 'places%' AND created_at >= ?")
    .get(start.toISOString()) as { s: number };
  return row.s;
}

export function estimateSearch(req: SearchRequest) {
  const { budget } = getSettings();
  const pages = Math.min(Math.max(1, req.maxPages), MAX_PAGES);
  const textRequests = req.keywords.length * req.cities.length * pages;
  const uncachedCities = req.cities.filter((c) => !cachedGeocode(c)).length;
  const cost =
    (textRequests * budget.textSearchPer1000) / 1000 + (uncachedCities * GEOCODE_PER_1000) / 1000;
  const spent = monthSpend();
  return {
    textRequests,
    geocodeRequests: uncachedCities,
    maxResults: textRequests * 20,
    estimatedUsd: Math.round(cost * 1000) / 1000,
    spentThisMonthUsd: Math.round(spent * 100) / 100,
    budgetUsd: budget.monthlyUsd,
    withinBudget: spent + cost <= budget.monthlyUsd,
  };
}

function cacheExpiry(): string {
  const days = getSettings().places.cacheDays;
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function cachedGeocode(city: string): { lat: number; lng: number } | null {
  const row = db()
    .prepare("SELECT data FROM place_cache WHERE place_id = ? AND expires_at > ?")
    .get(`geo:${city.toLowerCase().trim()}`, now()) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

async function placesPost(path: string, body: unknown, fieldMask: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": config.googlePlacesKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (json.error as { message?: string } | undefined)?.message ?? res.statusText;
    throw new Error(`Google Places ${res.status}: ${err}`);
  }
  return json;
}

async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  const cached = cachedGeocode(city);
  if (cached) return cached;
  const json = await placesPost(
    "/places:searchText",
    { textQuery: `${city}, South Africa`, pageSize: 1, regionCode: "ZA" },
    "places.id,places.location",
  );
  recordUsage("places_geocode", 1, GEOCODE_PER_1000 / 1000, city);
  const loc = (json.places as { location?: { latitude: number; longitude: number } }[] | undefined)?.[0]?.location;
  if (!loc) return null;
  const value = { lat: loc.latitude, lng: loc.longitude };
  // Lat/lng may be cached for up to 30 days.
  db()
    .prepare(
      "INSERT OR REPLACE INTO place_cache (place_id, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(`geo:${city.toLowerCase().trim()}`, JSON.stringify(value), now(), new Date(Date.now() + 30 * 86400_000).toISOString());
  return value;
}

type RawPlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  primaryTypeDisplayName?: { text: string };
  businessStatus?: string;
  location?: { latitude: number; longitude: number };
};

export function toSummary(p: RawPlace): PlaceSummary {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress,
    phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber,
    website: p.websiteUri,
    rating: p.rating,
    reviewCount: p.userRatingCount,
    category: p.primaryTypeDisplayName?.text,
    hours: p.regularOpeningHours?.weekdayDescriptions,
    businessStatus: p.businessStatus,
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
  };
}

function cachePlace(s: PlaceSummary) {
  db()
    .prepare("INSERT OR REPLACE INTO place_cache (place_id, data, fetched_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(s.placeId, JSON.stringify(s), now(), cacheExpiry());
}

export function getCachedPlace(placeId: string): PlaceSummary | null {
  const row = db()
    .prepare("SELECT data FROM place_cache WHERE place_id = ? AND expires_at > ?")
    .get(placeId, now()) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : null;
}

/** Place Details — used to refresh expired Places data for a lead. */
export async function refreshPlace(placeId: string): Promise<PlaceSummary | null> {
  if (!config.googlePlacesKey) return null;
  const res = await fetch(`${API}/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": config.googlePlacesKey, "X-Goog-FieldMask": PLACE_FIELDS.join(",") },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Place Details ${res.status}`);
  recordUsage("places_details", 1, getSettings().budget.placeDetailsPer1000 / 1000, placeId);
  const summary = toSummary((await res.json()) as RawPlace);
  cachePlace(summary);
  return summary;
}

export async function getPlace(placeId: string): Promise<PlaceSummary | null> {
  return getCachedPlace(placeId) ?? (await refreshPlace(placeId).catch(() => null));
}

export function createSearch(req: SearchRequest): { id: string; estimate: ReturnType<typeof estimateSearch> } {
  const estimate = estimateSearch(req);
  if (!estimate.withinBudget) {
    throw new Error(
      `This search (~$${estimate.estimatedUsd}) would exceed your monthly Places budget ($${estimate.spentThisMonthUsd} of $${estimate.budgetUsd} used).`,
    );
  }
  const id = newId("srch");
  db()
    .prepare(
      "INSERT INTO searches (id, keywords, cities, radius_km, max_pages, est_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, JSON.stringify(req.keywords), JSON.stringify(req.cities), req.radiusKm, req.maxPages, estimate.estimatedUsd, now());
  enqueue("search", { searchId: id });
  return { id, estimate };
}

/** Worker: runs a search across every keyword × city, de-duplicates and creates leads. */
export async function runSearch(searchId: string) {
  const d = db();
  const s = d.prepare("SELECT * FROM searches WHERE id = ?").get(searchId) as
    | { keywords: string; cities: string; radius_km: number; max_pages: number }
    | undefined;
  if (!s) return;
  if (!config.googlePlacesKey) {
    d.prepare("UPDATE searches SET status = 'failed', error = ? WHERE id = ?").run(
      "GOOGLE_PLACES_API_KEY is not set in .env",
      searchId,
    );
    return;
  }
  d.prepare("UPDATE searches SET status = 'running' WHERE id = ?").run(searchId);
  const keywords = JSON.parse(s.keywords) as string[];
  const cities = JSON.parse(s.cities) as string[];
  const { budget } = getSettings();
  const perRequest = budget.textSearchPer1000 / 1000;
  let found = 0;
  let added = 0;
  let cost = 0;
  const seenPlace = new Set<string>();
  const seenDomain = new Set<string>(
    (d.prepare("SELECT domain FROM leads WHERE domain IS NOT NULL").all() as { domain: string }[]).map((r) => r.domain),
  );

  try {
    for (const city of cities) {
      const centre = await geocodeCity(city);
      for (const keyword of keywords) {
        let pageToken: string | undefined;
        for (let page = 0; page < Math.min(s.max_pages, MAX_PAGES); page++) {
          if (monthSpend() + perRequest > budget.monthlyUsd) throw new Error("Monthly Places budget reached — search stopped.");
          const body: Record<string, unknown> = {
            textQuery: `${keyword} in ${city}`,
            pageSize: 20,
            regionCode: "ZA",
            languageCode: "en",
          };
          if (centre) {
            body.locationBias = {
              circle: {
                center: { latitude: centre.lat, longitude: centre.lng },
                radius: Math.min(50000, Math.max(1000, s.radius_km * 1000)),
              },
            };
          }
          if (pageToken) body.pageToken = pageToken;
          const json = await placesPost(
            "/places:searchText",
            body,
            [...PLACE_FIELDS.map((f) => `places.${f}`), "nextPageToken"].join(","),
          );
          recordUsage("places_text", 1, perRequest, `${keyword} / ${city} p${page + 1}`);
          cost += perRequest;
          const places = (json.places as RawPlace[] | undefined) ?? [];
          for (const raw of places) {
            found++;
            const p = toSummary(raw);
            if (seenPlace.has(p.placeId)) continue;
            seenPlace.add(p.placeId);
            if (d.prepare("SELECT 1 FROM leads WHERE place_id = ?").get(p.placeId)) continue;
            if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
            const website = normaliseWebsite(p.website);
            const domain = domainOf(website);
            if (domain && seenDomain.has(domain)) {
              // Same website as an existing lead → probably a second branch. Count it as a location.
              d.prepare("UPDATE leads SET locations = locations + 1 WHERE domain = ?").run(domain);
              continue;
            }
            if (domain) seenDomain.add(domain);
            cachePlace(p);
            const lead = createLead({
              business_name: p.name,
              website,
              source: "places",
              place_id: p.placeId,
              search_id: searchId,
              city,
              keyword,
            });
            added++;
            enqueue("research", { leadId: lead.id });
          }
          pageToken = json.nextPageToken as string | undefined;
          if (!pageToken) break;
        }
      }
    }
    d.prepare("UPDATE searches SET status = 'done', found = ?, added = ?, actual_cost = ? WHERE id = ?").run(
      found,
      added,
      cost,
      searchId,
    );
  } catch (e) {
    d.prepare("UPDATE searches SET status = 'failed', error = ?, found = ?, added = ?, actual_cost = ? WHERE id = ?").run(
      e instanceof Error ? e.message : String(e),
      found,
      added,
      cost,
      searchId,
    );
    logEvent(null, "system", "search_failed", String(e));
  }
}

/** Purge expired Places content. place_id stays on the lead so it can be refreshed later. */
export function purgeExpiredPlaces(): number {
  return db().prepare("DELETE FROM place_cache WHERE expires_at <= ?").run(now()).changes;
}
