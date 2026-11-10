"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ScoreBadge, StatusBadge, ROUTE_LABEL } from "@/components/Badges";

export type Row = {
  id: string; name: string; domain: string | null; city: string | null; industry: string | null; score: number | null;
  reason: string | null; status: string; platform: string | null; route: string | null; hasChat: number | null;
  research: string; excluded: string | null;
};

export function LeadTable({ leads }: { leads: Row[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };

  async function bulk(action: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/leads/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ids: [...sel] }) });
    const json = await res.json();
    setBusy(false);
    setMsg(res.ok ? json.message : json.error);
    if (res.ok && json.redirect) router.push(json.redirect);
    else router.refresh();
  }

  return (
    <div className="card overflow-x-auto p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 p-3">
        <span className="muted">{sel.size} selected</span>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("research")}>Re-research</button>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("generate")}>Generate emails</button>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("email_batch")}>Create email batch</button>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("call_batch")}>Create call batch</button>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("sms_batch")}>Create SMS batch</button>
        <button className="btn-secondary" disabled={!sel.size || busy} onClick={() => bulk("tasks")}>Prepare manual tasks</button>
        {msg && <span className="text-sm text-gray-700">{msg}</span>}
      </div>
      <table className="data">
        <thead>
          <tr>
            <th><input type="checkbox" aria-label="Select all" checked={sel.size === leads.length && leads.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())} /></th>
            <th>Business</th><th>Fit</th><th>Why</th><th>Platform</th><th>Best route</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} className="hover:bg-gray-50">
              <td><input type="checkbox" aria-label={`Select ${l.name}`} checked={sel.has(l.id)} onChange={() => toggle(l.id)} /></td>
              <td className="min-w-48">
                <Link href={`/leads/${l.id}`} className="font-medium text-gray-900 hover:text-brand">{l.name}</Link>
                <div className="text-xs text-gray-500">{[l.domain, l.city, l.industry].filter(Boolean).join(" · ")}</div>
              </td>
              <td><ScoreBadge score={l.score} /></td>
              <td className="max-w-md text-xs text-gray-600">
                {l.research === "pending" || l.research === "running" ? <em>Researching…</em> : l.excluded ? <span className="text-red-700">Excluded: {l.excluded}</span> : l.reason}
              </td>
              <td className="text-xs">{l.platform ?? "—"}{l.hasChat ? <div className="text-amber-700">has chat</div> : null}</td>
              <td className="text-xs">{l.route ? ROUTE_LABEL[l.route] : "—"}</td>
              <td><StatusBadge status={l.status} /></td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr><td colSpan={7} className="py-10 text-center text-gray-500">No leads match. Run a search in Lead Finder or add a prospect.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
