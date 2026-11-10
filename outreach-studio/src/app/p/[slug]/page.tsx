// Personalised landing page on your domain. No popups, no tracking scripts — views are counted server-side only.
// The free-demo button is a form POST (not a link) so email security scanners that pre-open links can't start a build.
import { notFound, redirect } from "next/navigation";
import { db, logEvent } from "@/lib/db";
import { rowToLead } from "@/lib/leads";
import { latestDraft, photoFor } from "@/lib/email/build";
import { getSettings } from "@/lib/settings";
import { fallbackColors, ensureReadableOnWhite } from "@/lib/color";
import { demoOfferOn } from "@/lib/demo/offer";
import { requestDemoFromLanding } from "@/lib/demo/flow";
import { bestEmail } from "@/lib/site/contacts";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return { title: "Your free Fise demo", robots: { index: false, follow: false } };
}

function leadBySlug(slug: string) {
  const row = db().prepare("SELECT * FROM leads WHERE landing_slug = ?").get(slug) as Record<string, unknown> | undefined;
  return row ? rowToLead(row) : null;
}

async function buildMyDemo(formData: FormData) {
  "use server";
  const slug = String(formData.get("slug") ?? "");
  await requestDemoFromLanding(slug);
  redirect(`/p/${slug}`);
}

function maskEmail(email: string | undefined) {
  if (!email) return "your email address";
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(5, user.length - 1)))}@${domain}`;
}

export default async function Landing({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lead = leadBySlug(slug);
  if (!lead || lead.status === "Do not contact") notFound();
  const { profile, demo } = getSettings();
  const colors = lead.colors ?? fallbackColors(profile.defaultColors);
  const copy = latestDraft(lead.id)?.copy;
  const heading = ensureReadableOnWhite(colors.primary);
  const offer = demoOfferOn(lead);
  const photo = photoFor(lead);
  const sentTo = (db().prepare("SELECT to_email FROM emails WHERE lead_id = ? AND status = 'sent' ORDER BY sent_at LIMIT 1").get(lead.id) as { to_email: string } | undefined)?.to_email ?? bestEmail(lead.contacts)?.value;
  logEvent(lead.id, "web", "landing_view", slug);
  const photoDims = photo ? (await import("sharp").then(async ({ default: sharp }) => {
    const path = await import("node:path");
    const { imagesDir } = await import("@/lib/email/graphic");
    return sharp(path.join(imagesDir(), photo.file)).metadata().catch(() => null);
  })) : null;

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
        </section>

        <section className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Your free demo</h2>
            {!offer ? (
              <p className="mt-2 text-sm text-gray-700">
                Reply to the email we sent and we&rsquo;ll build a free demo chatbot from your own website, so you can see how it would answer your customers.
              </p>
            ) : lead.demo_status === "ready" ? (
              <div className="mt-2 space-y-3 text-sm text-gray-700">
                <p>Your chatbot is ready. It was built from your website&rsquo;s public pages. Ask it a few real questions.</p>
                {lead.demo_chat_link && (
                  <a href={lead.demo_chat_link} className="inline-block rounded-lg px-5 py-3 font-semibold" style={{ background: colors.primary, color: colors.onPrimary }}>
                    Open your chatbot
                  </a>
                )}
                <div className="border-t pt-3">
                  <p className="font-medium">Like it? Make it yours.</p>
                  <p>Create your own Fise account (about a minute) and add the chatbot to your website. We&rsquo;ll help if you get stuck.</p>
                  <a href={demo.signupUrl} className="mt-2 inline-block rounded-lg border px-4 py-2 font-semibold" style={{ borderColor: heading, color: heading }}>
                    Create your account
                  </a>
                </div>
              </div>
            ) : lead.demo_status === "building" ? (
              <div className="mt-2 space-y-2 text-sm text-gray-700">
                <p className="font-medium">We&rsquo;re building your chatbot now.</p>
                <p>This usually takes a few minutes. We&rsquo;ll email it to {maskEmail(sentTo)} when it&rsquo;s ready, so you can close this page.</p>
                <AutoRefresh seconds={15} />
              </div>
            ) : lead.demo_status === "failed" ? (
              <p className="mt-2 text-sm text-gray-700">Sorry, we couldn&rsquo;t build your demo automatically. We&rsquo;ve been told and will email you shortly.</p>
            ) : (
              <form action={buildMyDemo} className="mt-2 space-y-3 text-sm text-gray-700">
                <input type="hidden" name="slug" value={slug} />
                <p>We&rsquo;ll build a chatbot from your website&rsquo;s public pages and email it to {maskEmail(sentTo)} in a few minutes. No account needed.</p>
                <button className="rounded-lg px-5 py-3 font-semibold" style={{ background: colors.primary, color: colors.onPrimary }}>
                  Build my free demo
                </button>
              </form>
            )}
          </div>

          {photo && photoDims?.width && (
            <figure className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/i/${photo.file}`} alt={photo.alt} width={photoDims.width} height={photoDims.height} className="h-auto w-full" />
              <figcaption className="px-4 py-2 text-xs text-gray-500">
                {lead.demo_photo ? `A real conversation with the chatbot we built for ${lead.business_name}.` : "A real Fise chatbot answering a customer question (an example, not your chatbot)."}
              </figcaption>
            </figure>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-6 pb-10 text-xs text-gray-500">
        {profile.company} · {profile.address} · {profile.phone}. This page was made for {lead.business_name} using details from your public website.
      </footer>
    </div>
  );
}
