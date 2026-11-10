import Link from "next/link";
import { dashboardStats } from "@/lib/stats";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { integrationStatus } from "@/lib/config";
import { LEAD_STATUSES } from "@/lib/types";

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const st = dashboardStats();
  const s = getSettings();
  const integrations = integrationStatus();
  const events = db().prepare("SELECT e.*, l.business_name FROM events e LEFT JOIN leads l ON l.id = e.lead_id WHERE e.type NOT IN ('status') ORDER BY e.id DESC LIMIT 15").all() as {
    id: number; lead_id: string | null; business_name: string | null; channel: string; type: string; detail: string | null; created_at: string;
  }[];
  const statusCount = Object.fromEntries(st.byStatus.map((b) => [b.status, b.c]));
  const maxBar = Math.max(1, ...st.last14.map((d) => d.c));
  const setup = [
    { done: integrations.claude, label: "Add ANTHROPIC_API_KEY", href: "/settings#integrations" },
    { done: integrations.places, label: "Add GOOGLE_PLACES_API_KEY", href: "/settings#integrations" },
    { done: s.profile.senderName !== "Your Name", label: "Fill in your sender details and address", href: "/settings#profile" },
    { done: integrations.resend, label: "Connect Resend (RESEND_API_KEY, FROM_EMAIL)", href: "/settings#integrations" },
    { done: Boolean(s.sending.dnsVerifiedAt), label: "Verify SPF, DKIM and DMARC", href: "/settings#dns" },
    { done: integrations.imap, label: "Connect your inbox for reply tracking", href: "/settings#integrations" },
  ];
  const todo = setup.filter((x) => !x.done);
  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h1">Dashboard</h1>
          <p className="muted">Fise Outreach Studio</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn-secondary" href="/finder">Find leads</Link>
          <Link className="btn-primary" href="/outreach/new">Add prospect</Link>
        </div>
      </div>

      {(st.pendingApprovals > 0 || st.openTasks > 0 || s.sending.paused) && (
        <div className="space-y-2">
          {s.sending.paused && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Sending is paused: {s.sending.pauseReason} <Link className="underline" href="/settings#sending">Review</Link></div>}
          {st.pendingApprovals > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">{st.pendingApprovals} batch(es) waiting for your approval. <Link className="underline" href="/outreach">Review</Link></div>}
          {st.openTasks > 0 && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm">{st.openTasks} manual task(s) to send. <Link className="underline" href="/outreach">Open</Link></div>}
        </div>
      )}

      {todo.length > 0 && (
        <div className="card">
          <h2 className="h2 mb-2">Setup</h2>
          <ul className="space-y-1 text-sm">
            {setup.map((x) => (
              <li key={x.label} className={x.done ? "text-green-700" : ""}>{x.done ? "✓" : "○"} {x.done ? x.label : <Link className="underline" href={x.href}>{x.label}</Link>}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Leads found" value={st.leads} />
        <Stat label="Qualified" value={st.qualified} sub={st.leads ? `${Math.round((st.qualified / st.leads) * 100)}% of found` : undefined} />
        <Stat label="Emails sent" value={st.emailsSent} sub={`${st.firstEmails} businesses`} />
        <Stat label="Reply rate" value={`${(st.replyRate * 100).toFixed(1)}%`} sub="Opens aren't tracked (no pixels)" />
        <Stat label="Calls made" value={st.callsMade} />
        <Stat label="Demos booked" value={st.demos} sub={`${st.won} won`} />
        <Stat label="Cost per qualified lead" value={`$${st.costPerQualified.toFixed(2)}`} sub={`Places spend $${st.placesCost.toFixed(2)}`} />
        <Stat label="Opt-outs" value={st.unsubscribes} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-3">Pipeline</h2>
          <ul className="space-y-2">
            {LEAD_STATUSES.map((status) => {
              const n = statusCount[status] ?? 0;
              return (
                <li key={status} className="flex items-center gap-3 text-sm">
                  <span className="w-28 shrink-0">{status}</span>
                  <div className="h-2 flex-1 rounded bg-gray-100">
                    <div className="h-2 rounded bg-brand" style={{ width: `${st.leads ? Math.max(n ? 2 : 0, (n / st.leads) * 100) : 0}%` }} />
                  </div>
                  <span className="w-10 text-right tabular-nums">{n}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <h2 className="h2 mb-3">Emails sent · last 14 days</h2>
          {st.last14.length === 0 ? <p className="muted">Nothing sent yet.</p> : (
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Emails sent per day">
              {st.last14.map((d) => (
                <div key={d.d} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-xs tabular-nums text-gray-600">{d.c}</span>
                  <div className="w-full rounded-t bg-brand" style={{ height: `${(d.c / maxBar) * 110}px` }} title={`${d.d}: ${d.c}`} />
                  <span className="text-[10px] text-gray-500">{d.d.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="h2 mb-3">Recent activity</h2>
        {events.length === 0 ? <p className="muted">No activity yet.</p> : (
          <table className="data">
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-xs text-gray-500">{e.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td className="text-xs">{e.channel}</td>
                  <td className="text-xs">{e.lead_id ? <Link className="hover:underline" href={`/leads/${e.lead_id}`}>{e.business_name}</Link> : "—"}</td>
                  <td className="text-xs">{e.type.replace(/_/g, " ")}</td>
                  <td className="max-w-md truncate text-xs text-gray-600">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
