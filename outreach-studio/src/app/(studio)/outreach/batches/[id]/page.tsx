import { notFound } from "next/navigation";
import Link from "next/link";
import { db, parseJson } from "@/lib/db";
import { getBatch } from "@/lib/batches";
import { renderEmail } from "@/lib/email/build";
import { config } from "@/lib/config";
import { dailyLimit, sentToday } from "@/lib/sending";
import { getSettings } from "@/lib/settings";
import { BatchActions, RemoveItem } from "./BatchActions";
import type { EmailCheck } from "@/lib/types";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const batch = getBatch(id);
  if (!batch) notFound();
  const pending = batch.status === "pending_approval";
  if (pending) {
    // Show exactly what would go out now, not a stale copy.
    const stale = db().prepare("SELECT id FROM emails WHERE batch_id = ? AND status = 'draft'").all(id) as { id: string }[];
    for (const e of stale) await renderEmail(e.id);
  }
  const s = getSettings();
  const emails = db().prepare("SELECT e.*, l.business_name FROM emails e JOIN leads l ON l.id = e.lead_id WHERE e.batch_id = ? ORDER BY e.created_at").all(id) as {
    id: string; lead_id: string; kind: string; to_email: string; subject: string; preheader: string; html: string; text: string; status: string; checks: string; business_name: string; error: string | null; sent_at: string | null;
  }[];
  const calls = db().prepare("SELECT c.*, l.business_name FROM calls c LEFT JOIN leads l ON l.id = c.lead_id WHERE c.batch_id = ?").all(id) as {
    id: string; phone: string; brief: string; first_message: string; status: string; business_name: string | null; outcome: string | null; error: string | null;
  }[];
  const sms = db().prepare("SELECT s.*, l.business_name FROM sms s LEFT JOIN leads l ON l.id = s.lead_id WHERE s.batch_id = ?").all(id) as {
    id: string; phone: string; body: string; status: string; business_name: string | null; error: string | null;
  }[];
  const count = emails.length + calls.length + sms.length;
  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/outreach" className="muted hover:underline">← Outreach</Link>
        <h1 className="h1">{batch.type === "email" ? "Email" : batch.type === "call" ? "Call" : "SMS"} batch {batch.note ? `· ${batch.note}` : ""}</h1>
        <p className="muted">Status: {batch.status.replace("_", " ")} · {count} item(s) · created {batch.created_at.slice(0, 16).replace("T", " ")}</p>
        {batch.type === "email" && pending && (
          <p className="text-sm text-gray-600">
            Today: {sentToday()} of {dailyLimit()} sent (warm-up limit). Emails are spaced {s.sending.minDelaySeconds}–{s.sending.maxDelaySeconds}s apart, max {s.sending.perDomainPerDay} per domain per day, Mon–Fri 08:00–17:00 SAST. Anything over today&rsquo;s limit rolls to the next day.
            {s.sending.paused && <strong className="text-red-700"> Sending is paused: {s.sending.pauseReason}</strong>}
            {!s.sending.dnsVerifiedAt && <strong className="text-red-700"> SPF/DKIM/DMARC not verified yet — run the DNS check in Settings first.</strong>}
          </p>
        )}
        {batch.type === "call" && pending && (
          <p className="text-sm text-gray-600">Calls go out Mon–Fri 08:00–17:00 SAST (never on public holidays), max {s.calls.dailyCap} per day. Each call opens by saying it is an automated assistant.</p>
        )}
      </div>

      <BatchActions id={id} count={count} type={batch.type} pending={pending} />

      {emails.map((e) => {
        const checks = parseJson<EmailCheck[]>(e.checks, []);
        const errors = checks.filter((c) => !c.ok && c.severity === "error");
        return (
          <div key={e.id} className="card space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="text-sm">
                <div><span className="text-gray-500">To:</span> {e.to_email} <span className="text-gray-500">({e.business_name}, {e.kind})</span></div>
                <div><span className="text-gray-500">Subject:</span> <strong>{e.subject}</strong></div>
                <div className="text-xs text-gray-500">Preheader: {e.preheader}</div>
                <div className="text-xs">Status: {e.status}{e.sent_at ? ` ${e.sent_at.slice(0, 16)}` : ""}{e.error ? ` — ${e.error}` : ""}</div>
                <div className={`text-xs ${errors.length ? "text-red-700" : "text-green-700"}`}>{errors.length ? `✗ ${errors.map((c) => c.label).join(", ")}` : "✓ All checks pass"}</div>
              </div>
              <div className="flex gap-3">
                <Link className="text-xs text-brand hover:underline" href={`/outreach/${e.lead_id}?email=${e.id}`}>Edit</Link>
                {pending && <RemoveItem batchId={id} itemId={e.id} />}
              </div>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-brand">Show exactly what will be sent</summary>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <iframe title={`Email to ${e.to_email}`} sandbox="" srcDoc={e.html.replaceAll(`${config.publicBaseUrl}/i/`, "/i/")} className="h-[900px] w-full rounded border" />
                <pre className="max-h-[900px] overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-xs">{e.text}</pre>
              </div>
            </details>
          </div>
        );
      })}

      {calls.map((c) => (
        <div key={c.id} className="card space-y-2 text-sm">
          <div className="flex justify-between">
            <div><strong>{c.business_name ?? "Test"}</strong> · {c.phone} · {c.status}{c.outcome ? ` → ${c.outcome}` : ""}{c.error ? ` — ${c.error}` : ""}</div>
            {pending && <RemoveItem batchId={id} itemId={c.id} />}
          </div>
          <div><span className="text-gray-500">Opening line:</span> &ldquo;{c.first_message}&rdquo;</div>
          <details><summary className="cursor-pointer text-brand">Call brief given to the assistant</summary><pre className="mt-2 whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">{c.brief}</pre></details>
        </div>
      ))}

      {sms.map((m) => (
        <div key={m.id} className="card flex justify-between gap-3 text-sm">
          <div><strong>{m.business_name}</strong> · {m.phone} · {m.status}{m.error ? ` — ${m.error}` : ""}<p className="mt-1 text-gray-700">{m.body}</p></div>
          {pending && <RemoveItem batchId={id} itemId={m.id} />}
        </div>
      ))}
    </div>
  );
}
