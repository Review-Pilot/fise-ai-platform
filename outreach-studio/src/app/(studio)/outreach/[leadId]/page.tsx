import { notFound } from "next/navigation";
import Link from "next/link";
import { getLead } from "@/lib/leads";
import { getEmail, latestDraft } from "@/lib/email/build";
import { getSettings } from "@/lib/settings";
import { config } from "@/lib/config";
import { Editor } from "./Editor";
import { GenerateButton } from "./GenerateButton";

export default async function OutreachEditor({ params, searchParams }: { params: Promise<{ leadId: string }>; searchParams: Promise<{ email?: string }> }) {
  const { leadId } = await params;
  const { email: emailId } = await searchParams;
  const lead = getLead(leadId);
  if (!lead) notFound();
  const email = emailId ? getEmail(emailId) : latestDraft(leadId);
  const { consent } = getSettings();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/leads/${leadId}`} className="muted hover:underline">← {lead.business_name}</Link>
          <h1 className="h1">Outreach · {lead.business_name}</h1>
          {lead.research_error && <p className="text-sm text-amber-700">Website research problem: {lead.research_error}. Using manual/neutral colours — set them below.</p>}
        </div>
      </div>
      {email ? (
        <Editor
          initial={email}
          lead={{
            id: lead.id, name: lead.business_name, colors: lead.colors, contacts: lead.contacts.filter((c) => c.kind === "email").map((c) => ({ value: c.value, valid: c.valid !== false, type: c.emailType ?? "" })),
            whatsapp: lead.contacts.find((c) => c.kind === "whatsapp")?.value ?? null,
            contactForm: lead.contacts.find((c) => c.kind === "contact_form")?.value ?? null,
            socials: lead.contacts.filter((c) => ["facebook", "instagram", "linkedin"].includes(c.kind)).map((c) => ({ kind: c.kind, value: c.value })),
          }}
          publicBase={config.publicBaseUrl}
          consentFirst={consent.consentFirstMode}
        />
      ) : (
        <div className="card space-y-3">
          <p>No email drafted yet for this lead.</p>
          <GenerateButton leadId={leadId} />
        </div>
      )}
    </div>
  );
}
