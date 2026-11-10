"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Estimate = {
  textRequests: number; geocodeRequests: number; maxResults: number; estimatedUsd: number;
  spentThisMonthUsd: number; budgetUsd: number; withinBudget: boolean;
};

export function FinderForm() {
  const router = useRouter();
  const [form, setForm] = useState({ keywords: "electrician\nplumber", cities: "Cape Town\nDurban\nJohannesburg", radiusKm: 20, maxPages: 3 });
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(mode: "estimate" | "run") {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, mode }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    if (mode === "estimate") setEstimate(json.estimate);
    else {
      setEstimate(null);
      router.refresh();
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setEstimate(null);
  };

  return (
    <div className="card space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="kw">Keywords (one per line)</label>
          <textarea id="kw" className="input h-28" value={form.keywords} onChange={set("keywords")} />
        </div>
        <div>
          <label className="label" htmlFor="cities">Cities / areas (one per line)</label>
          <textarea id="cities" className="input h-28" value={form.cities} onChange={set("cities")} />
        </div>
        <div>
          <label className="label" htmlFor="radius">Radius: {form.radiusKm} km</label>
          <input id="radius" type="range" min={1} max={50} value={form.radiusKm} onChange={set("radiusKm")} className="w-full accent-brand" />
        </div>
        <div>
          <label className="label" htmlFor="pages">Depth</label>
          <select id="pages" className="input" value={form.maxPages} onChange={set("maxPages")}>
            <option value={1}>Up to 20 results per keyword/city</option>
            <option value={2}>Up to 40 results per keyword/city</option>
            <option value={3}>Up to 60 results per keyword/city (API maximum)</option>
          </select>
        </div>
      </div>

      {estimate && (
        <div className={`rounded-lg border p-4 text-sm ${estimate.withinBudget ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}>
          <div className="font-medium">Estimated cost: ${estimate.estimatedUsd.toFixed(2)} (up to {estimate.maxResults} results)</div>
          <div className="text-gray-600">
            {estimate.textRequests} Text Search requests{estimate.geocodeRequests ? ` + ${estimate.geocodeRequests} to locate cities` : ""}.
            This month: ${estimate.spentThisMonthUsd.toFixed(2)} of ${estimate.budgetUsd} budget used.
            Google may bill less if you are within its free monthly usage.
          </div>
          {!estimate.withinBudget && <div className="mt-1 font-medium text-red-700">This would go over your monthly budget. Reduce the search or raise the cap in Settings.</div>}
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={busy} onClick={() => call("estimate")}>Estimate cost</button>
        <button className="btn-primary" disabled={busy || !estimate || !estimate.withinBudget} onClick={() => call("run")}>
          Run search
        </button>
      </div>
    </div>
  );
}
