import { getSettings } from "@/lib/settings";
import { integrationStatus, config } from "@/lib/config";
import { listDnc } from "@/lib/dnc";
import { monthSpend } from "@/lib/places";
import { SectionForm, ActionPanel, DnsCheck, DncManager } from "./SectionForm";

function Section({ id, title, children, intro }: { id: string; title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 space-y-4">
      <div>
        <h2 className="h2">{title}</h2>
        {intro && <div className="muted mt-1">{intro}</div>}
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const s = getSettings();
  const i = integrationStatus();
  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="h1">Settings</h1>

      <Section id="integrations" title="Integrations" intro="API keys live in .env only. Restart the app and worker after changing them.">
        <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          {Object.entries({ "Claude API": i.claude, "Google Places": i.places, "Resend (email)": i.resend, "Inbox (IMAP)": i.imap, Vapi: i.vapi, "Twilio SMS": i.twilio, "Fise demo bots": i.fiseQuickstart, "App password": i.auth }).map(([k, v]) => (
            <li key={k} className={v ? "text-green-700" : "text-gray-500"}>{v ? "✓" : "○"} {k}</li>
          ))}
        </ul>
        <p className="text-xs text-gray-500">Public URL: {config.publicBaseUrl} — images, unsubscribe links and landing pages are served from here. Sending domain: {config.sendingDomain || "not set"}.</p>
        {!i.auth && <p className="text-sm text-amber-700">APP_PASSWORD is not set, so the app has no login. Set it before putting the app on the internet.</p>}
      </Section>

      <Section id="profile" title="Fise & sender details" intro="Used in every email, call script and landing page.">
        <SectionForm section="profile" values={s.profile as unknown as Record<string, unknown>} fields={[
          { key: "productName", label: "Product name", type: "text" },
          { key: "company", label: "Company", type: "text" },
          { key: "description", label: "What Fise does (1–2 sentences)", type: "textarea" },
          { key: "benefits", label: "Key benefits (one per line)", type: "list" },
          { key: "offer", label: "Offer", type: "text", help: "e.g. a free demo built on your own website content" },
          { key: "websiteUrl", label: "Your website", type: "text" },
          { key: "demoUrl", label: "Demo booking link", type: "text", help: "Must be on one of your own domains to be used in emails" },
          { key: "senderName", label: "Sender name", type: "text" },
          { key: "senderTitle", label: "Sender title", type: "text" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "address", label: "Physical business address", type: "textarea", help: "Required in every email footer (POPIA / CAN-SPAM)" },
          { key: "defaultColors", label: "Neutral fallback colours", type: "colors" },
        ]} />
      </Section>

      <Section id="qualification" title="Qualification" intro="Only good-fit small and medium businesses are kept. Re-score applies new thresholds without re-crawling.">
        <SectionForm section="qualification" values={s.qualification as unknown as Record<string, unknown>} extra={<ActionPanel action="rescore" label="Re-score all leads" />} fields={[
          { key: "minReviews", label: "Minimum Google reviews", type: "range", min: 0, max: 100 },
          { key: "maxReviews", label: "Maximum Google reviews", type: "range", min: 50, max: 2000, step: 10 },
          { key: "maxLocations", label: "Max listings sharing one website", type: "range", min: 1, max: 10 },
          { key: "maxTeamSize", label: "Max team size", type: "range", min: 5, max: 250, step: 5 },
          { key: "minFitScore", label: "Minimum fit score", type: "range", min: 0, max: 100, step: 5 },
          { key: "excludeCantInstall", label: "Exclude sites where the chatbot can't be installed", type: "checkbox" },
          { key: "excludeExistingAiChatbot", label: "Exclude sites that already have an AI chatbot", type: "checkbox" },
        ]} />
      </Section>

      <Section id="budget" title="Google Places budget" intro={`Spent this month: $${monthSpend().toFixed(2)}. Prices are editable estimates — check Google's current price list.`}>
        <SectionForm section="budget" values={s.budget as unknown as Record<string, unknown>} fields={[
          { key: "monthlyUsd", label: "Monthly budget cap (USD)", type: "number", min: 0 },
          { key: "textSearchPer1000", label: "Text Search price per 1,000 requests (USD)", type: "number", step: 0.5 },
          { key: "placeDetailsPer1000", label: "Place Details price per 1,000 requests (USD)", type: "number", step: 0.5 },
        ]} />
        <SectionForm section="places" values={s.places as unknown as Record<string, unknown>} fields={[
          { key: "cacheDays", label: "Keep Places data for (days)", type: "number", min: 1, max: 30, help: "Only place_id is kept permanently; other Places fields expire and are refreshed on demand." },
        ]} />
      </Section>

      <Section id="consent" title="Consent (POPIA)" intro="POPIA section 69 lets you approach a non-customer once, electronically, to ask for consent to direct marketing. With this on, the first email asks permission, and follow-ups, AI calls and SMS only go to prospects who said yes.">
        <SectionForm section="consent" values={s.consent as unknown as Record<string, unknown>} fields={[
          { key: "consentFirstMode", label: "Consent-first mode (recommended)", type: "checkbox", help: "Turn off only on legal advice." },
        ]} />
      </Section>

      <Section id="sending" title="Sending limits & warm-up" intro={s.sending.paused ? <strong className="text-red-700">Paused: {s.sending.pauseReason}</strong> : "Starts slowly and grows each week. Stops automatically on complaints or high bounce rates."}>
        <SectionForm section="sending" values={s.sending as unknown as Record<string, unknown>} fields={[
          { key: "paused", label: "Pause all sending", type: "checkbox" },
          { key: "warmupStartPerDay", label: "Warm-up start (emails/day)", type: "number", min: 1 },
          { key: "warmupIncreasePerWeek", label: "Increase per week", type: "number", min: 0 },
          { key: "maxPerDay", label: "Maximum per day", type: "number", min: 1 },
          { key: "perDomainPerDay", label: "Max per recipient domain per day", type: "number", min: 1 },
          { key: "minDelaySeconds", label: "Min delay between emails (s)", type: "number", min: 10 },
          { key: "maxDelaySeconds", label: "Max delay between emails (s)", type: "number", min: 10 },
          { key: "bounceRateLimit", label: "Auto-pause bounce rate (0.03 = 3%)", type: "number", step: 0.005 },
        ]} />
      </Section>

      <Section id="dns" title="Sending domain (SPF, DKIM, DMARC)" intro={<>Send from a subdomain such as <code>mail.yourdomain.co.za</code>, never your main domain. Add it in Resend, publish the DNS records it shows, then run this check.</>}>
        <DnsCheck verifiedAt={s.sending.dnsVerifiedAt} />
      </Section>

      <Section id="sequence" title="Follow-up sequence" intro="Stops automatically on reply, booking, unsubscribe or do-not-contact. Every follow-up waits for your approval.">
        <SectionForm section="sequence" values={s.sequence as unknown as Record<string, unknown>} fields={[
          { key: "followup1Days", label: "First follow-up after (days)", type: "number", min: 1 },
          { key: "followup2Days", label: "Final email after (days)", type: "number", min: 2 },
        ]} />
      </Section>

      <Section id="calls" title="AI calls (Vapi)" intro="Test mode calls only your own number. It can be switched off after one successful test call.">
        <SectionForm section="calls" values={s.calls as unknown as Record<string, unknown>} fields={[
          { key: "testMode", label: "Test mode", type: "checkbox", help: s.calls.testPassedAt ? `Test passed ${s.calls.testPassedAt.slice(0, 10)}` : "No successful test call yet" },
          { key: "testNumber", label: "Your own phone number", type: "text" },
          { key: "dailyCap", label: "Maximum calls per day", type: "number", min: 1 },
          { key: "recordCalls", label: "Store call recordings", type: "checkbox", help: "Only if you tell people the call may be recorded and it's permitted for your use." },
        ]} />
      </Section>

      <Section id="demo" title="Free demo button & chatbot photo" intro="The email button says “Get your free demo”. It opens a page on your domain where pressing “Build my free demo” makes a real Fise chatbot from their website, takes a real photo of it, and emails it to them with sign-up steps. Each build uses Fise credits, so it's on automatically only for warm leads; switch it on or off per lead in the editor.">
        <SectionForm section="demo" values={s.demo as unknown as Record<string, unknown>} extra={<ActionPanel action="capture_showcase" label="Take the example photo now" />} fields={[
          { key: "autoForWarm", label: "Turn the free demo on automatically for warm leads", type: "checkbox", help: "Warm = replied, booked, or consented. Cold leads get a plain “See how Fise works” button." },
          { key: "maxPerDay", label: "Maximum demo chatbots built per day", type: "number", min: 1, help: "Extra requests wait until the next morning." },
          { key: "signupUrl", label: "Where “Create your account” points", type: "text" },
          { key: "showcaseLink", label: "Example chatbot link for the email photo", type: "text", help: "A Fise chat link (…/chat/fise_…) of a chatbot you're proud of, for example your Kin Electrical one. Leads without their own demo see a real photo of it. Leave empty for no photo." },
          { key: "showcaseQuestion", label: "Question to ask the example chatbot", type: "text" },
        ]} />
        {s.demo.showcaseImage && (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">Current example photo (real chatbot):</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/i/${s.demo.showcaseImage}`} alt={s.demo.showcaseAlt} className="max-h-72 rounded border" />
          </div>
        )}
        {!i.fiseQuickstart && <p className="text-sm text-amber-700">FISE_QUICKSTART_TOKEN is not set in .env, so demo chatbots can't be built yet.</p>}
      </Section>

      <Section id="landing" title="Landing pages">
        <SectionForm section="landingPages" values={s.landingPages as unknown as Record<string, unknown>} fields={[
          { key: "enabled", label: "Link emails to a personalised landing page on your domain", type: "checkbox", help: "Otherwise the button goes to your demo booking link." },
        ]} />
      </Section>

      <Section id="dnc" title="Do-not-contact list" intro="One list for email, calls, SMS and WhatsApp. Checked before every send or call.">
        <DncManager items={listDnc()} />
      </Section>
    </div>
  );
}
