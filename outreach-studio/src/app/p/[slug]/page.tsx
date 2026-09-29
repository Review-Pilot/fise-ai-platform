// Personalised landing page on your domain. No popups, no tracking scripts — views are counted server-side only.
import { notFound } from "next/navigation";
import { db, logEvent } from "@/lib/db";
import { rowToLead } from "@/lib/leads";
import { latestDraft } from "@/lib/email/build";
import { getSettings } from "@/lib/settings";
import { fallbackColors, ensureReadableOnWhite } from "@/lib/color";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Your website assistant demo", robots: { index: false, follow: false } };
}

export default async function Landing({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = db().prepare("SELECT * FROM leads WHERE landing_slug = ?").get(slug) as Record<string, unknown> | undefined;
  if (!row) notFound();
  const lead = rowToLead(row);
  if (lead.status === "Do not contact") notFound();
  const { profile } = getSettings();
  const colors = lead.colors ?? fallbackColors(profile.defaultColors);
  const draft = latestDraft(lead.id);
  const copy = draft?.copy;
  const heading = ensureReadableOnWhite(colors.primary);
  logEvent(lead.id, "web", "landing_view", slug);

  const messages = copy?.chatMockup ?? [
    { from: "visitor" as const, text: lead.research?.likelyCustomerQuestions?.[0] ?? "Are you open on Saturdays?" },
    { from: "bot" as const, text: `Thanks for asking. I can help with that and pass your details to the ${lead.business_name} team.` },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header style={{ background: colors.primary, color: colors.onPrimary }}>
        <div className="mx-auto max-w-5xl px-6 py-12">
          <p className="text-sm uppercase tracking-wide opacity-80">Prepared for {lead.business_name}</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-4xl">A website assistant that answers your customers, day and night</h1>
          <p className="mt-3 max-w-2xl opacity-90">{profile.description}</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10 md:grid-cols-2">
        <section className="space-y-5">
          {(copy?.benefits ?? []).map((b) => (
            <div key={b.title} className="rounded-lg bg-white p-4 shadow-sm" style={{ borderLeft: `4px solid ${colors.accent}` }}>
              <h2 className="font-semibold" style={{ color: heading }}>{b.title}</h2>
              <p className="mt-1 text-sm text-gray-700">{b.detail}</p>
              <p className="mt-1 text-sm italic text-gray-500">Customers ask: &ldquo;{b.exampleQuestion}&rdquo;</p>
            </div>
          ))}
          {lead.comparison && <p className="text-gray-700">{lead.comparison}</p>}
          <div className="flex flex-wrap gap-3">
            {lead.demo_chat_link && (
              <a href={lead.demo_chat_link} className="rounded-lg px-5 py-3 font-semibold" style={{ background: colors.primary, color: colors.onPrimary }}>
                Try your demo chatbot
              </a>
            )}
            <a href={profile.demoUrl} className="rounded-lg border px-5 py-3 font-semibold" style={{ borderColor: heading, color: heading }}>
              Book a 15-minute demo
            </a>
          </div>
        </section>

        <section aria-label="Example conversation" className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 px-4 py-3" style={{ background: colors.primary, color: colors.onPrimary }}>
            {lead.research?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={lead.research.logoUrl} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-1" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 font-bold">{lead.business_name[0]}</div>
            )}
            <div>
              <div className="font-semibold">{lead.business_name}</div>
              <div className="text-xs opacity-90">Online now · replies in seconds</div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.from === "visitor" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2 text-sm"
                  style={m.from === "visitor" ? { background: colors.primary, color: colors.onPrimary } : { background: "#f1f5f9", color: "#111827" }}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
          <div className="border-t px-4 py-3 text-center text-xs text-gray-500">Powered by {profile.productName}</div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-10 text-xs text-gray-500">
        {profile.company} · {profile.address} · {profile.phone}. This page was made for {lead.business_name} using details from your public website.
      </footer>
    </div>
  );
}
