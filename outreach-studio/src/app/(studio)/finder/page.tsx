import { db, parseJson } from "@/lib/db";
import { integrationStatus } from "@/lib/config";
import { FinderForm } from "./FinderForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import Link from "next/link";

export default function FinderPage() {
  const searches = db().prepare("SELECT * FROM searches ORDER BY created_at DESC LIMIT 20").all() as {
    id: string; keywords: string; cities: string; radius_km: number; status: string; est_cost: number; actual_cost: number;
    found: number; added: number; error: string | null; created_at: string;
  }[];
  const running = searches.some((s) => s.status === "queued" || s.status === "running");
  const status = integrationStatus();
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="h1">Lead Finder</h1>
        <p className="muted">Searches Google Places (official API) for businesses, then researches and qualifies each website automatically.</p>
      </div>
      {!status.places && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          GOOGLE_PLACES_API_KEY is not set. You can still add prospects by hand on the Outreach page.
        </div>
      )}
      <FinderForm />
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h2">Recent searches</h2>
          {running && <AutoRefresh seconds={4} />}
        </div>
        {searches.length === 0 ? (
          <p className="muted">No searches yet.</p>
        ) : (
          <table className="data">
            <thead><tr><th>When</th><th>Keywords</th><th>Cities</th><th>Status</th><th>Found / new</th><th>Cost</th></tr></thead>
            <tbody>
              {searches.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">{new Date(s.created_at).toLocaleString("en-ZA")}</td>
                  <td>{parseJson<string[]>(s.keywords, []).join(", ")}</td>
                  <td>{parseJson<string[]>(s.cities, []).join(", ")} ({s.radius_km} km)</td>
                  <td>{s.status}{s.error && <div className="text-xs text-red-600">{s.error}</div>}</td>
                  <td>
                    {s.found} / <Link className="text-brand underline" href={`/leads?search=${s.id}`}>{s.added}</Link>
                  </td>
                  <td>${(s.actual_cost || s.est_cost).toFixed(2)}{s.actual_cost ? "" : " est."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
