"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function BatchActions({ id, count, type, pending }: { id: string; count: number; type: string; pending: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function act(action: string) {
    setBusy(true);
    const res = await fetch(`/api/batches/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, confirm: true }) });
    const json = await res.json();
    setBusy(false);
    setMsg(res.ok ? json.message : json.error);
    router.refresh();
  }
  if (!pending) return msg ? <p className="text-sm">{msg}</p> : null;
  const noun = type === "email" ? "emails" : type === "call" ? "AI phone calls" : "SMS messages";
  return (
    <div className="card space-y-3 border-brand/30">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>I have reviewed all {count} {noun} below exactly as they will go out, and I approve sending them. Every item is re-checked against the do-not-contact list, sending limits and business hours before it goes.</span>
      </label>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={!checked || busy || count === 0} onClick={() => act("approve")}>Approve & queue {count}</button>
        <button className="btn-danger" disabled={busy} onClick={() => act("cancel")}>Cancel batch</button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}

export function RemoveItem({ batchId, itemId }: { batchId: string; itemId: string }) {
  const router = useRouter();
  return (
    <button className="text-xs text-red-600 hover:underline" onClick={async () => {
      await fetch(`/api/batches/${batchId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", itemId }) });
      router.refresh();
    }}>Remove from batch</button>
  );
}
