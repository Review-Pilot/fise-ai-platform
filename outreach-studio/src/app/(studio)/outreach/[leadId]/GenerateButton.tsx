"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateButton({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/emails", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId }) });
        const json = await res.json();
        setBusy(false);
        if (!res.ok) return setErr(json.error);
        router.refresh();
      }}>{busy ? "Writing…" : "Generate email"}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
