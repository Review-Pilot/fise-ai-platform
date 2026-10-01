import Link from "next/link";
import { db } from "@/lib/db";
import { listBatches } from "@/lib/batches";
import { listOpenTasks } from "@/lib/tasks";
import { getSettings } from "@/lib/settings";
import { dailyLimit, sentToday, bounceStats } from "@/lib/sending";
import { pendingJobs } from "@/lib/jobs";
import { TaskList } from "./TaskList";
import { AutoRefresh } from "@/components/AutoRefresh";

export default function OutreachPage() {
  const s = getSettings();
  const batches = listBatches();
  const drafts = db().prepare(
    `SELECT e.id, e.lead_id, e.kind, e.subject, e.to_email, e.checks, e.batch_id, e.updated_at, l.business_name
     FROM emails e JOIN leads l ON l.id = e.lead_id WHERE e.status = 'draft' ORDER BY e.updated_at DESC LIMIT 100`,
  ).all() as { id: string; lead_id: string; kind: string; subject: string; to_email: string | null; checks: string; batch_id: string | null; business_name: string }[];
  const sent = db().prepare(
    `SELECT e.id, e.lead_id, e.subject, e.to_email, e.status, e.sent_at, e.error, l.business_name FROM emails e JOIN leads l ON l.id = e.lead_id
     WHERE e.status IN ('sent','queued','failed','blocked') ORDER BY COALESCE(e.sent_at, e.updated_at) DESC LIMIT 50`,
  ).all() as { id: string; lead_id: string; subject: string; to_email: string; status: string; sent_at: string | null; error: string | null; business_name: string }[];
  const stats = bounceStats();
  const writing = pendingJobs("generate_email");
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Outreach</h1>
          <p className="muted">Drafts, approval batches, sending status and manual tasks.</p>
        </div>
        <div className="flex items-center gap-2">
          {writing > 0 && <AutoRefresh seconds={5} />}
          <Link className="btn-primary" href="/outreach/new">Add prospect</Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card"><div className="muted">Sent today</div><div className="text-2xl font-semibold">{sentToday()} / {dailyLimit()}</div><div className="text-xs text-gray-500">warm-up limit</div></div>
        <div className="card"><div className="muted">Bounce rate (30d)</div><div className="text-2xl font-semibold">{(stats.bounceRate * 100).toFixed(1)}%</div><div className="text-xs text-gray-500">auto-pause above {(s.sending.bounceRateLimit * 100).toFixed(0)}%</div></div>
        <div className="card"><div className="muted">Complaints (30d)</div><div className="text-2xl font-semibold">{stats.complaints}</div></div>
        <div className={`card ${s.sending.paused || !s.sending.dnsVerifiedAt ? "border-red-300 bg-red-50" : ""}`}>
          <div className="muted">Sending</div>
          <div className="text-lg font-semibold">{s.sending.paused ? "Paused" : s.sending.dnsVerifiedAt ? "Active" : "DNS not verified"}</div>
          <div className="text-xs text-gray-600">{s.sending.paused ? s.sending.pauseReason : !s.sending.dnsVerifiedAt ? <Link className="underline" href="/settings#dns">Run the DNS check</Link> : `Consent-first mode ${s.consent.consentFirstMode ? "on" : "off"}`}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Batches</h2>
        {batches.length === 0 ? <p className="muted">No batches yet. Add drafts from the editor or select leads and choose “Create email batch”.</p> : (
          <table className="data">
            <thead><tr><th>Created</th><th>Type</th><th>Items</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className={b.status === "pending_approval" ? "bg-amber-50" : ""}>
                  <td>{b.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{b.type}{b.note ? ` · ${b.note}` : ""}</td>
                  <td>{b.items}</td>
                  <td>{b.status === "pending_approval" ? <strong>awaiting your approval</strong> : b.status}</td>
                  <td><Link className="text-brand hover:underline" href={`/outreach/batches/${b.id}`}>{b.status === "pending_approval" ? "Review & approve" : "View"}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Drafts {writing > 0 && <span className="muted font-normal">· {writing} being written</span>}</h2>
        {drafts.length === 0 ? <p className="muted">No drafts.</p> : (
          <table className="data">
            <thead><tr><th>Business</th><th>Subject</th><th>To</th><th>Checks</th><th></th></tr></thead>
            <tbody>
              {drafts.map((d) => {
                const failing = (JSON.parse(d.checks || "[]") as { ok: boolean; severity: string }[]).filter((c) => !c.ok && c.severity === "error").length;
                return (
                  <tr key={d.id}>
                    <td>{d.business_name}<div className="text-xs text-gray-500">{d.kind}</div></td>
                    <td>{d.subject}</td>
                    <td className="text-xs">{d.to_email ?? <span className="text-red-600">none</span>}</td>
                    <td className={failing ? "text-red-700" : "text-green-700"}>{failing ? `${failing} to fix` : "ready"}{d.batch_id ? " · in batch" : ""}</td>
                    <td><Link className="text-brand hover:underline" href={`/outreach/${d.lead_id}?email=${d.id}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Manual tasks (WhatsApp, contact forms, social)</h2>
        <TaskList tasks={listOpenTasks()} />
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Sent &amp; queued</h2>
        {sent.length === 0 ? <p className="muted">Nothing sent yet.</p> : (
          <table className="data">
            <thead><tr><th>When</th><th>Business</th><th>Subject</th><th>Status</th></tr></thead>
            <tbody>
              {sent.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs">{e.sent_at?.slice(0, 16).replace("T", " ") ?? "—"}</td>
                  <td><Link className="hover:underline" href={`/leads/${e.lead_id}`}>{e.business_name}</Link><div className="text-xs text-gray-500">{e.to_email}</div></td>
                  <td>{e.subject}</td>
                  <td className="text-xs">{e.status}{e.error ? <div className="text-red-600">{e.error}</div> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
