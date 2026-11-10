"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES } from "@/lib/types";

async function api(id: string, method: "PATCH" | "POST", body: unknown) {
  const res = await fetch(`/api/leads/${id}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Request failed");
  return json;
}

export function ActionButton({ id, action, label, confirm: confirmText, variant = "secondary" }: {
  id: string; action: string; label: string; confirm?: string; variant?: "secondary" | "danger" | "primary";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        className={`btn-${variant}`}
        disabled={busy}
        onClick={async () => {
          if (confirmText && !window.confirm(confirmText)) return;
          setBusy(true);
          try {
            const r = await api(id, "POST", { action });
            setMsg(r.message);
            if (r.redirect) router.push(r.redirect);
            else router.refresh();
          } catch (e) {
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </span>
  );
}

export function StatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  return (
    <select
      className="input w-44"
      aria-label="Lead status"
      defaultValue={status}
      onChange={async (e) => {
        if (e.target.value === "Do not contact" && !window.confirm("Add this lead's email, phone and domain to the do-not-contact list?")) {
          e.target.value = status;
          return;
        }
        await api(id, "PATCH", { status: e.target.value });
        router.refresh();
      }}
    >
      {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}

export function ConsentSelect({ id, value }: { id: string; value: string }) {
  const router = useRouter();
  return (
    <select
      className="input"
      aria-label="Consent status"
      defaultValue={value}
      onChange={async (e) => {
        await api(id, "PATCH", { consent_status: e.target.value });
        router.refresh();
      }}
    >
      <option value="none">None yet</option>
      <option value="requested">Asked (first message sent)</option>
      <option value="granted">Granted — they said yes to more info</option>
      <option value="refused">Refused — do not contact</option>
    </select>
  );
}

export function NotesBox({ id, notes, firstName }: { id: string; notes: string; firstName: string }) {
  const [value, setValue] = useState(notes);
  const [name, setName] = useState(firstName);
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-2">
      <label className="label" htmlFor="fname">Contact first name</label>
      <input id="fname" className="input" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
      <label className="label" htmlFor="notes">Notes (used when writing the email)</label>
      <textarea id="notes" className="input h-24" value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
        placeholder='e.g. "gets lots of after-hours enquiries"' />
      <button className="btn-secondary" onClick={async () => { await api(id, "PATCH", { notes: value, contact_first_name: name }); setSaved(true); }}>
        {saved ? "Saved" : "Save"}
      </button>
    </div>
  );
}

export function ColorEditor({ id, colors }: { id: string; colors: { primary: string; secondary: string; accent: string } }) {
  const router = useRouter();
  const [c, setC] = useState(colors);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4">
        {(["primary", "secondary", "accent"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-sm capitalize">
            <input type="color" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-gray-300" />
            {k} <code className="text-xs text-gray-500">{c[k]}</code>
          </label>
        ))}
      </div>
      <button className="btn-secondary" onClick={async () => {
        try {
          await api(id, "PATCH", { colors: c });
          setMsg("Saved (adjusted for AA contrast if needed)");
          router.refresh();
        } catch (e) { setMsg((e as Error).message); }
      }}>Save colours</button>
      {msg && <span className="ml-2 text-xs text-gray-600">{msg}</span>}
    </div>
  );
}

export function ChatTestApproval({ id, approved }: { id: string; approved: boolean }) {
  const router = useRouter();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1" defaultChecked={approved} onChange={async (e) => { await api(id, "PATCH", { chat_test_approved: e.target.checked }); router.refresh(); }} />
      <span>I approve sending <strong>one</strong> harmless test question (&ldquo;Hi, what are your opening hours?&rdquo;) to this business&rsquo;s chat widget.</span>
    </label>
  );
}
