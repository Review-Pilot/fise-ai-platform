"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmailRow } from "@/lib/email/build";
import type { BrandColors, EmailCopy } from "@/lib/types";

type LeadInfo = {
  id: string;
  name: string;
  colors: BrandColors | null;
  contacts: { value: string; valid: boolean; type: string }[];
  whatsapp: string | null;
  contactForm: string | null;
  socials: { kind: string; value: string }[];
};

function Field({ label, value, onChange, rows = 0, hint }: { label: string; value: string; onChange: (v: string) => void; rows?: number; hint?: string }) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label} {hint && <span className="font-normal text-gray-400">{hint}</span>}
      </label>
      {rows ? (
        <textarea id={id} className="input" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export function Editor({ initial, lead, publicBase, consentFirst }: { initial: EmailRow; lead: LeadInfo; publicBase: string; consentFirst: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState(initial);
  const [copy, setCopy] = useState<EmailCopy & { followupBody?: string }>(initial.copy);
  const [to, setTo] = useState(initial.to_email ?? "");
  const [colors, setColors] = useState({
    primary: lead.colors?.primary ?? "#1769e0",
    secondary: lead.colors?.secondary ?? "#0f2a4a",
    accent: lead.colors?.accent ?? "#12b886",
  });
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [tab, setTab] = useState<"email" | "channels">("email");
  const [busy, setBusy] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const editable = email.status === "draft";

  const set = <K extends keyof EmailCopy>(k: K, v: EmailCopy[K]) => {
    setCopy({ ...copy, [k]: v });
    setDirty(true);
  };

  async function call(label: string, url: string, method: string, body: unknown) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (json.email) {
        setEmail(json.email);
        setCopy(json.email.copy);
        setTo(json.email.to_email ?? "");
        setDirty(false);
      }
      if (json.issues) setIssues(json.issues);
      return json;
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const save = (extra: Record<string, unknown> = {}) =>
    call("save", `/api/emails/${email.id}`, "PATCH", { copy: { ...copy, to_email: to }, ...extra });

  const previewHtml = useMemo(() => email.html?.replaceAll(`${publicBase}/i/`, "/i/") ?? "", [email.html, publicBase]);
  const errors = email.checks.filter((c) => !c.ok && c.severity === "error");
  const warnings = email.checks.filter((c) => !c.ok && c.severity === "warning");
  const wordCount = [copy.opening, ...copy.benefits.flatMap((b) => [b.title, b.detail, b.exampleQuestion]), copy.comparison, copy.closing]
    .join(" ")
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;

  const waLink = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(copy.whatsappMessage ?? "")}` : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* ---------- Left: form ---------- */}
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(["email", "channels"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-3 py-1.5 ${tab === t ? "bg-white font-medium shadow-sm" : "text-gray-600"}`}>
              {t === "email" ? "Email" : "Other channels"}
            </button>
          ))}
        </div>

        {tab === "email" ? (
          <div className="card space-y-4">
            {!editable && <p className="rounded bg-gray-100 p-2 text-sm">This email is <strong>{email.status}</strong> and can no longer be edited.</p>}
            <div>
              <label className="label" htmlFor="to">To</label>
              <select id="to" className="input" value={to} disabled={!editable} onChange={(e) => { setTo(e.target.value); setDirty(true); }}>
                <option value="">— choose recipient —</option>
                {lead.contacts.map((c) => (
                  <option key={c.value} value={c.value} disabled={!c.valid}>
                    {c.value} {c.type ? `(${c.type})` : ""} {!c.valid ? "— invalid" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Field label="Subject" hint={`${copy.subject.length}/49`} value={copy.subject} onChange={(v) => set("subject", v)} />
            <Field label="Preheader" value={copy.preheader} onChange={(v) => set("preheader", v)} />
            <Field label="Greeting" value={copy.greeting} onChange={(v) => set("greeting", v)} />
            {copy.followupBody !== undefined ? (
              <Field label="Follow-up body" rows={8} value={copy.followupBody} onChange={(v) => { setCopy({ ...copy, followupBody: v }); setDirty(true); }} />
            ) : (
              <>
                <Field label="Opening" rows={3} value={copy.opening} onChange={(v) => set("opening", v)} />
                {copy.benefits.map((b, i) => (
                  <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
                      Benefit {i + 1}
                      {copy.benefits.length > 2 && (
                        <button className="text-red-600" onClick={() => set("benefits", copy.benefits.filter((_, j) => j !== i))}>Remove</button>
                      )}
                    </div>
                    <Field label={`Title ${i + 1}`} value={b.title} onChange={(v) => set("benefits", copy.benefits.map((x, j) => (j === i ? { ...x, title: v } : x)))} />
                    <Field label={`Detail ${i + 1}`} rows={2} value={b.detail} onChange={(v) => set("benefits", copy.benefits.map((x, j) => (j === i ? { ...x, detail: v } : x)))} />
                    <Field label={`Example question ${i + 1}`} value={b.exampleQuestion} onChange={(v) => set("benefits", copy.benefits.map((x, j) => (j === i ? { ...x, exampleQuestion: v } : x)))} />
                  </div>
                ))}
                <Field label="Why Fise (comparison)" rows={3} value={copy.comparison} onChange={(v) => set("comparison", v)} />
                <Field label="Closing" rows={3} hint={consentFirst ? "consent-first: ask permission" : ""} value={copy.closing} onChange={(v) => set("closing", v)} />
              </>
            )}
            <Field label="Button text" value={copy.ctaText} onChange={(v) => set("ctaText", v)} />
            {email.kind === "initial" && (
              <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                <div className="text-xs font-semibold uppercase text-gray-500">Chat graphic messages</div>
                {copy.chatMockup.map((m, i) => (
                  <div key={i} className="flex gap-2">
                    <select className="input w-28" value={m.from} onChange={(e) => set("chatMockup", copy.chatMockup.map((x, j) => (j === i ? { ...x, from: e.target.value as "visitor" | "bot" } : x)))}>
                      <option value="visitor">Customer</option>
                      <option value="bot">Chatbot</option>
                    </select>
                    <input className="input" aria-label={`Chat message ${i + 1}`} value={m.text} onChange={(e) => set("chatMockup", copy.chatMockup.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-500">Body: {wordCount} words (target 120–200)</div>
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold uppercase text-gray-500">Brand colours</div>
              <div className="flex flex-wrap gap-4">
                {(["primary", "secondary", "accent"] as const).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm capitalize">
                    <input type="color" value={colors[k]} onChange={(e) => setColors({ ...colors, [k]: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-gray-300" disabled={!editable} />
                    {k}
                  </label>
                ))}
              </div>
              <button className="btn-secondary" disabled={!editable || !!busy} onClick={() => save({ colors })}>Apply colours</button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!editable || !!busy || !dirty} onClick={() => save({ regenerateImage: true })}>
                {busy === "save" ? "Updating…" : "Update preview"}
              </button>
              <button className="btn-secondary" disabled={!editable || !!busy} onClick={() => { if (!dirty || confirm("Discard your edits and rewrite the email?")) call("regen", `/api/emails/${email.id}`, "POST", { action: "regenerate" }); }}>
                {busy === "regen" ? "Rewriting…" : "Regenerate"}
              </button>
            </div>
            {issues.length > 0 && (
              <ul className="list-disc rounded-lg bg-amber-50 p-3 pl-6 text-sm text-amber-900">
                {issues.map((i) => <li key={i}>{i}</li>)}
              </ul>
            )}
            {msg && <p className="text-sm text-red-600">{msg}</p>}
          </div>
        ) : (
          <div className="card space-y-5 text-sm">
            <p className="muted">Prepared for you to send by hand — nothing here is sent automatically.</p>
            <div className="space-y-2">
              <h3 className="font-semibold">WhatsApp</h3>
              <textarea className="input" rows={4} value={copy.whatsappMessage} onChange={(e) => set("whatsappMessage", e.target.value)} aria-label="WhatsApp message" />
              <div className="flex gap-2">
                <CopyButton text={copy.whatsappMessage} label="Copy" />
                {waLink ? <a className="btn-secondary" href={waLink} target="_blank" rel="noreferrer">Open click-to-chat</a> : <span className="muted">No WhatsApp number found</span>}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Contact form</h3>
              <textarea className="input" rows={6} value={copy.contactFormMessage} onChange={(e) => set("contactFormMessage", e.target.value)} aria-label="Contact form message" />
              <div className="flex gap-2">
                <CopyButton text={copy.contactFormMessage} label="Copy" />
                {lead.contactForm && <a className="btn-secondary" href={lead.contactForm} target="_blank" rel="noreferrer">Open their form</a>}
              </div>
              <p className="text-xs text-gray-500">Paste it yourself. Forms are never auto-submitted and CAPTCHAs are never bypassed.</p>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">LinkedIn / Facebook / Instagram</h3>
              <textarea className="input" rows={3} value={copy.socialMessage} onChange={(e) => set("socialMessage", e.target.value)} aria-label="Social message" />
              <div className="flex flex-wrap gap-2">
                <CopyButton text={copy.socialMessage} label="Copy" />
                {lead.socials.map((s) => <a key={s.value} className="btn-secondary" href={s.value} target="_blank" rel="noreferrer">{s.kind}</a>)}
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">SMS</h3>
              <textarea className="input" rows={3} value={copy.smsMessage} onChange={(e) => set("smsMessage", e.target.value)} aria-label="SMS message" />
              <CopyButton text={copy.smsMessage} label="Copy" />
            </div>
            <button className="btn-primary" disabled={!editable || !dirty || !!busy} onClick={() => save()}>Save messages</button>
          </div>
        )}
      </div>

      {/* ---------- Right: preview ---------- */}
      <div className="space-y-4">
        <div className="card space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              <div className="font-medium">{email.subject}</div>
              <div className="text-xs text-gray-500">{email.preheader}</div>
            </div>
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
              {(["desktop", "mobile"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 ${view === v ? "bg-white font-medium shadow-sm" : "text-gray-600"}`}>
                  {v === "desktop" ? "Desktop" : "Mobile"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-center overflow-x-auto rounded-lg bg-gray-100 p-3">
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              // No scripts are allowed; same-origin only lets us measure the height to avoid clipping.
              sandbox="allow-popups allow-same-origin"
              onLoad={(e) => {
                const f = e.currentTarget;
                const h = f.contentDocument?.documentElement.scrollHeight;
                if (h) f.style.height = `${h + 20}px`;
              }}
              key={view}
              className="rounded border border-gray-300 bg-white"
              style={{ width: view === "desktop" ? 680 : 375, height: 1400, maxWidth: "100%" }}
            />
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Pre-send checks</h2>
          <p className={`text-sm font-medium ${errors.length ? "text-red-700" : "text-green-700"}`}>
            {errors.length ? `${errors.length} problem(s) must be fixed before sending` : "Ready to send"}
            {warnings.length ? ` · ${warnings.length} warning(s)` : ""}
          </p>
          <ul className="space-y-1 text-sm">
            {email.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span aria-hidden="true" className={c.ok ? "text-green-600" : c.severity === "error" ? "text-red-600" : "text-amber-600"}>{c.ok ? "✓" : c.severity === "error" ? "✗" : "!"}</span>
                <span>
                  {c.label}
                  {c.detail && <span className="text-xs text-gray-500"> — {c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card flex flex-wrap gap-2">
          <CopyButton text={email.html} label="Copy HTML" />
          <CopyButton text={email.text} label="Copy plain text" />
          <a className="btn-secondary" href={`/api/emails/${email.id}/download`}>Download .html</a>
          <button
            className="btn-primary"
            disabled={!editable || dirty || errors.length > 0 || !!busy}
            title={dirty ? "Update the preview first" : errors.length ? "Fix the failing checks first" : ""}
            onClick={async () => {
              const r = await call("batch", "/api/batches", "POST", { type: "email", emailIds: [email.id] });
              if (r?.batchId) router.push(`/outreach/batches/${r.batchId}`);
            }}
          >
            Add to send batch…
          </button>
        </div>
      </div>
    </div>
  );
}
