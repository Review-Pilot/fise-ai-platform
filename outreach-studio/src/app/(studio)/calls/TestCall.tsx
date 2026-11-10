"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function TestCall({ leads, testNumber }: { leads: { id: string; name: string }[]; testNumber: string }) {
  const router = useRouter();
  const [leadId, setLeadId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="tl">Use the script for (optional)</label>
        <select id="tl" className="input" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
          <option value="">Generic script</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <button className="btn-primary" disabled={busy || !testNumber} onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/calls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", leadId }) });
        const json = await res.json();
        setBusy(false);
        setMsg(res.ok ? json.message : json.error);
        router.refresh();
      }}>Call my phone ({testNumber || "not set"})</button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}
