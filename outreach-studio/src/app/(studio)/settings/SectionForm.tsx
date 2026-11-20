"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "range" | "checkbox" | "list" | "colors";
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  suffix?: string;
};

export function SectionForm({ section, fields, values, extra }: { section: string; fields: FieldDef[]; values: Record<string, unknown>; extra?: React.ReactNode }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, unknown>>(values);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: unknown) => setV({ ...v, [k]: val });

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const patch = Object.fromEntries(fields.map((f) => [f.key, v[f.key]]));
        const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ section, patch }) });
        const json = await res.json();
        setBusy(false);
        setMsg(res.ok ? "Saved" : json.error);
        if (res.ok) router.refresh();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {fields.map((f) => {
          const id = `${section}-${f.key}`;
          const val = v[f.key];
          return (
            <div key={f.key} className={f.type === "textarea" || f.type === "list" ? "md:col-span-2" : ""}>
              {f.type === "checkbox" ? (
                <label className="flex items-start gap-2 text-sm" htmlFor={id}>
                  <input id={id} type="checkbox" className="mt-1" checked={Boolean(val)} onChange={(e) => set(f.key, e.target.checked)} />
                  <span><span className="font-medium">{f.label}</span>{f.help && <span className="block text-xs text-gray-500">{f.help}</span>}</span>
                </label>
              ) : (
                <>
                  <label className="label" htmlFor={id}>
                    {f.label}
                    {f.type === "range" && <span className="ml-2 font-semibold text-brand">{String(val)}{f.suffix ?? ""}</span>}
                  </label>
                  {f.type === "textarea" && <textarea id={id} className="input" rows={3} value={String(val ?? "")} onChange={(e) => set(f.key, e.target.value)} />}
                  {f.type === "list" && <textarea id={id} className="input" rows={5} value={(val as string[]).join("\n")} onChange={(e) => set(f.key, e.target.value.split("\n"))} />}
                  {f.type === "text" && <input id={id} className="input" value={String(val ?? "")} onChange={(e) => set(f.key, e.target.value)} />}
                  {f.type === "number" && <input id={id} type="number" className="input" min={f.min} max={f.max} step={f.step ?? 1} value={String(val ?? "")} onChange={(e) => set(f.key, e.target.value)} />}
                  {f.type === "range" && <input id={id} type="range" className="w-full accent-brand" min={f.min} max={f.max} step={f.step ?? 1} value={Number(val)} onChange={(e) => set(f.key, Number(e.target.value))} />}
                  {f.type === "colors" && (
                    <div className="flex gap-4">
                      {Object.entries(val as Record<string, string>).map(([k, c]) => (
                        <label key={k} className="flex items-center gap-2 text-sm capitalize">
                          <input type="color" value={c} onChange={(e) => set(f.key, { ...(val as object), [k]: e.target.value })} className="h-8 w-10 rounded border" />
                          {k}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.help && <p className="mt-1 text-xs text-gray-500">{f.help}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy}>Save</button>
        {extra}
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </form>
  );
}

export function ActionPanel({ action, label, body }: { action: string; label: string; body?: Record<string, unknown> }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
        setBusy(true);
        const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...body }) });
        const json = await res.json();
        setBusy(false);
        setMsg(res.ok ? json.message : json.error);
        router.refresh();
      }}>{busy ? "Working…" : label}</button>
      {msg && <span className="text-sm text-gray-600">{msg}</span>}
    </span>
  );
}

type DnsItem = { id: string; label: string; ok: boolean; detail: string; fix?: string };

export function DnsCheck({ verifiedAt }: { verifiedAt: string | null }) {
  const [res, setRes] = useState<{ ok: boolean; domain: string; items: DnsItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm">Last verified: {verifiedAt ? verifiedAt.slice(0, 16).replace("T", " ") : <strong className="text-red-700">never — sending is blocked until this passes</strong>}</p>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dns" }) });
        setRes(await r.json());
        setBusy(false);
      }}>{busy ? "Checking…" : "Check SPF, DKIM & DMARC"}</button>
      {res && (
        <ul className="space-y-2 text-sm">
          {res.items.map((i) => (
            <li key={i.id}>
              <span className={i.ok ? "text-green-700" : "text-red-700"}>{i.ok ? "✓" : "✗"} {i.label}</span>
              <span className="text-xs text-gray-500"> — {i.detail}</span>
              {i.fix && <div className="text-xs text-gray-700">Fix: {i.fix}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DncManager({ items }: { items: { value: string; kind: string; reason: string | null; created_at: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setMsg(res.ok ? json.message : json.error);
    router.refresh();
  };
  return (
    <div className="space-y-3">
      <label className="label" htmlFor="dnc">Import opt-outs (emails, phone numbers or domains — one per line or CSV)</label>
      <textarea id="dnc" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex items-center gap-2">
        <button className="btn-secondary" onClick={() => post({ action: "dnc_import", text }).then(() => setText(""))}>Import</button>
        <label className="btn-secondary cursor-pointer">
          Upload CSV
          <input type="file" accept=".csv,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await post({ action: "dnc_import", text: await f.text() }); }} />
        </label>
        {msg && <span className="text-sm">{msg}</span>}
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="data">
          <thead><tr><th>Value</th><th>Type</th><th>Reason</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.value}>
                <td className="break-all">{d.value}</td><td className="text-xs">{d.kind}</td><td className="text-xs">{d.reason}</td>
                <td className="text-xs">{d.created_at.slice(0, 10)}</td>
                <td><button className="text-xs text-red-600 hover:underline" onClick={() => { if (confirm(`Remove ${d.value} from the do-not-contact list? Only do this if they asked to be contacted again.`)) post({ action: "dnc_remove", value: d.value }); }}>Remove</button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={5} className="muted">Empty</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
