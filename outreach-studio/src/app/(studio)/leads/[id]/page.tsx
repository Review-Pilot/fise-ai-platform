import Link from "next/link";
import { notFound } from "next/navigation";
import { getLead } from "@/lib/leads";
import { db } from "@/lib/db";
import { getCachedPlace } from "@/lib/places";
import { getSequence } from "@/lib/sequences";
import { ScoreBadge, StatusBadge, ROUTE_LABEL } from "@/components/Badges";
import { AutoRefresh } from "@/components/AutoRefresh";
import { hasQueuedJob } from "@/lib/jobs";
import { ActionButton, StatusSelect, ConsentSelect, NotesBox, ColorEditor, ChatTestApproval } from "./LeadControls";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) notFound();
  const r = lead.research;
  const place = lead.place_id ? getCachedPlace(lead.place_id) : null;
  const events = db().prepare("SELECT * FROM events WHERE lead_id = ? ORDER BY id DESC LIMIT 50").all(id) as {
    id: number; channel: string; type: string; detail: string | null; created_at: string;
  }[];
  const emails = db().prepare("SELECT id, kind, subject, status, sent_at, created_at FROM emails WHERE lead_id = ? ORDER BY created_at DESC").all(id) as {
    id: string; kind: string; subject: string; status: string; sent_at: string | null; created_at: string;
  }[];
  const calls = db().prepare("SELECT id, phone, status, outcome, summary, created_at FROM calls WHERE lead_id = ? ORDER BY created_at DESC").all(id) as {
    id: string; phone: string; status: string; outcome: string | null; summary: string | null; created_at: string;
  }[];
  const seq = getSequence(id);
  const busy = lead.research_status === "pending" || lead.research_status === "running" || hasQueuedJob("chat_test", "leadId", id);
  const ct = lead.chat_test;

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/leads" className="muted hover:underline">← Leads</Link>
          <h1 className="h1 mt-1 flex items-center gap-3">
            {r?.faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.faviconUrl} alt="" width={24} height={24} className="rounded" />
            )}
            {lead.business_name} <ScoreBadge score={lead.fit_score} /> <StatusBadge status={lead.status} />
          </h1>
          <p className="muted">
            {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer" className="underline">{lead.domain}</a> : "No website"}
            {" · "}{[lead.industry ?? lead.keyword, lead.city].filter(Boolean).join(" · ")}
            {" · "}source: {lead.source}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {busy && <AutoRefresh seconds={4} />}
          <StatusSelect id={id} status={lead.status} />
          <Link className="btn-primary" href={`/outreach/${id}`}>Write outreach</Link>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="h2">Fit</h2>
            <p className="text-sm">{lead.fit_reason ?? "Not scored yet"}</p>
            {lead.qualified === 0 && lead.disqualify_reason && <p className="text-sm text-red-700">Excluded: {lead.disqualify_reason}</p>}
            {lead.research_error && <p className="text-sm text-amber-700">Research: {lead.research_error}</p>}
          </div>
          <ActionButton id={id} action="research" label="Re-run research" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="h2">Contact details <span className="muted font-normal">· best route: {lead.best_route ? ROUTE_LABEL[lead.best_route] : "—"}</span></h2>
          {lead.contacts.length === 0 ? <p className="muted">None found on the public pages checked.</p> : (
            <table className="data">
              <thead><tr><th>Type</th><th>Detail</th><th>Source</th></tr></thead>
              <tbody>
                {lead.contacts.map((c, i) => (
                  <tr key={i}>
                    <td className="text-xs">{c.kind}{c.emailType ? ` (${c.emailType})` : ""}</td>
                    <td className="break-all">
                      {c.value}
                      {c.personName && <div className="text-xs text-gray-500">{c.personName}{c.personRole ? `, ${c.personRole}` : ""}</div>}
                      {c.kind === "email" && (
                        <div className={`text-xs ${c.valid === false ? "text-red-600" : "text-green-700"}`}>{c.validationNote ?? "not validated"}</div>
                      )}
                    </td>
                    <td className="text-xs text-gray-500">
                      {c.sourceUrl.startsWith("http") ? <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">{new URL(c.sourceUrl).pathname || "/"}</a> : c.sourceUrl}
                      <div>{c.foundAt.slice(0, 10)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-500">Only publicly listed details are collected. Emails are checked for syntax and MX records — never guessed.</p>
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Website</h2>
          {r ? (
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <dt className="text-gray-500">Platform</dt><dd className="col-span-2">{r.platform}</dd>
              <dt className="text-gray-500">Can install</dt>
              <dd className="col-span-2">
                <span className={r.canInstall === "no" ? "text-red-700" : r.canInstall === "likely" ? "text-amber-700" : "text-green-700"}>{r.canInstall}</span>
                {" — "}{r.canInstallReason}
              </dd>
              <dt className="text-gray-500">Chat / support</dt>
              <dd className="col-span-2">{r.chatTools.length ? r.chatTools.map((t) => `${t.name} (${t.category.replace("_", " ")})`).join(", ") : "None detected"}</dd>
              <dt className="text-gray-500">Pages checked</dt>
              <dd className="col-span-2 text-xs">{r.pages.map((p) => `${new URL(p.url).pathname} (${p.status})`).join(", ")}</dd>
              {r.blockedByRobots.length > 0 && (<><dt className="text-gray-500">Skipped (robots.txt)</dt><dd className="col-span-2 text-xs">{r.blockedByRobots.map((u) => new URL(u).pathname).join(", ")}</dd></>)}
              {r.logoUrl && (<><dt className="text-gray-500">Logo</dt><dd className="col-span-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.logoUrl} alt="Logo" className="max-h-10 max-w-40" />
              </dd></>)}
            </dl>
          ) : <p className="muted">Not researched yet.</p>}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Business profile</h2>
          {r ? (
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <dt className="text-gray-500">Industry</dt><dd className="col-span-2">{r.industry ?? "—"}</dd>
              <dt className="text-gray-500">Services</dt><dd className="col-span-2">{r.services.join(", ") || "—"}</dd>
              <dt className="text-gray-500">Location</dt><dd className="col-span-2">{r.location ?? "—"}</dd>
              <dt className="text-gray-500">Tone</dt><dd className="col-span-2">{r.tone ?? "—"}</dd>
              <dt className="text-gray-500">Owner</dt>
              <dd className="col-span-2">{r.ownerName ? `${r.ownerName}${r.ownerRole ? `, ${r.ownerRole}` : ""}` : "—"}
                {r.ownerEvidence && <div className="text-xs text-gray-500">&ldquo;{r.ownerEvidence}&rdquo;</div>}</dd>
              <dt className="text-gray-500">Size signals</dt>
              <dd className="col-span-2 text-xs">
                {lead.locations > 1 && <div>{lead.locations} Google listings share this website</div>}
                {r.teamSizeEstimate ? <div>Team ~{r.teamSizeEstimate}</div> : null}
                {r.ownerRunLikely && <div>Looks owner-run</div>}
                {[...r.corporateSignals, ...r.chainSignals].map((s) => <div key={s}>{s}</div>)}
              </dd>
              <dt className="text-gray-500">Customer questions</dt>
              <dd className="col-span-2 text-xs">{r.likelyCustomerQuestions.map((q) => <div key={q}>“{q}”</div>)}</dd>
            </dl>
          ) : <p className="muted">—</p>}
          {place && (
            <div className="border-t border-gray-100 pt-3 text-xs text-gray-600">
              Google: {place.rating ?? "—"}★ from {place.reviewCount ?? 0} reviews · {place.phone ?? "no phone"}
              {place.hours?.length ? <div>{place.hours.join(" · ")}</div> : null}
              <div className="mt-1 text-gray-400">Cached Places data expires automatically (Google terms); place ID is kept.</div>
            </div>
          )}
          {lead.place_id && !place && <ActionButton id={id} action="refresh_place" label="Refresh Google data" />}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Brand colours</h2>
          {lead.colors && (
            <>
              <div className="flex gap-3">
                {(["primary", "secondary", "accent"] as const).map((k) => (
                  <div key={k} className="flex-1 rounded-lg p-3 text-sm font-medium" style={{
                    background: lead.colors![k],
                    color: lead.colors![`on${k[0].toUpperCase()}${k.slice(1)}` as "onPrimary"],
                  }}>
                    {k}<div className="text-xs opacity-80">{lead.colors![k]}</div>
                  </div>
                ))}
              </div>
              <ul className="text-xs text-gray-500">{lead.colors.notes?.map((n) => <li key={n}>{n}</li>)}</ul>
              <ColorEditor id={id} colors={lead.colors} />
            </>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Existing chat test</h2>
          <ChatTestApproval id={id} approved={Boolean(lead.chat_test_approved)} />
          <ActionButton id={id} action="chat_test" label="Run chat test now" />
          {ct && (
            <div className="space-y-2 text-sm">
              <div className="text-xs text-gray-500">Ran {ct.localTime} SAST{ct.afterHours ? " (after hours)" : ""}{ct.tool ? ` · ${ct.tool}` : ""}</div>
              {ct.error && <div className="text-red-700">{ct.error}</div>}
              <ul className="list-disc pl-5">{ct.observations.map((o) => <li key={o}>{o}</li>)}</ul>
              <div className="text-xs text-gray-600">
                Bot: {fmt(ct.looksLikeBot)} · Captures leads: {fmt(ct.capturesLeads)} · Books: {fmt(ct.booksAppointments)}
                {ct.qualityNote && <div>{ct.qualityNote}</div>}
              </div>
              {ct.screenshotFile && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/screens/${ct.screenshotFile}`} alt="Screenshot of the chat test" className="rounded border" />
              )}
            </div>
          )}
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Why Fise is better for them</h2>
          <p className="text-sm">{lead.comparison ?? "—"}</p>
          <p className="text-xs text-gray-500">Written only from what was observed on their site{ct ? " and in the chat test" : ""}.</p>
          <ActionButton id={id} action="comparison" label="Rewrite" />
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Consent &amp; notes</h2>
          <ConsentSelect id={id} value={lead.consent_status} />
          <NotesBox id={id} notes={lead.notes ?? ""} firstName={lead.contact_first_name ?? ""} />
        </div>

        <div className="card space-y-3">
          <h2 className="h2">Free demo chatbot</h2>
          <p className="text-sm">Status: <strong>{lead.demo_status === "none" ? "not built" : lead.demo_status}</strong>{lead.demo_error ? ` — ${lead.demo_error}` : ""}</p>
          {lead.demo_chat_link && <a className="text-brand underline" href={lead.demo_chat_link} target="_blank" rel="noreferrer">{lead.demo_chat_link}</a>}
          {lead.demo_photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/i/${lead.demo_photo}`} alt={lead.demo_photo_alt ?? "Chatbot photo"} className="max-h-80 rounded border" />
          )}
          <p className="text-xs text-gray-500">Built when the prospect presses “Build my free demo”, or here by you. {lead.demo_emailed_at ? `Emailed to them ${lead.demo_emailed_at.slice(0, 16).replace("T", " ")}.` : ""}</p>
          {lead.demo_status !== "building" && lead.demo_status !== "ready" && <ActionButton id={id} action="build_demo" label="Build demo + take a real photo" />}
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="h2">Channel history</h2>
        {seq && <p className="text-sm">Sequence: {seq.status}{seq.status === "active" ? `, next step ${seq.step + 1} due ${seq.next_at?.slice(0, 10)}` : seq.stop_reason ? ` (${seq.stop_reason})` : ""}</p>}
        {emails.map((e) => (
          <div key={e.id} className="text-sm"><Link className="underline" href={`/outreach/${id}?email=${e.id}`}>Email ({e.kind})</Link>: “{e.subject}” — {e.status} {e.sent_at ? `on ${e.sent_at.slice(0, 16).replace("T", " ")}` : ""}</div>
        ))}
        {calls.map((c) => (
          <div key={c.id} className="text-sm">Call to {c.phone}: {c.status}{c.outcome ? ` — ${c.outcome}` : ""} {c.summary && <span className="text-gray-500">({c.summary})</span>}</div>
        ))}
        <table className="data">
          <tbody>
            {events.map((e) => (
              <tr key={e.id}><td className="whitespace-nowrap text-xs text-gray-500">{e.created_at.slice(0, 16).replace("T", " ")}</td><td className="text-xs">{e.channel}</td><td className="text-xs">{e.type}</td><td className="text-xs text-gray-600">{e.detail}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card space-y-3 border-red-200">
        <h2 className="h2">Do not contact &amp; data removal</h2>
        <p className="text-sm text-gray-600">Right to erasure (POPIA / GDPR): delete everything stored about this business. You can keep their contact details on the do-not-contact list so they are never contacted again.</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton id={id} action="dnc" label="Mark do not contact" variant="danger" confirm="Add this lead's email, phones and domain to the do-not-contact list?" />
          <ActionButton id={id} action="erase_and_block" label="Delete data + keep on DNC list" variant="danger" confirm="Permanently delete this lead's data and block their contact details?" />
          <ActionButton id={id} action="erase" label="Delete all data" variant="danger" confirm="Permanently delete everything about this lead? This cannot be undone." />
        </div>
      </div>
    </div>
  );
}

function fmt(v: boolean | null | undefined) {
  return v === true ? "yes" : v === false ? "no" : "unknown";
}
