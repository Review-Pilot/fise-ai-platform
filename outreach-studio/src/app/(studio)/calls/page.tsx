import Link from "next/link";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { integrationStatus } from "@/lib/config";
import { callsToday } from "@/lib/calls";
import { isBusinessHours, holidayName, sastString } from "@/lib/hours";
import { TestCall } from "./TestCall";

export default function CallsPage() {
  const s = getSettings();
  const vapi = integrationStatus().vapi;
  const calls = db().prepare(
    `SELECT c.*, l.business_name FROM calls c LEFT JOIN leads l ON l.id = c.lead_id ORDER BY c.created_at DESC LIMIT 100`,
  ).all() as { id: string; lead_id: string | null; business_name: string | null; phone: string; is_test: number; status: string; outcome: string | null;
    summary: string | null; transcript: string | null; recording_url: string | null; error: string | null; created_at: string; first_message: string | null }[];
  const leads = db().prepare("SELECT id, business_name name FROM leads WHERE qualified = 1 AND status != 'Do not contact' ORDER BY fit_score DESC LIMIT 50").all() as { id: string; name: string }[];
  const holiday = holidayName();
  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="h1">Calls</h1>
        <p className="muted">AI phone calls via Vapi. Every call opens with “this is an automated assistant calling on behalf of {s.profile.company}”, and “no / stop / remove me” ends the call and adds the number to the do-not-contact list.</p>
      </div>
      {!vapi && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Set VAPI_API_KEY, VAPI_PHONE_NUMBER_ID and VAPI_ASSISTANT_ID in .env (see README) to enable calling.</div>}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="card space-y-2">
          <h2 className="h2">Mode</h2>
          <p className={`text-lg font-semibold ${s.calls.testMode ? "text-amber-700" : "text-green-700"}`}>{s.calls.testMode ? "Test mode (own number only)" : "Live (approved batches only)"}</p>
          <p className="text-xs text-gray-600">Test call passed: {s.calls.testPassedAt ? s.calls.testPassedAt.slice(0, 16).replace("T", " ") : "not yet"}. Change in <Link href="/settings#calls" className="underline">Settings</Link>.</p>
        </div>
        <div className="card space-y-2">
          <h2 className="h2">Calling window</h2>
          <p className="text-sm">Now: {sastString()} SAST — {isBusinessHours(new Date(), 15) ? <span className="text-green-700">inside hours</span> : <span className="text-amber-700">outside hours{holiday ? ` (${holiday})` : ""}</span>}</p>
          <p className="text-xs text-gray-600">Mon–Fri 08:00–17:00 SAST, no public holidays. Today: {callsToday()} / {s.calls.dailyCap} calls.</p>
        </div>
        <div className="card space-y-2">
          <h2 className="h2">Test call</h2>
          <TestCall leads={leads} testNumber={s.calls.testNumber} />
        </div>
      </div>
      <p className="text-sm text-gray-600">
        To call prospects: switch test mode off after a successful test, then on <Link className="underline" href="/leads">Leads</Link> select leads and choose “Create call batch”. You review every script before approving.
        {s.consent.consentFirstMode && " Consent-first mode is on, so only leads who have agreed to hear more can be called."}
      </p>
      <div className="card">
        <h2 className="h2 mb-3">Call log</h2>
        {calls.length === 0 ? <p className="muted">No calls yet.</p> : (
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>Status</th><th>Outcome</th><th>Details</th></tr></thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap text-xs">{c.created_at.slice(0, 16).replace("T", " ")}</td>
                  <td>{c.is_test ? <span className="badge bg-amber-100 text-amber-800">test</span> : null} {c.lead_id ? <Link className="hover:underline" href={`/leads/${c.lead_id}`}>{c.business_name}</Link> : "—"}<div className="text-xs text-gray-500">{c.phone}</div></td>
                  <td className="text-xs">{c.status}{c.error && <div className="text-red-600">{c.error}</div>}</td>
                  <td className="text-xs">{c.outcome ?? "—"}</td>
                  <td className="max-w-md text-xs">
                    {c.summary && <p>{c.summary}</p>}
                    {c.transcript && <details><summary className="cursor-pointer text-brand">Transcript</summary><pre className="mt-1 whitespace-pre-wrap">{c.transcript}</pre></details>}
                    {c.recording_url && <a className="text-brand underline" href={c.recording_url} target="_blank" rel="noreferrer">Recording</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
