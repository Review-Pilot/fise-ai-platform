"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewProspect() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch("/api/prospects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) {
      setBusy(false);
      return setError(json.error);
    }
    router.push(`/outreach/${json.leadId}`);
  }
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="h1">Add a prospect</h1>
        <p className="muted">We&rsquo;ll read their website (brand colours, logo, services, chat tools), then draft a tailored email.</p>
      </div>
      <form onSubmit={submit} className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label" htmlFor="bn">Business name *</label>
          <input id="bn" name="business_name" className="input" required />
        </div>
        <div>
          <label className="label" htmlFor="fn">Contact first name</label>
          <input id="fn" name="first_name" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="em">Email</label>
          <input id="em" name="email" type="email" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="ws">Website URL</label>
          <input id="ws" name="website" className="input" placeholder="example.co.za" />
        </div>
        <div>
          <label className="label" htmlFor="src">Where the email is published</label>
          <input id="src" name="email_source" className="input" placeholder="e.g. their website contact page" />
        </div>
        <div className="md:col-span-2">
          <label className="label" htmlFor="notes">Notes (optional)</label>
          <textarea id="notes" name="notes" className="input h-20" placeholder='e.g. "gets lots of after-hours enquiries"' />
        </div>
        {error && <p className="text-sm text-red-600 md:col-span-2">{error}</p>}
        <div className="md:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy ? "Researching their website and writing the email… (up to a minute)" : "Research & draft email"}</button>
        </div>
      </form>
    </div>
  );
}
