import { ok, route, splitList, bad } from "@/lib/api";
import { createSearch, estimateSearch } from "@/lib/places";
import { config } from "@/lib/config";

export const POST = route(async (req: Request) => {
  const body = await req.json();
  const request = {
    keywords: splitList(body.keywords).slice(0, 10),
    cities: splitList(body.cities).slice(0, 10),
    radiusKm: Math.min(50, Math.max(1, Number(body.radiusKm) || 20)),
    maxPages: Math.min(3, Math.max(1, Number(body.maxPages) || 3)),
  };
  if (!request.keywords.length || !request.cities.length) return bad("Enter at least one keyword and one city.");
  if (body.mode === "estimate") return ok({ estimate: estimateSearch(request), placesConfigured: Boolean(config.googlePlacesKey) });
  if (!config.googlePlacesKey) return bad("Add GOOGLE_PLACES_API_KEY to .env before running a search.");
  return ok(createSearch(request));
});
